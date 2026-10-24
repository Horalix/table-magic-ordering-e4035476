import React, { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Ban, Check, ChefHat, CupSoda, FileJson, FileText, MoreHorizontal, Printer, RotateCcw, Utensils } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import PaymentBadge from '@/components/PaymentBadge';
import { useNow } from '@/lib/clock';
import { formatMinutes, orderUrgency, urgencyMark, urgencyText, formatClock } from '@/lib/timing';
import { kitchenStart, orderStatusLabel } from '@/components/staff/order-status';
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
  items: KitchenItem[];
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

const statusColors: Partial<Record<OrderStatus, string>> = {
  pending: 'bg-destructive/10 text-destructive border-destructive/20',
  confirmed: 'bg-accent/10 text-accent border-accent/20',
  preparing: 'bg-accent/15 text-accent border-accent/25',
  ready: 'bg-primary/10 text-primary border-primary/20',
  served: 'bg-muted text-muted-foreground border-border',
};

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
  onBumpItem: (itemId: string, status: OrderItemStatus) => Promise<void>;
  onBumpMany: (itemIds: string[], status: OrderItemStatus) => Promise<void>;
  onAdvanceOrder: (orderId: string, status: OrderStatus) => Promise<void>;
  onRevertOrder: (orderId: string, status: OrderStatus) => Promise<void>;
  onCancel: (order: KitchenOrder) => void;
  onPrint: (order: KitchenOrder) => void;
  onExport: (order: KitchenOrder, format: 'json' | 'csv') => void;
}

const KitchenOrderCard = ({
  order, station, undoSeconds, showStatus, failedPrint,
  onBumpItem, onBumpMany, onAdvanceOrder, onRevertOrder, onCancel, onPrint, onExport,
}: Props) => {
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

  const ageMs = Math.max(0, now - new Date(kitchenStart(order)).getTime());
  const urgency = order.status === 'ready' || order.status === 'served' || order.status === 'cancelled'
    ? 'fresh'
    : orderUrgency(ageMs);
  const stageMs = Math.max(0, now - new Date(stageStart(order)).getTime());

  const pending = items.filter((i) => i.status === 'pending');
  const working = items.filter((i) => i.status === 'preparing');
  const notReady = items.filter((i) => i.status === 'pending' || i.status === 'preparing');
  const hasBar = order.items.some((i) => i.station === 'bar');
  const hasKitchen = order.items.some((i) => i.station === 'kitchen');

  /** Which stamp, if any, the order-level undo is timed against. */
  const revertFrom: { to: OrderStatus; since: string | null } | null =
    order.status === 'served' ? { to: 'ready', since: order.served_at }
      : order.status === 'ready' ? { to: 'preparing', since: order.ready_at }
        : null;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
      className={`rounded-xl border bg-card overflow-hidden shadow-lux ${
        urgency === 'critical' ? 'border-destructive/60 breathe breathe-urgent'
          : urgency === 'late' ? 'border-destructive/50'
            : urgency === 'attention' ? 'border-accent/50' : 'border-border'
      }`}
    >
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          {order.section_name && (
            <span
              className="inline-flex items-center gap-1 text-[10px] uppercase font-sans px-1.5 py-0.5 rounded"
              style={{ background: `${order.section_color}33`, color: order.section_color || undefined }}
            >
              {order.section_name}
            </span>
          )}
          {/* Read from across a kitchen, not from arm's length: the table
              number is the one thing a runner must get right first time. */}
          <span className="font-serif text-xl md:text-[28px] md:leading-8 font-bold text-foreground">Table {order.table_number}</span>
          {order.order_code && (
            <span className="text-xs font-sans font-semibold tabular-nums tracking-wider px-1.5 py-0.5 rounded bg-muted text-foreground">
              #{order.order_code}
            </span>
          )}
          {order.guest_name && <span className="text-xs text-muted-foreground font-sans truncate">({order.guest_name})</span>}
          {/* Which stations are involved — a food runner needs to know a drink is coming too. */}
          {station === 'all' && hasBar && hasKitchen && (
            <span className="inline-flex items-center gap-1 text-[10px] uppercase font-sans px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
              <CupSoda className="w-3 h-3" /> + bar
            </span>
          )}
          {showStatus && (
            <Badge className={`text-xs font-sans ${statusColors[order.status]}`}>{orderStatusLabel(order.status)}</Badge>
          )}
          <PaymentBadge method={order.payment_method} status={order.payment_status} />
        </div>

        {/* Urgency is spelled out, not only coloured — colour alone fails for
            colour-blind staff and for anyone glancing across a room. */}
        <div className="text-right shrink-0">
          <span className={`text-sm md:text-lg font-sans font-semibold tabular-nums flex items-center justify-end gap-1 ${urgencyText(urgency)}`}>
            {urgencyMark(urgency) && <span aria-hidden>{urgencyMark(urgency)}</span>}
            {formatMinutes(ageMs)}
            {urgency !== 'fresh' && <span className="sr-only"> — {urgency}</span>}
          </span>
          <span className="block text-xs md:text-sm text-muted-foreground font-sans tabular-nums">
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
              className={`flex items-center gap-2 rounded-lg px-2 py-1.5 min-h-[52px] ${
                item.status === 'ready' ? 'bg-primary/10'
                  : item.status === 'preparing' ? 'bg-accent/10' : 'bg-muted/40'
              }`}
            >
              {/*
                Text, not a button. The whole row used to bump the line, so a
                cook scrolling the board or steadying the tablet with a thumb
                marked dishes as started or ready without meaning to — and the
                note they were reading was exactly where they touched. Only the
                labelled button on the right moves a line now.
              */}
              <div className="flex-1 min-w-0">
                <p className={`text-base md:text-xl font-sans font-medium leading-snug ${item.status === 'ready' ? 'text-muted-foreground' : 'text-foreground'}`}>
                  <span className="tabular-nums font-bold">{item.quantity}×</span> {item.menu_item_name}
                  {station === 'all' && item.station === 'bar' && (
                    <CupSoda className="inline w-4 h-4 ml-1 text-muted-foreground" aria-label="bar" />
                  )}
                </p>
                {/* Notes and allergens are what get a dish sent back or a guest
                    hurt. Small italic grey was the least legible text on the
                    card; they are solid, bold blocks now. */}
                {item.notes && (
                  <p className="mt-1 inline-block rounded-md bg-amber-200 text-amber-950 dark:bg-amber-300 dark:text-black font-sans font-bold text-sm md:text-base px-2 py-0.5">
                    ⚠ {item.notes}
                  </p>
                )}
                {item.allergens && item.allergens.length > 0 && (
                  <p className="mt-1 inline-block rounded-md bg-destructive text-destructive-foreground font-sans font-bold uppercase tracking-wide text-xs md:text-sm px-2 py-0.5">
                    Allergens: {item.allergens.join(', ')}
                  </p>
                )}
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
                  className="min-h-[44px] min-w-[76px] rounded-lg text-sm font-sans font-semibold shrink-0 active:scale-95 transition-transform"
                >
                  {ITEM_ACTION[item.status]}
                </Button>
              ) : (
                <span className="inline-flex items-center gap-1 text-sm font-sans font-semibold text-primary px-2 shrink-0">
                  <Check className="w-4 h-4" /> Up
                </span>
              )}
            </div>
          );
        })}

        {items.length === 0 && (
          <p className="px-2 py-3 text-xs text-muted-foreground font-sans">Nothing for this station.</p>
        )}
      </div>

      {order.notes && (
        <div className="px-3 pb-2">
          <p className="rounded-md bg-amber-200 text-amber-950 dark:bg-amber-300 dark:text-black font-sans font-bold text-sm md:text-base px-2.5 py-1.5">
            Note: {order.notes}
          </p>
        </div>
      )}

      {failedPrint && (
        <div className="mx-4 mb-2 px-3 py-2 rounded-lg bg-destructive/10 border border-destructive/25">
          <p className="text-xs font-sans text-destructive">This ticket did not print. Use Reprint below.</p>
        </div>
      )}

      <div className="px-3 pb-3 space-y-2">
        <div className="flex flex-wrap gap-2">
          {pending.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              disabled={busy.has('start-all')}
              onClick={() => run('start-all', () => onBumpMany(pending.map((i) => i.id), 'preparing'))}
              className="min-h-[44px] rounded-lg text-sm font-sans gap-1.5"
            >
              <ChefHat className="w-3.5 h-3.5" /> Start all ({pending.length})
            </Button>
          )}
          {notReady.length > 0 && (
            <Button
              size="sm"
              disabled={busy.has('all-ready')}
              onClick={() => run('all-ready', () => onBumpMany(notReady.map((i) => i.id), 'ready'))}
              className="min-h-[44px] flex-1 min-w-[140px] rounded-lg bg-primary text-primary-foreground text-sm font-sans active:scale-95 transition-transform"
            >
              All ready ({notReady.length})
            </Button>
          )}
          {notReady.length === 0 && order.status === 'ready' && (
            <Button
              size="sm"
              disabled={busy.has('served')}
              onClick={() => run('served', () => onAdvanceOrder(order.id, 'served'))}
              className="min-h-[44px] flex-1 min-w-[140px] rounded-lg bg-primary text-primary-foreground text-sm font-sans active:scale-95 transition-transform"
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
            <Printer className="w-4 h-4" /> {failedPrint ? 'Reprint' : 'Print'}
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

          {revertFrom && (
            <UndoButton
              since={revertFrom.since}
              windowSeconds={undoSeconds}
              label={`Undo ${order.status}`}
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
};

export default KitchenOrderCard;
