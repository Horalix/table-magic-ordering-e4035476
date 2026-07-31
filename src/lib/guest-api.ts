import { supabase } from '@/integrations/supabase/client';
import type { Json } from '@/integrations/supabase/types';

type JsonRecord = Record<string, Json | undefined>;

export type JoinStatus = 'pending' | 'approved' | 'declined' | 'missing' | 'expired' | 'invalid' | 'not_active';

export interface GuestSessionResult {
  status: 'invalid' | 'empty' | 'join_required' | 'created' | 'returning';
  role?: 'host' | 'joiner';
  session_id?: string;
  session_token?: string | null;
  guest_name?: string | null;
}

export interface GuestJoinResult {
  status: JoinStatus;
  request_id?: string;
  session_id?: string;
  session_token?: string | null;
  guest_name?: string | null;
}

export interface PendingJoinRequest {
  id: string;
  guest_name: string;
  client_id: string;
  status: 'pending' | 'approved' | 'declined';
  created_at: string;
}

export interface GuestOrderItemInput {
  menu_item_id: string;
  quantity: number;
  notes?: string | null;
}

/**
 * How the guest intends to settle. These are distinct on purpose:
 * `cash` and `pos_terminal` both mean "pay at the table" to the guest, but
 * they reconcile against different things at close of day, and `pos_terminal`
 * tells the waiter to bring the card machine.
 */
export type PaymentMethod = 'card_online' | 'cash' | 'pos_terminal';

export interface GuestPlaceOrderResult {
  order_id: string;
  /** Short, speakable reference the guest can quote to a waiter. */
  order_code: string;
  status: string;
  total: number;
  tip_amount?: number;
  payment_method: PaymentMethod;
  payment_status: string;
  /** True when the order is held pending card payment (not in the kitchen). */
  awaiting_payment: boolean;
  ticket_id?: string;
}

export interface GuestOrderPayment {
  status: 'ok' | 'not_found';
  order_id?: string;
  order_code?: string;
  order_status?: string;
  payment_status?: string;
  payment_method?: PaymentMethod;
  total?: number;
  /** True once the order has actually been handed to the kitchen. */
  released?: boolean;
}

export interface ServiceStatus {
  ordering_enabled: boolean;
  online_card_enabled: boolean;
  pay_at_table_enabled: boolean;
  paused_message: string | null;
  last_order_time: string | null;
  kitchen_delay_minutes: number;
  recommendations_enabled: boolean;
}

export interface GuestTabOrderItem {
  id: string;
  quantity: number;
  unit_price: number;
  notes: string | null;
  status: string;
  menu_items: {
    name: string | null;
    name_ar: string | null;
    name_bs: string | null;
  } | null;
}

export interface GuestTabOrder {
  id: string;
  status: string;
  total: number;
  notes: string | null;
  guest_name: string | null;
  payment_method: string | null;
  payment_status: string | null;
  created_at: string;
  order_items: GuestTabOrderItem[];
}

export interface GuestTabResult {
  orders: GuestTabOrder[];
  bill_request: { id: string; status: string; created_at: string } | null;
  members: string[];
}

export interface ReviewWaiter {
  id: string;
  display_name: string;
}

const asRecord = (value: Json | null): JsonRecord => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as JsonRecord;
};

const rpcJson = async <T>(fn: Parameters<typeof supabase.rpc>[0], args: Record<string, unknown>): Promise<T> => {
  const { data, error } = await supabase.rpc(fn, args as never);
  if (error) throw error;
  return data as T;
};

export const inspectTable = (tableNumber: number, qrToken: string, clientId: string) =>
  rpcJson<GuestSessionResult>('guest_inspect_table', {
    _table_number: tableNumber,
    _qr_token: qrToken,
    _client_id: clientId,
  });

export const startTableSession = (tableNumber: number, qrToken: string, clientId: string, guestName: string) =>
  rpcJson<GuestSessionResult>('guest_start_table_session', {
    _table_number: tableNumber,
    _qr_token: qrToken,
    _client_id: clientId,
    _guest_name: guestName,
  });

export const requestJoin = (tableNumber: number, qrToken: string, clientId: string, guestName: string) =>
  rpcJson<GuestJoinResult>('guest_request_join', {
    _table_number: tableNumber,
    _qr_token: qrToken,
    _client_id: clientId,
    _guest_name: guestName,
  });

export const getJoinRequest = (sessionId: string, requestId: string, clientId: string) =>
  rpcJson<GuestJoinResult>('guest_get_join_request', {
    _session_id: sessionId,
    _request_id: requestId,
    _client_id: clientId,
  });

export const autoApproveJoinRequest = (
  tableNumber: number,
  qrToken: string,
  sessionId: string,
  requestId: string,
  clientId: string,
) =>
  rpcJson<GuestJoinResult>('guest_auto_approve_join_request', {
    _table_number: tableNumber,
    _qr_token: qrToken,
    _session_id: sessionId,
    _request_id: requestId,
    _client_id: clientId,
  });

export const listPendingJoinRequests = (sessionId: string, sessionToken: string, clientId: string) =>
  rpcJson<PendingJoinRequest[]>('guest_list_pending_join_requests', {
    _session_id: sessionId,
    _session_token: sessionToken,
    _client_id: clientId,
  });

export const resolveJoinRequest = (
  sessionId: string,
  sessionToken: string,
  requestId: string,
  status: 'approved' | 'declined',
  resolvedByName: string | null,
) =>
  rpcJson<{ status: JoinStatus; request_id?: string }>('guest_resolve_join_request', {
    _session_id: sessionId,
    _session_token: sessionToken,
    _request_id: requestId,
    _status: status,
    _resolved_by_name: resolvedByName,
  });

export const touchSession = async (sessionId: string, sessionToken: string) => {
  const { data, error } = await supabase.rpc('touch_session', { _id: sessionId, _token: sessionToken });
  if (error) throw error;
  return data === true;
};

export const placeGuestOrder = (
  sessionId: string,
  sessionToken: string,
  guestName: string | null,
  paymentMethod: PaymentMethod,
  items: GuestOrderItemInput[],
  tip = 0,
) =>
  rpcJson<GuestPlaceOrderResult>('guest_place_order', {
    _session_id: sessionId,
    _session_token: sessionToken,
    _guest_name: guestName,
    _payment_method: paymentMethod,
    _items: items as unknown as Json,
    _tip: tip,
  });

/**
 * Server truth for one order's payment. The browser's opinion of whether a
 * card went through is never used — this is.
 */
export const getOrderPayment = (sessionId: string, sessionToken: string, orderId: string) =>
  rpcJson<GuestOrderPayment>('guest_get_order_payment', {
    _session_id: sessionId,
    _session_token: sessionToken,
    _order_id: orderId,
  });

/** Abandon an unpaid card order and send it to the kitchen as pay-at-table. */
export const switchToPayAtTable = (
  sessionId: string,
  sessionToken: string,
  orderId: string,
  method: 'cash' | 'pos_terminal' = 'cash',
) =>
  rpcJson<{ status: 'released' | 'not_switchable' | 'payment_in_flight'; order_code?: string }>(
    'guest_switch_to_pay_at_table',
    { _session_id: sessionId, _session_token: sessionToken, _order_id: orderId, _method: method },
  );

/** Whether the restaurant is accepting orders, and how it can be paid. */
export const getServiceStatus = () => rpcJson<ServiceStatus>('guest_get_service_status', {});

export const callWaiter = (sessionId: string, sessionToken: string, reason: 'assist' | 'pay' = 'assist') =>
  rpcJson<{ call_id: string; status: string }>('guest_call_waiter', {
    _session_id: sessionId,
    _session_token: sessionToken,
    _reason: reason,
  });

export const requestBill = (sessionId: string, sessionToken: string) =>
  rpcJson<{ bill_request_id: string; status: string }>('guest_request_bill', {
    _session_id: sessionId,
    _session_token: sessionToken,
  });

export const getGuestTab = async (sessionId: string, sessionToken: string): Promise<GuestTabResult> => {
  const result = asRecord(await rpcJson<Json>('guest_get_tab', {
    _session_id: sessionId,
    _session_token: sessionToken,
  }));

  return {
    orders: (result.orders as unknown as GuestTabOrder[]) || [],
    bill_request: (result.bill_request as unknown as GuestTabResult['bill_request']) || null,
    members: (result.members as unknown as string[]) || [],
  };
};

export const getWaiterForReview = async (sessionId: string, sessionToken: string): Promise<ReviewWaiter | null> => {
  const waiter = await rpcJson<Json>('guest_get_waiter_for_review', {
    _session_id: sessionId,
    _session_token: sessionToken,
  });
  if (!waiter || waiter === null) return null;
  const record = asRecord(waiter);
  if (!record.id || !record.display_name) return null;
  return record as unknown as ReviewWaiter;
};

export const submitVisitRating = (sessionId: string, sessionToken: string, rating: number) =>
  rpcJson<{ rating_id: string }>('guest_submit_visit_rating', {
    _session_id: sessionId,
    _session_token: sessionToken,
    _rating: rating,
  });

export const submitServerRating = (
  sessionId: string,
  sessionToken: string,
  waiterId: string,
  rating: number,
  comment: string,
) =>
  rpcJson<{ rating_id: string }>('guest_submit_server_rating', {
    _session_id: sessionId,
    _session_token: sessionToken,
    _waiter_id: waiterId,
    _rating: rating,
    _comment: comment,
  });

