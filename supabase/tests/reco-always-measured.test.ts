/**
 * @vitest-environment node
 *
 * Suggestions are always measured, in margin, per restaurant
 * (20261116120000_reco_always_measured.sql).
 *
 *   - the scheduler opens an always-on check in each restaurant, once;
 *   - tables that open afterwards are split about 90/10 at the door;
 *   - a policy change closes the check and opens the next one under the new
 *     version; a manager's own experiment is never touched;
 *   - a manager's Stop stays stopped;
 *   - the margin read-out says "too early" with how many more tables, then
 *     a positive difference with its interval and a weekly figure from the
 *     cautious end; attach per daypart;
 *   - nobody but a manager or the scheduler can start or change it.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
// @ts-expect-error -- plain JS harness, no types needed
import { createTestDatabase, actAs } from '../../scripts/db-harness.mjs';

type Db = {
  query: <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<{ rows: T[] }>;
  exec: (sql: string) => Promise<unknown>;
  close: () => Promise<void>;
};

const L = 'a5000000-0000-4000-8000-000000000001';
const V = 'a5000000-0000-4000-8000-000000000002';
const MANAGER = '33333333-0000-0000-0000-0000000000a1';
const WAITER = '33333333-0000-0000-0000-0000000000a2';
const TABLE = 'dddddddd-0000-0000-0000-0000000000c1';
const MAIN = 'cccccccc-0000-0000-0000-0000000000c1';
const CAKE = 'cccccccc-0000-0000-0000-0000000000c2';
const COLA = 'cccccccc-0000-0000-0000-0000000000c3';
const COFFEE = 'cccccccc-0000-0000-0000-0000000000c4';

let db: Db;

const one = async <T>(sql: string, params: unknown[] = []) => (await db.query<{ r: T }>(sql, params)).rows[0].r;
const scheduler = () => one<Record<string, { action: string; holdout_pct: number; policy_version: string }>>(
  `SELECT public.run_scheduled_reco_measuring() AS r`);
const as = async <T>(user: string | null, fn: () => Promise<T>) => {
  await actAs(db, user);
  try { return await fn(); } finally { await actAs(db, null); }
};
const running = (venue: string) => db.query<{ id: string; auto: boolean; holdout_pct: number; policy_version: string }>(
  `SELECT id, auto, holdout_pct, policy_version FROM public.experiments WHERE ended_at IS NULL AND venue_id = $1`, [venue]);

/** `n` tables open now; returns their ids. */
async function open(n: number): Promise<string[]> {
  const ids = Array.from({ length: n }, () => crypto.randomUUID());
  await db.query(
    `INSERT INTO public.table_sessions(id, table_id, token, is_active, covers, opened_at, last_heartbeat_at)
     SELECT s.id, '${TABLE}', 'am-' || left(s.id::text, 12), false, 2, now() - make_interval(hours => (s.ord % 150)::int), now()
       FROM unnest($1::uuid[]) WITH ORDINALITY AS s(id, ord)`, [ids]);
  return ids;
}

/** One served round per table: a burger and a cola each, plus `extra` for some. */
async function order(ids: string[], extra: (id: string, i: number) => string[]) {
  for (const [i, id] of ids.entries()) {
    const items = [MAIN, COLA, ...extra(id, i)];
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO public.orders(table_session_id, total, status, payment_status, payment_method, released_to_kitchen_at, paid_at, created_at)
       SELECT $1, (SELECT sum(price) FROM public.menu_items mi JOIN unnest($2::uuid[]) x(id) ON x.id = mi.id),
              'served', 'paid', 'cash', ts.opened_at, ts.opened_at, ts.opened_at + interval '3 minutes'
         FROM public.table_sessions ts WHERE ts.id = $1 RETURNING id`, [id, items]);
    await db.query(
      `INSERT INTO public.order_items(order_id, menu_item_id, quantity, unit_price, status)
       SELECT $1, mi.id, 1, mi.price, 'served' FROM unnest($2::uuid[]) x(id) JOIN public.menu_items mi ON mi.id = x.id`,
      [rows[0].id, items]);
  }
}

beforeAll(async () => {
  db = (await createTestDatabase({ quiet: true })) as unknown as Db;
  await db.exec(`
    INSERT INTO auth.users(id) VALUES ('${MANAGER}'), ('${WAITER}');
    INSERT INTO public.user_roles(user_id, role, venue_id) VALUES ('${MANAGER}', 'admin', '${L}'), ('${WAITER}', 'staff', '${L}');
    INSERT INTO public.categories(id, name, sort_order, venue_id) VALUES ('aaaaaaaa-0000-0000-0000-0000000000c1', 'Am food', 90, '${L}');
    INSERT INTO public.subcategories(id, category_id, name, sort_order, venue_id) VALUES
      ('bbbbbbbb-0000-0000-0000-0000000000c1', 'aaaaaaaa-0000-0000-0000-0000000000c1', 'Am mains', 1, '${L}');
    INSERT INTO public.menu_items(id, subcategory_id, name, price, is_available, station, meal_role, food_cost, venue_id) VALUES
      ('${MAIN}',   'bbbbbbbb-0000-0000-0000-0000000000c1', 'Am Burger', 20, true, 'kitchen', 'main', 8, '${L}'),
      ('${CAKE}',   'bbbbbbbb-0000-0000-0000-0000000000c1', 'Am Cake',    9, true, 'kitchen', 'dessert', 3, '${L}'),
      ('${COLA}',   'bbbbbbbb-0000-0000-0000-0000000000c1', 'Am Cola',    4, true, 'bar',     'cold_drink', NULL, '${L}'),
      ('${COFFEE}', 'bbbbbbbb-0000-0000-0000-0000000000c1', 'Am Coffee',  4, true, 'bar',     'hot_drink', 1, '${L}');
    INSERT INTO public.tables(id, table_number, venue_id) VALUES ('${TABLE}', 77, '${L}');
    ALTER TABLE public.orders DISABLE TRIGGER trg_enforce_order_limits;
  `);
  await actAs(db, null);
}, 240_000);
afterAll(async () => { await db?.close(); });

describe('the always-on check', () => {
  it('is not running until something opens it: no pg_cron here, so tests and the demo stay as they were', async () => {
    expect((await running(L)).rows).toHaveLength(0);
    expect((await running(V)).rows).toHaveLength(0);
    const s = await db.query<{ p: number }>(`SELECT reco_auto_holdout_pct AS p FROM public.restaurant_settings WHERE venue_id = $1`, [L]);
    expect(s.rows[0].p).toBe(10);
  });

  it('the scheduler opens one per restaurant, at 10% under the current policy, and only once', async () => {
    const first = await scheduler();
    expect(first[L].action).toBe('started');
    expect(first[V].action).toBe('started');
    const [exp] = (await running(L)).rows;
    expect(exp).toMatchObject({ auto: true, holdout_pct: 10 });
    expect(exp.policy_version).toBe(await one<string>(`SELECT public.reco_policy_version_for($1) AS r`, [L]));

    const again = await scheduler();
    expect(again[L].action).toBe('unchanged');
    expect((await running(L)).rows[0].id).toBe(exp.id);
  });

  it('splits tables that open afterwards about 90/10, at the door', async () => {
    const ids = await open(600);
    const { rows } = await db.query<{ arm: string; n: number }>(
      `SELECT arm, count(*)::int AS n FROM public.session_experiment_assignment WHERE session_id = ANY($1::uuid[]) GROUP BY arm`, [ids]);
    const held = rows.find((r) => r.arm === 'holdout')?.n ?? 0;
    const treated = rows.find((r) => r.arm === 'treatment')?.n ?? 0;
    expect(held + treated).toBe(600);
    // 10% of 600 is 60; five standard deviations either side.
    expect(held).toBeGreaterThan(24);
    expect(held).toBeLessThan(96);
  });

  it('a policy change closes the check and the next one runs under the new version; history keeps its arm', async () => {
    const [before] = (await running(L)).rows;
    await db.exec(`UPDATE public.restaurant_settings SET reco_sampling_enabled = true WHERE venue_id = '${L}'`);
    const r = await scheduler();
    expect(r[L].action).toBe('restarted');
    expect(r[V].action).toBe('unchanged');
    const [after] = (await running(L)).rows;
    expect(after.id).not.toBe(before.id);
    expect(after.policy_version).not.toBe(before.policy_version);
    const old = await db.query<{ ended: boolean; n: number }>(
      `SELECT e.ended_at IS NOT NULL AS ended, (SELECT count(*)::int FROM public.session_experiment_assignment a WHERE a.experiment_id = e.id) AS n
         FROM public.experiments e WHERE e.id = $1`, [before.id]);
    expect(old.rows[0]).toMatchObject({ ended: true, n: 600 });
    await db.exec(`UPDATE public.restaurant_settings SET reco_sampling_enabled = false WHERE venue_id = '${L}'`);
    await scheduler();
  });

  it('never touches a manager\'s own experiment', async () => {
    await as(MANAGER, () => db.query(`SELECT public.start_experiment('Four weeks at 50%', public.reco_policy_version(), 50::smallint)`));
    const [mine] = (await running(L)).rows;
    expect(mine).toMatchObject({ auto: false, holdout_pct: 50 });
    await db.exec(`UPDATE public.restaurant_settings SET reco_sampling_enabled = true WHERE venue_id = '${L}'`);
    expect((await scheduler())[L].action).toBe('unchanged');
    expect((await running(L)).rows[0].id).toBe(mine.id);
    await db.exec(`UPDATE public.restaurant_settings SET reco_sampling_enabled = false WHERE venue_id = '${L}'`);
  });

  it('a manager\'s Stop stays stopped; switching it on again opens a new check', async () => {
    await as(MANAGER, () => db.query(`SELECT public.stop_experiment('enough')`));
    expect((await scheduler())[L].action).toBe('unchanged');
    expect((await running(L)).rows).toHaveLength(0);
    const s = await db.query<{ p: number; h: number }>(
      `SELECT reco_auto_holdout_pct AS p, reco_holdout_pct AS h FROM public.restaurant_settings WHERE venue_id = $1`, [L]);
    expect(s.rows[0]).toEqual({ p: 0, h: 0 });

    const r = await as(MANAGER, () => one<{ action: string }>(`SELECT public.set_reco_auto_holdout(50) AS r`));
    expect(r.action).toBe('started');
    expect((await running(L)).rows[0]).toMatchObject({ auto: true, holdout_pct: 50 });
  });

  it('only a manager or the scheduler can start or change it, and only their own restaurant', async () => {
    await expect(as(WAITER, () => db.query(`SELECT public.set_reco_auto_holdout(10)`))).rejects.toThrow(/manager/);
    await expect(as(WAITER, () => db.query(`SELECT public.reco_keep_measuring()`))).rejects.toThrow(/manager/);
    await expect(as(null, () => db.query(`SELECT public.reco_keep_measuring()`))).rejects.toThrow(/manager/);
    const mine = await as(MANAGER, () => one<Record<string, unknown>>(`SELECT public.reco_keep_measuring() AS r`));
    expect(Object.keys(mine)).toEqual([L]);
    const grants = await db.query<{ anon: boolean; sched: boolean }>(`
      SELECT has_function_privilege('anon', 'public.reco_keep_measuring()', 'EXECUTE') AS anon,
             has_function_privilege('authenticated', 'public.run_scheduled_reco_measuring()', 'EXECUTE') AS sched`);
    expect(grants.rows[0]).toEqual({ anon: false, sched: false });
  });
});

describe('what the suggestions added, in margin', () => {
  it('says "too early" with how many more tables, before each side has 30 visits over a week', async () => {
    const r = await as(WAITER, () => one<{ status: string; tables_needed: number; experiment: { holdout_pct: number } }>(
      `SELECT public.reco_profit_check(28) AS r`));
    expect(r.status).toBe('too_early');
    expect(r.experiment.holdout_pct).toBe(50);
    expect(r.tables_needed).toBeGreaterThanOrEqual(60);
  });

  it('reports the margin difference with its interval and a weekly figure from the cautious end', async () => {
    const [exp] = (await running(L)).rows;
    const ids = await open(160);
    await db.query(`UPDATE public.experiments SET started_at = now() - interval '8 days' WHERE id = $1`, [exp.id]);
    const arms = new Map((await db.query<{ session_id: string; arm: string }>(
      `SELECT session_id, arm FROM public.session_experiment_assignment WHERE session_id = ANY($1::uuid[])`, [ids])).rows
      .map((a) => [a.session_id, a.arm]));
    // With suggestions, about two tables in three add a cake and a coffee; without, one in six.
    await order(ids, (id, i) => ((arms.get(id) === 'treatment' ? i % 3 !== 0 : i % 6 === 0) ? [CAKE, COFFEE] : []));

    const r = await as(WAITER, () => one<{
      status: string;
      margin_per_visit: { difference: number; low: number; high: number };
      per_week: { treated_visits: number; estimate: number; low: number };
      with_suggestions: { visits: number; margin_per_visit: number };
      without: { visits: number; margin_per_visit: number };
      cost_estimated_share: number;
      attach: Array<{ arm: string; dessert_after_main: number | null; drink_with_food: number | null }>;
    }>(`SELECT public.reco_profit_check(28) AS r`));

    expect(r.status).toBe('positive');
    expect(r.with_suggestions.visits).toBeGreaterThanOrEqual(30);
    expect(r.without.visits).toBeGreaterThanOrEqual(30);
    // Cake + coffee keep 9 KM (13 less 4 of cost): about (2/3 − 1/6) × 9 = 4.5 KM a visit.
    expect(Number(r.margin_per_visit.difference)).toBeGreaterThan(3);
    expect(Number(r.margin_per_visit.difference)).toBeLessThan(6);
    expect(Number(r.margin_per_visit.low)).toBeGreaterThan(0);
    expect(Number(r.per_week.low)).toBeGreaterThan(0);
    expect(Number(r.per_week.low)).toBeLessThanOrEqual(Number(r.per_week.estimate));
    // Only the cola has no food cost entered: estimated, and said so.
    expect(Number(r.cost_estimated_share)).toBeGreaterThan(0);
    expect(Number(r.cost_estimated_share)).toBeLessThan(0.3);
    const treated = r.attach.filter((a) => a.arm === 'treatment');
    const held = r.attach.filter((a) => a.arm === 'holdout');
    expect(treated.length).toBeGreaterThan(0);
    expect(Math.max(...treated.map((a) => Number(a.dessert_after_main))))
      .toBeGreaterThan(Math.max(...held.map((a) => Number(a.dessert_after_main))));
    expect(treated.every((a) => Number(a.drink_with_food) === 1)).toBe(true);
  }, 120_000);

  it('is for this restaurant\'s staff only', async () => {
    await expect(as(null, () => db.query(`SELECT public.reco_profit_check(28)`))).rejects.toThrow(/Only staff/);
    const vera = await as(WAITER, async () => {
      await db.query(`SELECT set_config('lasoul.venue', $1, false)`, [V]);
      try { return await db.query(`SELECT public.reco_profit_check(28)`); } finally {
        await db.query(`SELECT set_config('lasoul.venue', '', false)`);
      }
    }).then(() => 'answered', (e: Error) => e.message);
    expect(vera).toMatch(/Only staff|answered/);
  });
});
