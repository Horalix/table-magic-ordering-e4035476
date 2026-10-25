import React from 'react';
import type { ConnectionState } from '@/lib/realtime';

/**
 * Whether this screen can be trusted right now.
 *
 * A staff screen that has silently stopped updating is worse than one that is
 * obviously broken: it looks like a quiet night, so nobody investigates. The
 * kitchen had this indicator and the two floor screens did not — they showed a
 * dropped socket exactly the same as an empty restaurant.
 *
 * Never colour alone: each state has its own words, and the reconnecting state
 * says what the app is doing about it rather than only that something is wrong.
 */
const ConnectionPill = ({ state, className = '' }: { state: ConnectionState; className?: string }) => {
  const style =
    state === 'live' ? 'bg-primary/10 text-primary'
      : state === 'connecting' ? 'bg-muted text-muted-foreground'
        : 'bg-destructive/10 text-destructive';

  const dot =
    state === 'live' ? 'bg-primary breathe'
      : state === 'connecting' ? 'bg-muted-foreground'
        : 'bg-destructive animate-pulse';

  const label =
    state === 'live' ? 'Live'
      : state === 'connecting' ? 'Connecting…'
        : 'Offline · retrying';

  return (
    <span
      role="status"
      aria-live="polite"
      // Short enough to stay on one line next to a name on a phone; the
      // tooltip and screen readers still get what the screen is doing.
      title={state === 'reconnecting' ? 'Live updates dropped — refreshing every 15 seconds until they are back' : undefined}
      className={`inline-flex items-center gap-1 whitespace-nowrap text-xs font-sans font-semibold px-2 py-0.5 rounded-full ${style} ${className}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${dot}`} aria-hidden />
      {label}
    </span>
  );
};

export default ConnectionPill;
