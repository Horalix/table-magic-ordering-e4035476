/**
 * @vitest-environment node
 *
 * Suggestions learn per restaurant (20261030130000_suggestions_per_restaurant.sql).
 *
 * La Soul and Vera Italia share no dish, and neither is ever offered the
 * other's. What is checked here is the rest: everything a suggestion is
 * measured against — the visit and per-kind totals, the order and visit
 * counts behind every pair's strength, how often guests take a suggestion —
 * is one restaurant's. Each test gives both restaurants the same kinds of
 * dish (a main, a cold drink, a dessert), which is exactly where shared totals
 * used to mix, and shows that one restaurant's guests move nothing of the
 * other's.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
// @ts-expect-error -- plain JS harness, no types needed
import { createTestDatabase, actAs } from '../../scripts/db-harness.mjs';

type Db = {
  query: <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<{ rows: T[] }>;
  exec: (sql: string) => Promise<unknown>;
  close: () => Promise<void>;
};

const L = 'a5000000-0000-4000-8000-000000000001'; // La Soul
const V = 'a5000000-0000-4000-8000-000000000002'; // Vera Italia
const OWNER = '10000000-0000-0000-0000-0000000000a1';
const WAITER_L = '10000000-0000-0000-0000-0000000000a2';

const DISH = {
  burger: 'e1000000-0000-0000-0000-000000000001', lemonade: 'e1000000-0000-0000-0000-000000000002', cake: 'e1000000-0000-0000-0000-000000000003',
  pizza: 'e2000000-0000-0000-0000-000000000001', water: 'e2000000-0000-0000-0000-000000000002', tiramisu: 'e2000000-0000-0000-0000-000000000003',
};
const TABLE = { [L]: 'b1000000-0000-0000-0000-000000000001', [V]: 'b2000000-0000-0000-0000-000000000001' };

let db: Db;

beforeAll(async () => {
  db = (await createTestDatabase({ quiet: true })) as unknown as Db;
  await db.exec(`
    GRANT USAGE ON SCHEMA public TO anon, authenticated;
    GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;
    ALTER TABLE public.orders DISABLE TRIGGER trg_enforce_order_limits;
  `);
}, 180_000);
afterAll(async () => { await db?.close(); });

beforeEach(async () => {
  await actAs(db, null);
  await db.exec(`
    TRUNCATE public.order_items, public.orders, public.table_sessions, public.tables, public.suggestion_stats,
             public.suggestion_priors, public.reco_learning, public.reco_learned_visits, public.menu_item_affinity,
             public.session_item_affinity, public.subcategory_affinity, public.item_section_share,
             public.menu_items, public.subcategories, public.categories
      RESTART IDENTITY CASCADE;
    DELETE FROM public.user_roles;
    DELETE FROM auth.users;
    INSERT INTO auth.users(id) VALUES ('${OWNER}'), ('${WAITER_L}');
    INSERT INTO public.user_roles(user_id, role, venue_id) VALUES ('${OWNER}', 'admin', NULL), ('${WAITER_L}', 'staff', '${L}');

    INSERT INTO public.categories(id, name, sort_order, venue_id) VALUES
      ('c1000000-0000-0000-0000-000000000001', 'Food', 1, '${L}'),
      ('c2000000-0000-0000-0000-000000000001', 'Cucina', 1, '${V}');
    INSERT INTO public.subcategories(id, category_id, name, sort_order) VALUES
      ('d1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 'Burgers', 1),
      ('d1000000-0000-0000-0000-000000000002', 'c1000000-0000-0000-0000-000000000001', 'Lemonades', 2),
      ('d1000000-0000-0000-0000-000000000003', 'c1000000-0000-0000-0000-000000000001', 'Cakes', 3),
      ('d2000000-0000-0000-0000-000000000001', 'c2000000-0000-0000-0000-000000000001', 'Pizze', 1),
      ('d2000000-0000-0000-0000-000000000002', 'c2000000-0000-0000-0000-000000000001', 'Acqua', 2),
      ('d2000000-0000-0000-0000-000000000003', 'c2000000-0000-0000-0000-000000000001', 'Dolci', 3);
    INSERT INTO public.menu_items(id, subcategory_id, name, price, is_available, station, meal_role) VALUES
      ('${DISH.burger}', 'd1000000-0000-0000-0000-000000000001', 'La Soul Burger', 18, true, 'kitchen', 'main'),
      ('${DISH.lemonade}', 'd1000000-0000-0000-0000-000000000002', 'Peach Lemonade', 6, true, 'bar', 'cold_drink'),
      ('${DISH.cake}', 'd1000000-0000-0000-0000-000000000003', 'Lava Cake', 8, true, 'kitchen', 'dessert'),
      ('${DISH.pizza}', 'd2000000-0000-0000-0000-000000000001', 'Margherita', 12, true, 'kitchen', 'main'),
      ('${DISH.water}', 'd2000000-0000-0000-0000-000000000002', 'Sparkling Water', 3, true, 'bar', 'cold_drink'),
      ('${DISH.tiramisu}', 'd2000000-0000-0000-0000-000000000003', 'Tiramisu', 9, true, 'kitchen', 'dessert');
    INSERT INTO public.tables(id, table_number, qr_token, venue_id) VALUES
      ('${TABLE[L]}', 1, 'l-1', '${L}'), ('${TABLE[V]}', 1, 'v-1', '${V}');
  `);
});

/** One visit at a restaurant, as the app writes it: a table session, then one order reaching the kitchen. */
async function visit(venue: string, dishes: string[], hoursAgo = 1) {
  const session = crypto.randomUUID();
  await db.query(
    `INSERT INTO public.table_sessions(id, table_id, token, is_active, last_heartbeat_at, opened_at)
     VALUES ($1, $2, $3, false, now(), now() - make_interval(hours => $4))`,
    [session, TABLE[venue], `t-${session.slice(0, 8)}`, hoursAgo]);
  await db.query(
    `WITH o AS (
       INSERT INTO public.orders(table_session_id, total, status, payment_status, payment_method,
                                 released_to_kitchen_at, paid_at, created_at)
       VALUES ($1, 0, 'served', 'paid', 'cash', now() - make_interval(hours => $3), now(), now() - make_interval(hours => $3))
       RETURNING id)
     INSERT INTO public.order_items(order_id, menu_item_id, quantity, unit_price, status)
     SELECT o.id, mi.id, 1, mi.price, 'served' FROM o, public.menu_items mi WHERE mi.id = ANY($2::uuid[])`,
    [session, dishes, hoursAgo]);
}
const visits = async (venue: string, n: number, dishes: string[]) => {
  for (let i = 0; i < n; i++) await visit(venue, dishes, i + 1);
};

const counter = async (venue: string, level: string, key: string) =>
  (await db.query<{ tables: number }>(
    `SELECT tables FROM public.reco_learning WHERE venue_id = $1 AND ctx_level = $2 AND ctx_key = $3 AND item_id IS NULL`,
    [venue, level, key])).rows[0]?.tables ?? 0;

/** Every counter, by restaurant, in a stable order. */
const counters = async () =>
  (await db.query<{ k: string }>(
    `SELECT concat_ws('|', venue_id, ctx_level, ctx_key, item_id, tables) AS k FROM public.reco_learning ORDER BY 1`)).rows.map((r) => r.k);

async function asOwner<T>(run: () => Promise<T>) {
  await actAs(db, OWNER);
  try { return await run(); } finally { await actAs(db, null); }
}

/** What La Soul's suggestions are computed from: its pairs, their strengths, and the learned pairs for a burger. */
async function laSoulsNumbers() {
  const pairs = await db.query(
    `SELECT a.item_a, a.item_b, a.pair_orders, a.a_orders, a.confidence, a.lift, a.w_expected, a.eb05
       FROM public.menu_item_affinity a JOIN public.menu_items mi ON mi.id = a.item_a
      WHERE mi.venue_id = '${L}' ORDER BY 1, 2`);
  const visitPairs = await db.query(
    `SELECT a.item_a, a.item_b, a.pair_sessions, a.lift, a.w_expected, a.eb05
       FROM public.session_item_affinity a JOIN public.menu_items mi ON mi.id = a.item_a
      WHERE mi.venue_id = '${L}' ORDER BY 1, 2`);
  const sections = await db.query(
    `SELECT a.sub_a, a.sub_b, a.w_expected, a.eb05
       FROM public.subcategory_affinity a JOIN public.subcategories s ON s.id = a.sub_a
      WHERE s.venue_id = '${L}' ORDER BY 1, 2`);
  const learned = await db.query(
    `SELECT item_id, level, tables, attach, lift, strength
       FROM public.reco_learned_pairs(ARRAY['${DISH.burger}']::uuid[], now()) ORDER BY 1`);
  return { pairs: pairs.rows, visitPairs: visitPairs.rows, sections: sections.rows, learned: learned.rows };
}

describe('suggestions learn per restaurant', () => {
  it('a Vera Italia visit counts at Vera Italia: La Soul’s visit and per-kind totals do not move', async () => {
    await visits(L, 3, [DISH.burger, DISH.lemonade]);
    expect(await counter(L, 'all', '*')).toBe(3);
    const laSoulDrinks = await counter(L, 'kind', (await db.query<{ k: string }>(
      `SELECT public.reco_kind(mi.name, s.name, mi.meal_role, mi.station) AS k FROM public.menu_items mi
         JOIN public.subcategories s ON s.id = mi.subcategory_id WHERE mi.id = '${DISH.lemonade}'`)).rows[0].k);
    expect(laSoulDrinks).toBe(3);

    // The same kinds of dish at the other restaurant: a main and a cold drink.
    await visits(V, 4, [DISH.pizza, DISH.water]);
    expect(await counter(L, 'all', '*')).toBe(3);
    expect(await counter(V, 'all', '*')).toBe(4);
    expect(await counters()).toEqual(expect.arrayContaining([expect.stringMatching(new RegExp(`^${L}\\|kind\\|.*\\|3$`))]));
    const { rows } = await db.query<{ venue_id: string; n: number }>(
      `SELECT venue_id, count(*)::int AS n FROM public.reco_learning WHERE ctx_level = 'kind' AND item_id IS NULL GROUP BY 1 ORDER BY 1`);
    expect(rows).toEqual([{ venue_id: L, n: 2 }, { venue_id: V, n: 2 }]);
  });

  it('the full rebuild gives each restaurant exactly the counters the learner kept', async () => {
    await visits(L, 3, [DISH.burger, DISH.lemonade, DISH.cake]);
    await visits(V, 2, [DISH.pizza, DISH.tiramisu]);
    const live = await counters();
    await asOwner(() => db.query(`SELECT public.rebuild_reco_learning(365)`));
    expect(await counters()).toEqual(live);
    expect(live.filter((k) => k.startsWith(V)).length).toBeGreaterThan(0);
  });

  it('La Soul’s pair strengths and learned pairs are the same whether or not Vera Italia has guests', async () => {
    // Burger tables take the lemonade; cake tables come for cake.
    await visits(L, 18, [DISH.burger, DISH.lemonade]);
    await visits(L, 18, [DISH.cake]);
    await visits(L, 3, [DISH.burger, DISH.cake]);
    await asOwner(() => db.query(`SELECT public.refresh_menu_intelligence()`));
    const before = await laSoulsNumbers();
    expect(before.pairs.length).toBeGreaterThan(0);
    expect(before.visitPairs.length).toBeGreaterThan(0);
    expect(before.sections.length).toBeGreaterThan(0);
    expect(before.learned.map((r) => (r as { item_id: string }).item_id)).toContain(DISH.lemonade);

    // A busy week at Vera Italia, with the same kinds of dish.
    await visits(V, 12, [DISH.pizza, DISH.water]);
    await visits(V, 7, [DISH.pizza, DISH.tiramisu, DISH.water]);
    await asOwner(() => db.query(`SELECT public.refresh_menu_intelligence()`));
    expect(await laSoulsNumbers()).toEqual(before);

    // And Vera Italia's own are there, measured against its own visits.
    const { rows } = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM public.menu_item_affinity a JOIN public.menu_items mi ON mi.id = a.item_a WHERE mi.venue_id = '${V}'`);
    expect(rows[0].n).toBeGreaterThan(0);
  });

  it('each restaurant has its own rate of guests taking a suggestion', async () => {
    await db.exec(`
      INSERT INTO public.suggestion_stats(source_item_id, recommended_item_id, placement, shown, accepted) VALUES
        ('${DISH.burger}', '${DISH.lemonade}', 'cart', 100, 40),
        ('${DISH.pizza}', '${DISH.water}', 'cart', 100, 5);
    `);
    await asOwner(() => db.query(`SELECT public.refresh_suggestion_priors()`));
    const { rows } = await db.query<{ venue_id: string; m: number }>(
      `SELECT venue_id, round(alpha0 / (alpha0 + beta0), 3)::float AS m FROM public.suggestion_priors
        WHERE recommended_item_id IS NULL AND placement = 'cart' ORDER BY venue_id`);
    expect(rows.map((r) => r.venue_id)).toEqual([L, V]);
    expect(rows[0].m).toBeGreaterThan(0.3);
    expect(rows[1].m).toBeLessThan(0.1);

    // A dish with no record of its own falls back to its own restaurant's rate.
    const fallback = async (dish: string) => (await db.query<{ m: number }>(
      `SELECT round(alpha0 / (alpha0 + beta0), 3)::float AS m FROM public.suggestion_prior($1, 'cart')`, [dish])).rows[0].m;
    expect(await fallback(DISH.cake)).toBe(rows[0].m);
    expect(await fallback(DISH.tiramisu)).toBe(rows[1].m);
  });

  it('a waiter reads their own restaurant’s learned totals, never the other’s', async () => {
    await visits(L, 2, [DISH.burger, DISH.lemonade]);
    await visits(V, 2, [DISH.pizza, DISH.water]);
    await actAs(db, WAITER_L);
    await db.exec('SET ROLE authenticated');
    try {
      const { rows } = await db.query<{ venue_id: string }>(`SELECT DISTINCT venue_id FROM public.reco_learning`);
      expect(rows.map((r) => r.venue_id)).toEqual([L]);
      const priors = await db.query<{ venue_id: string }>(`SELECT DISTINCT venue_id FROM public.suggestion_priors`);
      expect(priors.rows.every((r) => r.venue_id === L)).toBe(true);
    } finally {
      await db.exec('RESET ROLE');
      await actAs(db, null);
    }
  });
});
