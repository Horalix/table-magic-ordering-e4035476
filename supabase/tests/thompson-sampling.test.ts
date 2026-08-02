/**
 * @vitest-environment node
 *
 * Thompson sampling.
 *
 * The load-bearing test is `gives an uncertain pair a real chance against a
 * proven one`. Everything else here guards the edges; that one is the entire
 * reason the phase exists. Under the mean, a pair with four observations and a
 * pair with four hundred are compared as though both numbers were facts, and
 * whichever is nominally higher wins every single impression forever. That is
 * not caution — it is a coin flip promoted to a permanent decision.
 *
 * The second most important is `does not hand impressions to a proven loser`.
 * It would be easy to write a sampler that explores so enthusiastically it
 * stops exploiting, and the difference between the two failures is invisible
 * unless you test for both.
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
const COFFEE = 'cccccccc-cccc-cccc-cccc-cccccccc0003';
const CAKE = 'cccccccc-cccc-cccc-cccc-cccccccc0004';
const SESSION = 'eeeeeeee-eeee-eeee-eeee-eeeeeeee0001';
const TOKEN = 'sess-token-7';

let db: Db;

/**
 * Several tests below stub `bandit_readiness` open rather than manufacturing
 * two thousand decisions. `CREATE OR REPLACE FUNCTION` survives a TRUNCATE, so
 * without restoring it the stub leaks into every later test — which is exactly
 * what happened the first time this file ran, and is why the real definition is
 * captured once and reinstated on every seed.
 */
let realReadiness = '';

const openTheGate = () => db.exec(`
  CREATE OR REPLACE FUNCTION public.bandit_readiness() RETURNS jsonb
  LANGUAGE sql STABLE AS $$ SELECT jsonb_build_object('ready', true) $$;`);

async function seed() {
  if (realReadiness) await db.exec(realReadiness);
  await db.exec(`
    TRUNCATE public.audit_log, public.recommendation_impressions, public.recommendation_decisions,
             public.session_experiment_assignment, public.experiments,
             public.suggestion_conversions, public.suggestion_stats, public.menu_item_affinity,
             public.analytics_events, public.menu_item_recommendations,
             public.order_ticket_events, public.order_items, public.orders,
             public.table_sessions, public.tables,
             public.menu_items, public.subcategories, public.categories, public.order_code_counters
      RESTART IDENTITY CASCADE;
    DELETE FROM public.user_roles;
    DELETE FROM auth.users;

    UPDATE public.restaurant_settings
       SET ordering_enabled = true, recommendations_enabled = true,
           reco_holdout_pct = 0, reco_sampling_enabled = false
     WHERE id = 1;

    INSERT INTO auth.users(id) VALUES ('${ADMIN}'), ('${STAFF}');
    INSERT INTO public.user_roles(user_id, role) VALUES ('${ADMIN}', 'admin'), ('${STAFF}', 'staff');

    INSERT INTO public.categories(id, name, sort_order) VALUES
      ('aaaaaaaa-0000-0000-0000-000000000001', 'Food', 1),
      ('aaaaaaaa-0000-0000-0000-000000000002', 'Drinks', 2);
    INSERT INTO public.subcategories(id, category_id, name, sort_order) VALUES
      ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'Mains', 1),
      ('bbbbbbbb-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000002', 'Hot', 2);
    INSERT INTO public.menu_items(id, subcategory_id, name, price, is_available, station, meal_role) VALUES
      ('${BURGER}', 'bbbbbbbb-0000-0000-0000-000000000001', 'Burger', 20.00, true, 'kitchen', 'main'),
      ('${COFFEE}', 'bbbbbbbb-0000-0000-0000-000000000002', 'Espresso', 3.00, true, 'bar', 'hot_drink'),
      ('${CAKE}',   'bbbbbbbb-0000-0000-0000-000000000001', 'Cake', 6.00, true, 'kitchen', 'dessert');

    INSERT INTO public.tables(id, table_number) VALUES ('dddddddd-0000-0000-0000-000000000001', 7);
    INSERT INTO public.table_sessions(id, table_id, token, is_active, last_heartbeat_at)
      VALUES ('${SESSION}', 'dddddddd-0000-0000-0000-000000000001', '${TOKEN}', true, now());
  `);
  await actAs(db, null);
}

const draw = async (accepted: number, shown: number, seed: string) => {
  const { rows } = await db.query<{ v: string }>(
    `SELECT public.sample_acceptance($1, $2, $3) AS v`, [accepted, shown, seed]);
  return Number(rows[0].v);
};

const draws = async (accepted: number, shown: number, n = 400) => {
  const out: number[] = [];
  for (let i = 0; i < n; i += 1) out.push(await draw(accepted, shown, `seed-${i}`));
  return out;
};

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const sd = (xs: number[]) => {
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
};

const setSampling = (on: boolean) =>
  db.exec(`UPDATE public.restaurant_settings SET reco_sampling_enabled = ${on} WHERE id = 1`);

/** Give a pair a history: `shown` impressions of which `accepted` converted. */
const history = (item: string, source: string | null, accepted: number, shown: number) =>
  db.query(
    `INSERT INTO public.suggestion_stats(recommended_item_id, source_item_id, placement, daypart, shown, accepted)
     VALUES ($1, $2, 'cart', NULL, $3, $4)`, [item, source, shown, accepted]);

beforeAll(async () => {
  db = (await createTestDatabase({ quiet: true })) as unknown as Db;
  const { rows } = await db.query<{ d: string }>(
    `SELECT pg_get_functiondef(p.oid) AS d FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'bandit_readiness'`);
  realReadiness = rows[0].d;
}, 180_000);
afterAll(async () => { await db?.close(); });
beforeEach(seed);

describe('the draw', () => {
  it('is stable for a seed', async () => {
    // A guest must see the same suggestion for the whole visit. Re-rolling on
    // every render would flicker the card and, worse, would make one decision
    // mean several different things in the impression ledger.
    const a = await draw(4, 4, 'session-x:item-y');
    const b = await draw(4, 4, 'session-x:item-y');
    expect(a).toBe(b);
  });

  it('differs between seeds', async () => {
    const values = new Set(await Promise.all(
      ['a', 'b', 'c', 'd', 'e', 'f'].map((s) => draw(4, 4, s))));
    expect(values.size).toBeGreaterThan(3);
  });

  it('is always a probability', async () => {
    // Box-Muller is unbounded; the clamp is what keeps a 3-sigma tail from
    // returning a negative acceptance rate and inverting the sort.
    for (const [a, n] of [[0, 0], [0, 500], [500, 500], [1, 2], [3, 4]]) {
      for (const v of await draws(a, n, 40)) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });

  it('centres on the same posterior mean the fixed ranker uses', async () => {
    // Sampling must not shift the estimate, only add spread around it.
    // Beta(1,12) prior: 400 shown / 100 accepted -> 101/413 = 0.2445.
    expect(mean(await draws(100, 400))).toBeCloseTo(101 / 413, 2);
  });

  it('is uncertain about small samples and confident about large ones', async () => {
    // The whole point. Both pairs sit near 25-29%; only one of them knows it.
    const thin = sd(await draws(4, 4));
    const thick = sd(await draws(100, 400));
    expect(thin).toBeGreaterThan(thick * 3);
  });

  it('is pulled toward the prior when there is no history at all', async () => {
    // Beta(1,12) -> 1/13 ≈ 0.077. Without a sceptical prior a single lucky
    // first acceptance on a quiet Tuesday would dominate the menu.
    expect(mean(await draws(0, 0))).toBeCloseTo(1 / 13, 1);
  });
});

describe('the switch', () => {
  it('is off by default', async () => {
    const { rows } = await db.query<{ on: boolean; v: string }>(
      `SELECT reco_sampling_enabled AS on, public.reco_policy_version() AS v
         FROM public.restaurant_settings WHERE id = 1`);
    expect(rows[0].on).toBe(false);
    expect(rows[0].v).toBe('v1-fixed-ranker');
  });

  it('leaves the fixed ranker exactly as it was while off', async () => {
    await history(COFFEE, BURGER, 100, 400);
    const { rows } = await db.query<{ a: string; b: string }>(
      `SELECT public.acceptance_for_ranking('${COFFEE}', 'cart', '${BURGER}', NULL, 's1') AS a,
              public.daypart_acceptance('${COFFEE}', 'cart', '${BURGER}', NULL) AS b`);
    expect(Number(rows[0].a)).toBe(Number(rows[0].b));
  });

  it('changes the policy version, which is what forces a new experiment', async () => {
    await setSampling(true);
    const { rows } = await db.query<{ v: string }>(`SELECT public.reco_policy_version() AS v`);
    expect(rows[0].v).toBe('v2-thompson');
  });

  it('starts sampling once on', async () => {
    await history(COFFEE, BURGER, 4, 4);
    await setSampling(true);
    const { rows } = await db.query<{ v: string }>(
      `SELECT public.acceptance_for_ranking('${COFFEE}', 'cart', '${BURGER}', NULL, s) AS v
         FROM unnest(ARRAY['s1','s2','s3','s4','s5','s6']) s`);
    expect(new Set(rows.map((r) => Number(r.v))).size).toBeGreaterThan(3);
  });
});

describe('allocation', () => {
  /**
   * Two candidates for the same slot:
   *   COFFEE — 400 shown, 100 accepted. Reliably ~24%.
   *   CAKE   —   4 shown,   4 accepted. Nominally 29%, actually unknown.
   *
   * Under the mean, CAKE outranks COFFEE on four data points and takes every
   * impression from here to eternity. Neither outcome — always CAKE, always
   * COFFEE — is defensible; the system should be finding out.
   */
  const race = async (n: number) => {
    let cake = 0;
    for (let i = 0; i < n; i += 1) {
      const { rows } = await db.query<{ c: string; k: string }>(
        `SELECT public.acceptance_for_ranking('${COFFEE}', 'cart', '${BURGER}', NULL, $1) AS c,
                public.acceptance_for_ranking('${CAKE}',   'cart', '${BURGER}', NULL, $1) AS k`,
        [`visit-${i}`]);
      if (Number(rows[0].k) > Number(rows[0].c)) cake += 1;
    }
    return cake / n;
  };

  it('gives an uncertain pair a real chance against a proven one', async () => {
    await history(COFFEE, BURGER, 100, 400);
    await history(CAKE, BURGER, 4, 4);

    await setSampling(false);
    const fixed = await race(60);
    await setSampling(true);
    const sampled = await race(240);

    // Deterministic: the nominally-higher mean wins everything, always.
    expect(fixed).toBe(1);

    // Sampled: contested. Both get impressions, so within a couple of weeks
    // the four-observation guess resolves into a fact either way.
    expect(sampled).toBeGreaterThan(0.25);
    expect(sampled).toBeLessThan(0.9);
  });

  it('does not hand impressions to a proven loser', async () => {
    // A sampler that explores everything equally is just as broken as one that
    // never explores. 400 shown at 2% should almost always lose to 400 at 25%.
    await history(COFFEE, BURGER, 100, 400);
    await history(CAKE, BURGER, 8, 400);

    await setSampling(true);
    expect(await race(200)).toBeLessThan(0.05);
  });

  it('still ranks, end to end, with sampling on', async () => {
    await db.exec(
      `INSERT INTO public.menu_item_recommendations(source_item_id, recommended_item_id, recommendation_type, priority)
       VALUES ('${BURGER}', '${COFFEE}', 'pair_with', 90)`);
    await setSampling(true);

    const { rows } = await db.query<{ id: string; decision_id: string }>(
      `SELECT id, decision_id FROM public.guest_get_recommendations(
         '${SESSION}'::uuid, '${TOKEN}', ARRAY['${BURGER}']::uuid[], 'cart', 'en', 4, '{}'::text[])`);

    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].decision_id).toBeTruthy();
  });

  it('records the sampled policy on the decision', async () => {
    // Mixing v1 and v2 decisions into one report would compare a policy
    // against itself and call the difference noise.
    await db.exec(
      `INSERT INTO public.menu_item_recommendations(source_item_id, recommended_item_id, recommendation_type, priority)
       VALUES ('${BURGER}', '${COFFEE}', 'pair_with', 90)`);
    await setSampling(true);
    await db.query(
      `SELECT * FROM public.guest_get_recommendations(
         '${SESSION}'::uuid, '${TOKEN}', ARRAY['${BURGER}']::uuid[], 'cart', 'en', 4, '{}'::text[])`);

    const { rows } = await db.query<{ policy_version: string }>(
      `SELECT policy_version FROM public.recommendation_decisions`);
    expect(rows[0].policy_version).toBe('v2-thompson');
  });
});

describe('turning itself on', () => {
  it('refuses while the gate is closed', async () => {
    await actAs(db, STAFF);
    const { rows } = await db.query<{ r: { changed: boolean; reason: string } }>(
      `SELECT public.maybe_enable_sampling() AS r`);
    await actAs(db, null);

    expect(rows[0].r.changed).toBe(false);
    expect(rows[0].r.reason).toBe('gate_not_passed');
  });

  it('leaves the policy alone when it refuses', async () => {
    await actAs(db, STAFF);
    await db.query(`SELECT public.maybe_enable_sampling()`);
    await actAs(db, null);
    const { rows } = await db.query<{ v: string }>(`SELECT public.reco_policy_version() AS v`);
    expect(rows[0].v).toBe('v1-fixed-ranker');
  });

  it('is not a no-op forever — it flips when the gate opens', async () => {
    // The gate is stubbed open here rather than manufacturing 2000 decisions:
    // what is under test is that maybe_enable_sampling acts on the gate, and
    // the gate's own arithmetic is tested in bandit-readiness.
    await openTheGate();

    await actAs(db, STAFF);
    const { rows } = await db.query<{ r: { changed: boolean; policy_version: string } }>(
      `SELECT public.maybe_enable_sampling() AS r`);
    const { rows: again } = await db.query<{ r: { reason: string } }>(
      `SELECT public.maybe_enable_sampling() AS r`);
    await actAs(db, null);

    expect(rows[0].r.changed).toBe(true);
    expect(rows[0].r.policy_version).toBe('v2-thompson');
    expect(again[0].r.reason).toBe('already_on');
  });

  it('closes the running experiment rather than contaminating it', async () => {
    // An experiment compares one policy against no suggestions. Swapping the
    // ranker underneath it would average two treatments into one number that
    // describes neither.
    await openTheGate();

    // Starting an experiment is a manager action; enabling sampling is not.
    await actAs(db, ADMIN);
    await db.query(`SELECT public.start_experiment('reco v1 vs none', 'v1-fixed-ranker', 10::smallint)`);
    await db.query(`SELECT public.maybe_enable_sampling()`);
    const { rows } = await db.query<{ open: number }>(
      `SELECT count(*)::int AS open FROM public.experiments WHERE ended_at IS NULL`);
    await actAs(db, null);

    expect(rows[0].open).toBe(0);
  });

  it('leaves a trail', async () => {
    await openTheGate();

    await actAs(db, STAFF);
    await db.query(`SELECT public.maybe_enable_sampling()`);
    const { rows } = await db.query<{ action: string }>(
      `SELECT action FROM public.audit_log WHERE action = 'reco.sampling_enabled'`);
    await actAs(db, null);
    expect(rows).toHaveLength(1);
  });

  it('is staff-only', async () => {
    await expect(db.query(`SELECT public.maybe_enable_sampling()`)).rejects.toThrow(/Only staff/);
  });
});

describe('the gate reports the live policy', () => {
  it('says which policy is running', async () => {
    await actAs(db, STAFF);
    const { rows } = await db.query<{ r: { sampling_enabled: boolean; policy_version: string } }>(
      `SELECT public.bandit_readiness() AS r`);
    await actAs(db, null);
    expect(rows[0].r.sampling_enabled).toBe(false);
    expect(rows[0].r.policy_version).toBe('v1-fixed-ranker');
  });

  it('still fails honestly on an empty database', async () => {
    await actAs(db, STAFF);
    const { rows } = await db.query<{ r: { ready: boolean; decisions: number } }>(
      `SELECT public.bandit_readiness() AS r`);
    await actAs(db, null);
    expect(rows[0].r.ready).toBe(false);
    expect(Number(rows[0].r.decisions)).toBe(0);
  });
});
