/**
 * @vitest-environment node
 *
 * Retention, scheduling, and the one number.
 *
 * The load-bearing test here is `refuses to prune inside the reporting
 * window`. Deleting analytics is not like clearing a cache — the events are
 * the only record that a guest looked at a dish and did not order it, and a
 * manager reading a year of history has no way to tell that the underlying
 * rows are gone. The charts would simply flatten.
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
    TRUNCATE public.audit_log, public.maintenance_runs, public.analytics_events,
             public.recommendation_impressions, public.recommendation_decisions,
             public.session_experiment_assignment, public.experiments,
             public.suggestion_conversions, public.suggestion_stats,
             public.order_ticket_events, public.order_items, public.orders,
             public.table_sessions, public.tables,
             public.menu_items, public.subcategories, public.categories, public.order_code_counters
      RESTART IDENTITY CASCADE;
    DELETE FROM public.user_roles;
    DELETE FROM auth.users;

    INSERT INTO auth.users(id) VALUES ('${ADMIN}'), ('${STAFF}');
    INSERT INTO public.user_roles(user_id, role) VALUES ('${ADMIN}', 'admin'), ('${STAFF}', 'staff');

    INSERT INTO public.categories(id, name, sort_order) VALUES
      ('aaaaaaaa-0000-0000-0000-000000000001', 'Food', 1);
    INSERT INTO public.subcategories(id, category_id, name, sort_order) VALUES
      ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'Mains', 1);
    INSERT INTO public.menu_items(id, subcategory_id, name, price, is_available, station) VALUES
      ('${BURGER}', 'bbbbbbbb-0000-0000-0000-000000000001', 'Burger', 20.00, true, 'kitchen');

    INSERT INTO public.tables(id, table_number) VALUES ('${TABLE}', 7);
  `);
  await db.exec(`ALTER TABLE public.orders DISABLE TRIGGER trg_enforce_order_limits`);
  await actAs(db, null);
}

const events = async () => {
  const { rows } = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM public.analytics_events`);
  return rows[0].n;
};

async function paidVisit(net: number, daysAgo = 0) {
  const session = crypto.randomUUID();
  await db.query(
    `INSERT INTO public.table_sessions(id, table_id, token, is_active, opened_at, last_heartbeat_at)
     VALUES ($1, '${TABLE}', $2, false, now() - make_interval(days => $3), now())`,
    [session, `s-${session.slice(0, 8)}`, daysAgo]);
  await db.query(
    `INSERT INTO public.orders(table_session_id, total, status, payment_status, payment_method,
                               released_to_kitchen_at, created_at, paid_at)
     VALUES ($1, $2, 'served', 'paid', 'cash', now(), now() - make_interval(days => $3), now())`,
    [session, net, daysAgo]);
  return session;
}

beforeAll(async () => { db = (await createTestDatabase({ quiet: true })) as unknown as Db; }, 180_000);
afterAll(async () => { await db?.close(); });
beforeEach(seed);

describe('retention has a floor', () => {
  it('refuses to prune inside the reporting window', async () => {
    /*
     * The important one. Asked to keep only 7 days, it keeps 120 anyway —
     * because a manager looking at a quarter of history would otherwise see
     * the charts flatten with no indication why, and the events are gone.
     */
    await db.exec(`
      INSERT INTO public.analytics_events(visit_id, event, props, occurred_at) VALUES
        ('v1', 'item_viewed', '{}'::jsonb, now() - interval '30 days'),
        ('v2', 'item_viewed', '{}'::jsonb, now() - interval '100 days');
    `);

    await actAs(db, STAFF);
    await db.query(`SELECT public.prune_analytics_events(7)`);
    await actAs(db, null);

    expect(await events()).toBe(2);
  });

  it('does remove genuinely ancient events', async () => {
    await db.exec(`
      INSERT INTO public.analytics_events(visit_id, event, props, occurred_at) VALUES
        ('v1', 'item_viewed', '{}'::jsonb, now() - interval '30 days'),
        ('v2', 'item_viewed', '{}'::jsonb, now() - interval '500 days');
    `);

    await actAs(db, STAFF);
    const { rows } = await db.query<{ n: number }>(`SELECT public.prune_analytics_events(400) AS n`);
    await actAs(db, null);

    expect(rows[0].n).toBe(1);
    expect(await events()).toBe(1);
  });

  it('never deletes a decision that a sale points at', async () => {
    // The join from revenue back to the decision is the whole value of the
    // ledger; losing it turns a measurement back into an inference.
    const session = await paidVisit(20);
    const { rows: d } = await db.query<{ id: string }>(
      `INSERT INTO public.recommendation_decisions(session_id, placement, policy_version, created_at)
       VALUES ($1, 'cart', 'v1', now() - interval '500 days') RETURNING id`, [session]);
    const { rows: o } = await db.query<{ id: string }>(
      `SELECT id FROM public.orders WHERE table_session_id = $1`, [session]);
    await db.query(
      `INSERT INTO public.suggestion_conversions(order_id, recommended_item_id, placement, line_total, decision_id)
       VALUES ($1, $2, 'cart', 3, $3)`, [o[0].id, BURGER, d[0].id]);

    await actAs(db, STAFF);
    await db.query(`SELECT public.prune_recommendation_decisions(400)`);
    await actAs(db, null);

    const { rows } = await db.query(`SELECT 1 FROM public.recommendation_decisions`);
    expect(rows).toHaveLength(1);
  });

  it('is staff-only', async () => {
    await expect(db.query(`SELECT public.prune_analytics_events(400)`)).rejects.toThrow(/Only staff/);
  });
});

describe('the daily job', () => {
  it('runs once and then declines', async () => {
    await actAs(db, STAFF);
    const { rows: first } = await db.query<{ r: { ran: boolean } }>(
      `SELECT public.run_daily_maintenance() AS r`);
    const { rows: second } = await db.query<{ r: { ran: boolean; reason: string } }>(
      `SELECT public.run_daily_maintenance() AS r`);
    await actAs(db, null);

    expect(first[0].r.ran).toBe(true);
    expect(second[0].r.ran).toBe(false);
    expect(second[0].r.reason).toBe('already_ran_today');
  });

  it('is safe to call repeatedly, which is the point', async () => {
    // It is meant to be pointed at a scheduler, or called from anywhere that
    // happens to be awake. Cheap and idempotent beats carefully orchestrated.
    await actAs(db, STAFF);
    for (let i = 0; i < 5; i += 1) await db.query(`SELECT public.run_daily_maintenance()`);
    const { rows } = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM public.maintenance_runs WHERE job = 'daily'`);
    await actAs(db, null);
    expect(rows[0].n).toBe(1);
  });

  it('records what it did', async () => {
    await actAs(db, STAFF);
    await db.query(`SELECT public.run_daily_maintenance()`);
    const { rows } = await db.query<{ last_result: { ran: boolean } }>(
      `SELECT last_result FROM public.maintenance_runs WHERE job = 'daily'`);
    await actAs(db, null);
    expect(rows[0].last_result.ran).toBe(true);
  });

  it('releases its lock even when something fails', async () => {
    // A stranded advisory lock would silently stop maintenance forever.
    await actAs(db, STAFF);
    await db.query(`SELECT public.run_daily_maintenance()`);
    const { rows } = await db.query<{ held: number }>(
      `SELECT count(*)::int AS held FROM pg_locks
        WHERE locktype = 'advisory' AND objid = (hashtext('lasoul.daily_maintenance')::bigint & 2147483647)`);
    await actAs(db, null);
    expect(rows[0].held).toBe(0);
  });
});

describe('the impact summary', () => {
  it('leads with the causal answer', async () => {
    await paidVisit(30);
    await actAs(db, STAFF);
    const { rows } = await db.query<{ r: { causal: { status: string } } }>(
      `SELECT public.app_impact_summary(30) AS r`);
    await actAs(db, null);
    expect(rows[0].r.causal.status).toBe('not_running');
  });

  it('labels attributed revenue as not causal', async () => {
    await actAs(db, STAFF);
    const { rows } = await db.query<{ r: { attributed: { is_causal: boolean } } }>(
      `SELECT public.app_impact_summary(30) AS r`);
    await actAs(db, null);
    expect(rows[0].r.attributed.is_causal).toBe(false);
  });

  it('reports net sales excluding tips', async () => {
    await db.query(
      `INSERT INTO public.table_sessions(id, table_id, token, is_active)
       VALUES ('eeeeeeee-0000-0000-0000-00000000aaaa', '${TABLE}', 'tip-test', false)`);
    await db.query(
      `INSERT INTO public.orders(table_session_id, total, tip_amount, status, payment_status,
                                 payment_method, released_to_kitchen_at, paid_at)
       VALUES ('eeeeeeee-0000-0000-0000-00000000aaaa', 30, 10, 'served', 'paid', 'cash', now(), now())`);

    await actAs(db, STAFF);
    const { rows } = await db.query<{ r: { net_sales: number } }>(
      `SELECT public.app_impact_summary(30) AS r`);
    await actAs(db, null);
    expect(Number(rows[0].r.net_sales)).toBe(20);
  });

  it('surfaces dishes people look at and do not order', async () => {
    await db.exec(`
      INSERT INTO public.analytics_events(visit_id, event, props, occurred_at)
      SELECT 'v' || g, 'item_viewed', '{"item_id":"${BURGER}"}'::jsonb, now()
        FROM generate_series(1, 40) g;
    `);

    await actAs(db, STAFF);
    const { rows } = await db.query<{ r: { looked_at_not_ordered: { name: string; views: number }[] } }>(
      `SELECT public.app_impact_summary(30) AS r`);
    await actAs(db, null);

    expect(rows[0].r.looked_at_not_ordered[0].name).toBe('Burger');
    expect(Number(rows[0].r.looked_at_not_ordered[0].views)).toBe(40);
  });

  it('does not offer margin without real costs', async () => {
    await actAs(db, STAFF);
    const { rows } = await db.query<{ r: { food_cost: { coverage: number; with_cost: number } } }>(
      `SELECT public.app_impact_summary(30) AS r`);
    await actAs(db, null);
    // margin_score is an ordinal weight, not money — the page says net sales
    // until somebody enters actual ingredient costs.
    expect(Number(rows[0].r.food_cost.coverage)).toBe(0);
    expect(Number(rows[0].r.food_cost.with_cost)).toBe(0);
  });

  it('reports coverage once costs exist', async () => {
    await db.exec(`UPDATE public.menu_items SET food_cost = 6.00 WHERE id = '${BURGER}'`);
    await actAs(db, STAFF);
    const { rows } = await db.query<{ r: { food_cost: { coverage: number } } }>(
      `SELECT public.app_impact_summary(30) AS r`);
    await actAs(db, null);
    expect(Number(rows[0].r.food_cost.coverage)).toBe(1);
  });

  it('is staff-only', async () => {
    await expect(db.query(`SELECT public.app_impact_summary(30)`)).rejects.toThrow(/Only staff/);
  });
});
