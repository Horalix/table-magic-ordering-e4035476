import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';

export type OrderStatus = Database['public']['Enums']['order_status'];
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

/**
 * Try to become the device that prints this ticket.
 *
 * Returns true only for the one caller that wins. Two kitchen screens, or the
 * same screen after a reload, cannot both print the same order.
 */
export const claimTicketPrint = (orderId: string, deviceId: string) =>
  rpc<boolean>('claim_ticket_print', { _order_id: orderId, _device_id: deviceId });

export const reportTicketPrint = (orderId: string, ok: boolean, error?: string) =>
  rpc<void>('report_ticket_print', { _order_id: orderId, _ok: ok, _error: error ?? null });

export const requeueTicketPrint = (orderId: string) =>
  rpc<boolean>('requeue_ticket_print', { _order_id: orderId });

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
