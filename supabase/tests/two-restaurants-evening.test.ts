/**
 * @vitest-environment node
 *
 * One evening at La Soul and Vera Italia, both open at once
 * (docs/two-restaurants.md) — the whole service, through the functions the
 * app calls, as the roles that call them, with the x-venue header the app
 * sends (src/lib/current-venue.ts).
 *
 * Both restaurants have a table 7: the classic trap. Guests sit down at both
 * in the same minute, a second phone joins each, they browse, take
 * suggestions and order — a combo and a promotion at La Soul, a promotion at
 * Vera Italia, and a large first order Vera Italia holds for its waiter. They
 * call the waiter, ask for the bill, pay cash and card; one order is
 * cancelled at each restaurant and one refunded at each; they rate the visit
 * and the waiter. Each kitchen bumps its tickets, each restaurant's cloud
 * printers (both called "Kitchen") print them, each waiter takes the money
 * and frees the tables, each admin reads the reports and closes the day, and
 * the owner reads both through the switch.
 *
 * At every step it checks that nothing crossed:
 *   - every row written carries its restaurant;
 *   - each waiter, kitchen, printer and admin sees exactly its own — with the
 *     right header, the other restaurant's, a made-up one or none — and a
 *     staff call with the other restaurant's ids is refused;
 *   - a guest holding one table 7's token can do nothing at the other one,
 *     whatever header the phone sends;
 *   - every report equals the sums of that restaurant's own rows, worked out
 *     here from what the evening did, for its admin and for the owner under
 *     each position of the switch, and is never the two added together;
 *   - what the suggestions learned tonight is each restaurant's own.
 *
 * What used to cross is at the end, each asserted the way it should behave;
 * a crossing found later goes there as `it.fails` until it is fixed, and each
 * failure message says what crossed.
 *
 * Runs on the migrations up to and including LAST_MIGRATION below.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
// @ts-expect-error -- plain JS harness, no types needed
import { actAs, createTestDatabase, migrationFiles } from '../../scripts/db-harness.mjs';

type Db = {
  query: <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<{ rows: T[]; affectedRows?: number }>;
  exec: (sql: string) => Promise<unknown>;
  close: () => Promise<void>;
};

/*
 * The evening runs on the schema up to the owner's overview: the admin
 * separation (20261031100000) and the service fixes (20261031100500) the
 * evening's crossings asked for included. Files after it are left out on
 * purpose, so this suite measures what was shipped up to that point.
 */
const LAST_MIGRATION = '20261031110000_owner_overview.sql';
function firstMigrationAfter(last: string): string | undefined {
  const files: string[] = migrationFiles();
  if (!files.includes(last)) throw new Error(`${last} is not in supabase/migrations`);
  return files.find((f) => f > last);
}

// ---------------------------------------------------------------------------
// The two restaurants and their people
// ---------------------------------------------------------------------------

const L = 'a5000000-0000-4000-8000-000000000001'; // La Soul
const V = 'a5000000-0000-4000-8000-000000000002'; // Vera Italia
const VENUES = [L, V];
const SLUG: Record<string, string> = { [L]: 'lasoul', [V]: 'veraitalia' };
const NAME: Record<string, string> = { [L]: 'La Soul', [V]: 'Vera Italia' };
const other = (v: string) => (v === L ? V : L);
const venueOfSlug = (slug: string | null) => (slug === 'veraitalia' ? V : L);

const OWNER = 'e0000000-0000-4000-8000-000000000001'; // admin, no restaurant
const NEWCOMER = 'e0000000-0000-4000-8000-000000000009'; // signed in, works nowhere
const ADMIN: Record<string, string> = { [L]: 'e0000000-0000-4000-8000-0000000000a1', [V]: 'e0000000-0000-4000-8000-0000000000a2' };
const WAITER: Record<string, string> = { [L]: 'e0000000-0000-4000-8000-0000000000b1', [V]: 'e0000000-0000-4000-8000-0000000000b2' };
const KITCHEN: Record<string, string> = { [L]: 'e0000000-0000-4000-8000-0000000000c1', [V]: 'e0000000-0000-4000-8000-0000000000c2' };
const WAITER_ROW: Record<string, string> = { [L]: 'e1000000-0000-4000-8000-0000000000b1', [V]: 'e1000000-0000-4000-8000-0000000000b2' };
const WAITER_NAME: Record<string, string> = { [L]: 'Amar', [V]: 'Giulia' };
const SECTION: Record<string, string> = { [L]: 'e2000000-0000-4000-8000-0000000000a1', [V]: 'e2000000-0000-4000-8000-0000000000a2' };
const ROLE_LABEL: Record<string, string> = {
  [OWNER]: 'the owner', [NEWCOMER]: 'a signed-in stranger',
  [ADMIN[L]]: "La Soul's admin", [ADMIN[V]]: "Vera Italia's admin",
  [WAITER[L]]: "La Soul's waiter", [WAITER[V]]: "Vera Italia's waiter",
  [KITCHEN[L]]: "La Soul's kitchen", [KITCHEN[V]]: "Vera Italia's kitchen",
};

interface TableDef { key: string; venue: string; number: number; id: string; qr: string }
const TABLES: TableDef[] = [
  { key: 'L3', venue: L, number: 3, id: 'e3000000-0000-4000-8000-000000000103', qr: 'f1a3b5c7d9e1f3a5b7c9d1e3f5a7b9c1lasoul03' },
  { key: 'L5', venue: L, number: 5, id: 'e3000000-0000-4000-8000-000000000105', qr: 'f1a3b5c7d9e1f3a5b7c9d1e3f5a7b9c1lasoul05' },
  { key: 'L7', venue: L, number: 7, id: 'e3000000-0000-4000-8000-000000000107', qr: 'f1a3b5c7d9e1f3a5b7c9d1e3f5a7b9c1lasoul07' },
  { key: 'L12', venue: L, number: 12, id: 'e3000000-0000-4000-8000-000000000112', qr: 'f1a3b5c7d9e1f3a5b7c9d1e3f5a7b9c1lasoul12' },
  { key: 'V2', venue: V, number: 2, id: 'e3000000-0000-4000-8000-000000000202', qr: '0a2c4e6a8c0e2a4c6e8a0c2e4a6c8e0averaital02' },
  { key: 'V4', venue: V, number: 4, id: 'e3000000-0000-4000-8000-000000000204', qr: '0a2c4e6a8c0e2a4c6e8a0c2e4a6c8e0averaital04' },
  { key: 'V7', venue: V, number: 7, id: 'e3000000-0000-4000-8000-000000000207', qr: '0a2c4e6a8c0e2a4c6e8a0c2e4a6c8e0averaital07' },
  { key: 'V9', venue: V, number: 9, id: 'e3000000-0000-4000-8000-000000000209', qr: '0a2c4e6a8c0e2a4c6e8a0c2e4a6c8e0averaital09' },
];
const T = Object.fromEntries(TABLES.map((t) => [t.key, t])) as Record<string, TableDef>;

interface PrinterDef { key: string; venue: string; name: string; station: 'kitchen' | 'bar' | 'all'; token: string; types: string[] }
const PRINTERS: PrinterDef[] = [
  { key: 'La Soul Kitchen', venue: L, name: 'Kitchen', station: 'kitchen', token: '7c1e0b5a9d3f4e2b8a6c0d1e7f3a5b9clsk', types: ['kitchen'] },
  { key: 'La Soul Bar', venue: L, name: 'Bar', station: 'bar', token: '7c1e0b5a9d3f4e2b8a6c0d1e7f3a5b9clsb', types: ['bar'] },
  // Vera Italia's only printer is also called "Kitchen", and prints everything.
  { key: 'Vera Italia Kitchen', venue: V, name: 'Kitchen', station: 'all', token: '2f8d6b4a0e9c7a5b3d1f8e6c4a2b0d9fvik', types: ['kitchen', 'bar'] },
];

// ---------------------------------------------------------------------------
// The evening's own record of what it did — the independent side of every
// comparison. Money is kept in cents.
// ---------------------------------------------------------------------------

const cents = (x: unknown) => Math.round(Number(x) * 100);
const kmOf = (c: number) => (c / 100).toFixed(2);

interface Phone { who: string; venue: string; table: TableDef; client: string; visit: string; session?: string; token?: string }
interface Line { item: string; qty: number; unit: number; choices?: { slot_id: string; item_id: string }[]; decision?: string | null; source?: string | null }
interface OrderRec {
  id: string; venue: string; session: string; table: string; who: string; code: string;
  lines: Line[]; tip: number; total: number; method: string;
  held: boolean; released: boolean; cancelled: boolean; paid: boolean; served: boolean;
  refunded: number; refundMethod: string | null;
}
interface DecisionRec { id: string | null; venue: string; session: string; chosen: string | null; seen: boolean; tapped: boolean; dismissed: boolean }
interface EventRec { visit: string; venue: string; event: string; props: Record<string, unknown> }

const ledger = {
  sessions: new Map<string, { venue: string; table: TableDef; host: string; covers: number | null }>(),
  orders: [] as OrderRec[],
  calls: new Map<string, string>(), // id → venue
  bills: new Map<string, string>(),
  joins: new Map<string, string>(),
  ratings: new Map<string, { venue: string; rating: number }>(),
  serverRatings: new Map<string, { venue: string; rating: number; waiter: string }>(),
  refunds: new Map<string, string>(),
  decisions: [] as DecisionRec[],
  events: [] as EventRec[],
  printed: new Map<string, string>(), // ticket id → printer key
};
const LABEL = new Map<string, string>(); // any id → what it is, for failure messages
const label = (id: string) => LABEL.get(id) ?? id;

// Menu facts, read once the menus are in.
const DISH: Record<string, string> = {}; // our short names → ids
const PRICE: Record<string, number> = {}; // id → cents, what a guest pays (sales applied)
const STATION: Record<string, string> = {};
const ITEM_VENUE: Record<string, string> = {};
const SLOT: Record<string, string> = {};
const SURCHARGE: Record<string, number> = {}; // `${slot}|${item}` → cents
let ROOM_CODE: Record<string, string> = {};

const VERA_MENU = JSON.parse(readFileSync(path.join(__dirname, '..', '..', 'scripts', 'vera-italia', 'menu.json'), 'utf8'));
const LA_SOUL_MENU = JSON.parse(readFileSync(path.join(__dirname, 'fixtures', 'la-soul-menu-2026-10-24.json'), 'utf8'));
const veraId = (slug: string): string => {
  for (const c of VERA_MENU.categories) for (const s of c.sections) for (const it of s.items) if (it.slug === slug) return it.id;
  throw new Error(`not on Vera Italia's menu: ${slug}`);
};

let db: Db;

// ---------------------------------------------------------------------------
// How each party talks to the database
// ---------------------------------------------------------------------------

/** The x-venue header of the request (null: the app sends none). */
async function header(slug: string | null) {
  await db.query(`SELECT set_config('request.headers', $1, false)`, [slug ? JSON.stringify({ 'x-venue': slug }) : '']);
}

/** A guest's phone: anonymous, with whatever restaurant header the app sends. */
async function asGuest<T>(slug: string | null, run: () => Promise<T>): Promise<T> {
  await actAs(db, null);
  await header(slug);
  await db.exec('SET ROLE anon');
  try { return await run(); } finally {
    await db.exec('RESET ROLE');
    await header(null);
  }
}

/** A signed-in member of staff (or the owner), under the access rules. */
async function asUser<T>(user: string, slug: string | null, run: () => Promise<T>): Promise<T> {
  await actAs(db, user);
  await header(slug);
  await db.exec('SET ROLE authenticated');
  try { return await run(); } finally {
    await db.exec('RESET ROLE');
    await header(null);
    await actAs(db, null);
  }
}

/** The cloudprnt edge function: the service role, no user, no header. */
async function asPrinterService<T>(run: () => Promise<T>): Promise<T> {
  await actAs(db, null);
  await header(null);
  await db.exec('SET ROLE service_role');
  try { return await run(); } finally { await db.exec('RESET ROLE'); }
}

/** One scalar function call: `SELECT <fn> AS r`. */
async function call<T = Record<string, unknown>>(fn: string, params: unknown[] = []): Promise<T> {
  return (await db.query<{ r: T }>(`SELECT ${fn} AS r`, params)).rows[0].r;
}

const errorOf = async (run: () => Promise<unknown>): Promise<string | null> => {
  try { await run(); return null; } catch (e) { return String((e as Error).message); }
};

/** `run` must be refused, for the reason `pattern` names. */
async function refused(what: string, run: () => Promise<unknown>, pattern: RegExp) {
  const message = await errorOf(run);
  expect(message, `${what} — and it was NOT refused`).not.toBeNull();
  expect(message, `${what} — refused, but for another reason`).toMatch(pattern);
}

const NOT_HERE = /do not work at this restaurant/;
const BAD_SESSION = /Invalid or expired table session/;

/** The ids in `got` must be exactly `want`; says which crossed and which went missing. */
function exactly(what: string, got: string[], want: string[]) {
  const extra = got.filter((x) => !want.includes(x)).map(label);
  const missing = want.filter((x) => !got.includes(x)).map(label);
  expect({ crossedIn: extra, missing }, what).toEqual({ crossedIn: [], missing: [] });
}

/** Every row here must be `venue`'s. */
function allOf(what: string, venue: string, rows: { venue_id: string | null; id?: unknown }[]) {
  const foreign = rows.filter((r) => r.venue_id !== venue).map((r) => `${r.id === undefined ? '' : label(String(r.id))} (${NAME[r.venue_id ?? ''] ?? r.venue_id})`);
  expect(foreign, `${what}: rows that are not ${NAME[venue]}'s`).toEqual([]);
}

/** A report's numbers against each restaurant's own; names the other's number or the sum when that is what came back. */
function sameNumbers(what: string, venue: string, got: Record<string, unknown>, want: Record<string, Record<string, number>>) {
  const mine = want[venue];
  const theirs = want[other(venue)];
  const wrong: string[] = [];
  for (const k of Object.keys(mine)) {
    const g = Number(got[k]);
    if (Math.abs(g - mine[k]) <= 0.0051) continue;
    let hint = '';
    if (Math.abs(g - theirs[k]) <= 0.0051) hint = ` — that is ${NAME[other(venue)]}'s number`;
    else if (Math.abs(g - (mine[k] + theirs[k])) <= 0.0051) hint = ' — that is both restaurants added together';
    wrong.push(`${k}: got ${got[k]}, ${NAME[venue]}'s own rows say ${mine[k]}${hint}`);
  }
  expect(wrong, `${what}\n  ${wrong.join('\n  ')}`).toEqual([]);
}

// ---------------------------------------------------------------------------
// Guests, as the app does it
// ---------------------------------------------------------------------------

const PHONES: Record<string, Phone> = {};
function phone(who: string, tableKey: string): Phone {
  const p: Phone = { who, venue: T[tableKey].venue, table: T[tableKey], client: `client-${tableKey}-${who}`.toLowerCase(), visit: `visit-${tableKey}-${who}`.toLowerCase() };
  PHONES[who] = p;
  return p;
}

/** The phone scans a table's own sticker and becomes its host (first at the table). */
async function sitDown(p: Phone, via: 'sticker' | 'room' = 'sticker') {
  const code = via === 'sticker' ? p.table.qr : ROOM_CODE[p.venue];
  // The first request names no restaurant yet: the app asks the code where it is.
  const where = await asGuest(null, () => call<{ venue: string }>(`public.guest_table_venue($1, $2)`, [p.table.number, code]));
  expect(where.venue, `${p.who}'s code for ${p.table.key} opened ${where.venue}'s menu`).toBe(SLUG[p.venue]);
  const r = await asGuest(SLUG[p.venue], () => call<{ status: string; session_id: string; session_token: string }>(
    `public.guest_start_table_session($1, $2, $3, $4)`, [p.table.number, code, p.client, p.who]));
  expect(r.status, `${p.who} sitting down at ${p.table.key}`).toBe('created');
  p.session = r.session_id;
  p.token = r.session_token;
  ledger.sessions.set(r.session_id, { venue: p.venue, table: p.table, host: p.who, covers: null });
  LABEL.set(r.session_id, `${NAME[p.venue]} table ${p.table.number} (${p.who}'s session)`);
}

/** A second phone at the same table asks to join; the host approves on their phone. */
async function joinAndApprove(joiner: Phone, host: Phone) {
  const first = await asGuest(SLUG[joiner.venue], () => call<{ status: string; session_id: string }>(
    `public.guest_start_table_session($1, $2, $3, $4)`, [joiner.table.number, joiner.table.qr, joiner.client, joiner.who]));
  expect(first.status, `${joiner.who} at ${joiner.table.key}`).toBe('join_required');
  expect(first.session_id, `${joiner.who} was offered another table's session`).toBe(host.session);
  const req = await asGuest(SLUG[joiner.venue], () => call<{ status: string; request_id: string }>(
    `public.guest_request_join($1, $2, $3, $4)`, [joiner.table.number, joiner.table.qr, joiner.client, joiner.who]));
  ledger.joins.set(req.request_id, joiner.venue);
  LABEL.set(req.request_id, `${joiner.who}'s join request at ${NAME[joiner.venue]} table ${joiner.table.number}`);
  const pending = await asGuest(SLUG[host.venue], async () => (await db.query<{ id: string }>(
    `SELECT id FROM public.guest_list_pending_join_requests($1, $2, $3)`, [host.session, host.token, host.client])).rows.map((r) => r.id));
  exactly(`${host.who}'s phone lists the join requests for ${host.table.key}`, pending, [req.request_id]);
  await asGuest(SLUG[host.venue], () => call(`public.guest_resolve_join_request($1, $2, $3, 'approved', $4)`,
    [host.session, host.token, req.request_id, host.who]));
  const got = await asGuest(SLUG[joiner.venue], () => call<{ status: string; session_token: string }>(
    `public.guest_get_join_request($1, $2, $3)`, [host.session, req.request_id, joiner.client]));
  expect(got.status).toBe('approved');
  joiner.session = host.session;
  joiner.token = got.session_token;
}

/** Analytics, as src/lib/analytics.ts flushes it: one batch per phone, with the page's header. */
async function track(p: Phone | { visit: string; venue: string }, events: Array<[string, Record<string, unknown>?]>, slug: string | null = SLUG[p.venue]) {
  const batch = events.map(([event, props]) => ({ event, props: props ?? {}, at: new Date().toISOString() }));
  const n = await asGuest(slug, () => call<number>(`public.record_analytics_events($1, $2::jsonb)`, [p.visit, JSON.stringify(batch)]));
  expect(n, `analytics batch from ${p.visit}`).toBe(events.length);
  for (const [event, props] of events) ledger.events.push({ visit: p.visit, venue: venueOfSlug(slug), event, props: props ?? {} });
}

interface Suggestion { decision_id: string; id: string; source_item_id: string | null; recommendation_type: string }
/** The cart card: ask, and — when the card is on screen — record the sighting as the app does. */
async function suggest(p: Phone, cart: Array<[string, number]>, opts: { seen?: boolean; slug?: string | null } = {}): Promise<Suggestion[]> {
  const slug = opts.slug === undefined ? SLUG[p.venue] : opts.slug;
  const rows = await asGuest(slug, async () => (await db.query<Suggestion>(
    `SELECT decision_id, id, source_item_id, recommendation_type
       FROM public.guest_get_recommendations($1, $2, $3::uuid[], 'cart', 'en', 4, '{}'::text[], '{}'::text[], '{}'::uuid[], $4::int[])`,
    [p.session, p.token, cart.map(([id]) => id), cart.map(([, q]) => q)])).rows);
  const rec: DecisionRec = { id: rows[0]?.decision_id ?? null, venue: p.venue, session: p.session!, chosen: rows[0]?.id ?? null, seen: false, tapped: false, dismissed: false };
  ledger.decisions.push(rec);
  if (rows[0] && opts.seen !== false) {
    await asGuest(slug, () => call(`public.guest_mark_suggestion_seen($1, $2, $3)`, [rows[0].decision_id, p.session, p.token]));
    rec.seen = true;
    await track(p, [['suggestion_shown', { placement: 'cart', decision_id: rows[0].decision_id, item_id: rows[0].id, source_item_id: rows[0].source_item_id, type: rows[0].recommendation_type }]], slug);
  }
  return rows;
}
function accept(p: Phone, s: Suggestion) {
  const rec = ledger.decisions.find((d) => d.id === s.decision_id)!;
  rec.tapped = true;
  return track(p, [['suggestion_accepted', { placement: 'cart', decision_id: s.decision_id, item_id: s.id, source_item_id: s.source_item_id, type: s.recommendation_type, quantity: 1, offered_quantity: 1 }]]);
}

const unitOf = (item: string, choices?: { slot_id: string; item_id: string }[]) =>
  PRICE[item] + (choices ?? []).reduce((sum, c) => sum + (SURCHARGE[`${c.slot_id}|${c.item_id}`] ?? 0), 0);
const line = (item: string, qty = 1, extra: Partial<Line> = {}): Line => ({ item, qty, unit: unitOf(item, extra.choices), ...extra });
const fromSuggestion = (s: Suggestion): Partial<Line> => ({ decision: s.decision_id, source: s.source_item_id });

/** Checkout, as the cart page sends it. */
async function placeOrder(p: Phone, lines: Line[], method: 'cash' | 'pos_terminal', tip = 0) {
  const items = lines.map((l) => ({
    menu_item_id: l.item,
    quantity: l.qty,
    ...(l.choices ? { choices: l.choices } : {}),
    ...(l.decision !== undefined ? { from_suggestion: { source_item_id: l.source ?? null, placement: 'cart', decision_id: l.decision } } : {}),
  }));
  const r = await asGuest(SLUG[p.venue], () => call<{ order_id: string; order_code: string; total: number; held: boolean; held_reason: string | null }>(
    `public.guest_place_order($1, $2, $3, $4, $5::jsonb, $6, $7)`,
    [p.session, p.token, p.who, method, JSON.stringify(items), tip / 100, crypto.randomUUID()]));
  const total = lines.reduce((s, l) => s + l.unit * l.qty, 0) + tip;
  expect(cents(r.total), `${p.who}'s order at ${NAME[p.venue]} table ${p.table.number} was charged ${r.total}, the menu says ${kmOf(total)}`).toBe(total);
  const rec: OrderRec = {
    id: r.order_id, venue: p.venue, session: p.session!, table: p.table.key, who: p.who, code: r.order_code, lines, tip, total,
    method, held: r.held, released: !r.held, cancelled: false, paid: false, served: false, refunded: 0, refundMethod: null,
  };
  ledger.orders.push(rec);
  LABEL.set(r.order_id, `${NAME[p.venue]} order #${r.order_code} (table ${p.table.number}, ${p.who})`);
  await track(p, [['checkout_opened', { item_count: lines.length, one_tap: false }], ['order_placed', { method, total: total / 100 }]]);
  return rec;
}

const ordersOf = (venue: string) => ledger.orders.filter((o) => o.venue === venue);
const completedOf = (venue: string) => ordersOf(venue).filter((o) => o.released && !o.cancelled);
const orderAt = (who: string, n = 0) => ledger.orders.filter((o) => o.who === who)[n];
const sessionsOf = (venue: string) => [...ledger.sessions].filter(([, s]) => s.venue === venue).map(([id]) => id);

/** Order lines in the database, with each line's own, its order's and its dish's restaurant. */
const orderLines = async () => (await db.query<{ id: string; order_id: string; venue_id: string; order_venue: string; item_venue: string; menu_item_id: string; status: string; station: string; quantity: number }>(
  `SELECT oi.id, oi.order_id, oi.venue_id, o.venue_id AS order_venue, mi.venue_id AS item_venue, oi.menu_item_id, oi.status::text, oi.station, oi.quantity
     FROM public.order_items oi JOIN public.orders o ON o.id = oi.order_id JOIN public.menu_items mi ON mi.id = oi.menu_item_id`)).rows;

// ---------------------------------------------------------------------------
// Before the doors open
// ---------------------------------------------------------------------------

beforeAll(async () => {
  db = (await createTestDatabase({ quiet: true, until: firstMigrationAfter(LAST_MIGRATION) })) as unknown as Db;

  // What a Supabase project grants on the restaurant tables (they predate the
  // two restaurants and were created under its default privileges); every
  // newer table keeps exactly the grants its migration gave it.
  await db.exec(`
    DO $g$
    DECLARE t text;
    BEGIN
      FOREACH t IN ARRAY ARRAY['categories', 'subcategories', 'menu_items', 'menu_combo_slots', 'menu_combo_options',
        'sections', 'tables', 'section_assignments', 'waiters', 'printers', 'restaurant_settings', 'shift_closes',
        'table_sessions', 'orders', 'order_items', 'waiter_calls', 'bill_requests', 'session_join_requests', 'ratings',
        'server_ratings', 'payment_transactions', 'order_refunds', 'order_ticket_events', 'audit_log', 'user_roles',
        'menu_item_recommendations']
      LOOP
        EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
      END LOOP;
    END $g$;
  `);

  // La Soul's real menu (Vera Italia's came with its migration).
  await db.query(`INSERT INTO public.categories(id, name, sort_order)
     SELECT (c->>'id')::uuid, c->>'name', (c->>'sort_order')::int FROM jsonb_array_elements($1::jsonb) c`, [JSON.stringify(LA_SOUL_MENU.categories)]);
  await db.query(`INSERT INTO public.subcategories(id, category_id, name, sort_order)
     SELECT (s->>'id')::uuid, (s->>'category_id')::uuid, s->>'name', (s->>'sort_order')::int FROM jsonb_array_elements($1::jsonb) s`,
  [JSON.stringify(LA_SOUL_MENU.subcategories)]);
  await db.query(`INSERT INTO public.menu_items(id, subcategory_id, name, price, is_available, station, meal_role,
                                 dietary_tags, allergens, available_from, available_to, margin_score, prep_minutes, sort_order)
     SELECT (m->>'id')::uuid, (m->>'subcategory_id')::uuid, m->>'name', (m->>'price')::numeric,
            (m->>'is_available')::boolean, m->>'station', (m->>'meal_role')::public.meal_role,
            ARRAY(SELECT jsonb_array_elements_text(COALESCE(m->'dietary_tags', '[]'::jsonb))),
            ARRAY(SELECT jsonb_array_elements_text(COALESCE(m->'allergens', '[]'::jsonb))),
            (m->>'available_from')::time, (m->>'available_to')::time,
            COALESCE((m->>'margin_score')::int, 0), (m->>'prep_minutes')::int, COALESCE((m->>'sort_order')::int, 0)
       FROM jsonb_array_elements($1::jsonb) m`, [JSON.stringify(LA_SOUL_MENU.menu_items)]);

  const laSoul = new Map((await db.query<{ id: string; name: string }>(
    `SELECT id, btrim(name) AS name FROM public.menu_items WHERE venue_id = '${L}'`)).rows.map((r) => [r.name, r.id]));
  const ls = (name: string) => { const id = laSoul.get(name); if (!id) throw new Error(`not on La Soul's menu: ${name}`); return id; };
  Object.assign(DISH, {
    burger: ls('La Soul Burger'), cola: ls('Coca-Cola'), lsTrufflePasta: ls('Truffle Pasta'), caesar: ls('Caesar Salad'),
    espresso: ls('Espresso'), lavaCake: ls('Lava Cake'), icedTea: ls('Lemon Iced Tea'), slider: ls('Mix Slider'),
    fries: ls('Regular Fries'), cheeseFries: ls('Original Cheese Fries'), lemonade: ls('Strawberry Lemonade'), water: ls('Sparkling Water'),
    // Vera Italia's, by the fixed ids of its menu.json.
    ribeye: veraId('ribeye-platter'), bruschetta: veraId('bruschetta'), viTrufflePasta: veraId('truffle-pasta'),
    chicken: veraId('grilled-chicken'), margherita: veraId('margherita'), caprese: veraId('caprese'),
    trufflePizza: veraId('truffle-pizza'), fetaDip: veraId('feta-dip'),
  });

  // La Soul's house pairings, bound to its own sections (as in vera-suggestions.test.ts).
  await db.query(`INSERT INTO public.menu_item_recommendations(source_subcategory_id, recommended_item_id, recommendation_type, priority)
    SELECT s.id, x.item, 'pair_with', x.priority
      FROM (VALUES ('Burgers', $1::uuid, 90), ('Pasta', $2::uuid, 70)) AS x(section, item, priority)
      JOIN public.subcategories s ON btrim(s.name) = x.section AND s.venue_id = '${L}'`, [DISH.fries, DISH.icedTea]);

  // People. Waiters and kitchens are 'staff' of one restaurant; the owner is an admin of none.
  await db.exec(`
    INSERT INTO auth.users(id) VALUES ('${OWNER}'), ('${NEWCOMER}'), ('${ADMIN[L]}'), ('${ADMIN[V]}'),
      ('${WAITER[L]}'), ('${WAITER[V]}'), ('${KITCHEN[L]}'), ('${KITCHEN[V]}');
    INSERT INTO public.user_roles(user_id, role, venue_id) VALUES
      ('${OWNER}', 'admin', NULL), ('${ADMIN[L]}', 'admin', '${L}'), ('${ADMIN[V]}', 'admin', '${V}'),
      ('${WAITER[L]}', 'staff', '${L}'), ('${WAITER[V]}', 'staff', '${V}'),
      ('${KITCHEN[L]}', 'staff', '${L}'), ('${KITCHEN[V]}', 'staff', '${V}');
    INSERT INTO public.waiters(id, user_id, display_name, venue_id) VALUES
      ('${WAITER_ROW[L]}', '${WAITER[L]}', '${WAITER_NAME[L]}', '${L}'),
      ('${WAITER_ROW[V]}', '${WAITER[V]}', '${WAITER_NAME[V]}', '${V}');
    INSERT INTO public.sections(id, name, venue_id) VALUES ('${SECTION[L]}', 'Terrace', '${L}'), ('${SECTION[V]}', 'Sala', '${V}');
    INSERT INTO public.section_assignments(section_id, waiter_id, shift_date) VALUES
      ('${SECTION[L]}', '${WAITER_ROW[L]}', public.business_day()), ('${SECTION[V]}', '${WAITER_ROW[V]}', public.business_day());
    INSERT INTO public.tables(id, table_number, qr_token, venue_id, section_id) VALUES
      ${TABLES.map((t) => `('${t.id}', ${t.number}, '${t.qr}', '${t.venue}', '${SECTION[t.venue]}')`).join(',\n      ')};

    -- Tonight's settings. Vera Italia holds a first order over 60 KM for its
    -- waiter; La Soul does not. Vera Italia keeps idle tables longer.
    UPDATE public.restaurant_settings
       SET ordering_enabled = true, online_card_enabled = false, recommendations_enabled = true,
           reco_holdout_pct = 0, reco_exploration = 0, service_open = NULL, service_close = NULL,
           hold_burst_sessions = NULL, hold_second_session = false, hold_auto_admitted = false,
           hold_unpaid_km = NULL, hold_first_order_items = NULL,
           hold_first_order_km = CASE WHEN venue_id = '${V}' THEN 60 END,
           session_idle_timeout_minutes = CASE WHEN venue_id = '${V}' THEN 240 ELSE 90 END;
  `);
  for (const t of TABLES) LABEL.set(t.id, `${NAME[t.venue]} table ${t.number}`);
  for (const v of VENUES) LABEL.set(WAITER_ROW[v], `${NAME[v]}'s waiter ${WAITER_NAME[v]}`);
  ROOM_CODE = Object.fromEntries((await db.query<{ venue_id: string; venue_qr_token: string }>(
    `SELECT venue_id, venue_qr_token FROM public.restaurant_settings`)).rows.map((r) => [r.venue_id, r.venue_qr_token]));

  // Each admin sets up their printers in the admin; the app names no restaurant.
  for (const p of PRINTERS) {
    await asUser(ADMIN[p.venue], null, () => db.query(
      `INSERT INTO public.printers(name, station, poll_token) VALUES ($1, $2, $3)`, [p.name, p.station, p.token]));
  }

  // La Soul's admin builds a combo; Vera Italia's runs a promotion, La Soul's another.
  const combo = await asUser(ADMIN[L], 'lasoul', async () => (await db.query<{ id: string }>(
    `INSERT INTO public.menu_items(subcategory_id, name, price, is_available, station, meal_role)
     SELECT subcategory_id, 'Soul Combo', 22, true, 'kitchen', 'main' FROM public.menu_items WHERE id = $1 RETURNING id`, [DISH.burger])).rows[0].id);
  DISH.combo = combo;
  await asUser(ADMIN[L], 'lasoul', () => call(`public.admin_save_combo($1, $2::jsonb)`, [combo, JSON.stringify([
    { label: 'Burger', options: [{ item_id: DISH.burger, surcharge: 0 }] },
    { label: 'Side', options: [{ item_id: DISH.fries, surcharge: 0 }, { item_id: DISH.cheeseFries, surcharge: 4 }] },
    { label: 'Drink', options: [{ item_id: DISH.cola, surcharge: 0 }, { item_id: DISH.lemonade, surcharge: 2 }] },
  ])]));
  for (const s of (await db.query<{ id: string; label: string }>(`SELECT id, label FROM public.menu_combo_slots WHERE combo_item_id = $1`, [combo])).rows) {
    SLOT[s.label] = s.id;
  }
  SURCHARGE[`${SLOT.Side}|${DISH.cheeseFries}`] = 400;
  SURCHARGE[`${SLOT.Drink}|${DISH.lemonade}`] = 200;
  await asUser(ADMIN[L], 'lasoul', () => db.query(`UPDATE public.menu_items SET sale_kind = 'percent', sale_value = 20 WHERE id = $1`, [DISH.cola]));
  await asUser(ADMIN[V], null, () => db.query(`UPDATE public.menu_items SET sale_kind = 'price', sale_value = 12 WHERE id = $1`, [DISH.margherita]));
  // Neither admin can put a sale on the other's menu, whatever the header.
  for (const slug of ['lasoul', 'veraitalia', null]) {
    const r = await asUser(ADMIN[L], slug, () => db.query(`UPDATE public.menu_items SET sale_kind = 'price', sale_value = 1 WHERE id = $1`, [DISH.margherita]));
    expect(r.affectedRows ?? 0, `La Soul's admin (x-venue: ${slug}) put a sale on Vera Italia's Margherita`).toBe(0);
  }

  for (const r of (await db.query<{ id: string; price: string; station: string; venue_id: string; name: string }>(
    `SELECT id, price, station, venue_id, name FROM public.menu_items`)).rows) {
    PRICE[r.id] = cents(r.price);
    STATION[r.id] = r.station;
    ITEM_VENUE[r.id] = r.venue_id;
    LABEL.set(r.id, `${NAME[r.venue_id]}'s ${r.name.trim()}`);
  }
  PRICE[DISH.cola] = Math.round(PRICE[DISH.cola] * 0.8);
  PRICE[DISH.margherita] = 1200;

  // The evening is at eight o'clock, as far as suggestions are concerned.
  const day = (await db.query<{ d: string }>(`SELECT to_char(now() AT TIME ZONE 'Europe/Sarajevo', 'YYYY-MM-DD') AS d`)).rows[0].d;
  await db.exec(`SET lasoul.reco_now = '${day} 20:00 Europe/Sarajevo'`);
  await actAs(db, null);
}, 240_000);

afterAll(async () => { await db?.close(); });

// ---------------------------------------------------------------------------
// The evening
// ---------------------------------------------------------------------------

const amina = phone('Amina', 'L7'); // La Soul table 7, host
const emir = phone('Emir', 'L7'); // La Soul table 7, second phone
const marco = phone('Marco', 'V7'); // Vera Italia table 7, host
const sofia = phone('Sofia', 'V7'); // Vera Italia table 7, second phone
const lejla = phone('Lejla', 'L3');
const tarik = phone('Tarik', 'L5');
const nina = phone('Nina', 'L12');
const elena = phone('Elena', 'V2');
const luca = phone('Luca', 'V9');
const website = { visit: 'visit-website-browser', venue: L };
const veraBrowser = { visit: 'visit-veraitalia-net-browser', venue: V };

let decisionL7: Suggestion;
let decisionV7: Suggestion;
let decisionV2: Suggestion;
let decisionL3: Suggestion;

describe('one evening, both restaurants open at once', () => {
  it('guests sit down at both table 7s in the same minute, each at their own restaurant', async () => {
    await sitDown(amina);
    await sitDown(marco);
    expect(amina.session).not.toBe(marco.session);
    await joinAndApprove(emir, amina);
    await joinAndApprove(sofia, marco);
    await sitDown(lejla, 'room'); // La Soul's room code, table 3
    await sitDown(tarik);
    await sitDown(nina);
    await sitDown(elena, 'room'); // Vera Italia's room code, table 2
    await sitDown(luca);

    const rows = (await db.query<{ id: string; venue_id: string; table_id: string; assigned_waiter_id: string }>(
      `SELECT id, venue_id, table_id, assigned_waiter_id FROM public.table_sessions`)).rows;
    for (const r of rows) {
      const s = ledger.sessions.get(r.id)!;
      expect(r.venue_id, `${label(r.id)} was opened for ${NAME[r.venue_id]}`).toBe(s.venue);
      expect(r.table_id, `${label(r.id)} sits at ${label(r.table_id)}`).toBe(s.table.id);
      expect(r.assigned_waiter_id, `${label(r.id)} was given ${label(r.assigned_waiter_id)}`).toBe(WAITER_ROW[s.venue]);
    }
    expect(rows.length).toBe(ledger.sessions.size);
  });

  it('a phone at one table 7 can neither sit at, join, nor be let into the other — whatever header it sends', async () => {
    // Amina's phone still names Vera Italia from last week: her sticker is still La Soul's table 7.
    expect((await asGuest('veraitalia', () => call<{ venue: string }>(`public.guest_table_venue(7, $1)`, [T.L7.qr]))).venue).toBe('lasoul');
    const again = await asGuest('veraitalia', () => call<{ status: string; session_id: string }>(
      `public.guest_start_table_session(7, $1, $2, 'Amina')`, [T.L7.qr, amina.client]));
    expect(again, 'Amina re-scanning her La Soul sticker with a Vera Italia header').toMatchObject({ status: 'returning', session_id: amina.session });

    // Each room code is its own restaurant's: table 7 through La Soul's is La Soul's 7.
    const viaRoom = await asGuest(null, () => call<{ status: string; session_id: string }>(
      `public.guest_inspect_table(7, $1, 'someone-new')`, [ROOM_CODE[L]]));
    expect(viaRoom, 'table 7 through La Soul\'s room code').toMatchObject({ status: 'join_required', session_id: amina.session });
    const viaVeraRoom = await asGuest('lasoul', () => call<{ status: string; session_id: string }>(
      `public.guest_inspect_table(7, $1, 'someone-new')`, [ROOM_CODE[V]]));
    expect(viaVeraRoom, 'table 7 through Vera Italia\'s room code, with a La Soul header').toMatchObject({ status: 'join_required', session_id: marco.session });
    // La Soul has no table 2: Vera Italia's table 2 is not reachable through La Soul's code.
    expect((await asGuest('veraitalia', () => call<{ status: string }>(`public.guest_inspect_table(2, $1, 'x')`, [ROOM_CODE[L]]))).status).toBe('invalid');
    const rooms = await asGuest(null, async () => ({
      l: await call<{ venue: string; max_table_number: number }>(`public.guest_check_venue_token($1)`, [ROOM_CODE[L]]),
      v: await call<{ venue: string; max_table_number: number }>(`public.guest_check_venue_token($1)`, [ROOM_CODE[V]]),
    }));
    expect(rooms.l).toMatchObject({ venue: 'lasoul', max_table_number: 12 });
    expect(rooms.v).toMatchObject({ venue: 'veraitalia', max_table_number: 9 });

    // Amina scans Vera Italia's table 7 sticker: she is offered a join, never Marco's token.
    const look = await asGuest('lasoul', () => call<Record<string, unknown>>(`public.guest_inspect_table(7, $1, $2)`, [T.V7.qr, amina.client]));
    expect(look.session_token, 'Vera Italia\'s table 7 handed its token to a La Soul phone').toBeUndefined();
    const ask = await asGuest('lasoul', () => call<{ status: string; request_id: string }>(
      `public.guest_request_join(7, $1, $2, 'Amina')`, [T.V7.qr, amina.client]));
    expect(ask.status).toBe('pending');
    ledger.joins.set(ask.request_id, V);
    LABEL.set(ask.request_id, 'Amina\'s request to join Vera Italia table 7');
    // Her own La Soul session cannot approve a request at Vera Italia's table.
    const self = await asGuest('veraitalia', () => call<{ status: string }>(
      `public.guest_resolve_join_request($1, $2, $3, 'approved', 'Amina')`, [amina.session, amina.token, ask.request_id]));
    expect(self.status, 'La Soul table 7\'s host approved a join at Vera Italia\'s table 7').toBe('missing');
    const still = await asGuest('veraitalia', () => call<{ status: string; session_token?: string }>(
      `public.guest_get_join_request($1, $2, $3)`, [marco.session, ask.request_id, amina.client]));
    expect(still.status).toBe('pending');
    expect(still.session_token ?? null).toBeNull();
    // Marco, the host there, declines it.
    await asGuest('veraitalia', () => call(`public.guest_resolve_join_request($1, $2, $3, 'declined', 'Marco')`, [marco.session, marco.token, ask.request_id]));
  });

  it('both menus are browsed, and each counts, searches and lists combos for its own restaurant', async () => {
    // Search: both menus have a "Truffle Pasta".
    for (const v of VENUES) {
      const found = await asGuest(SLUG[v], async () => (await db.query<{ id: string }>(`SELECT id FROM public.guest_search_menu('truffle')`)).rows.map((r) => r.id));
      expect(found.length).toBeGreaterThan(0);
      expect(found.filter((id) => ITEM_VENUE[id] !== v).map(label), `searching ${NAME[v]}'s menu for "truffle"`).toEqual([]);
      const combos = await asGuest(SLUG[v], () => call<{ combo_item_id: string; slots: { options: { item_id: string }[] }[] }[]>(`public.guest_get_combos()`));
      const comboItems = combos.flatMap((c) => [c.combo_item_id, ...c.slots.flatMap((s) => s.options.map((o) => o.item_id))]);
      expect(comboItems.filter((id) => ITEM_VENUE[id] !== v).map(label), `${NAME[v]}'s combos`).toEqual([]);
      expect(combos.length, `${NAME[v]}'s combos`).toBe(v === L ? 1 : 0);
      const status = await asGuest(SLUG[v], () => call<{ ordering_enabled: boolean }>(`public.guest_get_service_status()`));
      expect(status.ordering_enabled).toBe(true);
    }

    const browse = (p: Phone, items: string[]) => track(p, [
      ['menu_viewed', { has_session: true, entry: 'home' }],
      ['category_viewed', { category: 'mains' }],
      ...items.map((id) => ['item_viewed', { item_id: id }] as [string, Record<string, unknown>]),
      ...items.map((id) => ['item_added', { item_id: id, source: 'menu' }] as [string, Record<string, unknown>]),
      ['cart_viewed', { item_count: items.length }],
    ]);
    await browse(amina, [DISH.burger, DISH.cola, DISH.lsTrufflePasta, DISH.caesar]);
    await browse(marco, [DISH.ribeye, DISH.bruschetta]);
    await browse(emir, [DISH.espresso, DISH.lavaCake]);
    await browse(sofia, [DISH.viTrufflePasta]);
    await browse(lejla, [DISH.lsTrufflePasta, DISH.icedTea]);
    await browse(elena, [DISH.margherita, DISH.caprese]);
    await browse(nina, [DISH.combo, DISH.water]);
    await browse(luca, [DISH.trufflePizza, DISH.fetaDip]);
    await browse(tarik, [DISH.slider]);
    // Someone on La Soul's website (no header: La Soul) and someone on veraitalia.net, neither at a table.
    await track(website, [['menu_viewed', { has_session: false, entry: 'home' }], ['item_viewed', { item_id: DISH.burger }]], null);
    await track(veraBrowser, [['menu_viewed', { has_session: false, entry: 'home' }], ['item_viewed', { item_id: DISH.margherita }]], 'veraitalia');

    const rows = (await db.query<{ visit_id: string; venue_id: string }>(`SELECT visit_id, venue_id FROM public.analytics_events`)).rows;
    const visitVenue = new Map(ledger.events.map((e) => [e.visit, e.venue]));
    const crossed = rows.filter((r) => r.venue_id !== visitVenue.get(r.visit_id)).map((r) => `${r.visit_id} counted for ${NAME[r.venue_id]}`);
    expect(crossed, 'menu events counted for the wrong restaurant').toEqual([]);
  });

  it('each restaurant suggests its own dishes and logs each suggestion as its own', async () => {
    const amina1 = await suggest(amina, [[DISH.burger, 2], [DISH.cola, 2], [DISH.lsTrufflePasta, 1], [DISH.caesar, 1]]);
    expect(amina1.length, 'La Soul suggested nothing for a burger table').toBeGreaterThan(0);
    decisionL7 = amina1[0];
    const sofia1 = await suggest(sofia, [[DISH.viTrufflePasta, 1]]);
    expect(sofia1[0]?.id, 'Vera Italia\'s pasta suggestion').toBe(DISH.chicken);
    decisionV7 = sofia1[0];
    const elena1 = await suggest(elena, [[DISH.margherita, 1], [DISH.caprese, 1]]);
    expect(elena1.length, 'Vera Italia suggested nothing for a margherita and a caprese').toBeGreaterThan(0);
    decisionV2 = elena1[0];
    const lejla1 = await suggest(lejla, [[DISH.lsTrufflePasta, 1], [DISH.icedTea, 1]]);
    expect(lejla1.length).toBeGreaterThan(0);
    decisionL3 = lejla1[0];
    for (const [who, rows, v] of [['Amina', amina1, L], ['Sofia', sofia1, V], ['Elena', elena1, V], ['Lejla', lejla1, L]] as const) {
      expect(rows.filter((r) => ITEM_VENUE[r.id] !== v).map((r) => label(r.id)), `${who} at ${NAME[v]} was suggested`).toEqual([]);
    }
    // Amina's phone, with Vera Italia's dishes slipped into the cart and Vera Italia's header: still only La Soul's.
    const slipped = await suggest(amina, [[DISH.viTrufflePasta, 1], [DISH.margherita, 1]], { seen: false, slug: 'veraitalia' });
    expect(slipped.filter((r) => ITEM_VENUE[r.id] !== L).map((r) => label(r.id)), 'La Soul table 7 with Vera Italia dishes in its cart was suggested').toEqual([]);
    // A sighting of Vera Italia's suggestion sent with La Soul's table: nothing recorded.
    await asGuest('veraitalia', () => call(`public.guest_mark_suggestion_seen($1, $2, $3)`, [decisionV7.decision_id, amina.session, amina.token]));

    await accept(amina, decisionL7);
    await accept(sofia, decisionV7);
    await accept(elena, decisionV2);
    await track(lejla, [['suggestion_dismissed', { placement: 'cart', decision_id: decisionL3.decision_id, item_id: decisionL3.id, source_item_id: decisionL3.source_item_id }]]);
    ledger.decisions.find((d) => d.id === decisionL3.decision_id)!.dismissed = true;

    const sightings = (await db.query<{ decision_id: string; session_id: string }>(
      `SELECT i.decision_id, d.session_id FROM public.recommendation_impressions i JOIN public.recommendation_decisions d ON d.id = i.decision_id`)).rows;
    exactly('suggestions recorded as seen', sightings.map((s) => s.decision_id),
      ledger.decisions.filter((d) => d.seen).map((d) => d.id!));
  });

  it('orders go in at both table 7s at once: Vera Italia holds its large first order, La Soul — whose rule it is not — does not', async () => {
    const l7a = await placeOrder(amina, [
      line(DISH.burger, 2), line(DISH.cola, 2), line(DISH.lsTrufflePasta), line(DISH.caesar),
      line(decisionL7.id, 1, fromSuggestion(decisionL7)),
    ], 'cash', 200);
    const v7a = await placeOrder(marco, [line(DISH.ribeye), line(DISH.bruschetta)], 'cash');
    const l7b = await placeOrder(emir, [line(DISH.espresso, 2), line(DISH.lavaCake)], 'cash');
    const v7b = await placeOrder(sofia, [line(DISH.viTrufflePasta), line(DISH.chicken, 1, fromSuggestion(decisionV7))], 'cash');
    await placeOrder(lejla, [line(DISH.lsTrufflePasta), line(DISH.icedTea)], 'pos_terminal');
    await placeOrder(nina, [line(DISH.combo, 1, { choices: [
      { slot_id: SLOT.Burger, item_id: DISH.burger }, { slot_id: SLOT.Side, item_id: DISH.cheeseFries }, { slot_id: SLOT.Drink, item_id: DISH.lemonade },
    ] }), line(DISH.water)], 'pos_terminal');
    await placeOrder(elena, [line(DISH.margherita), line(DISH.caprese), line(decisionV2.id, 1, fromSuggestion(decisionV2))], 'cash', 300);
    await placeOrder(luca, [line(DISH.trufflePizza), line(DISH.fetaDip)], 'cash');
    await placeOrder(tarik, [line(DISH.slider)], 'cash');

    expect(l7a.total, 'La Soul table 7\'s first order should be over 60 KM, the size Vera Italia holds').toBeGreaterThan(6000);
    expect(l7a.held, 'La Soul held a large first order by Vera Italia\'s rule').toBe(false);
    expect(v7a.held, 'Vera Italia did not hold its large first order').toBe(true);
    expect((await db.query<{ held_reason: string }>(`SELECT held_reason FROM public.orders WHERE id = $1`, [v7a.id])).rows[0].held_reason).toBe('large_first_order');
    expect(l7b.held || v7b.held, 'a second order at a table 7 was held').toBe(false);

    // Order numbers count per restaurant: both table 7s got #001.
    for (const v of VENUES) {
      const codes = ordersOf(v).map((o) => o.code);
      expect(codes, `${NAME[v]}'s order numbers`).toEqual(codes.map((_, i) => String(i + 1).padStart(3, '0')));
    }
    expect(l7a.code).toBe('001');
    expect(v7a.code).toBe('001');

    // Every order and every line is its restaurant's, and so is every dish on it.
    const orders = (await db.query<{ id: string; venue_id: string; table_session_id: string; assigned_waiter_id: string }>(
      `SELECT id, venue_id, table_session_id, assigned_waiter_id FROM public.orders`)).rows;
    for (const o of orders) {
      const rec = ledger.orders.find((x) => x.id === o.id)!;
      expect(o.venue_id, `${label(o.id)} was filed under ${NAME[o.venue_id]}`).toBe(rec.venue);
      expect(o.assigned_waiter_id, `${label(o.id)} was given ${label(o.assigned_waiter_id)}`).toBe(WAITER_ROW[rec.venue]);
    }
    const mixedLines = (await orderLines()).filter((x) => x.venue_id !== x.order_venue || x.item_venue !== x.order_venue)
      .map((x) => `${label(x.menu_item_id)} on ${label(x.order_id)} (line filed under ${NAME[x.venue_id]})`);
    expect(mixedLines, 'order lines mixing the two restaurants').toEqual([]);
    const conversions = (await db.query<{ order_id: string; recommended_item_id: string; source_item_id: string | null; decision_id: string; o_venue: string; d_venue: string }>(
      `SELECT sc.order_id, sc.recommended_item_id, sc.source_item_id, sc.decision_id, o.venue_id AS o_venue, s.venue_id AS d_venue
         FROM public.suggestion_conversions sc JOIN public.orders o ON o.id = sc.order_id
         JOIN public.recommendation_decisions d ON d.id = sc.decision_id JOIN public.table_sessions s ON s.id = d.session_id`)).rows;
    expect(conversions.length, 'suggestions taken and paid for tonight').toBe(3);
    for (const c of conversions) {
      const where = `the suggestion bought on ${label(c.order_id)}`;
      expect(ITEM_VENUE[c.recommended_item_id], `${where} is ${label(c.recommended_item_id)}`).toBe(c.o_venue);
      if (c.source_item_id) expect(ITEM_VENUE[c.source_item_id], `${where} was credited to ${label(c.source_item_id)}`).toBe(c.o_venue);
      expect(c.d_venue, `${where} was credited to a decision made at ${NAME[c.d_venue]}`).toBe(c.o_venue);
    }
  });

  it('a guest holding one table 7\'s token cannot order onto, call for, pay, rate or read the other — whatever header the phone sends', async () => {
    const marcoOrder = orderAt('Marco');
    const aminaOrder = orderAt('Amina');
    const before = (await db.query<{ n: string }>(`SELECT count(*) AS n FROM public.orders`)).rows[0].n;
    for (const slug of ['lasoul', 'veraitalia', null]) {
      const h = `(x-venue: ${slug ?? 'none'})`;
      // Ordering another restaurant's dish onto her own table: it reads as sold out.
      await refused(`Amina ${h} ordering Vera Italia's Margherita at La Soul table 7`, () => asGuest(slug, () => call(
        `public.guest_place_order($1, $2, 'Amina', 'cash', $3::jsonb, 0, NULL)`, [amina.session, amina.token, JSON.stringify([{ menu_item_id: DISH.margherita, quantity: 1 }])])), /Unavailable: Margherita/);
      // Anything at Vera Italia's table 7 with her La Soul token.
      const atV7 = (fn: string, extra: unknown[] = []) => asGuest(slug, () => call(fn, [marco.session, amina.token, ...extra]));
      await refused(`Amina ${h} ordering onto Vera Italia's table 7`, () => atV7(`public.guest_place_order($1, $2, 'Amina', 'cash', $3::jsonb, 0, NULL)`, [JSON.stringify([{ menu_item_id: DISH.margherita, quantity: 1 }])]), BAD_SESSION);
      await refused(`Amina ${h} calling a waiter to Vera Italia's table 7`, () => atV7(`public.guest_call_waiter($1, $2, 'assist')`), BAD_SESSION);
      await refused(`Amina ${h} asking for Vera Italia table 7's bill`, () => atV7(`public.guest_request_bill($1, $2)`), BAD_SESSION);
      await refused(`Amina ${h} reading Vera Italia table 7's tab`, () => atV7(`public.guest_get_tab($1, $2)`), BAD_SESSION);
      await refused(`Amina ${h} rating Vera Italia table 7's visit`, () => atV7(`public.guest_submit_visit_rating($1, $2, 1)`), BAD_SESSION);
      await refused(`Amina ${h} reading Vera Italia table 7's waiter`, () => atV7(`public.guest_get_waiter_for_review($1, $2)`), BAD_SESSION);
      await refused(`Amina ${h} listing Vera Italia table 7's join requests`, () => atV7(`public.guest_list_pending_join_requests($1, $2, 'x')`), BAD_SESSION);
      await refused(`Amina ${h} asking Vera Italia's table 7 for suggestions`, () => atV7(`public.guest_get_recommendations($1, $2)`), BAD_SESSION);
      expect(await atV7(`public.touch_session($1, $2)`), `Amina ${h} kept Vera Italia's table 7 alive`).toBe(false);
      expect((await atV7(`public.guest_resume_session($1, $2)`) as { status: string }).status).toBe('unknown');
      // Vera Italia's order, through her own La Soul table.
      const pay = await asGuest(slug, () => call<{ status: string }>(`public.guest_get_order_payment($1, $2, $3)`, [amina.session, amina.token, marcoOrder.id]));
      expect(pay.status, `Amina ${h} read the payment of ${label(marcoOrder.id)}`).toBe('not_found');
      const sw = await asGuest(slug, () => call<{ status: string }>(`public.guest_switch_to_pay_at_table($1, $2, $3, 'cash')`, [amina.session, amina.token, marcoOrder.id]));
      expect(sw.status, `Amina ${h} switched ${label(marcoOrder.id)} to pay at table`).toBe('not_switchable');
      await refused(`Amina ${h} rating Vera Italia's waiter Giulia`, () => asGuest(slug, () => call(
        `public.guest_submit_server_rating($1, $2, $3, 1, 'x')`, [amina.session, amina.token, WAITER_ROW[V]])), /Invalid waiter/);
      // And the other way round: Marco's token at La Soul's table 7.
      await refused(`Marco ${h} ordering onto La Soul's table 7`, () => asGuest(slug, () => call(
        `public.guest_place_order($1, $2, 'Marco', 'cash', $3::jsonb, 0, NULL)`, [amina.session, marco.token, JSON.stringify([{ menu_item_id: DISH.burger, quantity: 1 }])])), BAD_SESSION);
      await refused(`Marco ${h} calling a waiter to La Soul's table 7`, () => asGuest(slug, () => call(`public.guest_call_waiter($1, $2, 'pay')`, [amina.session, marco.token])), BAD_SESSION);
      await refused(`Marco ${h} reading La Soul table 7's tab`, () => asGuest(slug, () => call(`public.guest_get_tab($1, $2)`, [amina.session, marco.token])), BAD_SESSION);
      await refused(`Marco ${h} ordering La Soul's burger at Vera Italia table 7`, () => asGuest(slug, () => call(
        `public.guest_place_order($1, $2, 'Marco', 'cash', $3::jsonb, 0, NULL)`, [marco.session, marco.token, JSON.stringify([{ menu_item_id: DISH.burger, quantity: 1 }])])), /Unavailable: La Soul Burger/);
      const pay2 = await asGuest(slug, () => call<{ status: string }>(`public.guest_get_order_payment($1, $2, $3)`, [marco.session, marco.token, aminaOrder.id]));
      expect(pay2.status, `Marco ${h} read the payment of ${label(aminaOrder.id)}`).toBe('not_found');
    }
    expect((await db.query<{ n: string }>(`SELECT count(*) AS n FROM public.orders`)).rows[0].n, 'an order got through').toBe(before);
    expect((await db.query(`SELECT 1 FROM public.orders WHERE id = $1 AND released_to_kitchen_at IS NULL`, [marcoOrder.id])).rows.length,
      'Vera Italia\'s held order was released by a La Soul phone').toBe(1);

    // Each tab — the split-the-bill screen — is its own table's.
    for (const p of [amina, marco]) {
      const tab = await asGuest(SLUG[p.venue], () => call<{ orders: { id: string; held: boolean }[]; members: string[] }>(`public.guest_get_tab($1, $2)`, [p.session, p.token]));
      exactly(`${p.who}'s tab at ${NAME[p.venue]} table 7`, tab.orders.map((o) => o.id), ordersOf(p.venue).filter((o) => o.session === p.session).map((o) => o.id));
      expect(tab.members.sort(), `who is at ${NAME[p.venue]} table 7`).toEqual(p.venue === L ? ['Amina', 'Emir'] : ['Marco', 'Sofia']);
    }
    // Vera Italia's held order is held on Vera Italia's tab only.
    const veraTab = await asGuest('veraitalia', () => call<{ orders: { id: string; held: boolean }[] }>(`public.guest_get_tab($1, $2)`, [marco.session, marco.token]));
    expect(veraTab.orders.find((o) => o.id === marcoOrder.id)?.held).toBe(true);
  });

  it('Tarik leaves before his order is started: La Soul\'s waiter cancels it, and cannot cancel Vera Italia\'s', async () => {
    const tarikOrder = orderAt('Tarik');
    await refused('La Soul\'s waiter cancelling Luca\'s order at Vera Italia', () => asUser(WAITER[L], 'veraitalia', () => call(
      `public.cancel_order($1, 'Guest left')`, [orderAt('Luca').id])), NOT_HERE);
    await asUser(WAITER[L], 'lasoul', () => call(`public.cancel_order($1, 'Guest left')`, [tarikOrder.id]));
    tarikOrder.cancelled = true;
    expect((await db.query<{ status: string }>(`SELECT status::text FROM public.orders WHERE id = $1`, [orderAt('Luca').id])).rows[0].status).toBe('pending');
  });

  it('each kitchen sees only its own tickets, even with the other restaurant\'s header', async () => {
    const open = await orderLines();
    for (const v of VENUES) {
      const ownLines = open.filter((x) => x.order_venue === v && x.status !== 'served' && !ordersOf(v).find((o) => o.id === x.order_id)!.cancelled
        && ordersOf(v).find((o) => o.id === x.order_id)!.released).map((x) => x.id);
      for (const slug of ['lasoul', 'veraitalia', null, 'nonsense']) {
        const who = `${ROLE_LABEL[KITCHEN[v]]} (x-venue: ${slug ?? 'none'})`;
        const board = await asUser(KITCHEN[v], slug, async () => (await db.query<{ menu_item_id: string; open_ids: string[] }>(
          `SELECT menu_item_id, open_ids FROM public.kds_all_day()`)).rows);
        exactly(`${who}: the lines on the all-day board`, board.flatMap((b) => b.open_ids), ownLines);
        expect(board.filter((b) => ITEM_VENUE[b.menu_item_id] !== v).map((b) => label(b.menu_item_id)), `${who}: dishes on the all-day board`).toEqual([]);
        const tickets = await asUser(KITCHEN[v], slug, async () => (await db.query<{ id: string; venue_id: string }>(
          `SELECT id, venue_id FROM public.orders WHERE released_to_kitchen_at IS NOT NULL AND status IN ('pending', 'confirmed', 'preparing', 'ready')`)).rows);
        exactly(`${who}: tickets on the kitchen screen`, tickets.map((t) => t.id), completedOf(v).map((o) => o.id));
        const load = await asUser(KITCHEN[v], slug, async () => (await db.query<{ station: string; open_items: number }>(`SELECT station, open_items FROM public.kitchen_load()`)).rows);
        const want = (station: string) => completedOf(v).flatMap((o) => o.lines).filter((l) => STATION[l.item] === station).reduce((s, l) => s + l.qty, 0);
        for (const r of load) {
          expect(r.open_items, `${who}: kitchen_load ${r.station} (La Soul ${completedOf(L).flatMap((o) => o.lines).filter((l) => STATION[l.item] === r.station).reduce((s, l) => s + l.qty, 0)}, Vera Italia ${completedOf(V).flatMap((o) => o.lines).filter((l) => STATION[l.item] === r.station).reduce((s, l) => s + l.qty, 0)})`).toBe(want(r.station));
        }
      }
    }
    // The held order is on nobody's board until a waiter confirms it.
    const held = orderAt('Marco');
    // (One connection: each reader in turn, never concurrently.)
    for (const v of VENUES) {
      for (const slug of ['lasoul', 'veraitalia', null]) {
        const list = await asUser(WAITER[v], slug, async () => (await db.query<{ id: string }>(
          `SELECT id FROM public.orders WHERE held_reason IS NOT NULL AND released_to_kitchen_at IS NULL AND status <> 'cancelled'`)).rows.map((r) => r.id));
        exactly(`${ROLE_LABEL[WAITER[v]]} (x-venue: ${slug ?? 'none'}): the "to confirm" list`, list, v === V ? [held.id] : []);
      }
    }
  });

  it('each restaurant\'s printers print only its own tickets — both are called "Kitchen"', async () => {
    const queued = async () => (await db.query<{ id: string; order_id: string; ticket_type: string; venue_id: string; status: string }>(
      `SELECT t.id, t.order_id, t.ticket_type, t.venue_id, t.status FROM public.order_ticket_events t`)).rows;
    const all = await queued();
    for (const t of all) {
      LABEL.set(t.id, `${t.ticket_type} ticket of ${label(t.order_id)}`);
      expect(t.venue_id, `${label(t.id)} was filed under ${NAME[t.venue_id]}`).toBe(ledger.orders.find((o) => o.id === t.order_id)!.venue);
    }
    // Tarik's cancelled order never prints; every other released order has a ticket.
    expect(all.filter((t) => t.order_id === orderAt('Tarik').id).every((t) => t.status === 'cancelled'), 'Tarik\'s cancelled order is still waiting to print').toBe(true);
    for (const o of ledger.orders.filter((x) => x.released && !x.cancelled)) {
      expect(all.some((t) => t.order_id === o.id), `${label(o.id)} has no ticket`).toBe(true);
    }

    // The browser-print path from a kitchen screen: never the other restaurant's ticket.
    const veraTicket = all.find((t) => t.venue_id === V && t.status === 'queued')!;
    await refused('La Soul\'s kitchen claiming a Vera Italia ticket to print', () => asUser(KITCHEN[L], 'veraitalia', () => call(
      `public.claim_ticket_print($1, 'kds-lasoul', $2)`, [veraTicket.order_id, veraTicket.ticket_type])), NOT_HERE);
    await refused('La Soul\'s kitchen reporting a Vera Italia ticket printed', () => asUser(KITCHEN[L], null, () => call(
      `public.report_ticket_print($1, true, NULL, $2, true)`, [veraTicket.order_id, veraTicket.ticket_type])), NOT_HERE);
    // A printer asking for the other restaurant's ticket by id gets nothing.
    const stolen = await asPrinterService(() => call(`public.cloud_print_claim($1, $2)`, [PRINTERS[0].token, veraTicket.id]));
    expect(stolen, 'La Soul\'s Kitchen printer claimed a Vera Italia ticket by its id').toBeNull();

    // Each printer checks in and is offered its own restaurant's next ticket.
    for (const p of PRINTERS) {
      const hello = await asPrinterService(() => call<{ next_ticket_id: string | null }>(`public.cloud_printer_checkin($1, 'star_cloudprnt', NULL, 'ok')`, [p.token]));
      const want = all.filter((t) => t.venue_id === p.venue && t.status === 'queued' && p.types.includes(t.ticket_type)).map((t) => t.id);
      expect(want.length, `${p.key} has nothing to print`).toBeGreaterThan(0);
      expect(want, `${p.key} was offered ${label(String(hello.next_ticket_id))}`).toContain(hello.next_ticket_id);
    }
    // Both "Kitchen" printers hold a job at the same moment; each report closes its own.
    const lJob = await asPrinterService(() => call<{ ticket_id: string }>(`public.cloud_print_claim($1, NULL)`, [PRINTERS[0].token]));
    const vJob = await asPrinterService(() => call<{ ticket_id: string }>(`public.cloud_print_claim($1, NULL)`, [PRINTERS[2].token]));
    const vReported = await asPrinterService(() => call<string>(`public.cloud_print_report($1, NULL, true, NULL)`, [PRINTERS[2].token]));
    expect(vReported, 'Vera Italia\'s "Kitchen" reported printed a ticket that was not its own').toBe(vJob.ticket_id);
    expect((await db.query<{ status: string }>(`SELECT status FROM public.order_ticket_events WHERE id = $1`, [lJob.ticket_id])).rows[0].status,
      'La Soul\'s "Kitchen" job was closed by Vera Italia\'s printer').toBe('claimed');
    await asPrinterService(() => call(`public.cloud_print_report($1, $2, true, NULL)`, [PRINTERS[0].token, lJob.ticket_id]));
    ledger.printed.set(lJob.ticket_id, PRINTERS[0].key);
    ledger.printed.set(vJob.ticket_id, PRINTERS[2].key);
    // Then each prints everything it is given.
    for (const p of PRINTERS) {
      for (let i = 0; i < 50; i++) {
        const job = await asPrinterService(() => call<{ ticket_id: string; order_id: string; ticket_type: string } | null>(`public.cloud_print_claim($1, NULL)`, [p.token]));
        if (!job) break;
        ledger.printed.set(job.ticket_id, p.key);
        expect(await asPrinterService(() => call<string>(`public.cloud_print_report($1, $2, true, NULL)`, [p.token, job.ticket_id]))).toBe(job.ticket_id);
      }
    }
    for (const t of all.filter((x) => x.status === 'queued')) {
      const printer = PRINTERS.find((p) => p.key === ledger.printed.get(t.id));
      expect(printer?.key, `${label(t.id)} was never printed`).toBeDefined();
      expect(printer!.venue, `${label(t.id)} came out of ${printer!.key}`).toBe(t.venue_id);
      expect(printer!.types, `${label(t.id)} came out of ${printer!.key}`).toContain(t.ticket_type);
    }
    // The printers' health, per restaurant, for its admin and for the owner by the switch.
    for (const [user, slug, v] of [[ADMIN[L], 'veraitalia', L], [ADMIN[V], 'lasoul', V], [OWNER, 'lasoul', L], [OWNER, 'veraitalia', V], [OWNER, null, L]] as const) {
      const list = await asUser(user, slug, async () => (await db.query<{ id: string; name: string; waiting: number }>(`SELECT id, name, waiting FROM public.printer_health()`)).rows);
      expect(list.map((p) => p.name).sort(), `${ROLE_LABEL[user]} (x-venue: ${slug ?? 'none'}) on the printers page`)
        .toEqual(PRINTERS.filter((p) => p.venue === v).map((p) => p.name).sort());
      expect(list.every((p) => p.waiting === 0), `${ROLE_LABEL[user]} sees tickets waiting at ${NAME[v]}`).toBe(true);
    }
  });

  it('only Vera Italia\'s waiter can confirm its held order, and only then does it print — at Vera Italia', async () => {
    const held = orderAt('Marco');
    for (const slug of ['veraitalia', 'lasoul', null]) {
      await refused(`La Soul's waiter (x-venue: ${slug ?? 'none'}) confirming Vera Italia's held order`, () => asUser(WAITER[L], slug, () => call(
        `public.staff_release_held_order($1)`, [held.id])), NOT_HERE);
      // Nor rejecting it the other way: blocking the table as fake would void it.
      await refused(`La Soul's waiter (x-venue: ${slug ?? 'none'}) blocking Vera Italia's table 7 as fake`, () => asUser(WAITER[L], slug, () => call(
        `public.staff_block_session($1, 'looks fake')`, [marco.session])), NOT_HERE);
    }
    const v7 = (await db.query<{ blocked_at: string | null; status: string }>(
      `SELECT s.blocked_at, o.status::text FROM public.table_sessions s JOIN public.orders o ON o.table_session_id = s.id WHERE o.id = $1`, [held.id])).rows[0];
    expect(v7, 'Vera Italia table 7 after La Soul\'s waiter tried to block it').toEqual({ blocked_at: null, status: 'pending' });
    expect((await db.query(`SELECT 1 FROM public.order_ticket_events WHERE order_id = $1`, [held.id])).rows.length, 'the held order printed before anyone confirmed it').toBe(0);
    const r = await asUser(WAITER[V], 'veraitalia', () => call<{ status: string }>(`public.staff_release_held_order($1)`, [held.id]));
    expect(r.status).toBe('released');
    held.released = true;
    const tickets = (await db.query<{ id: string; venue_id: string; ticket_type: string }>(`SELECT id, venue_id, ticket_type FROM public.order_ticket_events WHERE order_id = $1`, [held.id])).rows;
    expect(tickets.length).toBeGreaterThan(0);
    for (const t of tickets) {
      LABEL.set(t.id, `${t.ticket_type} ticket of ${label(held.id)}`);
      expect(t.venue_id, `${label(t.id)} filed under ${NAME[t.venue_id]}`).toBe(V);
    }
    // La Soul's printers poll first: nothing for them.
    for (const p of PRINTERS.filter((x) => x.venue === L)) {
      const job = await asPrinterService(() => call<{ ticket_id: string } | null>(`public.cloud_print_claim($1, NULL)`, [p.token]));
      expect(job && label(job.ticket_id), `${p.key} printed a Vera Italia ticket`).toBeNull();
    }
    const claimed: string[] = [];
    for (let i = 0; i < 10; i++) {
      const job = await asPrinterService(() => call<{ ticket_id: string } | null>(`public.cloud_print_claim($1, NULL)`, [PRINTERS[2].token]));
      if (!job) break;
      claimed.push(job.ticket_id);
      ledger.printed.set(job.ticket_id, PRINTERS[2].key);
      await asPrinterService(() => call(`public.cloud_print_report($1, $2, true, NULL)`, [PRINTERS[2].token, job.ticket_id]));
    }
    exactly('what Vera Italia\'s printer printed once the held order was confirmed', claimed, tickets.map((t) => t.id));
  });

  it('waiter calls and bill requests at both table 7s reach their own waiter only; the other\'s cannot take them', async () => {
    const callOf = async (p: Phone, reason: string) => {
      const r = await asGuest(SLUG[p.venue], () => call<{ call_id: string }>(`public.guest_call_waiter($1, $2, $3)`, [p.session, p.token, reason]));
      ledger.calls.set(r.call_id, p.venue);
      LABEL.set(r.call_id, `${p.who}'s call at ${NAME[p.venue]} table ${p.table.number}`);
      await track(p, [['waiter_called', { reason }]]);
      return r.call_id;
    };
    const billOf = async (p: Phone) => {
      const r = await asGuest(SLUG[p.venue], () => call<{ bill_request_id: string }>(`public.guest_request_bill($1, $2)`, [p.session, p.token]));
      ledger.bills.set(r.bill_request_id, p.venue);
      LABEL.set(r.bill_request_id, `${p.who}'s bill request at ${NAME[p.venue]} table ${p.table.number}`);
      await track(p, [['bill_requested', { orders: 1 }]]);
      return r.bill_request_id;
    };
    const cL7 = await callOf(amina, 'assist');
    const cV7 = await callOf(marco, 'pay');
    const cL3 = await callOf(lejla, 'assist');
    const bL7 = await billOf(emir);
    const bV7 = await billOf(sofia);
    const bV2 = await billOf(elena);

    for (const v of VENUES) {
      for (const user of [WAITER[v], ADMIN[v], OWNER]) {
        for (const slug of user === OWNER ? [SLUG[v], ...(v === L ? [null, 'nonsense'] : [])] : ['lasoul', 'veraitalia', null, 'nonsense']) {
          const who = `${ROLE_LABEL[user]} (x-venue: ${slug ?? 'none'})`;
          const calls = await asUser(user, slug, async () => (await db.query<{ id: string }>(`SELECT id FROM public.waiter_calls WHERE status <> 'resolved'`)).rows.map((r) => r.id));
          exactly(`${who}: open waiter calls`, calls, [...ledger.calls].filter(([, cv]) => cv === v).map(([id]) => id));
          const bills = await asUser(user, slug, async () => (await db.query<{ id: string }>(`SELECT id FROM public.bill_requests WHERE status <> 'resolved'`)).rows.map((r) => r.id));
          exactly(`${who}: open bill requests`, bills, [...ledger.bills].filter(([, bv]) => bv === v).map(([id]) => id));
        }
      }
    }

    // While the calls are still pending, the other restaurant's waiter cannot take or close them.
    await refused('La Soul\'s waiter taking Vera Italia table 7\'s call', () => asUser(WAITER[L], 'veraitalia', () => call(`public.staff_ack_waiter_call($1)`, [cV7])), NOT_HERE);
    await refused('Vera Italia\'s waiter closing La Soul table 7\'s call', () => asUser(WAITER[V], 'lasoul', () => call(`public.staff_resolve_waiter_call($1)`, [cL7])), NOT_HERE);
    await refused('La Soul\'s waiter taking Vera Italia table 7\'s bill request', () => asUser(WAITER[L], null, () => call(`public.staff_ack_bill_request($1)`, [bV7])), NOT_HERE);
    await refused('La Soul\'s waiter closing Vera Italia table 2\'s bill request', () => asUser(WAITER[L], null, () => call(`public.staff_resolve_bill_request($1, false)`, [bV2])), NOT_HERE);
    await refused('La Soul\'s kitchen closing Vera Italia table 7\'s call', () => asUser(KITCHEN[L], 'veraitalia', () => call(`public.staff_resolve_waiter_call($1)`, [cV7])), NOT_HERE);
    const statuses = (await db.query<{ status: string }>(`SELECT status FROM public.waiter_calls WHERE id = ANY($1::uuid[])
                        UNION ALL SELECT status FROM public.bill_requests WHERE id = ANY($1::uuid[])`, [[cV7, cL7, bV7, bV2]])).rows.map((r) => r.status);
    expect(statuses, 'a call or bill request moved when the other restaurant touched it').toEqual(['pending', 'pending', 'pending', 'pending']);

    // Each waiter takes their own, and walks over.
    for (const [v, id] of [[L, cL7], [V, cV7], [L, cL3]] as const) {
      const r = await asUser(WAITER[v], SLUG[v], () => call<{ mine: boolean }>(`public.staff_ack_waiter_call($1)`, [id]));
      expect(r.mine, `${ROLE_LABEL[WAITER[v]]} taking ${label(id)}`).toBe(true);
      await asUser(WAITER[v], SLUG[v], () => call(`public.staff_resolve_waiter_call($1)`, [id]));
    }
    for (const [v, id] of [[L, bL7], [V, bV7], [V, bV2]] as const) {
      expect((await asUser(WAITER[v], SLUG[v], () => call<{ mine: boolean }>(`public.staff_ack_bill_request($1)`, [id]))).mine).toBe(true);
    }
    const acked = (await db.query<{ id: string; acknowledged_by: string; venue_id: string }>(
      `SELECT id, acknowledged_by, venue_id FROM public.waiter_calls UNION ALL SELECT id, acknowledged_by, venue_id FROM public.bill_requests`)).rows;
    for (const a of acked) expect(a.acknowledged_by, `${label(a.id)} was taken by ${ROLE_LABEL[a.acknowledged_by]}`).toBe(WAITER[a.venue_id]);
  });

  it('each kitchen bumps its own and the waiters serve their own; the other\'s line and order ids are refused', async () => {
    const lineIds = async (v: string) => (await orderLines()).filter((x) => x.order_venue === v).map((x) => x.id);
    const statusOf = async (ids: string[]) => (await db.query<{ status: string }>(`SELECT status::text FROM public.order_items WHERE id = ANY($1::uuid[]) ORDER BY id`, [ids])).rows.map((r) => r.status);
    // A kitchen tapping "start all" with the other restaurant's lines: nothing moves.
    for (const v of VENUES) {
      const theirs = await lineIds(other(v));
      const before = await statusOf(theirs);
      const r = await asUser(KITCHEN[v], SLUG[other(v)], () => call<{ updated: number }>(`public.staff_bump_order_items($1::uuid[], 'preparing')`, [theirs]));
      expect(r.updated, `${ROLE_LABEL[KITCHEN[v]]} bumped ${NAME[other(v)]}'s lines`).toBe(0);
      expect(await statusOf(theirs), `${NAME[other(v)]}'s lines after ${ROLE_LABEL[KITCHEN[v]]} tapped them`).toEqual(before);
      await refused(`${ROLE_LABEL[KITCHEN[v]]} bumping one of ${NAME[other(v)]}'s lines`, () => asUser(KITCHEN[v], null, () => call(
        `public.staff_bump_order_item($1, 'ready')`, [theirs[0]])), /Only staff can bump items/);
    }
    // Start all, from each kitchen's own board.
    for (const v of VENUES) {
      const pending = await asUser(KITCHEN[v], SLUG[v], async () => (await db.query<{ pending_ids: string[] }>(`SELECT pending_ids FROM public.kds_all_day()`)).rows.flatMap((r) => r.pending_ids));
      const r = await asUser(KITCHEN[v], SLUG[v], () => call<{ updated: number }>(`public.staff_bump_order_items($1::uuid[], 'preparing')`, [pending]));
      expect(r.updated).toBe(pending.length);
    }
    // Luca's order is in the oven when he has to leave: his waiter may not cancel it, Vera Italia's admin does.
    const lucaOrder = orderAt('Luca');
    await refused('Vera Italia\'s waiter cancelling an order in production', () => asUser(WAITER[V], 'veraitalia', () => call(
      `public.cancel_order($1, 'Guest had to leave')`, [lucaOrder.id])), /A manager must cancel/);
    await refused('La Soul\'s admin cancelling Vera Italia\'s order in production', () => asUser(ADMIN[L], 'veraitalia', () => call(
      `public.cancel_order($1, 'x')`, [lucaOrder.id])), NOT_HERE);
    await asUser(ADMIN[V], 'veraitalia', () => call(`public.cancel_order($1, 'Guest had to leave')`, [lucaOrder.id]));
    lucaOrder.cancelled = true;
    // All up, then served by each restaurant's waiter.
    for (const v of VENUES) {
      const open = await asUser(KITCHEN[v], SLUG[v], async () => (await db.query<{ open_ids: string[] }>(`SELECT open_ids FROM public.kds_all_day()`)).rows.flatMap((r) => r.open_ids));
      await asUser(KITCHEN[v], SLUG[v], () => call(`public.staff_bump_order_items($1::uuid[], 'ready')`, [open]));
    }
    for (const v of VENUES) {
      for (const o of completedOf(v)) {
        await refused(`${ROLE_LABEL[WAITER[other(v)]]} serving ${label(o.id)}`, () => asUser(WAITER[other(v)], SLUG[v], () => call(
          `public.staff_update_order_status($1, 'served')`, [o.id])), NOT_HERE);
        await asUser(WAITER[v], SLUG[v], () => call(`public.staff_update_order_status($1, 'served')`, [o.id]));
        o.served = true;
      }
    }
    // A mis-tap undone from the other restaurant: refused.
    for (const v of VENUES) {
      const o = completedOf(v)[0];
      await refused(`${ROLE_LABEL[WAITER[other(v)]]} undoing ${label(o.id)} back to ready`, () => asUser(WAITER[other(v)], SLUG[v], () => call(
        `public.staff_revert_order_status($1, 'ready', 'mis-tap')`, [o.id])), /Only staff can undo/);
    }
    const statuses = (await db.query<{ id: string; status: string }>(`SELECT id, status::text FROM public.orders`)).rows;
    for (const s of statuses) {
      const o = ledger.orders.find((x) => x.id === s.id)!;
      expect(s.status, label(s.id)).toBe(o.cancelled ? 'cancelled' : 'served');
    }
    // Head counts, each waiter for their own tables only.
    const covers: Array<[Phone, number]> = [[amina, 2], [lejla, 1], [nina, 1], [marco, 4], [elena, 2]];
    for (const [p, n] of covers) {
      await refused(`${ROLE_LABEL[WAITER[other(p.venue)]]} setting covers at ${label(p.session!)}`, () => asUser(WAITER[other(p.venue)], SLUG[p.venue], () => call(
        `public.staff_set_covers($1, $2)`, [p.session, 9])), NOT_HERE);
      await asUser(WAITER[p.venue], SLUG[p.venue], () => call(`public.staff_set_covers($1, $2)`, [p.session, n]));
      ledger.sessions.get(p.session!)!.covers = n;
    }
  });

  it('money: cash and card at both, a refund at each — the other restaurant can take, refund or move none of it', async () => {
    const pay = (p: Phone, method: 'cash' | 'pos_terminal', n = 0) => async () => {
      const o = orderAt(p.who, n);
      await refused(`${ROLE_LABEL[WAITER[other(o.venue)]]} recording ${label(o.id)} as paid`, () => asUser(WAITER[other(o.venue)], SLUG[o.venue], () => call(
        `public.record_table_payment($1, $2, NULL)`, [o.id, method])), NOT_HERE);
      const r = await asUser(WAITER[o.venue], SLUG[o.venue], () => call<{ status: string }>(`public.record_table_payment($1, $2, NULL)`, [o.id, method]));
      expect(r.status, `${label(o.id)}`).toBe('paid');
      o.paid = true;
      o.method = method;
    };
    await pay(amina, 'cash')();
    await pay(emir, 'cash')();
    await pay(marco, 'pos_terminal')();
    await pay(sofia, 'pos_terminal')();
    await pay(lejla, 'pos_terminal')();
    await pay(nina, 'pos_terminal')();
    await pay(elena, 'cash')();

    // A refund at each: the iced tea at La Soul back on the card, five KM in cash at Vera Italia.
    const refund = async (o: OrderRec, amount: number, method: string) => {
      await refused(`${ROLE_LABEL[ADMIN[other(o.venue)]]} refunding ${label(o.id)}`, () => asUser(ADMIN[other(o.venue)], SLUG[o.venue], () => call(
        `public.record_order_refund($1, $2, $3, 'wrong drink', true, NULL)`, [o.id, amount / 100, method])), NOT_HERE);
      const r = await asUser(ADMIN[o.venue], SLUG[o.venue], () => call<{ refund_id: string }>(
        `public.record_order_refund($1, $2, $3, 'wrong drink', true, NULL)`, [o.id, amount / 100, method]));
      ledger.refunds.set(r.refund_id, o.venue);
      LABEL.set(r.refund_id, `the refund on ${label(o.id)}`);
      o.refunded = amount;
      o.refundMethod = method;
    };
    await refund(orderAt('Lejla'), PRICE[DISH.icedTea], 'pos_terminal');
    await refund(orderAt('Elena'), 500, 'cash');

    const money = (await db.query<{ id: string; payment_status: string; payment_method: string; refunded_amount: string; paid_by: string }>(
      `SELECT id, payment_status, payment_method, refunded_amount, paid_by FROM public.orders`)).rows;
    for (const m of money) {
      const o = ledger.orders.find((x) => x.id === m.id)!;
      expect(cents(m.refunded_amount), `refunded on ${label(m.id)}`).toBe(o.refunded);
      if (o.paid) {
        expect(m.payment_method, `how ${label(m.id)} was paid`).toBe(o.method);
        expect(m.paid_by, `${label(m.id)} was taken by ${ROLE_LABEL[m.paid_by]}`).toBe(WAITER[o.venue]);
      }
    }
  });

  it('guests rate their visit and their own waiter only', async () => {
    const rate = async (p: Phone, visit: number, server?: number, comment = '') => {
      const waiter = await asGuest(SLUG[p.venue], () => call<{ id: string; display_name: string } | null>(`public.guest_get_waiter_for_review($1, $2)`, [p.session, p.token]));
      expect(waiter?.id, `${p.who} at ${NAME[p.venue]} is asked to rate ${waiter?.display_name}`).toBe(WAITER_ROW[p.venue]);
      const r = await asGuest(SLUG[p.venue], () => call<{ rating_id: string }>(`public.guest_submit_visit_rating($1, $2, $3)`, [p.session, p.token, visit]));
      ledger.ratings.set(r.rating_id, { venue: p.venue, rating: visit });
      if (server !== undefined) {
        const s = await asGuest(SLUG[p.venue], () => call<{ rating_id: string }>(`public.guest_submit_server_rating($1, $2, $3, $4, $5)`, [p.session, p.token, waiter!.id, server, comment]));
        ledger.serverRatings.set(s.rating_id, { venue: p.venue, rating: server, waiter: waiter!.id });
      }
      await track(p, [['feedback_submitted', { kind: 'visit', rating: visit }]]);
    };
    await rate(amina, 5, 5);
    await rate(marco, 4, 2, 'Slow with the bill');
    await rate(lejla, 3);
    await rate(elena, 5, 4);
    await refused('Elena at Vera Italia rating La Soul\'s waiter Amar', () => asGuest('lasoul', () => call(
      `public.guest_submit_server_rating($1, $2, $3, 5, '')`, [elena.session, elena.token, WAITER_ROW[L]])), /Invalid waiter/);
    const rows = (await db.query<{ id: string; venue_id: string; waiter_venue: string | null }>(
      `SELECT r.id, r.venue_id, NULL AS waiter_venue FROM public.ratings r
       UNION ALL SELECT s.id, s.venue_id, w.venue_id FROM public.server_ratings s JOIN public.waiters w ON w.id = s.waiter_id`)).rows;
    for (const r of rows) {
      const want = (ledger.ratings.get(r.id) ?? ledger.serverRatings.get(r.id))!.venue;
      expect(r.venue_id, `a rating from ${NAME[want]} was filed under ${NAME[r.venue_id]}`).toBe(want);
      if (r.waiter_venue) expect(r.waiter_venue, `a ${NAME[want]} guest rated a waiter of ${NAME[r.waiter_venue]}`).toBe(want);
    }
  });

  it('each waiter frees their own tables; the other restaurant\'s waiter cannot', async () => {
    for (const p of [amina, lejla, nina, tarik, marco, elena, luca]) {
      await refused(`${ROLE_LABEL[WAITER[other(p.venue)]]} freeing ${label(p.session!)}`, () => asUser(WAITER[other(p.venue)], SLUG[p.venue], () => call(
        `public.staff_close_session($1)`, [p.session])), NOT_HERE);
    }
    // Through the bill request where there is one, as the waiter screen does.
    for (const [id, v] of ledger.bills) {
      const r = await asUser(WAITER[v], SLUG[v], () => call<{ closed: boolean; outstanding: number }>(`public.staff_resolve_bill_request($1, true)`, [id]));
      expect(r, `${ROLE_LABEL[WAITER[v]]} closing ${label(id)} and freeing the table`).toMatchObject({ closed: true, outstanding: 0 });
    }
    for (const p of [lejla, nina, tarik, luca]) {
      const r = await asUser(WAITER[p.venue], SLUG[p.venue], () => call<{ closed: boolean }>(`public.staff_close_session($1)`, [p.session]));
      expect(r.closed, `freeing ${label(p.session!)}`).toBe(true);
    }
    expect((await db.query(`SELECT id FROM public.table_sessions WHERE is_active`)).rows, 'tables still open at closing time').toEqual([]);
  });

  it('every row written tonight carries its own restaurant', async () => {
    const check = async (table: string, want: Map<string, string>) => {
      const rows = (await db.query<{ id: string; venue_id: string }>(`SELECT id, venue_id FROM public.${table}`)).rows;
      exactly(`${table}: rows written tonight`, rows.map((r) => r.id), [...want.keys()]);
      const wrong = rows.filter((r) => r.venue_id !== want.get(r.id)).map((r) => `${label(r.id)} filed under ${NAME[r.venue_id]}`);
      expect(wrong, `${table}: rows filed under the wrong restaurant`).toEqual([]);
    };
    await check('table_sessions', new Map([...ledger.sessions].map(([id, s]) => [id, s.venue])));
    await check('orders', new Map(ledger.orders.map((o) => [o.id, o.venue])));
    await check('waiter_calls', ledger.calls);
    await check('bill_requests', ledger.bills);
    await check('session_join_requests', ledger.joins);
    await check('ratings', new Map([...ledger.ratings].map(([id, r]) => [id, r.venue])));
    await check('server_ratings', new Map([...ledger.serverRatings].map(([id, r]) => [id, r.venue])));
    await check('order_refunds', ledger.refunds);

    const lines = await orderLines();
    expect(lines.filter((x) => x.venue_id !== x.order_venue || x.item_venue !== x.order_venue).map((x) => `${label(x.menu_item_id)} on ${label(x.order_id)}`),
      'order lines mixing restaurants').toEqual([]);
    const tickets = (await db.query<{ id: string; order_id: string; venue_id: string; status: string }>(`SELECT id, order_id, venue_id, status FROM public.order_ticket_events`)).rows;
    for (const t of tickets) {
      const o = ledger.orders.find((x) => x.id === t.order_id)!;
      expect(t.venue_id, `${label(t.id)} filed under ${NAME[t.venue_id]}`).toBe(o.venue);
      if (t.status === 'printed') expect(PRINTERS.find((p) => p.key === ledger.printed.get(t.id))?.venue, `${label(t.id)} printed at`).toBe(o.venue);
    }

    // Analytics: every event is the restaurant of the menu it was sent from.
    const events = (await db.query<{ visit_id: string; event: string; venue_id: string }>(`SELECT visit_id, event, venue_id FROM public.analytics_events`)).rows;
    expect(events.length, 'analytics events stored').toBe(ledger.events.length);
    const visitVenue = new Map(ledger.events.map((e) => [e.visit, e.venue]));
    expect(events.filter((e) => e.venue_id !== visitVenue.get(e.visit_id)).map((e) => `${e.event} from ${e.visit_id} counted for ${NAME[e.venue_id]}`),
      'analytics events counted for the wrong restaurant').toEqual([]);

    // Suggestion logs: a decision, its shortlist, its sighting and its sale are all one restaurant's.
    const decisions = (await db.query<{ id: string; session_venue: string; chosen_item_id: string | null; candidates: { item_id: string }[] }>(
      `SELECT d.id, s.venue_id AS session_venue, d.chosen_item_id, d.candidates FROM public.recommendation_decisions d JOIN public.table_sessions s ON s.id = d.session_id`)).rows;
    expect(decisions.length, 'suggestion decisions logged').toBe(ledger.decisions.length);
    for (const d of decisions) {
      const items = [d.chosen_item_id, ...d.candidates.map((c) => c.item_id)].filter((x): x is string => !!x);
      expect(items.filter((i) => ITEM_VENUE[i] !== d.session_venue).map(label), `a decision at ${NAME[d.session_venue]} shortlisted`).toEqual([]);
    }
    const conversions = (await db.query<{ order_id: string; recommended_item_id: string; source_item_id: string | null; o_venue: string }>(
      `SELECT sc.order_id, sc.recommended_item_id, sc.source_item_id, o.venue_id AS o_venue FROM public.suggestion_conversions sc JOIN public.orders o ON o.id = sc.order_id`)).rows;
    for (const c of conversions) {
      expect([c.recommended_item_id, c.source_item_id].filter((x): x is string => !!x).filter((i) => ITEM_VENUE[i] !== c.o_venue).map(label),
        `the suggestion sale on ${label(c.order_id)} names`).toEqual([]);
    }

    // The audit trail: each entry is the restaurant of what it is about.
    const audit = (await db.query<{ action: string; entity_id: string; venue_id: string | null; entity_venue: string | null }>(
      `SELECT a.action, a.entity_id, a.venue_id,
              COALESCE(o.venue_id, oi.venue_id, s.venue_id) AS entity_venue
         FROM public.audit_log a
         LEFT JOIN public.orders o ON a.entity_type = 'order' AND o.id = a.entity_id
         LEFT JOIN public.order_items oi ON a.entity_type = 'order_item' AND oi.id = a.entity_id
         LEFT JOIN public.table_sessions s ON a.entity_type = 'table_session' AND s.id = a.entity_id
        WHERE a.entity_type IN ('order', 'order_item', 'table_session')`)).rows;
    expect(audit.length).toBeGreaterThan(20);
    expect(audit.filter((a) => a.venue_id !== a.entity_venue).map((a) => `${a.action} on ${label(a.entity_id)} logged under ${NAME[a.venue_id ?? ''] ?? 'no restaurant'}`),
      'audit entries logged under the wrong restaurant').toEqual([]);
  });

  it('each waiter, kitchen and admin sees exactly its own rows — with the right header, the other\'s, a made-up one or none; the owner, one restaurant at a time', async () => {
    const staffTables: Array<[string, () => string[] | null]> = [
      ['orders', () => ledger.orders.map((o) => o.id)],
      ['table_sessions', () => [...ledger.sessions.keys()]],
      ['waiter_calls', () => [...ledger.calls.keys()]],
      ['bill_requests', () => [...ledger.bills.keys()]],
      ['session_join_requests', () => [...ledger.joins.keys()]],
      ['ratings', () => [...ledger.ratings.keys()]],
      ['server_ratings', () => [...ledger.serverRatings.keys()]],
      ['order_items', () => null],
      ['order_ticket_events', () => null],
      ['tables', () => TABLES.map((t) => t.id)],
      ['waiters', () => VENUES.map((v) => WAITER_ROW[v])],
      ['restaurant_settings', () => null],
      ['sections', () => null],
      ['section_assignments', () => null],
    ];
    const adminTables: Array<[string, () => string[] | null]> = [
      ['order_refunds', () => [...ledger.refunds.keys()]],
      ['printers', () => null],
      ['audit_log', () => null],
    ];
    const venueRows = async (table: string, venue: string) =>
      (await db.query<{ id: string }>(`SELECT id::text AS id FROM public.${table} WHERE venue_id = $1`, [venue])).rows.map((r) => r.id);
    const sees = async (user: string, slug: string | null, venue: string, tables: typeof staffTables) => {
      for (const [table, ledgerIds] of tables) {
        const rows = await asUser(user, slug, async () => (await db.query<{ id: string; venue_id: string | null }>(`SELECT id::text AS id, venue_id FROM public.${table}`)).rows);
        const who = `${ROLE_LABEL[user]} (x-venue: ${slug ?? 'none'}) reading ${table}`;
        allOf(who, venue, rows);
        const mine = ledgerIds()?.filter((id) => (table === 'tables' ? TABLES.find((t) => t.id === id)!.venue
          : table === 'waiters' ? (id === WAITER_ROW[L] ? L : V)
            : ledger.orders.find((o) => o.id === id)?.venue ?? ledger.sessions.get(id)?.venue ?? ledger.calls.get(id) ?? ledger.bills.get(id)
              ?? ledger.joins.get(id) ?? ledger.ratings.get(id)?.venue ?? ledger.serverRatings.get(id)?.venue ?? ledger.refunds.get(id)) === venue)
          ?? await venueRows(table, venue);
        exactly(who, rows.map((r) => r.id), mine);
      }
    };
    for (const v of VENUES) {
      for (const slug of ['lasoul', 'veraitalia', null, 'nonsense']) {
        await sees(WAITER[v], slug, v, staffTables);
        await sees(KITCHEN[v], slug, v, staffTables);
        await sees(ADMIN[v], slug, v, [...staffTables, ...adminTables]);
      }
    }
    // The owner: the restaurant the switch is on; La Soul when it is on none or on nonsense.
    // (The audit log is not kept to the switch for the owner: its own case at the end.)
    for (const [slug, v] of [['lasoul', L], ['veraitalia', V], [null, L], ['nonsense', L], [V, V]] as const) {
      await sees(OWNER, slug, v, [...staffTables, ...adminTables.filter(([t]) => t !== 'audit_log')]);
    }
    // Someone who works at neither restaurant sees nothing of either.
    for (const slug of ['lasoul', 'veraitalia', null]) {
      for (const [table] of [...staffTables, ...adminTables]) {
        if (['tables', 'sections'].includes(table)) continue;
        const rows = await asUser(NEWCOMER, slug, async () => (await db.query(`SELECT 1 FROM public.${table}`)).rows);
        expect(rows.length, `a signed-in stranger (x-venue: ${slug ?? 'none'}) read ${table}`).toBe(0);
      }
    }
  });

  // -------------------------------------------------------------------------
  // The numbers
  // -------------------------------------------------------------------------

  /** Each restaurant's numbers, from the evening's own record. */
  const expected = () => {
    const per = (v: string) => {
      const done = completedOf(v);
      const net = (o: OrderRec) => o.total - o.tip - o.refunded;
      const sum = (f: (o: OrderRec) => number, xs = done) => xs.reduce((s, o) => s + f(o), 0);
      const qty = done.flatMap((o) => o.lines).reduce((s, l) => s + l.qty, 0);
      const sessions = sessionsOf(v);
      const counted = sessions.filter((id) => ledger.sessions.get(id)!.covers !== null);
      const serverRatings = [...ledger.serverRatings.values()].filter((r) => r.venue === v);
      const events = ledger.events.filter((e) => e.venue === v);
      const visitsFor = (event?: string) => new Set(events.filter((e) => !event || e.event === event).map((e) => e.visit)).size;
      const decisions = ledger.decisions.filter((d) => d.venue === v);
      const conversions = done.flatMap((o) => o.lines.filter((l) => l.decision !== undefined).map((l) => ({ order: o.id, decision: l.decision, km: l.unit * l.qty })));
      const paidDecisions = decisions.filter((d) => conversions.some((c) => c.decision === d.id));
      return {
        sales: {
          revenue: sum((o) => o.total) / 100, net_sales: sum(net) / 100, tips: sum((o) => o.tip) / 100, refunded: sum((o) => o.refunded) / 100,
          orders: done.length, items_per_order: Math.round((qty / done.length) * 100) / 100, average_order: Math.round(sum(net) / done.length) / 100,
        },
        recon: {
          orders: done.length, gross: sum((o) => o.total) / 100, tips: sum((o) => o.tip) / 100, refunded: sum((o) => o.refunded) / 100,
          net: (sum((o) => o.total) - sum((o) => o.refunded)) / 100, paid_online: 0,
          outstanding: sum((o) => o.total, done.filter((o) => !o.paid)) / 100, outstanding_orders: done.filter((o) => !o.paid).length,
          cancelled_orders: ordersOf(v).filter((o) => o.cancelled).length, average_order: Math.round(sum((o) => o.total) / done.length) / 100,
        },
        // What should be in the drawer and on the terminal batch: money taken, less money given back the same way.
        drawer: {
          paid_cash: (sum((o) => o.total, done.filter((o) => o.paid && o.method === 'cash')) - sum((o) => o.refunded, done.filter((o) => o.refundMethod === 'cash'))) / 100,
          paid_pos_terminal: (sum((o) => o.total, done.filter((o) => o.paid && o.method === 'pos_terminal')) - sum((o) => o.refunded, done.filter((o) => o.refundMethod === 'pos_terminal'))) / 100,
        },
        covers: {
          sittings: sessions.length, counted: counted.length,
          covers: counted.reduce((s, id) => s + ledger.sessions.get(id)!.covers!, 0),
          coverage: Math.round((counted.length / sessions.length) * 1000) / 1000,
        },
        funnel: {
          visits: visitsFor(),
          ...Object.fromEntries(['menu_viewed', 'category_viewed', 'item_viewed', 'item_added', 'cart_viewed', 'checkout_opened', 'order_placed'].map((s) => [s, visitsFor(s)])),
        } as Record<string, number>,
        waiter: {
          orders: done.length, net_sales: sum(net) / 100, tips: sum((o) => o.tip) / 100, tables: sessions.length,
          ratings: serverRatings.length, avg_rating: Math.round((serverRatings.reduce((s, r) => s + r.rating, 0) / serverRatings.length) * 100) / 100,
        },
        suggestions: {
          orders: done.length, net_sales: sum(net) / 100, attributed_revenue: conversions.reduce((s, c) => s + c.km, 0) / 100,
          orders_with_suggestion: new Set(conversions.map((c) => c.order)).size,
          shown: events.filter((e) => e.event === 'suggestion_shown').length, accepted: events.filter((e) => e.event === 'suggestion_accepted').length,
          seen: decisions.filter((d) => d.seen).length, paid: decisions.filter((d) => d.seen && paidDecisions.includes(d)).length,
        },
        recoFunnel: {
          decisions: decisions.length, seen: decisions.filter((d) => d.seen || d.tapped || paidDecisions.includes(d)).length,
          tapped: decisions.filter((d) => d.tapped || paidDecisions.includes(d)).length, paid: paidDecisions.length,
          paid_km: conversions.reduce((s, c) => s + c.km, 0) / 100,
        },
        impact: {
          sessions: new Set(done.map((o) => o.session)).size, net_sales: sum(net) / 100,
          attributed_revenue: conversions.reduce((s, c) => s + c.km, 0) / 100, attributed_orders: new Set(conversions.map((c) => c.order)).size,
        },
      };
    };
    const both: Record<string, ReturnType<typeof per>> = { [L]: per(L), [V]: per(V) };
    return both;
  };
  type Expected = ReturnType<typeof expected>;
  const pick = <K extends keyof Expected[string]>(e: Expected, k: K): Record<string, Record<string, number>> =>
    ({ [L]: e[L][k] as unknown as Record<string, number>, [V]: e[V][k] as unknown as Record<string, number> });

  /** Who reads each restaurant's reports: its admin with every header, and the owner under each switch position. */
  const READERS: Array<[string, string | null, string]> = [
    [ADMIN[L], 'lasoul', L], [ADMIN[L], 'veraitalia', L], [ADMIN[L], null, L],
    [ADMIN[V], 'veraitalia', V], [ADMIN[V], 'lasoul', V], [ADMIN[V], null, V],
    [OWNER, 'lasoul', L], [OWNER, 'veraitalia', V], [OWNER, null, L], [OWNER, 'nonsense', L],
  ];
  const reader = (user: string, slug: string | null, v: string) => `${ROLE_LABEL[user]} (x-venue: ${slug ?? 'none'}) reading ${NAME[v]}'s`;

  it('every report equals the sums of its own restaurant\'s rows — for its admin and for the owner under each switch position — and never the two added', async () => {
    const e = expected();
    // The two restaurants' evenings differ, so a swapped or summed report cannot pass by accident.
    expect(e[L].sales.revenue).not.toBe(e[V].sales.revenue);
    expect(e[L].sales.orders).not.toBe(e[V].sales.orders);
    // And the record agrees with the database, row by row, restaurant by restaurant.
    for (const v of VENUES) {
      const db1 = (await db.query<{ revenue: string; n: string }>(`SELECT sum(o.total) AS revenue, count(*) AS n FROM public.orders o
         WHERE o.venue_id = $1 AND o.status <> 'cancelled' AND o.released_to_kitchen_at IS NOT NULL`, [v])).rows[0];
      expect({ revenue: Number(db1.revenue), orders: Number(db1.n) }, `${NAME[v]}'s own rows`).toEqual({ revenue: e[v].sales.revenue, orders: e[v].sales.orders });
    }

    for (const [user, slug, v] of READERS) {
      const who = reader(user, slug, v);
      await asUser(user, slug, async () => {
        const sales = await call<{ totals: Record<string, number>; top_items: { item_id: string }[]; by_category: unknown[]; table_turnover: { table_number: number; sittings: number }[] }>(`public.sales_analytics()`);
        sameNumbers(`${who} sales_analytics`, v, sales.totals, pick(e, 'sales'));
        expect(sales.top_items.filter((t) => ITEM_VENUE[t.item_id] !== v).map((t) => label(t.item_id)), `${who} top dishes`).toEqual([]);
        const seven = sales.table_turnover.find((t) => t.table_number === 7);
        expect(seven?.sittings, `${who} table 7 sittings (both restaurants have a table 7)`).toBe(1);
        expect(sales.table_turnover.map((t) => t.table_number).sort((a, b) => a - b), `${who} tables in the turnover`)
          .toEqual(TABLES.filter((t) => t.venue === v && t.key !== 'V4').map((t) => t.number).sort((a, b) => a - b));

        const recon = await call<Record<string, number>>(`public.day_reconciliation()`);
        sameNumbers(`${who} day_reconciliation`, v, recon, pick(e, 'recon'));
        // The method that had no refund tonight at this restaurant is exact either way;
        // the one that had one is checked on its own further down.
        const untouched = v === L ? 'paid_cash' : 'paid_pos_terminal';
        sameNumbers(`${who} day_reconciliation ${untouched}`, v, recon, {
          [L]: { [untouched]: e[L].drawer[untouched as 'paid_cash'] }, [V]: { [untouched]: e[V].drawer[untouched as 'paid_cash'] },
        });

        sameNumbers(`${who} covers_summary`, v, await call(`public.covers_summary()`), pick(e, 'covers'));

        const funnel = await call<{ visits: number; steps: { step: string; visits: number }[] }>(`public.funnel_summary()`);
        sameNumbers(`${who} funnel_summary`, v, { visits: funnel.visits, ...Object.fromEntries(funnel.steps.map((s) => [s.step, s.visits])) }, pick(e, 'funnel'));

        const perf = await call<{ waiters: Record<string, unknown>[]; unassigned: { orders: number }; low_ratings: { waiter_id: string; rating: number }[] }>(`public.staff_performance()`);
        expect(perf.waiters.map((w) => w.name), `${who} staff_performance waiters`).toEqual([WAITER_NAME[v]]);
        sameNumbers(`${who} staff_performance for ${WAITER_NAME[v]}`, v, perf.waiters[0], pick(e, 'waiter'));
        expect(perf.unassigned.orders).toBe(0);
        expect(perf.low_ratings.map((r) => `${label(r.waiter_id)}: ${r.rating}`), `${who} low ratings`)
          .toEqual([...ledger.serverRatings.values()].filter((r) => r.venue === v && r.rating <= 2).map((r) => `${label(r.waiter)}: ${r.rating}`));

        const impact = await call<Record<string, number>>(`public.suggestion_impact(30)`);
        sameNumbers(`${who} suggestion_impact`, v, impact, pick(e, 'suggestions'));

        const funnelRows = (await db.query<Record<string, number>>(`SELECT * FROM public.reco_funnel(28)`)).rows;
        const totals = funnelRows.reduce((acc, r) => ({
          decisions: acc.decisions + Number(r.decisions), seen: acc.seen + Number(r.seen), tapped: acc.tapped + Number(r.tapped),
          paid: acc.paid + Number(r.paid), paid_km: acc.paid_km + Number(r.paid_km),
        }), { decisions: 0, seen: 0, tapped: 0, paid: 0, paid_km: 0 });
        sameNumbers(`${who} reco_funnel`, v, totals, pick(e, 'recoFunnel'));

        const app = await call<{ sessions: number; net_sales: number; attributed: { revenue: number; orders: number }; causal: { status: string } }>(`public.app_impact_summary(30)`);
        sameNumbers(`${who} app_impact_summary`, v, { sessions: app.sessions, net_sales: app.net_sales, attributed_revenue: app.attributed.revenue, attributed_orders: app.attributed.orders }, pick(e, 'impact'));
        expect(app.causal.status, `${who} hold-out experiment`).toBe('not_running');

        const perfRows = (await db.query<{ recommended_item_id: string; source_item_id: string | null }>(`SELECT recommended_item_id, source_item_id FROM public.suggestion_performance(200)`)).rows;
        expect(perfRows.flatMap((r) => [r.recommended_item_id, r.source_item_id]).filter((i): i is string => !!i).filter((i) => ITEM_VENUE[i] !== v).map(label),
          `${who} suggestion_performance`).toEqual([]);
        const attention = (await db.query<{ id: string }>(`SELECT id FROM public.orders_needing_attention(0)`)).rows;
        expect(attention.map((r) => label(r.id)), `${who} orders needing attention`).toEqual([]);
        const load = (await db.query<{ open_items: number }>(`SELECT open_items FROM public.kitchen_load()`)).rows;
        expect(load.every((r) => r.open_items === 0), `${who} kitchen load at closing time`).toBe(true);
        const trends = (await db.query<{ item_id: string }>(`SELECT item_id FROM public.item_trends()`)).rows;
        expect(trends.filter((t) => ITEM_VENUE[t.item_id] !== v).map((t) => label(t.item_id)), `${who} item_trends`).toEqual([]);
        const insights = (await db.query<{ item_id: string | null; related_item_id: string | null }>(`SELECT item_id, related_item_id FROM public.management_insights(28, 0)`)).rows;
        expect(insights.flatMap((i) => [i.item_id, i.related_item_id]).filter((i): i is string => !!i).filter((i) => ITEM_VENUE[i] !== v).map(label),
          `${who} management_insights`).toEqual([]);
      });
    }
    // Nobody else reads them.
    for (const fn of ['sales_analytics()', 'day_reconciliation()', 'covers_summary()', 'funnel_summary()', 'staff_performance()', 'suggestion_impact(30)', 'app_impact_summary(30)']) {
      await refused(`a signed-in stranger reading ${fn}`, () => asUser(NEWCOMER, 'veraitalia', () => call(`public.${fn}`)), /Only staff/);
    }
  });

  it('what the suggestions learned tonight lands at its own restaurant', async () => {
    // Learned counters: every counter is about its own restaurant's dishes and sections, and each counted its own visits.
    const learned = (await db.query<{ venue_id: string; ctx_level: string; ctx_key: string; item_id: string | null; tables: number }>(
      `SELECT venue_id, ctx_level, ctx_key, item_id, tables FROM public.reco_learning`)).rows;
    expect(learned.length).toBeGreaterThan(0);
    const sectionVenue = new Map((await db.query<{ id: string; venue_id: string }>(`SELECT id::text, venue_id FROM public.subcategories`)).rows.map((r) => [r.id, r.venue_id]));
    const wrong = learned.filter((r) => (r.item_id && ITEM_VENUE[r.item_id] !== r.venue_id)
      || (r.ctx_level === 'item' && ITEM_VENUE[r.ctx_key] !== r.venue_id)
      || (r.ctx_level === 'section' && sectionVenue.get(r.ctx_key) !== r.venue_id))
      .map((r) => `${NAME[r.venue_id]}'s ${r.ctx_level} counter ${r.ctx_level === 'item' ? label(r.ctx_key) : r.ctx_key} → ${r.item_id ? label(r.item_id) : '*'}`);
    expect(wrong, 'learned counters about the other restaurant\'s dishes').toEqual([]);
    for (const v of VENUES) {
      const visits = learned.find((r) => r.venue_id === v && r.ctx_level === 'all' && r.item_id === null)?.tables;
      const want = new Set(ordersOf(v).filter((o) => o.released).map((o) => o.session)).size;
      expect(visits, `${NAME[v]}'s learned visit total (La Soul had ${new Set(ordersOf(L).filter((o) => o.released).map((o) => o.session)).size}, Vera Italia ${new Set(ordersOf(V).filter((o) => o.released).map((o) => o.session)).size})`).toBe(want);
    }
    const visitRows = (await db.query<{ visit_id: string; item_id: string }>(`SELECT visit_id, item_id FROM public.reco_learned_visits`)).rows;
    expect(visitRows.filter((r) => ITEM_VENUE[r.item_id] !== ledger.sessions.get(r.visit_id)?.venue).map((r) => `${label(r.item_id)} learned from ${label(r.visit_id)}`),
      'dishes learned from the other restaurant\'s visits').toEqual([]);

    // The nightly refresh, as the owner runs it from the admin.
    await asUser(OWNER, null, () => call(`public.refresh_suggestion_stats(90)`));
    await asUser(OWNER, null, () => call(`public.refresh_menu_intelligence()`));
    const stats = (await db.query<{ source_item_id: string | null; recommended_item_id: string; shown: number; accepted: number; dismissed: number }>(
      `SELECT source_item_id, recommended_item_id, shown, accepted, dismissed FROM public.suggestion_stats WHERE daypart IS NULL`)).rows;
    expect(stats.filter((s) => s.source_item_id && ITEM_VENUE[s.source_item_id] !== ITEM_VENUE[s.recommended_item_id])
      .map((s) => `${label(s.source_item_id!)} → ${label(s.recommended_item_id)}`), 'suggestion stats pairing the two restaurants').toEqual([]);
    for (const v of VENUES) {
      const mine = stats.filter((s) => ITEM_VENUE[s.recommended_item_id] === v);
      const decisions = ledger.decisions.filter((d) => d.venue === v && d.chosen && (d.seen || d.dismissed || ordersOf(v).some((o) => o.lines.some((l) => l.decision === d.id))));
      const accepted = decisions.filter((d) => completedOf(v).some((o) => o.lines.some((l) => l.decision === d.id && l.item === d.chosen)));
      expect({
        shown: mine.reduce((s, r) => s + r.shown, 0), accepted: mine.reduce((s, r) => s + r.accepted, 0), dismissed: mine.reduce((s, r) => s + r.dismissed, 0),
      }, `${NAME[v]}'s suggestion acceptance (shown / taken and paid / dismissed)`).toEqual({
        shown: decisions.length, accepted: accepted.length, dismissed: decisions.filter((d) => d.dismissed).length,
      });
    }
    const priors = (await db.query<{ venue_id: string; recommended_item_id: string | null }>(`SELECT venue_id, recommended_item_id FROM public.suggestion_priors`)).rows;
    expect(priors.filter((p) => p.recommended_item_id && ITEM_VENUE[p.recommended_item_id] !== p.venue_id).map((p) => `${NAME[p.venue_id]}'s prior for ${label(p.recommended_item_id!)}`),
      'suggestion priors filed under the other restaurant').toEqual([]);
    const pairs = (await db.query<{ a: string; b: string }>(`SELECT item_a AS a, item_b AS b FROM public.menu_item_affinity
      UNION ALL SELECT item_a, item_b FROM public.session_item_affinity`)).rows;
    expect(pairs.filter((p) => ITEM_VENUE[p.a] !== ITEM_VENUE[p.b]).map((p) => `${label(p.a)} ↔ ${label(p.b)}`), 'dish pairs across the two restaurants').toEqual([]);
    // A waiter reads their own restaurant's learned counters and priors only.
    for (const v of VENUES) {
      for (const table of ['reco_learning', 'suggestion_priors']) {
        const rows = await asUser(WAITER[v], SLUG[other(v)], async () => (await db.query<{ venue_id: string }>(`SELECT DISTINCT venue_id FROM public.${table}`)).rows);
        allOf(`${ROLE_LABEL[WAITER[v]]} (x-venue: ${SLUG[other(v)]}) reading ${table}`, v, rows);
      }
    }
  });

  it('each restaurant closes its own day, and nobody can close or read the other\'s', async () => {
    const e = expected();
    await refused('La Soul\'s admin closing Vera Italia\'s day', () => asUser(ADMIN[L], 'veraitalia', () => call(
      `public.close_shift(NULL, 0, 0, NULL, NULL, true, $1)`, [V])), /Only a manager/);
    await refused('Vera Italia\'s waiter closing Vera Italia\'s day', () => asUser(WAITER[V], 'veraitalia', () => call(
      `public.close_shift(NULL, 0, 0, NULL, NULL, true)`)), /Only a manager/);
    // Each admin counts their own drawer; the app names no restaurant, and the phone's header is the other's.
    const closeL = await asUser(ADMIN[L], 'veraitalia', () => call<Record<string, number>>(
      `public.close_shift(NULL, $1, $2, 'BATCH-L', NULL, true)`, [e[L].drawer.paid_cash, e[L].drawer.paid_pos_terminal]));
    const closeV = await asUser(ADMIN[V], null, () => call<Record<string, number>>(
      `public.close_shift(NULL, $1, $2, 'BATCH-V', NULL, true)`, [e[V].drawer.paid_cash, e[V].drawer.paid_pos_terminal]));
    // The parts of the close no refund touched tonight.
    sameNumbers('La Soul\'s close', L, closeL, { [L]: { expected_cash: e[L].drawer.paid_cash, expected_online: 0 }, [V]: { expected_cash: e[V].drawer.paid_cash, expected_online: 0 } });
    sameNumbers('Vera Italia\'s close', V, closeV, { [L]: { expected_terminal: e[L].drawer.paid_pos_terminal, expected_online: 0 }, [V]: { expected_terminal: e[V].drawer.paid_pos_terminal, expected_online: 0 } });

    const closes = (await db.query<{ id: string; venue_id: string; closed_by: string; snapshot: { orders: number; gross: number; refunded: number; cancelled_orders: number } }>(
      `SELECT id, venue_id, closed_by, snapshot FROM public.shift_closes`)).rows;
    expect(closes.map((c) => NAME[c.venue_id]).sort()).toEqual(['La Soul', 'Vera Italia']);
    for (const c of closes) {
      expect(c.closed_by, `${NAME[c.venue_id]}'s day was closed by ${ROLE_LABEL[c.closed_by]}`).toBe(ADMIN[c.venue_id]);
      sameNumbers(`${NAME[c.venue_id]}'s closing snapshot`, c.venue_id, c.snapshot, {
        [L]: { orders: e[L].recon.orders, gross: e[L].recon.gross, refunded: e[L].recon.refunded, cancelled_orders: e[L].recon.cancelled_orders },
        [V]: { orders: e[V].recon.orders, gross: e[V].recon.gross, refunded: e[V].recon.refunded, cancelled_orders: e[V].recon.cancelled_orders },
      });
    }
    // Reading it back: each its own; the owner either, by the switch or by naming it.
    for (const [user, slug, v] of [...READERS, [WAITER[L], 'veraitalia', L], [WAITER[V], null, V]] as Array<[string, string | null, string]>) {
      const row = await asUser(user, slug, () => call<{ id: string } | null>(`public.shift_close_for(NULL, NULL)`));
      expect(row?.id, `${reader(user, slug, v)} day close`).toBe(closes.find((c) => c.venue_id === v)!.id);
    }
    expect((await asUser(OWNER, 'lasoul', () => call<{ id: string }>(`public.shift_close_for(NULL, $1)`, [V]))).id).toBe(closes.find((c) => c.venue_id === V)!.id);
    for (const v of VENUES) {
      await refused(`${ROLE_LABEL[WAITER[v]]} reading ${NAME[other(v)]}'s day close`, () => asUser(WAITER[v], SLUG[other(v)], () => call(
        `public.shift_close_for(NULL, $1)`, [other(v)])), /Only staff/);
      await refused(`${ROLE_LABEL[ADMIN[v]]} reading ${NAME[other(v)]}'s day close`, () => asUser(ADMIN[v], null, () => call(
        `public.shift_close_for(NULL, $1)`, [other(v)])), /Only staff/);
    }
  });
});

// ---------------------------------------------------------------------------
// What used to cross. Each was found by this evening, asserted the way it
// should behave and marked `it.fails` until it was fixed — the admin
// separation (20261031100000) and the service fixes (20261031100500). A
// crossing found later goes here again as `it.fails`, until it is fixed.
// ---------------------------------------------------------------------------

describe('what used to cross between the two restaurants (asserted as it should be)', () => {
  it('the day\'s expected cash and terminal count a partly refunded order, less its refund (day_reconciliation drops the whole order)', async () => {
    // La Soul refunded 7 KM of Lejla's card order on the terminal; Vera Italia 5 KM of Elena's cash order in cash.
    const e = expected2();
    const problems: string[] = [];
    for (const [user, slug, v] of [[ADMIN[L], 'lasoul', L], [ADMIN[V], 'veraitalia', V]] as const) {
      const recon = await asUser(user, slug, () => call<Record<string, number>>(`public.day_reconciliation()`));
      for (const k of ['paid_cash', 'paid_pos_terminal'] as const) {
        if (cents(recon[k]) !== cents(e[v][k])) problems.push(`${NAME[v]} ${k}: report says ${recon[k]}, the drawer/batch holds ${e[v][k]}`);
      }
      const close = await asUser(user, slug, () => call<{ expected_cash: number; expected_terminal: number }>(`public.shift_close_for(NULL, NULL)`));
      if (cents(close.expected_cash) !== cents(e[v].paid_cash)) problems.push(`${NAME[v]} close expected_cash ${close.expected_cash} ≠ ${e[v].paid_cash}`);
      if (cents(close.expected_terminal) !== cents(e[v].paid_pos_terminal)) problems.push(`${NAME[v]} close expected_terminal ${close.expected_terminal} ≠ ${e[v].paid_pos_terminal}`);
    }
    expect(problems, 'expected cash/terminal at close of day').toEqual([]);
  });

  it('a waiter, kitchen or admin of one restaurant reads none of the other\'s analytics, suggestion sales or suggestion stats', async () => {
    const leaks: string[] = [];
    for (const v of VENUES) {
      for (const user of [WAITER[v], KITCHEN[v], ADMIN[v]]) {
        await asUser(user, SLUG[v], async () => {
          const events = (await db.query<{ venue_id: string; n: string }>(`SELECT venue_id, count(*) AS n FROM public.analytics_events GROUP BY 1`)).rows;
          for (const r of events) if (r.venue_id !== v) leaks.push(`${ROLE_LABEL[user]} read ${r.n} of ${NAME[r.venue_id]}'s analytics events`);
          const sales = (await db.query<{ order_id: string; line_total: string }>(`SELECT order_id, line_total FROM public.suggestion_conversions`)).rows;
          for (const s of sales) {
            const o = ledger.orders.find((x) => x.id === s.order_id);
            if (o && o.venue !== v) leaks.push(`${ROLE_LABEL[user]} read the suggestion sale on ${label(s.order_id)} (${s.line_total} KM)`);
          }
          const stats = (await db.query<{ recommended_item_id: string }>(`SELECT recommended_item_id FROM public.suggestion_stats`)).rows;
          for (const s of stats) if (ITEM_VENUE[s.recommended_item_id] !== v) leaks.push(`${ROLE_LABEL[user]} read the suggestion stats of ${label(s.recommended_item_id)}`);
        });
      }
    }
    expect(leaks, 'rows of the other restaurant readable by staff').toEqual([]);
  });

  it('a staff call with the other restaurant\'s ids is refused outright, not answered with what it holds', async () => {
    // Settled tonight at Vera Italia: a paid order, a released hold, a cancelled order, a taken call.
    const paid = orderAt('Elena');
    const held = orderAt('Marco');
    const cancelled = orderAt('Luca');
    const callId = [...ledger.calls].find(([, v]) => v === V)![0];
    // A fresh Vera Italia table that owes money.
    const guestV4 = phone('Dario', 'V4');
    await sitDown(guestV4);
    const owing = await placeOrder(guestV4, [line(DISH.margherita)], 'cash');
    const answered: string[] = [];
    const tryIt = async (what: string, user: string, fn: string, params: unknown[]) => {
      let result: unknown;
      let message: string | null = null;
      try { result = await asUser(user, 'lasoul', () => call(fn, params)); } catch (e) { message = String((e as Error).message); }
      if (message === null) answered.push(`${what}: answered ${JSON.stringify(result)}`);
      else if (!NOT_HERE.test(message) && !/Only staff/.test(message)) answered.push(`${what}: refused with "${message}"`);
    };
    await tryIt(`La Soul's waiter freeing Vera Italia table 4 (owes ${kmOf(owing.total)} KM)`, WAITER[L], `public.staff_close_session($1)`, [guestV4.session]);
    await tryIt(`La Soul's waiter recording ${label(paid.id)} as paid`, WAITER[L], `public.record_table_payment($1, 'cash', NULL)`, [paid.id]);
    await tryIt(`La Soul's admin refunding 999 KM of ${label(paid.id)}`, ADMIN[L], `public.record_order_refund($1, 999, 'cash', 'x', true, NULL)`, [paid.id]);
    await tryIt(`La Soul's admin refunding ${label(cancelled.id)}`, ADMIN[L], `public.record_order_refund($1, 1, 'cash', 'x', true, NULL)`, [cancelled.id]);
    await tryIt(`La Soul's waiter confirming ${label(held.id)} again`, WAITER[L], `public.staff_release_held_order($1)`, [held.id]);
    await tryIt(`La Soul's waiter cancelling ${label(cancelled.id)}`, WAITER[L], `public.cancel_order($1, 'x')`, [cancelled.id]);
    await tryIt(`La Soul's waiter serving ${label(paid.id)}`, WAITER[L], `public.staff_update_order_status($1, 'ready')`, [paid.id]);
    await tryIt(`La Soul's waiter taking ${label(callId)}`, WAITER[L], `public.staff_ack_waiter_call($1)`, [callId]);
    await tryIt(`La Soul's waiter marking Vera Italia table 7 as seen`, WAITER[L], `public.staff_mark_session_seen($1)`, [marco.session]);
    expect(answered, 'staff calls on the other restaurant\'s ids that were answered instead of refused').toEqual([]);
  });

  it('Vera Italia\'s guests are never put into La Soul\'s suggestion hold-out experiment', async () => {
    // La Soul's admin starts a hold-out at La Soul. Vera Italia runs none.
    await asUser(ADMIN[L], 'lasoul', () => call(`public.start_experiment('La Soul autumn hold-out', 'v-autumn', $1::smallint)`, [50]));
    try {
      const guests = ['Ana', 'Ivo', 'Mia', 'Leo'].map((n) => phone(n, 'V4'));
      const crossed: string[] = [];
      for (const g of guests) {
        await db.exec(`UPDATE public.table_sessions SET is_active = false WHERE table_id = '${T.V4.id}'`);
        await sitDown(g);
        const a = (await db.query<{ arm: string; venue_id: string; name: string }>(
          `SELECT a.arm, e.venue_id, e.name FROM public.session_experiment_assignment a JOIN public.experiments e ON e.id = a.experiment_id
            WHERE a.session_id = $1`, [g.session])).rows[0];
        if (a && a.venue_id !== V) crossed.push(`${label(g.session!)} was put in ${NAME[a.venue_id]}'s "${a.name}" (${a.arm})`);
      }
      expect(crossed, 'Vera Italia tables assigned to La Soul\'s experiment').toEqual([]);
    } finally {
      await asUser(ADMIN[L], 'lasoul', () => call(`public.stop_experiment('evening over')`));
    }
  });

  it('a Vera Italia order cannot credit La Soul\'s suggestions: from_suggestion must be this table\'s own decision and dishes', async () => {
    const before = await asUser(ADMIN[L], 'lasoul', async () => (await db.query<{ paid: string; paid_km: string }>(
      `SELECT sum(paid) AS paid, sum(paid_km) AS paid_km FROM public.reco_funnel(28)`)).rows[0]);
    const g = phone('Zoe', 'V4');
    await db.exec(`UPDATE public.table_sessions SET is_active = false WHERE table_id = '${T.V4.id}'`);
    await sitDown(g);
    // Her phone sends La Soul table 7's decision and La Soul's burger as the source, with a Vera Italia dish.
    const o = await placeOrder(g, [line(DISH.margherita, 1, { decision: decisionL7.decision_id, source: DISH.burger })], 'cash');
    const after = await asUser(ADMIN[L], 'lasoul', async () => (await db.query<{ paid: string; paid_km: string }>(
      `SELECT sum(paid) AS paid, sum(paid_km) AS paid_km FROM public.reco_funnel(28)`)).rows[0]);
    const rows = (await db.query<{ decision_id: string | null; source_item_id: string | null }>(
      `SELECT decision_id, source_item_id FROM public.suggestion_conversions WHERE order_id = $1`, [o.id])).rows;
    const crossed = rows.flatMap((r) => [
      ...(r.decision_id === decisionL7.decision_id ? [`${label(o.id)} credited La Soul table 7's suggestion decision`] : []),
      ...(r.source_item_id && ITEM_VENUE[r.source_item_id] !== V ? [`${label(o.id)} credited ${label(r.source_item_id)} as the dish it went with`] : []),
    ]);
    if (Number(after.paid_km) !== Number(before.paid_km)) crossed.push(`La Soul's suggestion funnel paid_km moved ${before.paid_km} → ${after.paid_km} KM on a Vera Italia sale`);
    expect(crossed, 'Vera Italia money attributed to La Soul\'s suggestions').toEqual([]);
  });

  it('the owner acting with the switch on the other restaurant still files the audit trail under the order\'s own restaurant', async () => {
    // The owner's admin still shows Vera Italia's order; another tab has since switched to La Soul.
    const g = phone('Rea', 'V4');
    await db.exec(`UPDATE public.table_sessions SET is_active = false WHERE table_id = '${T.V4.id}'`);
    await sitDown(g);
    const o = await placeOrder(g, [line(DISH.caprese)], 'cash');
    await asUser(OWNER, 'lasoul', () => call(`public.record_table_payment($1, 'cash', NULL)`, [o.id]));
    await asUser(OWNER, 'lasoul', () => call(`public.record_order_refund($1, 1, 'cash', 'chipped plate', true, NULL)`, [o.id]));
    const audit = (await db.query<{ action: string; venue_id: string }>(
      `SELECT action, venue_id FROM public.audit_log WHERE entity_id = $1 AND action IN ('payment.recorded_cash', 'refund.completed')`, [o.id])).rows;
    expect(audit.length).toBe(2);
    const visible = await asUser(ADMIN[V], 'veraitalia', async () => (await db.query<{ action: string }>(
      `SELECT action FROM public.audit_log WHERE entity_id = $1`, [o.id])).rows.map((r) => r.action));
    expect({
      filedUnder: audit.filter((a) => a.venue_id !== V).map((a) => `${a.action} on ${label(o.id)} filed under ${NAME[a.venue_id]}`),
      veraAdminSees: visible.filter((a) => ['payment.recorded_cash', 'refund.completed'].includes(a)).sort(),
    }, 'a Vera Italia payment and refund in the audit trail').toEqual({ filedUnder: [], veraAdminSees: ['payment.recorded_cash', 'refund.completed'] });
  });

  it('a Vera Italia guest whose phone sends no header is judged by Vera Italia\'s idle timeout on resume, not La Soul\'s', async () => {
    // Vera Italia keeps an idle table 240 minutes, La Soul 90. Ninety-five minutes after the last heartbeat:
    const g = phone('Teo', 'V4');
    await db.exec(`UPDATE public.table_sessions SET is_active = false WHERE table_id = '${T.V4.id}'`);
    await sitDown(g);
    await db.query(`UPDATE public.table_sessions SET last_heartbeat_at = now() - interval '95 minutes' WHERE id = $1`, [g.session]);
    const answers: Record<string, string> = {};
    for (const slug of ['veraitalia', null, 'lasoul']) {
      answers[slug ?? 'none'] = (await asGuest(slug, () => call<{ status: string }>(`public.guest_resume_session($1, $2)`, [g.session, g.token]))).status;
    }
    expect(answers, 'resuming a Vera Italia table idle for 95 minutes').toEqual({ veraitalia: 'active', none: 'active', lasoul: 'active' });
  });

  it('a signed-in Vera Italia waiter opening La Soul\'s menu sees La Soul\'s menu, and the visit counts for La Soul', async () => {
    const shown = await asUser(WAITER[V], 'lasoul', async () => ({
      menu: (await db.query<{ venue_id: string }>(`SELECT DISTINCT venue_id FROM public.menu_items`)).rows.map((r) => NAME[r.venue_id]),
      searchFor: [...new Set((await db.query<{ id: string }>(`SELECT id FROM public.guest_search_menu('truffle')`)).rows.map((r) => NAME[ITEM_VENUE[r.id]]))],
    }));
    await asUser(WAITER[V], 'lasoul', () => call(`public.record_analytics_events('visit-vera-waiter-phone', $1::jsonb)`,
      [JSON.stringify([{ event: 'menu_viewed', props: {}, at: new Date().toISOString() }])]));
    const counted = (await db.query<{ venue_id: string }>(`SELECT venue_id FROM public.analytics_events WHERE visit_id = 'visit-vera-waiter-phone'`)).rows.map((r) => NAME[r.venue_id]);
    expect({ ...shown, counted }, 'La Soul\'s menu page (x-venue: lasoul) on a signed-in Vera Italia waiter\'s phone')
      .toEqual({ menu: ['La Soul'], searchFor: ['La Soul'], counted: ['La Soul'] });
  });

  it('the owner\'s audit page, switched to one restaurant, lists only that restaurant\'s entries', async () => {
    const crossed: string[] = [];
    for (const [slug, v] of [['lasoul', L], ['veraitalia', V]] as const) {
      const rows = await asUser(OWNER, slug, async () => (await db.query<{ venue_id: string; action: string }>(`SELECT venue_id, action FROM public.audit_log`)).rows);
      const foreign = rows.filter((r) => r.venue_id !== v);
      if (foreign.length) crossed.push(`switched to ${NAME[v]}, the owner's audit page lists ${foreign.length} of ${NAME[other(v)]}'s entries (e.g. ${foreign[0].action})`);
    }
    expect(crossed, 'the owner\'s audit page (AdminAudit reads audit_log with no restaurant filter)').toEqual([]);
  });

  it('a guest cannot read the other restaurant\'s order by its id alone (guest_order_eta takes the table\'s token)', async () => {
    const order = orderAt('Sofia').id;
    // The one-argument call that answered any phone is gone.
    expect(await errorOf(() => asGuest('lasoul', () => call(`public.guest_order_eta($1)`, [order]))),
      'guest_order_eta(order id) still answers').toMatch(/does not exist/);
    // A La Soul table's token reads nothing of a Vera Italia order...
    const eta = await asGuest('lasoul', () => call<Record<string, unknown> | null>(`public.guest_order_eta($1, $2)`, [order, amina.token]));
    expect(eta, `a La Soul phone read the kitchen ETA of ${label(order)}`).toBeNull();
    // ...and the phone at its own table still gets its estimate.
    const own = await asGuest('veraitalia', () => call<Record<string, unknown> | null>(`public.guest_order_eta($1, $2)`, [order, sofia.token]));
    expect(own, `${label(order)}'s own table got no estimate`).not.toBeNull();
  });
});

/** The drawer and terminal batch each restaurant should expect, from the evening's record. */
function expected2() {
  const per = (v: string) => {
    const done = completedOf(v);
    const take = (m: string) => done.filter((o) => o.paid && o.method === m).reduce((s, o) => s + o.total, 0)
      - done.filter((o) => o.refundMethod === m).reduce((s, o) => s + o.refunded, 0);
    return { paid_cash: take('cash') / 100, paid_pos_terminal: take('pos_terminal') / 100 };
  };
  const both: Record<string, ReturnType<typeof per>> = { [L]: per(L), [V]: per(V) };
  return both;
}
