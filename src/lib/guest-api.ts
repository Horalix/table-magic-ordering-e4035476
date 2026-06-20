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

export interface GuestPlaceOrderResult {
  order_id: string;
  total: number;
  tip_amount?: number;
  payment_method: 'cash' | 'card';
  payment_status: string;
  ticket_id?: string;
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
  paymentMethod: 'cash' | 'card',
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

