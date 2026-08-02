/**
 * @vitest-environment node
 *
 * Pairs learned across a whole visit, and social proof that is true.
 *
 * The load-bearing test is `learns a pair split across two rounds` — that
 * relationship is invisible to the order-grain table, and it is exactly the
 * one the after-meal prompt depends on.
 */
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
// @ts-expect-error -- plain JS harness, no types needed
import { createTestDatabase, actAs } from '../../scripts/db-harness.mjs';

type Db = {
  query: <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<{ rows: T[] }>;
  exec: (sql: string) => Promise<unknown>;
  close: () => Promise<void>;
};

const STAFF = '22222222-2222-2222-2222-222222222222';
const STEAK = 'cccccccc-cccc-cccc-cccc-cccccccc0001';
const COFFEE = 'cccccccc-cccc-cccc-cccc-cccccccc0003';
const CAKE = 'cccccccc-cccc-cccc-cccc-cccccccc0004';
const TABLE = 'dddddddd-0000-0000-0000-000000000001';

let db: Db;

async function seed() {
  await db.exec(`
    TRUNCATE public.audit_log, public.session_item_affinity, public.menu_item_affinity,
             public.recommendation_impressions, public.recommendation_decisions,
             public.session_experiment_assignment, public.experiments,
             public.suggestion_conversions, public.suggestion_stats, public.analytics_events,
             public.menu_item_recommendations, public.order_ticket_events, public.order_items,
             public.orders, public.table_sessions, public.tables,
             public.menu_items, public.subcategories, public.categories, public.order_code_counters
      RESTART IDENTITY CASCADE;
    DELETE FROM public.user_roles;
    DELETE FROM auth.users;

    UPDATE public.restaurant_settings
       SET recommendations_enabled = true, reco_holdout_pct = 0, reco_exploration = 0,
           social_proof_min_sessions = 20
     WHERE id = 1;

    INSERT INTO auth.users(id) VALUES ('${STAFF}');
    INSERT INTO public.user_roles(user_id, role) VALUES ('${STAFF}', 'admin'), ('${STAFF}', 'staff');

    INSERT INTO public.categories(id, name, sort_order) VALUES
      ('aaaaaaaa-0000-0000-0000-000000000001', 'Food', 1);
    INSERT INTO public.subcategories(id, category_id, name, sort_order) VALUES
      ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'Mains', 1),
      ('bbbbbbbb-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', 'Sweet', 2),
      ('bbbbbbbb-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000001', 'Hot', 3);

    INSERT INTO public.menu_items(id, subcategory_id, name, price, is_available, station, meal_role) VALUES
      ('${STEAK}',  'bbbbbbbb-0000-0000-0000-000000000001', 'Steak',   30.00, true, 'kitchen', 'main'),
      ('${CAKE}',   'bbbbbbbb-0000-0000-0000-000000000002', 'Cake',     8.00, true, 'kitchen', 'dessert'),
      ('${COFFEE}', 'bbbbbbbb-0000-0000-0000-000000000003', 'Espresso', 3.00, true, 'bar',     'hot_drink');

    INSERT INTO public.tables(id, table_number) VALUES ('${TABLE}', 7);
  `);
  await db.exec(`ALTER TABLE public.orders DISABLE TRIGGER trg_enforce_order_limits`);
  await actAs(db, null);
}

/**
 * A completed visit, as N separate rounds.
 *
 * `rounds` is the point: [[STEAK], [CAKE]] is two orders in one session, which
 * order-grain affinity cannot see as a pair and visit-grain affinity can.
 */
async function visit(rounds: string[][]) {
  const session = crypto.randomUUID();
  await db.query(
    `INSERT INTO public.table_sessions(id, table_id, token, is_active, last_heartbeat_at)
     VALUES ($1, '${TABLE}', $2, false, now())`,
    [session, `v-${session.slice(0, 8)}`],
  );
  for (const items of rounds) {
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO public.orders(table_session_id, total, status, payment_status, payment_method,
                                 released_to_kitchen_at, paid_at)
       VALUES ($1, 0, 'served', 'paid', 'cash', now(), now()) RETURNING id`, [session]);
    for (const item of items) {
      await db.query(
        `INSERT INTO public.order_items(order_id, menu_item_id, quantity, unit_price, status)
         SELECT $1, id, 1, price, 'served' FROM public.menu_items WHERE id = $2`,
        [rows[0].id, item]);
    }
  }
  return session;
}

const refreshBoth = async () => {
  await actAs(db, STAFF);
  await db.query(`SELECT public.refresh_menu_affinity(90, 1)`);
  await db.query(`SELECT public.refresh_session_affinity(90, 1)`);
  await actAs(db, null);
};

const evidence = async (a: string, b: string) => {
  const { rows } = await db.query<{ result: Record<string, unknown> }>(
    `SELECT public.suggestion_evidence($1, $2) AS result`, [a, b]);
  return rows[0].result;
};

beforeAll(async () => { db = (await createTestDatabase({ quiet: true })) as unknown as Db; }, 180_000);
afterAll(async () => { await db?.close(); });
beforeEach(seed);

describe('pairs across a visit', () => {
  it('learns a pair split across two rounds', async () => {
    /*
     * THE test. Steak in the first round, coffee twenty minutes later in the
     * second. Order-grain affinity never sees them together, so the after-meal
     * prompt had nothing to work from.
     */
    for (let i = 0; i < 6; i += 1) await visit([[STEAK], [COFFEE]]);
    await refreshBoth();

    const { rows: order } = await db.query(
      `SELECT 1 FROM public.menu_item_affinity WHERE item_a = $1 AND item_b = $2`, [STEAK, COFFEE]);
    const { rows: session } = await db.query<{ pair_sessions: number }>(
      `SELECT pair_sessions FROM public.session_item_affinity WHERE item_a = $1 AND item_b = $2`,
      [STEAK, COFFEE]);

    expect(order).toHaveLength(0);          // invisible at order grain
    expect(session[0].pair_sessions).toBe(6); // visible at visit grain
  });

  it('still learns same-round pairs at order grain', async () => {
    // The order-level table is not replaced; it answers a different question,
    // and it is the right one for the cart.
    for (let i = 0; i < 6; i += 1) await visit([[STEAK, COFFEE]]);
    await refreshBoth();

    const { rows } = await db.query(
      `SELECT 1 FROM public.menu_item_affinity WHERE item_a = $1 AND item_b = $2`, [STEAK, COFFEE]);
    expect(rows).toHaveLength(1);
  });

  it('says nothing at all on thin history', async () => {
    for (let i = 0; i < 3; i += 1) await visit([[STEAK], [COFFEE]]);
    await refreshBoth();
    const { rows } = await db.query(`SELECT 1 FROM public.session_item_affinity`);
    expect(rows).toHaveLength(0);
  });

  it('feeds the after-meal ranking', async () => {
    for (let i = 0; i < 8; i += 1) await visit([[STEAK], [CAKE]]);
    await refreshBoth();

    // A live table that has just had the steak.
    const live = crypto.randomUUID();
    await db.query(
      `INSERT INTO public.table_sessions(id, table_id, token, is_active, last_heartbeat_at)
       VALUES ($1, '${TABLE}', 'live', true, now())`, [live]);
    const { rows: o } = await db.query<{ id: string }>(
      `INSERT INTO public.orders(table_session_id, total, status, payment_status, payment_method,
                                 released_to_kitchen_at)
       VALUES ($1, 30, 'served', 'unpaid', 'cash', now()) RETURNING id`, [live]);
    await db.query(
      `INSERT INTO public.order_items(order_id, menu_item_id, quantity, unit_price, status, served_at)
       VALUES ($1, $2, 1, 30, 'served', now() - interval '20 minutes')`, [o.rows?.[0]?.id ?? o[0].id, STEAK]);

    const { rows } = await db.query<{ id: string }>(
      `SELECT id FROM public.rank_recommendations('{}'::uuid[], 'after_meal', 'en', 8, $1::uuid, '{}'::text[])`,
      [live]);
    expect(rows.map((r) => r.id)).toContain(CAKE);
  });
});

describe('the Wilson bound', () => {
  it('refuses to call four out of four a certainty', async () => {
    const { rows } = await db.query<{ low: number }>(
      `SELECT public.wilson_lower(4, 4) AS low`);
    // The point estimate is 100%. What the data supports is far less.
    expect(Number(rows[0].low)).toBeLessThan(0.6);
  });

  it('tightens as evidence accumulates', async () => {
    const { rows } = await db.query<{ small: number; large: number }>(
      `SELECT public.wilson_lower(8, 10) AS small, public.wilson_lower(800, 1000) AS large`);
    expect(Number(rows[0].large)).toBeGreaterThan(Number(rows[0].small));
  });

  it('is zero with no trials', async () => {
    const { rows } = await db.query<{ low: number }>(`SELECT public.wilson_lower(0, 0) AS low`);
    expect(Number(rows[0].low)).toBe(0);
  });
});

describe('social proof says only what was measured', () => {
  it('stays qualitative below the support threshold', async () => {
    // Mixed visits, so P(coffee) < 1 and the pairing carries real signal.
    // With coffee in every visit, lift collapses to 1.0 and the correct
    // answer is "say nothing" — which the last test in this block asserts.
    for (let i = 0; i < 6; i += 1) await visit([[STEAK], [COFFEE]]);
    for (let i = 0; i < 4; i += 1) await visit([[CAKE]]);
    await refreshBoth();

    const e = await evidence(STEAK, COFFEE);
    expect(e.kind).toBe('qualitative');
    expect(e.percent).toBeUndefined();
  });

  it('quotes a number once there is enough of it', async () => {
    await db.exec(`UPDATE public.restaurant_settings SET social_proof_min_sessions = 20 WHERE id = 1`);
    for (let i = 0; i < 30; i += 1) await visit([[STEAK], [COFFEE]]);
    for (let i = 0; i < 20; i += 1) await visit([[CAKE]]);
    await refreshBoth();

    const e = await evidence(STEAK, COFFEE);
    expect(e.kind).toBe('quantified');
    expect(Number(e.percent)).toBeGreaterThan(50);
  });

  it('quotes the conservative bound, not the point estimate', async () => {
    // 30 of 30 visits. The point estimate is 100%; what gets shown is less,
    // because a claim printed in front of a guest should survive being wrong.
    await db.exec(`UPDATE public.restaurant_settings SET social_proof_min_sessions = 20 WHERE id = 1`);
    for (let i = 0; i < 30; i += 1) await visit([[STEAK], [COFFEE]]);
    for (let i = 0; i < 20; i += 1) await visit([[CAKE]]);
    await refreshBoth();

    const e = await evidence(STEAK, COFFEE);
    expect(Number(e.percent)).toBeLessThan(100);
  });

  it('says nothing about a pair it has never seen', async () => {
    expect((await evidence(STEAK, CAKE)).kind).toBe('none');
  });

  it('says nothing when the pairing is not better than chance', async () => {
    // Both items in every visit: confidence is 1.0 but lift is 1.0 too, so the
    // pairing carries no information and no claim should be made.
    for (let i = 0; i < 30; i += 1) await visit([[STEAK, COFFEE]]);
    await refreshBoth();
    expect((await evidence(STEAK, COFFEE)).kind).toBe('none');
  });
});
