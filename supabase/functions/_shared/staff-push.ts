/**
 * Who gets a lock-screen alert, and what it says (notify-staff).
 *
 * The database calls notify-staff when a guest orders, calls a waiter or asks
 * for the bill (20261103090000_staff_push.sql). That function reads the rows
 * with the service role, which passes every access rule — so whose phones
 * ring is decided here, and only from rows of the event's own restaurant.
 * Pure; src/lib/staff-push.test.ts pins every decision.
 *
 *  - The table's waiter (table_sessions.assigned_waiter_id), and only them.
 *  - A table nobody has: every waiter on shift at that restaurant — on the
 *    day's rota (section_assignments), or whose phone opened the waiter
 *    screen there since the trading day began. The waiter phone shows those
 *    tables to everyone too; someone off today, at home, is not woken.
 *  - Never anyone of the other restaurant: a waiter, a rota entry or a phone
 *    registered for the other one is dropped, whoever passed it in.
 */

export type StaffPushSource = "orders" | "waiter_calls" | "bill_requests";
export const STAFF_PUSH_SOURCES: readonly StaffPushSource[] = ["orders", "waiter_calls", "bill_requests"];

export interface PushEventRow {
  id: string;
  venue_id: string;
  table_session_id: string;
  created_at: string;
  status: string;
  /** orders */
  held_reason?: string | null;
  released_to_kitchen_at?: string | null;
  total?: number | null;
  paid_at?: string | null;
  /** waiter_calls: 'assist' or 'pay' */
  reason?: string | null;
}

export interface PushSessionRow {
  id: string;
  venue_id: string;
  assigned_waiter_id: string | null;
  table_number: number | null;
}

export interface PushWaiterRow {
  id: string;
  user_id: string;
  venue_id: string;
  is_active: boolean;
}

export interface PushSubscriptionRow {
  id: string;
  user_id: string;
  venue_id: string;
  endpoint: string;
  keys: { p256dh: string; auth: string };
  last_seen_at: string;
}

export interface RecipientInput {
  /** The restaurant the event belongs to (its row's venue_id). */
  venueId: string;
  session: PushSessionRow | null;
  waiters: readonly PushWaiterRow[];
  /** Waiter ids on today's rota at venueId. */
  rota: readonly string[];
  /** When the trading day began (business_day_range), ISO. */
  dayStart: string;
  subscriptions: readonly PushSubscriptionRow[];
}

export interface Recipients {
  /** `assigned`: the table's waiter; `on_shift`: a table nobody has; `none`: refused. */
  who: "assigned" | "on_shift" | "none";
  userIds: string[];
  subscriptions: PushSubscriptionRow[];
}

const nobody: Recipients = { who: "none", userIds: [], subscriptions: [] };

export function chooseRecipients(input: RecipientInput): Recipients {
  const { venueId, session } = input;
  // An event whose table is not its restaurant's is not sent at all.
  if (!venueId || !session || session.venue_id !== venueId) return nobody;

  const here = input.waiters.filter((w) => w.venue_id === venueId && w.is_active);
  const phones = input.subscriptions.filter((s) => s.venue_id === venueId);

  // A waiter of the other restaurant, or one no longer working, is nobody.
  const assigned = session.assigned_waiter_id ? here.find((w) => w.id === session.assigned_waiter_id) : undefined;

  let userIds: string[];
  if (assigned) {
    userIds = [assigned.user_id];
  } else {
    const rota = new Set(input.rota);
    const dayStart = Date.parse(input.dayStart);
    const openedToday = new Set(phones.filter((s) => Date.parse(s.last_seen_at) >= dayStart).map((s) => s.user_id));
    userIds = [...new Set(here.filter((w) => rota.has(w.id) || openedToday.has(w.user_id)).map((w) => w.user_id))];
  }

  const wanted = new Set(userIds);
  const seen = new Set<string>();
  const subscriptions = phones.filter((s) => {
    if (!wanted.has(s.user_id) || seen.has(s.endpoint)) return false;
    seen.add(s.endpoint);
    return true;
  });
  return { who: assigned ? "assigned" : "on_shift", userIds, subscriptions };
}

/** Long enough for pg_net's queue and a card payment to settle; an older event is not news. */
export const FRESH_MS = 15 * 60_000;

export type SkipReason = "not_placed" | "resolved" | "stale";

/** Why this row is not worth waking anyone for, or null when it is. */
export function skipReason(source: StaffPushSource, event: PushEventRow, now = Date.now()): SkipReason | null {
  // A card order is news once it is paid (the database calls again then).
  if (source === "orders" && ["awaiting_payment", "payment_failed", "cancelled"].includes(event.status)) {
    return "not_placed";
  }
  if (source !== "orders" && event.status === "resolved") return "resolved";
  const at = Math.max(Date.parse(event.created_at), event.paid_at ? Date.parse(event.paid_at) : 0);
  return now - at <= FRESH_MS ? null : "stale";
}

export type PushKind = "order" | "held" | "call" | "pay" | "bill";

export interface StaffPushMessage {
  kind: PushKind;
  title: string;
  body: string;
  /** One notification per event: a second order from the table is its own alert. */
  tag: string;
  url: string;
  venue: string;
  at: string;
}

export interface OrderLine {
  quantity: number;
  name: string;
}

const MAX_LINES = 4;

/** "2× Ćevapi, 1× Espresso", the first four lines and a count of the rest. */
export function orderLines(lines: readonly OrderLine[]): string {
  const shown = lines.slice(0, MAX_LINES).map((l) => `${l.quantity}× ${l.name}`);
  const rest = lines.length - MAX_LINES;
  return rest > 0 ? `${shown.join(", ")} +${rest} more` : shown.join(", ");
}

/** The words a waiter reads on the lock screen, in the floor screens' own terms. */
export function describeEvent(
  source: StaffPushSource,
  event: PushEventRow,
  ctx: { tableNumber: number | null; venueName: string; lines?: readonly OrderLine[]; now?: number },
): StaffPushMessage {
  const table = ctx.tableNumber == null ? "A table" : `Table ${ctx.tableNumber}`;
  const base = { tag: `${source}:${event.id}`, url: "/waiter", venue: ctx.venueName, at: new Date(ctx.now ?? Date.now()).toISOString() };
  const withVenue = (text: string) => [text, ctx.venueName].filter(Boolean).join(" · ");

  if (source === "orders") {
    const items = orderLines(ctx.lines ?? []);
    const total = typeof event.total === "number" && event.total > 0 ? `${event.total.toFixed(2)} KM` : "";
    const what = [items, total].filter(Boolean).join(" · ");
    // Held (order_hold_reason): nothing reaches the kitchen until someone confirms it.
    if (event.held_reason && !event.released_to_kitchen_at) {
      return { ...base, kind: "held", title: `Order to confirm · ${table}`, body: withVenue(["Held until you confirm it", what].filter(Boolean).join(" — ")) };
    }
    return { ...base, kind: "order", title: `New order · ${table}`, body: withVenue(what || "Open the waiter screen to see it") };
  }
  if (source === "waiter_calls") {
    return event.reason === "pay"
      ? { ...base, kind: "pay", title: `Wants to pay · ${table}`, body: withVenue("A guest asked to pay") }
      : { ...base, kind: "call", title: `Calling you · ${table}`, body: withVenue("A guest asked for a waiter") };
  }
  return { ...base, kind: "bill", title: `Wants the bill · ${table}`, body: withVenue("Bring the bill") };
}
