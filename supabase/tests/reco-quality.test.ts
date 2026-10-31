/**
 * @vitest-environment node
 *
 * Suggestions a head waiter would sign, and that learn the right way round
 * (20261031120000_reco_quality.sql).
 *
 * A review of every dish of both restaurants, at 09:00, 13:00, 16:00 and
 * 20:00, on the dish page, in the cart, on the running tab and after the
 * meal, with and without a month of La Soul's orders, found nothing wrong on
 * La Soul's first night (reco-waiter-scenarios.test.ts still holds that) and
 * these, each held here as a behaviour:
 *
 *   - a pair guests take 40% of the time rises; one they take 2% falls; and
 *     what a dish does in the cart informs its dish page;
 *   - after a realistic month, a pasta's, risotto's or salad's first drink is
 *     the house's own pairing, not Coca-Cola because everybody drinks it;
 *   - a burger is offered a drink and then fries, not three drinks; and "no
 *     thanks" to a lemonade moves the other cold drinks back;
 *   - no second soft drink each, in a later round either;
 *   - a kids' drink is counted for the kids, not for the grown-ups too;
 *   - the dish page is about the dish: no fries on the Lava Cake's page;
 *   - Vera Italia's rib-eye platter is offered the caprese first;
 *   - a breakfast for two is breakfast, so no cake after it;
 *   - the ledger records the probability its choice really had;
 *   - nothing crosses between the two restaurants, the fit graph included.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { actAs, laSoulDatabase, MENU_TABLE, type Db } from './harness/la-soul-menu';
// @ts-expect-error -- plain JS generator, no types needed
import { pairingsSql, pairingUpdatesSql } from '../../scripts/vera-italia/pairings-sql.mjs';

const ROOT = path.resolve(__dirname, '..', '..');
const MIGRATIONS = path.join(ROOT, 'supabase', 'migrations');
const migration = (file: string) => readFileSync(path.join(MIGRATIONS, file), 'utf8');
const FILE = '20261031120000_reco_quality.sql';
const VERA_MENU = JSON.parse(readFileSync(path.join(ROOT, 'scripts', 'vera-italia', 'menu.json'), 'utf8'));

const L = 'a5000000-0000-4000-8000-000000000001';
const V = 'a5000000-0000-4000-8000-000000000002';
const OWNER = '10000000-0000-0000-0000-0000000000d1';
const VERA_TABLE = 'dddddddd-0000-0000-0000-0000000000d2';
const TABLE: Record<string, string> = { [L]: MENU_TABLE, [V]: VERA_TABLE };

type Placement = 'item' | 'cart' | 'tab' | 'after_meal';
type Line = string | [string, number];
interface Ask {
  venue?: string;
  at: string;
  placement: Placement;
  /** In the cart; for `item`, the dish being looked at first. */
  cart?: Line[];
  /** Already ordered this visit: served for `after_meal`, still coming otherwise. */
  ordered?: Line[];
  /** What the guest said "no thanks" to this visit. */
  dismissed?: string[];
}
interface Row { id: string; recommendation_type: string; source_item_id: string | null; suggested_quantity: number }
interface Asked { rows: Row[]; names: string[]; probability: number | null }

/** Both restaurants: La Soul's real menu (as the harness builds it) and Vera Italia's. */
async function build(): Promise<Db> {
  const db = await laSoulDatabase();
  // Vera Italia back, its pairings, then the live ranker again (the Vera
  // file restates it).
  await db.exec(migration('20261030120000_vera_italia_menu.sql'));
  await db.exec(migration('20261031090000_vera_suggestions.sql'));
  await db.exec(migration(FILE));
  await db.exec(`
    UPDATE public.restaurant_settings SET recommendations_enabled = true, reco_holdout_pct = 0, reco_exploration = 0;
    INSERT INTO public.tables(id, table_number, qr_token, venue_id) VALUES ('${VERA_TABLE}', 97, 'rq-vera', '${V}');
    INSERT INTO auth.users(id) VALUES ('${OWNER}');
    INSERT INTO public.user_roles(user_id, role, venue_id) VALUES ('${OWNER}', 'admin', NULL);
  `);
  return db;
}

/** Names → ids per restaurant (they share names: "Truffle Pasta", "Pesto Risotto"...). */
const menus: Record<string, Map<string, string>> = { [L]: new Map(), [V]: new Map() };
const names = new Map<string, string>();
const kinds = new Map<string, string>();
async function readMenu(db: Db) {
  const { rows } = await db.query<{ id: string; name: string; venue_id: string; kind: string }>(
    `SELECT mi.id, btrim(mi.name) AS name, mi.venue_id, public.reco_kind(mi.name, s.name, mi.meal_role, mi.station) AS kind
       FROM public.menu_items mi LEFT JOIN public.subcategories s ON s.id = mi.subcategory_id`);
  for (const r of rows) {
    menus[r.venue_id].set(r.name.toLowerCase(), r.id);
    names.set(r.id, r.name);
    kinds.set(r.id, r.kind);
  }
}
const idOf = (venue: string, name: string) => {
  const id = menus[venue].get(name.toLowerCase());
  if (!id) throw new Error(`not on ${venue === V ? 'Vera Italia' : 'La Soul'}'s menu: ${name}`);
  return id;
};
const line = (l: Line): [string, number] => (typeof l === 'string' ? [l, 1] : l);
const COLD = new Set(['refresher', 'soft', 'mocktail', 'juice', 'smoothie', 'water']);

/**
 * Let the worker answer vitest between questions. PGlite settles a query
 * without handing the event loop a turn, so a minute of back-to-back queries
 * (the sweep over every dish) starves the worker's own RPC until it times out.
 */
const breathe = () => new Promise<void>((resolve) => { setImmediate(resolve); });

/** One table asking, as the card does, rolled back afterwards; with the decision it recorded. */
async function ask(db: Db, a: Ask): Promise<Asked> {
  const venue = a.venue ?? L;
  await breathe();
  await db.exec('BEGIN');
  try {
    await db.query(`SELECT set_config('lasoul.reco_now', $1, true)`, [`2026-10-21 ${a.at} Europe/Sarajevo`]);
    const session = crypto.randomUUID();
    const token = `rq-${session.slice(0, 12)}`;
    await db.query(`INSERT INTO public.table_sessions(id, table_id, token, is_active, last_heartbeat_at) VALUES ($1, $2, $3, true, now())`,
      [session, TABLE[venue], token]);
    if (a.ordered?.length) {
      const served = a.placement === 'after_meal';
      const { rows } = await db.query<{ id: string }>(
        `INSERT INTO public.orders(table_session_id, total, status, payment_status, payment_method, released_to_kitchen_at, created_at)
         VALUES ($1, 0, $2, 'unpaid', 'cash', now() - interval '50 minutes', now() - interval '50 minutes') RETURNING id`,
        [session, served ? 'served' : 'preparing']);
      for (const l of a.ordered) {
        const [n, q] = line(l);
        await db.query(
          `INSERT INTO public.order_items(order_id, menu_item_id, quantity, unit_price, status, served_at)
           SELECT $1, id, $3, price, $4, CASE WHEN $5 THEN now() - interval '25 minutes' END FROM public.menu_items WHERE id = $2`,
          [rows[0].id, idOf(venue, n), q, served ? 'served' : 'pending', served]);
      }
    }
    const cart = (a.cart ?? []).map(line);
    const qty = a.placement === 'cart' || a.placement === 'tab' ? cart.map(([, q]) => q) : null;
    const { rows } = await db.query<Row>(
      `SELECT id, recommendation_type, source_item_id, suggested_quantity
         FROM public.guest_get_recommendations($1, $2, $3::uuid[], $4, 'en', 4, '{}'::text[], '{}'::text[], $5::uuid[], $6::int[])`,
      [session, token, cart.map(([n]) => idOf(venue, n)), a.placement, (a.dismissed ?? []).map((n) => idOf(venue, n)), qty]);
    const d = await db.query<{ p: string | null }>(
      `SELECT action_probability AS p FROM public.recommendation_decisions WHERE session_id = $1 ORDER BY created_at DESC LIMIT 1`, [session]);
    return { rows, names: rows.map((r) => names.get(r.id)!), probability: d.rows[0]?.p == null ? null : Number(d.rows[0].p) };
  } finally {
    await db.exec('ROLLBACK');
  }
}

async function asOwner<T>(db: Db, run: () => Promise<T>) {
  await actAs(db, OWNER);
  try { return await run(); } finally { await actAs(db, null); }
}

/* ------------------------------------------------------------------ */
/* A realistic month at La Soul                                         */
/* ------------------------------------------------------------------ */

/** A small seeded generator, so the month is the same every run. */
function generator(seed: number) {
  let a = seed;
  const next = () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pick = (w: Record<string, number>) => {
    const entries = Object.entries(w);
    let r = next() * entries.reduce((s, [, x]) => s + x, 0);
    for (const [n, x] of entries) { r -= x; if (r <= 0) return n; }
    return entries[entries.length - 1][0];
  };
  return { chance: (p: number) => next() < p, pick };
}

const BREAKFAST = { 'Turkish Egg': 3, 'Avocado on Toast': 3, 'Classic Egg Benedict': 2, 'Truffle Egg Benedict': 2, 'Breakfast Platter': 2,
  'Shakshuka Platter': 2, 'French Toast': 2, 'Granola Bowl': 1, 'Stuffed Croissant with Eggs & Cheese': 1.5, 'Puff Truffle Egg': 1 };
const MORNING_DRINK = { Cappuccino: 5, 'Flat White': 2, 'Spanish Latte': 2, 'Fresh Orange Juice': 4, 'English Breakfast Tea': 1,
  Americano: 1.5, 'Caffe Latte': 1.5, 'Iced Latte': 1, 'Fresh Lemon & Mint Juice': 0.7, Espresso: 1 };
const BURGERS = { 'La Soul Burger': 5, 'Dynamite Chicken Burger': 2, 'Classic Crispy Chicken Burger': 2, 'Manhattan Burger': 1.5,
  'Mushroom Burger': 1, 'Volcano Crispy Chicken Burger': 1.5, 'Original Burger': 1.5, 'Volcano Beef Burger': 2, 'Solar Gravity': 1.5 };
const SLIDERS = { 'Dangerous Slider': 1, 'Mix Slider': 2, 'Grilled Chicken Slider': 1, 'Midnight Slider': 1, 'Vegetable Slider': 0.5 };
const PASTA = { 'Pasta Arrabbiata': 1, 'Eggplant Spaghetti Truffle': 1, 'Alfredo Fettuccine': 1.5, 'Pesto Alfredo Fettuccine': 1, 'Truffle Pasta': 3 };
const RISOTTO = { 'Truffle Risotto': 2, 'Pink Sauce Risotto': 1, 'Risotto in Alfredo Sauce with Mushroom': 1, 'Pesto Risotto': 1.5 };
const SALADS = { 'Caesar Salad': 2, 'Caesar Salad with Chicken': 2.5, 'Falafel Salad': 1, 'Shopska Salad': 1, 'Quinoa Salad': 1, 'Beetroot Salad': 0.7 };
const STARTERS = { 'Boneless Sticky Chicken': 1, 'Dynamite Chicken': 1.5, 'Mac & Cheese Balls': 1, 'Mushroom Soup': 0.8, 'Vegetable Soup': 0.5 };
const FRIES = { 'Regular Fries': 6, 'La Soul Fries': 2, 'Seasoned Truffle Fries': 1, 'Original Cheese Fries': 0.6, 'Commando Fries': 0.5 };
/** What tables drink with a meal: the same whatever the meal, Coca-Cola the most. */
const MEAL_DRINK = { 'Coca-Cola': 6, 'Coca-Cola Zero': 2, Sprite: 1, Fanta: 1, 'Strawberry Lemonade': 3, 'Peach Lemonade': 2.5,
  'Passion Fruit Lemonade': 1.5, 'Lemon Iced Tea': 3, 'Peach Iced Tea': 2, 'Hibiscus Iced Tea': 1, 'Classic Mojito': 2.5, 'Mango Mojito': 1,
  'Sparkling Water': 2.5, 'Bottled Water': 2, 'Fresh Orange Juice': 1, 'Fresh Lemon & Mint Juice': 1 };
const DESSERT = { 'Tiramisu with Espresso Coffee Shot': 2, 'San Sebastian Cheesecake': 3, 'Lava Cake': 3, 'Tiramisu Cup': 2, 'Dubai Pudding': 1.5,
  'Chocolate Mousse Cup': 1, 'Churros': 1.2 };
const AFTER_COFFEE = { Espresso: 3, Cappuccino: 3, 'Spanish Latte': 2, Americano: 1 };
const AFTERNOON_DRINK = { Cappuccino: 3, 'Spanish Latte': 3, 'Iced Spanish Latte': 3, 'Iced Latte': 2, 'Oreo Frappe': 1.5, 'Hot Chocolate': 1.5,
  'Matcha Latte': 1, 'Classic Mojito': 1.5, Espresso: 1 };
const KIDS = { 'Chicken Burger': 1, 'Chicken Strips': 1, 'White Sauce Pasta': 1 };

async function laSoulMonth(db: Db) {
  const g = generator(20261031);
  const visit = async (daysAgo: number, hh: number, mm: number, rounds: string[][]) => {
    await breathe();
    const session = crypto.randomUUID();
    const { rows } = await db.query<{ t: string }>(
      `SELECT ((date_trunc('day', now() AT TIME ZONE 'Europe/Sarajevo') - make_interval(days => $1) + make_interval(hours => $2, mins => $3))
               AT TIME ZONE 'Europe/Sarajevo')::text AS t`, [daysAgo, hh, mm]);
    await db.query(`INSERT INTO public.table_sessions(id, table_id, token, is_active, last_heartbeat_at, opened_at)
                    VALUES ($1, $2, $3, false, $4::timestamptz, $4::timestamptz)`, [session, MENU_TABLE, `m-${session.slice(0, 12)}`, rows[0].t]);
    for (const [k, round] of rounds.filter((r) => r.length).entries()) {
      await db.query(
        `WITH o AS (
           INSERT INTO public.orders(table_session_id, total, status, payment_status, payment_method, released_to_kitchen_at, paid_at, created_at)
           VALUES ($1, 0, 'served', 'paid', 'cash', $2::timestamptz + make_interval(mins => $4), $2::timestamptz + make_interval(mins => $4),
                   $2::timestamptz + make_interval(mins => $4)) RETURNING id)
         INSERT INTO public.order_items(order_id, menu_item_id, quantity, unit_price, status)
         SELECT o.id, x.id, x.q, mi.price, 'served'
           FROM o, (SELECT id, count(*)::int AS q FROM unnest($3::uuid[]) id GROUP BY id) x JOIN public.menu_items mi ON mi.id = x.id`,
        [session, rows[0].t, round.map((n) => idOf(L, n)), k * 35]);
    }
  };
  const meal = (rounds: string[][], evening: boolean) => {
    const r = g.chance(0.38) ? BURGERS : g.chance(0.16) ? SLIDERS : g.chance(0.4) ? PASTA : g.chance(0.4) ? RISOTTO : g.chance(0.8) ? SALADS : STARTERS;
    const main = g.pick(r);
    rounds[0].push(main);
    if (g.chance(0.8)) rounds[0].push(g.pick(MEAL_DRINK));
    if ((r === BURGERS || r === SLIDERS) && g.chance(0.55)) rounds[0].push(g.pick(FRIES));
    if (g.chance(evening ? 0.35 : 0.22)) rounds[1].push(...[g.pick(DESSERT), ...(g.chance(0.55) ? [g.pick(AFTER_COFFEE)] : [])]);
  };
  for (let day = 30; day >= 1; day -= 1) {
    for (let i = 0; i < 12; i += 1) {
      const rounds: string[][] = [[], []];
      for (let p = 0; p < (g.chance(0.45) ? 2 : 1); p += 1) {
        if (g.chance(0.82)) rounds[0].push(g.pick(BREAKFAST));
        if (g.chance(0.78)) rounds[0].push(g.pick(MORNING_DRINK));
        if (g.chance(0.12)) rounds[0].push('Butter Croissant');
      }
      await visit(day, 8 + Math.floor(i / 5), (i * 13) % 60, rounds);
    }
    for (const [hh, n, evening] of [[12, 12, false], [18, 12, true]] as Array<[number, number, boolean]>) {
      for (let i = 0; i < n; i += 1) {
        const rounds: string[][] = [[], []];
        for (let p = 0; p < (g.chance(0.5) ? 2 : g.chance(0.3) ? 3 : 1); p += 1) meal(rounds, evening);
        if (g.chance(0.1)) rounds[0].push(g.pick(KIDS), 'Apple Juice');
        await visit(day, hh + Math.floor(i / 4), (i * 17) % 60, rounds);
      }
    }
    for (let i = 0; i < 9; i += 1) {
      const rounds: string[][] = [[], []];
      for (let p = 0; p < (g.chance(0.5) ? 2 : 1); p += 1) {
        rounds[0].push(g.pick(AFTERNOON_DRINK));
        if (g.chance(0.4)) rounds[0].push(g.pick(DESSERT));
      }
      await visit(day, 16 + Math.floor(i / 5), (i * 11) % 60, rounds);
    }
  }
  await asOwner(db, () => db.query(`SELECT public.refresh_menu_intelligence()`));
}

/** Suggestions shown and taken, the way the ledger records them, then the nightly refresh. */
async function record(db: Db, source: string, item: string, shown: number, taken: number) {
  for (let i = 0; i < shown; i += 1) {
    await breathe();
    const session = crypto.randomUUID();
    const { rows: at } = await db.query<{ t: string }>(
      `SELECT ((date_trunc('day', now() AT TIME ZONE 'Europe/Sarajevo') - make_interval(days => $1) + interval '13 hours')
               AT TIME ZONE 'Europe/Sarajevo')::text AS t`, [1 + (i % 20)]);
    await db.query(`INSERT INTO public.table_sessions(id, table_id, token, is_active, last_heartbeat_at, opened_at)
                    VALUES ($1, $2, $3, false, $4::timestamptz, $4::timestamptz)`, [session, MENU_TABLE, `f-${session.slice(0, 12)}`, at[0].t]);
    const { rows: d } = await db.query<{ id: string }>(
      `INSERT INTO public.recommendation_decisions(session_id, placement, policy_version, candidates, chosen_item_id, source_item_id,
                                                  recommendation_type, action_probability, cart_value, created_at)
       VALUES ($1, 'cart', public.reco_policy_version(), '[]'::jsonb, $2, $3, 'pair_with', 1, 16.5, $4::timestamptz) RETURNING id`,
      [session, idOf(L, item), idOf(L, source), at[0].t]);
    await db.query(`INSERT INTO public.recommendation_impressions(decision_id, seen_at) VALUES ($1, $2::timestamptz)`, [d[0].id, at[0].t]);
    if (i < taken) {
      const { rows: o } = await db.query<{ id: string }>(
        `INSERT INTO public.orders(table_session_id, total, status, payment_status, payment_method, released_to_kitchen_at, paid_at, created_at)
         VALUES ($1, 0, 'served', 'paid', 'cash', $2::timestamptz, $2::timestamptz, $2::timestamptz) RETURNING id`, [session, at[0].t]);
      await db.query(`INSERT INTO public.order_items(order_id, menu_item_id, quantity, unit_price, status)
                      SELECT $1, id, 1, price, 'served' FROM public.menu_items WHERE id IN ($2, $3)`, [o[0].id, idOf(L, source), idOf(L, item)]);
      await db.query(`INSERT INTO public.suggestion_conversions(order_id, source_item_id, recommended_item_id, placement, quantity, line_total, decision_id, created_at)
                      SELECT $1, $2, $3, 'cart', 1, price, $4, $5::timestamptz FROM public.menu_items WHERE id = $3`,
      [o[0].id, idOf(L, source), idOf(L, item), d[0].id, at[0].t]);
    }
  }
  await asOwner(db, () => db.query(`SELECT public.refresh_menu_intelligence()`));
}

/* ------------------------------------------------------------------ */

describe('feedback runs the right way round', () => {
  let db: Db;
  beforeAll(async () => { db = await build(); await readMenu(db); }, 240_000);
  afterAll(async () => { await db?.close(); });

  const burger = { at: '13:00', placement: 'cart' as const, cart: ['La Soul Burger'] };

  it('a pair guests take 40% of the time rises to the top; one they take 2% falls back', async () => {
    const before = (await ask(db, burger)).names;
    expect(before[0]).toBe('Strawberry Lemonade');
    expect(before.indexOf('Classic Mojito')).toBeGreaterThan(0);

    await record(db, 'La Soul Burger', 'Classic Mojito', 60, 24);
    const after = (await ask(db, burger)).names;
    expect(after[0]).toBe('Classic Mojito');

    await record(db, 'La Soul Burger', 'Strawberry Lemonade', 60, 1);
    const later = (await ask(db, burger)).names;
    expect(later[0]).toBe('Classic Mojito');
    expect(later.slice(0, 2)).not.toContain('Strawberry Lemonade');
  }, 120_000);

  it('what a dish does in the cart informs its dish page', async () => {
    // The mojito has no record on the burger's page, only in its cart.
    expect((await ask(db, { ...burger, placement: 'item' })).names[0]).toBe('Classic Mojito');
  });
});

describe('a realistic month at La Soul', () => {
  let db: Db;
  const veraBefore = new Map<string, string[]>();
  beforeAll(async () => {
    db = await build();
    await readMenu(db);
    for (const dish of menus[V].keys()) veraBefore.set(dish, (await ask(db, { venue: V, at: '20:00', placement: 'cart', cart: [dish] })).names);
    await laSoulMonth(db);
  }, 600_000);
  afterAll(async () => { await db?.close(); });

  const house = async (dish: string) => (await db.query<{ id: string }>(
    `SELECT r.recommended_item_id AS id FROM public.menu_item_recommendations r
       JOIN public.menu_items mi ON mi.subcategory_id = r.source_subcategory_id
      WHERE mi.id = $1 AND r.enabled`, [idOf(L, dish)])).rows.map((r) => names.get(r.id));

  /** How specific what A's tables taught about B is: 0 when they take it no more often than comparable tables. */
  const learned = async (dish: string, drink: string) => Number((await db.query<{ s: string | null }>(
    `SELECT max(lp.strength) AS s FROM public.reco_learned_pairs(ARRAY[$1::uuid], NULL) lp WHERE lp.item_id = $2`,
    [idOf(L, dish), idOf(L, drink)])).rows[0].s ?? 0);

  it('a pasta\'s, risotto\'s or salad\'s first drink is the house\'s or a specific pairing, not the most popular soft drink', async () => {
    let houseFirst = 0;
    let checked = 0;
    const colaFirst = new Set<string>();
    for (const dish of [...Object.keys(PASTA), ...Object.keys(RISOTTO), ...Object.keys(SALADS)]) {
      for (const at of ['13:00', '20:00']) {
        const got = await ask(db, { at, placement: 'cart', cart: [dish] });
        const firstDrink = got.rows.find((r) => COLD.has(kinds.get(r.id)!));
        expect(firstDrink, `${at} ${dish}`).toBeDefined();
        const drink = names.get(firstDrink!.id)!;
        // The house's pairing, or one this dish's own tables chose clearly
        // more often than comparable tables did (a family's apple juice, say)
        // — never a drink that is merely popular with every meal.
        const isHouse = (await house(dish)).includes(drink);
        if (!isHouse) expect(await learned(dish, drink), `${at} ${dish}: ${drink}`).toBeGreaterThan(0.5);
        if (drink === 'Coca-Cola') colaFirst.add(dish);
        houseFirst += isHouse ? 1 : 0;
        checked += 1;
      }
    }
    // Before 20261031120000 the cola led for 12 of these 15 dishes: every
    // meal's tables drink it. A dish whose own tables chose it markedly more
    // often may still lead with it — in this month a few small salads whose
    // 10 to 40 tables happened to take it a third of the time against a
    // quarter elsewhere — but that is the exception.
    expect(colaFirst.size, [...colaFirst].join(', ')).toBeLessThanOrEqual(3);
    // Mostly the house's own: tables here choose their drink alike whatever the dish.
    expect(houseFirst / checked).toBeGreaterThan(0.75);
  }, 120_000);

  it('the dish page is about the dish: no fries on the Lava Cake\'s page because of the burger in the cart', async () => {
    const got = await ask(db, { at: '20:00', placement: 'item', cart: ['Lava Cake', 'La Soul Burger'] });
    expect(kinds.get(got.rows[0].id)).toBe('hot');
    for (const r of got.rows.slice(0, 3)) expect(kinds.get(r.id), names.get(r.id)).not.toBe('fries');
  });

  it('no second soft drink each, in a later round either', async () => {
    // Burger and a Coke ordered; now the fries: nothing cold to drink again.
    const one = await ask(db, { at: '20:00', placement: 'cart', cart: ['Regular Fries'], ordered: ['La Soul Burger', 'Coca-Cola'] });
    for (const r of one.rows) expect(COLD.has(kinds.get(r.id)!), names.get(r.id)).toBe(false);
    // Two burgers and one Coke: one of them still has nothing to drink.
    const two = await ask(db, { at: '20:00', placement: 'cart', cart: ['Regular Fries'], ordered: [['La Soul Burger', 2], 'Coca-Cola'] });
    expect(two.rows.some((r) => COLD.has(kinds.get(r.id)!))).toBe(true);
    // A dessert after the burger and the Coke: coffee, not another lemonade.
    const sweet = await ask(db, { at: '20:00', placement: 'cart', cart: ['Lava Cake'], ordered: ['La Soul Burger', 'Coca-Cola'] });
    for (const r of sweet.rows) expect(COLD.has(kinds.get(r.id)!), names.get(r.id)).toBe(false);
  });

  it('nothing crosses between the restaurants, and Vera Italia is untouched by La Soul\'s month', async () => {
    for (const venue of [L, V]) {
      for (const dish of menus[venue].keys()) {
        const own = new Set(menus[venue].values());
        for (const a of [
          { at: '20:00', placement: 'cart' as const, cart: [dish] },
          { at: '21:00', placement: 'after_meal' as const, ordered: [dish] },
        ]) {
          const got = await ask(db, { venue, ...a });
          for (const r of got.rows) expect(own.has(r.id), `${dish}: ${names.get(r.id)}`).toBe(true);
        }
      }
    }
    for (const [dish, was] of veraBefore) expect((await ask(db, { venue: V, at: '20:00', placement: 'cart', cart: [dish] })).names, dish).toEqual(was);
  }, 600_000);
});

describe('the shortlist, the table and the ledger', () => {
  let db: Db;
  beforeAll(async () => { db = await build(); await readMenu(db); }, 240_000);
  afterAll(async () => { await db?.close(); });

  it('a burger is offered a drink, then fries — not three drinks', async () => {
    for (const burger of ['La Soul Burger', 'Volcano Beef Burger', 'Mix Slider']) {
      const got = await ask(db, { at: '13:00', placement: 'cart', cart: [burger] });
      expect(COLD.has(kinds.get(got.rows[0].id)!), burger).toBe(true);
      expect(kinds.get(got.rows[1].id), burger).toBe('fries');
    }
    // A pasta: a drink, then the salad.
    const pasta = await ask(db, { at: '13:00', placement: 'cart', cart: ['Truffle Pasta'] });
    expect(pasta.names.slice(0, 2)).toEqual(['Lemon Iced Tea', 'Shopska Salad']);
  });

  it('"no thanks" to the lemonade moves the other cold drinks back: the next card is the fries', async () => {
    const first = await ask(db, { at: '13:00', placement: 'cart', cart: ['La Soul Burger'] });
    const next = await ask(db, { at: '13:00', placement: 'cart', cart: ['La Soul Burger'], dismissed: [first.names[0]] });
    expect(next.names).not.toContain(first.names[0]);
    expect(kinds.get(next.rows[0].id)).toBe('fries');
  });

  it('a kids\' drink is counted for the kids, the grown-ups\' for the grown-ups', async () => {
    const got = await ask(db, { at: '13:00', placement: 'cart', cart: ['Chicken Strips', 'La Soul Burger'] });
    expect(names.get(got.rows[0].id)).toBe('Apple Juice');
    expect(got.rows[0].suggested_quantity).toBe(1);
    const family = await ask(db, { at: '13:00', placement: 'cart', cart: [['La Soul Burger', 2], ['Chicken Strips', 2]] });
    const forKids = family.rows.filter((r) => r.source_item_id === idOf(L, 'Chicken Strips') && COLD.has(kinds.get(r.id)!));
    const forAdults = family.rows.filter((r) => r.source_item_id === idOf(L, 'La Soul Burger') && COLD.has(kinds.get(r.id)!));
    expect(forKids.length).toBeGreaterThan(0);
    for (const r of forKids) expect(r.suggested_quantity, names.get(r.id)).toBe(2);
    for (const r of forAdults) expect(r.suggested_quantity, names.get(r.id)).toBe(2);
  });

  it('a breakfast for two is breakfast: coffee after it, not cake', async () => {
    const { rows } = await db.query<{ k: string }>(`SELECT public.reco_kind('Breakfast Platter for Two', 'Breakfast', 'main', 'kitchen') AS k`);
    expect(rows[0].k).toBe('breakfast');
    const after = await ask(db, { at: '13:00', placement: 'after_meal', ordered: ['Breakfast Platter for Two'] });
    expect(after.rows.length).toBeGreaterThan(0);
    expect(kinds.get(after.rows[0].id)).toBe('hot');
    for (const r of after.rows) expect(kinds.get(r.id), names.get(r.id)).not.toBe('dessert');
  });

  it('Vera Italia\'s rib-eye platter is offered the caprese first, then a starter to share', async () => {
    for (const placement of ['item', 'cart'] as const) {
      const got = await ask(db, { venue: V, at: '20:00', placement, cart: ['Rib-eye Steak Platter'] });
      expect(got.names[0], placement).toBe('Insalata Caprese');
      expect(got.names.slice(1, 3), placement).toEqual(['Bruschetta', 'Baked Feta Dip']);
    }
    // And the chicken still leads with every pasta and risotto.
    for (const dish of ['Truffle Pasta', 'Mushroom Risotto', 'Penne all\'Arrabbiata']) {
      expect((await ask(db, { venue: V, at: '20:00', placement: 'cart', cart: [dish] })).names[0], dish).toBe('Grilled Chicken');
    }
  });

  it('the rib-eye change is written in menu.json, and the applied file is left as it was', () => {
    const sql = migration(FILE).replace(/\r\n/g, '\n');
    expect(sql).toContain(pairingUpdatesSql(VERA_MENU));
    expect(migration('20261031090000_vera_suggestions.sql').replace(/\r\n/g, '\n')).toContain(pairingsSql(VERA_MENU));
  });

  it('records the probability its choice really had under the exploration in force', async () => {
    const coffee = { at: '16:00', placement: 'cart' as const, cart: ['Cappuccino'] };
    // Nothing explores: the choice was certain.
    expect((await ask(db, coffee)).probability).toBe(1);

    await db.exec(`UPDATE public.restaurant_settings SET reco_exploration = 15 WHERE venue_id = '${L}'`);
    try {
      const seen = new Map<string, { n: number; p: number[] }>();
      const N = 240;
      for (let i = 0; i < N; i += 1) {
        const got = await ask(db, coffee);
        const s = seen.get(got.names[0]) ?? { n: 0, p: [] };
        s.n += 1;
        s.p.push(got.probability!);
        seen.set(got.names[0], s);
      }
      // More than one dish comes first: exploration is on...
      expect(seen.size).toBeGreaterThan(1);
      let total = 0;
      for (const [dish, s] of seen) {
        // ...the same chance is recorded every time a dish is chosen in the same situation...
        expect(Math.max(...s.p) - Math.min(...s.p), dish).toBeLessThan(1e-6);
        // ...and it is how often it was chosen.
        expect(Math.abs(s.p[0] - s.n / N), `${dish}: recorded ${s.p[0]}, chosen ${s.n}/${N}`).toBeLessThan(0.08);
        total += s.p[0];
      }
      expect(total).toBeLessThanOrEqual(1.0001);
      expect(total).toBeGreaterThan(0.9);
    } finally {
      await db.exec(`UPDATE public.restaurant_settings SET reco_exploration = 0 WHERE venue_id = '${L}'`);
    }
  }, 240_000);

  it('a fit row for one restaurant changes only that restaurant', async () => {
    // With a drink in the cart, so the shortlist is not all basket completion.
    const appetizers = async (venue: string, ...dishes: string[]) => {
      await db.exec('BEGIN');
      try {
        await db.query(`SELECT set_config('lasoul.venue', $1, true), set_config('lasoul.reco_now', '2026-10-21 20:00 Europe/Sarajevo', true)`, [venue]);
        const { rows } = await db.query<{ kind: string }>(
          `SELECT kind FROM public.reco_rank_scored($1::uuid[], 'cart', 'en', 24, NULL, '{}'::text[], NULL)`, [dishes.map((d) => idOf(venue, d))]);
        return rows.filter((r) => r.kind === 'appetizer').length;
      } finally {
        await db.exec('ROLLBACK');
      }
    };
    expect(await appetizers(L, 'Truffle Pasta', 'Coca-Cola')).toBe(0);
    expect(await appetizers(V, 'Truffle Pasta')).toBe(0);
    await db.exec(`INSERT INTO public.reco_fit(context_kind, candidate_kind, note, venue_id) VALUES ('plate', 'appetizer', 'a starter to share', '${V}')`);
    try {
      expect(await appetizers(V, 'Truffle Pasta')).toBeGreaterThan(0);
      expect(await appetizers(L, 'Truffle Pasta', 'Coca-Cola')).toBe(0);
      // The same row for both restaurants reaches La Soul too: the column is what kept it out.
      await db.exec(`UPDATE public.reco_fit SET venue_id = NULL WHERE context_kind = 'plate' AND candidate_kind = 'appetizer'`);
      expect(await appetizers(L, 'Truffle Pasta', 'Coca-Cola')).toBeGreaterThan(0);
    } finally {
      await db.exec(`DELETE FROM public.reco_fit WHERE context_kind = 'plate' AND candidate_kind = 'appetizer'`);
    }
  });

  it('runs twice without changing a function or a rule', async () => {
    const fingerprint = async () => (await db.query(
      `SELECT (SELECT md5(string_agg(priority::text || id::text, ',' ORDER BY id)) FROM public.menu_item_recommendations) AS rules,
              (SELECT md5(string_agg(pg_get_functiondef(p.oid), '' ORDER BY p.proname))
                 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                WHERE n.nspname = 'public'
                  AND p.proname IN ('reco_rank_scored', 'rank_recommendations', 'guest_get_recommendations', 'reco_learned_pairs',
                                    'reco_kind', 'suggestion_prior', 'reco_kind_group', 'reco_kind_family')) AS functions`)).rows[0];
    const before = await fingerprint();
    await db.exec(migration(FILE));
    expect(await fingerprint()).toEqual(before);
  });
});
