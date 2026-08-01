import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';

export type OrderStatus = Database['public']['Enums']['order_status'];
export type OrderItemStatus = Database['public']['Enums']['order_item_status'];
export type Station = 'kitchen' | 'bar';
export type TablePaymentMethod = 'cash' | 'pos_terminal';

/**
 * Staff operations that touch money or order state.
 *
 * Every one of these goes through a SECURITY DEFINER RPC rather than a table
 * write. The database rejects direct UPDATEs to financial columns and illegal
 * status transitions (see 20260731090100_payment_safety.sql), so this module
 * is not a convenience wrapper — it is the only route that works.
 */

const rpc = async <T>(fn: string, args: Record<string, unknown>): Promise<T> => {
  const { data, error } = await supabase.rpc(fn as never, args as never);
  if (error) throw new Error(error.message);
  return data as T;
};

/** Advance an order through the kitchen flow. Illegal moves are rejected. */
export const updateOrderStatus = (orderId: string, status: OrderStatus) =>
  rpc<{ status: OrderStatus }>('staff_update_order_status', { _order_id: orderId, _status: status });

/**
 * Move one line through the kitchen.
 *
 * The caller always states the TARGET state, never "next". A double-tap on a
 * tablet with a laggy screen is then a no-op rather than a two-state jump —
 * which is the difference between a cook seeing the same button twice and a
 * dish being marked ready before anyone cooked it.
 *
 * The order's own status is derived by the database from its lines; nothing
 * here needs to keep the two in step.
 */
export const bumpOrderItem = (itemId: string, status: OrderItemStatus) =>
  rpc<{ status: OrderItemStatus; order_status: OrderStatus }>('staff_bump_order_item', {
    _item_id: itemId,
    _status: status,
  });

/**
 * Bump several lines at once — "all six portions of fries are up".
 *
 * Ids are passed explicitly rather than re-derived server-side so the action
 * applies to exactly what the cook saw on screen, even if a new order landed
 * between the render and the tap.
 */
export const bumpOrderItems = (itemIds: string[], status: OrderItemStatus) =>
  rpc<{ updated: number; failed: number }>('staff_bump_order_items', {
    _item_ids: itemIds,
    _status: status,
  });

/**
 * Take an order back a step after a mis-tap.
 *
 * Time-boxed by the database (`kitchen_undo_seconds`), and a manager is
 * required to undo something already served and paid for. This is not the
 * normal transition path — it is a separate, audited RPC precisely so that a
 * plain UPDATE still cannot walk an order backwards.
 */
export const revertOrderStatus = (orderId: string, status: OrderStatus, reason?: string) =>
  rpc<{ status: OrderStatus; reverted_from: OrderStatus }>('staff_revert_order_status', {
    _order_id: orderId,
    _to: status,
    _reason: reason ?? null,
  });

export interface AllDayRow {
  menu_item_id: string;
  name: string;
  station: Station;
  qty_pending: number;
  qty_preparing: number;
  qty_ready: number;
  oldest_at: string;
  /** Lines not yet started. Safe to send to "start all". */
  pending_ids: string[];
  /** Lines not yet up — pending and in prep. Safe to send to "all up". */
  open_ids: string[];
}

/**
 * How much of each dish is outstanding across every open order.
 *
 * Aggregated in SQL rather than rolled up from the board, because the board is
 * capped — and an undercounted "8x Fries" is invisible in a way a missing card
 * is not.
 */
export const allDay = (station?: Station) =>
  rpc<AllDayRow[]>('kds_all_day', { _station: station ?? null });

/**
 * Record that the guest settled in person.
 *
 * Cash and the physical POS terminal are recorded separately because they
 * reconcile against different things at close of day.
 */
export const recordTablePayment = (orderId: string, method: TablePaymentMethod, note?: string) =>
  rpc<{ status: string; payment_method: string; total: number }>('record_table_payment', {
    _order_id: orderId,
    _method: method,
    _note: note ?? null,
  });

export interface AlertClaim {
  status: 'acknowledged' | 'resolved';
  claimed_by: string | null;
  /** False when someone else already has it — the UI must say who, not fail silently. */
  mine: boolean;
}

/** Take responsibility for a table that is calling. */
export const ackWaiterCall = (callId: string) =>
  rpc<AlertClaim>('staff_ack_waiter_call', { _call_id: callId });

export const resolveWaiterCall = (callId: string) =>
  rpc<{ resolved: boolean }>('staff_resolve_waiter_call', { _call_id: callId });

export const ackBillRequest = (requestId: string) =>
  rpc<AlertClaim>('staff_ack_bill_request', { _request_id: requestId });

/**
 * Close a bill request, and optionally free the table.
 *
 * Returns `closed: false` with the outstanding amount when the table still
 * owes money — freeing it would hide an unpaid order behind a closed session
 * that nobody looks at again.
 */
export const resolveBillRequest = (requestId: string, closeSession = false) =>
  rpc<{ resolved: boolean; closed: boolean; outstanding: number }>('staff_resolve_bill_request', {
    _request_id: requestId,
    _close_session: closeSession,
  });

/** Head count for a table. `null` means unknown, which is not the same as zero. */
export const setCovers = (sessionId: string, covers: number | null) =>
  rpc<{ covers: number | null }>('staff_set_covers', { _session_id: sessionId, _covers: covers });

export interface CoversSummary {
  day: string;
  sittings: number;
  counted: number;
  covers: number;
  /** Fraction of sittings with a head count. Any per-head figure must show it. */
  coverage: number;
}

export interface KitchenLoadRow {
  station: Station;
  open_items: number;
  backlog_minutes: number;
  /** Outstanding prep divided by the configured parallel capacity. */
  load_factor: number;
}

/**
 * How far behind each station is.
 *
 * Deliberately not divided by a number of cooks — nobody tells this system how
 * many people are on tonight, and inventing a divisor would produce a
 * precise-looking number built on a guess.
 */
export const kitchenLoad = () => rpc<KitchenLoadRow[]>('kitchen_load', {});

/** Recompute observed prep times from the kitchen's own stamps. */
export const refreshPrepStats = (days = 30) =>
  rpc<number>('refresh_prep_stats', { _days: days });

export const coversSummary = (day?: string) =>
  rpc<CoversSummary>('covers_summary', { _day: day ?? null });

/** Cancel with a recorded reason. A manager is required once food is in production or money has moved. */
export const cancelOrder = (orderId: string, reason: string) =>
  rpc<{ status: string; requires_refund?: boolean; total?: number }>('cancel_order', {
    _order_id: orderId,
    _reason: reason,
  });

/** Manager-only. `markCompleted` false records the intent without moving money. */
export const recordRefund = (
  orderId: string,
  amount: number,
  method: 'card_online' | 'cash' | 'pos_terminal',
  reason: string,
  markCompleted = false,
  providerReference?: string,
) =>
  rpc<{ refund_id: string; amount: number; status: string }>('record_order_refund', {
    _order_id: orderId,
    _amount: amount,
    _method: method,
    _reason: reason,
    _mark_completed: markCompleted,
    _provider_reference: providerReference ?? null,
  });

export type FiscalizationStatus = 'not_fiscalized' | 'fiscalized' | 'failed';

export const setFiscalization = (
  orderId: string,
  status: FiscalizationStatus,
  receiptNumber?: string,
  providerReference?: string,
  error?: string,
) =>
  rpc<{ fiscalization_status: FiscalizationStatus }>('set_order_fiscalization', {
    _order_id: orderId,
    _status: status,
    _receipt_number: receiptNumber ?? null,
    _provider_reference: providerReference ?? null,
    _error: error ?? null,
  });

/** Kitchen and bar get their own ticket; the bar cannot work off a food ticket. */
export type TicketType = 'kitchen' | 'bar';

/**
 * Try to become the device that prints this ticket.
 *
 * Returns true only for the one caller that wins. Two kitchen screens, or the
 * same screen after a reload, cannot both print the same order.
 *
 * A claim is an intention, not an outcome — the winner must come back with
 * `reportTicketPrint`, and a claim nobody reports on is swept back into the
 * queue by `requeueStaleTicketPrints`.
 */
export const claimTicketPrint = (orderId: string, deviceId: string, type: TicketType = 'kitchen') =>
  rpc<boolean>('claim_ticket_print', { _order_id: orderId, _device_id: deviceId, _ticket_type: type });

/**
 * Say what actually happened.
 *
 * `verified` is the honest bit: true only when the printer itself confirmed
 * the ticket. Most cheap Bluetooth printers cannot be asked, and every browser
 * print dialog reports only that a dialog closed — recording those as plain
 * "printed" is what made the old print log worthless.
 */
export const reportTicketPrint = (
  orderId: string,
  ok: boolean,
  error?: string,
  type: TicketType = 'kitchen',
  verified?: boolean,
) =>
  rpc<void>('report_ticket_print', {
    _order_id: orderId,
    _ok: ok,
    _error: error ?? null,
    _ticket_type: type,
    _verified: verified ?? null,
  });

/**
 * Put a ticket back in the queue.
 *
 * Returns when the original printed so the reprint can say so on the paper —
 * a reprint indistinguishable from the original is a dish cooked twice.
 */
export const requeueTicketPrint = (orderId: string, type: TicketType = 'kitchen') =>
  rpc<{ requeued: boolean; previous_printed_at: string | null; attempts: number }>(
    'requeue_ticket_print', { _order_id: orderId, _ticket_type: type },
  );

/** Turn claims that were never reported on back into visible work. */
export const requeueStaleTicketPrints = (olderThanSeconds = 90) =>
  rpc<number>('requeue_stale_ticket_prints', { _older_than_seconds: olderThanSeconds });

export interface DayReconciliation {
  day: string;
  orders: number;
  gross: number;
  tips: number;
  refunded: number;
  net: number;
  paid_online: number;
  paid_cash: number;
  paid_pos_terminal: number;
  outstanding: number;
  outstanding_orders: number;
  unfiscalized: number;
  unfiscalized_orders: number;
  average_order: number;
  stuck_payments: number;
  stuck_amount: number;
  cancelled_orders: number;
  callback_problems: number;
}

export const dayReconciliation = (day?: string) =>
  rpc<DayReconciliation>('day_reconciliation', { _day: day ?? null });

export interface ShiftClose {
  id: string;
  day: string;
  closed_at: string;
  closed_by: string | null;
  expected_cash: number;
  counted_cash: number | null;
  expected_terminal: number;
  counted_terminal: number | null;
  terminal_batch_reference: string | null;
  notes: string | null;
  acknowledged_issues: boolean;
}

/**
 * Sign off a day.
 *
 * Records what was counted next to what the system believes, and reports the
 * difference. It does not adjust anything: counting the drawer cannot change
 * what was sold, and a close that quietly balanced the two would make a slow
 * leak invisible.
 *
 * Manager only, and idempotent per day — closing again corrects the same row
 * while leaving both attempts in the audit log.
 */
export const closeShift = (
  day: string,
  countedCash: number | null,
  countedTerminal: number | null,
  terminalBatchReference?: string,
  notes?: string,
  acknowledgeIssues = false,
) =>
  rpc<{
    id: string; day: string;
    expected_cash: number; expected_terminal: number; expected_online: number;
    cash_difference: number | null; terminal_difference: number | null;
  }>('close_shift', {
    _day: day,
    _counted_cash: countedCash,
    _counted_terminal: countedTerminal,
    _terminal_batch_reference: terminalBatchReference ?? null,
    _notes: notes ?? null,
    _acknowledge_issues: acknowledgeIssues,
  });

export const shiftCloseFor = (day?: string) =>
  rpc<ShiftClose | null>('shift_close_for', { _day: day ?? null });

/** Stable per-device id so print claims can be attributed. */
export function deviceId(): string {
  const key = 'lasoul-device-id';
  const existing = localStorage.getItem(key);
  if (existing) return existing;
  const id = (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
    ? crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10);
  localStorage.setItem(key, id);
  return id;
}
