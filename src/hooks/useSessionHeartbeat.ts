import { useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useCartStore } from '@/lib/cart-store';

/**
 * Pings the backend every 30s so the session stays "present".
 * Orders are rejected server-side if the heartbeat is older than 2 minutes.
 */
export function useSessionHeartbeat() {
  const sessionId = useCartStore((s) => s.sessionId);

  useEffect(() => {
    if (!sessionId) return;
    const ping = () => supabase.rpc('touch_session', { _id: sessionId });
    ping();
    const id = setInterval(ping, 30_000);
    const onVisible = () => { if (document.visibilityState === 'visible') ping(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [sessionId]);
}
