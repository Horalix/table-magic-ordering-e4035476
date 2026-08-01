import { useEffect, useState } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { RealtimeChannel } from '@supabase/supabase-js';

/**
 * One realtime channel per tab, translated into React Query invalidations.
 *
 * What this replaces: every staff screen opened its own unfiltered subscription
 * to four to six tables and ran a *full* refetch on any event — the floor
 * monitor did seven queries per event. A guest placing a six-item order emits
 * one `orders` INSERT plus six `order_items` INSERTs, so that single order
 * caused seven full refetches on every open staff device. Cost scaled with
 * floor activity multiplied by devices, which is exactly backwards: the busier
 * the restaurant, the slower its screens.
 *
 * Three properties do the work, in descending order of impact:
 *
 *  1. **Coalescing.** A trailing debounce per query key turns that burst of
 *     seven into one refetch.
 *  2. **Targeted invalidation.** Each table maps to the query keys that
 *     actually depend on it, and React Query only refetches keys with a live
 *     observer — so a monitor tab does no work for a kitchen-only key.
 *  3. **One channel.** The kitchen alone used to open two.
 *
 * Deliberately NOT done: server-side `postgres_changes` filters (single-column
 * equality only, and a waiter's set of tables changes mid-shift, which would
 * mean tearing down and re-subscribing the channel during service), and
 * patching `payload.new` into the cache as a general rule (the kitchen row is a
 * four-table join, so the payload lacks the table number — reconstructing it
 * client-side is exactly the drift that makes a kitchen screen quietly wrong).
 */

export type ConnectionState = 'connecting' | 'live' | 'reconnecting';

/** Query keys, in one place so the map below cannot drift from its consumers. */
export const staffKeys = {
  orders: ['staff', 'orders'] as const,
  printable: ['staff', 'printable'] as const,
  allDay: ['staff', 'all-day'] as const,
  waiterCalls: ['staff', 'waiter-calls'] as const,
  billRequests: ['staff', 'bill-requests'] as const,
  sessions: ['staff', 'sessions'] as const,
  tables: ['staff', 'tables'] as const,
  sections: ['staff', 'sections'] as const,
  waiters: ['staff', 'waiters'] as const,
  assignments: ['staff', 'assignments'] as const,
  settings: ['staff', 'settings'] as const,
  tickets: ['staff', 'tickets'] as const,
};

type Key = readonly unknown[];

/** Which queries a change to each table can possibly affect. */
const TABLE_TO_KEYS: Record<string, Key[]> = {
  orders: [staffKeys.orders, staffKeys.printable, staffKeys.allDay],
  order_items: [staffKeys.orders, staffKeys.allDay],
  order_ticket_events: [staffKeys.tickets],
  waiter_calls: [staffKeys.waiterCalls],
  bill_requests: [staffKeys.billRequests],
  table_sessions: [staffKeys.sessions, staffKeys.tables],
  tables: [staffKeys.tables],
  sections: [staffKeys.sections],
  waiters: [staffKeys.waiters],
  section_assignments: [staffKeys.assignments],
  restaurant_settings: [staffKeys.settings],
};

const WATCHED_TABLES = Object.keys(TABLE_TO_KEYS);

/** A caller that just wants to know an event happened — e.g. to play a sound. */
export type EventListener = (table: string, eventType: string) => void;

const DEBOUNCE_MS = 250;
/** Slower than the rest: it is a summary, and staleness there is invisible. */
const SLOW_KEYS = new Set([staffKeys.allDay.join('|')]);
const SLOW_DEBOUNCE_MS = 750;
const POLL_MS = 15_000;

class StaffRealtime {
  private channel: RealtimeChannel | null = null;
  private refCount = 0;
  private client: QueryClient | null = null;
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private poll: ReturnType<typeof setInterval> | undefined;

  private state: ConnectionState = 'connecting';
  private stateListeners = new Set<(s: ConnectionState) => void>();
  private eventListeners = new Set<EventListener>();

  getState = () => this.state;

  onState(listener: (s: ConnectionState) => void) {
    this.stateListeners.add(listener);
    return () => { this.stateListeners.delete(listener); };
  }

  onEvent(listener: EventListener) {
    this.eventListeners.add(listener);
    return () => { this.eventListeners.delete(listener); };
  }

  private setState(next: ConnectionState) {
    if (this.state === next) return;
    this.state = next;
    this.stateListeners.forEach((l) => l(next));
  }

  /** Coalesced invalidation — a burst of events becomes one refetch per key. */
  private invalidate(key: Key) {
    const id = key.join('|');
    clearTimeout(this.timers.get(id));
    const delay = SLOW_KEYS.has(id) ? SLOW_DEBOUNCE_MS : DEBOUNCE_MS;
    this.timers.set(id, setTimeout(() => {
      this.timers.delete(id);
      void this.client?.invalidateQueries({ queryKey: key });
    }, delay));
  }

  private invalidateAll() {
    Object.values(staffKeys).forEach((key) => {
      void this.client?.invalidateQueries({ queryKey: key });
    });
  }

  acquire(client: QueryClient) {
    this.client = client;
    this.refCount += 1;
    if (this.channel) return;

    const channel = supabase.channel('staff-realtime');

    for (const table of WATCHED_TABLES) {
      channel.on('postgres_changes', { event: '*', schema: 'public', table }, (payload) => {
        // Notified first, and synchronously: an alert chime must not wait on a
        // debounce or a refetch. Latency to the human is what matters.
        this.eventListeners.forEach((l) => l(table, payload.eventType));
        TABLE_TO_KEYS[table]?.forEach((key) => this.invalidate(key));
      });
    }

    channel.subscribe((status) => {
      this.setState(
        status === 'SUBSCRIBED' ? 'live'
          : status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED' ? 'reconnecting'
            : 'connecting',
      );
      // Catch up on anything missed while the socket was down.
      if (status === 'SUBSCRIBED') this.invalidateAll();
    });

    this.channel = channel;

    // The fallback that makes a dropped socket "slightly stale" instead of
    // "silently frozen". Only runs while not live.
    this.poll = setInterval(() => {
      if (this.state !== 'live') this.invalidateAll();
    }, POLL_MS);
  }

  release() {
    this.refCount = Math.max(0, this.refCount - 1);
    if (this.refCount > 0) return;

    this.timers.forEach((t) => clearTimeout(t));
    this.timers.clear();
    clearInterval(this.poll);
    this.poll = undefined;

    if (this.channel) {
      void supabase.removeChannel(this.channel);
      this.channel = null;
    }
    this.setState('connecting');
  }
}

const realtime = new StaffRealtime();

/**
 * Subscribe this screen to live staff data.
 *
 * Ref-counted, so several screens mounted at once share one channel and the
 * last to unmount tears it down.
 */
export function useStaffRealtime(): ConnectionState {
  const client = useQueryClient();
  const [state, setState] = useState<ConnectionState>(realtime.getState());

  useEffect(() => {
    const off = realtime.onState(setState);
    realtime.acquire(client);
    setState(realtime.getState());
    return () => { off(); realtime.release(); };
  }, [client]);

  return state;
}

/** React to raw events — for sounds and notifications, not for data. */
export function useStaffRealtimeEvent(listener: EventListener) {
  useEffect(() => realtime.onEvent(listener), [listener]);
}

export const __realtimeForTests = realtime;
