import React, { useMemo, useState } from 'react';
import { motion, useReducedMotion, type Variants } from 'framer-motion';
import {
  Ban, Check, ChefHat, CupSoda, FileJson, FileText, MoreHorizontal, Printer, RotateCcw, TriangleAlert, Utensils,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import PaymentBadge from '@/components/PaymentBadge';
import { useNow } from '@/lib/clock';
import { formatMinutes, orderUrgency, urgencyMark, formatClock } from '@/lib/timing';
import { kitchenStart, orderStatusLabel } from '@/components/staff/order-status';
import { stationParts, stationsInvolved, type StationPart } from '@/lib/station-lines';
import { TONE, orderTone, type StaffTone } from '@/components/staff/status-tone';
import { ARRIVE_FROM, ARRIVED, staffEnter, staffExit, staffMove } from '@/components/staff/staff-motion';
import { ArrivalGlow } from '@/components/staff/StaffMotion';
import type { Database } from '@/integrations/supabase/types';

export type OrderStatus = Database['public']['Enums']['order_status'];
export type OrderItemStatus = Database['public']['Enums']['order_item_status'];
export type StationFilter = 'all' | 'kitchen' | 'bar';

export interface KitchenItem {
  id: string;
  quantity: number;
  unit_price: number;
  notes: string | null;
  status: OrderItemStatus;
  station: string;
  started_at: string | null;
  ready_at: string | null;
  menu_item_name: string;
  allergens: string[] | null;
  /**
   * Combo parts (order_items.components); absent on older rows. `allergens`
   * is the part's own, looked up by the board — not stored on the order.
   */
  components?: {
    slot_label?: string | null; item_id?: string | null; name: string; station?: string | null; allergens?: string[] | null;
  }[] | null;
}

export interface KitchenOrder {
  id: string;
  order_code: string | null;
  status: OrderStatus;
  total: number;
  tip_amount: number | null;
  payment_method: string | null;
  payment_status: string | null;
  notes: string | null;
  created_at: string;
  /**
   * When the kitchen was actually given this order.
   *
   * For a cash order it is the moment it was placed; for a card order it is
   * when the payment cleared, which can be minutes later. Everything the
   * kitchen measures — ticket age, "is this new", auto-print — starts here, or
   * a card order arrives on the board already looking late and never prints.
   */
  released_to_kitchen_at: string | null;
  confirmed_at: string | null;
  preparing_at: string | null;
  ready_at: string | null;
  served_at: string | null;
  table_number: number;
  guest_name: string | null;
  section_id: string | null;
  section_name: string | null;
  section_color: string | null;
  /** Who has the table, for the ticket. */
  waiter_name?: string | null;
  items: KitchenItem[];
}

/** One station's ticket, as the database last saw it. */
export interface PrintStateLine {
  type: 'kitchen' | 'bar';
  tone: 'ok' | 'busy' | 'bad' | 'idle';
  label: string;
}

/**
 * Forward and backward moves for a single line.
 *
 * `served` is deliberately absent from both: a runner carries the whole tray,
 * so per-item served is bookkeeping nobody would do. It is set once, at order
 * level, by whoever puts the plates down.
 */
const ITEM_NEXT: Record<OrderItemStatus, OrderItemStatus | null> = {
  pending: 'preparing', preparing: 'ready', ready: null, served: null,
};
const ITEM_PREV: Record<OrderItemStatus, OrderItemStatus | null> = {
  pending: null, preparing: 'pending', ready: 'preparing', served: null,
};
const ITEM_ACTION: Record<OrderItemStatus, string> = {
  pending: 'Start', preparing: 'Ready', ready: 'Up', served: 'Served',
};

/** Where a combo is, said from the station that is waiting on it. */
const PART_PROGRESS: Record<OrderItemStatus, string> = {
  pending: 'not started', preparing: 'in prep', ready: 'up', served: 'served',
};
const stationWord = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : 'Kitchen');

/** A line's state, in the shared colours: untouched lines stay plain. */
const ITEM_TONE: Partial<Record<OrderItemStatus, StaffTone>> = { preparing: 'preparing', ready: 'ready' };
const lineSurface = (status: OrderItemStatus) => {
  const tone = ITEM_TONE[status];
  return tone === 'preparing' ? 'bg-[hsl(38_90%_50%/0.08)]'
    : tone === 'ready' ? 'bg-[hsl(150_46%_36%/0.07)]'
      : 'bg-muted/45';
};

/**
 * A cook's note ("no onion"): what gets a dish sent back. Warm and bold, with
 * a mark, but tinted rather than a solid slab so it does not drown the dish.
 */
function NoteChip({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-1 flex w-fit max-w-full items-start gap-1.5 rounded-md bg-[hsl(42_96%_56%/0.22)] px-2 py-0.5 text-sm md:text-base font-sans font-semibold leading-snug text-[hsl(30_70%_20%)]">
      <TriangleAlert className="mt-[3px] h-3.5 w-3.5 md:h-4 md:w-4 shrink-0" aria-hidden />
      <span className="min-w-0">{children}</span>
    </p>
  );
}

/**
 * Allergens: unmistakable, not shouting. They were solid red slabs in capitals,
 * the loudest thing on the board, so the dish name under them read second.
 * Now: the red of "late", outlined and tinted, with a warning mark and the
 * word "Allergens" — still the first thing a cook's eye catches on a line.
 */
function AllergenChip({ allergens }: { allergens: string[] }) {
  return (
    <p className="mt-1 flex w-fit max-w-full items-start gap-1.5 rounded-md border border-[hsl(0_72%_50%/0.45)] bg-[hsl(0_72%_50%/0.06)] px-1.5 py-0.5 text-xs md:text-sm lg:text-[13px] xl:text-sm font-sans leading-snug text-[hsl(0_72%_38%)]">
      <TriangleAlert className="mt-[2px] h-3.5 w-3.5 shrink-0" aria-hidden />
      <span className="min-w-0"><span className="font-bold">Allergens:</span> <span className="font-semibold">{allergens.join(', ')}</span></span>
    </p>
  );
}

/**
 * A combo part made here, under a combo line made at another station: the
 * lemonade of a burger combo, on the bar's board.
 *
 * Read-only on purpose. It has no status of its own — it moves with its combo
 * line — so a Start or Ready here would start or ready the whole combo,
 * burger and all, from the bar. What the barman gets instead is where the
 * combo is, so the drink goes out with the food.
 */
function PartLine({ part }: { part: StationPart<OrderItemStatus> }) {
  return (
    <div
      data-testid="combo-part-line"
      className={`flex items-center gap-2 rounded-lg px-2.5 py-2 min-h-[52px] border border-dashed border-border transition-colors duration-300 ${lineSurface(part.status)}`}
    >
      <div className="flex-1 min-w-0">
        <p className={`text-[17px] md:text-xl font-sans font-medium leading-snug ${part.status === 'ready' ? 'text-muted-foreground' : 'text-foreground'}`}>
          <span className="tabular-nums font-bold">{part.quantity}×</span> {part.name}
          <span className="text-sm md:text-base font-normal text-muted-foreground"> · part of {part.partOf}</span>
        </p>
        {part.notes && <NoteChip>{part.notes}</NoteChip>}
        {part.allergens && part.allergens.length > 0 && <AllergenChip allergens={part.allergens} />}
      </div>
      <span
        className="text-xs md:text-sm font-sans text-muted-foreground text-right px-2 shrink-0 max-w-[96px] leading-tight"
        title={`Moves with the ${part.partOf} — the ${part.lineStation} starts, readies and serves it`}
      >
        {stationWord(part.lineStation)}: {PART_PROGRESS[part.status] ?? part.status}
      </span>
    </div>
  );
}


/** The stamp for the stage an order is currently in — what per-stage aging measures from. */
function stageStart(order: KitchenOrder): string {
  const start = kitchenStart(order);
  switch (order.status) {
    case 'confirmed': return order.confirmed_at ?? start;
    case 'preparing': return order.preparing_at ?? start;
    case 'ready': return order.ready_at ?? start;
    case 'served': return order.served_at ?? start;
    default: return start;
  }
}

const STAGE_LABEL: Partial<Record<OrderStatus, string>> = {
  pending: 'waiting', confirmed: 'accepted', preparing: 'in prep', ready: 'up', served: 'served',
};

/**
 * Undo, with the time left on it.
 *
 * The window is enforced by the database, not here — this only stops offering a
 * button that is about to be refused. Showing the countdown matters: a cook who
 * can see "22s" knows whether to fix it themselves or call a manager, instead
 * of tapping a button that fails and learning nothing.
 */
function UndoButton({
  since, windowSeconds, onUndo, label, className = '',
}: {
  since: string | null;
  windowSeconds: number;
  onUndo: () => void;
  label: string;
  className?: string;
}) {
  const now = useNow();
  const [busy, setBusy] = useState(false);
  if (!since || windowSeconds <= 0) return null;

  const remaining = Math.ceil((new Date(since).getTime() + windowSeconds * 1000 - now) / 1000);
  if (remaining <= 0) return null;

  return (
    <button
      type="button"
      disabled={busy}
      onClick={(e) => { e.stopPropagation(); setBusy(true); onUndo(); }}
      className={`inline-flex items-center gap-1 rounded-full border border-border bg-card px-2.5 min-h-[44px] text-xs font-sans text-muted-foreground hover:text-foreground hover:border-foreground/30 disabled:opacity-50 transition-colors ${className}`}
      aria-label={`${label} — ${remaining} seconds left`}
    >
      <RotateCcw className="w-3 h-3" />
      {label}
      <span className="tabular-nums opacity-70">{remaining}s</span>
    </button>
  );
}

interface Props {
  order: KitchenOrder;
  station: StationFilter;
  undoSeconds: number;
  showStatus: boolean;
  failedPrint: boolean;
  /** What the database says happened to this order's tickets. */
  printStates?: PrintStateLine[];
  /** Arrived in the last minutes and nobody has started it: flagged NEW. */
  isNew?: boolean;
  /** Picked with the keyboard or bump bar. */
  selected?: boolean;
  /** Position on the board, 1-based, for the bump-bar digit keys. */
  slot?: number;
  /** Changes when the board points at this ticket ("Show"): it glows again. */
  spotlight?: number;
  onBumpItem: (itemId: string, status: OrderItemStatus) => Promise<void>;
  onBumpMany: (itemIds: string[], status: OrderItemStatus) => Promise<void>;
  onAdvanceOrder: (orderId: string, status: OrderStatus) => Promise<void>;
  onRevertOrder: (orderId: string, status: OrderStatus) => Promise<void>;
  onCancel: (order: KitchenOrder) => void;
  onPrint: (order: KitchenOrder) => void;
  onExport: (order: KitchenOrder, format: 'json' | 'csv') => void;
}

/*
 * Takes a ref so the board's AnimatePresence can lift a leaving ticket out of
 * the column at once (mode="popLayout"): the tickets under it close up while
 * it fades or flies, instead of after.
 */
const KitchenOrderCard = React.forwardRef<HTMLDivElement, Props>(({
  order, station, undoSeconds, showStatus, failedPrint, printStates = [], isNew = false, selected = false, slot, spotlight,
  onBumpItem, onBumpMany, onAdvanceOrder, onRevertOrder, onCancel, onPrint, onExport,
}, ref) => {
  const now = useNow();
  /**
   * Which taps are in flight.
   *
   * Without this a cook watching a slow tablet taps twice, and because the
   * second tap is computed from a state that has not refreshed yet, it can send
   * a *different* target than the first. Disabling in flight is what makes
   * "state the target, never next" actually hold end to end.
   */
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const mark = (key: string, on: boolean) =>
    setBusy((prev) => {
      const next = new Set(prev);
      if (on) next.add(key); else next.delete(key);
      return next;
    });

  const run = async (key: string, fn: () => Promise<void>) => {
    if (busy.has(key)) return;
    mark(key, true);
    try { await fn(); } finally { mark(key, false); }
  };

  const reduced = useReducedMotion();
  /**
   * Whether this card is a ticket that has just come in, decided once when it
   * appears: it drops in and glows. The same ticket reappearing in another
   * column (it was started) is a move, not an arrival.
   */
  const [arriving] = useState(() => isNew && !showStatus && !reduced
    && (order.status === 'pending' || order.status === 'confirmed'));
  /**
   * Leaving the board (served, voided) fades and shrinks a touch. Leaving this
   * column for another is instant: the copy in the new column flies from here.
   * The board passes the ids still on it through AnimatePresence's `custom`.
   */
  const leaveVariants = useMemo<Variants>(() => ({
    // Never tappable on the way out: lifted out of the column, it lies over
    // the ticket that slid up into its place.
    leave: (onBoard?: Set<string>) => (onBoard?.has(order.id) || reduced
      ? { opacity: 0, pointerEvents: 'none', transition: { duration: 0 } }
      : { opacity: 0, scale: 0.97, pointerEvents: 'none', transition: staffExit }),
  }), [order.id, reduced]);

  /**
   * Only the lines this station is responsible for.
   *
   * A bar screen showing the steak is not merely noise — it invites the barman
   * to bump food he cannot see.
   */
  const items = useMemo(
    () => (station === 'all' ? order.items : order.items.filter((i) => i.station === station)),
    [order.items, station],
  );
  /** Combo parts made here under a combo line made elsewhere: shown, never bumped. */
  const parts = useMemo(() => stationParts(order.items, station), [order.items, station]);
  const involved = useMemo(() => stationsInvolved(order.items), [order.items]);

  const ageMs = Math.max(0, now - new Date(kitchenStart(order)).getTime());
  const urgency = order.status === 'ready' || order.status === 'served' || order.status === 'cancelled'
    ? 'fresh'
    : orderUrgency(ageMs);
  const stageMs = Math.max(0, now - new Date(stageStart(order)).getTime());

  const pending = items.filter((i) => i.status === 'pending');
  const working = items.filter((i) => i.status === 'preparing');
  const notReady = items.filter((i) => i.status === 'pending' || i.status === 'preparing');
  // A combo's drink counts: the runner needs to know a drink is coming too.
  const hasBar = involved.has('bar');
  const hasKitchen = involved.has('kitchen');
  /**
   * Whether this screen moves the order itself. A bar screen showing an order
   * only for a combo's drink does not: ready and served stay with the kitchen.
   */
  const ownsOrder = station === 'all' || items.length > 0;

  /** Which stamp, if any, the order-level undo is timed against. */
  const revertFrom: { to: OrderStatus; since: string | null } | null =
    order.status === 'served' ? { to: 'ready', since: order.served_at }
      : order.status === 'ready' ? { to: 'preparing', since: order.ready_at }
        : null;

  const late = urgency === 'late' || urgency === 'critical';
  const statusTone = orderTone(order.status);

  return (
    <motion.div
      ref={ref}
      /*
       * On the board a ticket keeps one identity across columns, so starting
       * or readying it carries the card to its new column instead of making it
       * vanish here and pop up there. Position only: a card that changes
       * height is not stretched on the way.
       */
      layout="position"
      layoutId={showStatus ? undefined : `ticket-${order.id}`}
      layoutCrossfade={false}
      // A ticket that just arrived drops in; one that moved columns, or was
      // already on the board, is simply where it belongs.
      initial={arriving ? ARRIVE_FROM : false}
      animate={ARRIVED}
      exit="leave"
      variants={leaveVariants}
      transition={reduced ? { duration: 0 } : { ...staffEnter, layout: staffMove }}
      id={`ticket-${order.id}`}
      data-selected={selected || undefined}
      className={`relative rounded-2xl border bg-card shadow-lux scroll-mt-28 ${
        urgency === 'critical' ? 'border-destructive/60 breathe breathe-urgent'
          : late ? 'border-destructive/50'
            : urgency === 'attention' ? 'border-[hsl(38_90%_45%/0.5)]'
              : isNew ? TONE.new.border : 'border-border'
      } ${/* An outline, not a ring: .shadow-lux and the breathing glow both
             own box-shadow, and a ring drawn with it simply vanished. */
        selected ? 'outline outline-4 outline-offset-2 outline-foreground' : ''}`}
    >
      {(arriving || spotlight) && <ArrivalGlow key={spotlight ?? 'arrived'} tone="new" />}
      {/* Age as a colour band across the top, readable from across the
          kitchen: none while fresh, amber when getting on, red when late. */}
      {urgency !== 'fresh' && (
        <div aria-hidden className={`h-1.5 rounded-t-[15px] ${urgency === 'attention' ? TONE.preparing.bar : TONE.late.bar}`} />
      )}
      <div className="px-4 pt-3 pb-2.5 border-b border-border/70">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2 flex-wrap min-w-0">
            {slot != null && slot <= 9 && (
              <span
                className={`inline-flex items-center justify-center w-6 h-6 rounded-md text-xs font-sans font-bold tabular-nums transition-colors ${selected ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground'}`}
                title={`Press ${slot} to pick this ticket`}
                aria-hidden
              >
                {slot}
              </span>
            )}
            {/* Read from across a kitchen, not from arm's length: the table
                number is the one thing a runner must get right first time. */}
            <span className="font-serif text-2xl md:text-[32px] md:leading-9 font-bold tracking-tight text-foreground">Table {order.table_number}</span>
            {isNew && (
              <span className={`text-[11px] font-sans font-bold uppercase tracking-[0.08em] px-2 py-0.5 rounded-full ${TONE.new.solid}`}>New</span>
            )}
            {showStatus && statusTone && (
              <span className={`inline-flex items-center gap-1.5 text-xs font-sans font-semibold px-2 py-0.5 rounded-full ${TONE[statusTone].chip}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${TONE[statusTone].dot}`} aria-hidden />
                {orderStatusLabel(order.status)}
              </span>
            )}
          </div>

          {/* Urgency is spelled out, not only coloured — colour alone fails for
              colour-blind staff and for anyone glancing across a room. In
              History the age is nobody's wait any more: no big number there
              (the line under the table says when it was served). */}
          {!showStatus && (
            <span className={`shrink-0 text-lg md:text-2xl font-sans font-semibold tabular-nums inline-flex items-center justify-end gap-1 leading-none ${
              late
                ? `${TONE.late.solid} rounded-lg px-2 py-1`
                : urgency === 'attention' ? `${TONE.preparing.text} py-1` : 'text-foreground/70 py-1'
            }`}>
              {urgencyMark(urgency) && <span aria-hidden>{urgencyMark(urgency)}</span>}
              {/* "0m" read like a stopped clock on a ticket that just came in. */}
              {ageMs < 60_000 ? 'now' : formatMinutes(ageMs)}
              {urgency !== 'fresh' && <span className="sr-only"> — {urgency}</span>}
            </span>
          )}
        </div>

        {/* Everything else about the ticket, one quiet line under the table:
            useful, never competing with the dishes. */}
        <div className="mt-1 flex items-start justify-between gap-3 text-xs md:text-[13px] font-sans text-muted-foreground">
          <div className="flex items-center gap-x-2.5 gap-y-0.5 flex-wrap min-w-0">
            {order.section_name && (
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: order.section_color || undefined }} aria-hidden />
                {order.section_name}
              </span>
            )}
            {order.order_code && (
              <span className="font-semibold tabular-nums tracking-wide text-foreground/70">#{order.order_code}</span>
            )}
            {order.guest_name && <span className="truncate">{order.guest_name}</span>}
            {/* Which stations are involved — a food runner needs to know a drink is coming too. */}
            {station === 'all' && hasBar && hasKitchen && (
              <span className="inline-flex items-center gap-1">
                <CupSoda className="w-3 h-3" aria-hidden /> + bar
              </span>
            )}
            <PaymentBadge method={order.payment_method} status={order.payment_status} className="bg-transparent px-0 py-0 text-xs md:text-[13px]" />
          </div>
          <span className="shrink-0 tabular-nums">
            {STAGE_LABEL[order.status] ?? orderStatusLabel(order.status)} {formatMinutes(stageMs)} · {formatClock(kitchenStart(order))}
          </span>
        </div>
      </div>

      <div className="px-2 py-2 space-y-1">
        {items.map((item) => {
          const next = ITEM_NEXT[item.status];
          const prev = ITEM_PREV[item.status];
          const undoSince = item.status === 'ready' ? item.ready_at : item.status === 'preparing' ? item.started_at : null;
          const inFlight = busy.has(item.id);

          return (
            <div
              key={item.id}
              data-line-status={item.status}
              className={`flex items-center gap-2 rounded-xl pl-2.5 pr-1.5 py-1.5 min-h-[56px] transition-colors duration-300 ${lineSurface(item.status)}`}
            >
              {/*
                Text, not a button. The whole row used to bump the line, so a
                cook scrolling the board or steadying the tablet with a thumb
                marked dishes as started or ready without meaning to — and the
                note they were reading was exactly where they touched. Only the
                labelled button on the right moves a line now.
              */}
              <div className="flex-1 min-w-0">
                {/* The dish is the ticket: largest type on the card after the
                    table, the quantity bold in front where a cook counts. */}
                {/* 19px on a 1024 board (three narrow columns), 21px where there is room:
                    at 21px every second dish broke onto two lines there. */}
                <p className={`text-[17px] md:text-[21px] lg:text-[19px] xl:text-[21px] font-sans font-medium leading-snug tracking-[-0.01em] transition-colors duration-300 ${item.status === 'ready' ? 'text-muted-foreground' : 'text-foreground'}`}>
                  {/* More than one is the count most often missed: it gets a tint. */}
                  <span className={`tabular-nums font-bold ${item.quantity > 1 ? 'rounded-md bg-foreground/[0.08] px-1 -ml-0.5' : ''}`}>{item.quantity}×</span> {item.menu_item_name}
                  {station === 'all' && item.station === 'bar' && (
                    <CupSoda className="inline w-4 h-4 ml-1 -mt-0.5 text-muted-foreground" aria-label="bar" />
                  )}
                </p>
                {item.components && item.components.length > 0 && (
                  <ul className="mt-0.5 space-y-0.5">
                    {item.components.map((part, i) => (
                      <li key={`${part.item_id ?? part.name}-${i}`} className="text-sm md:text-base font-sans text-foreground/80 leading-snug">
                        <span aria-hidden>+ </span>
                        {part.slot_label ? <span className="text-muted-foreground">{part.slot_label}: </span> : null}
                        <span className="font-semibold">{part.name}</span>
                        {part.station && part.station !== item.station && (
                          <span className="ml-1 text-[10px] uppercase px-1 py-0.5 rounded bg-muted text-muted-foreground align-middle">{part.station}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                {/* Notes and allergens are what get a dish sent back or a guest
                    hurt. Small italic grey was the least legible text on the
                    card; they are marked, coloured and bold now — under the
                    dish, not louder than it. */}
                {item.notes && <NoteChip>{item.notes}</NoteChip>}
                {item.allergens && item.allergens.length > 0 && <AllergenChip allergens={item.allergens} />}
              </div>

              {prev && (
                <UndoButton
                  since={undoSince}
                  windowSeconds={undoSeconds}
                  label="Undo"
                  onUndo={() => { void run(`${item.id}:undo`, () => onBumpItem(item.id, prev)); }}
                />
              )}

              {next ? (
                <Button
                  size="sm"
                  variant={item.status === 'preparing' ? 'default' : 'outline'}
                  disabled={inFlight}
                  onClick={() => run(item.id, () => onBumpItem(item.id, next))}
                  aria-label={`Mark ${item.menu_item_name} as ${next}`}
                  // "Ready" is the colour the line turns when tapped.
                  className={`min-h-[48px] md:min-h-[56px] min-w-[80px] md:min-w-[96px] rounded-[10px] text-sm md:text-base font-sans font-semibold shrink-0 active:scale-95 transition-[transform,background-color] ${
                    item.status === 'preparing' ? `${TONE.ready.solid} hover:bg-[hsl(150_46%_28%)]` : 'bg-card'
                  }`}
                >
                  {ITEM_ACTION[item.status]}
                </Button>
              ) : (
                <motion.span
                  initial={reduced ? false : { opacity: 0, scale: 0.7 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={staffEnter}
                  className={`inline-flex items-center gap-1 text-sm md:text-base font-sans font-semibold px-2 shrink-0 ${TONE.ready.text}`}
                >
                  <Check className="w-4 h-4" strokeWidth={2.5} /> Up
                </motion.span>
              )}
            </div>
          );
        })}

        {parts.map((part) => <PartLine key={part.key} part={part} />)}

        {items.length === 0 && parts.length === 0 && (
          <p className="px-2 py-3 text-sm text-muted-foreground font-sans">Nothing for this station.</p>
        )}
      </div>

      {order.notes && (
        <div className="px-3 pb-2">
          <p className="rounded-lg bg-[hsl(42_96%_56%/0.22)] text-[hsl(30_70%_20%)] font-sans font-semibold text-sm md:text-base px-2.5 py-1.5">
            Note: {order.notes}
          </p>
        </div>
      )}

      {(failedPrint || printStates.some((p) => p.tone === 'bad')) ? (
        <div role="alert" className="mx-3 mb-2 px-3 py-2 rounded-lg bg-destructive text-destructive-foreground">
          <p className="text-sm font-sans font-semibold">
            {printStates.find((p) => p.tone === 'bad')?.label ?? 'This ticket did not print'} — tap Reprint
          </p>
        </div>
      ) : printStates.length > 0 && (
        <p className="px-4 pb-1.5 text-[11px] md:text-xs font-sans text-muted-foreground/80 flex flex-wrap gap-x-3" aria-label="Print status">
          {printStates.map((p) => (
            <span key={p.type} className={p.tone === 'busy' ? TONE.preparing.text : undefined}>
              <Printer className="inline w-3 h-3 -mt-0.5 mr-1" aria-hidden />
              {printStates.length > 1 ? `${p.type === 'bar' ? 'Bar' : 'Kitchen'}: ` : ''}{p.label}
            </span>
          ))}
        </p>
      )}

      <div className="px-3 pb-3 space-y-1.5">
        <div className="flex flex-wrap gap-2">
          {pending.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              disabled={busy.has('start-all')}
              onClick={() => run('start-all', () => onBumpMany(pending.map((i) => i.id), 'preparing'))}
              className="min-h-[48px] md:min-h-[56px] rounded-[10px] bg-card text-sm md:text-base font-sans font-semibold gap-1.5"
            >
              <ChefHat className="w-4 h-4" /> Start all ({pending.length})
            </Button>
          )}
          {notReady.length > 0 && (
            <Button
              size="sm"
              disabled={busy.has('all-ready')}
              onClick={() => run('all-ready', () => onBumpMany(notReady.map((i) => i.id), 'ready'))}
              className={`min-h-[48px] md:min-h-[56px] flex-1 min-w-[140px] rounded-[10px] ${TONE.ready.solid} hover:bg-[hsl(150_46%_28%)] text-sm md:text-base font-sans font-semibold active:scale-95 transition-transform`}
            >
              All ready ({notReady.length})
            </Button>
          )}
          {ownsOrder && notReady.length === 0 && order.status === 'ready' && (
            <Button
              size="sm"
              disabled={busy.has('served')}
              onClick={() => run('served', () => onAdvanceOrder(order.id, 'served'))}
              className={`min-h-[48px] md:min-h-[56px] flex-1 min-w-[140px] rounded-[10px] ${TONE.ready.solid} hover:bg-[hsl(150_46%_28%)] text-sm md:text-base font-sans font-semibold active:scale-95 transition-transform`}
            >
              <Utensils className="w-4 h-4 mr-1.5" /> Mark served
            </Button>
          )}
          {working.length > 0 && pending.length === 0 && notReady.length === working.length && (
            <span className="sr-only">All lines are in preparation</span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" size="sm" className="min-h-[44px] rounded-lg gap-1.5 text-sm" onClick={() => onPrint(order)}>
            <Printer className="w-4 h-4" /> {failedPrint || printStates.some((p) => p.tone === 'bad' || p.tone === 'ok') ? 'Reprint' : 'Print'}
          </Button>

          {/* Exports are an integration/debugging tool, not service. Two
              always-visible buttons on every ticket were two more things to
              mis-tap next to Print, so they live behind one overflow menu. */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="min-h-[44px] min-w-[44px] rounded-lg" aria-label="More ticket actions">
                <MoreHorizontal className="w-4 h-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onSelect={() => onExport(order, 'json')} className="min-h-[44px] gap-2">
                <FileJson className="w-4 h-4" /> Export JSON
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onExport(order, 'csv')} className="min-h-[44px] gap-2">
                <FileText className="w-4 h-4" /> Export CSV
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {ownsOrder && revertFrom && (
            <UndoButton
              since={revertFrom.since}
              windowSeconds={undoSeconds}
              label={`Undo “${orderStatusLabel(order.status)}”`}
              onUndo={() => { void run('revert', () => onRevertOrder(order.id, revertFrom.to)); }}
            />
          )}

          {order.status !== 'served' && order.status !== 'cancelled' && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onCancel(order)}
              className="min-h-[44px] ml-auto rounded-lg gap-1.5 text-sm text-destructive hover:text-destructive hover:bg-destructive/10"
            >
              <Ban className="w-3.5 h-3.5" /> Void
            </Button>
          )}
        </div>
      </div>
    </motion.div>
  );
});
KitchenOrderCard.displayName = 'KitchenOrderCard';

export default KitchenOrderCard;
