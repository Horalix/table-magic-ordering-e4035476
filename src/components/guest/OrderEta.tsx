import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Clock } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

/**
 * When the food is likely to arrive.
 *
 * Renders NOTHING when the server says `confidence: 'none'`. That is the whole
 * design: a dish with no prep setting and no history cannot be estimated, and
 * a made-up "about 10 minutes" is worse than silence because the guest starts
 * counting and is then annoyed at minute eleven.
 *
 * A range for the same reason. "12–16 min" sets an expectation a kitchen can
 * actually meet; "14 min" is a promise it will break roughly half the time.
 */

interface Eta {
  confidence: 'none' | 'low' | 'medium' | 'high';
  low_minutes?: number;
  high_minutes?: number;
  based_on?: string;
  reason?: string;
}

interface Props {
  orderId: string | null | undefined;
  /** Poll while the order is live; stop once it is not. */
  active?: boolean;
}

const OrderEta = ({ orderId, active = true }: Props) => {
  const { data } = useQuery({
    queryKey: ['order-eta', orderId],
    queryFn: async (): Promise<Eta | null> => {
      if (!orderId) return null;
      const { data: result, error } = await supabase.rpc('guest_order_eta' as never, { _order_id: orderId } as never);
      if (error) return null;
      return (result ?? null) as Eta | null;
    },
    enabled: !!orderId && active,
    // The backlog moves as the kitchen works through it, so this is worth
    // refreshing — but not often enough to make the number twitch.
    refetchInterval: active ? 60_000 : false,
    staleTime: 30_000,
  });

  if (!data || data.confidence === 'none' || data.low_minutes == null) return null;

  const { low_minutes: low, high_minutes: high, confidence } = data;

  return (
    <p
      className="inline-flex items-center gap-1.5 text-sm font-sans text-muted-foreground"
      aria-live="polite"
    >
      <Clock className="w-3.5 h-3.5" aria-hidden />
      <span>
        Ready in <span className="font-semibold text-foreground tabular-nums">{low}–{high} min</span>
      </span>
      {/* Say when the estimate is shakier than usual rather than presenting
          every forecast with the same confidence. */}
      {confidence === 'low' && <span className="text-xs">· rough estimate</span>}
    </p>
  );
};

export default OrderEta;
