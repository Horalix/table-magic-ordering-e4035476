/**
 * @vitest-environment node
 *
 * "Free every table before a demo or rehearsal" (docs/operations-runbook.md §9).
 *
 * The SQL is read from the runbook itself, so what is tested is what gets
 * pasted into Lovable, and it runs as an ordinary role that owns the schema —
 * the way it runs on the live database, where nobody is signed in and the
 * order-integrity trigger is watching.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
// @ts-expect-error -- plain JS harness, no types needed
import { createTestDatabase } from '../../scripts/db-harness.mjs';
import { HAND_OVER } from './harness/hand-over';

type Db = {
  query: <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<{ rows: T[] }>;
  exec: (sql: string) => Promise<unknown>;
  close: () => Promise<void>;
};

const runbook = readFileSync(resolve(__dirname, '../../docs/operations-runbook.md'), 'utf8');
const section = runbook.slice(runbook.indexOf('### Free every table before a demo or rehearsal'));
const sql = section.slice(section.indexOf('```sql') + 6, section.indexOf('```', section.indexOf('```sql') + 6));
const preview = sql.slice(sql.indexOf('-- 1.'), sql.indexOf('-- 2.'));
const reset = sql.slice(sql.indexOf('DO $reset$'), sql.indexOf('$reset$;') + '$reset$;'.length);

const T7 = 'dddddddd-0000-0000-0000-000000000007';
const T8 = 'dddddddd-0000-0000-0000-000000000008';
const T9 = 'dddddddd-0000-0000-0000-000000000009';
const S7 = 'eeeeeeee-eeee-eeee-eeee-eeeeeeee0007';
const S8 = 'eeeeeeee-eeee-eeee-eeee-eeeeeeee0008';
const S9 = 'eeeeeeee-eeee-eeee-eeee-eeeeeeee0009';

let db: Db;

beforeAll(async () => {
  db = await createTestDatabase({ quiet: true });
  await db.exec(`
    INSERT INTO public.tables(id, table_number) VALUES ('${T7}', 7), ('${T8}', 8), ('${T9}', 9);
    INSERT INTO public.table_sessions(id, table_id, token, is_active, guest_name, last_heartbeat_at, closed_at) VALUES
      ('${S7}', '${T7}', 'tok-7', true, 'Amina', now(), NULL),
      ('${S8}', '${T8}', 'tok-8', true, 'Haris', now(), NULL),
      ('${S9}', '${T9}', 'tok-9', true, 'Old', now(), NULL);
    -- Table 7: a held order nobody confirmed, and one that was served but never paid.
    INSERT INTO public.orders(id, table_session_id, total, status, payment_status, payment_method, held_reason) VALUES
      ('aaaaaaaa-0000-0000-0000-000000000071', '${S7}', 70, 'pending', 'unpaid', 'cash', 'large_first_order');
    INSERT INTO public.orders(id, table_session_id, total, status, payment_status, payment_method, released_to_kitchen_at, served_at) VALUES
      ('aaaaaaaa-0000-0000-0000-000000000072', '${S7}', 12, 'served', 'unpaid', 'cash', now(), now());
    -- Table 8: paid. Money records are never touched.
    INSERT INTO public.orders(id, table_session_id, total, status, payment_status, payment_method, released_to_kitchen_at, served_at, paid_at) VALUES
      ('aaaaaaaa-0000-0000-0000-000000000081', '${S8}', 9, 'served', 'paid', 'cash', now(), now(), now());
    -- Yesterday's closed table 9 still has an unpaid order: not this reset's business.
    INSERT INTO public.orders(id, table_session_id, total, status, payment_status, payment_method, released_to_kitchen_at) VALUES
      ('aaaaaaaa-0000-0000-0000-000000000091', '${S9}', 5, 'pending', 'unpaid', 'cash', now() - interval '1 day');
    UPDATE public.table_sessions SET is_active = false, closed_at = now() - interval '1 day' WHERE id = '${S9}';
    INSERT INTO public.waiter_calls(table_session_id) VALUES ('${S7}');
    INSERT INTO public.bill_requests(table_session_id) VALUES ('${S8}');
  `);
  await db.exec(HAND_OVER);
  await db.exec('SET ROLE migrator');
}, 180_000);

afterAll(async () => {
  await db.exec('RESET ROLE');
  await db.close();
});

const orders = async () => Object.fromEntries((await db.query<{ id: string; status: string; payment_status: string; cancel_reason: string | null }>(
  `SELECT id, status::text, payment_status, cancel_reason FROM public.orders ORDER BY id`)).rows.map((r) => [r.id.slice(-2), r]));

describe('freeing every table for a demo', () => {
  it('previews what it will do, then frees the open tables and cancels only their unpaid orders', async () => {
    expect(preview).toContain('open_tables');
    expect(reset).toContain('Demo reset');

    const before = (await db.query<Record<string, unknown>>(preview)).rows[0];
    expect(Object.fromEntries(Object.entries(before).map(([k, v]) => [k, Number(v)])))
      .toEqual({ open_tables: 2, unpaid_orders_to_cancel: 2, paid_orders_left_alone: 1 });

    await db.exec(reset);

    const o = await orders();
    expect(o['71']).toMatchObject({ status: 'cancelled', cancel_reason: 'Demo reset' });
    expect(o['72']).toMatchObject({ status: 'cancelled', cancel_reason: 'Demo reset' });
    expect(o['81']).toMatchObject({ status: 'served', payment_status: 'paid', cancel_reason: null });
    expect(o['91']).toMatchObject({ status: 'pending', cancel_reason: null });

    const open = (await db.query<{ n: unknown }>(`SELECT count(*) AS n FROM public.table_sessions WHERE is_active`)).rows[0];
    expect(Number(open.n)).toBe(0);
    const alerts = (await db.query<{ n: string }>(
      `SELECT (SELECT count(*) FROM public.waiter_calls WHERE status <> 'resolved')
            + (SELECT count(*) FROM public.bill_requests WHERE status <> 'resolved') AS n`)).rows[0];
    expect(Number(alerts.n)).toBe(0);
  });

  it('is harmless to run twice', async () => {
    await db.exec(reset);
    expect((await orders())['81']).toMatchObject({ status: 'served', payment_status: 'paid' });
  });
});
