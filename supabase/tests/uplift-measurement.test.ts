/**
 * @vitest-environment node
 *
 * Whether the money number can be believed.
 *
 * Two of these tests exist because the previous implementation failed exactly
 * this way and nothing caught it: the experiment silently re-bucketed its own
 * history when someone moved the holdout dial, and "reliable" meant "we
 * counted to a hundred" rather than "the effect is real".
 *
 * A dashboard that overstates once is never believed again, so the bar here is
 * that it must be willing to say "we do not know yet".
 */
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
// @ts-expect-error -- plain JS harness, no types needed
import { createTestDatabase, actAs } from '../../scripts/db-harness.mjs';

type Db = {
  query: <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<{ rows: T[] }>;
  exec: (sql: string) => Promise<unknown>;
  close: () => Promise<void>;
};

const ADMIN = '11111111-1111-1111-1111-111111111111';
const STAFF = '22222222-2222-2222-2222-222222222222';
const BURGER = 'cccccccc-cccc-cccc-cccc-cccccccc0001';
const TABLE = 'dddddddd-0000-0000-0000-000000000001';

let db: Db;

async function seed() {
  await db.exec(`
    TRUNCATE public.audit_log, public.analytics_events, public.suggestion_conversions,
             public.suggestion_stats, public.order_ticket_events, public.order_items,
             public.orders, public.table_sessions, public.tables,
             public.menu_items, public.subcategories, public.categories, public.order_code_counters
      RESTART IDENTITY CASCADE;
    DELETE FROM public.user_roles;
    DELETE FROM auth.users;

    UPDATE public.restaurant_settings SET reco_holdout_pct = 0 WHERE id = 1;

    INSERT INTO auth.users(id) VALUES ('${ADMIN}'), ('${STAFF}');
    INSERT INTO public.user_roles(user_id, role) VALUES ('${ADMIN}', 'admin'), ('${STAFF}', 'staff');

    INSERT INTO public.categories(id, name, sort_order) VALUES ('aaaaaaaa-0000-0000-0000-000000000001', 'Food', 1);
    INSERT INTO public.subcategories(id, category_id, name, sort_order)
      VALUES ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'Mains', 1);
    INSERT INTO public.menu_items(id, subcategory_id, name, price, is_available, station)
      VALUES ('${BURGER}', 'bbbbbbbb-0000-0000-0000-000000000001', 'Burger', 20.00, true, 'kitchen');

    INSERT INTO public.tables(id, table_number) VALUES ('${TABLE}', 7);
  `);
  // These tests write hundreds of historical orders to exercise the
  // statistics; the per-session rate limit is a different concern.
  await db.exec(`ALTER TABLE public.orders DISABLE TRIGGER trg_enforce_order_limits`);
  await actAs(db, null);
}

/**
 * A completed, paid order in a given group, with a chosen total.
 *
 * Written directly rather than through guest_place_order so the test controls
 * the group and the value — the statistics are what is under test, not the
 * ordering flow.
 */
async function order(opts: { total: number; holdout: boolean; covers?: number | null; daysAgo?: number }) {
  const session = crypto.randomUUID();
  await db.query(
    `INSERT INTO public.table_sessions(id, table_id, token, is_active, covers, opened_at, last_heartbeat_at)
     VALUES ($1, '${TABLE}', $2, true, $3, now() - make_interval(days => $4), now())`,
    [session, `tok-${session.slice(0, 8)}`, opts.covers ?? null, opts.daysAgo ?? 0],
  );
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO public.orders(table_session_id, total, status, payment_status, payment_method,
                               released_to_kitchen_at, created_at, reco_holdout, paid_at)
     VALUES ($1, $2, 'served', 'paid', 'cash', now(), now() - make_interval(days => $3), $4, now())
     RETURNING id`,
    [session, opts.total, opts.daysAgo ?? 0, opts.holdout],
  );
  return rows[0].id;
}

const comparison = async (days = 30) => {
  await actAs(db, STAFF);
  const { rows } = await db.query<{ result: Record<string, unknown> }>(
    `SELECT public.reco_holdout_comparison($1) AS result`, [days]);
  await actAs(db, null);
  return rows[0].result;
};

const impact = async (days = 30) => {
  await actAs(db, STAFF);
  const { rows } = await db.query<{ result: Record<string, unknown> }>(
    `SELECT public.suggestion_impact($1) AS result`, [days]);
  await actAs(db, null);
  return rows[0].result;
};

beforeAll(async () => { db = (await createTestDatabase({ quiet: true })) as unknown as Db; }, 180_000);
afterAll(async () => { await db?.close(); });
beforeEach(seed);

describe('the experiment group is recorded, not recomputed', () => {
  it('stamps the group when the order is placed', async () => {
    await db.exec(`UPDATE public.restaurant_settings SET reco_holdout_pct = 50 WHERE id = 1`);
    const session = crypto.randomUUID();
    await db.query(
      `INSERT INTO public.table_sessions(id, table_id, token, is_active) VALUES ($1, '${TABLE}', $2, true)`,
      [session, 'tok-stamp']);
    const { rows } = await db.query<{ reco_holdout: boolean | null }>(
      `INSERT INTO public.orders(table_session_id, total, status, payment_status, payment_method)
       VALUES ($1, 20, 'pending', 'unpaid', 'cash') RETURNING reco_holdout`, [session]);

    expect(rows[0].reco_holdout).not.toBeNull();
  });

  it('refuses to let the group be edited afterwards', async () => {
    const id = await order({ total: 30, holdout: false });
    await expect(db.query(`UPDATE public.orders SET reco_holdout = true WHERE id = $1`, [id]))
      .rejects.toThrow(/cannot be changed after the fact/);
  });
});

/*
 * The holdout-comparison behaviour that used to live here has moved to
 * supabase/tests/experiment-integrity.test.ts.
 *
 * It was written against the per-ORDER comparison with hash-based assignment.
 * Both were replaced: treatment is assigned per table session, so averaging
 * orders treated three rounds from one table as three independent samples and
 * could report significance that was not there. The same behaviours — too
 * early, no effect, a real effect, a harmful effect, and immunity to the
 * holdout dial — are all asserted there, at the session grain, plus SRM and
 * power which did not exist.
 */

describe('one window, one denominator', () => {
  it('counts impressions over the same period as the revenue', async () => {
    // The old version summed shown/accepted across the whole of
    // suggestion_stats — rebuilt over its own 90-day window — and presented it
    // beside revenue windowed to _days.
    await db.exec(`
      INSERT INTO public.analytics_events(visit_id, event, props, occurred_at) VALUES
        ('v1', 'suggestion_shown',    '{}'::jsonb, now() - interval '2 days'),
        ('v1', 'suggestion_accepted', '{}'::jsonb, now() - interval '2 days'),
        ('v2', 'suggestion_shown',    '{}'::jsonb, now() - interval '40 days'),
        ('v2', 'suggestion_shown',    '{}'::jsonb, now() - interval '40 days');
    `);

    const week = await impact(7);
    expect(Number(week.shown)).toBe(1);
    expect(Number(week.accepted)).toBe(1);

    const quarter = await impact(90);
    expect(Number(quarter.shown)).toBe(3);
  });

  it('reports revenue per cover, and how much of it was counted', async () => {
    await order({ total: 60, holdout: false, covers: 3 });
    await order({ total: 40, holdout: true, covers: 2 });
    await order({ total: 99, holdout: false, covers: null });

    const result = await impact();
    const perCover = result.per_cover as { orders_counted: number; with_suggestions: number; holdout: number };

    // The uncounted sitting is excluded, and the caller is told the sample size.
    expect(perCover.orders_counted).toBe(2);
    expect(Number(perCover.with_suggestions)).toBe(20);
    expect(Number(perCover.holdout)).toBe(20);
  });
});

describe('which surface earns', () => {
  it('splits acceptance and revenue by placement', async () => {
    // Rolling three different products into one "the engine earned X" hides
    // which one to invest in and which to remove.
    await db.exec(`
      INSERT INTO public.analytics_events(visit_id, event, props, occurred_at) VALUES
        ('v1', 'suggestion_shown',    '{"placement":"cart"}'::jsonb,       now()),
        ('v1', 'suggestion_shown',    '{"placement":"cart"}'::jsonb,       now()),
        ('v1', 'suggestion_accepted', '{"placement":"cart"}'::jsonb,       now()),
        ('v2', 'suggestion_shown',    '{"placement":"after_meal"}'::jsonb, now()),
        ('v2', 'suggestion_accepted', '{"placement":"after_meal"}'::jsonb, now());
    `);

    await actAs(db, STAFF);
    const { rows } = await db.query<{ placement: string; shown: number; acceptance_pct: number }>(
      `SELECT placement, shown, acceptance_pct FROM public.suggestion_impact_by_placement(30)`);
    await actAs(db, null);

    const cart = rows.find((r) => r.placement === 'cart')!;
    const after = rows.find((r) => r.placement === 'after_meal')!;
    expect(Number(cart.acceptance_pct)).toBe(50);
    expect(Number(after.acceptance_pct)).toBe(100);
  });
});

describe('access', () => {
  it('keeps the numbers to staff', async () => {
    await expect(db.query(`SELECT public.reco_holdout_comparison(30)`)).rejects.toThrow(/Only staff/);
    await expect(db.query(`SELECT public.suggestion_impact(30)`)).rejects.toThrow(/Only staff/);
    await expect(db.query(`SELECT * FROM public.suggestion_impact_by_placement(30)`)).rejects.toThrow(/Only staff/);
  });
});
