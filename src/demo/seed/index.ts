/**
 * Seeds the demo database (demo mode only), and keeps it current.
 *
 *  1. the restaurant (seed/restaurant.ts);
 *  2. ten weeks of trading up to a moment ago (seed/history.ts), the bookings
 *     and the back-office trail that go with them;
 *  3. the figures the app keeps precomputed (pairings, prep times, guest
 *     profiles) — by calling the database's own refresh functions;
 *  4. the floor as it is right now (seed/live.ts).
 *
 * The demo is meant to be opened again days later and still look like a
 * restaurant mid-service. `keepAlive` does that: the tables that were sitting
 * when it was last open have long gone, so they are settled, the hours in
 * between are filled with the visits that would have happened, and the floor
 * is seated afresh.
 */
import { DemoBackend } from '../backend/router';
import type { SqlDb } from '../backend/types';
import { ACCOUNTS, RESTAURANT } from '../brand';
import { HISTORY_TABLES, emptyHistory, generateBrowsers, generateDay, type DayOptions, type HistoryRows } from './history';
import { seedLiveFloor } from './live';
import { ITEM } from './menu';
import { MANAGER, WAITERS, seedRestaurant } from './restaurant';
import { Random, addDays, asRestore, atLocal, businessDay, insertRows, iso, minutes, plus } from './util';

const VENUE = RESTAURANT.dbId;

/** How far back the trading history goes. The prep forecast compares ten weeks of the same weekday. */
export const HISTORY_DAYS = 70;
/** Phone events and suggestion records are kept for the recent weeks only. */
const DETAIL_DAYS = 30;
/** History is written up to this long ago; what is newer is the live floor (seed/live.ts). */
const SETTLE_MINUTES = 4;
/** The finished experiment that measured what suggestions earn (Admin → What the app earned). */
const EXPERIMENT_ID = 'e4be0000-0000-4000-8000-000000000001';
const EXPERIMENT_DAYS = 28;
const EXPERIMENT_HOLDOUT_PCT = 25;

/** Reopened after longer than this, the floor is brought up to date. */
const STALE_AFTER_MINUTES = 25;

interface Meta {
  /** When the database was first seeded. */
  at: string;
  /** When the suggestions experiment ran. */
  experiment: { from: string; until: string };
  /** The first business day of the history. */
  historyStart: string;
  /** History is complete up to here. */
  historyUntil: string;
  /** The last moment the demo was open. */
  aliveAt: string;
}

async function readMeta(db: SqlDb): Promise<Meta | null> {
  const { rows } = await db.query<{ value: Meta | string }>(`SELECT value FROM demo.meta WHERE key = 'seeded'`);
  const value = rows[0]?.value;
  return value ? (typeof value === 'string' ? JSON.parse(value) as Meta : value) : null;
}

async function writeMeta(db: SqlDb, meta: Meta): Promise<void> {
  await db.query(
    `INSERT INTO demo.meta(key, value) VALUES ('seeded', $1::text::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [JSON.stringify(meta)],
  );
}

/** The demo is open: remembered so a later start knows how long it was closed for. */
export async function markAlive(db: SqlDb, now: Date): Promise<void> {
  await db.query(
    `UPDATE demo.meta SET value = jsonb_set(value, '{aliveAt}', to_jsonb($1::text)) WHERE key = 'seeded'`,
    [now.toISOString()],
  );
}

function dayOptions(meta: Pick<Meta, 'historyStart' | 'experiment'>, day: string, now: Date, until: Date, from?: Date): DayOptions {
  const today = businessDay(now);
  const age = Math.round((Date.parse(today) - Date.parse(day)) / 86_400_000);
  return {
    from, until, today,
    historyStart: meta.historyStart, historyDays: HISTORY_DAYS,
    detail: age <= DETAIL_DAYS, tickets: age <= 1, policyVersion: 'demo',
    soldOut: { item: ITEM.raspberryMojito, since: atLocal(addDays(today, -1), 16) },
    sales: [
      { item: ITEM.arrabbiata, price: 10, since: atLocal(addDays(today, -5), 8) },
      { item: ITEM.lemonMint, price: 5.5, since: atLocal(addDays(today, -2), 8) },
    ],
    slowDay: addDays(today, -9),
    experiment: { id: EXPERIMENT_ID, from: new Date(meta.experiment.from), until: new Date(meta.experiment.until), holdoutPct: EXPERIMENT_HOLDOUT_PCT },
  };
}

/** Writes the finished visits between two moments. */
async function writeHistory(db: SqlDb, meta: Pick<Meta, 'historyStart' | 'experiment'>, from: Date | undefined, until: Date, now: Date, policyVersion: string): Promise<void> {
  const firstDay = from ? businessDay(from) : meta.historyStart;
  const lastDay = businessDay(until);
  const all: HistoryRows = emptyHistory();
  for (let day = firstDay; day <= lastDay; day = addDays(day, 1)) {
    const options = { ...dayOptions(meta, day, now, until, from), policyVersion };
    const { rows } = generateDay(day, options);
    for (const key of HISTORY_TABLES) all[key].push(...rows[key]);
    if (options.detail) {
      all.analytics_events.push(...generateBrowsers(day, until).filter((e) => !from || String(e.occurred_at) >= from.toISOString()));
    }
  }
  await asRestore(db, async () => {
    for (const key of HISTORY_TABLES) await insertRows(db, key, all[key]);
  });
}

/** Bookings: tonight's, the coming days', and the ones already answered. */
async function seedReservations(db: SqlDb, now: Date): Promise<void> {
  const today = businessDay(now);
  const rng = new Random(`casa-demo:reservations:${today}`);
  const make = (
    dayOffset: number, hour: number, minute: number, name: string, party: number, status: string,
    extra: { note?: string; reply?: string; locale?: string; cancelledBy?: string } = {},
  ) => {
    const reservedFor = atLocal(addDays(today, dayOffset), hour, minute);
    const createdAt = plus(reservedFor, -minutes(rng.int(60 * 20, 60 * 96)));
    const asked = createdAt < now ? createdAt : plus(now, -minutes(rng.int(20, 300)));
    return {
      venue_id: VENUE, code: `R${rng.int(10000, 99999)}`, token: rng.token(64), guest_name: name,
      guest_phone: `+3876${rng.int(1, 6)}${rng.int(100000, 999999)}`, party_size: party, reserved_for: iso(reservedFor),
      note: extra.note ?? null, locale: extra.locale ?? 'bs', status, reply: extra.reply ?? null,
      decided_at: status === 'pending' ? null : iso(plus(asked, minutes(rng.int(4, 40)))), decided_by: status === 'pending' ? null : MANAGER.id,
      cancelled_by: extra.cancelledBy ?? null, created_at: iso(asked), updated_at: iso(asked),
    };
  };
  await insertRows(db, 'reservations', [
    make(0, 19, 0, 'Maja Kovačević', 4, 'confirmed', { note: 'Window table if possible', reply: 'Vidimo se večeras!' }),
    make(0, 19, 30, 'Thomas Weber', 2, 'confirmed', { locale: 'en', note: 'Anniversary' }),
    make(0, 20, 0, 'Porodica Hodžić', 7, 'confirmed', { note: 'Dvoje djece, trebamo dječiju stolicu' }),
    make(0, 20, 30, 'Sara Begović', 3, 'pending'),
    make(0, 21, 0, 'Layla Al-Sayed', 5, 'pending', { locale: 'ar', note: 'طاولة هادئة من فضلكم' }),
    make(1, 13, 0, 'Ivan Marić', 2, 'pending', { note: 'Poslovni ručak' }),
    make(1, 19, 30, 'Elma Šehić', 10, 'confirmed', { note: 'Rođendan — torta u 21:00', reply: 'Rezervisali smo baštu za vas.' }),
    make(1, 20, 0, 'Giulia Rossi', 2, 'confirmed', { locale: 'en' }),
    make(2, 20, 0, 'Kenan Mujić', 6, 'pending'),
    make(3, 12, 30, 'Ana Petrović', 4, 'confirmed'),
    make(4, 19, 0, 'Omar Haddad', 8, 'pending', { locale: 'en', note: 'Vegetarian options needed' }),
    make(0, 13, 0, 'Dino Hasanović', 4, 'confirmed'),
    make(-1, 20, 0, 'Lejla Imamović', 2, 'confirmed'),
    make(-1, 19, 0, 'Marko Jurić', 12, 'declined', { reply: 'Nažalost nemamo sto za 12 u to vrijeme. Možemo u 21:30?' }),
    make(-2, 20, 30, 'Nina Babić', 3, 'cancelled', { cancelledBy: 'guest' }),
    make(-2, 13, 30, 'Stefan Ilić', 5, 'confirmed'),
    make(-3, 19, 30, 'Amina Čengić', 4, 'confirmed'),
  ]);
}

/** What the back office did lately (Admin → Audit), and the day-end closes (Admin → Reports). */
async function seedBackOffice(db: SqlDb, now: Date): Promise<void> {
  const today = businessDay(now);
  const rng = new Random(`casa-demo:office:${today}`);
  const owner = { id: ACCOUNTS.admin.id, label: 'Lejla Hadžić' };
  const manager = { id: MANAGER.id, label: MANAGER.name };
  const entries: Record<string, unknown>[] = [];
  const log = (daysAgo: number, hour: number, who: { id: string; label: string }, action: string, entityType: string, before: unknown, after: unknown, reason: string | null) => {
    const at = atLocal(addDays(today, -daysAgo), hour, rng.int(0, 59));
    if (at > now) return;
    entries.push({
      actor_user_id: who.id, actor_label: who.label, action, entity_type: entityType, entity_id: rng.uuid(),
      before_state: before, after_state: after, reason, venue_id: VENUE, created_at: iso(at),
    });
  };
  for (let d = 0; d < 14; d += 1) {
    const waiter = WAITERS[d % WAITERS.length];
    log(d, 23, manager, 'shift.closed', 'shift', null, { day: addDays(today, -d - 1), counted_cash: rng.int(900, 1700) }, null);
    log(d, 14, { id: waiter.userId, label: waiter.name }, 'order.cancelled', 'order', { status: 'pending' }, { status: 'cancelled' }, 'Guest changed their mind');
    if (d % 2 === 0) log(d, 20, { id: waiter.userId, label: waiter.name }, 'table.freed', 'table_session', { is_active: true }, { is_active: false }, 'Guests left');
    if (d % 3 === 0) log(d, 19, { id: waiter.userId, label: waiter.name }, 'order.hold_released', 'order', { held_reason: 'large_first_order' }, { held_reason: null }, null);
    if (d % 4 === 0) log(d, 12, manager, 'ticket.reprint_requested', 'order', null, { ticket_type: 'kitchen' }, 'Printer was out of paper');
    if (d % 5 === 0) log(d, 21, { id: waiter.userId, label: waiter.name }, 'order.status_reverted', 'order', { status: 'served' }, { status: 'ready' }, 'Marked served by mistake');
  }
  log(6, 10, owner, 'qr.table_rotated', 'table', null, { table_number: 9 }, 'Old sticker was photographed');
  log(21, 9, owner, 'qr.venue_rotated', 'restaurant_settings', null, null, 'New door sign printed');
  await asRestore(db, () => insertRows(db, 'audit_log', entries));

  // The dish that ran out yesterday afternoon and has not come back.
  const since = atLocal(addDays(today, -1), 16);
  if (since < now) {
    await asRestore(db, async () => {
      await db.query(`UPDATE public.menu_items SET is_available = false WHERE id = $1::text::uuid`, [ITEM.raspberryMojito]);
      await insertRows(db, 'menu_item_availability_log', [
        { menu_item_id: ITEM.raspberryMojito, is_available: false, changed_at: iso(since), changed_by: MANAGER.id, venue_id: VENUE },
      ]);
    });
  }
}

/** The figures the app keeps precomputed, recomputed by the database's own jobs. */
async function refreshDerived(db: SqlDb): Promise<void> {
  // These are the jobs pg_cron runs in production; they accept the scheduler only.
  await db.exec(`SELECT set_config('lasoul.scheduled_job', 'on', false)`);
  try {
    for (const venue of [VENUE]) {
      await db.query(`SELECT set_config('lasoul.venue', $1::text, false)`, [venue]);
      for (const job of ['refresh_menu_intelligence()', 'refresh_guest_profiles()']) {
        try {
          await db.exec(`SELECT public.${job}`);
        } catch (error) {
          console.warn(`[demo] ${job} failed:`, error instanceof Error ? error.message : error);
        }
      }
    }
  } finally {
    await db.exec(`SELECT set_config('lasoul.scheduled_job', '', false), set_config('lasoul.venue', '', false)`);
  }
  // How long each dish really takes (the kitchen's ETA): a staff job, run as the owner.
  const owner = { role: 'authenticated' as const, sub: ACCOUNTS.admin.id, email: ACCOUNTS.admin.email };
  const prep = await new DemoBackend(db).rpc('refresh_prep_stats', { _days: 60 }, owner, { 'x-venue': RESTAURANT.slug });
  if (prep.error) console.warn('[demo] refresh_prep_stats failed:', prep.error.message);
}

/** Today's order numbers continue after the ones history used. */
async function continueOrderCodes(db: SqlDb): Promise<void> {
  await db.query(
    `INSERT INTO public.order_code_counters(venue_id, day, last_value)
     SELECT $1::text::uuid, CURRENT_DATE, COALESCE(max(order_code::int), 0)
       FROM public.orders WHERE venue_id = $1::text::uuid AND order_code ~ '^[0-9]+$' AND public.business_day(created_at) = public.business_day()
     ON CONFLICT (venue_id, day) DO UPDATE SET last_value = GREATEST(public.order_code_counters.last_value, EXCLUDED.last_value)`,
    [VENUE],
  );
}

async function policyVersion(db: SqlDb): Promise<string> {
  try {
    const { rows } = await db.query<{ v: string }>(`SELECT public.reco_policy_version() AS v`);
    return rows[0]?.v ?? 'demo';
  } catch {
    return 'demo';
  }
}

export async function seedDemo(db: SqlDb, now: Date): Promise<void> {
  const today = businessDay(now);
  const meta: Meta = {
    at: now.toISOString(), historyStart: addDays(today, -HISTORY_DAYS), historyUntil: now.toISOString(), aliveAt: now.toISOString(),
    // It ended this morning, so every guest of the demo is shown suggestions.
    experiment: { from: atLocal(addDays(today, -EXPERIMENT_DAYS), 8).toISOString(), until: plus(now, -minutes(120)).toISOString() },
  };
  const version = await policyVersion(db);
  await asRestore(db, () => seedRestaurant(db, now));
  await asRestore(db, () => insertRows(db, 'experiments', [{
    id: EXPERIMENT_ID, name: 'Suggestions on vs. off', policy_version: version, holdout_pct: EXPERIMENT_HOLDOUT_PCT,
    started_at: meta.experiment.from, ended_at: meta.experiment.until, venue_id: VENUE, created_at: meta.experiment.from,
    notes: 'One table in four was shown no suggestions for four weeks.',
  }]));
  await writeHistory(db, meta, undefined, plus(now, -minutes(SETTLE_MINUTES)), now, version);
  await seedReservations(db, now);
  await seedBackOffice(db, now);
  await continueOrderCodes(db);
  await refreshDerived(db);
  await seedLiveFloor(new DemoBackend(db), now);
  await writeMeta(db, { ...meta, historyUntil: plus(now, -minutes(SETTLE_MINUTES)).toISOString() });
  // Fresh statistics: without them the analytics queries plan as if the tables were empty.
  await db.exec('ANALYZE');
}

/**
 * Tables left sitting when the demo was last open have gone home: their
 * orders were served and paid, their calls answered. Done as a restore, so
 * the order rules (which would refuse a jump from "pending" to "served") do
 * not apply to a past that is being filled in.
 */
async function settleFloor(db: SqlDb, leftAt: Date): Promise<void> {
  const at = leftAt.toISOString();
  await asRestore(db, async () => {
    await db.query(
      `UPDATE public.orders o SET
         status = CASE WHEN o.status IN ('awaiting_payment', 'payment_failed') OR o.released_to_kitchen_at IS NULL THEN 'cancelled'::order_status ELSE 'served'::order_status END,
         cancelled_at = CASE WHEN o.status IN ('awaiting_payment', 'payment_failed') OR o.released_to_kitchen_at IS NULL THEN $1::text::timestamptz ELSE o.cancelled_at END,
         cancel_reason = CASE WHEN o.status IN ('awaiting_payment', 'payment_failed') OR o.released_to_kitchen_at IS NULL THEN 'Table closed' ELSE o.cancel_reason END,
         held_reason = NULL,
         confirmed_at = COALESCE(o.confirmed_at, o.created_at + interval '1 minute'),
         preparing_at = COALESCE(o.preparing_at, o.created_at + interval '2 minutes'),
         ready_at = COALESCE(o.ready_at, o.created_at + interval '14 minutes'),
         served_at = COALESCE(o.served_at, o.created_at + interval '17 minutes'),
         payment_status = CASE WHEN o.status IN ('awaiting_payment', 'payment_failed') OR o.released_to_kitchen_at IS NULL THEN o.payment_status
                               WHEN o.payment_status IN ('unpaid', 'pending') THEN 'paid' ELSE o.payment_status END,
         payment_method = COALESCE(o.payment_method, 'cash'),
         paid_at = COALESCE(o.paid_at, GREATEST(o.created_at + interval '40 minutes', $1::text::timestamptz)),
         updated_at = $1::text::timestamptz
       FROM public.table_sessions s
       WHERE s.id = o.table_session_id AND s.is_active AND o.status <> 'cancelled'
         AND (o.status <> 'served' OR o.payment_status IN ('unpaid', 'pending'))`,
      [at],
    );
    await db.query(
      `UPDATE public.order_items i SET status = 'served',
              started_at = COALESCE(i.started_at, o.preparing_at), ready_at = COALESCE(i.ready_at, o.ready_at), served_at = COALESCE(i.served_at, o.served_at)
         FROM public.orders o JOIN public.table_sessions s ON s.id = o.table_session_id
        WHERE o.id = i.order_id AND s.is_active AND o.status = 'served' AND i.status <> 'served'`);
    await db.query(`UPDATE public.order_ticket_events e SET status = 'printed', printed_at = COALESCE(e.printed_at, e.created_at + interval '10 seconds')
                     WHERE e.status IN ('queued', 'claimed', 'failed')`);
    await db.query(`UPDATE public.waiter_calls SET status = 'resolved', resolved_at = created_at + interval '3 minutes' WHERE status <> 'resolved'`);
    await db.query(`UPDATE public.bill_requests SET status = 'resolved', resolved_at = created_at + interval '4 minutes' WHERE status IN ('pending', 'acknowledged')`);
    await db.query(`UPDATE public.session_join_requests SET status = 'declined', resolved_at = created_at + interval '2 minutes' WHERE status = 'pending'`);
    await db.query(
      `UPDATE public.table_sessions SET is_active = false, closed_at = GREATEST(opened_at + interval '45 minutes', $1::text::timestamptz), last_heartbeat_at = $1::text::timestamptz
        WHERE is_active`,
      [at],
    );
    await db.query(`UPDATE public.tables SET status = 'available' WHERE status <> 'available'`);
  });
}

/** Brings a database that has been closed for a while up to the present. */
export async function keepAlive(db: SqlDb, now: Date): Promise<void> {
  const meta = await readMeta(db);
  if (!meta) return;
  const aliveAt = new Date(meta.aliveAt);
  if (now.getTime() - aliveAt.getTime() < minutes(STALE_AFTER_MINUTES)) {
    await markAlive(db, now);
    return;
  }
  await settleFloor(db, aliveAt);
  const until = plus(now, -minutes(SETTLE_MINUTES));
  const from = new Date(meta.historyUntil);
  // A gap longer than the history itself is not filled day by day; the oldest part is simply left empty.
  const start = now.getTime() - from.getTime() > HISTORY_DAYS * 86_400_000 ? plus(now, -HISTORY_DAYS * 86_400_000) : from;
  if (until > start) await writeHistory(db, meta, start, until, now, await policyVersion(db));
  // The floor plan, the printers and the bookings are today's again.
  const today = businessDay(now);
  await db.query(
    `INSERT INTO public.section_assignments(section_id, waiter_id, shift_date, venue_id)
     SELECT w.section, w.id, $2::text::date, $1::text::uuid
       FROM jsonb_to_recordset($3::text::jsonb) AS w(id uuid, section uuid)
     ON CONFLICT DO NOTHING`,
    [VENUE, today, JSON.stringify(WAITERS.map((w) => ({ id: w.id, section: w.section })))],
  );
  await db.query(`UPDATE public.printers SET last_seen_at = $1::text::timestamptz, last_status = 'online' WHERE venue_id = $2::text::uuid`, [now.toISOString(), VENUE]);
  await continueOrderCodes(db);
  await refreshDerived(db);
  await seedLiveFloor(new DemoBackend(db), now);
  await writeMeta(db, { ...meta, historyUntil: until > start ? until.toISOString() : meta.historyUntil, aliveAt: now.toISOString() });
  await db.exec('ANALYZE');
}
