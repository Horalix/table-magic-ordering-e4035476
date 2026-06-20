import { supabase } from '@/integrations/supabase/client';

export type CardPaymentResult =
  | { status: 'coming_soon' }
  | { status: 'redirect'; url: string }
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
  total: number;
  sessionId?: string;
  sessionToken?: string;
}

export async function startCardPayment(order: PayableOrder): Promise<CardPaymentResult> {
  if (import.meta.env.VITE_MONRI_ENABLED !== 'true') {
    return { status: 'coming_soon' };
  }

  if (!order.sessionId || !order.sessionToken) {
    return { status: 'error', message: 'Missing table session for card payment.' };
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
  if (data?.url) return { status: 'redirect', url: data.url };
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

  return { status: 'coming_soon' };
}

export const cardPaymentEnabled = import.meta.env.VITE_MONRI_ENABLED === 'true';
