import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, ChefHat, CreditCard, CupSoda, Hand, LayoutList, Printer, Settings, Volume2, VolumeX, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { playOrderAlert, playWaiterCallAlert, playBillRequestAlert, unlockAudio, audioReady, playTestTone } from '@/lib/kitchen-sounds';
import { buildKitchenTicketText, downloadKitchenTicketCsv, downloadKitchenTicketJson, printKitchenTicket, type KitchenPrintSettings } from '@/lib/ticket-export';
import { isBluetoothConnected, tryReconnectBluetoothPrinter, printTextBluetooth, printerStatusCapable } from '@/lib/printer-connect';
import { enqueuePrint, retryPrintQueue, usePrintQueue } from '@/lib/print-queue';
import type { PrintOutcome } from '@/lib/print-outcome';
import ConnectionPill from '@/components/staff/ConnectionPill';
import KitchenOrderCard, { type KitchenOrder, type OrderItemStatus, type OrderStatus, type StationFilter } from '@/components/staff/KitchenOrderCard';
import AllDayPanel from '@/components/staff/AllDayPanel';
import { useStaffRealtime, useStaffRealtimeEvent } from '@/lib/realtime';
import { useElapsedMinutes, formatMinutes } from '@/lib/timing';
import {
  bumpOrderItem, bumpOrderItems, cancelOrder, claimTicketPrint, deviceId, reportTicketPrint,
  kitchenLoad, requeueStaleTicketPrints, requeueTicketPrint, revertOrderStatus,
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

interface WaiterCall {
  id: string;
  table_session_id: string;
  status: string;
  created_at: string;
  table_number: number;
}

interface BillRequest {
  id: string;
  table_session_id: string;
  status: string;
  created_at: string;
  table_number: number;
}

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

const KitchenDisplay = () => {
  const [orders, setOrders] = useState<KitchenOrder[]>([]);
  const [waiterCalls, setWaiterCalls] = useState<WaiterCall[]>([]);
  const [billRequests, setBillRequests] = useState<BillRequest[]>([]);
  const [view, setView] = useState<'active' | 'allday' | 'history'>('active');
  const [sectionFilter, setSectionFilter] = useState<string>('all');
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
  const [printable, setPrintable] = useState<KitchenOrder[]>([]);
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

  // Silently reconnect a previously-paired Bluetooth printer on load.
  useEffect(() => { tryReconnectBluetoothPrinter().then((n) => { if (n) setBtName(n); }); }, []);

  // Load print settings + keep them live.
  useEffect(() => {
    const load = () => supabase.from('restaurant_settings').select('*').eq('id', 1).maybeSingle()
      .then(({ data }) => {
        if (!data) return;
        setPrintConfig({ ...DEFAULT_PRINT, ...(data as Partial<PrintConfig>) });
        const undo = (data as { kitchen_undo_seconds?: number | null }).kitchen_undo_seconds;
        if (typeof undo === 'number') setUndoSeconds(undo);
      });
    load();
    const ch = supabase.channel('settings')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'restaurant_settings' }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
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
    if (!order.items.some((i) => i.station === type)) return;

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
          ? await printTextBluetooth(buildKitchenTicketText(order, settings), printConfig.print_copies)
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
   * Auto-print newly-released orders.
   *
   * The database owns the claim: claim_ticket_print() moves the ticket to
   * `claimed` atomically and tells us whether THIS device won. Two kitchen
   * screens, or one screen reloaded inside the window, cannot both print the
   * same ticket.
   */
  useEffect(() => {
    if ((!isPrinter && !isBluetoothConnected()) || !printConfig.print_enabled || !printConfig.print_auto) return;
    const now = Date.now();

    for (const order of printable) {
      if (order.status !== 'pending' || printedRef.current.has(order.id)) continue;
      // Skip the backlog on first load — only print genuinely fresh orders.
      if (now - new Date(order.created_at).getTime() > 60_000) {
        printedRef.current.add(order.id);
        continue;
      }
      printedRef.current.add(order.id);
      for (const type of ticketTypes()) printTicket(order, type);
    }
  }, [printable, isPrinter, printConfig, btName, printTicket, ticketTypes]);

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

  /** Put a ticket back in the queue and print it again, marked as a reprint. */
  const reprint = async (order: KitchenOrder) => {
    try {
      for (const type of ticketTypes()) {
        if (!order.items.some((i) => i.station === type)) continue;
        const result = await requeueTicketPrint(order.id, type);
        printedRef.current.delete(order.id);
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
    confirmed_at: (o as { confirmed_at?: string | null }).confirmed_at ?? null,
    preparing_at: (o as { preparing_at?: string | null }).preparing_at ?? null,
    ready_at: (o as { ready_at?: string | null }).ready_at ?? null,
    served_at: (o as { served_at?: string | null }).served_at ?? null,
    table_number: o.table_sessions?.tables?.table_number || 0,
    guest_name: o.guest_name || null,
    section_id: o.table_sessions?.tables?.section_id || null,
    section_name: o.table_sessions?.tables?.sections?.name || null,
    section_color: o.table_sessions?.tables?.sections?.color || null,
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
    })),
  }), []);

  /**
   * Orders eligible for auto-print, independent of the visible tab.
   *
   * Only the last few minutes: anything older was either already printed or is
   * backlog this device should not spew on a reload.
   */
  const fetchPrintable = useCallback(async () => {
    const { data } = await supabase
      .from('orders')
      .select(`
        *,
        table_sessions!inner(tables!inner(table_number, section_id, sections(name, color))),
        order_items(*, menu_items(name, allergens))
      `)
      .eq('status', 'pending')
      .gte('created_at', new Date(Date.now() - 5 * 60 * 1000).toISOString())
      .order('created_at', { ascending: false })
      .limit(50);

    setPrintable(((data || []) as KitchenOrderRow[]).map(mapOrderRow));
  }, [mapOrderRow]);

  const historyView = view === 'history';

  const fetchOrders = useCallback(async () => {
    const { data: ordersData, error } = await supabase
      .from('orders')
      .select(`
        *,
        table_sessions!inner(
          tables!inner(table_number, section_id, sections(name, color))
        ),
        order_items(
          *,
          menu_items(name, allergens)
        )
      `)
      .in('status', historyView ? ['served', 'cancelled'] : ['pending', 'confirmed', 'preparing', 'ready'])
      // Bound by AGE, not by row count. The previous `.limit(50)` combined with
      // a descending sort silently dropped the OLDEST open orders — which are
      // precisely the late ones the kitchen most needs to see. An age bound
      // cannot hide a live ticket; at worst it hides a stale one.
      .gte('created_at', new Date(Date.now() - ACTIVE_WINDOW_MS).toISOString())
      .order('created_at', { ascending: false })
      .limit(HARD_ROW_CAP);

    if (error) {
      console.error('Error fetching orders:', error);
      setLoadError(true);
      return;
    }
    setLoadError(false);

    const mapped = ((ordersData || []) as KitchenOrderRow[]).map(mapOrderRow);

    setOrders(mapped);
    setTruncated(mapped.length >= HARD_ROW_CAP);
  }, [historyView, mapOrderRow]);

  const fetchWaiterCalls = useCallback(async () => {
    const { data, error } = await supabase
      .from('waiter_calls')
      .select(`*, table_sessions!inner(tables!inner(table_number))`)
      .eq('status', 'pending')
      // Oldest first: the longest-waiting guest is the one to deal with next.
      .order('created_at', { ascending: true });

    if (error) { console.error('Error fetching waiter calls:', error); return; }

    setWaiterCalls(((data || []) as WaiterCallQueryRow[]).map((c) => ({
      id: c.id,
      table_session_id: c.table_session_id,
      status: c.status,
      created_at: c.created_at,
      table_number: c.table_sessions?.tables?.table_number || 0,
    })));
  }, []);

  const fetchBillRequests = useCallback(async () => {
    const { data, error } = await supabase
      .from('bill_requests')
      .select(`*, table_sessions!inner(tables!inner(table_number))`)
      .eq('status', 'pending')
      .order('created_at', { ascending: true });

    if (error) { console.error('Error fetching bill requests:', error); return; }

    setBillRequests(((data || []) as BillRequestQueryRow[]).map((b) => ({
      id: b.id,
      table_session_id: b.table_session_id,
      status: b.status,
      created_at: b.created_at,
      table_number: b.table_sessions?.tables?.table_number || 0,
    })));
  }, []);

  useEffect(() => {
    supabase.from('sections').select('id, name, color').order('sort_order').then(({ data }) => {
      setSections(data || []);
    });

    void kitchenLoad().then(setLoad).catch(() => {});

    Promise.all([fetchOrders(), fetchPrintable(), fetchWaiterCalls(), fetchBillRequests()]).then(() => {
      initialLoadDone.current = true;
    });

    // Data lives here; the shared realtime module decides WHEN to refetch.
    // It coalesces bursts, invalidates only what changed, keeps one channel
    // per tab, and polls whenever the socket is not subscribed.
  }, [fetchOrders, fetchPrintable, fetchWaiterCalls, fetchBillRequests]);

  /**
   * Refetch on live events.
   *
   * Split from the sound effect below on purpose: alerts must not wait on a
   * refetch, and a refetch must not depend on whether sound is on.
   */
  useStaffRealtimeEvent(
    useCallback((table: string) => {
      if (table === 'orders' || table === 'order_items') {
        void fetchOrders(); void fetchPrintable();
        void kitchenLoad().then(setLoad).catch(() => {});
      }
      if (table === 'waiter_calls') void fetchWaiterCalls();
      if (table === 'bill_requests') void fetchBillRequests();
    }, [fetchOrders, fetchPrintable, fetchWaiterCalls, fetchBillRequests]),
  );

  /** Alerts, fired straight off the event so they are never held up by data. */
  useStaffRealtimeEvent(
    useCallback((table: string, eventType: string) => {
      if (!initialLoadDone.current || !soundEnabledRef.current || eventType !== 'INSERT') return;
      if (table === 'orders') playOrderAlert();
      else if (table === 'waiter_calls') playWaiterCallAlert();
      else if (table === 'bill_requests') playBillRequestAlert();
    }, []),
  );

  /* ---- Actions -------------------------------------------------------- */

  const bumpItem = useCallback(async (itemId: string, status: OrderItemStatus) => {
    try {
      await bumpOrderItem(itemId, status);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not update that line');
    }
    await fetchOrders();
  }, [fetchOrders]);

  const bumpMany = useCallback(async (itemIds: string[], status: OrderItemStatus) => {
    try {
      const result = await bumpOrderItems(itemIds, status);
      if (result.failed > 0) toast.warning(`${result.updated} updated, ${result.failed} could not be`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not update those lines');
    }
    await fetchOrders();
  }, [fetchOrders]);

  const advanceOrder = useCallback(async (orderId: string, status: OrderStatus) => {
    try {
      // Goes through the state machine: an illegal move is rejected by the
      // database rather than silently corrupting the board.
      await rpcUpdateOrderStatus(orderId, status);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to update order status');
    }
    await fetchOrders();
  }, [fetchOrders]);

  const revertOrder = useCallback(async (orderId: string, status: OrderStatus) => {
    try {
      await revertOrderStatus(orderId, status, 'kitchen undo');
      toast.success(`Back to ${status}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not undo');
    }
    await fetchOrders();
  }, [fetchOrders]);

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

  const resolveWaiterCall = async (callId: string) => {
    const { error } = await supabase.from('waiter_calls').update({ status: 'resolved', resolved_at: new Date().toISOString() }).eq('id', callId);
    if (error) toast.error('Failed to resolve call');
    else { toast.success('Waiter call resolved'); fetchWaiterCalls(); }
  };

  const resolveBillRequest = async (request: BillRequest) => {
    const { error } = await supabase.from('bill_requests').update({ status: 'resolved', resolved_at: new Date().toISOString() }).eq('id', request.id);
    if (error) { toast.error('Failed to resolve bill request'); return; }

    // Auto-close the table session
    await supabase
      .from('table_sessions')
      .update({ is_active: false, closed_at: new Date().toISOString() })
      .eq('id', request.table_session_id);

    toast.success('Bill resolved & table freed');
    fetchBillRequests();
    fetchOrders();
  };

  /**
   * What this screen is responsible for.
   *
   * An order with nothing for this station is not "empty", it is not this
   * screen's problem — showing it would invite the barman to bump food.
   */
  const visible = useMemo(() => orders
    .filter((o) => sectionFilter === 'all' || o.section_id === sectionFilter)
    .filter((o) => station === 'all' || o.items.some((i) => i.station === station)),
  [orders, sectionFilter, station]);

  const renderCard = (order: KitchenOrder, showStatus: boolean) => (
    <KitchenOrderCard
      key={order.id}
      order={order}
      station={station}
      undoSeconds={undoSeconds}
      showStatus={showStatus}
      failedPrint={failedPrints.includes(order.id)}
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

              {loadError && (
                <span className="inline-flex items-center gap-1 text-[11px] font-sans font-medium px-2 py-0.5 rounded-full bg-destructive/10 text-destructive">
                  Could not load orders — this board may be out of date
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
                onChange={(e) => setSectionFilter(e.target.value)}
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
            <Button asChild variant="ghost" size="icon" className="rounded-full min-h-[44px] min-w-[44px]" title="Printing settings">
              <Link to="/admin/printing" aria-label="Printing settings"><Settings className="w-5 h-5" /></Link>
            </Button>
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

      <AnimatePresence>
        {waiterCalls.length > 0 && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="bg-accent/10 border-b border-accent/20 overflow-hidden">
            <div className="px-6 py-3 space-y-2">
              <p className="text-xs font-sans font-semibold text-accent uppercase tracking-wider flex items-center gap-2">
                <Hand className="w-4 h-4" /> Waiter Calls ({waiterCalls.length})
              </p>
              <div className="flex flex-wrap gap-2">
                {waiterCalls.map((call) => (
                  <motion.div key={call.id} initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="flex items-center gap-2 px-3 py-2 rounded-full bg-accent/15 border border-accent/25 min-h-[44px]">
                    <span className="text-sm font-sans font-semibold text-accent">Table {call.table_number}</span>
                    <span className="text-xs text-accent/70 font-sans"><Ago at={call.created_at} /></span>
                    <button onClick={() => resolveWaiterCall(call.id)} className="w-6 h-6 rounded-full bg-accent/20 flex items-center justify-center hover:bg-accent/40 transition-colors" aria-label="Resolve call">
                      <X className="w-3 h-3 text-accent" />
                    </button>
                  </motion.div>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {billRequests.length > 0 && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="bg-primary/10 border-b border-primary/20 overflow-hidden">
            <div className="px-6 py-3 space-y-2">
              <p className="text-xs font-sans font-semibold text-primary uppercase tracking-wider flex items-center gap-2">
                <CreditCard className="w-4 h-4" /> Bill Requests ({billRequests.length})
              </p>
              <div className="flex flex-wrap gap-2">
                {billRequests.map((req) => (
                  <motion.div key={req.id} initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="flex items-center gap-2 px-3 py-2 rounded-full bg-primary/15 border border-primary/25 min-h-[44px]">
                    <span className="text-sm font-sans font-semibold text-primary">Table {req.table_number}</span>
                    <span className="text-xs text-primary/70 font-sans"><Ago at={req.created_at} /></span>
                    <button onClick={() => resolveBillRequest(req)} className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center hover:bg-primary/40 transition-colors" aria-label="Resolve bill request">
                      <Check className="w-3 h-3 text-primary" />
                    </button>
                  </motion.div>
                ))}
              </div>
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
