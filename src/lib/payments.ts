import { supabase } from '@/integrations/supabase/client';
import { getOrderPayment, type GuestOrderPayment } from '@/lib/guest-api';

export type CardPaymentResult =
  | { status: 'unavailable'; reason: 'disabled' | 'not_configured' }
  | {
      status: 'monri_components';
      clientSecret: string;
      authenticityToken: string;
      paymentTransactionId: string;
      monriPaymentId?: string;
      environment: 'test' | 'production';
    }
  | { status: 'error'; message: string };

export interface PayableOrder {
  id: string;
  sessionId: string;
  sessionToken: string;
}

/**
 * The client-side flag only decides whether we offer the button. The server
 * refuses a card order independently (restaurant_settings.online_card_enabled
 * and the Edge Function's own configuration check), so a stale build can never
 * take a payment we are not ready to take.
 */
export const cardPaymentEnabledInBuild = import.meta.env.VITE_MONRI_ENABLED === 'true';

export async function startCardPayment(order: PayableOrder): Promise<CardPaymentResult> {
  if (!cardPaymentEnabledInBuild) {
    return { status: 'unavailable', reason: 'disabled' };
  }

  const { data, error } = await supabase.functions.invoke('monri-create-payment', {
    body: {
      order_id: order.id,
      session_id: order.sessionId,
      session_token: order.sessionToken,
      currency: 'BAM',
      transaction_type: 'purchase',
    },
  });

  if (error) return { status: 'error', message: error.message };

  if (data?.error === 'card_unavailable') {
    return { status: 'unavailable', reason: data.reason === 'not_configured' ? 'not_configured' : 'disabled' };
  }
  if (data?.error) return { status: 'error', message: String(data.error) };

  if (data?.client_secret && data?.authenticity_token && data?.payment_transaction_id) {
    return {
      status: 'monri_components',
      clientSecret: data.client_secret,
      authenticityToken: data.authenticity_token,
      paymentTransactionId: data.payment_transaction_id,
      monriPaymentId: data.monri_payment_id,
      environment: data.environment === 'production' ? 'production' : 'test',
    };
  }

  return { status: 'error', message: 'payment_start_failed' };
}

/** What the guest is shown. Derived only from server state. */
export type ConfirmationOutcome = 'received' | 'failed' | 'delayed';

export interface ConfirmationResult {
  outcome: ConfirmationOutcome;
  payment: GuestOrderPayment | null;
}

export function classifyPayment(payment: GuestOrderPayment | null): ConfirmationOutcome | 'waiting' {
  if (!payment || payment.status !== 'ok') return 'waiting';
  if (payment.payment_status === 'paid' || payment.released) return 'received';
  if (payment.payment_status === 'failed' || payment.order_status === 'payment_failed') return 'failed';
  return 'waiting';
}

/**
 * Poll the server until the payment resolves.
 *
 * The Monri SDK telling the browser "approved" is not proof: the callback may
 * not have arrived, or may be rejected for a wrong amount. So we wait for our
 * own database, and if it has not resolved within `timeoutMs` we report
 * `delayed` — which the UI renders as "still confirming, do not pay again"
 * rather than either success or failure.
 */
export async function waitForPaymentConfirmation(
  order: PayableOrder,
  { timeoutMs = 25_000, intervalMs = 1_500, signal }: { timeoutMs?: number; intervalMs?: number; signal?: AbortSignal } = {},
): Promise<ConfirmationResult> {
  const deadline = Date.now() + timeoutMs;
  let last: GuestOrderPayment | null = null;

  while (Date.now() < deadline && !signal?.aborted) {
    try {
      last = await getOrderPayment(order.sessionId, order.sessionToken, order.id);
      const verdict = classifyPayment(last);
      if (verdict !== 'waiting') return { outcome: verdict, payment: last };
    } catch {
      // Network hiccup while polling is not a payment failure — keep waiting.
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  return { outcome: 'delayed', payment: last };
}
