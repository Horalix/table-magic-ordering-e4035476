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
  // Healthy is quiet — a dot and a word, no pill — so the header's pills are
  // only ever things that need a person. Losing the connection is one of them.
  const style =
    state === 'live' ? 'text-muted-foreground px-0'
      : state === 'connecting' ? 'bg-muted text-muted-foreground px-2'
        : 'bg-destructive/10 text-destructive px-2';

  const dot =
    state === 'live' ? 'bg-[hsl(150_50%_40%)] breathe'
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
      className={`inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-sans font-semibold py-0.5 rounded-full ${style} ${className}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${dot}`} aria-hidden />
      {label}
    </span>
  );
};

export default ConnectionPill;
