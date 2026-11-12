/**
 * @vitest-environment node
 *
 * WhatsApp messages about a reservation, the database's part
 * (20261114090000_reservation_messages.sql).
 *
 * What must hold: both of a restaurant's choices are off until its admin
 * turns them on; the booking page is told whether a guest will be messaged;
 * the function is called when a guest asks and when a request is answered or
 * cancelled, and only for a restaurant that has messages on; a request or an
 * answer is never stopped by it; each kind of message is kept once for a
 * reservation; and only the restaurant's own admins read what was sent.
 */
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

const FUNCTION = 'https://jgxnvrrphxnmzongtmzs.supabase.co/functions/v1/reservation-messages';

let db: Db;

beforeAll(async () => {
  db = (await createTestDatabase({ quiet: true })) as unknown as Db;
  await db.exec(`
    GRANT USAGE ON SCHEMA public TO anon, authenticated;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
    GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon;
    -- What the migrations state for their own tables wins over the blanket grants above.
    REVOKE ALL ON public.reservations FROM anon, authenticated;
    GRANT SELECT ON public.reservations TO authenticated;
    REVOKE ALL ON public.reservation_messages FROM anon, authenticated;
    GRANT SELECT ON public.reservation_messages TO authenticated;
  `);
}, 180_000);
afterAll(async () => { await db?.close(); });

beforeEach(async () => {
  await db.exec(`
    DROP SCHEMA IF EXISTS net CASCADE;
    TRUNCATE public.reservations, public.reservation_alert_phones, public.staff_push_sent, public.waiters RESTART IDENTITY CASCADE;
    DELETE FROM public.user_roles;
    DELETE FROM auth.users;
    INSERT INTO auth.users(id) VALUES ('${OWNER}'), ('${ADMIN_L}'), ('${ADMIN_V}'), ('${AMAR}');
    INSERT INTO public.user_roles(user_id, role, venue_id) VALUES
      ('${OWNER}', 'admin', NULL), ('${ADMIN_L}', 'admin', '${L}'), ('${ADMIN_V}', 'admin', '${V}'),
      ('${AMAR}', 'staff', '${L}');
    UPDATE public.restaurant_settings
       SET reservations_enabled = true, reservations_open = '00:00', reservations_close = '23:45',
           reservations_max_party = 10, reservations_days_ahead = 30, reservations_lead_minutes = 60,
           reservations_whatsapp_guest = false, reservations_whatsapp_admin = NULL;
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

const tomorrow = async () => (await db.query<{ d: string }>(
  `SELECT to_char((now() AT TIME ZONE 'Europe/Sarajevo')::date + 1, 'YYYY-MM-DD') AS d`)).rows[0].d;

const ask = (venue = 'lasoul', phone = '+387 61 123-456') => as(null, async () =>
  (await db.query<{ r: { id: string; token: string } }>(
    `SELECT public.guest_request_reservation($1, 'Amina Hadžić', $2, 4, $3::date, '19:30'::time, NULL, 'bs', NULL) AS r`,
    [venue, phone, await tomorrow()])).rows[0].r);

const decide = (user: string, id: string, decision: string) => as(user, async () =>
  (await db.query(`SELECT public.staff_decide_reservation($1, $2, NULL)`, [id, decision])).rows);

const guestCancels = (id: string, token: string) => as(null, async () =>
  (await db.query(`SELECT public.guest_cancel_reservation($1, $2)`, [id, token])).rows);

const options = (slug: string) => as(null, async () =>
  (await db.query<{ o: Record<string, unknown> }>(`SELECT public.guest_reservation_options($1) AS o`, [slug])).rows[0].o);

const turnOn = (venue: string, guest: boolean, adminPhone: string | null) => db.query(
  `UPDATE public.restaurant_settings SET reservations_whatsapp_guest = $2, reservations_whatsapp_admin = $3 WHERE venue_id = $1`,
  [venue, guest, adminPhone]);

/** pg_net as Supabase has it, recording what it was asked to send. */
const installPgNet = (fail = false) => db.exec(`
  CREATE SCHEMA net;
  CREATE TABLE net.sent (url text, body jsonb, headers jsonb);
  CREATE FUNCTION net.http_post(url text, body jsonb DEFAULT '{}', params jsonb DEFAULT '{}',
                                headers jsonb DEFAULT '{}', timeout_milliseconds int DEFAULT 5000)
  RETURNS bigint LANGUAGE plpgsql AS $$
  BEGIN
    ${fail ? `IF url LIKE '%reservation-messages' THEN RAISE EXCEPTION 'pg_net queue is full'; END IF;` : ''}
    INSERT INTO net.sent VALUES (url, body, headers);
    RETURN 1;
  END $$;
`);
const told = async () => (await db.query<{ body: Record<string, unknown> }>(
  `SELECT body FROM net.sent WHERE url = $1`, [FUNCTION])).rows.map((r) => r.body);

describe('each restaurant’s choices', () => {
  it('are both off until its admin turns them on, and the booking page is told which', async () => {
    const { rows } = await db.query<{ guest: boolean; admin: string | null }>(
      `SELECT reservations_whatsapp_guest AS guest, reservations_whatsapp_admin AS admin FROM public.restaurant_settings`);
    expect(rows.length).toBeGreaterThanOrEqual(2);
    for (const row of rows) expect(row).toEqual({ guest: false, admin: null });
    expect((await options('lasoul')).whatsapp).toBe(false);

    await turnOn(L, true, null);
    expect(await options('lasoul')).toMatchObject({ enabled: true, whatsapp: true, open: '00:00', max_party: 10 });
    // One restaurant's choice is not the other's.
    expect((await options('veraitalia')).whatsapp).toBe(false);
    expect(await options('nowhere')).toEqual({ enabled: false });
  });

  it('the number to tell is a phone number, or nothing', async () => {
    for (const good of ['+387 62 555 000', '062555000', '00387 (62) 555-000']) {
      await expect(turnOn(L, false, good)).resolves.toBeTruthy();
    }
    for (const bad of ['Sanela', '12345', '+387 62 555 000 or the other one', '']) {
      await expect(turnOn(L, false, bad)).rejects.toThrow(/whatsapp_admin_check/);
    }
  });

  it('are the admin’s of that restaurant to make, and nobody else’s', async () => {
    const set = (user: string, venue: string) => as(user, async () => (await db.query(
      `UPDATE public.restaurant_settings SET reservations_whatsapp_guest = true WHERE venue_id = $1`, [venue])).affectedRows ?? 0);
    expect(await set(ADMIN_V, L)).toBe(0);
    expect(await set(AMAR, L)).toBe(0);
    expect((await options('lasoul')).whatsapp).toBe(false);
    expect(await set(ADMIN_L, L)).toBe(1);
    expect((await options('lasoul')).whatsapp).toBe(true);
  });
});

describe('telling the function', () => {
  it('nothing is queued for a restaurant that has messages off', async () => {
    await installPgNet();
    const asked = await ask();
    await decide(ADMIN_L, asked.id, 'confirm');
    expect(await told()).toEqual([]);
  });

  it('a request, an answer and a cancellation each queue one call naming the reservation', async () => {
    await installPgNet();
    await turnOn(L, true, null);
    const asked = await ask();
    expect(await told()).toEqual([{ id: asked.id }]);
    await decide(ADMIN_L, asked.id, 'confirm');
    expect(await told()).toHaveLength(2);
    await guestCancels(asked.id, asked.token);
    expect(await told()).toEqual([{ id: asked.id }, { id: asked.id }, { id: asked.id }]);
  });

  it('the restaurant’s number alone is enough to be told; and one restaurant’s switch is not the other’s', async () => {
    await installPgNet();
    await turnOn(L, false, '+387 62 555 000');
    const atLaSoul = await ask('lasoul');
    await ask('veraitalia', '+387 61 999 000');
    expect(await told()).toEqual([{ id: atLaSoul.id }]);
  });

  it('a request nobody answered in time lapses without a call', async () => {
    await installPgNet();
    await turnOn(L, true, null);
    const asked = await ask();
    await db.query(`UPDATE public.reservations SET reserved_for = now() - interval '1 hour' WHERE id = $1`, [asked.id]);
    await db.query(`SELECT public.run_scheduled_reservation_sweep()`);
    expect((await db.query<{ status: string }>(`SELECT status FROM public.reservations WHERE id = $1`, [asked.id])).rows[0].status).toBe('expired');
    expect(await told()).toEqual([{ id: asked.id }]);
  });

  it('never stops a request or an answer: without pg_net, or when queuing fails, both go through', async () => {
    await turnOn(L, true, '+387 62 555 000');
    const noNet = await ask();
    await decide(ADMIN_L, noNet.id, 'confirm');

    await installPgNet(true);
    const failing = await ask('lasoul', '+387 61 777 000');
    await decide(ADMIN_L, failing.id, 'decline');
    const { rows } = await db.query<{ status: string }>(`SELECT status FROM public.reservations ORDER BY created_at, id`);
    expect(rows.map((r) => r.status)).toEqual(['confirmed', 'declined']);
  });

  it('is nobody’s to call from outside', async () => {
    for (const user of [null, AMAR, ADMIN_L]) {
      await expect(as(user, () => db.query(`SELECT public.reservation_messages_url()`))).rejects.toThrow(/permission denied/);
    }
  });
});

describe('what was sent', () => {
  const claim = (reservation: string, venue: string, kind: string) => db.query(
    `INSERT INTO public.reservation_messages(reservation_id, venue_id, kind) VALUES ($1, $2, $3)
     ON CONFLICT (reservation_id, kind) DO NOTHING RETURNING id`, [reservation, venue, kind]);

  it('is kept once for each kind of message and reservation', async () => {
    const asked = await ask();
    expect((await claim(asked.id, L, 'guest_received')).rows).toHaveLength(1);
    expect((await claim(asked.id, L, 'guest_received')).rows).toHaveLength(0);
    expect((await claim(asked.id, L, 'guest_confirmed')).rows).toHaveLength(1);
    await expect(claim(asked.id, L, 'a_text_message')).rejects.toThrow(/kind_check/);
    await expect(db.query(`UPDATE public.reservation_messages SET status = 'delivered'`)).rejects.toThrow(/status_check/);
  });

  it('is read by the restaurant’s own admins and the owner, and by nobody else', async () => {
    const asked = await ask();
    await claim(asked.id, L, 'guest_received');
    const seen = (user: string | null) => as(user, async () => (await db.query(`SELECT id FROM public.reservation_messages`)).rows.length);
    expect(await seen(ADMIN_L)).toBe(1);
    expect(await seen(OWNER)).toBe(1);
    expect(await seen(ADMIN_V)).toBe(0);
    expect(await seen(AMAR)).toBe(0);
    await expect(seen(null)).rejects.toThrow(/permission denied/);
  });

  it('is written by the function alone', async () => {
    const asked = await ask();
    await claim(asked.id, L, 'guest_received');
    for (const sql of [
      `INSERT INTO public.reservation_messages(reservation_id, venue_id, kind) VALUES ('${asked.id}', '${L}', 'guest_declined')`,
      `UPDATE public.reservation_messages SET status = 'sent'`,
      `DELETE FROM public.reservation_messages`,
    ]) {
      await expect(as(ADMIN_L, () => db.query(sql))).rejects.toThrow(/permission denied/);
    }
  });

  it('goes with the reservation when that is removed', async () => {
    const asked = await ask();
    await claim(asked.id, L, 'guest_received');
    await db.query(`DELETE FROM public.reservations WHERE id = $1`, [asked.id]);
    expect((await db.query(`SELECT id FROM public.reservation_messages`)).rows).toEqual([]);
  });
});
