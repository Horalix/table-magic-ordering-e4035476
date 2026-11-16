/**
 * @vitest-environment node
 *
 * Recommendations v3 (20261025100000_reco_learning_v3.sql).
 *
 *   R1  learning counts come from the ledger: a sighting once per decision,
 *       an acceptance only when the line was paid for
 *   R2  pair strength is shrunk (EB05) and age-weighted, with a section-level
 *       fallback and a daypart-aware popular list
 *   R3  a new pair starts from what its dish does elsewhere
 *   R4  candidates are ranked by expected profit
 *   R5  a dish passed over this visit is offered less; halal is not a filter
 *       here, and alcohol cannot exist (menu_items_no_alcohol)
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
const SUB = {
  burgers: 'bbbbbbbb-0000-0000-0000-000000000001',
  fries: 'bbbbbbbb-0000-0000-0000-000000000002',
  drinks: 'bbbbbbbb-0000-0000-0000-000000000003',
  sides: 'bbbbbbbb-0000-0000-0000-000000000004',
  kids: 'bbbbbbbb-0000-0000-0000-000000000006',
  extras: 'bbbbbbbb-0000-0000-0000-000000000007',
};
const ITEM = {
  burger: 'cccccccc-0000-0000-0000-000000000001',
  newBurger: 'cccccccc-0000-0000-0000-000000000002',
  friesA: 'cccccccc-0000-0000-0000-000000000003',
  friesB: 'cccccccc-0000-0000-0000-000000000004',
  cola: 'cccccccc-0000-0000-0000-000000000005',
  salad: 'cccccccc-0000-0000-0000-000000000006',
  slaw: 'cccccccc-0000-0000-0000-000000000007',
  nuggets: 'cccccccc-0000-0000-0000-000000000009',
  platter: 'cccccccc-0000-0000-0000-000000000010',
  dip: 'cccccccc-0000-0000-0000-000000000011',
};
const TABLE = 'dddddddd-0000-0000-0000-000000000001';
const SESSION = 'eeeeeeee-eeee-eeee-eeee-eeeeeeee0001';
const TOKEN = 'sess-token-v3';

let db: Db;

async function seed() {
  await db.exec(`
    TRUNCATE public.audit_log, public.analytics_events, public.experiments, public.session_experiment_assignment,
             public.recommendation_impressions, public.recommendation_decisions,
             public.suggestion_conversions, public.suggestion_stats, public.suggestion_priors,
             public.menu_item_affinity, public.session_item_affinity,
             public.subcategory_affinity, public.item_section_share,
             public.menu_item_recommendations, public.order_ticket_events, public.order_items,
             public.orders, public.table_sessions, public.tables,
             public.menu_items, public.subcategories, public.categories, public.order_code_counters
      RESTART IDENTITY CASCADE;
    DELETE FROM public.user_roles;
    DELETE FROM auth.users;

    UPDATE public.restaurant_settings
       SET ordering_enabled = true, online_card_enabled = false,
           recommendations_enabled = true, reco_holdout_pct = 0, reco_exploration = 0,
           reco_weight_curated = 40, reco_weight_observed = 25,
           reco_weight_learned = 25, reco_weight_margin = 10,
           reco_min_acceptance = 0.030, reco_retire_after_impressions = 60,
           reco_sampling_enabled = false
     WHERE id = 1;

    INSERT INTO auth.users(id) VALUES ('${STAFF}');
    INSERT INTO public.user_roles(user_id, role) VALUES ('${STAFF}', 'admin'), ('${STAFF}', 'staff');

    INSERT INTO public.categories(id, name, sort_order) VALUES
      ('aaaaaaaa-0000-0000-0000-000000000001', 'Food', 1),
      ('aaaaaaaa-0000-0000-0000-000000000002', 'Drinks', 2);
    INSERT INTO public.subcategories(id, category_id, name, sort_order) VALUES
      ('${SUB.burgers}',   'aaaaaaaa-0000-0000-0000-000000000001', 'Burgers', 1),
      ('${SUB.fries}',     'aaaaaaaa-0000-0000-0000-000000000001', 'Fries', 2),
      ('${SUB.drinks}',    'aaaaaaaa-0000-0000-0000-000000000002', 'Other', 3),
      ('${SUB.sides}',     'aaaaaaaa-0000-0000-0000-000000000001', 'Salads', 4),
      ('${SUB.kids}',      'aaaaaaaa-0000-0000-0000-000000000001', 'Kids Menu', 6),
      ('${SUB.extras}',    'aaaaaaaa-0000-0000-0000-000000000001', 'Extras', 7);

    INSERT INTO public.menu_items(id, subcategory_id, name, price, is_available, station, meal_role, dietary_tags) VALUES
      ('${ITEM.burger}',    '${SUB.burgers}',   'La Soul Burger', 20.00, true, 'kitchen', 'main',       '{}'),
      ('${ITEM.newBurger}', '${SUB.burgers}',   'Healthy Burger', 20.00, true, 'kitchen', 'main',       '{}'),
      ('${ITEM.friesA}',    '${SUB.fries}',     'Regular Fries',   5.00, true, 'kitchen', 'side',       '{}'),
      ('${ITEM.friesB}',    '${SUB.fries}',     'Truffle Fries',   5.00, true, 'kitchen', 'side',       '{}'),
      ('${ITEM.cola}',      '${SUB.drinks}',    'Coca-Cola',       4.00, true, 'bar',     'cold_drink', '{halal}'),
      ('${ITEM.salad}',     '${SUB.sides}',     'Side Salad',      6.00, true, 'kitchen', 'side',       '{}'),
      ('${ITEM.slaw}',      '${SUB.sides}',     'Coleslaw',        6.00, true, 'kitchen', 'side',       '{}'),
      ('${ITEM.nuggets}',   '${SUB.kids}',      'Kids Nuggets',    9.00, true, 'kitchen', 'main',       '{}'),
      ('${ITEM.platter}',   '${SUB.extras}',    'Sharing Platter',30.00, true, 'kitchen', NULL,         '{}'),
      ('${ITEM.dip}',       '${SUB.extras}',    'Dip Trio',        4.00, true, 'kitchen', NULL,         '{}');

    INSERT INTO public.tables(id, table_number) VALUES ('${TABLE}', 7);
    INSERT INTO public.table_sessions(id, table_id, token, is_active, guest_name, last_heartbeat_at)
      VALUES ('${SESSION}', '${TABLE}', '${TOKEN}', true, 'Amina', now());
  `);
  await db.exec(`ALTER TABLE public.orders DISABLE TRIGGER trg_enforce_order_limits`);
  await actAs(db, null);
}

/** A paid order in its own closed visit, `hoursAgo` in the past. */
async function basket(items: string[], hoursAgo = 0) {
  const session = crypto.randomUUID();
  await db.query(
    `INSERT INTO public.table_sessions(id, table_id, token, is_active, last_heartbeat_at, opened_at)
     VALUES ($1, '${TABLE}', $2, false, now(), now() - make_interval(hours => $3))`,
    [session, `b-${session.slice(0, 8)}`, hoursAgo]);
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO public.orders(table_session_id, total, status, payment_status, payment_method,
                               released_to_kitchen_at, paid_at, created_at)
     VALUES ($1, 0, 'served', 'paid', 'cash', now(), now(), now() - make_interval(hours => $2))
     RETURNING id`, [session, hoursAgo]);
  for (const item of items) {
    await db.query(
      `INSERT INTO public.order_items(order_id, menu_item_id, quantity, unit_price, status)
       SELECT $1, id, 1, price, 'served' FROM public.menu_items WHERE id = $2`, [rows[0].id, item]);
  }
}

const asStaff = async <T,>(sql: string, params: unknown[] = []) => {
  await actAs(db, STAFF);
  try {
    return (await db.query<T>(sql, params)).rows;
  } finally {
    await actAs(db, null);
  }
};

const rank = async (cart: string[], placement = 'cart', allergens: string[] = []) => {
  const { rows } = await db.query<{ id: string; recommendation_type: string; source_item_id: string | null }>(
    `SELECT id, recommendation_type, source_item_id
       FROM public.rank_recommendations($1::uuid[], $2, 'en', 8, $3::uuid, $4::text[])`,
    [cart, placement, SESSION, allergens]);
  return rows;
};
const ids = async (cart: string[], placement = 'cart') => (await rank(cart, placement)).map((r) => r.id);

const curate = (source: string, target: string, priority: number) =>
  db.query(
    `INSERT INTO public.menu_item_recommendations(source_item_id, recommended_item_id, recommendation_type, priority)
     VALUES ($1, $2, 'pair_with', $3)`, [source, target, priority]);

const stats = (item: string, source: string | null, shown: number, accepted: number) =>
  db.query(
    `INSERT INTO public.suggestion_stats(recommended_item_id, source_item_id, placement, daypart, shown, accepted)
     VALUES ($1, $2, 'cart', NULL, $3, $4)`, [item, source, shown, accepted]);

/** A real decision through the guest wrapper; returns its id and chosen dish. */
const decide = async (cart: string[]) => {
  const { rows } = await db.query<{ decision_id: string; id: string }>(
    `SELECT decision_id, id FROM public.guest_get_recommendations($1::uuid, $2, $3::uuid[], 'cart', 'en', 4,
                                                               '{}'::text[], '{}'::text[], '{}'::uuid[])`,
    [SESSION, TOKEN, cart]);
  return { decisionId: rows[0].decision_id, chosen: rows[0].id };
};

const seen = (decisionId: string) =>
  db.query(`SELECT public.guest_mark_suggestion_seen($1, $2, $3)`, [decisionId, SESSION, TOKEN]);

const browserEvent = (event: string, props: Record<string, unknown>, at = 'now()') =>
  db.query(
    `INSERT INTO public.analytics_events(visit_id, event, props, occurred_at)
     VALUES ('v1', $1, $2::jsonb, ${at})`, [event, JSON.stringify(props)]);

const refreshStats = () => asStaff(`SELECT public.refresh_suggestion_stats(90)`);

const allDay = async (item: string, source: string | null) => {
  const { rows } = await db.query<{ shown: number; accepted: number; dismissed: number; shown_ledger: number }>(
    `SELECT shown, accepted, dismissed, shown_ledger FROM public.suggestion_stats
      WHERE recommended_item_id = $1 AND source_item_id IS NOT DISTINCT FROM $2::uuid
        AND placement = 'cart' AND daypart IS NULL`, [item, source]);
  return rows[0];
};

beforeAll(async () => { db = (await createTestDatabase({ quiet: true })) as unknown as Db; }, 180_000);
afterAll(async () => { await db?.close(); });
// The ranker's rules know the time of day (no cake at 09:00, no croissant at
// 21:00); a fixed Wednesday afternoon keeps these tests off the wall clock.
beforeAll(async () => { await db.exec(`SET lasoul.reco_now = '2026-10-21 15:00+02'`); });
beforeEach(seed);

// ---------------------------------------------------------------------------

describe('R1: the engine learns from the server record', () => {
  beforeEach(async () => { await curate(ITEM.burger, ITEM.salad, 90); });

  it('counts one sighting per decision, however often the browser reports it', async () => {
    const { decisionId, chosen } = await decide([ITEM.burger]);
    expect(chosen).toBe(ITEM.salad);
    await seen(decisionId);
    // The cart page and the cart sheet both reported it.
    for (let i = 0; i < 2; i += 1) {
      await browserEvent('suggestion_shown',
        { decision_id: decisionId, item_id: ITEM.salad, source_item_id: ITEM.burger, placement: 'cart' });
    }
    await refreshStats();

    const row = await allDay(ITEM.salad, ITEM.burger);
    expect(row.shown).toBe(1);
    expect(row.shown_ledger).toBe(1);
    expect(row.accepted).toBe(0);
  });

  it('does not count a tap whose order was cancelled', async () => {
    const { decisionId } = await decide([ITEM.burger]);
    await seen(decisionId);
    await browserEvent('suggestion_accepted',
      { decision_id: decisionId, item_id: ITEM.salad, source_item_id: ITEM.burger, placement: 'cart' });
    const { rows } = await db.query<{ r: { order_id: string } }>(
      `SELECT public.guest_place_order($1, $2, 'Amina', 'cash', $3::jsonb, 0) AS r`,
      [SESSION, TOKEN, JSON.stringify([
        { menu_item_id: ITEM.burger, quantity: 1 },
        { menu_item_id: ITEM.salad, quantity: 1,
          from_suggestion: { source_item_id: ITEM.burger, placement: 'cart', decision_id: decisionId } },
      ])]);
    await asStaff(`SELECT public.cancel_order($1, 'changed their mind')`, [rows[0].r.order_id]);
    await refreshStats();

    const row = await allDay(ITEM.salad, ITEM.burger);
    expect(row.shown).toBe(1);
    expect(row.accepted).toBe(0);
  });

  it('counts a paid line as the acceptance', async () => {
    const { decisionId } = await decide([ITEM.burger]);
    await seen(decisionId);
    await db.query(
      `SELECT public.guest_place_order($1, $2, 'Amina', 'cash', $3::jsonb, 0)`,
      [SESSION, TOKEN, JSON.stringify([
        { menu_item_id: ITEM.burger, quantity: 1 },
        { menu_item_id: ITEM.salad, quantity: 1,
          from_suggestion: { source_item_id: ITEM.burger, placement: 'cart', decision_id: decisionId } },
      ])]);
    await refreshStats();

    const row = await allDay(ITEM.salad, ITEM.burger);
    expect(row.shown).toBe(1);
    expect(row.accepted).toBe(1);
  });

  it('gives nothing to a card that was not the decision\'s choice', async () => {
    const { decisionId } = await decide([ITEM.burger]);
    await seen(decisionId);
    // A second row shown under the same decision after a dismissal.
    await browserEvent('suggestion_shown',
      { decision_id: decisionId, item_id: ITEM.cola, source_item_id: null, placement: 'cart' });
    await browserEvent('suggestion_dismissed',
      { decision_id: decisionId, item_id: ITEM.salad, source_item_id: ITEM.burger, placement: 'cart' });
    await refreshStats();

    expect(await allDay(ITEM.cola, null)).toBeUndefined();
    const row = await allDay(ITEM.salad, ITEM.burger);
    expect(row.shown).toBe(1);
    expect(row.dismissed).toBe(1);
  });

  it('keeps browser counts only from before the ledger began', async () => {
    await browserEvent('suggestion_shown',
      { item_id: ITEM.slaw, source_item_id: ITEM.burger, placement: 'cart' }, `now() - interval '20 days'`);
    await browserEvent('suggestion_accepted',
      { item_id: ITEM.slaw, source_item_id: ITEM.burger, placement: 'cart' }, `now() - interval '20 days'`);
    await decide([ITEM.burger]);
    // After the ledger's first row, a browser event no longer counts.
    await browserEvent('suggestion_shown', { item_id: ITEM.slaw, source_item_id: ITEM.burger, placement: 'cart' });
    await refreshStats();

    const row = await allDay(ITEM.slaw, ITEM.burger);
    expect(row.shown).toBe(1);
    expect(row.accepted).toBe(1);
    expect(row.shown_ledger).toBe(0);
  });

  it('tells the bandit gate whether its counts come from the ledger', async () => {
    const gate = async () => {
      const [r] = await asStaff<{ r: { checks: { check: string; pass: boolean }[] } }>(
        `SELECT public.bandit_readiness() AS r`);
      return r.r.checks.find((c) => c.check === 'stats_learn_from_ledger')!;
    };

    await browserEvent('suggestion_shown',
      { item_id: ITEM.slaw, source_item_id: ITEM.burger, placement: 'cart' }, `now() - interval '5 days'`);
    await refreshStats();
    expect((await gate()).pass).toBe(false);

    await db.exec(`DELETE FROM public.analytics_events`);
    const { decisionId } = await decide([ITEM.burger]);
    await seen(decisionId);
    await refreshStats();
    expect((await gate()).pass).toBe(true);
  });
});

describe('R2: shrunk, age-weighted pair strength', () => {
  it('does not believe two dishes ordered once, together', async () => {
    const { rows } = await db.query<{ v: string }>(`SELECT public.eb_lower05(1, 0.1) AS v`);
    expect(Number(rows[0].v)).toBeLessThan(1);

    await basket([ITEM.salad, ITEM.slaw]);
    for (let i = 0; i < 9; i += 1) await basket([ITEM.cola]);
    await asStaff(`SELECT public.refresh_menu_affinity(365, 1)`);
    const { rows: pair } = await db.query<{ lift: string; eb05: string }>(
      `SELECT lift, eb05 FROM public.menu_item_affinity WHERE item_a = $1 AND item_b = $2`, [ITEM.salad, ITEM.slaw]);
    // Raw lift calls this a perfect, ten-fold pairing.
    expect(Number(pair[0].lift)).toBeGreaterThan(5);
    expect(Number(pair[0].eb05)).toBeLessThan(1);
  });

  it('believes thirty co-occurrences where ten were expected', async () => {
    const { rows } = await db.query<{ v: string; m: string }>(
      `SELECT public.eb_lower05(30, 10) AS v, public.eb_posterior_mean(30, 10) AS m`);
    expect(Number(rows[0].v)).toBeGreaterThan(2);
    expect(Number(rows[0].m)).toBeCloseTo(31 / 11, 3);
  });

  it('lets a basket fade with age instead of falling off a cliff', async () => {
    const { rows } = await db.query<{ w: string }>(
      `SELECT public.basket_weight(now() - interval '120 days') AS w`);
    expect(Number(rows[0].w)).toBeCloseTo(0.157, 2);

    await basket([ITEM.salad, ITEM.slaw], 120 * 24);
    for (let i = 0; i < 6; i += 1) await basket([ITEM.cola]);
    await asStaff(`SELECT public.refresh_menu_affinity(365, 1)`);
    const { rows: pair } = await db.query<{ w_pair: string; pair_orders: number }>(
      `SELECT w_pair, pair_orders FROM public.menu_item_affinity WHERE item_a = $1 AND item_b = $2`,
      [ITEM.salad, ITEM.slaw]);
    expect(Number(pair[0].w_pair)).toBeCloseTo(0.16, 1);
    // The raw count other screens quote stays "the last 90 days".
    expect(pair[0].pair_orders).toBe(0);
  });

  it('offers a section\'s best seller for this daypart when the dish has no history', async () => {
    // Baskets are dated from the real clock here, so the ranker must use it too.
    await db.exec(`RESET lasoul.reco_now`);
    const { rows: dp } = await db.query<{ now_dp: string; then_dp: string }>(
      `SELECT public.daypart_of(now()) AS now_dp, public.daypart_of(now() - interval '6 hours') AS then_dp`);
    expect(dp[0].now_dp).not.toBe(dp[0].then_dp);

    // Burgers go with fries. Regular fries sell now; truffle fries sell more
    // overall, but at another time of day.
    for (let i = 0; i < 6; i += 1) await basket([ITEM.burger, ITEM.friesA]);
    for (let i = 0; i < 6; i += 1) await basket([ITEM.burger, ITEM.friesB], 6);
    for (let i = 0; i < 4; i += 1) await basket([ITEM.friesB], 6);
    for (let i = 0; i < 30; i += 1) await basket([ITEM.cola]);
    await asStaff(`SELECT public.refresh_menu_affinity(365, 2)`);

    const { rows: section } = await db.query<{ eb05: string }>(
      `SELECT eb05 FROM public.subcategory_affinity WHERE sub_a = $1 AND sub_b = $2`, [SUB.burgers, SUB.fries]);
    expect(Number(section[0].eb05)).toBeGreaterThan(1);

    // A burger nobody has ordered yet, with a drink already in the cart.
    const rows = await rank([ITEM.newBurger, ITEM.cola]);
    expect(rows.map((r) => r.id).slice(0, 2)).toEqual([ITEM.friesA, ITEM.friesB]);
    expect(rows[0].recommendation_type).toBe('frequently_bought_together');
    expect(rows[0].source_item_id).toBe(ITEM.newBurger);
    await db.exec(`SET lasoul.reco_now = '2026-10-21 15:00+02'`);
  });

  it('makes the popular fallback depend on the time of day', async () => {
    for (let i = 0; i < 3; i += 1) await basket([ITEM.salad]);
    for (let i = 0; i < 6; i += 1) await basket([ITEM.slaw], 6);
    const top = async (dpSql: string) => {
      const { rows } = await db.query<{ menu_item_id: string }>(
        `SELECT menu_item_id FROM public.popular_items_for_daypart(${dpSql}, 5, 45)`);
      return rows[0].menu_item_id;
    };
    expect(await top(`public.daypart_of(now())`)).toBe(ITEM.salad);
    expect(await top(`public.daypart_of(now() - interval '6 hours')`)).toBe(ITEM.slaw);
  });
});

describe('R3: priors that know the dish', () => {
  it('lets a new pair start from what its dish does elsewhere', async () => {
    // Both offered with the burger, equally curated, never shown with it.
    await curate(ITEM.burger, ITEM.salad, 60);
    await curate(ITEM.burger, ITEM.slaw, 60);
    // Elsewhere — with the fries — the salad converts and the slaw never does.
    await stats(ITEM.salad, ITEM.friesA, 200, 60);
    await stats(ITEM.slaw, ITEM.friesA, 200, 0);
    await asStaff(`SELECT public.refresh_suggestion_priors()`);

    const got = await ids([ITEM.burger]);
    expect(got.indexOf(ITEM.salad)).toBeGreaterThanOrEqual(0);
    expect(got.indexOf(ITEM.salad)).toBeLessThan(got.indexOf(ITEM.slaw));

    const { rows } = await db.query<{ good: string; bad: string }>(`
      SELECT public.daypart_acceptance($1, 'cart', $3, NULL) AS good,
             public.daypart_acceptance($2, 'cart', $3, NULL) AS bad`, [ITEM.salad, ITEM.slaw, ITEM.burger]);
    expect(Number(rows[0].good)).toBeGreaterThan(0.15);
    expect(Number(rows[0].bad)).toBeLessThan(0.05);
  });

  it('keeps Beta(1,12) for the old two-argument callers', async () => {
    const { rows } = await db.query<{ a: string; b: string }>(
      `SELECT public.smoothed_acceptance(3, 10) AS a, public.smoothed_acceptance(3, 10, 1, 12) AS b`);
    expect(Number(rows[0].a)).toBe(Number(rows[0].b));
    expect(Number(rows[0].a)).toBeCloseTo(4 / 23, 4);
  });

  it('retires on the optimistic end of the record, not the average', async () => {
    const { rows } = await db.query<{ thin: boolean; dead: boolean }>(`
      SELECT public.acceptance_retired(2, 60, 1.2, 18.8, 0.03) AS thin,
             public.acceptance_retired(0, 150, 1.2, 18.8, 0.03) AS dead`);
    // 2 in 60 at a dish that converts at 6% elsewhere: unlucky, not dead.
    expect(rows[0].thin).toBe(false);
    expect(rows[0].dead).toBe(true);

    await curate(ITEM.burger, ITEM.salad, 80);
    await curate(ITEM.burger, ITEM.slaw, 80);
    await db.exec(`
      INSERT INTO public.suggestion_priors(recommended_item_id, placement, alpha0, beta0, item_shown)
      VALUES ('${ITEM.salad}', 'cart', 1.2, 18.8, 300), ('${ITEM.slaw}', 'cart', 1.2, 18.8, 300)`);
    await stats(ITEM.salad, ITEM.burger, 60, 2);
    await stats(ITEM.slaw, ITEM.burger, 150, 0);
    const got = await ids([ITEM.burger]);
    expect(got).toContain(ITEM.salad);
    expect(got).not.toContain(ITEM.slaw);
  });
});

describe('R4: ranked by expected profit', () => {
  it('prefers the dish that earns more when guests take both equally', async () => {
    await curate(ITEM.burger, ITEM.salad, 60);
    await curate(ITEM.burger, ITEM.slaw, 60);
    await db.exec(`
      UPDATE public.menu_items SET food_cost = 1.00 WHERE id = '${ITEM.slaw}';
      UPDATE public.menu_items SET food_cost = 4.50 WHERE id = '${ITEM.salad}';`);
    await stats(ITEM.salad, ITEM.burger, 400, 100);
    await stats(ITEM.slaw, ITEM.burger, 400, 100);

    const got = await ids([ITEM.burger]);
    expect(got.indexOf(ITEM.slaw)).toBeLessThan(got.indexOf(ITEM.salad));
  });

  it('does not chase a big price nobody takes', async () => {
    // 30 KM at 2% earns 0.42 KM a sighting; 4 KM at 25% earns 0.70 KM.
    await curate(ITEM.burger, ITEM.platter, 60);
    await curate(ITEM.burger, ITEM.dip, 60);
    await stats(ITEM.platter, ITEM.burger, 400, 8);
    await stats(ITEM.dip, ITEM.burger, 400, 100);

    const got = await ids([ITEM.burger]);
    expect(got.indexOf(ITEM.dip)).toBeGreaterThanOrEqual(0);
    expect(got.indexOf(ITEM.dip)).toBeLessThan(got.indexOf(ITEM.platter));
  });

  it('reads a missing food cost as the role default, never as zero cost or zero margin', async () => {
    const { rows } = await db.query<{ unit_cm: string; cost_estimated: boolean }>(
      `SELECT unit_cm, cost_estimated FROM public.menu_unit_margins() WHERE item_id = $1`, [ITEM.salad]);
    expect(rows[0].cost_estimated).toBe(true);
    expect(Number(rows[0].unit_cm)).toBeGreaterThan(0);
    expect(Number(rows[0].unit_cm)).toBeLessThan(6);

    // A dish with no cost recorded beats one whose cost eats its whole price.
    await curate(ITEM.burger, ITEM.salad, 60);
    await curate(ITEM.burger, ITEM.slaw, 60);
    await db.exec(`UPDATE public.menu_items SET food_cost = 6.00 WHERE id = '${ITEM.slaw}'`);
    await stats(ITEM.salad, ITEM.burger, 400, 100);
    await stats(ITEM.slaw, ITEM.burger, 400, 100);
    const got = await ids([ITEM.burger]);
    expect(got.indexOf(ITEM.salad)).toBeLessThan(got.indexOf(ITEM.slaw));
  });

  it('still never returns the margin or the score', async () => {
    await curate(ITEM.burger, ITEM.salad, 60);
    const { rows } = await db.query<Record<string, unknown>>(
      `SELECT * FROM public.rank_recommendations($1::uuid[], 'cart', 'en', 4, $2::uuid)`, [[ITEM.burger], SESSION]);
    for (const row of rows) {
      expect(Object.keys(row)).not.toContain('margin_score');
      expect(Object.keys(row)).not.toContain('score');
      expect(Object.keys(row)).not.toContain('unit_cm');
    }
  });
});

describe('R5: fatigue, and a halal house', () => {

  it('offers a dish passed over twice less than a fresh one', async () => {
    // The salad leads by 0.16 on the owner's ranking.
    await curate(ITEM.burger, ITEM.salad, 90);
    await curate(ITEM.burger, ITEM.slaw, 50);
    const passOver = async () => {
      const { rows } = await db.query<{ id: string }>(
        `INSERT INTO public.recommendation_decisions(session_id, placement, policy_version, chosen_item_id, source_item_id)
         VALUES ($1, 'cart', 'v3-profit', $2, $3) RETURNING id`, [SESSION, ITEM.salad, ITEM.burger]);
      await seen(rows[0].id);
    };

    expect((await ids([ITEM.burger]))[0]).toBe(ITEM.salad);
    await passOver();
    // Seen once and not taken: still first, by a little.
    expect((await ids([ITEM.burger]))[0]).toBe(ITEM.salad);
    await passOver();
    expect((await ids([ITEM.burger]))[0]).toBe(ITEM.slaw);

    // Another table's history is not this table's fatigue.
    const { rows } = await db.query<{ id: string }>(
      `SELECT id FROM public.rank_recommendations($1::uuid[], 'cart', 'en', 8, NULL, '{}'::text[])`, [[ITEM.burger]]);
    expect(rows[0].id).toBe(ITEM.salad);
  });

  it('does not hold a suggestion the guest took against it', async () => {
    await curate(ITEM.burger, ITEM.salad, 60);
    await curate(ITEM.burger, ITEM.slaw, 50);
    const { decisionId } = await decide([ITEM.burger]);
    await seen(decisionId);
    await db.query(
      `SELECT public.guest_place_order($1, $2, 'Amina', 'cash', $3::jsonb, 0)`,
      [SESSION, TOKEN, JSON.stringify([
        { menu_item_id: ITEM.salad, quantity: 1,
          from_suggestion: { source_item_id: ITEM.burger, placement: 'cart', decision_id: decisionId } },
      ])]);
    // Taken, so not "passed over" — and other sessions are unaffected either way.
    const { rows } = await db.query<{ n: number }>(`
      SELECT count(*)::int AS n FROM public.recommendation_decisions d
        JOIN public.recommendation_impressions i ON i.decision_id = d.id
       WHERE d.chosen_item_id = $1
         AND NOT EXISTS (SELECT 1 FROM public.suggestion_conversions sc WHERE sc.decision_id = d.id)`,
      [ITEM.salad]);
    expect(rows[0].n).toBe(0);
  });

  it('cannot be offered alcohol: the menu refuses it', async () => {
    await expect(db.exec(`UPDATE public.menu_items SET meal_role = 'alcohol' WHERE id = '${ITEM.cola}'`))
      .rejects.toThrow(/menu_items_no_alcohol/);
    const { rows } = await db.query<{ ok: boolean }>(
      `SELECT public.reco_role_fits('alcohol'::public.meal_role, 'cart', 'observed', true, $1::uuid[], $2::uuid,
                                    '2026-08-02 19:00+02'::timestamptz) AS ok`, [[ITEM.burger], SESSION]);
    expect(rows[0].ok).toBe(false);
  });

  it('does not hide a dish for lacking a halal tag', async () => {
    // Everything here is halal; the salad simply was never tagged.
    await curate(ITEM.burger, ITEM.salad, 90);
    const { rows } = await db.query<{ id: string }>(
      `SELECT id FROM public.guest_get_recommendations($1::uuid, $2, $3::uuid[], 'cart', 'en', 8,
                                                     '{}'::text[], '{halal}'::text[], '{}'::uuid[])`,
      [SESSION, TOKEN, [ITEM.burger]]);
    expect(rows.map((r) => r.id)).toContain(ITEM.salad);
    expect(rows.map((r) => r.id)).toContain(ITEM.cola);
  });
});

describe('the ledger records what the engine was asked about', () => {
  it('stores the cart value on the decision', async () => {
    await curate(ITEM.burger, ITEM.salad, 60);
    const { decisionId } = await decide([ITEM.burger, ITEM.cola]);
    const { rows } = await db.query<{ cart_value: string; policy_version: string }>(
      `SELECT cart_value, policy_version FROM public.recommendation_decisions WHERE id = $1`, [decisionId]);
    expect(Number(rows[0].cart_value)).toBe(24);
    expect(rows[0].policy_version).toBe('v3-profit');
  });
});
