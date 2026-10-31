import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { answeredVenueId, currentVenueSlug, type StaffRoleRow } from '@/lib/current-venue';
import { DEFAULT_VENUE, VENUES } from '@/lib/venues';

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
 *
 * Two restaurants (docs/two-restaurants.md). Realtime checks each change
 * against the access rules as the signed-in user, but without the x-venue
 * header the screens' own requests carry — so for it the restaurant is the
 * one the account works at, and for the owner, who works at none, La Soul.
 * The owner looking at Vera Italia would hear only La Soul's changes: Vera's
 * screens never moving, and La Soul's orders chiming on them. So:
 *
 *  - a change that names another restaurant than the one shown is dropped
 *    before any listener or refetch hears it;
 *  - when the socket cannot see the restaurant shown at all, its events are
 *    dropped and the screens refetch every 5 seconds instead (the 'poll'
 *    refresh, which every screen already handles).
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

/**
 * Why a screen is being asked to reload everything.
 *
 *  - `poll`       the socket is down; this is the 15-second fallback tick
 *  - `subscribed` the socket (re)connected; catch up on what was missed
 *  - `safety`     slow heartbeat while live, for the event a socket that says
 *                 SUBSCRIBED has quietly dropped
 *  - `visible`    the tab came back to the foreground (a phone in a pocket)
 *  - `online`     the device got its network back
 */
export type RefreshReason = 'poll' | 'subscribed' | 'safety' | 'visible' | 'online';
export type RefreshListener = (reason: RefreshReason) => void;

const DEBOUNCE_MS = 250;
/** Slower than the rest: it is a summary, and staleness there is invisible. */
const SLOW_KEYS = new Set([staffKeys.allDay.join('|')]);
const SLOW_DEBOUNCE_MS = 750;
const POLL_MS = 15_000;
/**
 * Even a "live" socket is re-checked this often.
 *
 * Supabase realtime can report SUBSCRIBED while a server-side hiccup has
 * dropped an event, and a kitchen board missing one ticket looks exactly like
 * a quiet minute. A minute's worst-case staleness is the price of never
 * trusting the socket completely. Only plain listeners hear this; the React
 * Query keys already refetch on events.
 */
const SAFETY_MS = 60_000;
/** How often screens refetch while the socket cannot see the restaurant they show. */
const FOREIGN_POLL_MS = 5_000;

/**
 * The restaurant the screens show (what the database answers their requests
 * for) and the one realtime reports changes of. The same for every waiter and
 * restaurant admin; different for the owner looking at any restaurant but
 * La Soul, and for an account working at both that is shown the one it does
 * not manage.
 */
export interface VenueLens {
  shown: string;
  socket: string;
}

/** Both sides of the lens, from the account's roles and the restaurant this page names. */
export function venueLens(rows: readonly StaffRoleRow[], askedSlug: string | null): VenueLens {
  const fallback = VENUES[DEFAULT_VENUE].dbId;
  const asked = askedSlug ? VENUES[askedSlug]?.dbId ?? null : null;
  return { shown: answeredVenueId(rows, asked, fallback), socket: answeredVenueId(rows, null, fallback) };
}

/** The restaurant a change belongs to, when its payload says (a DELETE may carry only the key). */
function venueOfChange(payload: { new?: unknown; old?: unknown }): string | null {
  for (const row of [payload.new, payload.old]) {
    const venue = (row as { venue_id?: unknown } | null | undefined)?.venue_id;
    if (typeof venue === 'string' && venue) return venue;
  }
  return null;
}

/** The signed-in account's roles; null when they cannot be read (signed out, an old database). */
async function loadOwnRoles(): Promise<StaffRoleRow[] | null> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const userId = session?.user?.id;
    if (!userId) return null;
    // '*': venue_id is absent on a database from before the second restaurant.
    const { data, error } = await supabase.from('user_roles').select('*').eq('user_id', userId);
    if (error || !data) return null;
    return data as unknown as StaffRoleRow[];
  } catch {
    return null;
  }
}

class StaffRealtime {
  private channel: RealtimeChannel | null = null;
  private refCount = 0;
  private client: QueryClient | null = null;
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private poll: ReturnType<typeof setInterval> | undefined;
  private safety: ReturnType<typeof setInterval> | undefined;
  private refreshListeners = new Set<RefreshListener>();
  private detachWindow: (() => void) | null = null;
  /** Unknown until the roles load; until then every change counts, as before. */
  private lens: VenueLens | null = null;
  private foreignPoll: ReturnType<typeof setInterval> | undefined;
  /** Bumped on teardown, so roles that arrive after it are ignored. */
  private generation = 0;

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

  /**
   * Hear every moment a screen should reload from scratch.
   *
   * The polling fallback and the reconnect catch-up used to reach only React
   * Query keys, and the kitchen board, the floor monitor and the waiter phone
   * keep their data in plain state. So on restaurant wifi the pill said
   * "refreshing every 15s" while those three screens refreshed never.
   */
  onRefresh(listener: RefreshListener) {
    this.refreshListeners.add(listener);
    return () => { this.refreshListeners.delete(listener); };
  }

  private refresh(reason: RefreshReason) {
    this.refreshListeners.forEach((l) => {
      // One broken screen must not stop the others hearing the tick.
      try { l(reason); } catch { /* the screen reports its own failure */ }
    });
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

  /** May this change reach the screens? Only one of the restaurant they show. */
  private accepts(payload: { new?: unknown; old?: unknown }): boolean {
    const lens = this.lens;
    if (!lens) return true;
    // The socket hears another restaurant only: the screens poll instead.
    if (lens.shown !== lens.socket) return false;
    const venue = venueOfChange(payload);
    return venue === null || venue === lens.shown;
  }

  /**
   * Which restaurant the screens show and which the socket hears. When they
   * differ the screens refetch every few seconds, since no event of theirs
   * will ever arrive.
   */
  setLens(lens: VenueLens | null) {
    this.lens = lens;
    clearInterval(this.foreignPoll);
    this.foreignPoll = undefined;
    if (lens && lens.shown !== lens.socket && this.channel) {
      this.foreignPoll = setInterval(() => {
        this.invalidateAll();
        this.refresh('poll');
      }, FOREIGN_POLL_MS);
    }
  }

  /** True while the screens follow their restaurant by polling rather than by the socket. */
  followsByPolling = () => this.foreignPoll !== undefined;

  acquire(client: QueryClient) {
    this.client = client;
    this.refCount += 1;
    if (this.channel) return;

    const channel = supabase.channel('staff-realtime');

    for (const table of WATCHED_TABLES) {
      channel.on('postgres_changes', { event: '*', schema: 'public', table }, (payload) => {
        // The other restaurant's change: no chime, no refetch.
        if (!this.accepts(payload)) return;
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
      if (status === 'SUBSCRIBED') {
        this.invalidateAll();
        this.refresh('subscribed');
      }
    });

    this.channel = channel;

    // Which restaurant this tab shows, against the one the socket hears.
    const generation = ++this.generation;
    void loadOwnRoles().then((rows) => {
      if (!rows || generation !== this.generation || !this.channel) return;
      this.setLens(venueLens(rows, currentVenueSlug()));
    });

    // The fallback that makes a dropped socket "slightly stale" instead of
    // "silently frozen". Only runs while not live.
    this.poll = setInterval(() => {
      if (this.state !== 'live') {
        this.invalidateAll();
        this.refresh('poll');
      }
    }, POLL_MS);

    this.safety = setInterval(() => {
      if (this.state === 'live') this.refresh('safety');
    }, SAFETY_MS);

    // A phone that was in a pocket, or a tablet whose wifi blinked, has missed
    // events it will never be sent. Reload the moment it is looked at again.
    if (typeof window !== 'undefined' && typeof document !== 'undefined') {
      const onVisible = () => {
        if (document.visibilityState !== 'visible') return;
        this.invalidateAll();
        this.refresh('visible');
      };
      const onOnline = () => { this.invalidateAll(); this.refresh('online'); };
      document.addEventListener('visibilitychange', onVisible);
      window.addEventListener('online', onOnline);
      this.detachWindow = () => {
        document.removeEventListener('visibilitychange', onVisible);
        window.removeEventListener('online', onOnline);
      };
    }
  }

  release() {
    this.refCount = Math.max(0, this.refCount - 1);
    if (this.refCount > 0) return;

    this.generation += 1;
    this.setLens(null);
    this.timers.forEach((t) => clearTimeout(t));
    this.timers.clear();
    clearInterval(this.poll);
    this.poll = undefined;
    clearInterval(this.safety);
    this.safety = undefined;
    this.detachWindow?.();
    this.detachWindow = null;

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

/**
 * Reload on every poll tick, reconnect, safety heartbeat, return to the
 * foreground and network recovery. A screen that keeps its data in plain state
 * must use this, or it freezes silently whenever the socket does.
 */
export function useStaffRefresh(listener: RefreshListener) {
  useEffect(() => realtime.onRefresh(listener), [listener]);
}

/**
 * For a screen that keeps its own data (the admin's dashboard, orders, tables,
 * tonight's floor): reload when one of `tables` changes at the restaurant it
 * shows, and on every poll tick, reconnect, safety heartbeat, return to the
 * foreground and network recovery. On the tab's one shared channel, so the
 * owner looking at Vera Italia gets Vera's changes every few seconds and
 * never a La Soul one. `tables` must be among the watched tables above.
 */
export function useStaffTables(tables: readonly string[], onChange: () => void): ConnectionState {
  const state = useStaffRealtime();
  const latest = useRef(onChange);
  useEffect(() => { latest.current = onChange; }, [onChange]);
  const watched = tables.join('|');
  useStaffRealtimeEvent(useCallback((table: string) => {
    if (watched.split('|').includes(table)) latest.current();
  }, [watched]));
  useStaffRefresh(useCallback(() => { latest.current(); }, []));
  return state;
}

/**
 * A trailing-debounced version of `fn`.
 *
 * A six-item order is seven realtime events. Running a full refetch on each
 * meant seven overlapping requests per device, finishing in any order. This
 * turns the burst into one call ~300ms after it ends. The returned function is
 * stable and always runs the latest `fn`.
 */
export function useCoalesced(fn: () => void, delayMs = 300): () => void {
  const fnRef = useRef(fn);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => { fnRef.current = fn; }, [fn]);
  useEffect(() => () => clearTimeout(timer.current), []);
  return useCallback(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => fnRef.current(), delayMs);
  }, [delayMs]);
}

/**
 * Drop out-of-order responses.
 *
 * Two refetches in flight can resolve in either order, and the older one
 * landing last puts a stale board back on screen: a bumped ticket reappears, a
 * cleared call comes back. `begin()` stamps a request, and the closure it
 * returns says whether that request is still the newest when it lands.
 */
export function useLatestRequest(): () => () => boolean {
  const seq = useRef(0);
  return useCallback(() => {
    seq.current += 1;
    const mine = seq.current;
    return () => mine === seq.current;
  }, []);
}

export const __realtimeForTests = realtime;
