import { useEffect } from 'react';
import { useCartStore } from '@/lib/cart-store';
import { touchSession } from '@/lib/guest-api';

/**
 * Pings the backend every 30s so the session stays "present".
 * Orders are rejected server-side if the heartbeat is older than 2 minutes.
 */
export function useSessionHeartbeat() {
  const sessionId = useCartStore((s) => s.sessionId);
  const sessionToken = useCartStore((s) => s.sessionToken);

  useEffect(() => {
    if (!sessionId || !sessionToken) return;
    const ping = () => { void touchSession(sessionId, sessionToken); };
    ping();
    const id = setInterval(ping, 30_000);
    const onVisible = () => { if (document.visibilityState === 'visible') ping(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [sessionId, sessionToken]);
}
