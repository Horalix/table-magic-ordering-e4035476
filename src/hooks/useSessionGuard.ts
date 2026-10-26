import { useEffect, useState } from 'react';
import { tableForgotten, useCartStore } from '@/lib/cart-store';
import { resumeSession } from '@/lib/guest-api';

/**
 * Decides, once per app launch, whether a remembered table session is still
 * real — and clears it if it is not.
 *
 * Why this exists: La Soul prints one QR for the room and the guest types the
 * table they are sitting at. They will not be at the same table next time, so
 * a session that survives from one visit to the next is not a convenience, it
 * is a wrong table number on a kitchen ticket.
 *
 * The rule:
 *   - Reload or navigate inside the same tab → resume silently. The guest is
 *     mid-meal; asking again would be infuriating.
 *   - Cold start (new tab, app reopened, phone unlocked hours later) → ask the
 *     SERVER. Still active means the meal is still going; closed or expired
 *     means the visit is over and the device forgets the table.
 *
 * The server is the authority in both directions. The device only remembers —
 * and not for long: a table nobody has looked at for an hour is forgotten
 * before the server is asked (TABLE_MEMORY_MS in cart-store).
 */

const TAB_MARKER = 'lasoul-session-checked';

export type SessionGuardState = 'checking' | 'active' | 'none';

export function useSessionGuard(): SessionGuardState {
  const sessionId = useCartStore((s) => s.sessionId);
  const sessionToken = useCartStore((s) => s.sessionToken);
  const [state, setState] = useState<SessionGuardState>(() =>
    sessionId && sessionToken ? 'checking' : 'none',
  );

  useEffect(() => {
    if (!sessionId || !sessionToken) { setState('none'); return; }

    // Nobody has looked at the app at this table for an hour: whatever the
    // server says, this is a new visit (TABLE_MEMORY_MS). A table left open by
    // staff kept phones on it all day.
    if (tableForgotten(useCartStore.getState().tableSeenAt)) {
      useCartStore.getState().endVisit();
      setState('none');
      return;
    }

    // Already verified in this tab: this is a reload, not a new visit.
    if (typeof sessionStorage !== 'undefined' && sessionStorage.getItem(TAB_MARKER) === sessionId) {
      setState('active');
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const result = await resumeSession(sessionId, sessionToken);
        if (cancelled) return;

        if (result.status === 'active') {
          sessionStorage?.setItem(TAB_MARKER, sessionId);
          // The table may have been moved by staff; trust the server's answer.
          if (result.table_number) {
            useCartStore.setState({ tableNumber: result.table_number });
          }
          setState('active');
          return;
        }

        // The visit is over. Forget the table and the half-built cart with it —
        // carrying yesterday's cart into a new visit is worse than an empty one.
        useCartStore.getState().endVisit();
        setState('none');
      } catch {
        // A network failure is not proof the session is dead. Keep it and let
        // the heartbeat sort it out rather than wiping a live guest's order.
        if (!cancelled) setState('active');
      }
    })();

    return () => { cancelled = true; };
  }, [sessionId, sessionToken]);

  return state;
}
