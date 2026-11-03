/**
 * notify-staff, without the database: what each call does
 * (../notify-staff/index.ts connects it to the service role).
 *
 *   GET                        { configured, publicKey }: the key phones subscribe with.
 *   POST { table, id }         from the database (pg_net): an orders, waiter_calls
 *                              or bill_requests row has just gone in.
 *   POST { action: "test", endpoint, delay_seconds? }
 *                              with the waiter's sign-in: a test alert to one
 *                              phone of theirs, now or after a few seconds.
 *
 * The event call carries nothing to trust: the row is read here, an alert
 * goes out only for one written in the last 15 minutes, and each only once
 * (claim). Whose phones ring is chooseRecipients (./staff-push.ts).
 * src/lib/notify-staff.test.ts drives every path with an in-memory backend.
 */
import {
  chooseRecipients, describeEvent, skipReason, STAFF_PUSH_SOURCES,
  type OrderLine, type PushEventRow, type PushSessionRow, type PushSubscriptionRow, type PushWaiterRow,
  type StaffPushSource,
} from "./staff-push.ts";
import { sendPush, vapidReady, type Vapid } from "./web-push.ts";

export interface NotifyContext {
  session: PushSessionRow | null;
  venueName: string;
  waiters: PushWaiterRow[];
  rota: string[];
  dayStart: string;
}

/** Reads and writes, every one of them limited to what it names. */
export interface NotifyBackend {
  loadEvent(source: StaffPushSource, id: string): Promise<PushEventRow | null>;
  /** True the first time only (staff_push_claim). */
  claim(source: StaffPushSource, id: string): Promise<boolean>;
  /** The table, the restaurant's name, waiters and today's rota — of this restaurant only. */
  loadContext(venueId: string, sessionId: string): Promise<NotifyContext>;
  /** The phones registered at this restaurant only. */
  loadPhones(venueId: string): Promise<PushSubscriptionRow[]>;
  loadLines(orderId: string): Promise<OrderLine[]>;
  forgetPhones(ids: string[]): Promise<void>;
  /** The signed-in user a bearer token belongs to. */
  userOf(token: string): Promise<string | null>;
  /** That user's phone with that endpoint, with its restaurant's name. */
  phoneOf(userId: string, endpoint: string): Promise<(PushSubscriptionRow & { venueName: string }) | null>;
}

export interface NotifyDeps {
  backend: NotifyBackend;
  vapid: Vapid;
  fetcher?: typeof fetch;
  /** The edge runtime's EdgeRuntime.waitUntil: work after the answer. */
  waitUntil?: (work: Promise<unknown>) => void;
  log?: (line: string) => void;
}

export interface NotifyReply {
  status: number;
  body: unknown;
}

/** A phone off the network for longer gets nothing: by then the waiter screen shows it anyway. */
export const TTL_SECONDS = 10 * 60;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The push service's host only: an endpoint is a secret address, not for logs. */
const hostOf = (endpoint: string) => { try { return new URL(endpoint).host; } catch { return "?"; } };

async function deliver(deps: NotifyDeps, phones: PushSubscriptionRow[], message: unknown) {
  const results = await Promise.all(phones.map((p) =>
    sendPush({ endpoint: p.endpoint, keys: p.keys }, message, deps.vapid, { ttl: TTL_SECONDS, urgency: "high" }, deps.fetcher)));
  // The phone uninstalled the app, cleared the site or turned notifications off.
  const gone = phones.filter((_, i) => results[i].gone).map((p) => p.id);
  if (gone.length) await deps.backend.forgetPhones(gone);
  for (const r of results) {
    if (!r.ok && !r.gone) deps.log?.(`notify-staff: ${hostOf(r.endpoint)} answered ${r.status}: ${r.error ?? ""}`);
  }
  return {
    sent: results.filter((r) => r.ok).length,
    removed: gone.length,
    failed: results.filter((r) => !r.ok && !r.gone).length,
  };
}

async function onEvent(deps: NotifyDeps, source: StaffPushSource, id: string, now: number): Promise<NotifyReply> {
  const { backend } = deps;
  const event = await backend.loadEvent(source, id);
  if (!event) return { status: 404, body: { skipped: "not_found" } };
  const skip = skipReason(source, event, now);
  if (skip) return { status: 200, body: { skipped: skip } };
  if (!(await vapidReady(deps.vapid))) return { status: 503, body: { skipped: "not_configured" } };
  if (!(await backend.claim(source, id))) return { status: 200, body: { skipped: "already_sent" } };

  // Everything read from here on is the event's own restaurant's.
  const venueId = event.venue_id;
  const [context, phones, lines] = await Promise.all([
    backend.loadContext(venueId, event.table_session_id),
    backend.loadPhones(venueId),
    source === "orders" ? backend.loadLines(id) : Promise.resolve([]),
  ]);
  const recipients = chooseRecipients({
    venueId, session: context.session, waiters: context.waiters, rota: context.rota,
    dayStart: context.dayStart, subscriptions: phones,
  });
  const message = describeEvent(source, event, {
    tableNumber: context.session?.table_number ?? null, venueName: context.venueName, lines, now,
  });
  const outcome = recipients.subscriptions.length
    ? await deliver(deps, recipients.subscriptions, message)
    : { sent: 0, removed: 0, failed: 0 };
  deps.log?.(`notify-staff ${source} ${id}: ${recipients.who}, ${recipients.userIds.length} waiter(s), sent ${outcome.sent}, removed ${outcome.removed}, failed ${outcome.failed}`);
  return { status: 200, body: { who: recipients.who, waiters: recipients.userIds.length, ...outcome } };
}

async function onTest(deps: NotifyDeps, authorization: string | null, body: Record<string, unknown>, now: number): Promise<NotifyReply> {
  const token = (authorization ?? "").replace(/^Bearer\s+/i, "");
  const userId = token ? await deps.backend.userOf(token) : null;
  if (!userId) return { status: 401, body: { error: "Sign in first" } };
  if (!(await vapidReady(deps.vapid))) return { status: 503, body: { error: "not_configured" } };
  const phone = typeof body.endpoint === "string" ? await deps.backend.phoneOf(userId, body.endpoint) : null;
  if (!phone) return { status: 404, body: { error: "not_subscribed" } };

  const message = {
    kind: "test", title: "Test alert", tag: `test:${now}`, url: "/waiter", venue: phone.venueName,
    at: new Date(now).toISOString(),
    body: ["This is how a new order reaches you", phone.venueName].filter(Boolean).join(" · "),
  };
  const delay = Math.min(Math.max(Math.round(Number(body.delay_seconds) || 0), 0), 30);
  const run = async () => {
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay * 1000));
    return deliver(deps, [phone], message);
  };
  // Answer at once and send later, so the phone can be locked in between.
  if (delay && deps.waitUntil) {
    deps.waitUntil(run().catch((error) => deps.log?.(`notify-staff test: ${error}`)));
    return { status: 202, body: { queued: true, delay_seconds: delay } };
  }
  return { status: 200, body: await run() };
}

export async function handleNotifyStaff(req: Request, deps: NotifyDeps, now = Date.now()): Promise<NotifyReply> {
  if (req.method === "GET") {
    return (await vapidReady(deps.vapid))
      ? { status: 200, body: { configured: true, publicKey: deps.vapid.publicKey } }
      : { status: 200, body: { configured: false } };
  }
  if (req.method !== "POST") return { status: 405, body: { error: "Method not allowed" } };

  const parsed = await req.json().catch(() => null);
  const body = typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  if (body.action === "test") return onTest(deps, req.headers.get("Authorization"), body, now);
  const source = body.table as StaffPushSource;
  if (!STAFF_PUSH_SOURCES.includes(source) || typeof body.id !== "string" || !UUID.test(body.id)) {
    return { status: 400, body: { error: "Expected { table, id }" } };
  }
  return onEvent(deps, source, body.id, now);
}
