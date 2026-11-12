import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  readAlerts, sendTestAlert, turnOffAlerts, turnOnAlerts, type AlertAudience, type AlertsSetup, type AlertsState,
} from '@/lib/push-alerts';

const LATER_KEYS: Record<AlertAudience, string> = { waiter: 'waiter-alerts-later', reservations: 'reservation-alerts-later' };
/** Long enough to lock the phone after tapping. */
const TEST_DELAY_SECONDS = 10;

const readLater = (audience: AlertAudience) => { try { return localStorage.getItem(LATER_KEYS[audience]) === '1'; } catch { return false; } };

/**
 * "Alerts on lock screen" for the waiter screen (src/lib/push-alerts.ts):
 * where this phone stands, turning alerts on or off, and a test alert. With
 * `audience: 'reservations'` it is an admin's "Alert this phone" on Admin →
 * Reservations, for the restaurant being shown.
 */
export function useLockScreenAlerts(venueId: string | null, audience: AlertAudience = 'waiter') {
  const [state, setState] = useState<AlertsState>('checking');
  const [setup, setSetup] = useState<AlertsSetup | null>(null);
  const [busy, setBusy] = useState(false);
  const [later, setLater] = useState(() => readLater(audience));

  useEffect(() => {
    if (!venueId) return;
    let cancelled = false;
    setState('checking');
    void readAlerts(venueId, audience).then((reading) => {
      if (cancelled) return;
      setState(reading.state);
      setSetup(reading.setup);
    });
    return () => { cancelled = true; };
  }, [venueId, audience]);

  /* Straight from the tap, with everything fetched before: iPhone only asks for permission from one. */
  const toggle = useCallback(() => {
    if (!setup || !venueId || busy) return;
    setBusy(true);
    const work = state === 'on'
      ? turnOffAlerts(setup, audience, venueId).then(() => 'off' as const)
      : turnOnAlerts(setup, venueId, audience);
    work
      .then((next) => {
        setState(next);
        if (next === 'on') toast.success(audience === 'reservations' ? 'This phone will be alerted about new reservations' : 'Alerts on lock screen are on');
      })
      .catch((error) => {
        toast.error(error instanceof Error ? error.message : 'Could not change lock-screen alerts');
      })
      .finally(() => setBusy(false));
  }, [setup, venueId, busy, state, audience]);

  const test = useCallback(() => {
    if (!setup) return;
    sendTestAlert(setup, TEST_DELAY_SECONDS, audience)
      .then(() => toast.success(`Test alert in ${TEST_DELAY_SECONDS} seconds — lock the phone now`))
      .catch((error) => toast.error(error instanceof Error ? error.message : 'Could not send a test alert'));
  }, [setup, audience]);

  /** Moves the card from the top of the screen to the bottom, on this phone. */
  const putOff = useCallback(() => {
    setLater(true);
    try { localStorage.setItem(LATER_KEYS[audience], '1'); } catch { /* private mode: for this visit only */ }
  }, [audience]);

  /** At the top while there is something to do about it and it has not been put off. */
  const wantsAttention = !later && (state === 'off' || state === 'needs-home-screen' || state === 'blocked');

  return { state, busy, toggle, test, putOff, wantsAttention };
}

export type LockScreenAlertsControl = ReturnType<typeof useLockScreenAlerts>;
