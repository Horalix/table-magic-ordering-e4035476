import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { tableForgotten, useCartStore } from '@/lib/cart-store';
import { touchSession } from '@/lib/guest-api';
import { t } from '@/lib/i18n';
import { menuPath } from '@/lib/venues';

/**
 * Pings the backend every 30s so the session stays "present".
 * Orders are rejected server-side if the heartbeat is older than 2 minutes.
 *
 * A failed ping is ignored (Wi-Fi drops requests all evening). An explicit
 * "this session is over" from the server — the staff closed the table at the
 * bill — ends the table on this phone but keeps the cart, and says so. It used
 * to be ignored, and the guest only found out when an order bounced.
 */
export function useSessionHeartbeat() {
  const sessionId = useCartStore((s) => s.sessionId);
  const sessionToken = useCartStore((s) => s.sessionToken);
  const leaveTable = useCartStore((s) => s.leaveTable);
  const navigate = useNavigate();

  useEffect(() => {
    if (!sessionId || !sessionToken) return;
    let ended = false;
    const ping = () => {
      // Only a guest with the app on screen keeps the table. A tab left open
      // in a pocket since lunch is a new visit when it is next looked at.
      if (document.visibilityState === 'visible') {
        const { tableSeenAt, endVisit, markTableSeen } = useCartStore.getState();
        if (tableForgotten(tableSeenAt)) {
          ended = true;
          endVisit();
          toast.error(t('session_expired'));
          navigate(menuPath(), { replace: true });
          return;
        }
        markTableSeen();
      }
      touchSession(sessionId, sessionToken)
        .then((active) => {
          if (active !== false || ended) return;
          ended = true;
          leaveTable();
          toast.error(t('session_expired'));
          navigate(menuPath(), { replace: true });
        })
        .catch(() => { /* a blip, not an ending */ });
    };
    ping();
    const id = setInterval(ping, 30_000);
    const onVisible = () => { if (document.visibilityState === 'visible') ping(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [sessionId, sessionToken, leaveTable, navigate]);
}
