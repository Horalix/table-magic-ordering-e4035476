// What the reservation-messages function does with each call.
//
// The database calls it when a guest asks for a table and when a request is
// answered or cancelled (20261114090000_reservation_messages.sql). The call
// names a reservation and nothing else: the function reads it, works out from
// where it stands which messages are due, and sends each once from the
// restaurant's WhatsApp Business number (./whatsapp.ts):
//
//   the guest   "we have your request", then "confirmed", "declined" or
//               "cancelled", in the language they asked in;
//   the admin   "new table request" and "a guest gave back a confirmed table",
//               to the WhatsApp number the restaurant set for it.
//
// Each restaurant switches both on for itself (Admin → Reservations). Until
// the WhatsApp secrets are set, and for a restaurant that has them off,
// nothing is sent and nothing fails.
//
// An admin's own calls (status, set up the messages, send a test) carry
// their sign-in, checked here.

import {
  createTemplate, languageOf, listTemplates, REQUIRED_TEMPLATES, sendTemplate, templateParams, templateReport, whatsappNumber,
  type MessageKind, type TemplateLanguage, type TemplateStatus,
} from "./whatsapp.ts";

export interface MessageReservation {
  id: string; venue_id: string; status: string; code: string; guest_name: string; guest_phone: string; party_size: number;
  reserved_for: string; locale: string | null; reply: string | null; cancelled_by: string | null;
  decided_at: string | null; created_at: string; updated_at: string;
}

/** What a restaurant has chosen, and what it is called. */
export interface MessageSettings {
  venueSlug: string;
  venueName: string;
  /** Message guests the answer to their request: confirmed, declined, cancelled. */
  guest: boolean;
  /** And, while that is on, that the request arrived. */
  received: boolean;
  /** The WhatsApp number told about new requests, or null. */
  adminPhone: string | null;
}

export interface MessagesBackend {
  loadReservation(id: string): Promise<MessageReservation | null>;
  loadSettings(venueId: string): Promise<MessageSettings | null>;
  /** True the first time only: one message of each kind for a reservation. */
  claim(reservationId: string, venueId: string, kind: MessageKind): Promise<boolean>;
  record(reservationId: string, kind: MessageKind, status: "sent" | "failed", detail: string): Promise<void>;
  /** The signed-in user a bearer token belongs to. */
  userOf(token: string): Promise<string | null>;
  /** The restaurant, if this user is one of its admins (or the owner). */
  venueFor(userId: string, venueSlug: string): Promise<{ id: string; slug: string; name: string } | null>;
}

/** The secrets, as the function reads them: one account, one number per restaurant. */
export interface WhatsAppSecrets {
  token: string;
  businessId: string;
  /** Phone number ids by restaurant ("lasoul", "veraitalia"). */
  phoneIds: Record<string, string>;
}

export interface MessagesDeps {
  backend: MessagesBackend;
  whatsapp: WhatsAppSecrets;
  fetcher?: typeof fetch;
  log?: (line: string) => void;
}

export interface MessagesReply { status: number; body: unknown }

/** News older than this is not sent: a call replayed tomorrow tells nobody anything. */
export const FRESH_MS = 30 * 60_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface Due { kind: MessageKind; to: "guest" | "admin" }

/**
 * The messages a reservation is due, from where it stands now. Asked again
 * for the same reservation it names the same ones, and each is claimed once.
 */
export function messagesDue(row: MessageReservation, settings: MessageSettings, now: number): Due[] {
  const fresh = (iso: string | null) => !!iso && now - Date.parse(iso) < FRESH_MS && now - Date.parse(iso) > -60_000;
  const due: Due[] = [];
  const guest = (kind: MessageKind) => { if (settings.guest) due.push({ kind, to: "guest" }); };
  const admin = (kind: MessageKind) => { if (settings.adminPhone) due.push({ kind, to: "admin" }); };
  if (row.status === "pending" && fresh(row.created_at)) {
    if (settings.received) guest("guest_received");
    admin("admin_new");
  }
  if (row.status === "confirmed" && fresh(row.decided_at ?? row.updated_at)) guest("guest_confirmed");
  if (row.status === "declined" && fresh(row.decided_at ?? row.updated_at)) guest("guest_declined");
  if (row.status === "cancelled" && fresh(row.updated_at)) {
    if (row.cancelled_by === "restaurant") guest("guest_cancelled");
    // Given back by the guest after the restaurant had said yes: a table it can give to someone else.
    if (row.cancelled_by === "guest" && row.decided_at) admin("admin_cancelled");
  }
  return due;
}

const TAGS: Record<TemplateLanguage, string[]> = { en: ["en-GB"], hr: ["bs-BA", "sr-Latn-BA", "hr-HR"], ar: ["ar-u-nu-latn"] };

/** "Saturday 14 November" and "19:30" on the restaurant's own calendar and clock, in the language of the message. */
export function whenFor(iso: string, language: TemplateLanguage): { day: string; time: string } {
  const at = new Date(iso);
  const named = (tag: string) => new Intl.DateTimeFormat(tag, { timeZone: "Europe/Sarajevo", weekday: "long", day: "numeric", month: "long" }).format(at);
  // A runtime that accepts a language and carries none of its words writes "M11 14, Sat": the next one is tried.
  const tag = TAGS[language].find((t) => { try { return !/\bM\d\d\b/.test(named(t)); } catch { return false; } }) ?? "en-GB";
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Sarajevo", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(at);
  return { day: named(tag), time };
}

const senderFor = (deps: MessagesDeps, venueSlug: string) => {
  const phoneId = deps.whatsapp.phoneIds[venueSlug];
  return deps.whatsapp.token && phoneId ? { token: deps.whatsapp.token, phoneId } : null;
};

async function onReservation(deps: MessagesDeps, id: string, now: number): Promise<MessagesReply> {
  const { backend } = deps;
  const row = await backend.loadReservation(id);
  if (!row) return { status: 404, body: { skipped: "not_found" } };
  const settings = await backend.loadSettings(row.venue_id);
  if (!settings || (!settings.guest && !settings.adminPhone)) return { status: 200, body: { skipped: "off" } };
  const sender = senderFor(deps, settings.venueSlug);
  if (!sender) return { status: 200, body: { skipped: "not_configured" } };

  const outcome: { kind: MessageKind; result: "sent" | "failed" | "already_sent" | "no_number" }[] = [];
  for (const { kind, to } of messagesDue(row, settings, now)) {
    const number = whatsappNumber(to === "guest" ? row.guest_phone : settings.adminPhone);
    if (!(await backend.claim(row.id, row.venue_id, kind))) { outcome.push({ kind, result: "already_sent" }); continue; }
    if (!number) {
      await backend.record(row.id, kind, "failed", "Not a mobile number");
      outcome.push({ kind, result: "no_number" });
      continue;
    }
    const language = languageOf(kind, to === "guest" ? row.locale : "en");
    const facts = {
      venue: settings.venueName, ...whenFor(row.reserved_for, language), party: row.party_size, code: row.code,
      name: row.guest_name, phone: row.guest_phone, reply: row.reply,
    };
    const sent = await sendTemplate(sender, number, kind, language, templateParams(kind, language, facts), deps.fetcher);
    await backend.record(row.id, kind, sent.ok ? "sent" : "failed", sent.ok ? (sent.id ?? "") : `${sent.code ?? ""} ${sent.error ?? ""}`.trim().slice(0, 300));
    // Never the number or the name: what was sent, and whether Meta took it.
    deps.log?.(`reservation-messages ${row.id} ${kind}: ${sent.ok ? "sent" : `failed (${sent.code ?? "?"})`}`);
    outcome.push({ kind, result: sent.ok ? "sent" : "failed" });
  }
  return { status: 200, body: { messages: outcome } };
}

interface Report { configured: boolean; number: boolean; templates: (TemplateStatus & { kind: MessageKind })[]; ready: boolean; error?: string }

async function report(deps: MessagesDeps, venueSlug: string): Promise<Report> {
  const { token, businessId, phoneIds } = deps.whatsapp;
  const number = !!phoneIds[venueSlug];
  if (!token || !businessId) return { configured: false, number, templates: [], ready: false };
  try {
    const templates = templateReport(await listTemplates({ token, businessId }, deps.fetcher));
    return { configured: true, number, templates, ready: number && templates.every((t) => t.status === "APPROVED") };
  } catch (error) {
    return { configured: true, number, templates: [], ready: false, error: error instanceof Error ? error.message : "Could not ask Meta" };
  }
}

/** An admin's own calls: where the set-up stands, create the messages at Meta, send a test. */
async function onAdmin(deps: MessagesDeps, authorization: string | null, body: Record<string, unknown>, now: number): Promise<MessagesReply> {
  const token = (authorization ?? "").replace(/^Bearer\s+/i, "");
  const userId = token ? await deps.backend.userOf(token) : null;
  if (!userId) return { status: 401, body: { error: "Sign in first" } };
  const venue = typeof body.venue === "string" ? await deps.backend.venueFor(userId, body.venue) : null;
  if (!venue) return { status: 403, body: { error: "For this restaurant's admins" } };

  if (body.action === "status") return { status: 200, body: await report(deps, venue.slug) };

  if (body.action === "setup") {
    const before = await report(deps, venue.slug);
    if (!before.configured) return { status: 409, body: { error: "not_configured" } };
    if (before.error) return { status: 502, body: { error: before.error } };
    const account = { token: deps.whatsapp.token, businessId: deps.whatsapp.businessId };
    const refused: { name: string; language: string; error: string }[] = [];
    for (const t of before.templates.filter((x) => x.status === "MISSING")) {
      const made = await createTemplate(account, t.kind, t.language as TemplateLanguage, deps.fetcher);
      if (!made.ok) refused.push({ name: t.name, language: t.language, error: made.error ?? "refused" });
    }
    deps.log?.(`reservation-messages setup for ${venue.slug}: ${before.templates.filter((x) => x.status === "MISSING").length} asked for, ${refused.length} refused`);
    return { status: 200, body: { ...(await report(deps, venue.slug)), refused } };
  }

  if (body.action === "test") {
    const sender = senderFor(deps, venue.slug);
    if (!sender) return { status: 409, body: { error: "not_configured" } };
    const to = whatsappNumber(typeof body.to === "string" ? body.to : null);
    if (!to) return { status: 400, body: { error: "Not a mobile number" } };
    const facts = { venue: venue.name, ...whenFor(new Date(now + 26 * 3600_000).toISOString(), "en"), party: 4, code: "TEST", name: "Test guest", phone: "+387 61 000 000" };
    const sent = await sendTemplate(sender, to, "admin_new", "en", templateParams("admin_new", "en", facts), deps.fetcher);
    return sent.ok ? { status: 200, body: { sent: true } } : { status: 502, body: { error: sent.error, code: sent.code } };
  }
  return { status: 400, body: { error: "Unknown action" } };
}

export async function handleReservationMessages(req: Request, deps: MessagesDeps, now = Date.now()): Promise<MessagesReply> {
  if (req.method === "GET") {
    // Whether the account is connected at all; nothing of the secrets themselves.
    return { status: 200, body: { configured: !!(deps.whatsapp.token && deps.whatsapp.businessId), templates: REQUIRED_TEMPLATES.length } };
  }
  if (req.method !== "POST") return { status: 405, body: { error: "Method not allowed" } };
  const parsed = await req.json().catch(() => null);
  const body = typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  if (typeof body.action === "string") return onAdmin(deps, req.headers.get("Authorization"), body, now);
  return typeof body.id === "string" && UUID.test(body.id)
    ? onReservation(deps, body.id, now)
    : { status: 400, body: { error: "Expected { id }" } };
}
