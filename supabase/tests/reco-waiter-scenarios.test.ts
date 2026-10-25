/**
 * @vitest-environment node
 *
 * "Would a good waiter at La Soul say this?" — on the real menu.
 *
 * The live menu as of 24 October 2026 (162 dishes, 23 sections) is loaded
 * into a fresh database and brought to where production will be after the
 * pending migrations: the October price list, the meal-role
 * reclassification, the house pairings, the owner's corrections and the
 * margin lean. There is no order history, which is the honest starting
 * point: what the engine says on its first night is what the guests meet.
 *
 * Each scenario is a table at a time of day — a cart before sending, a dish
 * page, the running tab while the food is coming, or the moment after the
 * main course — with what a head waiter would accept as the suggestion and
 * what they would never let through. Every row was read and judged; the
 * table it produces is in the report of 25 October 2026, and can be
 * regenerated with WAITER_REPORT=<file> npx vitest run <this file>.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
// @ts-expect-error -- plain JS harness, no types needed
import { createTestDatabase, actAs } from '../../scripts/db-harness.mjs';

type Db = {
  query: <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<{ rows: T[] }>;
  exec: (sql: string) => Promise<unknown>;
  close: () => Promise<void>;
};

const MIGRATIONS = path.join(__dirname, '..', 'migrations');
const migration = (file: string) => readFileSync(path.join(MIGRATIONS, file), 'utf8');
const MENU = JSON.parse(readFileSync(path.join(__dirname, 'fixtures', 'la-soul-menu-2026-10-24.json'), 'utf8')) as {
  categories: Record<string, unknown>[];
  subcategories: Record<string, unknown>[];
  menu_items: Record<string, unknown>[];
};

type Placement = 'cart' | 'item' | 'tab' | 'after_meal';
type Line = string | [string, number];

interface Scenario {
  /** Sarajevo time, on a Wednesday. */
  at: string;
  placement: Placement;
  /** In the cart (for `item`, the dish being looked at comes first). */
  cart?: Line[];
  /** Already ordered this visit. Served for `after_meal`, still coming for `tab`. */
  ordered?: Line[];
  /** The first suggestion must be one of these. */
  oneOf?: string[];
  /** None of the first three may be any of these. */
  never?: string[];
  /** Nothing is good enough: the card must stay empty. */
  empty?: boolean;
  /** How many of the first suggestion the card offers. */
  qty?: number;
}

const DRINKS_WITH_FOOD = [
  'Strawberry Lemonade', 'Peach Lemonade', 'Passion Fruit Lemonade', 'Classic Mojito', 'Mango Mojito',
  'Passion Fruit Mojito', 'Raspberry Mojito', 'Peach Mojito', 'Strawberry Mojito', 'Blue Ocean Mojito',
  'Lemon Iced Tea', 'Peach Iced Tea', 'Hibiscus Iced Tea', 'Strawberry Iced Tea', 'Coca-Cola', 'Coca-Cola Zero',
  'Fanta', 'Sprite', 'Sky Cola', 'Sky Cola Zero', 'Sparkling Water', 'Bottled Water', 'Fresh Lemon & Mint Juice',
  'Fresh Orange Juice', 'Pina Colada', 'Sunshine', 'Virgin Sunrise', 'Apple Juice', 'Cherry Juice',
  'Strawberry Juice', 'Peach Juice', 'Blueberry Juice',
];
const COFFEES = [
  'Espresso', 'Double Espresso', 'Cappuccino', 'Flat White', 'Spanish Latte', 'Caffe Latte', 'Cortado',
  'Spanish Cortado', 'Piccolo', 'Americano', 'Caffe Mocha',
];
const HOT = [...COFFEES, 'Hot Chocolate', 'Salted Caramel Hot Chocolate', 'Hot Caramel Macchiato', 'Rose Latte',
  'Matcha Latte', 'Pumpkin Spice Latte', 'Kurkum Latte', 'Latte/Karak Tea', 'English Breakfast Tea', 'Green Tea',
  'Camomile Tea', 'Hibiscus Tea', 'V60 Hot', 'Arabic Coffee White', 'Arabic Coffee Black'];
const SWEET = [
  'Tiramisu with Espresso Coffee Shot', 'San Sebastian Cheesecake', 'Lava Cake', 'Creme Brulee', 'Banana Pudding',
  'Tiramisu Cup', 'Chocolate Mousse Cup', 'Red Velvet Cup', 'Caramel Mousse Cup', 'Dubai Chocolate Cup',
  'Saffron Milk Cake Cup', 'Dubai Pudding', 'La Soul Pudding', 'Churros', 'Apple Pie', 'Asseda',
  'Malt Brownie with Ice Cream', 'Chocolate Bomb', 'Saffron Milk Cake', 'Sticky Dates Pudding', 'Butter Croissant',
];
const FRIES = ['Regular Fries', 'La Soul Fries', 'Seasoned Truffle Fries', 'Original Cheese Fries', 'Commando Fries'];
const MAINS = ['La Soul Burger', 'Truffle Pasta', 'Turkish Egg', 'Pesto Risotto', 'Mix Slider', 'Breakfast Platter'];
const NEVER_VOLUNTEERED = ['Red Bull', 'Blue Beast', 'Nescafe', 'Picnic Box Set', 'Breakfast Platter for Two'];
const SWEET_DRINKS = ['Oreo Frappe', 'Nutella Frappe', 'Pistachio Frappe', 'Vanilla Frappe', 'Fresh Avocado Juice',
  'La Soul Avo Macchiato', 'Affogato'];

const SCENARIOS: Scenario[] = [
  // ---- Breakfast, 09:00 ----
  { at: '09:00', placement: 'cart', cart: ['Turkish Egg'], oneOf: ['Cappuccino', 'Fresh Orange Juice', 'Flat White', 'Spanish Latte'], never: [...SWEET, ...FRIES, 'Coca-Cola'] },
  { at: '09:00', placement: 'cart', cart: ['Avocado on Toast'], oneOf: [...HOT, 'Fresh Orange Juice', 'Fresh Lemon & Mint Juice'], never: [...SWEET, ...FRIES, 'Classic Mojito'] },
  { at: '09:00', placement: 'cart', cart: ['French Toast', 'Cappuccino'], empty: true },
  { at: '09:00', placement: 'cart', cart: ['Breakfast Platter'], oneOf: ['Fresh Orange Juice', 'Cappuccino', 'Flat White', 'Spanish Latte'], never: SWEET },
  { at: '09:00', placement: 'cart', cart: [['Shakshuka Platter', 2]], oneOf: ['Fresh Orange Juice', 'Cappuccino', 'Flat White', 'Spanish Latte'], qty: 2 },
  { at: '09:00', placement: 'item', cart: ['Granola Bowl'], oneOf: [...HOT, 'Fresh Orange Juice', 'Fresh Lemon & Mint Juice'], never: [...SWEET, ...FRIES] },
  // Breakfast with its juice already chosen: no second drink, no cake.
  { at: '09:00', placement: 'item', cart: ['Truffle Egg Benedict', 'Fresh Orange Juice'], empty: true },
  // A croissant with the morning coffee; a cake at 09:00 is not breakfast.
  { at: '09:00', placement: 'cart', cart: ['Cappuccino'], oneOf: ['Butter Croissant'], never: [...MAINS, 'Tiramisu Cup', 'San Sebastian Cheesecake'] },
  { at: '09:00', placement: 'cart', cart: ['Fresh Orange Juice'], oneOf: ['Butter Croissant'], never: MAINS },
  { at: '09:00', placement: 'cart', cart: ['English Breakfast Tea'], oneOf: ['Butter Croissant'], never: MAINS },
  { at: '09:30', placement: 'after_meal', ordered: ['Turkish Egg', 'Fresh Orange Juice'], oneOf: HOT, never: SWEET },
  { at: '09:30', placement: 'tab', ordered: ['Classic Egg Benedict', 'Avocado on Toast'], oneOf: [...HOT, 'Fresh Orange Juice', 'Fresh Lemon & Mint Juice'], qty: 2 },

  // ---- Lunch, 13:00 ----
  { at: '13:00', placement: 'cart', cart: ['La Soul Burger'], oneOf: DRINKS_WITH_FOOD, never: [...HOT, ...SWEET, ...SWEET_DRINKS, ...MAINS] },
  { at: '13:00', placement: 'cart', cart: ['La Soul Burger', 'Coca-Cola'], oneOf: FRIES, never: [...DRINKS_WITH_FOOD, ...SWEET] },
  { at: '13:00', placement: 'cart', cart: ['La Soul Burger', 'Regular Fries'], oneOf: DRINKS_WITH_FOOD, never: [...FRIES, ...SWEET] },
  // Burger, fries and a drink: the order is complete, and no "upgrade" to a second side.
  { at: '13:00', placement: 'cart', cart: ['La Soul Burger', 'Regular Fries', 'Strawberry Lemonade'], empty: true },
  { at: '13:00', placement: 'cart', cart: ['Truffle Pasta'], oneOf: DRINKS_WITH_FOOD, never: [...FRIES, ...SWEET, ...HOT] },
  { at: '13:00', placement: 'cart', cart: ['Truffle Pasta', 'Lemon Iced Tea'], oneOf: ['Shopska Salad'], never: [...FRIES, ...SWEET] },
  { at: '13:00', placement: 'cart', cart: ['Truffle Risotto'], oneOf: DRINKS_WITH_FOOD, never: [...FRIES, ...SWEET, ...HOT] },
  { at: '13:00', placement: 'cart', cart: ['Caesar Salad'], oneOf: DRINKS_WITH_FOOD, never: [...FRIES, ...SWEET, ...HOT, ...MAINS] },
  { at: '13:00', placement: 'cart', cart: ['Mushroom Soup'], oneOf: DRINKS_WITH_FOOD, never: [...FRIES, ...SWEET, ...MAINS] },
  { at: '13:00', placement: 'cart', cart: ['Dynamite Chicken'], oneOf: DRINKS_WITH_FOOD, never: [...SWEET, ...MAINS] },
  { at: '13:00', placement: 'cart', cart: ['Mix Slider'], oneOf: [...DRINKS_WITH_FOOD, ...FRIES], never: [...SWEET, ...HOT] },
  { at: '13:00', placement: 'cart', cart: ['Chicken Strips'], oneOf: [...DRINKS_WITH_FOOD, ...FRIES], never: [...SWEET, ...HOT, ...SWEET_DRINKS] },
  { at: '13:00', placement: 'cart', cart: ['Chicken Burger Combo'], empty: true },
  { at: '13:00', placement: 'cart', cart: ['Regular Fries'], oneOf: DRINKS_WITH_FOOD, never: [...SWEET, ...MAINS] },
  { at: '13:00', placement: 'item', cart: ['Solar Gravity'], oneOf: [...DRINKS_WITH_FOOD, ...FRIES], never: [...SWEET, ...HOT, ...MAINS] },
  { at: '13:00', placement: 'item', cart: ['Peach Lemonade'], empty: true },
  { at: '13:00', placement: 'cart', cart: ['Coca-Cola'], empty: true },
  { at: '13:00', placement: 'cart', cart: ['Turkish Egg'], oneOf: ['Fresh Orange Juice', 'Cappuccino', 'Flat White', 'Spanish Latte', ...DRINKS_WITH_FOOD], never: [...SWEET, ...FRIES] },
  { at: '13:00', placement: 'cart', cart: [['La Soul Burger', 3]], oneOf: DRINKS_WITH_FOOD, qty: 3 },
  { at: '13:00', placement: 'cart', cart: [['Truffle Pasta', 2], 'Caesar Salad'], oneOf: DRINKS_WITH_FOOD, qty: 2 },
  { at: '13:15', placement: 'tab', ordered: ['La Soul Burger', 'Truffle Pasta'], oneOf: DRINKS_WITH_FOOD, never: [...HOT, ...FRIES, ...SWEET], qty: 2 },
  { at: '13:15', placement: 'tab', ordered: ['La Soul Burger', 'Coca-Cola'], empty: true },
  // After lunch the dessert that earns most leads; a coffee is right behind.
  { at: '14:00', placement: 'after_meal', ordered: ['La Soul Burger', 'Coca-Cola'], oneOf: SWEET, never: [...MAINS, ...FRIES, ...DRINKS_WITH_FOOD] },
  { at: '14:00', placement: 'after_meal', ordered: ['Truffle Pasta', 'Lemon Iced Tea'], oneOf: [...SWEET, ...HOT], never: [...MAINS, ...FRIES, ...DRINKS_WITH_FOOD] },

  // ---- Afternoon, 16:00 ----
  { at: '16:00', placement: 'cart', cart: ['Cappuccino'], oneOf: SWEET, never: MAINS },
  { at: '16:00', placement: 'cart', cart: ['Iced Spanish Latte'], oneOf: SWEET, never: [...MAINS, ...FRIES] },
  { at: '16:00', placement: 'cart', cart: ['Tiramisu Cup'], oneOf: [...HOT, 'Iced Latte', 'Iced Spanish Latte'], never: [...SWEET, ...DRINKS_WITH_FOOD] },
  { at: '16:00', placement: 'cart', cart: ['San Sebastian Cheesecake'], oneOf: HOT, never: [...SWEET, 'Coca-Cola'] },
  { at: '16:00', placement: 'cart', cart: ['Hot Chocolate'], oneOf: ['Churros', 'Butter Croissant'], never: MAINS },
  // A frappé is already dessert in a glass: nothing, not even the house pairing.
  { at: '16:00', placement: 'cart', cart: ['Oreo Frappe'], empty: true },
  { at: '16:00', placement: 'cart', cart: ['Matcha Latte'], oneOf: ['Churros', 'Butter Croissant'], never: MAINS },
  { at: '16:00', placement: 'cart', cart: ['Green Tea'], oneOf: ['Butter Croissant'], never: MAINS },
  { at: '16:00', placement: 'cart', cart: ['Fresh Avocado Juice'], never: [...MAINS, ...FRIES] },
  { at: '16:00', placement: 'item', cart: ['Lava Cake'], oneOf: [...HOT, 'Iced Latte', 'Iced Spanish Latte'], never: [...SWEET, ...DRINKS_WITH_FOOD] },
  { at: '16:00', placement: 'cart', cart: ['Butter Croissant'], oneOf: [...HOT, 'Fresh Orange Juice'], never: SWEET },
  { at: '16:00', placement: 'cart', cart: ['Churros', 'Hot Chocolate'], empty: true },
  { at: '16:00', placement: 'cart', cart: ['V60 Hot'], oneOf: SWEET, never: MAINS },
  { at: '16:00', placement: 'cart', cart: ['Mango Mojito'], empty: true },
  { at: '16:00', placement: 'cart', cart: ['Iced Latte', 'Butter Croissant'], empty: true },

  // ---- Dinner, 20:00 ----
  { at: '20:00', placement: 'cart', cart: ['Volcano Beef Burger'], oneOf: DRINKS_WITH_FOOD, never: [...HOT, ...SWEET, ...SWEET_DRINKS, ...MAINS] },
  { at: '20:00', placement: 'cart', cart: ['Pesto Risotto'], oneOf: DRINKS_WITH_FOOD, never: [...HOT, ...SWEET, ...FRIES] },
  { at: '20:00', placement: 'cart', cart: ['Pasta Arrabbiata', 'Sparkling Water'], oneOf: ['Shopska Salad'], never: [...SWEET, ...FRIES, ...DRINKS_WITH_FOOD] },
  { at: '20:00', placement: 'cart', cart: ['Caesar Salad with Chicken', 'Coca-Cola'], empty: true },
  { at: '20:00', placement: 'cart', cart: [['Solar Gravity', 2], 'Mix Slider'], oneOf: DRINKS_WITH_FOOD, qty: 3 },
  { at: '20:00', placement: 'item', cart: ['Truffle Pasta', 'Coca-Cola'], oneOf: ['Shopska Salad'], never: [...SWEET, ...FRIES, ...DRINKS_WITH_FOOD] },
  { at: '20:00', placement: 'cart', cart: ['Shopska Salad', 'Truffle Pasta'], oneOf: DRINKS_WITH_FOOD, never: [...SWEET, ...HOT] },
  { at: '20:15', placement: 'tab', ordered: [['Mushroom Burger', 2]], oneOf: DRINKS_WITH_FOOD, never: [...HOT, ...FRIES, ...SWEET], qty: 2 },
  { at: '21:00', placement: 'after_meal', ordered: ['Solar Gravity', 'Strawberry Lemonade'], oneOf: [...SWEET, ...HOT], never: [...MAINS, ...FRIES, ...DRINKS_WITH_FOOD] },
  { at: '21:00', placement: 'after_meal', ordered: ['Pesto Risotto', 'Sparkling Water'], oneOf: [...SWEET, ...HOT], never: [...MAINS, ...FRIES] },
  { at: '21:00', placement: 'after_meal', ordered: ['Chicken Burger', 'Apple Juice'], oneOf: [...SWEET, ...HOT], never: [...MAINS, ...FRIES] },
  { at: '20:00', placement: 'cart', cart: ['Mozzarella Sticks'], oneOf: [...DRINKS_WITH_FOOD, ...FRIES], never: [...SWEET, ...HOT] },

  // ---- Late, 23:30 ----
  { at: '23:30', placement: 'cart', cart: ['Midnight Slider'], oneOf: [...DRINKS_WITH_FOOD, ...FRIES], never: [...SWEET, ...HOT, ...MAINS] },
  // Late: something sweet with the espresso, but not a breakfast croissant.
  { at: '23:30', placement: 'cart', cart: ['Espresso'], oneOf: SWEET, never: [...MAINS, 'Butter Croissant'] },
  { at: '23:45', placement: 'after_meal', ordered: ['Midnight Slider', 'Coca-Cola'], oneOf: [...SWEET, ...HOT], never: [...MAINS, ...FRIES] },
  { at: '23:30', placement: 'cart', cart: ['Turkish Egg'], never: [...SWEET, ...FRIES, 'Breakfast Platter', 'French Toast'] },
  { at: '23:30', placement: 'item', cart: ['Breakfast Platter'], never: [...SWEET, ...FRIES, ...MAINS] },
  { at: '23:30', placement: 'cart', cart: ['Dubai Pudding'], oneOf: HOT, never: [...SWEET, ...DRINKS_WITH_FOOD] },
  { at: '23:30', placement: 'tab', ordered: ['Original Cheese Fries'], oneOf: DRINKS_WITH_FOOD, never: [...HOT, ...SWEET] },
];

let db: Db;
const ids = new Map<string, string>();
const names = new Map<string, string>();
const TABLE = 'dddddddd-0000-0000-0000-0000000000aa';

const idOf = (name: string) => {
  const id = ids.get(name.toLowerCase());
  if (!id) throw new Error(`not on the menu: ${name}`);
  return id;
};
const line = (l: Line): [string, number] => (typeof l === 'string' ? [l, 1] : l);

interface Suggestion { id: string; recommendation_type: string; source_item_id: string | null; suggested_quantity: number }

async function run(s: Scenario) {
  await db.exec(`SET lasoul.reco_now = '2026-10-21 ${s.at}+02'`);
  const session = crypto.randomUUID();
  await db.query(
    `INSERT INTO public.table_sessions(id, table_id, token, is_active, last_heartbeat_at)
     VALUES ($1, '${TABLE}', $2, false, now())`, [session, `w-${session.slice(0, 8)}`]);
  if (s.ordered?.length) {
    const served = s.placement === 'after_meal';
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO public.orders(table_session_id, total, status, payment_status, payment_method, released_to_kitchen_at, created_at)
       VALUES ($1, 0, $2, 'unpaid', 'cash', now(), now() - interval '50 minutes') RETURNING id`,
      [session, served ? 'served' : 'preparing']);
    for (const l of s.ordered) {
      const [name, qty] = line(l);
      await db.query(
        `INSERT INTO public.order_items(order_id, menu_item_id, quantity, unit_price, status, served_at)
         SELECT $1, id, $3, price, $4, CASE WHEN $5 THEN now() - interval '25 minutes' END
           FROM public.menu_items WHERE id = $2`,
        [rows[0].id, idOf(name), qty, served ? 'served' : 'pending', served]);
    }
  }
  const cart = (s.cart ?? []).map(line);
  const { rows } = await db.query<Suggestion>(
    `SELECT id, recommendation_type, source_item_id, suggested_quantity
       FROM public.rank_recommendations($1::uuid[], $2, 'en', 3, $3::uuid, '{}'::text[], $4::int[])`,
    [cart.map(([n]) => idOf(n)), s.placement, session, cart.map(([, q]) => q)]);
  await db.exec(`RESET lasoul.reco_now`);
  return rows;
}

const describeRow = (s: Scenario) => {
  const lines = [...(s.cart ?? []), ...(s.ordered ?? [])].map(line)
    .map(([n, q]) => (q > 1 ? `${q}× ${n}` : n)).join(' + ');
  return `${s.at} ${s.placement}: ${lines}`;
};

beforeAll(async () => {
  db = (await createTestDatabase({ quiet: true })) as unknown as Db;
  await db.query(
    `INSERT INTO public.categories(id, name, sort_order)
     SELECT (c->>'id')::uuid, c->>'name', (c->>'sort_order')::int FROM jsonb_array_elements($1::jsonb) c`,
    [JSON.stringify(MENU.categories)]);
  await db.query(
    `INSERT INTO public.subcategories(id, category_id, name, sort_order)
     SELECT (s->>'id')::uuid, (s->>'category_id')::uuid, s->>'name', (s->>'sort_order')::int
       FROM jsonb_array_elements($1::jsonb) s`,
    [JSON.stringify(MENU.subcategories)]);
  await db.query(
    `INSERT INTO public.menu_items(id, subcategory_id, name, price, is_available, station, meal_role,
                                   dietary_tags, allergens, available_from, available_to, margin_score,
                                   prep_minutes, sort_order)
     SELECT (m->>'id')::uuid, (m->>'subcategory_id')::uuid, m->>'name', (m->>'price')::numeric,
            (m->>'is_available')::boolean, m->>'station', (m->>'meal_role')::public.meal_role,
            ARRAY(SELECT jsonb_array_elements_text(COALESCE(m->'dietary_tags', '[]'::jsonb))),
            ARRAY(SELECT jsonb_array_elements_text(COALESCE(m->'allergens', '[]'::jsonb))),
            (m->>'available_from')::time, (m->>'available_to')::time,
            COALESCE((m->>'margin_score')::int, 0), (m->>'prep_minutes')::int, COALESCE((m->>'sort_order')::int, 0)
       FROM jsonb_array_elements($1::jsonb) m`,
    [JSON.stringify(MENU.menu_items)]);

  // Where production will be once the pending batch has run.
  await db.exec(migration('20261024120000_menu_prices_and_new_items.sql'));
  await db.query(`SELECT public.reclassify_meal_roles()`);
  await db.exec(migration('20261024180000_house_pairings.sql'));
  // That file also (re)creates the 7-argument coursing rule it shipped with.
  await db.exec(`DROP FUNCTION IF EXISTS public.reco_role_fits(public.meal_role, text, text, boolean, uuid[], uuid, timestamptz)`);
  await db.exec(migration('20261025150000_menu_corrections.sql'));
  await db.exec(migration('20261025160000_reco_profit.sql'));
  await db.exec(`
    UPDATE public.restaurant_settings
       SET recommendations_enabled = true, reco_holdout_pct = 0, reco_exploration = 0
     WHERE id = 1;
    INSERT INTO public.tables(id, table_number) VALUES ('${TABLE}', 99);
    ALTER TABLE public.orders DISABLE TRIGGER trg_enforce_order_limits;
  `);
  await actAs(db, null);

  const { rows } = await db.query<{ id: string; name: string }>(`SELECT id, btrim(name) AS name FROM public.menu_items`);
  for (const r of rows) {
    ids.set(r.name.toLowerCase(), r.id);
    names.set(r.id, r.name);
  }
}, 240_000);
afterAll(async () => { await db?.close(); });

describe('a good waiter at La Soul, on the real menu', () => {
  const report: string[] = [];

  for (const [i, s] of SCENARIOS.entries()) {
    it(`#${i + 1} ${describeRow(s)}`, async () => {
      const got = await run(s);
      const top = got.map((r) => names.get(r.id) ?? r.id);

      if (process.env.WAITER_REPORT) {
        const cell = (r: Suggestion | undefined) => {
          if (!r) return '—';
          const qty = r.suggested_quantity > 1 ? `${r.suggested_quantity}× ` : '';
          const why = r.source_item_id ? ` (with ${names.get(r.source_item_id)})` : '';
          return `${qty}${names.get(r.id)} [${r.recommendation_type}]${why}`;
        };
        report.push(`| ${i + 1} | ${s.at} | ${s.placement} | ${describeRow(s).replace(/^[^:]+: /, '')} | ${cell(got[0])} | ${cell(got[1])} | ${cell(got[2])} |`);
      }

      if (s.empty) {
        expect(top).toEqual([]);
        return;
      }
      expect(top.length).toBeGreaterThan(0);
      if (s.oneOf) expect(s.oneOf).toContain(top[0]);
      for (const bad of [...(s.never ?? []), ...NEVER_VOLUNTEERED]) expect(top).not.toContain(bad);
      if (s.qty) expect(got[0].suggested_quantity).toBe(s.qty);

      // Never what is already on the table this round.
      for (const [n] of (s.cart ?? []).map(line)) expect(top).not.toContain(n);
      // The tab and after the meal have narrow briefs.
      if (s.placement === 'tab') for (const n of top) expect([...DRINKS_WITH_FOOD, ...HOT]).toContain(n);
      if (s.placement === 'after_meal') for (const n of top) expect([...SWEET, ...HOT]).toContain(n);
    });
  }

  afterAll(() => {
    if (!process.env.WAITER_REPORT) return;
    writeFileSync(process.env.WAITER_REPORT, [
      '| # | time | where | on the table | 1st | 2nd | 3rd |',
      '|---|---|---|---|---|---|---|',
      ...report,
    ].join('\n') + '\n');
  });
});
