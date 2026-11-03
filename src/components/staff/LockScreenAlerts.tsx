import { BellOff, BellRing, Smartphone } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import type { LockScreenAlertsControl } from '@/hooks/useLockScreenAlerts';
import { isIos, type AlertsState } from '@/lib/push-alerts';

function explain(state: AlertsState, venueName: string | null): string {
  switch (state) {
    case 'on':
      return 'New orders, calls and bills at your tables buzz this phone, even when it is locked. Sound and vibration follow the phone\'s notification settings.';
    case 'off':
      return 'Get a buzz for new orders, calls and bills at your tables, even with the phone locked or the app in the background.';
    case 'needs-home-screen':
      return 'On iPhone and iPad this works only from the app on the Home Screen (iOS 16.4 or later): tap Share, then Add to Home Screen, open the app from there and sign in again.';
    case 'blocked':
      return isIos()
        ? 'Notifications are blocked for this app. Allow them in Settings → Notifications, then come back.'
        : 'Notifications are blocked for this site. Allow them in the browser\'s site settings (the icon left of the address), then come back.';
    case 'unsupported':
      return isIos()
        ? 'This iPhone needs iOS 16.4 or later for lock-screen alerts.'
        : 'This browser cannot show lock-screen alerts. Use Chrome on Android, or the Home Screen app on iPhone.';
    case 'not-ready':
      return `Lock-screen alerts are not switched on${venueName ? ` for ${venueName}` : ''} yet.`;
    default:
      return '';
  }
}

/**
 * "Alerts on lock screen" on the waiter screen: one switch. It asks the phone
 * for permission only when tapped, never on its own.
 */
const LockScreenAlerts = ({ alerts, venueName }: { alerts: LockScreenAlertsControl; venueName: string | null }) => {
  const { state, busy, toggle, test, putOff, wantsAttention } = alerts;
  if (state === 'checking') return null;
  const on = state === 'on';
  const actionable = on || state === 'off';
  const Icon = on ? BellRing : state === 'needs-home-screen' ? Smartphone : BellOff;

  return (
    <div
      data-testid="lock-screen-alerts"
      className={`rounded-xl border px-4 py-3 font-sans ${wantsAttention ? 'border-primary/30 bg-primary/5' : 'border-border/60 bg-muted/30'}`}
    >
      <div className="flex items-center gap-3">
        <Icon className={`w-5 h-5 shrink-0 ${on ? 'text-primary' : 'text-muted-foreground'}`} aria-hidden />
        <label htmlFor="lock-screen-alerts" className="flex-1 min-w-0 text-sm font-semibold text-foreground">
          Alerts on lock screen
          {actionable && <span className="ml-2 text-xs font-normal text-muted-foreground">{on ? 'On' : 'Off'}</span>}
        </label>
        <Switch
          id="lock-screen-alerts"
          checked={on}
          disabled={!actionable || busy}
          onCheckedChange={toggle}
          className="scale-125 origin-right"
        />
      </div>
      <p className="mt-1.5 text-xs text-muted-foreground leading-relaxed">{explain(state, venueName)}</p>
      {(on || wantsAttention) && (
        <div className="mt-2 flex flex-wrap gap-2">
          {on && (
            <button type="button" onClick={test} className="min-h-[40px] px-3 rounded-lg border border-border bg-background text-xs font-semibold">
              Send a test
            </button>
          )}
          {wantsAttention && (
            <button type="button" onClick={putOff} className="min-h-[40px] px-3 rounded-lg text-xs font-semibold text-muted-foreground">
              Not now
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default LockScreenAlerts;
