/**
 * First-party, privacy-conscious product analytics.
 *
 * What this deliberately does NOT do:
 *   - no third-party trackers, no cookies, no cross-site identifiers
 *   - no card data, no payment credentials, no provider payloads
 *   - no free-text (item notes, comments, guest names) — only ids and counts
 *   - no attempt to identify a person across visits
 *
 * What it does: records the handful of product events needed to answer
 * "did that change help?" — the funnel, attachment, and reliability signals in
 * docs/product-metrics.md. Events are buffered and flushed in small batches so
 * a slow network never blocks ordering. A batch that fails is put back and
 * tried again with the next one, up to a small cap, so a dropped connection
 * between courses costs nothing; past the cap the oldest events go first.
 * Analytics must never be able to break a guest's order, so nothing here
 * throws, and nothing on the ordering path waits for it.
 *
 * Delivery is `fetch(..., { keepalive: true })` straight to the PostgREST RPC
 * endpoint rather than through the Supabase client. keepalive is what lets a
 * request outlive the page: a guest who places an order and is sent to the
 * card provider, or who locks their phone, takes the tab down with the last
 * events still in the buffer, and an ordinary request is cancelled with it.
 * Those last events — order_placed above all — are the ones the funnel most
 * needs.
 */

/** The complete event vocabulary. Adding one here is a deliberate act. */
export type AnalyticsEvent =
  // Discovery
  | 'menu_viewed'
  | 'category_viewed'
  | 'search_performed'
  | 'search_no_results'
  | 'item_viewed'
  // Cart
  | 'item_added'
  | 'cart_item_removed'
  | 'cart_viewed'
  // Recommendations
  | 'suggestion_shown'
  | 'suggestion_accepted'
  | 'suggestion_dismissed'
  // Checkout
  | 'checkout_opened'
  | 'checkout_submitted'
  | 'order_placed'
  | 'order_failed'
  // Payment
  | 'payment_started'
  | 'payment_confirmed'
  | 'payment_failed'
  | 'payment_delayed'
  | 'payment_switched_to_table'
  // Post-order
  | 'tab_viewed'
  | 'reorder_tapped'
  | 'waiter_called'
  | 'bill_requested'
  | 'feedback_submitted';

/**
 * Allowed property values. Scalars only — the type system is the guard that
 * stops someone attaching a free-text note or a customer name to an event.
 */
type PropValue = string | number | boolean | null;
export type EventProps = Record<string, PropValue>;

/** Keys we refuse to send even if a caller passes them. Defence in depth. */
const BLOCKED_KEYS = new Set([
  'notes', 'note', 'comment', 'guest_name', 'name', 'email', 'phone',
  'card', 'pan', 'cvv', 'client_secret', 'session_token', 'qr_token', 'token',
]);

const MAX_STRING = 64;
const FLUSH_INTERVAL_MS = 8_000;
const MAX_BUFFER = 20;
/** The server refuses a batch larger than this outright, so never send one. */
const MAX_BATCH = 25;
/**
 * How much unsent history to hold while the network is down. A visit rarely
 * produces more than this, and an unbounded buffer on a phone that never
 * reconnects is a slow memory leak.
 */
const MAX_QUEUED = 100;

interface QueuedEvent {
  event: AnalyticsEvent;
  props: EventProps;
  at: string;
}

interface Endpoint {
  url: string;
  headers: Record<string, string>;
}

let buffer: QueuedEvent[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let enabled = true;

/** Per-visit, per-device id. Random, not derived from anything about a person. */
function visitId(): string {
  if (typeof sessionStorage === 'undefined') return 'server';
  const existing = sessionStorage.getItem('lasoul-visit');
  if (existing) return existing;
  const id = (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
    ? crypto.randomUUID()
    : `v_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  sessionStorage.setItem('lasoul-visit', id);
  return id;
}

function sanitize(props: EventProps): EventProps {
  const clean: EventProps = {};
  for (const [key, value] of Object.entries(props)) {
    if (BLOCKED_KEYS.has(key.toLowerCase())) continue;
    if (value === null || typeof value === 'boolean' || typeof value === 'number') {
      clean[key] = value;
    } else if (typeof value === 'string') {
      clean[key] = value.slice(0, MAX_STRING);
    }
  }
  return clean;
}

/**
 * Where events go, read from the same environment variables the Supabase
 * client uses (src/integrations/supabase/client.ts). Resolved per flush so a
 * build or a test without configuration simply sends nothing instead of
 * failing at import.
 */
function endpoint(): Endpoint | null {
  const base = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
  if (!base || !key) return null;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    apikey: key,
  };
  // A legacy anon key is a JWT and doubles as the bearer token, which is what
  // supabase-js sends for an anonymous caller. The newer publishable keys are
  // not JWTs and must not be presented as one.
  if (key.startsWith('eyJ')) headers.Authorization = `Bearer ${key}`;
  return { url: `${base.replace(/\/+$/, '')}/rest/v1/rpc/record_analytics_events`, headers };
}

/**
 * A missing RPC (an older database) permanently disables tracking rather than
 * retrying forever on every interaction. PostgREST reports it as PGRST202;
 * older versions said so only in the message.
 */
function isMissingFunction(body: { code?: string; message?: string } | null): boolean {
  if (!body) return false;
  return body.code === 'PGRST202' || /function .* does not exist/i.test(body.message ?? '');
}

/** Keep at most MAX_QUEUED events, dropping the oldest. */
function cap(events: QueuedEvent[]): QueuedEvent[] {
  return events.length > MAX_QUEUED ? events.slice(events.length - MAX_QUEUED) : events;
}

function schedule(): void {
  if (!timer) timer = setTimeout(() => { void flush(); }, FLUSH_INTERVAL_MS);
}

/**
 * Send one batch. Resolves to true when the batch is finished with — delivered,
 * or rejected for a reason a retry cannot fix — and false when it should be
 * tried again.
 */
async function send(batch: QueuedEvent[], target: Endpoint): Promise<boolean> {
  try {
    const response = await fetch(target.url, {
      method: 'POST',
      headers: target.headers,
      body: JSON.stringify({ _visit_id: visitId(), _events: batch }),
      keepalive: true,
    });
    if (response.ok) return true;

    let body: { code?: string; message?: string } | null = null;
    try { body = await response.json(); } catch { /* not JSON: a plain failure */ }
    if (isMissingFunction(body)) {
      enabled = false;
      buffer = [];
      return true;
    }
    // Any other 4xx means this batch itself is unacceptable, and sending it
    // again will not change that. Retrying is for 5xx and for outages.
    return response.status >= 400 && response.status < 500;
  } catch {
    // Offline, or cut off mid-request. Never surface it to the guest.
    return false;
  }
}

async function flush(): Promise<void> {
  if (timer) { clearTimeout(timer); timer = null; }
  if (buffer.length === 0 || !enabled || typeof fetch === 'undefined') return;

  const target = endpoint();
  if (!target) { buffer = []; return; }

  const pending = buffer;
  buffer = [];

  const failed: QueuedEvent[] = [];
  for (let i = 0; i < pending.length && enabled; i += MAX_BATCH) {
    const batch = pending.slice(i, i + MAX_BATCH);
    if (!(await send(batch, target))) failed.push(...batch);
  }

  if (failed.length > 0 && enabled) {
    // Failed events go back in front of anything tracked meanwhile, so the
    // order they reach the server matches the order they happened.
    buffer = cap([...failed, ...buffer]);
    schedule();
  }
}

/** Record one product event. Non-blocking and failure-tolerant by design. */
export function track(event: AnalyticsEvent, props: EventProps = {}): void {
  if (!enabled || typeof window === 'undefined') return;

  buffer = cap([...buffer, { event, props: sanitize(props), at: new Date().toISOString() }]);

  if (buffer.length >= MAX_BUFFER) {
    void flush();
    return;
  }
  schedule();
}

/**
 * Send everything buffered, now.
 *
 * Call it straight after a terminal event — `order_placed` before a redirect
 * to the card provider, for instance — so the event leaves before the page
 * does. The request uses keepalive, so it completes even if navigation starts
 * the moment this returns.
 */
export function flushNow(): void {
  void flush();
}

/** Kept for existing callers; identical to flushNow(). */
export const flushAnalytics = flushNow;

/*
 * Leaving the page. visibilitychange to hidden is the last event many mobile
 * browsers reliably deliver (switching apps, locking the phone); pagehide is
 * the one that fires on a real navigation or tab close, including when the
 * page goes into the back-forward cache. Listening to both covers every way a
 * guest leaves, and flushing an empty buffer twice does nothing.
 */
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushNow();
  });
  window.addEventListener('pagehide', () => flushNow());
}

/** Test seam: reset module state between cases. */
export function __resetAnalyticsForTests(): void {
  buffer = [];
  if (timer) { clearTimeout(timer); timer = null; }
  enabled = true;
}

export const __analyticsInternals = {
  sanitize,
  isMissingFunction,
  flush,
  pending: () => buffer.length,
  isEnabled: () => enabled,
  BLOCKED_KEYS,
  MAX_STRING,
  MAX_BATCH,
  MAX_QUEUED,
};
