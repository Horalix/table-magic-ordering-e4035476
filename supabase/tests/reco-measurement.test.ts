/**
 * @vitest-environment node
 *
 * Incrementality at the volume one café has (20261025110000_reco_measurement.sql).
 *
 * The data here is simulated with a fixed seed, so every run sees the same
 * visits: a test that passes by luck one day and fails the next would teach
 * nobody anything about the statistics.
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
const TABLE = 'dddddddd-0000-0000-0000-000000000001';
const MAIN = 'cccccccc-0000-0000-0000-000000000001';
const CAKE = 'cccccccc-0000-0000-0000-000000000002';
const COLA = 'cccccccc-0000-0000-0000-000000000003';

let db: Db;

/** mulberry32: small, fast, and the same sequence everywhere. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const normal = (r: () => number) =>
  Math.sqrt(-2 * Math.log(Math.max(r(), 1e-12))) * Math.cos(2 * Math.PI * r());

interface Visit { arm: 'treatment' | 'holdout'; covers: number; y: number; x: number }

interface Adjusted {
  significant: boolean; difference: number; ci_low: number; status: string;
  variance_reduction_pct: number; days_to_answer_at_50: number;
}
interface Proportions {
  visits_a: number; attached_a: number; visits_b: number; attached_b: number;
  difference_pts: number | null; significant: boolean;
}
interface Horizon { holdout_pct: number; sessions_needed: number; days: number }
interface Power { ready: boolean; days_to_answer: Horizon; days_to_answer_at_50: Horizon }
interface Comparison {
  status: string; significant: boolean; ci_low: number; ci_high: number;
  adjusted: Adjusted;
  attach: { after_meal: Proportions; drink_with_main: Proportions };
  power: Power;
}

/**
 * Party size drives spend: about 18 KM a head, ±4 KM per visit. The first
 * cart the engine sees is about 15 KM a head. Treatment adds `effect` of the
 * average visit (63 KM).
 */
function simulate(perArm: number, effect: number, seed: number): Visit[] {
  const r = rng(seed);
  const out: Visit[] = [];
  for (const arm of ['treatment', 'holdout'] as const) {
    for (let i = 0; i < perArm; i += 1) {
      const covers = 1 + Math.floor(r() * 6);
      const lift = arm === 'treatment' ? effect * 63 : 0;
      out.push({
        arm,
        covers,
        y: Math.round((18 * covers + 4 * normal(r) + lift) * 100) / 100,
        x: Math.round((15 * covers + 3 * normal(r)) * 100) / 100,
      });
    }
  }
  return out;
}

const moments = (xs: number[], ys: number[]) => {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let vx = 0; let vy = 0; let c = 0;
  for (let i = 0; i < n; i += 1) {
    vx += (xs[i] - mx) ** 2; vy += (ys[i] - my) ** 2; c += (xs[i] - mx) * (ys[i] - my);
  }
  return { n, mx, my, vx: vx / (n - 1), vy: vy / (n - 1), c: c / (n - 1) };
};

async function seed() {
  await db.exec(`
    TRUNCATE public.audit_log, public.recommendation_impressions, public.recommendation_decisions,
             public.session_experiment_assignment, public.experiments,
             public.suggestion_conversions, public.order_ticket_events, public.order_items,
             public.orders, public.table_sessions, public.tables,
             public.menu_items, public.subcategories, public.categories, public.order_code_counters
      RESTART IDENTITY CASCADE;
    DELETE FROM public.user_roles;
    DELETE FROM auth.users;
    INSERT INTO auth.users(id) VALUES ('${STAFF}');
    INSERT INTO public.user_roles(user_id, role) VALUES ('${STAFF}', 'staff');

    INSERT INTO public.categories(id, name, sort_order) VALUES ('aaaaaaaa-0000-0000-0000-000000000001', 'Food', 1);
    INSERT INTO public.subcategories(id, category_id, name, sort_order) VALUES
      ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'Mains', 1),
      ('bbbbbbbb-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', 'Desserts', 2),
      ('bbbbbbbb-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000001', 'Other', 3);
    INSERT INTO public.menu_items(id, subcategory_id, name, price, is_available, station, meal_role) VALUES
      ('${MAIN}', 'bbbbbbbb-0000-0000-0000-000000000001', 'Burger', 20, true, 'kitchen', 'main'),
      ('${CAKE}', 'bbbbbbbb-0000-0000-0000-000000000002', 'Cake',    8, true, 'kitchen', 'dessert'),
      ('${COLA}', 'bbbbbbbb-0000-0000-0000-000000000003', 'Cola',    4, true, 'bar',     'cold_drink');
    INSERT INTO public.tables(id, table_number) VALUES ('${TABLE}', 7);
  `);
  await db.exec(`ALTER TABLE public.orders DISABLE TRIGGER trg_enforce_order_limits`);
  await actAs(db, null);
}

/** Sessions first, then the experiment, then the arms: nothing random is assigned. */
async function load(visits: Visit[], holdoutPct = 50) {
  const ids = visits.map(() => crypto.randomUUID());
  await db.query(
    `INSERT INTO public.table_sessions(id, table_id, token, is_active, covers, opened_at, last_heartbeat_at)
     SELECT s.id, '${TABLE}', 'sim-' || s.ord, false, s.covers,
            now() - make_interval(hours => (s.ord % 190)::int), now()
       FROM unnest($1::uuid[], $2::int[]) WITH ORDINALITY AS s(id, covers, ord)`,
    [ids, visits.map((v) => v.covers)]);
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO public.experiments(name, policy_version, holdout_pct, started_at)
     VALUES ('sim', 'v3-profit', $1, now() - interval '9 days') RETURNING id`, [holdoutPct]);
  await db.query(
    `INSERT INTO public.session_experiment_assignment(session_id, experiment_id, arm)
     SELECT s.id, $3, s.arm FROM unnest($1::uuid[], $2::text[]) AS s(id, arm)`,
    [ids, visits.map((v) => v.arm), rows[0].id]);
  await db.query(
    `INSERT INTO public.orders(table_session_id, total, status, payment_status, payment_method,
                               released_to_kitchen_at, paid_at, created_at)
     SELECT s.id, s.y, 'served', 'paid', 'cash', now(), now(), ts.opened_at + interval '5 minutes'
       FROM unnest($1::uuid[], $2::numeric[]) AS s(id, y)
       JOIN public.table_sessions ts ON ts.id = s.id`,
    [ids, visits.map((v) => v.y)]);
  // The first time the engine was asked, before anything was shown.
  await db.query(
    `INSERT INTO public.recommendation_decisions(session_id, placement, policy_version, cart_value, created_at)
     SELECT s.id, 'cart', 'v3-profit', s.x, ts.opened_at + interval '2 minutes'
       FROM unnest($1::uuid[], $2::numeric[]) AS s(id, x)
       JOIN public.table_sessions ts ON ts.id = s.id`,
    [ids, visits.map((v) => v.x)]);
  return rows[0].id;
}

const compare = async () => {
  await actAs(db, STAFF);
  const { rows } = await db.query<{ r: Comparison }>(`SELECT public.reco_holdout_comparison(30) AS r`);
  await actAs(db, null);
  return rows[0].r;
};

beforeAll(async () => { db = (await createTestDatabase({ quiet: true })) as unknown as Db; }, 180_000);
afterAll(async () => { await db?.close(); });
beforeEach(seed);

describe('adjusting for what was known before the first suggestion', () => {
  it('finds a 3% effect that party size hides from the plain comparison', async () => {
    await load(simulate(400, 0.03, 20261025));
    const r = await compare();

    expect(r.status).not.toBe('invalid_srm');
    // Plain difference of means: the interval straddles zero.
    expect(r.significant).toBe(false);
    expect(Number(r.ci_low)).toBeLessThan(0);
    expect(Number(r.ci_high)).toBeGreaterThan(0);

    // Adjusted for covers, daypart, weekday and the first cart: it does not.
    const adj = r.adjusted;
    expect(adj.significant).toBe(true);
    expect(Number(adj.ci_low)).toBeGreaterThan(0);
    expect(adj.status).toBe('positive');
    // And it is the same effect, measured more precisely: 3% of 63 KM.
    expect(Number(adj.difference)).toBeGreaterThan(1.2);
    expect(Number(adj.difference)).toBeLessThan(2.6);
    expect(Number(adj.variance_reduction_pct)).toBeGreaterThan(80);
  });

  it('keeps false positives near 5% when there is no effect', async () => {
    let adjusted = 0;
    let plain = 0;
    const reps = 200;
    for (let rep = 0; rep < reps; rep += 1) {
      const visits = simulate(60, 0, 1000 + rep);
      const t = visits.filter((v) => v.arm === 'treatment');
      const h = visits.filter((v) => v.arm === 'holdout');
      const a = moments(t.map((v) => v.x), t.map((v) => v.y));
      const b = moments(h.map((v) => v.x), h.map((v) => v.y));
      const { rows } = await db.query<{ adj: { significant: boolean }; plain: { significant: boolean } }>(
        `SELECT public.ancova_interval($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) AS adj,
                public.welch_interval($2, $4, $1, $8, $10, $7) AS plain`,
        [a.n, a.my, a.mx, a.vy, a.vx, a.c, b.n, b.my, b.mx, b.vy, b.vx, b.c]);
      if (rows[0].adj.significant) adjusted += 1;
      if (rows[0].plain.significant) plain += 1;
    }
    expect(adjusted / reps).toBeGreaterThan(0.01);
    expect(adjusted / reps).toBeLessThan(0.10);
    expect(plain / reps).toBeLessThan(0.10);
  });

  it('is the plain difference when the covariate says nothing', async () => {
    const { rows } = await db.query<{ adj: { difference: number; theta: number } }>(
      `SELECT public.ancova_interval(100, 50, 10, 25, 4, 0, 100, 48, 10, 25, 4, 0) AS adj`);
    expect(Number(rows[0].adj.difference)).toBe(2);
    expect(Number(rows[0].adj.theta)).toBe(0);
  });
});

describe('attach rates', () => {
  async function visit(arm: 'treatment' | 'holdout', experimentId: string,
    rounds: { items: string[]; minutesAgo: number; servedMinutesAgo?: number }[]) {
    const session = crypto.randomUUID();
    await db.query(
      `INSERT INTO public.table_sessions(id, table_id, token, is_active, opened_at, last_heartbeat_at)
       VALUES ($1, '${TABLE}', $2, false, now() - interval '3 hours', now())`, [session, `a-${session.slice(0, 8)}`]);
    await db.query(`DELETE FROM public.session_experiment_assignment WHERE session_id = $1`, [session]);
    await db.query(
      `INSERT INTO public.session_experiment_assignment(session_id, experiment_id, arm) VALUES ($1, $2, $3)`,
      [session, experimentId, arm]);
    for (const round of rounds) {
      const { rows } = await db.query<{ id: string }>(
        `INSERT INTO public.orders(table_session_id, total, status, payment_status, payment_method,
                                   released_to_kitchen_at, paid_at, created_at)
         VALUES ($1, 20, 'served', 'paid', 'cash', now(), now(), now() - make_interval(mins => $2)) RETURNING id`,
        [session, round.minutesAgo]);
      for (const item of round.items) {
        await db.query(
          `INSERT INTO public.order_items(order_id, menu_item_id, quantity, unit_price, status, served_at)
           SELECT $1, id, 1, price, 'served',
                  CASE WHEN $3::int IS NULL THEN NULL ELSE now() - make_interval(mins => $3::int) END
             FROM public.menu_items WHERE id = $2`,
          [rows[0].id, item, round.servedMinutesAgo ?? null]);
      }
    }
  }

  it('counts dessert after a served main, and a drink with the first main', async () => {
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO public.experiments(name, policy_version, holdout_pct, started_at)
       VALUES ('attach', 'v3-profit', 50, now() - interval '2 days') RETURNING id`);
    const exp = rows[0].id;

    // Treatment: 8 of 10 took a dessert after the main; 7 of 10 had a drink with it.
    for (let i = 0; i < 10; i += 1) {
      const first = i < 7 ? [MAIN, COLA] : [MAIN];
      const rounds = [{ items: first, minutesAgo: 90, servedMinutesAgo: 70 }];
      if (i < 8) rounds.push({ items: [CAKE], minutesAgo: 40 });
      await visit('treatment', exp, rounds);
    }
    // Holdout: 2 of 10, and 3 of 10. One dessert came BEFORE the main was
    // served (ordered with it) and must not count as after the meal.
    for (let i = 0; i < 10; i += 1) {
      const first = i < 3 ? [MAIN, COLA] : [MAIN];
      const rounds = [{ items: i === 9 ? [...first, CAKE] : first, minutesAgo: 90, servedMinutesAgo: 70 }];
      if (i < 2) rounds.push({ items: [CAKE], minutesAgo: 40 });
      await visit('holdout', exp, rounds);
    }

    const r = await compare();
    const after = r.attach.after_meal;
    expect(after.visits_a).toBe(10);
    expect(after.attached_a).toBe(8);
    expect(after.visits_b).toBe(10);
    expect(after.attached_b).toBe(2);
    expect(Number(after.difference_pts)).toBe(60);
    expect(after.significant).toBe(true);

    const drink = r.attach.drink_with_main;
    expect(drink.attached_a).toBe(7);
    expect(drink.attached_b).toBe(3);
    expect(Number(drink.difference_pts)).toBe(40);
    // Ten visits an arm cannot settle a 40-point gap with any confidence.
    expect(drink.significant).toBe(false);
  });

  it('gives an honest interval for small and empty arms', async () => {
    const { rows } = await db.query<{ big: Proportions; empty: Proportions }>(
      `SELECT public.two_proportion_interval(30, 100, 15, 100) AS big,
              public.two_proportion_interval(0, 0, 3, 10) AS empty`);
    expect(rows[0].big.significant).toBe(true);
    expect(Number(rows[0].big.difference_pts)).toBe(15);
    expect(rows[0].empty.significant).toBe(false);
    expect(rows[0].empty.difference_pts).toBeNull();
  });
});

describe('how long the answer takes', () => {
  it('reports days to an answer at the running split and at 50/50', async () => {
    const id = await load(simulate(40, 0, 7), 10);
    await actAs(db, STAFF);
    const { rows } = await db.query<{ p: Power }>(
      `SELECT public.experiment_power($1, 5) AS p`, [id]);
    await actAs(db, null);
    const p = rows[0].p;

    expect(p.ready).toBe(true);
    expect(p.days_to_answer.holdout_pct).toBe(10);
    expect(p.days_to_answer_at_50.holdout_pct).toBe(50);
    // A 10% holdout needs (1/0.1 + 1/0.9) / 4 ≈ 2.8 times the visits of 50/50.
    const ratio = Number(p.days_to_answer.sessions_needed) / Number(p.days_to_answer_at_50.sessions_needed);
    expect(ratio).toBeGreaterThan(2.7);
    expect(ratio).toBeLessThan(2.9);
    expect(Number(p.days_to_answer.days)).toBeGreaterThan(Number(p.days_to_answer_at_50.days));
  });

  it('shortens the horizon by what the adjustment removes', async () => {
    await load(simulate(60, 0, 11));
    const r = await compare();
    expect(Number(r.adjusted.days_to_answer_at_50)).toBeLessThan(Number(r.power.days_to_answer_at_50.days));
  });
});
