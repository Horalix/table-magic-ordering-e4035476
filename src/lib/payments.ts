/**
 * Card payment seam (Monri).
 *
 * Today this returns `coming_soon` so the checkout UI can show a graceful
 * placeholder. When Monri is set up, implement it by invoking an edge function
 * that creates a Monri payment session and returns a checkout URL, e.g.:
 *
 *   import { supabase } from '@/integrations/supabase/client';
 *   const { data, error } = await supabase.functions.invoke('create-monri-payment', {
 *     body: { order_id: order.id, amount: order.total, currency: 'BAM' },
 *   });
 *   if (error) return { status: 'error', message: error.message };
 *   if (data?.url) return { status: 'redirect', url: data.url };
 *
 * The caller then redirects to `url`; Monri calls a webhook that flips
 * orders.payment_status to 'paid'. Nothing else in the UI needs to change.
 */

export type CardPaymentResult =
  | { status: 'coming_soon' }
  | { status: 'redirect'; url: string }
  | { status: 'error'; message: string };

export interface PayableOrder {
  id: string;
  total: number;
}

export async function startCardPayment(_order: PayableOrder): Promise<CardPaymentResult> {
  // Monri not configured yet — graceful placeholder.
  return { status: 'coming_soon' };
}

/** Whether online card payment is live. Flip when the Monri edge function exists. */
export const cardPaymentEnabled = false;
