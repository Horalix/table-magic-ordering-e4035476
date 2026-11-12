import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  readAlerts, sendTestAlert, turnOffAlerts, turnOnAlerts, type AlertsSetup, type AlertsState,
} from '@/lib/push-alerts';

const LATER_KEY = 'waiter-alerts-later';
/** Long enough to lock the phone after tapping. */
const TEST_DELAY_SECONDS = 10;

const readLater = () => { try { return localStorage.getItem(LATER_KEY) === '1'; } catch { return false; } };

/**
 * "Alerts on lock screen" for the waiter screen (src/lib/push-alerts.ts):
 * where this phone stands, turning alerts on or off, and a test alert.
 */
export function useLockScreenAlerts(venueId: string | null) {
  const [state, setState] = useState<AlertsState>('checking');
  const [setup, setSetup] = useState<AlertsSetup | null>(null);
  const [busy, setBusy] = useState(false);
  const [later, setLater] = useState(readLater);

  useEffect(() => {
    if (!venueId) return;
    let cancelled = false;
    void readAlerts(venueId).then((reading) => {
      if (cancelled) return;
      setState(reading.state);
      setSetup(reading.setup);
    });
    return () => { cancelled = true; };
  }, [venueId]);

  /* Straight from the tap, with everything fetched before: iPhone only asks for permission from one. */
  const toggle = useCallback(() => {
    if (!setup || !venueId || busy) return;
    setBusy(true);
    const work = state === 'on' ? turnOffAlerts(setup).then(() => 'off' as const) : turnOnAlerts(setup, venueId);
    work
      .then((next) => {
        setState(next);
        if (next === 'on') toast.success('Alerts on lock screen are on');
      })
      .catch((error) => {
        toast.error(error instanceof Error ? error.message : 'Could not change lock-screen alerts');
      })
      .finally(() => setBusy(false));
  }, [setup, venueId, busy, state]);

  const test = useCallback(() => {
    if (!setup) return;
    sendTestAlert(setup, TEST_DELAY_SECONDS)
      .then(() => toast.success(`Test alert in ${TEST_DELAY_SECONDS} seconds — lock the phone now`))
      .catch((error) => toast.error(error instanceof Error ? error.message : 'Could not send a test alert'));
  }, [setup]);

  /** Moves the card from the top of the screen to the bottom, on this phone. */
  const putOff = useCallback(() => {
    setLater(true);
    try { localStorage.setItem(LATER_KEY, '1'); } catch { /* private mode: for this visit only */ }
  }, []);

  /** At the top while there is something to do about it and it has not been put off. */
  const wantsAttention = !later && (state === 'off' || state === 'needs-home-screen' || state === 'blocked');

  return { state, busy, toggle, test, putOff, wantsAttention };
}

export type LockScreenAlertsControl = ReturnType<typeof useLockScreenAlerts>;
