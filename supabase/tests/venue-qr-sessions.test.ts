/**
 * @vitest-environment node
 *
 * One venue QR, a typed table number, and a session that ends with the visit.
 *
 * The behaviour these lock down:
 *   - a current venue token opens a session at any real table
 *   - an old or wrong token opens nothing
 *   - rotating the venue code kills every printed one immediately
 *   - a session that has gone quiet is over, so the next visit starts by
 *     asking which table they are at — which is the whole point, because they
 *     will not be sitting where they sat last time
 */
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
// @ts-expect-error -- plain JS harness, no types needed
import { createTestDatabase, actAs } from '../../scripts/db-harness.mjs';

type Db = {
  query: <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<{ rows: T[] }>;
  exec: (sql: string) => Promise<unknown>;
  close: () => Promise<void>;
};

let db: Db;

const ADMIN = '11111111-1111-1111-1111-111111111111';
const STAFF = '22222222-2222-2222-2222-222222222222';
const BURGER = 'cccccccc-0000-0000-0000-000000000001';
const TABLE_7_TOKEN = 'per-table-token-7';

async function seed() {
  await db.exec(`
    TRUNCATE public.suggestion_conversions, public.suggestion_stats, public.menu_item_affinity,
             public.analytics_events, public.menu_item_recommendations, public.audit_log,
             public.payment_callback_events, public.payment_transactions,
             public.order_ticket_events, public.order_items, public.orders,
             public.session_join_requests, public.table_sessions, public.tables,
             public.menu_items, public.subcategories, public.categories,
             public.order_code_counters
      RESTART IDENTITY CASCADE;
    DELETE FROM public.user_roles;
    DELETE FROM auth.users;

    UPDATE public.restaurant_settings
       SET ordering_enabled = true, online_card_enabled = false,
           venue_qr_token = 'venue-token-current',
           session_idle_timeout_minutes = 180
     WHERE id = 1;

    INSERT INTO auth.users(id, email) VALUES
      ('${ADMIN}', 'admin@lasoul.test'), ('${STAFF}', 'staff@lasoul.test');
    INSERT INTO public.user_roles(user_id, role) VALUES
      ('${ADMIN}', 'admin'), ('${STAFF}', 'staff');

    INSERT INTO public.categories(id, name, sort_order)
      VALUES ('aaaaaaaa-0000-0000-0000-000000000001', 'Food', 1);
    INSERT INTO public.subcategories(id, category_id, name, sort_order)
      VALUES ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'Burgers', 1);
    INSERT INTO public.menu_items(id, subcategory_id, name, price, is_available)
      VALUES ('${BURGER}', 'bbbbbbbb-0000-0000-0000-000000000001', 'La Soul Burger', 18.00, true);

    INSERT INTO public.tables(id, table_number, qr_token) VALUES
      ('dddddddd-0000-0000-0000-000000000001', 7, '${TABLE_7_TOKEN}'),
      ('dddddddd-0000-0000-0000-000000000002', 12, 'per-table-token-12');
  `);
  await actAs(db, null);
}

const start = async (table: number, token: string, client = 'phone-a', name = 'Amina') => {
  const { rows } = await db.query<{ result: Record<string, unknown> }>(
    `SELECT public.guest_start_table_session($1, $2, $3, $4) AS result`, [table, token, client, name]);
  return rows[0].result;
};

const inspect = async (table: number, token: string, client = 'phone-a') => {
  const { rows } = await db.query<{ result: Record<string, unknown> }>(
    `SELECT public.guest_inspect_table($1, $2, $3) AS result`, [table, token, client]);
  return rows[0].result;
};

const resume = async (sessionId: string, token: string) => {
  const { rows } = await db.query<{ result: Record<string, unknown> }>(
    `SELECT public.guest_resume_session($1, $2) AS result`, [sessionId, token]);
  return rows[0].result;
};

/** Push a session's last heartbeat into the past. */
const ageSession = (sessionId: string, minutes: number) =>
  db.query(`UPDATE public.table_sessions SET last_heartbeat_at = now() - make_interval(mins => $2), opened_at = now() - make_interval(mins => $2) WHERE id = $1`,
    [sessionId, minutes]);

beforeAll(async () => {
  db = (await createTestDatabase({ quiet: true })) as unknown as Db;
}, 120_000);
afterAll(async () => { await db?.close(); });
beforeEach(seed);

// ---------------------------------------------------------------------------

describe('the venue QR', () => {
  it('opens a session at whichever table the guest says they are at', async () => {
    const seven = await start(7, 'venue-token-current');
    expect(seven.status).toBe('created');

    const twelve = await start(12, 'venue-token-current', 'phone-b');
    expect(twelve.status).toBe('created');
  });

  it('is reported valid before the guest is asked to type anything', async () => {
    const { rows } = await db.query<{ result: Record<string, unknown> }>(
      `SELECT public.guest_check_venue_token('venue-token-current') AS result`);
    expect(rows[0].result.valid).toBe(true);
    expect(rows[0].result.max_table_number).toBe(12);
  });

  it('rejects a token that is not the current one', async () => {
    const { rows } = await db.query<{ result: Record<string, unknown> }>(
      `SELECT public.guest_check_venue_token('venue-token-old') AS result`);
    expect(rows[0].result.valid).toBe(false);

    expect((await start(7, 'venue-token-old')).status).toBe('invalid');
    expect((await inspect(7, 'venue-token-old')).status).toBe('invalid');
  });

  it('rejects an empty token rather than matching everything', async () => {
    expect((await start(7, '')).status).toBe('invalid');
  });

  it('rejects a table number that does not exist', async () => {
    expect((await start(99, 'venue-token-current')).status).toBe('invalid');
  });

  it('still accepts a per-table sticker token', async () => {
    expect((await start(7, TABLE_7_TOKEN)).status).toBe('created');
  });

  it('does not let one table’s sticker open another table', async () => {
    expect((await start(12, TABLE_7_TOKEN)).status).toBe('invalid');
  });
});

describe('rotating the code', () => {
  it('kills every printed code immediately', async () => {
    await actAs(db, ADMIN);
    const { rows } = await db.query<{ rotate_venue_qr_token: string }>(
      `SELECT public.rotate_venue_qr_token() AS rotate_venue_qr_token`);
    await actAs(db, null);

    const fresh = rows[0].rotate_venue_qr_token;
    expect(fresh).not.toBe('venue-token-current');

    expect((await start(7, 'venue-token-current')).status).toBe('invalid');
    expect((await start(7, fresh)).status).toBe('created');
  });

  it('is a manager decision, not a staff one', async () => {
    await actAs(db, STAFF);
    await expect(db.query(`SELECT public.rotate_venue_qr_token()`)).rejects.toThrow(/manager/i);
    await actAs(db, null);
  });

  it('records the rotation in the audit log', async () => {
    await actAs(db, ADMIN);
    await db.query(`SELECT public.rotate_venue_qr_token()`);
    const { rows } = await db.query<{ action: string }>(
      `SELECT action FROM public.audit_log ORDER BY created_at DESC LIMIT 1`);
    await actAs(db, null);
    expect(rows[0].action).toBe('qr.venue_rotated');
  });

  it('rotates a single table sticker without touching the others', async () => {
    await actAs(db, ADMIN);
    await db.query(`SELECT public.rotate_table_qr_token('dddddddd-0000-0000-0000-000000000001')`);
    await actAs(db, null);

    expect((await start(7, TABLE_7_TOKEN)).status).toBe('invalid');
    expect((await start(12, 'per-table-token-12', 'phone-b')).status).toBe('created');
  });
});

describe('a session ends with the visit', () => {
  it('resumes silently while the guest is still there', async () => {
    const session = await start(7, 'venue-token-current');
    const result = await resume(session.session_id as string, session.session_token as string);

    expect(result.status).toBe('active');
    expect(result.table_number).toBe(7);
  });

  it('is over once it has gone quiet for the configured time', async () => {
    const session = await start(7, 'venue-token-current');
    await ageSession(session.session_id as string, 200); // timeout is 180

    const result = await resume(session.session_id as string, session.session_token as string);
    expect(result.status).toBe('expired');
  });

  it('refuses an order on an expired session, so no stale table reaches the kitchen', async () => {
    const session = await start(7, 'venue-token-current');
    await ageSession(session.session_id as string, 200);

    await expect(db.query(
      `SELECT public.guest_place_order($1, $2, 'Amina', 'cash', $3::jsonb, 0)`,
      [session.session_id, session.session_token, JSON.stringify([{ menu_item_id: BURGER, quantity: 1 }])],
    )).rejects.toThrow(/Invalid or expired table session/i);
  });

  it('will not let an expired session revive itself with a heartbeat', async () => {
    const session = await start(7, 'venue-token-current');
    await ageSession(session.session_id as string, 200);

    const { rows } = await db.query<{ touch_session: boolean }>(
      `SELECT public.touch_session($1, $2) AS touch_session`,
      [session.session_id, session.session_token]);
    expect(rows[0].touch_session).toBe(false);
  });

  it('starts a brand-new session when the guest returns to the same table', async () => {
    const first = await start(7, 'venue-token-current');
    await ageSession(first.session_id as string, 200);

    // Same phone, same table, next visit.
    const second = await start(7, 'venue-token-current');
    expect(second.status).toBe('created');
    expect(second.session_id).not.toBe(first.session_id);
  });

  it('closes the abandoned session rather than leaving the table looking occupied', async () => {
    const first = await start(7, 'venue-token-current');
    await ageSession(first.session_id as string, 200);
    await start(7, 'venue-token-current');

    const { rows } = await db.query<{ is_active: boolean }>(
      `SELECT is_active FROM public.table_sessions WHERE id = $1`, [first.session_id]);
    expect(rows[0].is_active).toBe(false);
  });

  it('does not treat a stale session as occupied when someone else sits down', async () => {
    const first = await start(7, 'venue-token-current', 'phone-a');
    await ageSession(first.session_id as string, 200);

    // A different phone at the same table should host, not ask to join.
    const second = await inspect(7, 'venue-token-current', 'phone-b');
    expect(second.status).toBe('empty');
  });

  it('still asks a second phone to join a LIVE session', async () => {
    await start(7, 'venue-token-current', 'phone-a');
    const second = await inspect(7, 'venue-token-current', 'phone-b');
    expect(second.status).toBe('join_required');
  });

  it('reports an unknown or closed session distinctly', async () => {
    const session = await start(7, 'venue-token-current');
    expect((await resume('eeeeeeee-9999-9999-9999-999999999999', 'nope')).status).toBe('unknown');

    await db.query(`UPDATE public.table_sessions SET is_active = false WHERE id = $1`, [session.session_id]);
    expect((await resume(session.session_id as string, session.session_token as string)).status).toBe('closed');
  });

  it('does not resume on a wrong token', async () => {
    const session = await start(7, 'venue-token-current');
    expect((await resume(session.session_id as string, 'wrong-token')).status).toBe('unknown');
  });

  it('sweeps abandoned sessions for the floor view', async () => {
    const a = await start(7, 'venue-token-current', 'phone-a');
    await start(12, 'venue-token-current', 'phone-b');
    await ageSession(a.session_id as string, 500);

    await actAs(db, STAFF);
    const { rows } = await db.query<{ close_stale_sessions: number }>(
      `SELECT public.close_stale_sessions() AS close_stale_sessions`);
    await actAs(db, null);

    expect(rows[0].close_stale_sessions).toBe(1);
  });
});

describe('the ordering flow still works end to end on a venue token', () => {
  it('takes an order at the typed table and sends it to the kitchen', async () => {
    const session = await start(7, 'venue-token-current');

    const { rows } = await db.query<{ result: Record<string, unknown> }>(
      `SELECT public.guest_place_order($1, $2, 'Amina', 'cash', $3::jsonb, 0) AS result`,
      [session.session_id, session.session_token, JSON.stringify([{ menu_item_id: BURGER, quantity: 1 }])],
    );

    expect(rows[0].result.status).toBe('pending');
    expect(Number(rows[0].result.total)).toBe(18);

    const { rows: table } = await db.query<{ table_number: number }>(`
      SELECT t.table_number
        FROM public.orders o
        JOIN public.table_sessions s ON s.id = o.table_session_id
        JOIN public.tables t ON t.id = s.table_id
       WHERE o.id = $1
    `, [rows[0].result.order_id]);
    expect(table[0].table_number).toBe(7);
  });
});
