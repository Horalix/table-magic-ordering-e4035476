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
 * a slow network never blocks ordering, and are dropped silently on failure:
 * analytics must never be able to break a guest's order.
 */
import { supabase } from '@/integrations/supabase/client';

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

interface QueuedEvent {
  event: AnalyticsEvent;
  props: EventProps;
  at: string;
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

async function flush(): Promise<void> {
  if (timer) { clearTimeout(timer); timer = null; }
  if (buffer.length === 0 || !enabled) return;

  const batch = buffer;
  buffer = [];

  try {
    const { error } = await supabase.rpc('record_analytics_events' as never, {
      _visit_id: visitId(),
      _events: batch as never,
    } as never);
    // A missing RPC (older database) permanently disables tracking rather than
    // retrying forever on every interaction.
    if (error && /function .* does not exist/i.test(error.message)) enabled = false;
  } catch {
    // Never surface an analytics failure to the guest.
  }
}

/** Record one product event. Non-blocking and failure-tolerant by design. */
export function track(event: AnalyticsEvent, props: EventProps = {}): void {
  if (!enabled || typeof window === 'undefined') return;

  buffer.push({ event, props: sanitize(props), at: new Date().toISOString() });

  if (buffer.length >= MAX_BUFFER) {
    void flush();
    return;
  }
  if (!timer) timer = setTimeout(() => { void flush(); }, FLUSH_INTERVAL_MS);
}

/** Send anything buffered — used when the page is being hidden or closed. */
export function flushAnalytics(): void {
  void flush();
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushAnalytics();
  });
}

/** Test seam: reset module state between cases. */
export function __resetAnalyticsForTests(): void {
  buffer = [];
  if (timer) { clearTimeout(timer); timer = null; }
  enabled = true;
}

export const __analyticsInternals = { sanitize, BLOCKED_KEYS, MAX_STRING };
