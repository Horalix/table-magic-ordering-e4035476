import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { motion, AnimatePresence } from 'framer-motion';
import {
  BellRing, Check, ChefHat, CreditCard, CupSoda, Hand, Keyboard, LayoutList, Maximize2, Minimize2, Printer, RotateCcw,
  Settings, Volume2, VolumeX, WifiOff, X,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  playNewOrderAlert, playWaiterCallAlert, playBillRequestAlert, unlockAudio, audioReady, playTestTone, useReminderChime,
  vibrate,
} from '@/lib/kitchen-sounds';
import { useWakeLock } from '@/lib/wake-lock';
import { boardSequence, keyCommand, keysBelongToBoard, nextBump, SHORTCUTS, type KeyCommand } from '@/lib/kds-actions';
import { buildKitchenTicketBytes, downloadKitchenTicketCsv, downloadKitchenTicketJson, printKitchenTicket, ticketHasLines, type KitchenPrintSettings } from '@/lib/ticket-export';
import { isBluetoothConnected, tryReconnectBluetoothPrinter, printBytesBluetooth, printerStatusCapable } from '@/lib/printer-connect';
import { enqueuePrint, retryPrintQueue, usePrintQueue } from '@/lib/print-queue';
import type { PrintOutcome } from '@/lib/print-outcome';
import { printerHealth, type PrinterHealth } from '@/lib/printers-api';
import { cloudCoveredTypes, printerFor, printerSummary, ticketStateLabel, type TicketState } from '@/lib/print-routing';
import ConnectionPill from '@/components/staff/ConnectionPill';
import KitchenOrderCard, {
  type KitchenItem, type KitchenOrder, type OrderItemStatus, type OrderStatus, type PrintStateLine, type StationFilter,
} from '@/components/staff/KitchenOrderCard';
import { kitchenStart } from '@/components/staff/order-status';
import AllDayPanel from '@/components/staff/AllDayPanel';
import FreeTableDialog from '@/components/staff/FreeTableDialog';
import HeldOrdersCard from '@/components/staff/HeldOrdersCard';
import { useStaffDocument } from '@/components/staff/useStaffDocument';
import {
  useCoalesced, useLatestRequest, useStaffRealtime, useStaffRealtimeEvent, useStaffRefresh,
} from '@/lib/realtime';
import { useElapsedMinutes, formatMinutes, formatClock } from '@/lib/timing';
import { useNow } from '@/lib/clock';
import {
  bumpOrderItem, bumpOrderItems, cancelOrder, claimTicketPrint, deviceId, reportTicketPrint,
  kitchenLoad, requeueStaleTicketPrints, requeueTicketPrint, revertOrderStatus,
  resolveBillRequest as rpcResolveBillRequest, resolveWaiterCall as rpcResolveWaiterCall,
  updateOrderStatus as rpcUpdateOrderStatus, type KitchenLoadRow, type TicketType,
} from '@/lib/staff-api';
import type { Database } from '@/integrations/supabase/types';

interface PrintConfig {
  print_enabled: boolean;
  print_auto: boolean;
  print_paper_width: number;
  print_header: string;
  print_footer: string;
  print_show_prices: boolean;
  print_copies: number;
}
const DEFAULT_PRINT: PrintConfig = {
  print_enabled: true, print_auto: true, print_paper_width: 80,
  print_header: 'La Soul', print_footer: '', print_show_prices: true, print_copies: 1,
};
const toPrintSettings = (c: PrintConfig): KitchenPrintSettings => ({
  paperWidth: c.print_paper_width, header: c.print_header, footer: c.print_footer,
  showPrices: c.print_show_prices, copies: c.print_copies,
});

type OrderItemRow = Database['public']['Tables']['order_items']['Row'];
type OrderRow = Database['public']['Tables']['orders']['Row'];
type WaiterCallRow = Database['public']['Tables']['waiter_calls']['Row'];
type BillRequestRow = Database['public']['Tables']['bill_requests']['Row'];

type KitchenOrderRow = OrderRow & {
  table_sessions?: {
    tables?: {
      table_number?: number | null;
      section_id?: string | null;
      sections?: { name?: string | null; color?: string | null } | null;
    } | null;
  } | null;
  order_items?: (OrderItemRow & { menu_items?: { name?: string | null; allergens?: string[] | null } | null })[] | null;
};

type WaiterCallQueryRow = WaiterCallRow & {
  table_sessions?: { tables?: { table_number?: number | null } | null } | null;
};

type BillRequestQueryRow = BillRequestRow & {
  table_sessions?: { tables?: { table_number?: number | null } | null } | null;
};

/**
 * An open call or bill request — pending OR claimed.
 *
 * Claimed ones used to vanish from this screen the moment a waiter tapped
 * "I'll go", which read as "handled" while the guest was still waiting. They
 * stay until resolved, and say who is on the way and for how long.
 */
interface FloorAlert {
  id: string;
  table_session_id: string;
  status: string;
  created_at: string;
  table_number: number;
  acknowledged_by: string | null;
  acknowledged_at: string | null;
}
type WaiterCall = FloorAlert;
type BillRequest = FloorAlert;

const toFloorAlert = (row: WaiterCallQueryRow | BillRequestQueryRow): FloorAlert => ({
  id: row.id,
  table_session_id: row.table_session_id,
  status: row.status,
  created_at: row.created_at,
  table_number: row.table_sessions?.tables?.table_number || 0,
  acknowledged_by: (row as { acknowledged_by?: string | null }).acknowledged_by ?? null,
  acknowledged_at: (row as { acknowledged_at?: string | null }).acknowledged_at ?? null,
});

/** An order that just arrived and nobody has touched: the banner and the NEW flag. */
interface FreshOrder { id: string; table: number; code: string | null; at: number }

/** The last bump, so one tap (or Backspace on a bump bar) can take it back. */
type LastBump =
  | { kind: 'start' | 'ready'; orderId: string; table: number; itemIds: string[]; at: number }
  | { kind: 'served'; orderId: string; table: number; at: number };

/** How long a new order stays flagged if nobody starts it. */
const FRESH_MS = 3 * 60 * 1000;

/** A ticket the database has queued and nobody has printed yet. */
interface PrintJob {
  order: KitchenOrder;
  type: TicketType;
  /** When the original printed, if this is a reprint (survives across devices). */
  reprintOf: string | null;
  /** Changes when the ticket is requeued, so a Retry prints again. */
  key: string;
}

/** Only orders released this recently count as "new" for the chime. */
const NEW_ORDER_WINDOW_MS = 2 * 60 * 1000;

/**
 * How far back the board looks.
 *
 * 18 hours covers the longest conceivable service plus an overnight tail,
 * without ever pulling a week of history onto a tablet.
 */
const ACTIVE_WINDOW_MS = 18 * 60 * 60 * 1000;

/**
 * A backstop, not a page size. If this is ever hit something is wrong, and the
 * UI says so rather than quietly showing a subset.
 */
const HARD_ROW_CAP = 300;

/**
 * Three columns, not four.
 *
 * `confirmed` is vestigial now that lines carry their own status: an order is
 * "accepted but nothing started" and "new" in exactly the same way to a cook,
 * and a column nobody moves cards out of is a column that collects them. New
 * therefore holds both.
 */
const KANBAN: { key: string; statuses: OrderStatus[]; label: string; dot: string }[] = [
  { key: 'new', statuses: ['pending', 'confirmed'], label: 'New', dot: 'bg-destructive' },
  { key: 'preparing', statuses: ['preparing'], label: 'Preparing', dot: 'bg-accent' },
  { key: 'ready', statuses: ['ready'], label: 'Ready', dot: 'bg-primary' },
];

const STATIONS: { key: StationFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'kitchen', label: 'Kitchen' },
  { key: 'bar', label: 'Bar' },
];

/** Live "n minutes ago", off the shared clock rather than a per-row timer. */
const Ago = ({ at }: { at: string }) => {
  const ms = useElapsedMinutes(at);
  return <>{ms < 60_000 ? 'just now' : `${formatMinutes(ms)} ago`}</>;
};

/** "Marko is going (3m)" — a claim, with how long it has been on the way. */
const Going = ({ name, since }: { name: string; since: string | null }) => {
  const ms = useElapsedMinutes(since);
  return <>{name} is going{since ? ` (${Math.max(0, Math.floor(ms / 60_000))}m)` : ''}</>;
};

/** "Undo: table 7 served (82s)" — the last bump, while the database still allows it. */
const UndoLastChip = ({ bump, windowSeconds, onUndo }: { bump: LastBump; windowSeconds: number; onUndo: () => void }) => {
  const now = useNow();
  const left = Math.ceil((bump.at + windowSeconds * 1000 - now) / 1000);
  if (left <= 0) return null;
  const what = bump.kind === 'served' ? 'served' : bump.kind === 'ready' ? 'ready' : 'started';
  return (
    <button
      type="button"
      onClick={onUndo}
      className="inline-flex items-center gap-1.5 text-xs font-sans font-semibold px-3 min-h-[32px] rounded-full bg-foreground text-background hover:opacity-90"
      aria-label={`Undo: table ${bump.table} ${what}, ${left} seconds left`}
    >
      <RotateCcw className="w-3.5 h-3.5" /> Undo: T{bump.table} {what} <span className="tabular-nums opacity-70">{left}s</span>
    </button>
  );
};

const KitchenDisplay = () => {
  useStaffDocument();
  const [orders, setOrders] = useState<KitchenOrder[]>([]);
  /** Latest board, for callbacks that must not be re-created on every refetch. */
  const ordersRef = useRef<KitchenOrder[]>([]);
  useEffect(() => { ordersRef.current = orders; }, [orders]);
  const [waiterCalls, setWaiterCalls] = useState<WaiterCall[]>([]);
  const [billRequests, setBillRequests] = useState<BillRequest[]>([]);
  const [view, setView] = useState<'active' | 'allday' | 'history'>('active');
  /** Remembered per device, like the station: the terrace screen stays the terrace screen. */
  const [sectionFilter, setSectionFilter] = useState<string>(() => localStorage.getItem('kitchen:section') || 'all');
  /** Orders that just arrived, until someone starts them or says "got it". */
  const [fresh, setFresh] = useState<FreshOrder[]>([]);
  /** The ticket the keyboard / bump bar is on. */
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showKeys, setShowKeys] = useState(false);
  const [lastBump, setLastBump] = useState<LastBump | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  /** When the board last loaded for certain — what an offline banner can promise. */
  const [lastLoadedAt, setLastLoadedAt] = useState<number | null>(null);
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  /** A dimmed tablet is a board nobody reads and a tab the browser throttles. */
  const wake = useWakeLock(true);
  /**
   * Which station this screen belongs to.
   *
   * Persisted per device, like the printer flag: a bar tablet is a bar tablet
   * every shift, and re-picking it after every reload is exactly the sort of
   * chore that ends with someone leaving it on "All".
   */
  const [station, setStation] = useState<StationFilter>(
    () => (localStorage.getItem('kitchen:station') as StationFilter) || 'all',
  );
  const [sections, setSections] = useState<{ id: string; name: string; color: string }[]>([]);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const soundEnabledRef = useRef(true);
  const stationRef = useRef<StationFilter>('all');
  /**
   * Whether the browser will actually let us make a noise.
   *
   * Autoplay policy suspends the audio context until a real gesture, so a
   * wall-mounted tablet nobody has touched since boot is silent. Showing an
   * "unmuted" speaker over a suspended context is the single most dangerous
   * lie this screen can tell, because the kitchen stops watching and starts
   * listening.
   */
  const [audioUnlocked, setAudioUnlocked] = useState(false);
  const initialLoadDone = useRef(false);

  /** How long the database will still accept an undo. Drives the countdown. */
  const [undoSeconds, setUndoSeconds] = useState(90);

  // Printing
  const [isPrinter, setIsPrinter] = useState(() => localStorage.getItem('kitchen:isPrinter') === 'true');
  const [btName, setBtName] = useState<string | null>(null);
  const [printConfig, setPrintConfig] = useState<PrintConfig>(DEFAULT_PRINT);
  /** Cheap local gate; the authoritative claim lives in the database. */
  const printedRef = useRef<Set<string>>(new Set());
  const [failedPrints, setFailedPrints] = useState<string[]>([]);
  /**
   * Queue health. `stuck` is the state that matters: it means a job stopped
   * answering and everything behind it is waiting for a person, not a retry.
   */
  const printQueue = usePrintQueue();

  // Live-data health, owned by the shared realtime module: one channel per tab
  // instead of one per screen, events coalesced so a six-item order causes one
  // refetch rather than seven, and a polling fallback whenever the socket is
  // not subscribed.
  const connection = useStaffRealtime();
  const [loadError, setLoadError] = useState(false);
  /**
   * Freshly released orders, fetched independently of the visible tab.
   *
   * Auto-print used to iterate the same list the board renders, so leaving the
   * screen on History silently stopped every ticket printing — with nothing on
   * screen to suggest it. Printing is a background duty of this device and must
   * not depend on what someone last tapped.
   */
  const [printJobs, setPrintJobs] = useState<PrintJob[]>([]);
  /**
   * Network printers and whether each is alive. A station an online printer
   * covers is left to it; one whose printer has gone quiet falls back to this
   * tablet by itself.
   */
  const [cloudPrinters, setCloudPrinters] = useState<PrinterHealth[]>([]);
  /** What the database says happened to each ticket: order id → type → state. */
  const [ticketStates, setTicketStates] = useState<Record<string, Partial<Record<TicketType, TicketState>>>>({});
  /** True when the row cap was hit — the board is not showing everything. */
  const [truncated, setTruncated] = useState(false);

  /**
   * How far behind each station is.
   *
   * The board shows what is outstanding; this says whether that is a normal
   * amount. "9 orders" means nothing on its own — nine drinks and nine steaks
   * are different nights.
   */
  const [load, setLoad] = useState<KitchenLoadRow[]>([]);

  /** Void needs a reason, so it needs a dialog rather than a bare button. */
  const [voiding, setVoiding] = useState<KitchenOrder | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [voidBusy, setVoidBusy] = useState(false);

  /** The bill request whose ✓ was tapped — freeing a table is confirmed, never one tap. */
  const [freeing, setFreeing] = useState<BillRequest | null>(null);
  /** Calls being cleared right now, so a double tap is one request. */
  const [clearing, setClearing] = useState<Set<string>>(new Set());

  /**
   * Whether the gear may be shown.
   *
   * The printing settings live in the admin area, and the admin layout used to
   * sign out anyone who was not a manager — so a cook tapping the gear on the
   * kitchen tablet was logged out of the kitchen mid-service.
   */
  const [isAdmin, setIsAdmin] = useState(false);
  /** auth user id → display name, for "Marko is going". */
  const [staffNames, setStaffNames] = useState<Record<string, string>>({});
  /** waiters.id → display name, for the waiter line on a ticket. */
  const waiterNamesRef = useRef<Record<string, string>>({});

  /** Orders already on the board, so a chime means "this is new", not "this refetched". */
  const knownOrderIds = useRef<Set<string> | null>(null);
  const beginOrders = useLatestRequest();
  const beginPrintable = useLatestRequest();
  const beginCalls = useLatestRequest();
  const beginBills = useLatestRequest();

  // Silently reconnect a previously-paired Bluetooth printer on load.
  useEffect(() => { tryReconnectBluetoothPrinter().then((n) => { if (n) setBtName(n); }); }, []);

  // Load print settings + keep them live — through the shared channel, rather
  // than a second socket of this screen's own.
  const loadSettings = useCallback(() => {
    void supabase.from('restaurant_settings').select('*').eq('id', 1).maybeSingle()
      .then(({ data }) => {
        if (!data) return;
        setPrintConfig({ ...DEFAULT_PRINT, ...(data as Partial<PrintConfig>) });
        const undo = (data as { kitchen_undo_seconds?: number | null }).kitchen_undo_seconds;
        if (typeof undo === 'number') setUndoSeconds(undo);
      });
  }, []);
  useEffect(() => { loadSettings(); }, [loadSettings]);
  useStaffRealtimeEvent(useCallback((table: string) => {
    if (table === 'restaurant_settings') loadSettings();
  }, [loadSettings]));

  // Who may see the admin gear, and the names behind "… is going".
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const { data: admin } = await supabase.rpc('has_role', { _user_id: session.user.id, _role: 'admin' });
      if (!cancelled) setIsAdmin(admin === true);
    })();
    void supabase.from('waiters').select('id, user_id, display_name').then(({ data }) => {
      if (cancelled || !Array.isArray(data)) return;
      const names: Record<string, string> = {};
      const byWaiter: Record<string, string> = {};
      for (const w of data as { id: string; user_id: string | null; display_name: string }[]) {
        if (w.user_id) names[w.user_id] = w.display_name;
        if (w.id) byWaiter[w.id] = w.display_name;
      }
      waiterNamesRef.current = byWaiter;
      setStaffNames(names);
    });
    return () => { cancelled = true; };
  }, []);

  /**
   * Which tickets this device is responsible for.
   *
   * A bar tablet prints bar tickets. A screen set to All prints both, because
   * a single-printer restaurant is the common case and nobody should have to
   * know that "All" also means "and print everything".
   */
  const ticketTypes = useCallback((): TicketType[] => (
    station === 'all' ? ['kitchen', 'bar'] : [station]
  ), [station]);

  /**
   * Print one station's ticket for one order, through the queue.
   *
   * Every step reports honestly:
   *   - no claim, no print (a duplicate ticket is worse than a missing one,
   *     and the missing one is at least visible);
   *   - the outcome that comes back distinguishes "the printer confirmed it"
   *     from "we wrote bytes at something that cannot be asked";
   *   - a failure is recorded server-side so the ticket returns to the queue
   *     with a Reprint, rather than being silently counted as done.
   */
  const printTicket = useCallback((
    order: KitchenOrder,
    type: TicketType,
    reprintOf: string | null = null,
  ) => {
    const settings = { ...toPrintSettings(printConfig), station: type, reprintOf };
    // An order with nothing for this station has no ticket. Printing a blank
    // one teaches staff to ignore that printer.
    if (!ticketHasLines(order, type)) return;

    enqueuePrint({
      id: `${order.id}:${type}`,
      label: `Table ${order.table_number} (${type})`,
      run: async (): Promise<PrintOutcome> => {
        let won = false;
        try {
          won = await claimTicketPrint(order.id, deviceId(), type);
        } catch (error) {
          return { ok: false, reason: error instanceof Error ? error.message : 'Could not claim the ticket' };
        }
        if (!won) return { ok: true, verified: false };

        const outcome = isBluetoothConnected()
          ? await printBytesBluetooth(buildKitchenTicketBytes(order, settings))
          : await printKitchenTicket(order, settings);

        await reportTicketPrint(order.id, outcome.ok, outcome.ok ? undefined : outcome.reason, type,
          outcome.ok ? outcome.verified : undefined).catch(() => {});
        return outcome;
      },
      onSettled: (outcome) => {
        setFailedPrints((prev) => {
          if (outcome.ok) return prev.filter((id) => id !== order.id);
          return prev.includes(order.id) ? prev : [...prev, order.id];
        });
        if (!outcome.ok) toast.error(`Table ${order.table_number}: ${outcome.reason}`);
      },
    });
  }, [printConfig]);

  /**
   * Auto-print what the database has queued for this device's stations.
   *
   * Driven by the ticket queue rather than by "orders released in the last
   * minute": a ticket a manager pressed Retry on, a reprint asked for from
   * another screen, or one queued while this tablet was reloading all print
   * here too. The database owns the claim — claim_ticket_print() moves the
   * ticket to `claimed` atomically and tells us whether THIS device won — so
   * two tablets, or a tablet and a network printer, cannot both print it.
   *
   * Held orders never reach the queue until someone confirms them, so they
   * cannot print early from here either.
   */
  useEffect(() => {
    if ((!isPrinter && !isBluetoothConnected()) || !printConfig.print_enabled || !printConfig.print_auto) return;
    const mine = new Set(ticketTypes());
    const cloud = cloudCoveredTypes(cloudPrinters);

    for (const job of printJobs) {
      if (printedRef.current.has(job.key)) continue;
      if (!mine.has(job.type) || cloud.has(job.type)) continue;
      printedRef.current.add(job.key);
      printTicket(job.order, job.type, job.reprintOf);
    }
  }, [printJobs, isPrinter, printConfig, btName, printTicket, ticketTypes, cloudPrinters]);

  /** Network printer health, every half minute. A dead printer must show before the next ticket. */
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      void printerHealth().then((rows) => { if (!cancelled) setCloudPrinters(rows); }).catch(() => {});
    };
    load();
    const id = setInterval(load, 30_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  /**
   * Sweep claims nobody reported on.
   *
   * A tablet that claims a ticket and then dies leaves work that no screen
   * shows and no timer retries. Running it from every open kitchen device
   * needs no pg_cron and is idempotent — and if no kitchen device is open,
   * there is nothing to print to anyway.
   */
  useEffect(() => {
    const sweep = () => {
      void requeueStaleTicketPrints().then((n) => {
        if (n > 0) toast.warning(`${n} ticket${n === 1 ? '' : 's'} were claimed but never printed — reprint below`);
      }).catch(() => {});
    };
    sweep();
    const id = setInterval(sweep, 60_000);
    return () => clearInterval(id);
  }, []);

  /**
   * Put a ticket back in the queue and print it again, marked as a reprint.
   *
   * A station with an online network printer just requeues: the printer picks
   * it up within seconds, at the pass, with REPRINT and the original time on
   * it. Otherwise this device prints it — through the claim, like any ticket.
   */
  const reprint = async (order: KitchenOrder) => {
    try {
      for (const type of ticketTypes()) {
        if (!ticketHasLines(order, type)) continue;
        const result = await requeueTicketPrint(order.id, type);
        const cloud = printerFor(cloudPrinters, type);
        if (cloud?.online) {
          toast.success(`Reprinting on ${cloud.name}`);
          continue;
        }
        printTicket(order, type, result?.previous_printed_at ?? null);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Reprint failed');
    }
  };

  // Keep refs in sync with state (read from long-lived intervals/callbacks).
  useEffect(() => {
    soundEnabledRef.current = soundEnabled;
  }, [soundEnabled]);
  useEffect(() => { stationRef.current = station; }, [station]);

  /* Network state, for the "no connection" banner. */
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down); };
  }, []);

  /* Full screen follows the browser, whichever way it was entered or left. */
  useEffect(() => {
    const sync = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) { void document.exitFullscreen().catch(() => {}); return; }
    const el = document.documentElement as HTMLElement & { requestFullscreen?: () => Promise<void> };
    if (!el.requestFullscreen) { toast.error('Full screen is not available here — use the browser menu, or add the board to the home screen'); return; }
    void el.requestFullscreen().catch(() => toast.error('The browser refused full screen'));
  }, []);

  /**
   * Unlock audio on the first interaction anywhere on the page.
   *
   * Staff will tap something — a filter, a card, the board — within seconds of
   * walking up. This turns that incidental tap into working alerts, instead of
   * requiring someone to know they must press a specific button.
   */
  useEffect(() => {
    setAudioUnlocked(audioReady());
    if (audioReady()) return;

    /*
     * `click`, not `pointerdown` — and that distinction is a bug fix.
     *
     * Unlocking hides the "Sound blocked" chip, which changes the header's
     * size. On pointerdown that happened BETWEEN the press and the release, so
     * the toolbar moved out from under the finger and the tap landed on
     * nothing: wider viewports slid the controls sideways, narrow ones shifted
     * them down a row. Every board load began with one dead tap, because
     * browsers always suspend audio until a gesture.
     *
     * A window-level `click` listener runs after React's delegated handler for
     * whatever was tapped, so the control does its job first and the layout
     * settles afterwards. Autoplay policy is satisfied either way — a click is
     * every bit as much a user gesture as a pointerdown.
     */
    const unlock = async () => {
      const ok = await unlockAudio();
      setAudioUnlocked(ok);
      if (ok) {
        window.removeEventListener('click', unlock);
        window.removeEventListener('keyup', unlock);
      }
    };
    window.addEventListener('click', unlock);
    window.addEventListener('keyup', unlock);
    return () => {
      window.removeEventListener('click', unlock);
      window.removeEventListener('keyup', unlock);
    };
  }, []);

  /** Prove the speaker works before service, not during it. */
  const testSound = async () => {
    const ok = (await unlockAudio()) && playTestTone();
    setAudioUnlocked(audioReady());
    if (!ok) {
      toast.error('No sound — check the tablet volume and that it is not on silent');
    }
  };

  /** Shared row → card mapping, used by both the board and the print feed. */
  const mapOrderRow = useCallback((o: KitchenOrderRow): KitchenOrder => ({
    id: o.id,
    order_code: (o as { order_code?: string | null }).order_code ?? null,
    status: o.status,
    total: o.total,
    tip_amount: (o as { tip_amount?: number | null }).tip_amount ?? null,
    payment_method: o.payment_method ?? null,
    payment_status: o.payment_status ?? null,
    notes: o.notes,
    created_at: o.created_at,
    released_to_kitchen_at: o.released_to_kitchen_at ?? null,
    confirmed_at: (o as { confirmed_at?: string | null }).confirmed_at ?? null,
    preparing_at: (o as { preparing_at?: string | null }).preparing_at ?? null,
    ready_at: (o as { ready_at?: string | null }).ready_at ?? null,
    served_at: (o as { served_at?: string | null }).served_at ?? null,
    table_number: o.table_sessions?.tables?.table_number || 0,
    guest_name: o.guest_name || null,
    section_id: o.table_sessions?.tables?.section_id || null,
    section_name: o.table_sessions?.tables?.sections?.name || null,
    section_color: o.table_sessions?.tables?.sections?.color || null,
    waiter_name: waiterNamesRef.current[(o.table_sessions as { assigned_waiter_id?: string | null } | null)?.assigned_waiter_id ?? ''] ?? null,
    items: (o.order_items || []).map((oi) => ({
      id: oi.id,
      quantity: oi.quantity,
      unit_price: oi.unit_price,
      notes: oi.notes,
      status: oi.status,
      station: (oi as { station?: string | null }).station ?? 'kitchen',
      started_at: (oi as { started_at?: string | null }).started_at ?? null,
      ready_at: (oi as { ready_at?: string | null }).ready_at ?? null,
      menu_item_name: oi.menu_items?.name || 'Unknown',
      allergens: oi.menu_items?.allergens ?? null,
      components: Array.isArray((oi as { components?: unknown }).components)
        ? ((oi as { components?: KitchenItem['components'] }).components ?? null) : null,
    })),
  }), []);

  /**
   * The print queue for this device, independent of the visible tab.
   *
   * Auto-print used to iterate the same list the board renders, so leaving the
   * screen on History silently stopped every ticket printing. Printing is a
   * background duty of this device and must not depend on what someone last
   * tapped.
   *
   * Ten minutes back: a reload catches up on what never printed, without
   * printing the history of the evening.
   */
  const fetchPrintQueue = useCallback(async () => {
    const isLatest = beginPrintable();
    const { data: queued, error } = await supabase
      .from('order_ticket_events')
      .select('*')
      .eq('status', 'queued')
      .in('ticket_type', ['kitchen', 'bar'])
      .gte('updated_at', new Date(Date.now() - 10 * 60 * 1000).toISOString())
      .order('updated_at', { ascending: true })
      .limit(50);
    if (error || !isLatest()) return;
    const rows = (Array.isArray(queued) ? queued : []) as {
      order_id: string; ticket_type: string; updated_at: string; original_printed_at?: string | null;
    }[];
    const ids = [...new Set(rows.map((r) => r.order_id))];
    if (ids.length === 0) { setPrintJobs([]); return; }

    const { data: ordersData, error: ordersError } = await supabase
      .from('orders')
      .select(`
        *,
        table_sessions!inner(assigned_waiter_id, tables!inner(table_number, section_id, sections(name, color))),
        order_items(*, menu_items(name, allergens))
      `)
      .in('id', ids)
      // Food already up, served or voided is not printed again by itself.
      .in('status', ['pending', 'confirmed', 'preparing']);
    if (ordersError || !isLatest()) return;
    const byId = new Map(((ordersData || []) as KitchenOrderRow[]).map((o) => [o.id, mapOrderRow(o)]));
    setPrintJobs(rows.flatMap((r) => {
      const order = byId.get(r.order_id);
      if (!order || (r.ticket_type !== 'kitchen' && r.ticket_type !== 'bar')) return [];
      return [{
        order, type: r.ticket_type, reprintOf: r.original_printed_at ?? null,
        key: `${r.order_id}:${r.ticket_type}:${r.updated_at}`,
      }];
    }));
  }, [mapOrderRow, beginPrintable]);

  /** Print state of every ticket on the board, from the database. */
  const fetchTicketStates = useCallback(async () => {
    const { data, error } = await supabase
      .from('order_ticket_events')
      .select('*')
      .gte('created_at', new Date(Date.now() - ACTIVE_WINDOW_MS).toISOString())
      .order('created_at', { ascending: false })
      .limit(HARD_ROW_CAP * 2);
    if (error || !Array.isArray(data)) return;
    const map: Record<string, Partial<Record<TicketType, TicketState>>> = {};
    for (const row of data as (TicketState & { order_id: string; ticket_type: string })[]) {
      if (row.ticket_type !== 'kitchen' && row.ticket_type !== 'bar') continue;
      (map[row.order_id] ??= {})[row.ticket_type] = row;
    }
    setTicketStates(map);
  }, []);

  const historyView = view === 'history';

  const fetchOrders = useCallback(async () => {
    const isLatest = beginOrders();
    let query = supabase
      .from('orders')
      .select(`
        *,
        table_sessions!inner(
          assigned_waiter_id,
          tables!inner(table_number, section_id, sections(name, color))
        ),
        order_items(
          *,
          menu_items(name, allergens)
        )
      `)
      .in('status', historyView ? ['served', 'cancelled'] : ['pending', 'confirmed', 'preparing', 'ready']);
    // A held order is `pending` but has not been released: it is a question
    // for staff (the "Needs confirming" card), not kitchen work. Unpaid card
    // orders never get here because their status is not in the list above.
    if (!historyView) query = query.or('held_reason.is.null,released_to_kitchen_at.not.is.null');
    const { data: ordersData, error } = await query
      // Bound by AGE, not by row count. The previous `.limit(50)` combined with
      // a descending sort silently dropped the OLDEST open orders — which are
      // precisely the late ones the kitchen most needs to see. An age bound
      // cannot hide a live ticket; at worst it hides a stale one.
      .gte('created_at', new Date(Date.now() - ACTIVE_WINDOW_MS).toISOString())
      .order('created_at', { ascending: false })
      .limit(HARD_ROW_CAP);

    // A slower, older response must not put a stale board back on screen.
    if (!isLatest()) return;

    if (error) {
      console.error('Error fetching orders:', error);
      setLoadError(true);
      return;
    }
    setLoadError(false);

    const mapped = ((ordersData || []) as KitchenOrderRow[]).map(mapOrderRow);

    /*
     * The new-order chime, decided from data rather than from an INSERT event.
     *
     * A card order is INSERTed as `awaiting_payment` — invisible to the kitchen
     * — and reaches the board later by an UPDATE when the payment clears. The
     * old INSERT chime therefore rang for food the kitchen could not see, and
     * stayed silent when it actually arrived. A ticket is new when it appears
     * on the active board for the first time, recently released.
     */
    if (!historyView) {
      const known = knownOrderIds.current;
      const now = Date.now();
      const st = stationRef.current;
      // New to THIS screen: the bar is not chimed for a steak.
      const arrived = known === null ? [] : mapped.filter((o) =>
        !known.has(o.id) && o.status === 'pending'
        && now - new Date(kitchenStart(o)).getTime() < NEW_ORDER_WINDOW_MS
        && (st === 'all' || o.items.some((i) => i.station === st)));
      if (arrived.length > 0) {
        if (soundEnabledRef.current) playNewOrderAlert();
        vibrate([300, 120, 300]);
        setFresh((prev) => [
          ...prev,
          ...arrived.filter((o) => !prev.some((f) => f.id === o.id))
            .map((o) => ({ id: o.id, table: o.table_number, code: o.order_code, at: now })),
        ]);
      }
      knownOrderIds.current = new Set([...(known ?? []), ...mapped.map((o) => o.id)]);
    }
    setLastLoadedAt(Date.now());

    setOrders(mapped);
    setTruncated(mapped.length >= HARD_ROW_CAP);
  }, [historyView, mapOrderRow, beginOrders]);

  const fetchWaiterCalls = useCallback(async () => {
    const isLatest = beginCalls();
    const { data, error } = await supabase
      .from('waiter_calls')
      .select(`*, table_sessions!inner(tables!inner(table_number))`)
      // Open, not merely pending: a claimed call is still a guest waiting.
      .neq('status', 'resolved')
      // Oldest first: the longest-waiting guest is the one to deal with next.
      .order('created_at', { ascending: true });

    if (!isLatest()) return;
    if (error) { console.error('Error fetching waiter calls:', error); return; }

    setWaiterCalls(((data || []) as WaiterCallQueryRow[]).map(toFloorAlert));
  }, [beginCalls]);

  const fetchBillRequests = useCallback(async () => {
    const isLatest = beginBills();
    const { data, error } = await supabase
      .from('bill_requests')
      .select(`*, table_sessions!inner(tables!inner(table_number))`)
      .neq('status', 'resolved')
      .order('created_at', { ascending: true });

    if (!isLatest()) return;
    if (error) { console.error('Error fetching bill requests:', error); return; }

    setBillRequests(((data || []) as BillRequestQueryRow[]).map(toFloorAlert));
  }, [beginBills]);

  useEffect(() => {
    supabase.from('sections').select('id, name, color').order('sort_order').then(({ data }) => {
      setSections(data || []);
    });

    void kitchenLoad().then(setLoad).catch(() => {});

    void fetchTicketStates();
    Promise.all([fetchOrders(), fetchPrintQueue(), fetchWaiterCalls(), fetchBillRequests()]).then(() => {
      initialLoadDone.current = true;
    });

    // Data lives here; the shared realtime module decides WHEN to refetch.
    // It coalesces bursts, invalidates only what changed, keeps one channel
    // per tab, and polls whenever the socket is not subscribed.
  }, [fetchOrders, fetchPrintQueue, fetchTicketStates, fetchWaiterCalls, fetchBillRequests]);

  /*
   * Refetch on live events — coalesced.
   *
   * A six-item order is seven events, and each used to start a full board
   * refetch, so seven overlapping requests raced each other and whichever
   * landed last won. Each feed now waits for the burst to end (~300ms) and
   * runs once; `useLatestRequest` drops anything that still arrives late.
   */
  const refetchOrders = useCoalesced(useCallback(() => {
    void fetchOrders(); void fetchPrintQueue(); void fetchTicketStates();
    void kitchenLoad().then(setLoad).catch(() => {});
  }, [fetchOrders, fetchPrintQueue, fetchTicketStates]));
  const refetchTickets = useCoalesced(useCallback(() => {
    void fetchPrintQueue(); void fetchTicketStates();
  }, [fetchPrintQueue, fetchTicketStates]));
  const refetchCalls = useCoalesced(useCallback(() => { void fetchWaiterCalls(); }, [fetchWaiterCalls]));
  const refetchBills = useCoalesced(useCallback(() => { void fetchBillRequests(); }, [fetchBillRequests]));

  /*
   * Split from the sound effect below on purpose: alerts must not wait on a
   * refetch, and a refetch must not depend on whether sound is on.
   */
  useStaffRealtimeEvent(
    useCallback((table: string) => {
      if (table === 'orders' || table === 'order_items') refetchOrders();
      if (table === 'order_ticket_events') refetchTickets();
      if (table === 'waiter_calls') refetchCalls();
      if (table === 'bill_requests') refetchBills();
    }, [refetchOrders, refetchTickets, refetchCalls, refetchBills]),
  );

  /*
   * And reload everything on the polling tick, on reconnect, when the tablet
   * wakes, and on the slow safety heartbeat. Without this the board kept its
   * data in plain state that only events refreshed, so with the socket down the
   * pill promised "refreshing every 15s" over a board that never changed.
   */
  useStaffRefresh(useCallback(() => {
    refetchOrders(); refetchCalls(); refetchBills();
  }, [refetchOrders, refetchCalls, refetchBills]));

  /**
   * Call and bill alerts, fired straight off the event so they are never held
   * up by data. The new-ORDER chime is decided in fetchOrders instead: an
   * INSERT is the wrong moment for a card order (see there).
   */
  useStaffRealtimeEvent(
    useCallback((table: string, eventType: string) => {
      if (!initialLoadDone.current || !soundEnabledRef.current || eventType !== 'INSERT') return;
      if (table === 'waiter_calls') playWaiterCallAlert();
      else if (table === 'bill_requests') playBillRequestAlert();
    }, []),
  );

  /*
   * Chime again every ~75s while a table is still waiting. One chime over the
   * extraction hood is easy to miss, and then nobody hears about that table
   * again until a guest walks up to the pass.
   */
  const alertsRef = useRef({ calls: waiterCalls, bills: billRequests });
  useEffect(() => { alertsRef.current = { calls: waiterCalls, bills: billRequests }; }, [waiterCalls, billRequests]);
  useReminderChime(
    soundEnabled && (waiterCalls.length > 0 || billRequests.length > 0),
    useCallback(() => {
      // Someone walking there right now is not a reason to chime; a claim
      // older than the three-minute takeover window is.
      const waiting = (a: FloorAlert) => a.status === 'pending'
        || !a.acknowledged_at || Date.now() - new Date(a.acknowledged_at).getTime() > 3 * 60_000;
      const { calls, bills } = alertsRef.current;
      if (bills.some(waiting)) playBillRequestAlert();
      else if (calls.some(waiting)) playWaiterCallAlert();
    }, []),
  );

  /* ---- Actions -------------------------------------------------------- */

  /**
   * Show a line's new state the moment it is tapped.
   *
   * On a laggy tablet the card used to sit unchanged until the refetch landed,
   * and a cook who sees no change taps again. The refetch that follows puts
   * the database's answer back either way, so a refused bump does not stick.
   */
  const patchItems = useCallback((ids: string[], status: OrderItemStatus) => {
    const wanted = new Set(ids);
    setOrders((prev) => prev.map((o) => (o.items.some((i) => wanted.has(i.id))
      ? { ...o, items: o.items.map((i) => (wanted.has(i.id) ? { ...i, status } : i)) }
      : o)));
  }, []);

  const bumpItem = useCallback(async (itemId: string, status: OrderItemStatus) => {
    patchItems([itemId], status);
    try {
      await bumpOrderItem(itemId, status);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not update that line');
    }
    await fetchOrders();
  }, [fetchOrders, patchItems]);

  const bumpMany = useCallback(async (itemIds: string[], status: OrderItemStatus) => {
    // Remember it, so Undo (or Backspace on a bump bar) can take it back.
    if (status === 'preparing' || status === 'ready') {
      const owner = ordersRef.current.find((o) => o.items.some((i) => itemIds.includes(i.id)));
      if (owner) setLastBump({ kind: status === 'preparing' ? 'start' : 'ready', orderId: owner.id, table: owner.table_number, itemIds, at: Date.now() });
    }
    patchItems(itemIds, status);
    try {
      const result = await bumpOrderItems(itemIds, status);
      if (result.failed > 0) toast.warning(`${result.updated} updated, ${result.failed} could not be`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not update those lines');
    }
    await fetchOrders();
  }, [fetchOrders, patchItems]);

  const advanceOrder = useCallback(async (orderId: string, status: OrderStatus) => {
    const order = ordersRef.current.find((o) => o.id === orderId);
    try {
      // Goes through the state machine: an illegal move is rejected by the
      // database rather than silently corrupting the board.
      await rpcUpdateOrderStatus(orderId, status);
      if (status === 'served' && order) {
        // The card leaves the board at once. An accidental "served" used to
        // mean digging through History before the undo window ran out.
        setLastBump({ kind: 'served', orderId, table: order.table_number, at: Date.now() });
        toast.success(`Table ${order.table_number} served`, {
          duration: 10_000,
          action: { label: 'Undo', onClick: () => { void revertOrderRef.current(orderId, 'ready'); } },
        });
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to update order status');
    }
    await fetchOrders();
  }, [fetchOrders]);

  const revertOrder = useCallback(async (orderId: string, status: OrderStatus) => {
    try {
      await revertOrderStatus(orderId, status, 'kitchen undo');
      toast.success(`Back to ${status}`);
      setLastBump((b) => (b?.orderId === orderId ? null : b));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not undo');
    }
    await fetchOrders();
  }, [fetchOrders]);
  const revertOrderRef = useRef(revertOrder);
  useEffect(() => { revertOrderRef.current = revertOrder; }, [revertOrder]);

  /** Take back the last bump, within the window the database allows. */
  const undoLast = useCallback(async () => {
    const b = lastBump;
    if (!b || Date.now() - b.at > undoSeconds * 1000) { toast.info('Nothing to undo'); return; }
    setLastBump(null);
    if (b.kind === 'served') { await revertOrder(b.orderId, 'ready'); return; }
    const back: OrderItemStatus = b.kind === 'start' ? 'pending' : 'preparing';
    patchItems(b.itemIds, back);
    try {
      await bumpOrderItems(b.itemIds, back);
      toast.success(`Table ${b.table}: undone`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not undo');
    }
    await fetchOrders();
  }, [lastBump, undoSeconds, revertOrder, patchItems, fetchOrders]);

  const confirmVoid = async () => {
    if (!voiding || voidReason.trim().length < 3) return;
    setVoidBusy(true);
    try {
      const result = await cancelOrder(voiding.id, voidReason.trim());
      // A voided order that was already paid for is a refund the manager still
      // has to make. Saying so here is the only place anyone will see it.
      if (result?.requires_refund) {
        toast.warning('Voided — this order was paid for and needs a refund');
      } else {
        toast.success('Order voided');
      }
      setVoiding(null);
      setVoidReason('');
      await fetchOrders();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not void this order');
    } finally {
      setVoidBusy(false);
    }
  };

  const exportTicket = (order: KitchenOrder, format: 'json' | 'csv') => {
    if (format === 'json') {
      downloadKitchenTicketJson(order);
      toast.success('Ticket JSON exported');
      return;
    }
    downloadKitchenTicketCsv(order);
    toast.success('Ticket CSV exported');
  };

  /** Through the RPC, so the cleared call has a name attached to it. */
  const resolveWaiterCall = async (callId: string) => {
    if (clearing.has(callId)) return;
    setClearing((prev) => new Set(prev).add(callId));
    // Gone from the strip at once; the refetch puts it back if the clear failed.
    setWaiterCalls((prev) => prev.filter((c) => c.id !== callId));
    try {
      await rpcResolveWaiterCall(callId);
      toast.success('Waiter call cleared');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to clear the call');
    } finally {
      setClearing((prev) => { const next = new Set(prev); next.delete(callId); return next; });
      void fetchWaiterCalls();
    }
  };

  /**
   * The ✓ on a bill request used to resolve it AND free the table in one tap
   * on a 24px target, without looking at whether anything was paid. It now
   * opens a confirmation that goes through staff_close_session, which refuses
   * while money is owed — with "just clear the request" for when the bill has
   * been brought but the guests are still sitting.
   */
  const clearBillRequestOnly = async (request: BillRequest) => {
    try {
      await rpcResolveBillRequest(request.id, false);
      toast.success(`Bill request for table ${request.table_number} cleared — table stays open`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to clear the bill request');
    }
    void fetchBillRequests();
  };

  /**
   * What this screen is responsible for.
   *
   * An order with nothing for this station is not "empty", it is not this
   * screen's problem — showing it would invite the barman to bump food.
   */
  const visible = useMemo(() => {
    const mine = orders
      .filter((o) => sectionFilter === 'all' || o.section_id === sectionFilter)
      .filter((o) => station === 'all' || o.items.some((i) => i.station === station));
    // History reads newest-first, like any log. The live board is a queue:
    // oldest at the top of each column, because that is the ticket to cook
    // next — newest-first buried the late table under the one that just came in.
    if (historyView) return mine;
    return [...mine].sort((a, b) => new Date(kitchenStart(a)).getTime() - new Date(kitchenStart(b)).getTime());
  }, [orders, sectionFilter, station, historyView]);

  /*
   * A new order stays flagged until someone starts a line of it, taps "Got
   * it", or three minutes pass — whichever is first. Until then the chime
   * repeats every 30 seconds: one chime over an extraction hood is easy to
   * miss, and a ticket nobody noticed is a table that waits twenty minutes.
   */
  useEffect(() => {
    setFresh((prev) => {
      const now = Date.now();
      const next = prev.filter((f) => {
        const o = orders.find((x) => x.id === f.id);
        if (!o || now - f.at > FRESH_MS) return false;
        const mine = station === 'all' ? o.items : o.items.filter((i) => i.station === station);
        return mine.every((i) => i.status === 'pending');
      });
      return next.length === prev.length ? prev : next;
    });
  }, [orders, station]);
  useReminderChime(soundEnabled && fresh.length > 0, useCallback(() => { playNewOrderAlert(); }, []), 30_000);
  const freshIds = useMemo(() => new Set(fresh.map((f) => f.id)), [fresh]);

  /** The tickets the keyboard walks, in the order the board draws them. */
  const sequence = useMemo(() => (view === 'active' ? boardSequence(visible) : []), [visible, view]);

  /*
   * Keyboard and bump bar. Digits pick a ticket, arrows move, Enter/Space
   * bumps (start all → all ready → served), Backspace undoes. Ignored while
   * typing or with a dialog open, and Enter/Space keep their meaning on a
   * focused button.
   */
  const commandRef = useRef<(cmd: KeyCommand) => void>(() => {});
  commandRef.current = (cmd: KeyCommand) => {
    const index = sequence.findIndex((o) => o.id === selectedId);
    const pick = (i: number) => {
      const target = sequence[Math.max(0, Math.min(sequence.length - 1, i))];
      if (!target) return;
      setSelectedId(target.id);
      document.getElementById(`ticket-${target.id}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    };
    switch (cmd.kind) {
      case 'select': pick(cmd.index); break;
      case 'move': pick(index < 0 ? 0 : index + cmd.by); break;
      case 'bump': {
        const target = sequence[index] ?? sequence[0];
        if (!target) break;
        setSelectedId(target.id);
        const action = nextBump(target, station);
        if (!action) break;
        if (action.kind === 'served') void advanceOrder(target.id, 'served');
        else void bumpMany(action.itemIds, action.kind === 'start' ? 'preparing' : 'ready');
        break;
      }
      case 'undo': void undoLast(); break;
      case 'reprint': { const target = sequence[index]; if (target) void reprint(target); break; }
      case 'fullscreen': toggleFullscreen(); break;
      case 'help': setShowKeys(true); break;
      case 'dismiss': setFresh([]); setSelectedId(null); break;
    }
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
      if (!keysBelongToBoard(e.target)) return;
      const cmd = keyCommand(e.key);
      if (!cmd) return;
      const onControl = (e.target as HTMLElement | null)?.closest?.('button, a, select, [role="button"]');
      if (cmd.kind === 'bump' && onControl) return;
      e.preventDefault();
      commandRef.current(cmd);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /** This screen's stations' tickets for an order, in words. */
  const printStatesFor = (order: KitchenOrder): PrintStateLine[] =>
    (['kitchen', 'bar'] as const)
      .filter((t) => station === 'all' || station === t)
      .flatMap((t) => {
        const state = ticketStates[order.id]?.[t];
        return state ? [{ type: t, ...ticketStateLabel(state) }] : [];
      });

  /** Printers that serve this screen's stations. */
  const myPrinters = cloudPrinters.filter((p) => p.enabled
    && (station === 'all' || p.station === 'all' || p.station === station));

  const renderCard = (order: KitchenOrder, showStatus: boolean) => (
    <KitchenOrderCard
      key={order.id}
      order={order}
      station={station}
      undoSeconds={undoSeconds}
      showStatus={showStatus}
      failedPrint={failedPrints.includes(order.id)}
      printStates={showStatus ? [] : printStatesFor(order)}
      isNew={!showStatus && freshIds.has(order.id)}
      selected={!showStatus && selectedId === order.id}
      slot={showStatus ? undefined : sequence.findIndex((o) => o.id === order.id) + 1 || undefined}
      onBumpItem={bumpItem}
      onBumpMany={bumpMany}
      onAdvanceOrder={advanceOrder}
      onRevertOrder={revertOrder}
      onCancel={setVoiding}
      onPrint={reprint}
      onExport={exportTicket}
    />
  );

  return (
    <div className="min-h-screen bg-background">
      <div className="sticky top-0 z-30 glass border-b border-border">
        {/*
          `flex-1 min-w-0` lets the left block own the remaining width, so a
          status chip appearing or vanishing inside it cannot slide the control
          cluster sideways mid-tap.

          It is the belt to the braces: the actual cure for the swallowed first
          tap is unlocking audio on `click` rather than `pointerdown` (see the
          effect above), because on a phone the cluster wraps to its own row
          and the shift is vertical, which no amount of width stabilising can
          fix.

          Note what is NOT here: `shrink-0` on the cluster. It looked like the
          symmetric fix and it broke the board on a phone — the cluster stopped
          shrinking, overflowed the viewport, and its own container then
          intercepted every tap aimed at the buttons inside it.
        */}
        <div className="flex items-center justify-between px-6 py-4 gap-4 flex-wrap">
          <div className="flex-1 min-w-0">
            <h1 className="font-serif text-2xl font-bold text-foreground">
              {station === 'bar' ? 'Bar Display' : station === 'kitchen' ? 'Kitchen Display' : 'Kitchen & Bar'}
            </h1>
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-sm text-muted-foreground font-sans">{visible.length} orders</p>

              <ConnectionPill state={connection} />

              {/* Backlog in minutes, which is the unit a cook thinks in. */}
              {load
                .filter((l) => (station === 'all' ? l.open_items > 0 : l.station === station))
                .map((l) => (
                  <span
                    key={l.station}
                    className={`inline-flex items-center gap-1 text-[11px] font-sans font-medium px-2 py-0.5 rounded-full ${
                      Number(l.load_factor) >= 2 ? 'bg-destructive/10 text-destructive'
                        : Number(l.load_factor) >= 1 ? 'bg-accent/10 text-accent'
                          : 'bg-muted text-muted-foreground'
                    }`}
                    title="Outstanding prep, against the configured capacity"
                  >
                    {l.station}: {Math.round(Number(l.backlog_minutes))} min
                    {Number(l.load_factor) >= 1 && ' behind'}
                  </span>
                ))}

              {/* Network printers, by name. An offline one is loud: the next
                  ticket for its station would otherwise vanish silently — this
                  tablet only takes over if it is set up to print. */}
              {myPrinters.map((p) => {
                const summary = printerSummary(p);
                return (
                  <span
                    key={p.id}
                    role="status"
                    className={`inline-flex items-center gap-1 text-[11px] font-sans font-semibold px-2 py-0.5 rounded-full ${
                      summary.tone === 'ok' ? 'bg-primary/10 text-primary' : 'bg-destructive text-destructive-foreground'
                    }`}
                    title={p.last_status ? `Printer status: ${p.last_status}` : undefined}
                  >
                    <Printer className="w-3 h-3" /> {p.name}: {summary.label}
                    {p.waiting > 0 && summary.tone !== 'ok' && ` · ${p.waiting} waiting`}
                  </span>
                );
              })}

              {/* A stuck queue is the loudest thing on this screen. Everything
                  behind it is waiting for a person, not for a retry. */}
              {printQueue.state === 'stuck' ? (
                <button
                  onClick={retryPrintQueue}
                  className="inline-flex items-center gap-1.5 text-xs font-sans font-bold px-3 py-1 rounded-full bg-destructive text-destructive-foreground hover:opacity-90 transition-opacity"
                >
                  <Printer className="w-3.5 h-3.5" />
                  PRINTER STUCK{printQueue.pending > 0 ? ` — ${printQueue.pending} waiting` : ''} · Retry
                </button>
              ) : (btName || isPrinter) && (
                <span className="inline-flex items-center gap-1 text-[11px] font-sans font-medium text-primary">
                  <span className="w-1.5 h-1.5 rounded-full bg-primary breathe" /> <Printer className="w-3 h-3" />
                  {btName ? `Printing · ${btName}` : 'Printing on this device'}
                  {/* Never call an unverifiable write "printed" without saying so. */}
                  {btName && !printerStatusCapable() && <span className="text-muted-foreground"> (unverified)</span>}
                  {printQueue.state === 'printing' && <span className="text-muted-foreground"> · {printQueue.current}</span>}
                </span>
              )}

              {printQueue.state !== 'stuck' && printQueue.lastError && (
                <span className="inline-flex items-center gap-1 text-[11px] font-sans font-medium px-2 py-0.5 rounded-full bg-destructive/10 text-destructive">
                  {printQueue.lastError}
                </span>
              )}

              {failedPrints.length > 0 && (
                <span className="inline-flex items-center gap-1 text-[11px] font-sans font-medium px-2 py-0.5 rounded-full bg-destructive/10 text-destructive">
                  <Printer className="w-3 h-3" /> {failedPrints.length} ticket{failedPrints.length === 1 ? '' : 's'} failed to print
                </span>
              )}

              {/* Never show an unmuted speaker over a context the browser has
                  suspended — the kitchen would stop watching and start listening. */}
              {soundEnabled && !audioUnlocked && (
                <button
                  onClick={testSound}
                  className="inline-flex items-center gap-1 text-[11px] font-sans font-medium px-2 py-0.5 rounded-full bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors"
                >
                  <VolumeX className="w-3 h-3" /> Sound blocked — tap to enable
                </button>
              )}

              {truncated && (
                <span className="inline-flex items-center gap-1 text-[11px] font-sans font-medium px-2 py-0.5 rounded-full bg-accent/10 text-accent">
                  Showing the newest {HARD_ROW_CAP} — some orders are not on screen
                </span>
              )}

              {/* The last bump, one tap from being taken back. */}
              {lastBump && <UndoLastChip bump={lastBump} windowSeconds={undoSeconds} onUndo={() => { void undoLast(); }} />}

              {wake === 'unsupported' && (
                <span
                  className="inline-flex items-center gap-1 text-[11px] font-sans font-medium px-2 py-0.5 rounded-full bg-accent/10 text-accent"
                  title="This browser cannot keep the screen on. Set the tablet's screen timeout to Never, or keep it charging with 'stay awake' on."
                >
                  Screen may sleep — set the tablet to never sleep
                </span>
              )}
            </div>
          </div>

          <div className="flex gap-2 flex-wrap items-center">
            {/* Station first: it changes what this whole screen means. */}
            <div className="inline-flex rounded-full border border-border overflow-hidden" role="group" aria-label="Station">
              {STATIONS.map((s) => (
                <button
                  key={s.key}
                  onClick={() => { setStation(s.key); localStorage.setItem('kitchen:station', s.key); }}
                  aria-pressed={station === s.key}
                  className={`px-3 min-h-[44px] text-sm font-sans transition-colors ${
                    station === s.key ? 'bg-foreground text-background' : 'bg-card text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {s.key === 'bar' ? <span className="inline-flex items-center gap-1"><CupSoda className="w-3.5 h-3.5" />{s.label}</span> : s.label}
                </button>
              ))}
            </div>

            {sections.length > 0 && (
              <select
                value={sectionFilter}
                onChange={(e) => { setSectionFilter(e.target.value); localStorage.setItem('kitchen:section', e.target.value); }}
                className="rounded-full border border-border bg-card px-3 text-sm font-sans min-h-[44px]"
                aria-label="Filter by section"
              >
                <option value="all">All sections</option>
                {sections.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            )}
            <Button
              variant={isPrinter ? 'default' : 'ghost'}
              size="icon"
              onClick={() => { const next = !isPrinter; setIsPrinter(next); localStorage.setItem('kitchen:isPrinter', String(next)); toast.success(next ? 'This device will auto-print new orders' : 'Auto-print off for this device'); }}
              className="rounded-full min-h-[44px] min-w-[44px]"
              aria-label="Use this device as the ticket printer"
              title="Auto-print new orders from this device"
            >
              <Printer className="w-5 h-5" />
            </Button>
            {isAdmin && (
              <Button asChild variant="ghost" size="icon" className="rounded-full min-h-[44px] min-w-[44px]" title="Printing settings">
                <Link to="/admin/printing" aria-label="Printing settings"><Settings className="w-5 h-5" /></Link>
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              onClick={async () => {
                const next = !soundEnabled;
                setSoundEnabled(next);
                if (next) { const ok = await unlockAudio(); setAudioUnlocked(ok); }
              }}
              className="rounded-full min-h-[44px] min-w-[44px]"
              aria-label={soundEnabled ? 'Mute alerts' : 'Enable alerts'}
            >
              {soundEnabled ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5 text-muted-foreground" />}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={testSound}
              className="rounded-full font-sans min-h-[44px] text-xs"
              title="Play a test tone so you know alerts will be heard"
            >
              Test sound
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleFullscreen}
              className="rounded-full min-h-[44px] min-w-[44px]"
              aria-label={isFullscreen ? 'Leave full screen' : 'Full screen'}
              title="Full screen (F)"
            >
              {isFullscreen ? <Minimize2 className="w-5 h-5" /> : <Maximize2 className="w-5 h-5" />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setShowKeys(true)}
              className="rounded-full min-h-[44px] min-w-[44px] hidden md:inline-flex"
              aria-label="Keyboard and bump bar shortcuts"
              title="Keyboard and bump bar (?)"
            >
              <Keyboard className="w-5 h-5" />
            </Button>

            <div className="inline-flex rounded-full border border-border overflow-hidden" role="group" aria-label="View">
              {([
                { key: 'active', label: 'Board' },
                { key: 'allday', label: 'All day' },
                { key: 'history', label: 'History' },
              ] as const).map((v) => (
                <button
                  key={v.key}
                  onClick={() => setView(v.key)}
                  aria-pressed={view === v.key}
                  className={`px-3 min-h-[44px] text-sm font-sans transition-colors ${
                    view === v.key ? 'bg-foreground text-background' : 'bg-card text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {v.key === 'allday' ? <span className="inline-flex items-center gap-1"><LayoutList className="w-3.5 h-3.5" />{v.label}</span> : v.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* The connection, said in a sentence when it matters. Orders are safe
          on the server either way — what this promises is how old the board
          on the screen is. */}
      {(loadError || !online) && (
        <div role="alert" className="mx-4 sm:mx-6 mt-3 rounded-xl bg-destructive text-destructive-foreground px-4 py-3 flex items-center gap-3">
          <WifiOff className="w-5 h-5 shrink-0" />
          <p className="text-sm font-sans font-semibold">
            No connection — this board was last updated {lastLoadedAt ? `at ${formatClock(new Date(lastLoadedAt))}` : 'a while ago'}.
            Retrying every 15 seconds; no order is lost, they are waiting on the server.
          </p>
        </div>
      )}

      {/* A new order is impossible to miss: a banner that flashes, a chime
          that repeats until someone says "got it" or starts cooking. */}
      <AnimatePresence>
        {fresh.length > 0 && view === 'active' && (
          <motion.div
            initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
            role="alert"
            aria-live="assertive"
            className="mx-4 sm:mx-6 mt-3 rounded-xl bg-primary text-primary-foreground px-4 py-3 flex items-center gap-3 shadow-lux-lg kds-flash"
          >
            <BellRing className="w-7 h-7 shrink-0" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="font-sans font-bold text-lg leading-tight">
                {fresh.length === 1 ? 'New order' : `${fresh.length} new orders`}
              </p>
              <p className="text-sm font-sans opacity-90 truncate">
                {fresh.map((f) => `Table ${f.table}${f.code ? ` #${f.code}` : ''}`).join(' · ')}
              </p>
            </div>
            <Button
              onClick={() => setFresh([])}
              className="min-h-[52px] px-6 rounded-xl bg-primary-foreground text-primary hover:bg-primary-foreground/90 font-sans font-bold text-base"
            >
              Got it
            </Button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Above the calls: a held order is a guest waiting for food nobody is making. */}
      <HeldOrdersCard soundEnabled={soundEnabled} className="mx-4 sm:mx-6 mt-3" onChanged={refetchOrders} />

      {/* Calls and bill requests share one strip: on a tablet two stacked
          strips pushed the first ticket below the fold. */}
      <AnimatePresence>
        {(waiterCalls.length > 0 || billRequests.length > 0) && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="border-b border-border overflow-hidden">
            <div className="px-4 sm:px-6 py-2.5 flex flex-wrap items-center gap-2">
              {waiterCalls.length > 0 && (
                <p className="text-xs font-sans font-semibold text-accent uppercase tracking-wider flex items-center gap-1.5 mr-1">
                  <Hand className="w-4 h-4" /> Waiter Calls ({waiterCalls.length})
                </p>
              )}
              {waiterCalls.map((call) => (
                <motion.div key={call.id} initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="flex items-center gap-2 pl-4 pr-1 py-1 rounded-full bg-accent/15 border border-accent/25 min-h-[52px]">
                  <span className="text-base font-sans font-bold text-accent">Table {call.table_number}</span>
                  <span className="text-sm text-accent/80 font-sans">
                    <Ago at={call.created_at} />
                    {call.status === 'acknowledged' && (
                      <> · <Going name={(call.acknowledged_by && staffNames[call.acknowledged_by]) || 'Someone'} since={call.acknowledged_at} /></>
                    )}
                  </span>
                  <button
                    onClick={() => resolveWaiterCall(call.id)}
                    disabled={clearing.has(call.id)}
                    className="w-11 h-11 rounded-full bg-accent/20 flex items-center justify-center hover:bg-accent/40 disabled:opacity-50 transition-colors"
                    aria-label="Resolve call"
                  >
                    <X className="w-5 h-5 text-accent" />
                  </button>
                </motion.div>
              ))}
              {billRequests.length > 0 && (
                <p className={`text-xs font-sans font-semibold text-primary uppercase tracking-wider flex items-center gap-1.5 mr-1 ${waiterCalls.length > 0 ? 'sm:ml-3' : ''}`}>
                  <CreditCard className="w-4 h-4" /> Bill Requests ({billRequests.length})
                </p>
              )}
              {billRequests.map((req) => (
                <motion.div key={req.id} initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="flex items-center gap-2 pl-4 pr-1 py-1 rounded-full bg-primary/15 border border-primary/25 min-h-[52px]">
                  <span className="text-base font-sans font-bold text-primary">Table {req.table_number}</span>
                  <span className="text-sm text-primary/80 font-sans">
                    <Ago at={req.created_at} />
                    {req.status === 'acknowledged' && (
                      <> · <Going name={(req.acknowledged_by && staffNames[req.acknowledged_by]) || 'Someone'} since={req.acknowledged_at} /></>
                    )}
                  </span>
                  <button
                    onClick={() => setFreeing(req)}
                    className="w-11 h-11 rounded-full bg-primary/20 flex items-center justify-center hover:bg-primary/40 transition-colors"
                    aria-label="Resolve bill request"
                  >
                    <Check className="w-5 h-5 text-primary" />
                  </button>
                </motion.div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {view === 'allday' && <AllDayPanel station={station} onChanged={fetchOrders} />}

      {view !== 'allday' && visible.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20">
          <ChefHat className="w-12 h-12 text-muted-foreground mb-4" />
          <p className="text-muted-foreground font-sans">
            {historyView ? 'Nothing served yet' : station === 'bar' ? 'No drinks waiting' : 'No orders waiting'}
          </p>
        </div>
      )}

      {view === 'history' && visible.length > 0 && (
        <div className="p-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          <AnimatePresence>{visible.map((o) => renderCard(o, true))}</AnimatePresence>
        </div>
      )}

      {view === 'active' && visible.length > 0 && (
        <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 items-start">
          {KANBAN.map((col) => {
            const colOrders = visible.filter((o) => col.statuses.includes(o.status));
            return (
              <div key={col.key} className="min-w-0">
                <div className="flex items-center gap-2 mb-3 px-1">
                  <span className={`w-2 h-2 rounded-full ${col.dot}`} />
                  <h2 className="font-serif text-sm font-bold uppercase tracking-wide text-foreground/80">{col.label}</h2>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground tabular-nums">{colOrders.length}</span>
                </div>
                <div className="space-y-3">
                  <AnimatePresence>{colOrders.map((o) => renderCard(o, false))}</AnimatePresence>
                  {colOrders.length === 0 && (
                    <div className="rounded-xl border border-dashed border-border/50 py-8 text-center text-xs text-muted-foreground/60 font-sans">
                      Empty
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={showKeys} onOpenChange={setShowKeys}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-serif">Keyboard and bump bar</DialogTitle>
            <DialogDescription>
              Set a bump bar to send these keys. The number on each ticket is its key.
            </DialogDescription>
          </DialogHeader>
          <dl className="divide-y divide-border">
            {SHORTCUTS.map((k) => (
              <div key={k.keys} className="flex items-center justify-between gap-4 py-2">
                <dt><kbd className="font-mono text-sm px-2 py-1 rounded-md bg-muted border border-border whitespace-nowrap">{k.keys}</kbd></dt>
                <dd className="text-sm font-sans text-muted-foreground text-right">{k.does}</dd>
              </div>
            ))}
          </dl>
        </DialogContent>
      </Dialog>

      <FreeTableDialog
        open={freeing !== null}
        onOpenChange={(open) => { if (!open) setFreeing(null); }}
        sessionId={freeing?.table_session_id ?? null}
        tableNumber={freeing?.table_number ?? ''}
        onFreed={() => { void fetchBillRequests(); void fetchWaiterCalls(); void fetchOrders(); }}
        extraAction={freeing ? {
          label: 'Just clear the request',
          run: () => clearBillRequestOnly(freeing),
        } : undefined}
      />

      <Dialog open={voiding !== null} onOpenChange={(open) => { if (!open) { setVoiding(null); setVoidReason(''); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-serif">
              Void order {voiding?.order_code ? `#${voiding.order_code}` : ''} — table {voiding?.table_number}
            </DialogTitle>
            <DialogDescription>
              This cancels the whole order and is recorded against you. If it has already been paid
              for, a manager still has to refund it.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={voidReason}
            onChange={(e) => setVoidReason(e.target.value)}
            placeholder="Why? e.g. guest changed their mind, item unavailable"
            className="min-h-[88px] font-sans"
            aria-label="Reason for voiding"
          />
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => { setVoiding(null); setVoidReason(''); }} className="min-h-[44px]">
              Keep order
            </Button>
            <Button
              variant="destructive"
              disabled={voidBusy || voidReason.trim().length < 3}
              onClick={confirmVoid}
              className="min-h-[44px]"
            >
              {voidBusy ? 'Voiding…' : 'Void order'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default KitchenDisplay;
