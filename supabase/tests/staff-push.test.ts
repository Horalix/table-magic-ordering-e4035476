/**
 * @vitest-environment node
 *
 * Lock-screen alerts (20261112090000_staff_push.sql): where a waiter's phone
 * is kept, who may keep it there, and the moment the database calls
 * notify-staff.
 *
 * A waiter manages only their own phones, and only at a restaurant they wait
 * tables at; the function's own helpers are the function's alone; and an
 * order, call or bill request queues exactly one call — while a missing or
 * failing pg_net never stops a guest's order.
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

const AMAR = '10000000-0000-0000-0000-0000000000a1'; // waiter, La Soul
const LEJLA = '10000000-0000-0000-0000-0000000000a2'; // waiter, La Soul
const GIULIA = '10000000-0000-0000-0000-0000000000b1'; // waiter, Vera Italia
const ADMIN_L = '10000000-0000-0000-0000-0000000000c1'; // La Soul's admin, not a waiter
const GONE = '10000000-0000-0000-0000-0000000000d1'; // a La Soul waiter who left

const W_AMAR = '20000000-0000-0000-0000-0000000000a1';
const W_LEJLA = '20000000-0000-0000-0000-0000000000a2';
const W_GIULIA = '20000000-0000-0000-0000-0000000000b1';
const W_GONE = '20000000-0000-0000-0000-0000000000d1';

const SEC_L = 'f0000000-0000-0000-0000-00000000000a';
const SEC_V = 'f0000000-0000-0000-0000-00000000000b';
const CAT_L = 'c0000000-0000-0000-0000-00000000000a';
const SUB_L = 'd0000000-0000-0000-0000-00000000000a';
const DISH_L = 'e0000000-0000-0000-0000-00000000000a';
const T7_L = '30000000-0000-0000-0000-00000000000a';
const S_L = '40000000-0000-0000-0000-00000000000a';

const PHONE = 'https://fcm.googleapis.com/fcm/send/amar-phone';
const KEYS = { p256dh: 'B'.repeat(87), auth: 'a'.repeat(22) };

let db: Db;

beforeAll(async () => {
  db = (await createTestDatabase({ quiet: true })) as unknown as Db;
  await db.exec(`
    GRANT USAGE ON SCHEMA public TO anon, authenticated;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
    GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon;
    -- What the migration states for its own tables wins over the blanket grant above.
    REVOKE ALL ON public.staff_push_sent FROM authenticated, anon;
    REVOKE ALL ON public.staff_push_subscriptions FROM anon;
  `);
}, 180_000);
afterAll(async () => { await db?.close(); });

beforeEach(async () => {
  await db.exec(`
    DROP SCHEMA IF EXISTS net CASCADE;
    TRUNCATE public.staff_push_subscriptions, public.staff_push_sent, public.order_ticket_events, public.order_items,
             public.orders, public.waiter_calls, public.bill_requests, public.table_sessions, public.tables,
             public.section_assignments, public.sections, public.waiters, public.menu_items, public.subcategories,
             public.categories, public.order_code_counters
      RESTART IDENTITY CASCADE;
    DELETE FROM public.user_roles;
    DELETE FROM auth.users;
    UPDATE public.restaurant_settings SET ordering_enabled = true, online_card_enabled = false;

    INSERT INTO auth.users(id) VALUES ('${AMAR}'), ('${LEJLA}'), ('${GIULIA}'), ('${ADMIN_L}'), ('${GONE}');
    INSERT INTO public.user_roles(user_id, role, venue_id) VALUES
      ('${AMAR}', 'staff', '${L}'), ('${LEJLA}', 'staff', '${L}'), ('${GIULIA}', 'staff', '${V}'),
      ('${ADMIN_L}', 'admin', '${L}'), ('${GONE}', 'staff', '${L}');
    INSERT INTO public.waiters(id, user_id, display_name, venue_id, is_active) VALUES
      ('${W_AMAR}', '${AMAR}', 'Amar', '${L}', true), ('${W_LEJLA}', '${LEJLA}', 'Lejla', '${L}', true),
      ('${W_GIULIA}', '${GIULIA}', 'Giulia', '${V}', true), ('${W_GONE}', '${GONE}', 'Edin', '${L}', false);
    INSERT INTO public.sections(id, name, venue_id) VALUES ('${SEC_L}', 'Terrace', '${L}'), ('${SEC_V}', 'Sala', '${V}');

    INSERT INTO public.categories(id, name, sort_order, venue_id) VALUES ('${CAT_L}', 'Food', 1, '${L}');
    INSERT INTO public.subcategories(id, category_id, name, sort_order) VALUES ('${SUB_L}', '${CAT_L}', 'Grill', 1);
    INSERT INTO public.menu_items(id, subcategory_id, name, price, is_available, station) VALUES
      ('${DISH_L}', '${SUB_L}', 'Ćevapi', 12.00, true, 'kitchen');
    INSERT INTO public.tables(id, table_number, qr_token, venue_id) VALUES ('${T7_L}', 7, 'sticker-lasoul-7', '${L}');
    INSERT INTO public.table_sessions(id, table_id, token, is_active, guest_name, last_heartbeat_at)
      VALUES ('${S_L}', '${T7_L}', 'tok-l', true, 'Amina', now());
  `);
  await actAs(db, null);
});

/** Run as a signed-in user, under the access rules. */
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

const subscribe = (endpoint: string, venue: string, keys: Record<string, string> = KEYS) =>
  db.query<{ r: { subscribed: boolean } }>(`SELECT public.staff_push_subscribe($1, $2::jsonb, $3) AS r`,
    [endpoint, JSON.stringify(keys), venue]).then(({ rows }) => rows[0].r);

const phones = async () => (await db.query<{ user_id: string; venue_id: string; endpoint: string }>(
  `SELECT user_id, venue_id, endpoint FROM public.staff_push_subscriptions ORDER BY endpoint, venue_id`)).rows;

describe('turning alerts on', () => {
  it('keeps the waiter\'s phone for their restaurant, once, and notes each opening', async () => {
    expect(await as(AMAR, () => subscribe(PHONE, L))).toEqual({ subscribed: true, venue_id: L });
    const { rows: [first] } = await db.query<{ seen: string; keys: unknown }>(
      `SELECT last_seen_at AS seen, keys FROM public.staff_push_subscriptions`);
    expect(first.keys).toEqual(KEYS);
    await db.exec(`UPDATE public.staff_push_subscriptions SET last_seen_at = now() - interval '1 day'`);

    await as(AMAR, () => subscribe(PHONE, L));
    const { rows } = await db.query<{ fresh: boolean }>(
      `SELECT last_seen_at > now() - interval '1 minute' AS fresh FROM public.staff_push_subscriptions`);
    expect(rows).toEqual([{ fresh: true }]);
  });

  it('refuses the other restaurant: a La Soul waiter cannot have Vera Italia\'s alerts, nor the other way', async () => {
    await expect(as(AMAR, () => subscribe(PHONE, V))).rejects.toThrow(/this restaurant's waiters/);
    await expect(as(GIULIA, () => subscribe('https://web.push.apple.com/giulia', L))).rejects.toThrow(/this restaurant's waiters/);
    expect(await phones()).toEqual([]);
  });

  it('refuses anyone who is not a working waiter there, and anyone not signed in', async () => {
    await expect(as(ADMIN_L, () => subscribe(PHONE, L))).rejects.toThrow(/this restaurant's waiters/);
    await expect(as(GONE, () => subscribe(PHONE, L))).rejects.toThrow(/this restaurant's waiters/);
    await expect(as(null, () => subscribe(PHONE, L))).rejects.toThrow(/permission denied|Sign in/);
    expect(await phones()).toEqual([]);
  });

  it('keeps only push service addresses and a browser\'s keys', async () => {
    await expect(as(AMAR, () => subscribe('https://jgxnvrrphxnmzongtmzs.supabase.co/rest/v1/orders', L))).rejects.toThrow(/push service/);
    await expect(as(AMAR, () => subscribe('http://fcm.googleapis.com/fcm/send/x', L))).rejects.toThrow(/push service/);
    await expect(as(AMAR, () => subscribe(PHONE, L, { p256dh: 'short', auth: KEYS.auth }))).rejects.toThrow(/push keys/);
    await expect(as(AMAR, () => subscribe(PHONE, L, { p256dh: KEYS.p256dh }))).rejects.toThrow(/push keys/);
    // Not through the function either: the table refuses it.
    await expect(as(AMAR, () => db.query(
      `INSERT INTO public.staff_push_subscriptions(user_id, venue_id, endpoint, keys) VALUES ($1, $2, 'https://evil.test/x', $3)`,
      [AMAR, L, JSON.stringify(KEYS)]))).rejects.toThrow(/staff_push_subscriptions_endpoint_check/);
  });

  it('a shared phone is the last signed-in waiter\'s: the one before stops getting its alerts', async () => {
    await as(AMAR, () => subscribe(PHONE, L));
    await as(LEJLA, () => subscribe(PHONE, L));
    expect(await phones()).toEqual([{ user_id: LEJLA, venue_id: L, endpoint: PHONE }]);
  });
});

describe('each waiter manages only their own phones', () => {
  beforeEach(async () => {
    await as(AMAR, () => subscribe(PHONE, L));
    await as(LEJLA, () => subscribe('https://fcm.googleapis.com/fcm/send/lejla-phone', L));
    await as(GIULIA, () => subscribe('https://web.push.apple.com/giulia-phone', V));
  });

  it('sees only their own', async () => {
    const mine = (u: string) => as(u, async () => (await db.query<{ endpoint: string }>(
      `SELECT endpoint FROM public.staff_push_subscriptions`)).rows.map((r) => r.endpoint));
    expect(await mine(AMAR)).toEqual([PHONE]);
    expect(await mine(GIULIA)).toEqual(['https://web.push.apple.com/giulia-phone']);
    expect(await mine(ADMIN_L)).toEqual([]);
    await expect(as(null, () => db.query(`SELECT 1 FROM public.staff_push_subscriptions`))).rejects.toThrow(/permission denied/);
  });

  it('removes and changes only their own', async () => {
    await as(AMAR, () => db.query(`DELETE FROM public.staff_push_subscriptions`));
    await as(AMAR, () => db.query(`UPDATE public.staff_push_subscriptions SET user_id = $1`, [AMAR]));
    expect((await phones()).map((p) => p.user_id).sort()).toEqual([GIULIA, LEJLA].sort());
  });

  it('cannot add a phone in someone else\'s name, or at a restaurant they do not work at', async () => {
    const add = (user: string, venue: string, endpoint: string) => db.query(
      `INSERT INTO public.staff_push_subscriptions(user_id, venue_id, endpoint, keys) VALUES ($1, $2, $3, $4)`,
      [user, venue, endpoint, JSON.stringify(KEYS)]);
    await expect(as(AMAR, () => add(LEJLA, L, 'https://fcm.googleapis.com/fcm/send/fake'))).rejects.toThrow(/row-level security/);
    await expect(as(AMAR, () => add(AMAR, V, 'https://fcm.googleapis.com/fcm/send/at-vera'))).rejects.toThrow(/row-level security/);
  });
});

describe('the function\'s own helpers', () => {
  it('claims an event once', async () => {
    const claim = async () => (await db.query<{ ok: boolean }>(
      `SELECT public.staff_push_claim('orders', 'e0000000-0000-0000-0000-0000000000ff') AS ok`)).rows[0].ok;
    expect(await claim()).toBe(true);
    expect(await claim()).toBe(false);
  });

  it('forgets the phones of anyone who is no longer a waiter of that restaurant, at the next event', async () => {
    await as(AMAR, () => subscribe(PHONE, L));
    await as(LEJLA, () => subscribe('https://fcm.googleapis.com/fcm/send/lejla-phone', L));
    // Edin is switched off, not removed: he keeps his row, and so his phone.
    await db.query(
      `INSERT INTO public.staff_push_subscriptions(user_id, venue_id, endpoint, keys)
       VALUES ($1, $2, 'https://fcm.googleapis.com/fcm/send/edin-phone', $3)`, [GONE, L, JSON.stringify(KEYS)]);
    // Lejla is removed in Admin → Waiters. Nothing else takes her phone away.
    await db.query(`DELETE FROM public.waiters WHERE id = $1`, [W_LEJLA]);
    expect(await phones()).toHaveLength(3);

    await db.query(`SELECT public.staff_push_claim('orders', gen_random_uuid())`);
    expect((await phones()).map((p) => p.user_id).sort()).toEqual([AMAR, GONE].sort());
    // And the event itself was still claimed once.
    const again = async () => (await db.query<{ ok: boolean }>(
      `SELECT public.staff_push_claim('orders', 'e0000000-0000-0000-0000-0000000000fe') AS ok`)).rows[0].ok;
    expect(await again()).toBe(true);
    expect(await again()).toBe(false);
  });

  it('keeps the waiter as a plain id: no reference to the sign-in table', async () => {
    // Lovable's schema rule: only profiles and user_roles may reference auth.users. It stopped
    // the first version of this migration at exactly that line.
    const { rows } = await db.query<{ refs: string }>(
      `SELECT confrelid::regclass::text AS refs FROM pg_constraint
        WHERE conrelid IN ('public.staff_push_subscriptions'::regclass, 'public.staff_push_sent'::regclass) AND contype = 'f'`);
    expect(rows.map((r) => r.refs)).toEqual(['venues']);
    const sql = readFileSync(resolve(__dirname, '..', 'migrations', '20261112090000_staff_push.sql'), 'utf8');
    expect(sql).not.toMatch(/references\s+auth\./i);
  });

  it('knows today\'s rota at one restaurant, and when the trading day began', async () => {
    await db.exec(`
      INSERT INTO public.section_assignments(section_id, waiter_id, shift_date, venue_id) VALUES
        ('${SEC_L}', '${W_AMAR}', public.business_day(), '${L}'),
        ('${SEC_L}', '${W_LEJLA}', public.business_day() - 1, '${L}'),
        ('${SEC_V}', '${W_GIULIA}', public.business_day(), '${V}');
    `);
    const shift = async (venue: string) => (await db.query<{ s: { rota: string[]; day_start: string } }>(
      `SELECT public.staff_push_shift($1) AS s`, [venue])).rows[0].s;
    expect((await shift(L)).rota).toEqual([W_AMAR]);
    expect((await shift(V)).rota).toEqual([W_GIULIA]);
    const { rows } = await db.query<{ same: boolean }>(
      `SELECT ($1::timestamptz = (SELECT starts_at FROM public.business_day_range(public.business_day()))) AS same`,
      [(await shift(L)).day_start]);
    expect(rows[0].same).toBe(true);
  });

  it('are not for waiters, guests or anyone else', async () => {
    for (const user of [AMAR, null]) {
      await expect(as(user, () => db.query(`SELECT public.staff_push_claim('orders', gen_random_uuid())`))).rejects.toThrow(/permission denied/);
      await expect(as(user, () => db.query(`SELECT public.staff_push_shift($1)`, [L]))).rejects.toThrow(/permission denied/);
      await expect(as(user, () => db.query(`SELECT * FROM public.staff_push_sent`))).rejects.toThrow(/permission denied/);
    }
  });
});

describe('the moment a guest orders, calls or asks for the bill', () => {
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
  const sent = async () => (await db.query<{ url: string; body: { table: string; id: string } }>(
    `SELECT url, body FROM net.sent`)).rows;

  const guestOrders = async (method = 'cash') => (await db.query<{ r: { order_id: string } }>(
    `SELECT public.guest_place_order($1, 'tok-l', 'Amina', $2, $3::jsonb, 0) AS r`,
    [S_L, method, JSON.stringify([{ menu_item_id: DISH_L, quantity: 2 }])])).rows[0].r.order_id;

  it('queues one call to notify-staff naming the order, and nothing else', async () => {
    await installPgNet();
    const order = await guestOrders();
    expect(await sent()).toEqual([{
      url: 'https://jgxnvrrphxnmzongtmzs.supabase.co/functions/v1/notify-staff',
      body: { table: 'orders', id: order },
    }]);
  });

  it('does the same for a waiter call and a bill request', async () => {
    await installPgNet();
    const call = (await db.query<{ id: string }>(`INSERT INTO public.waiter_calls(table_session_id) VALUES ($1) RETURNING id`, [S_L])).rows[0].id;
    const bill = (await db.query<{ id: string }>(`INSERT INTO public.bill_requests(table_session_id) VALUES ($1) RETURNING id`, [S_L])).rows[0].id;
    expect((await sent()).map((s) => s.body)).toEqual([{ table: 'waiter_calls', id: call }, { table: 'bill_requests', id: bill }]);
  });

  it('a card order rings once it is paid, not when the guest starts paying or the card is declined', async () => {
    await installPgNet();
    await db.exec(`UPDATE public.restaurant_settings SET online_card_enabled = true`);
    /** Monri's answer, the way monri-webhook hands it over. */
    const monri = async (order: string, status: string) => {
      const { rows } = await db.query<{ a: { monri_order_number: string } }>(
        `SELECT public.monri_register_attempt($1, $2, 'tok-l', 'BAM', 'purchase') AS a`, [order, S_L]);
      await db.query(`SELECT public.monri_apply_callback($1, $2, 'pay_1', $3, 2400, 'BAM', '{}'::jsonb)`,
        [`evt-${status}-${order}`, rows[0].a.monri_order_number, status]);
    };

    const declined = await guestOrders('card');
    await monri(declined, 'declined');
    expect((await db.query<{ status: string }>(`SELECT status FROM public.orders WHERE id = $1`, [declined])).rows[0].status).toBe('payment_failed');
    expect(await sent()).toEqual([]);

    const paid = await guestOrders('card');
    expect(await sent()).toEqual([]);
    await monri(paid, 'approved');
    expect((await sent()).map((s) => s.body)).toEqual([{ table: 'orders', id: paid }]);
    // Moving on through the kitchen is not news.
    await db.query(`UPDATE public.orders SET status = 'confirmed' WHERE id = $1`, [paid]);
    expect(await sent()).toHaveLength(1);
  });

  it('never stops an order: without pg_net, or with pg_net failing, the guest\'s order goes in', async () => {
    const first = await guestOrders();
    expect((await db.query(`SELECT 1 FROM public.orders WHERE id = $1`, [first])).rows).toHaveLength(1);

    await installPgNet(true);
    const second = await guestOrders();
    expect((await db.query(`SELECT 1 FROM public.orders WHERE id = $1`, [second])).rows).toHaveLength(1);
    expect((await db.query(`SELECT 1 FROM public.order_items WHERE order_id = $1`, [second])).rows).toHaveLength(1);
  });
});
