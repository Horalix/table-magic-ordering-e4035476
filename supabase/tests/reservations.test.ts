/**
 * @vitest-environment node
 *
 * Table reservations (20261113090000_reservations.sql): a guest asks, the
 * restaurant's admin answers, the guest reads the answer on their own page.
 *
 * What must hold: nothing is taken while reservations are off or outside the
 * restaurant's rules; a guest reaches only their own request, with its token;
 * only an admin of the request's own restaurant answers it or reads the
 * guest's name and phone; each new request queues exactly one call to
 * notify-staff and is reminded at most once; and a robot or a flood of
 * requests does not fill the list.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
// @ts-expect-error -- plain JS harness, no types needed
import { createTestDatabase, actAs } from '../../scripts/db-harness.mjs';

type Db = {
  query: <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<{ rows: T[]; affectedRows?: number }>;
  exec: (sql: string) => Promise<unknown>;
  close: () => Promise<void>;
};

const L = 'a5000000-0000-4000-8000-000000000001'; // La Soul
const V = 'a5000000-0000-4000-8000-000000000002'; // Vera Italia

const OWNER = '10000000-0000-0000-0000-0000000000f1'; // both restaurants
const ADMIN_L = '10000000-0000-0000-0000-0000000000c1'; // La Soul's admin
const ADMIN_V = '10000000-0000-0000-0000-0000000000c2'; // Vera Italia's admin
const AMAR = '10000000-0000-0000-0000-0000000000a1'; // a La Soul waiter

const PHONE = 'https://fcm.googleapis.com/fcm/send/admin-phone';
const KEYS = { p256dh: 'B'.repeat(87), auth: 'a'.repeat(22) };

let db: Db;

beforeAll(async () => {
  db = (await createTestDatabase({ quiet: true })) as unknown as Db;
  await db.exec(`
    GRANT USAGE ON SCHEMA public TO anon, authenticated;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
    GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon;
    -- What the migration states for its own tables wins over the blanket grants above.
    REVOKE ALL ON public.reservations FROM anon, authenticated;
    GRANT SELECT ON public.reservations TO authenticated;
    REVOKE ALL ON public.reservation_alert_phones FROM anon, authenticated;
    GRANT SELECT, DELETE ON public.reservation_alert_phones TO authenticated;
    REVOKE ALL ON public.staff_push_sent FROM authenticated, anon;
  `);
}, 180_000);
afterAll(async () => { await db?.close(); });

beforeEach(async () => {
  await db.exec(`
    DROP SCHEMA IF EXISTS net CASCADE;
    TRUNCATE public.reservations, public.reservation_alert_phones, public.staff_push_sent, public.waiters RESTART IDENTITY CASCADE;
    DELETE FROM public.audit_log WHERE entity_type = 'reservation';
    DELETE FROM public.user_roles;
    DELETE FROM auth.users;
    INSERT INTO auth.users(id) VALUES ('${OWNER}'), ('${ADMIN_L}'), ('${ADMIN_V}'), ('${AMAR}');
    INSERT INTO public.user_roles(user_id, role, venue_id) VALUES
      ('${OWNER}', 'admin', NULL), ('${ADMIN_L}', 'admin', '${L}'), ('${ADMIN_V}', 'admin', '${V}'),
      ('${AMAR}', 'staff', '${L}');
    INSERT INTO public.waiters(user_id, display_name, venue_id, is_active) VALUES ('${AMAR}', 'Amar', '${L}', true);
    -- Open all day, so a test at any hour asks about what it means to ask about.
    UPDATE public.restaurant_settings
       SET reservations_enabled = (venue_id = '${L}'), reservations_open = '00:00', reservations_close = '23:45',
           reservations_max_party = 10, reservations_days_ahead = 30, reservations_lead_minutes = 60,
           reservations_phone = CASE WHEN venue_id = '${L}' THEN ' +387 33 877 779 ' END, reservations_note = NULL;
  `);
  await actAs(db, null);
});

/** Run as a signed-in user (or a guest, with null), under the access rules. */
async function as<T>(user: string | null, run: () => Promise<T>): Promise<T> {
  await actAs(db, user);
  await db.exec(user ? 'SET ROLE authenticated' : 'SET ROLE anon');
  try {
    return await run();
  } finally {
    await db.exec('RESET ROLE');
    await actAs(db, null);
  }
}

interface Asked { id: string; token: string; code: string; status: string }
interface Mine {
  status: string; day: string; time: string; name: string; party_size: number; phone: string | null;
  reply: string | null; cancelled_by: string | null; code: string; venue: string; note: string | null;
}

/** Tomorrow, on the restaurant's own calendar. */
const tomorrow = async () => (await db.query<{ d: string }>(
  `SELECT to_char((now() AT TIME ZONE 'Europe/Sarajevo')::date + 1, 'YYYY-MM-DD') AS d`)).rows[0].d;

const ask = (over: Partial<{ venue: string; name: string; phone: string; party: number; day: string; time: string; note: string | null; locale: string; trap: string | null }> = {}) =>
  as(null, async () => {
    const day = over.day ?? await tomorrow();
    const { rows } = await db.query<{ r: Asked }>(
      `SELECT public.guest_request_reservation($1, $2, $3, $4, $5::date, $6::time, $7, $8, $9) AS r`,
      [over.venue ?? 'lasoul', over.name ?? 'Amina Hadžić', over.phone ?? '+387 61 123-456', over.party ?? 4, day,
        over.time ?? '19:30', over.note ?? null, over.locale ?? 'bs', over.trap ?? null]);
    return rows[0].r;
  });

const mine = (id: string, token: string) => as(null, async () =>
  (await db.query<{ r: Mine | null }>(`SELECT public.guest_reservation($1, $2) AS r`, [id, token])).rows[0].r);

const decide = (user: string | null, id: string, decision: string, reply: string | null = null) => as(user, async () =>
  (await db.query<{ r: { id: string; status: string } }>(
    `SELECT public.staff_decide_reservation($1, $2, $3) AS r`, [id, decision, reply])).rows[0].r);

const rows = async () => (await db.query<{ id: string; status: string; guest_phone: string; guest_name: string; venue_id: string }>(
  `SELECT id, status, guest_phone, guest_name, venue_id FROM public.reservations ORDER BY created_at, id`)).rows;

describe('what the booking page is told', () => {
  it('a restaurant takes no requests until its admin switches them on', async () => {
    const options = (slug: string) => as(null, async () =>
      (await db.query<{ o: Record<string, unknown> }>(`SELECT public.guest_reservation_options($1) AS o`, [slug])).rows[0].o);
    expect((await options('veraitalia')).enabled).toBe(false);
    expect(await options('nowhere')).toEqual({ enabled: false });
    const lasoul = await options('lasoul');
    expect(lasoul).toMatchObject({
      enabled: true, venue: 'lasoul', open: '00:00', close: '23:45', max_party: 10, days_ahead: 30, lead_minutes: 60,
      phone: '+387 33 877 779', note: null,
    });
    expect(lasoul.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(lasoul.now).toMatch(/^\d{2}:\d{2}$/);
  });

  it('the settings refuse hours the wrong way round and a party of none', async () => {
    await expect(db.exec(`UPDATE public.restaurant_settings SET reservations_open = '22:00', reservations_close = '12:00'`))
      .rejects.toThrow(/restaurant_settings_reservations_check/);
    await expect(db.exec(`UPDATE public.restaurant_settings SET reservations_max_party = 0`))
      .rejects.toThrow(/restaurant_settings_reservations_check/);
  });
});

describe('a guest asks for a table', () => {
  it('is kept as a request waiting for an answer, at the restaurant\'s own time', async () => {
    const day = await tomorrow();
    const asked = await ask({ name: '  Amina   Hadžić ', note: ' By the  window, please ' });
    expect(asked.status).toBe('pending');
    expect(asked.code).toMatch(/^R\d{5}$/);
    expect(asked.token).toMatch(/^[0-9a-f]{64}$/);

    const { rows: [row] } = await db.query<Record<string, unknown>>(
      `SELECT venue_id, guest_name, guest_phone, party_size, note, locale, status,
              to_char(reserved_for AT TIME ZONE 'Europe/Sarajevo', 'YYYY-MM-DD HH24:MI') AS at
         FROM public.reservations WHERE id = $1`, [asked.id]);
    expect(row).toEqual({
      venue_id: L, guest_name: 'Amina Hadžić', guest_phone: '+38761123456', party_size: 4,
      note: 'By the window, please', locale: 'bs', status: 'pending', at: `${day} 19:30`,
    });
  });

  it('is refused while reservations are off, and at a restaurant that does not exist', async () => {
    await expect(ask({ venue: 'veraitalia' })).rejects.toThrow(/RESERVATION:disabled/);
    await expect(ask({ venue: 'nowhere' })).rejects.toThrow(/RESERVATION:disabled/);
    expect(await rows()).toEqual([]);
  });

  it('is refused outside the restaurant\'s rules, each with its own word', async () => {
    await db.exec(`UPDATE public.restaurant_settings SET reservations_open = '12:00', reservations_close = '21:00' WHERE venue_id = '${L}'`);
    await expect(ask({ name: 'A' })).rejects.toThrow(/RESERVATION:name/);
    await expect(ask({ phone: '12345' })).rejects.toThrow(/RESERVATION:phone/);
    await expect(ask({ phone: 'call me maybe' })).rejects.toThrow(/RESERVATION:phone/);
    await expect(ask({ party: 0 })).rejects.toThrow(/RESERVATION:party/);
    await expect(ask({ party: 11 })).rejects.toThrow(/RESERVATION:party/);
    await expect(ask({ time: '19:10' })).rejects.toThrow(/RESERVATION:time/);
    await expect(ask({ time: '11:45' })).rejects.toThrow(/RESERVATION:hours/);
    await expect(ask({ time: '21:15' })).rejects.toThrow(/RESERVATION:hours/);
    const far = (await db.query<{ d: string }>(
      `SELECT to_char((now() AT TIME ZONE 'Europe/Sarajevo')::date + 31, 'YYYY-MM-DD') AS d`)).rows[0].d;
    await expect(ask({ day: far })).rejects.toThrow(/RESERVATION:far/);
    expect(await rows()).toEqual([]);
    // The first and the last time of the day are both taken.
    await ask({ time: '12:00' });
    await ask({ time: '21:00', phone: '+387 62 000 111' });
    expect(await rows()).toHaveLength(2);
  });

  it('is refused for a time already here, or closer than the restaurant\'s notice', async () => {
    const { rows: [now] } = await db.query<{ day: string; hour: string }>(
      `SELECT to_char(now() AT TIME ZONE 'Europe/Sarajevo', 'YYYY-MM-DD') AS day,
              to_char(date_trunc('hour', now() AT TIME ZONE 'Europe/Sarajevo'), 'HH24:MI') AS hour`);
    await expect(ask({ day: now.day, time: now.hour })).rejects.toThrow(/RESERVATION:soon/);
    const yesterday = (await db.query<{ d: string }>(
      `SELECT to_char((now() AT TIME ZONE 'Europe/Sarajevo')::date - 1, 'YYYY-MM-DD') AS d`)).rows[0].d;
    await expect(ask({ day: yesterday })).rejects.toThrow(/RESERVATION:soon/);
  });

  it('a robot that fills the hidden field is told "sent" and nothing is kept', async () => {
    const asked = await ask({ trap: 'http://spam.example' });
    expect(asked.status).toBe('pending');
    expect(await rows()).toEqual([]);
    expect(await mine(asked.id, asked.token)).toBeNull();
  });

  it('the same request sent twice is one request', async () => {
    const first = await ask();
    const second = await ask();
    expect(second).toEqual(first);
    expect(await rows()).toHaveLength(1);
  });

  it('one phone cannot hold more than three tables, and a flood is turned away', async () => {
    await ask({ time: '18:00' });
    await ask({ time: '19:00' });
    await ask({ time: '20:00' });
    await expect(ask({ time: '21:00' })).rejects.toThrow(/RESERVATION:repeat/);
    // Another phone still gets through.
    await ask({ time: '21:00', phone: '+387 62 000 111' });

    await db.exec(`
      INSERT INTO public.reservations(venue_id, code, token, guest_name, guest_phone, party_size, reserved_for)
      SELECT '${L}', 'R00000', md5(g::text), 'Flood', '+3876' || lpad(g::text, 7, '0'), 2, now() + interval '2 days'
        FROM generate_series(1, 40) g`);
    await expect(ask({ phone: '+387 63 555 000' })).rejects.toThrow(/RESERVATION:busy/);
  });
});

describe('the guest\'s own page', () => {
  it('shows their request with its token, and nothing without it', async () => {
    const day = await tomorrow();
    const asked = await ask({ note: 'Birthday' });
    expect(await mine(asked.id, asked.token)).toMatchObject({
      code: asked.code, venue: 'lasoul', status: 'pending', name: 'Amina Hadžić', party_size: 4,
      day, time: '19:30', note: 'Birthday', reply: null, phone: '+387 33 877 779',
    });
    expect(await mine(asked.id, 'not-the-token')).toBeNull();
    expect(await mine('00000000-0000-0000-0000-000000000000', asked.token)).toBeNull();
  });

  it('a guest cannot read the list, with or without an account', async () => {
    await ask();
    await expect(as(null, () => db.query(`SELECT * FROM public.reservations`))).rejects.toThrow(/permission denied/);
    expect(await as(AMAR, async () => (await db.query(`SELECT * FROM public.reservations`)).rows)).toEqual([]);
  });

  it('the guest can take their request back before its time, and only theirs', async () => {
    const asked = await ask();
    const other = await ask({ phone: '+387 62 000 111' });
    const cancel = (id: string, token: string) => as(null, async () =>
      (await db.query<{ r: Mine | null }>(`SELECT public.guest_cancel_reservation($1, $2) AS r`, [id, token])).rows[0].r);
    expect(await cancel(asked.id, other.token)).toBeNull();
    expect((await rows()).map((r) => r.status)).toEqual(['pending', 'pending']);

    expect(await cancel(asked.id, asked.token)).toMatchObject({ status: 'cancelled', cancelled_by: 'guest' });
    expect((await mine(other.id, other.token))?.status).toBe('pending');

    // Once its time has passed there is nothing left to cancel.
    await db.query(`UPDATE public.reservations SET reserved_for = now() - interval '1 hour' WHERE id = $1`, [other.id]);
    expect(await cancel(other.id, other.token)).toMatchObject({ status: 'expired' });
    expect((await rows()).find((r) => r.id === other.id)?.status).toBe('pending');
  });
});

describe('the restaurant answers', () => {
  it('only an admin of the request\'s own restaurant, or the owner', async () => {
    const asked = await ask();
    await expect(decide(AMAR, asked.id, 'confirm')).rejects.toThrow(/Only the restaurant's admin/);
    await expect(decide(ADMIN_V, asked.id, 'confirm')).rejects.toThrow(/Only the restaurant's admin/);
    await expect(decide(null, asked.id, 'confirm')).rejects.toThrow(/permission denied|Only the restaurant's admin/);
    expect((await mine(asked.id, asked.token))?.status).toBe('pending');

    expect(await decide(ADMIN_L, asked.id, 'confirm', '  By the window ')).toEqual({ id: asked.id, status: 'confirmed' });
    expect(await mine(asked.id, asked.token)).toMatchObject({ status: 'confirmed', reply: 'By the window' });

    const second = await ask({ phone: '+387 62 000 111' });
    expect((await decide(OWNER, second.id, 'decline', 'Full at 19:30, 21:00 is free')).status).toBe('declined');
  });

  it('confirm, decline and cancel each from where they make sense, and it is written down', async () => {
    const asked = await ask();
    await expect(decide(ADMIN_L, asked.id, 'cancel')).rejects.toThrow(/is pending and cannot be cancelled/);
    await expect(decide(ADMIN_L, asked.id, 'seat')).rejects.toThrow(/cannot be changed/);

    await decide(ADMIN_L, asked.id, 'decline');
    // Declined by mistake: it can still be confirmed.
    await decide(ADMIN_L, asked.id, 'confirm');
    await expect(decide(ADMIN_L, asked.id, 'decline')).rejects.toThrow(/is confirmed and cannot be declined/);
    await decide(ADMIN_L, asked.id, 'cancel', 'Private event that evening');
    expect(await mine(asked.id, asked.token)).toMatchObject({
      status: 'cancelled', cancelled_by: 'restaurant', reply: 'Private event that evening',
    });
    await expect(decide(ADMIN_L, asked.id, 'confirm')).rejects.toThrow(/is cancelled and cannot be confirmed/);

    const { rows: audit } = await db.query<{ action: string; venue_id: string; actor_user_id: string }>(
      `SELECT action, venue_id, actor_user_id FROM public.audit_log WHERE entity_type = 'reservation' ORDER BY created_at, id`);
    expect(audit.map((a) => a.action)).toEqual(['reservation.declined', 'reservation.confirmed', 'reservation.cancelled']);
    expect(new Set(audit.map((a) => a.venue_id))).toEqual(new Set([L]));
    expect(new Set(audit.map((a) => a.actor_user_id))).toEqual(new Set([ADMIN_L]));
  });

  it('a request whose time has passed cannot be answered', async () => {
    const asked = await ask();
    await db.query(`UPDATE public.reservations SET reserved_for = now() - interval '5 minutes' WHERE id = $1`, [asked.id]);
    await expect(decide(ADMIN_L, asked.id, 'confirm')).rejects.toThrow(/has passed/);
    expect((await mine(asked.id, asked.token))?.status).toBe('expired');
  });

  it('admins read their own restaurant\'s requests; the owner reads both; a waiter none', async () => {
    await db.exec(`UPDATE public.restaurant_settings SET reservations_enabled = true`);
    await ask();
    await ask({ venue: 'veraitalia', phone: '+965 5000 1234', name: 'Fahad' });
    const seen = (user: string) => as(user, async () =>
      (await db.query<{ guest_name: string }>(`SELECT guest_name FROM public.reservations ORDER BY guest_name`)).rows.map((r) => r.guest_name));
    expect(await seen(ADMIN_L)).toEqual(['Amina Hadžić']);
    expect(await seen(ADMIN_V)).toEqual(['Fahad']);
    expect(await seen(OWNER)).toEqual(['Amina Hadžić', 'Fahad']);
    expect(await seen(AMAR)).toEqual([]);
    // Nobody writes the table directly: answers go through the function.
    await expect(as(ADMIN_L, () => db.query(`UPDATE public.reservations SET status = 'confirmed'`))).rejects.toThrow(/permission denied/);
    await expect(as(ADMIN_L, () => db.query(`DELETE FROM public.reservations`))).rejects.toThrow(/permission denied/);
  });
});

describe('telling the restaurant at once', () => {
  /** pg_net as Supabase has it, recording what it was asked to send. */
  const installPgNet = (fail = false) => db.exec(`
    CREATE SCHEMA net;
    CREATE TABLE net.sent (url text, body jsonb, headers jsonb);
    CREATE FUNCTION net.http_post(url text, body jsonb DEFAULT '{}', params jsonb DEFAULT '{}',
                                  headers jsonb DEFAULT '{}', timeout_milliseconds int DEFAULT 5000)
    RETURNS bigint LANGUAGE plpgsql AS $$
    BEGIN
      ${fail ? `RAISE EXCEPTION 'pg_net queue is full';` : ''}
      INSERT INTO net.sent VALUES (url, body, headers);
      RETURN 1;
    END $$;
  `);
  const sent = async () => (await db.query<{ body: Record<string, unknown> }>(`SELECT body FROM net.sent`)).rows.map((r) => r.body);
  const sweep = async () => (await db.query<{ r: { expired: number; reminded: number } }>(
    `SELECT public.run_scheduled_reservation_sweep() AS r`)).rows[0].r;

  it('a new request queues one call to notify-staff naming it; an answer queues none', async () => {
    await installPgNet();
    const asked = await ask();
    expect(await sent()).toEqual([{ table: 'reservations', id: asked.id }]);
    await decide(ADMIN_L, asked.id, 'confirm');
    expect(await sent()).toHaveLength(1);
  });

  it('a confirmed table the guest gives back is told too; other cancellations are not', async () => {
    await installPgNet();
    const cancel = (key: Asked) => as(null, () => db.query(`SELECT public.guest_cancel_reservation($1, $2)`, [key.id, key.token]));
    const confirmed = await ask();
    await decide(ADMIN_L, confirmed.id, 'confirm');
    const waiting = await ask({ phone: '+387 62 000 111' });
    const byRestaurant = await ask({ phone: '+387 62 000 222' });
    await decide(ADMIN_L, byRestaurant.id, 'confirm');
    const before = (await sent()).length;
    expect(before).toBe(3);

    await cancel(waiting);                                  // never answered: it just leaves the list
    await decide(ADMIN_L, byRestaurant.id, 'cancel');        // the restaurant knows what it did
    expect(await sent()).toHaveLength(before);
    await cancel(confirmed);                                // a promised table is free again
    expect((await sent()).slice(before)).toEqual([{ table: 'reservations', id: confirmed.id }]);

    const claim = async () => (await db.query<{ ok: boolean }>(
      `SELECT public.staff_push_claim('reservation_cancellations', $1) AS ok`, [confirmed.id])).rows[0].ok;
    expect(await claim()).toBe(true);
    expect(await claim()).toBe(false);
  });

  it('never stops a request: without pg_net, or with pg_net failing, it still goes in', async () => {
    await ask();
    await installPgNet(true);
    await ask({ phone: '+387 62 000 111' });
    expect(await rows()).toHaveLength(2);
  });

  it('reminds once after five minutes without an answer, and never again', async () => {
    await installPgNet();
    const waiting = await ask();
    const answered = await ask({ phone: '+387 62 000 111' });
    await decide(ADMIN_L, answered.id, 'confirm');
    expect(await sweep()).toEqual({ expired: 0, reminded: 0 });

    await db.exec(`UPDATE public.reservations SET created_at = now() - interval '6 minutes'`);
    expect(await sweep()).toEqual({ expired: 0, reminded: 1 });
    expect((await sent()).slice(2)).toEqual([{ table: 'reservations', id: waiting.id, reminder: true }]);
    expect(await sweep()).toEqual({ expired: 0, reminded: 0 });
    expect(await sent()).toHaveLength(3);
  });

  it('a request nobody answered expires at its time; one long forgotten is not announced', async () => {
    await installPgNet();
    const late = await ask();
    const old = await ask({ phone: '+387 62 000 111' });
    await db.query(`UPDATE public.reservations SET reserved_for = now() - interval '1 minute' WHERE id = $1`, [late.id]);
    await db.query(`UPDATE public.reservations SET created_at = now() - interval '3 hours' WHERE id = $1`, [old.id]);
    expect(await sweep()).toEqual({ expired: 1, reminded: 0 });
    expect((await rows()).find((r) => r.id === late.id)?.status).toBe('expired');
    expect((await rows()).find((r) => r.id === old.id)?.status).toBe('pending');
  });

  it('the sweep is the scheduler\'s, and notify-staff can claim a request and its reminder once each', async () => {
    for (const user of [OWNER, ADMIN_L, null]) {
      await expect(as(user, () => db.query(`SELECT public.reservations_sweep()`))).rejects.toThrow(/permission denied/);
      await expect(as(user, () => db.query(`SELECT public.run_scheduled_reservation_sweep()`))).rejects.toThrow(/permission denied/);
    }
    const claim = async (source: string) => (await db.query<{ ok: boolean }>(
      `SELECT public.staff_push_claim($1, 'e0000000-0000-0000-0000-0000000000aa') AS ok`, [source])).rows[0].ok;
    expect(await claim('reservations')).toBe(true);
    expect(await claim('reservations')).toBe(false);
    expect(await claim('reservation_reminders')).toBe(true);
    await expect(claim('anything_else')).rejects.toThrow(/staff_push_sent_source_check/);
  });
});

describe('"Alert this phone"', () => {
  const subscribe = (venue: string, endpoint = PHONE) => db.query<{ r: { subscribed: boolean } }>(
    `SELECT public.reservation_alerts_subscribe($1, $2::jsonb, $3) AS r`, [endpoint, JSON.stringify(KEYS), venue]).then((x) => x.rows[0].r);
  const phones = async () => (await db.query<{ user_id: string; venue_id: string }>(
    `SELECT user_id, venue_id FROM public.reservation_alert_phones ORDER BY venue_id, user_id`)).rows;

  it('is for admins of that restaurant: not waiters, not the other restaurant\'s admin, not guests', async () => {
    await expect(as(AMAR, () => subscribe(L))).rejects.toThrow(/this restaurant's admins/);
    await expect(as(ADMIN_V, () => subscribe(L))).rejects.toThrow(/this restaurant's admins/);
    await expect(as(null, () => subscribe(L))).rejects.toThrow(/permission denied|this restaurant's admins/);
    expect(await phones()).toEqual([]);

    expect(await as(ADMIN_L, () => subscribe(L))).toEqual({ subscribed: true, venue_id: L });
    // The owner has both restaurants; one phone can listen to each.
    await as(OWNER, () => subscribe(V, 'https://web.push.apple.com/owner-phone'));
    await as(OWNER, () => subscribe(L, 'https://web.push.apple.com/owner-phone'));
    expect(await phones()).toEqual([
      { user_id: ADMIN_L, venue_id: L }, { user_id: OWNER, venue_id: L }, { user_id: OWNER, venue_id: V },
    ]);
  });

  it('keeps only push service addresses, and a shared phone is the last admin\'s', async () => {
    await expect(as(ADMIN_L, () => subscribe(L, 'https://evil.test/x'))).rejects.toThrow(/push service/);
    await as(ADMIN_L, () => subscribe(L));
    await as(OWNER, () => subscribe(L));
    expect(await phones()).toEqual([{ user_id: OWNER, venue_id: L }]);
  });

  it('each admin sees and removes only their own phones, and nobody adds one directly', async () => {
    await as(ADMIN_L, () => subscribe(L));
    await as(OWNER, () => subscribe(L, 'https://web.push.apple.com/owner-phone'));
    const own = (user: string) => as(user, async () =>
      (await db.query<{ user_id: string }>(`SELECT user_id FROM public.reservation_alert_phones`)).rows.map((r) => r.user_id));
    expect(await own(ADMIN_L)).toEqual([ADMIN_L]);
    expect(await own(AMAR)).toEqual([]);
    await as(ADMIN_L, () => db.query(`DELETE FROM public.reservation_alert_phones`));
    expect(await phones()).toEqual([{ user_id: OWNER, venue_id: L }]);
    await expect(as(ADMIN_L, () => db.query(
      `INSERT INTO public.reservation_alert_phones(user_id, venue_id, endpoint, keys) VALUES ($1, $2, $3, $4)`,
      [ADMIN_L, L, PHONE, JSON.stringify(KEYS)]))).rejects.toThrow(/permission denied/);
  });
});

describe('what the migration may not do', () => {
  it('references no table of the sign-in schema: user ids are plain', async () => {
    const { rows: refs } = await db.query<{ refs: string }>(
      `SELECT DISTINCT confrelid::regclass::text AS refs FROM pg_constraint
        WHERE conrelid IN ('public.reservations'::regclass, 'public.reservation_alert_phones'::regclass) AND contype = 'f'`);
    expect(refs.map((r) => r.refs)).toEqual(['venues']);
    const sql = readFileSync(resolve(__dirname, '..', 'migrations', '20261113090000_reservations.sql'), 'utf8');
    expect(sql).not.toMatch(/references\s+auth\./i);
  });

  it('leaves reservations off at both restaurants', async () => {
    const fresh = (await createTestDatabase({ quiet: true })) as unknown as Db;
    try {
      const { rows: settings } = await fresh.query<{ on: boolean }>(`SELECT reservations_enabled AS on FROM public.restaurant_settings`);
      expect(settings.length).toBeGreaterThanOrEqual(2);
      expect(settings.every((s) => s.on === false)).toBe(true);
    } finally {
      await fresh.close();
    }
  }, 180_000);
});
