/**
 * @vitest-environment node
 *
 * Vera Italia's suggestions from the first night
 * (20261031090000_vera_suggestions.sql).
 *
 * Before it, Vera Italia's guests were suggested nothing at all — not on the
 * first night and not after weeks of orders: everything had to pass La
 * Soul's café fit graph, and nothing on an Italian menu without drinks or
 * desserts did. Here, on the real migrations with La Soul's real menu, its
 * house pairings and a month of its orders beside Vera Italia's:
 *
 *   - every pizza, pasta, risotto and the steak is suggested something a
 *     waiter there would say, from the first night;
 *   - the grilled chicken leads for pasta and risotto, unless the guest
 *     filtered for vegetarian dishes;
 *   - once Vera Italia's own tables have a history, what they chose comes
 *     through;
 *   - no La Soul dish is ever offered at Vera Italia, and La Soul's own
 *     suggestions are exactly what they were without this migration;
 *   - a Vera Italia admin can neither read nor change La Soul's rules.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
// @ts-expect-error -- plain JS harness, no types needed
import { createTestDatabase, actAs } from '../../scripts/db-harness.mjs';
// @ts-expect-error -- plain JS generator, no types needed
import { pairingsSql } from '../../scripts/vera-italia/pairings-sql.mjs';

type Db = {
  query: <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<{ rows: T[] }>;
  exec: (sql: string) => Promise<unknown>;
  close: () => Promise<void>;
};

const ROOT = path.resolve(__dirname, '..', '..');
const FILE = '20261031090000_vera_suggestions.sql';
const MIGRATION = readFileSync(path.join(ROOT, 'supabase', 'migrations', FILE), 'utf8');
const LA_SOUL_MENU = JSON.parse(readFileSync(path.join(__dirname, 'fixtures', 'la-soul-menu-2026-10-24.json'), 'utf8'));
const VERA_MENU = JSON.parse(readFileSync(path.join(ROOT, 'scripts', 'vera-italia', 'menu.json'), 'utf8'));

const L = 'a5000000-0000-4000-8000-000000000001';
const V = 'a5000000-0000-4000-8000-000000000002';
const OWNER = '10000000-0000-0000-0000-0000000000c1';
const VERA_ADMIN = '10000000-0000-0000-0000-0000000000c2';
const TABLE = { [L]: 'dddddddd-0000-0000-0000-0000000000c1', [V]: 'dddddddd-0000-0000-0000-0000000000c2' };

interface Dish { id: string; slug: string; name: string; section: string }
const VERA: Dish[] = VERA_MENU.categories.flatMap((c: { sections: { name: string; items: Dish[] }[] }) =>
  c.sections.flatMap((s) => s.items.map((it) => ({ id: it.id, slug: it.slug, name: it.name, section: s.name }))));
const vera = (slug: string) => {
  const d = VERA.find((x) => x.slug === slug);
  if (!d) throw new Error(`not on Vera Italia's menu: ${slug}`);
  return d;
};
const inSection = (...names: string[]) => VERA.filter((d) => names.includes(d.section));

const PIZZAS = inSection('Classiche', 'Speciali');
const PASTA_AND_RISOTTO = inSection('Pasta', 'Risotto');
const STEAK = inSection('Bistecca');
const CHICKEN = vera('grilled-chicken').id;
const SALADS = [vera('caprese').id, vera('grilled-vegetables').id];
const STARTERS = [vera('bruschetta').id, vera('feta-dip').id];

type Placement = 'item' | 'cart' | 'tab' | 'after_meal';
interface Ask {
  at: string;
  placement: Placement;
  cart?: Array<[string, number]>;
  ordered?: string[];
  tags?: string[];
}
interface Row { id: string; recommendation_type: string; source_item_id: string | null; suggested_quantity: number }

/** One table: a session, what it already ordered, and the guest's own request, through the guest function. */
async function ask(d: Db, venue: string, day: string, a: Ask): Promise<Row[]> {
  await d.exec(`SET lasoul.reco_now = '${day} ${a.at} Europe/Sarajevo'`);
  const session = crypto.randomUUID();
  const token = `t-${session.slice(0, 12)}`;
  await d.query(
    `INSERT INTO public.table_sessions(id, table_id, token, is_active, last_heartbeat_at) VALUES ($1, $2, $3, true, now())`,
    [session, TABLE[venue], token]);
  if (a.ordered?.length) {
    const served = a.placement === 'after_meal';
    const { rows } = await d.query<{ id: string }>(
      `INSERT INTO public.orders(table_session_id, total, status, payment_status, payment_method, released_to_kitchen_at, created_at)
       VALUES ($1, 0, $2, 'unpaid', 'cash', now() - interval '50 minutes', now() - interval '50 minutes') RETURNING id`,
      [session, served ? 'served' : 'preparing']);
    for (const id of a.ordered) {
      await d.query(
        `INSERT INTO public.order_items(order_id, menu_item_id, quantity, unit_price, status, served_at)
         SELECT $1, id, 1, price, $3, CASE WHEN $4 THEN now() - interval '25 minutes' END FROM public.menu_items WHERE id = $2`,
        [rows[0].id, id, served ? 'served' : 'pending', served]);
    }
  }
  const cart = a.cart ?? [];
  // As the card sends it: portions only where the whole order is in view.
  const qty = a.placement === 'cart' || a.placement === 'tab' ? cart.map(([, q]) => q) : null;
  try {
    return (await d.query<Row>(
      `SELECT id, recommendation_type, source_item_id, suggested_quantity
         FROM public.guest_get_recommendations($1, $2, $3::uuid[], $4, 'en', 4, '{}'::text[], $5::text[], '{}'::uuid[], $6::int[])`,
      [session, token, cart.map(([id]) => id), a.placement, a.tags ?? [], qty])).rows;
  } finally {
    await d.query(`UPDATE public.table_sessions SET is_active = false WHERE id = $1`, [session]);
    await d.exec(`RESET lasoul.reco_now`);
  }
}

/** One finished visit, `daysAgo` before `day`, at dinner. */
async function visit(d: Db, venue: string, day: string, dishes: string[], daysAgo: number, minute: number) {
  const session = crypto.randomUUID();
  const at = `('${day} 19:00 Europe/Sarajevo'::timestamptz - make_interval(days => ${daysAgo}) + make_interval(mins => ${minute}))`;
  await d.query(
    `INSERT INTO public.table_sessions(id, table_id, token, is_active, last_heartbeat_at, opened_at)
     VALUES ($1, $2, $3, false, ${at}, ${at})`, [session, TABLE[venue], `h-${session.slice(0, 12)}`]);
  await d.query(
    `WITH o AS (
       INSERT INTO public.orders(table_session_id, total, status, payment_status, payment_method,
                                 released_to_kitchen_at, paid_at, created_at)
       VALUES ($1, 0, 'served', 'paid', 'cash', ${at}, ${at}, ${at}) RETURNING id)
     INSERT INTO public.order_items(order_id, menu_item_id, quantity, unit_price, status, served_at)
     SELECT o.id, mi.id, 1, mi.price, 'served', ${at} + interval '20 minutes'
       FROM o, public.menu_items mi WHERE mi.id = ANY($2::uuid[])`,
    [session, dishes]);
}

async function asOwner<T>(d: Db, run: () => Promise<T>) {
  await actAs(d, OWNER);
  try { return await run(); } finally { await actAs(d, null); }
}

/** La Soul's names → ids, its own dishes only (Vera Italia has dishes of the same names). */
const laSoul = new Map<string, string>();
const ls = (name: string) => {
  const id = laSoul.get(name.toLowerCase());
  if (!id) throw new Error(`not on La Soul's menu: ${name}`);
  return id;
};

/**
 * What this file is about is 20261031090000 itself, so its database stops
 * before the next migration that restates the ranker and Vera Italia's
 * rib-eye pairings (20261031120000_reco_quality.sql, tested in
 * reco-quality.test.ts) — the same way the database "without" it, below,
 * stops before it.
 */
const NEXT_RANKER = '20261031120000';

/** A database as production has it: La Soul's menu, its house pairings and a month of its orders. */
async function build(until: string = NEXT_RANKER): Promise<Db> {
  const d = (await createTestDatabase({ quiet: true, until })) as unknown as Db;
  await d.exec(`
    GRANT USAGE ON SCHEMA public TO anon, authenticated;
    ALTER TABLE public.orders DISABLE TRIGGER trg_enforce_order_limits;
  `);
  await d.query(`INSERT INTO public.categories(id, name, sort_order)
     SELECT (c->>'id')::uuid, c->>'name', (c->>'sort_order')::int FROM jsonb_array_elements($1::jsonb) c`,
  [JSON.stringify(LA_SOUL_MENU.categories)]);
  await d.query(`INSERT INTO public.subcategories(id, category_id, name, sort_order)
     SELECT (s->>'id')::uuid, (s->>'category_id')::uuid, s->>'name', (s->>'sort_order')::int FROM jsonb_array_elements($1::jsonb) s`,
  [JSON.stringify(LA_SOUL_MENU.subcategories)]);
  await d.query(`INSERT INTO public.menu_items(id, subcategory_id, name, price, is_available, station, meal_role,
                                 dietary_tags, allergens, available_from, available_to, margin_score, prep_minutes, sort_order)
     SELECT (m->>'id')::uuid, (m->>'subcategory_id')::uuid, m->>'name', (m->>'price')::numeric,
            (m->>'is_available')::boolean, m->>'station', (m->>'meal_role')::public.meal_role,
            ARRAY(SELECT jsonb_array_elements_text(COALESCE(m->'dietary_tags', '[]'::jsonb))),
            ARRAY(SELECT jsonb_array_elements_text(COALESCE(m->'allergens', '[]'::jsonb))),
            (m->>'available_from')::time, (m->>'available_to')::time,
            COALESCE((m->>'margin_score')::int, 0), (m->>'prep_minutes')::int, COALESCE((m->>'sort_order')::int, 0)
       FROM jsonb_array_elements($1::jsonb) m`, [JSON.stringify(LA_SOUL_MENU.menu_items)]);
  if (laSoul.size === 0) {
    const { rows } = await d.query<{ id: string; name: string }>(
      `SELECT id, btrim(name) AS name FROM public.menu_items WHERE venue_id = '${L}'`);
    for (const r of rows) laSoul.set(r.name.toLowerCase(), r.id);
  }
  // A sample of La Soul's house pairings, bound to its own sections and dishes.
  const rules: Array<[string | null, string, string, number]> = [
    ['Burgers', 'Regular Fries', 'pair_with', 90], ['Burgers', 'Strawberry Lemonade', 'pair_with', 70],
    ['Pasta', 'Lemon Iced Tea', 'pair_with', 70], ['Pasta', 'Shopska Salad', 'pair_with', 55],
    ['Risotto', 'Sparkling Water', 'pair_with', 65], ['Risotto', 'Shopska Salad', 'pair_with', 55],
    ['Breakfast', 'Fresh Orange Juice', 'pair_with', 90], ['Breakfast', 'Flat White', 'pair_with', 70],
    ['Coffee', 'Butter Croissant', 'pair_with', 80], ['Hot Drinks', 'Churros', 'pair_with', 75],
    ['Desserts', 'Espresso', 'pair_with', 85],
    [null, 'Tiramisu with Espresso Coffee Shot', 'after_meal', 80], [null, 'San Sebastian Cheesecake', 'after_meal', 75],
    [null, 'Lava Cake', 'after_meal', 70], [null, 'Espresso', 'after_meal', 70],
  ];
  for (const [section, dish, type, priority] of rules) {
    const { rows } = await d.query(
      `INSERT INTO public.menu_item_recommendations(source_subcategory_id, recommended_item_id, recommendation_type, priority)
       SELECT (SELECT id FROM public.subcategories WHERE btrim(name) = $1 AND venue_id = '${L}'), $2, $3, $4
       RETURNING id`, [section, ls(dish), type, priority]);
    expect(rows.length).toBe(1);
  }
  await d.exec(`
    INSERT INTO auth.users(id) VALUES ('${OWNER}'), ('${VERA_ADMIN}');
    INSERT INTO public.user_roles(user_id, role, venue_id) VALUES ('${OWNER}', 'admin', NULL), ('${VERA_ADMIN}', 'admin', '${V}');
    INSERT INTO public.tables(id, table_number, qr_token, venue_id) VALUES
      ('${TABLE[L]}', 801, 'vs-l', '${L}'), ('${TABLE[V]}', 801, 'vs-v', '${V}');
    UPDATE public.restaurant_settings SET recommendations_enabled = true, reco_holdout_pct = 0, reco_exploration = 0;
  `);
  return d;
}

let db: Db;
let DAY = '';
const offeredAtVera: string[] = [];
/** Every answer at Vera Italia, so the last test can check none of it was La Soul's. */
const atVera = async (a: Ask) => {
  const rows = await ask(db, V, DAY, a);
  offeredAtVera.push(...rows.map((r) => r.id));
  return rows;
};
const ids = (rows: Row[]) => rows.map((r) => r.id);

beforeAll(async () => {
  db = await build();
  DAY = (await db.query<{ d: string }>(`SELECT to_char(now() AT TIME ZONE 'Europe/Sarajevo', 'YYYY-MM-DD') AS d`)).rows[0].d;
  // A month of La Soul.
  const month: Array<[number, string[]]> = [
    [15, ['La Soul Burger', 'Coca-Cola']], [10, ['Truffle Pasta', 'Lemon Iced Tea']],
    [10, ['Cappucino', 'Butter Croissant']], [8, ['Lava Cake', 'Espresso']], [6, ['Pesto Risotto', 'Sparkling Water']],
  ];
  let k = 0;
  for (const [n, dishes] of month) for (let i = 0; i < n; i++) await visit(db, L, DAY, dishes.map(ls), 1 + (k++ % 25), i % 60);
  await asOwner(db, () => db.query(`SELECT public.refresh_menu_intelligence()`));
}, 240_000);
afterAll(async () => { await db?.close(); });

describe('the migration', () => {
  it('carries exactly the pairings written in menu.json', () => {
    expect(VERA_MENU.pairings.length).toBe(15);
    expect(MIGRATION.replace(/\r\n/g, '\n')).toContain(pairingsSql(VERA_MENU));
  });

  it('gives Vera Italia its pairings, by section, as Vera Italia\'s rules', async () => {
    const { rows } = await db.query<{ venue_id: string; n: number; sections: number }>(
      `SELECT r.venue_id, count(*)::int AS n, count(DISTINCT r.source_subcategory_id)::int AS sections
         FROM public.menu_item_recommendations r JOIN public.menu_items mi ON mi.id = r.recommended_item_id
        WHERE mi.venue_id = '${V}' GROUP BY 1`);
    // Pasta, Risotto, the two pizza sections and the steak.
    expect(rows).toEqual([{ venue_id: V, n: 15, sections: 5 }]);
  });

  it('reads Italian sections: the salads are salads, the chicken is an extra', async () => {
    const { rows } = await db.query<{ id: string; kind: string }>(
      `SELECT mi.id, public.reco_kind(mi.name, s.name, mi.meal_role, mi.station) AS kind
         FROM public.menu_items mi JOIN public.subcategories s ON s.id = mi.subcategory_id WHERE mi.venue_id = '${V}'`);
    const kind = Object.fromEntries(rows.map((r) => [VERA.find((d) => d.id === r.id)?.slug, r.kind]));
    expect(kind).toMatchObject({
      caprese: 'salad', 'grilled-vegetables': 'salad', bruschetta: 'appetizer', 'feta-dip': 'appetizer',
      'grilled-chicken': 'extra', margherita: 'plate', 'truffle-pasta': 'plate', 'ribeye-platter': 'plate',
    });
  });

  it('runs twice without a second rule or a different function', async () => {
    const fingerprint = async () => (await db.query(
      `SELECT (SELECT count(*)::int FROM public.menu_item_recommendations) AS rules,
              md5(pg_get_functiondef('public.rank_recommendations(uuid[],text,text,int,uuid,text[],int[])'::regprocedure)
                  || pg_get_functiondef('public.reco_kind(text,text,public.meal_role,text)'::regprocedure)) AS functions,
              (SELECT string_agg(policyname, ',' ORDER BY policyname) FROM pg_policies
                WHERE tablename = 'menu_item_recommendations') AS policies`)).rows[0];
    const before = await fingerprint();
    await db.exec(MIGRATION);
    expect(await fingerprint()).toEqual(before);
  });
});

describe('Vera Italia on its first night', () => {
  it('suggests the grilled chicken first with every pasta and risotto, on the dish and in the cart', async () => {
    for (const dish of PASTA_AND_RISOTTO) {
      for (const placement of ['item', 'cart'] as const) {
        const rows = await atVera({ at: '20:00', placement, cart: [[dish.id, 1]] });
        expect(rows[0]?.id, `${placement}: ${dish.name}`).toBe(CHICKEN);
        expect(rows[0].recommendation_type).toBe('add_on');
        expect(rows[0].source_item_id).toBe(dish.id);
        // Then a salad, never another main.
        for (const r of rows.slice(1)) expect(SALADS).toContain(r.id);
      }
    }
  });

  it('the chicken still leads while the engine explores, as it does in production', async () => {
    // Exploration gives each dish a random lift per table (seeded by the
    // table): the salads' priorities are low enough that it never overtakes.
    await db.exec(`UPDATE public.restaurant_settings SET reco_exploration = 15 WHERE venue_id = '${V}'`);
    try {
      for (const dish of PASTA_AND_RISOTTO) {
        for (let i = 1; i <= 20; i++) {
          await db.exec('BEGIN');
          try {
            await db.query(`SELECT set_config('lasoul.venue', '${V}', true), set_config('lasoul.reco_now', $1, true)`,
              [`${DAY} 20:00 Europe/Sarajevo`]);
            const { rows } = await db.query<{ id: string }>(
              `SELECT id FROM public.rank_recommendations(ARRAY[$1::uuid], 'cart', 'en', 1, $2::uuid, '{}'::text[], NULL)`,
              [dish.id, `eeeeeeee-0000-4000-8000-${String(i).padStart(12, '0')}`]);
            expect(rows[0]?.id, `${dish.name}, table ${i}`).toBe(CHICKEN);
          } finally {
            await db.exec('ROLLBACK');
          }
        }
      }
    } finally {
      await db.exec(`UPDATE public.restaurant_settings SET reco_exploration = 0 WHERE venue_id = '${V}'`);
    }
  });

  it('a guest who filtered for vegetarian dishes is never offered the chicken, but still a salad', async () => {
    for (const dish of PASTA_AND_RISOTTO) {
      const rows = await atVera({ at: '20:00', placement: 'cart', cart: [[dish.id, 1]], tags: ['vegetarian'] });
      expect(ids(rows), dish.name).not.toContain(CHICKEN);
      expect(SALADS).toContain(rows[0]?.id);
    }
  });

  it('with the chicken already in the cart, a salad', async () => {
    const rows = await atVera({ at: '20:00', placement: 'cart', cart: [[vera('truffle-pasta').id, 1], [CHICKEN, 1]] });
    expect(SALADS).toContain(rows[0]?.id);
    expect(ids(rows)).not.toContain(CHICKEN);
  });

  it('suggests a salad or a starter to share with every pizza, never the chicken', async () => {
    for (const dish of PIZZAS) {
      for (const placement of ['item', 'cart'] as const) {
        const rows = await atVera({ at: '20:00', placement, cart: [[dish.id, 1]] });
        expect([...SALADS, ...STARTERS], `${placement}: ${dish.name}`).toContain(rows[0]?.id);
        for (const r of rows) expect([...SALADS, ...STARTERS]).toContain(r.id);
      }
    }
    // The classics already have tomato and mozzarella: grilled vegetables, not a caprese.
    expect((await atVera({ at: '20:00', placement: 'cart', cart: [[vera('margherita').id, 1]] }))[0].id)
      .toBe(vera('grilled-vegetables').id);
    expect((await atVera({ at: '20:00', placement: 'cart', cart: [[vera('truffle-pizza').id, 1]] }))[0].id)
      .toBe(vera('caprese').id);
  });

  it('suggests a starter to share with the rib-eye platter, which already has its salad and fries', async () => {
    for (const placement of ['item', 'cart'] as const) {
      const rows = await atVera({ at: '20:00', placement, cart: [[STEAK[0].id, 1]] });
      expect(STARTERS, placement).toContain(rows[0]?.id);
      expect(ids(rows)).not.toContain(CHICKEN);
    }
  });

  it('a pizza with a starter already chosen is offered a salad, not a second starter', async () => {
    const rows = await atVera({ at: '20:00', placement: 'cart', cart: [[vera('margherita').id, 1], [vera('bruschetta').id, 1]] });
    expect(SALADS).toContain(rows[0]?.id);
    for (const r of rows) expect(STARTERS).not.toContain(r.id);
  });

  it('suggests nothing where nothing fits: a starter alone, the tab and after the meal', async () => {
    expect(await atVera({ at: '20:00', placement: 'cart', cart: [[vera('bruschetta').id, 1]] })).toEqual([]);
    expect(await atVera({ at: '20:00', placement: 'item', cart: [[vera('caprese').id, 1]] })).toEqual([]);
    // No drinks on the menu: nothing for the table while it waits.
    expect(await atVera({ at: '20:15', placement: 'tab', ordered: [vera('margherita').id, vera('truffle-pasta').id] })).toEqual([]);
    // No desserts or coffee: nothing after the meal.
    expect(await atVera({ at: '21:00', placement: 'after_meal', ordered: [vera('truffle-pizza').id] })).toEqual([]);
  });

  it('works for a guest exactly as for the database owner: the rules\' access rules are not in the way', async () => {
    const session = crypto.randomUUID();
    await db.query(`INSERT INTO public.table_sessions(id, table_id, token, is_active, last_heartbeat_at)
                    VALUES ($1, '${TABLE[V]}', 'anon-guest-token', true, now())`, [session]);
    await db.exec(`SET lasoul.reco_now = '${DAY} 20:00 Europe/Sarajevo'`);
    await db.exec('SET ROLE anon');
    try {
      const { rows } = await db.query<Row>(
        `SELECT id FROM public.guest_get_recommendations($1, 'anon-guest-token', ARRAY['${vera('truffle-pasta').id}']::uuid[], 'cart')`,
        [session]);
      expect(rows[0]?.id).toBe(CHICKEN);
    } finally {
      await db.exec('RESET ROLE');
      await db.exec('RESET lasoul.reco_now');
    }
  });
});

describe('Vera Italia once its tables have a history', () => {
  beforeAll(async () => {
    const weeks: Array<[number, string[]]> = [
      [10, ['margherita', 'caprese']], [6, ['truffle-pizza', 'bruschetta']], [6, ['burrata-pizza', 'grilled-vegetables']],
      [8, ['truffle-pasta', 'grilled-chicken']], [5, ['alfredo-fettuccine', 'grilled-chicken']],
      [6, ['truffle-risotto', 'grilled-chicken']], [4, ['pesto-risotto', 'caprese']],
      [4, ['ribeye-platter', 'bruschetta']], [3, ['ribeye-platter', 'feta-dip']], [5, ['pepperoni']],
      [3, ['arrabbiata', 'grilled-chicken']],
    ];
    let k = 0;
    for (const [n, slugs] of weeks) {
      for (let i = 0; i < n; i++) await visit(db, V, DAY, slugs.map((s) => vera(s).id), 1 + (k++ % 14), (k * 7) % 120);
    }
    await asOwner(db, () => db.query(`SELECT public.refresh_menu_intelligence()`));
  }, 120_000);

  it('offers what its own tables chose, and says so', async () => {
    // Ten Margherita tables took the caprese: it now leads over the house pairing.
    const margherita = await atVera({ at: '20:00', placement: 'cart', cart: [[vera('margherita').id, 1]] });
    expect(margherita[0].id).toBe(vera('caprese').id);
    expect(margherita[0].recommendation_type).toBe('frequently_bought_together');
    const truffle = await atVera({ at: '20:00', placement: 'item', cart: [[vera('truffle-pizza').id, 1]] });
    expect(truffle[0].id).toBe(vera('bruschetta').id);
    expect(truffle[0].recommendation_type).toBe('frequently_bought_together');
    const { rows } = await db.query<{ e: { kind: string } }>(
      `SELECT public.suggestion_evidence($1, $2) AS e`, [vera('margherita').id, vera('caprese').id]);
    expect(['qualitative', 'quantified']).toContain(rows[0].e.kind);
  });

  it('still leads with the chicken for pasta and risotto', async () => {
    for (const dish of PASTA_AND_RISOTTO) {
      const rows = await atVera({ at: '20:00', placement: 'cart', cart: [[dish.id, 1]] });
      expect(rows[0]?.id, dish.name).toBe(CHICKEN);
    }
  });

  it('never offers a La Soul dish, whichever source proposed it', () => {
    expect(offeredAtVera.length).toBeGreaterThan(50);
    const ours = new Set(VERA.map((d) => d.id));
    expect(offeredAtVera.filter((id) => !ours.has(id))).toEqual([]);
  });
});

describe('suggestion rules belong to a restaurant', () => {
  const asUser = async <T>(user: string, venueHeader: string | null, run: () => Promise<T>) => {
    await actAs(db, user);
    await db.query(`SELECT set_config('request.headers', $1, false)`,
      [venueHeader ? JSON.stringify({ 'x-venue': venueHeader }) : '']);
    await db.exec('SET ROLE authenticated');
    try { return await run(); } finally {
      await db.exec('RESET ROLE');
      await db.query(`SELECT set_config('request.headers', '', false)`);
      await actAs(db, null);
    }
  };
  // The rules alone: joined to the menu, the menu's own lens would hide a leak.
  const ruleVenues = async () => (await db.query<{ v: string }>(
    `SELECT DISTINCT venue_id AS v FROM public.menu_item_recommendations ORDER BY 1`)).rows.map((r) => r.v);

  it('a Vera Italia admin sees only Vera Italia\'s rules, even asking for La Soul\'s', async () => {
    expect(await asUser(VERA_ADMIN, 'veraitalia', ruleVenues)).toEqual([V]);
    expect(await asUser(VERA_ADMIN, 'lasoul', ruleVenues)).toEqual([V]);
    expect(await asUser(VERA_ADMIN, null, ruleVenues)).toEqual([V]);
  });

  it('a Vera Italia admin cannot change, remove or add La Soul\'s rules', async () => {
    const before = (await db.query<{ id: string; priority: number; enabled: boolean }>(
      `SELECT id, priority, enabled FROM public.menu_item_recommendations WHERE venue_id = '${L}' ORDER BY id`)).rows;
    expect(before.length).toBeGreaterThan(0);
    await asUser(VERA_ADMIN, 'lasoul', async () => {
      const changed = await db.query(`UPDATE public.menu_item_recommendations SET priority = 1, enabled = false
                                       WHERE venue_id = '${L}' RETURNING id`);
      expect(changed.rows).toEqual([]);
      const removed = await db.query(`DELETE FROM public.menu_item_recommendations WHERE venue_id = '${L}' RETURNING id`);
      expect(removed.rows).toEqual([]);
      // A rule suggesting a La Soul dish is La Soul's, whatever the request says.
      await expect(db.query(
        `INSERT INTO public.menu_item_recommendations(source_item_id, recommended_item_id, recommendation_type, priority)
         VALUES ($1, $2, 'pair_with', 50)`, [ls('La Soul Burger'), ls('Coca-Cola')])).rejects.toThrow();
      await expect(db.query(
        `INSERT INTO public.menu_item_recommendations(source_item_id, recommended_item_id, recommendation_type, priority, venue_id)
         VALUES ($1, $2, 'pair_with', 50, '${V}')`, [ls('La Soul Burger'), ls('Coca-Cola')])).rejects.toThrow();
    });
    const after = (await db.query(
      `SELECT id, priority, enabled FROM public.menu_item_recommendations WHERE venue_id = '${L}' ORDER BY id`)).rows;
    expect(after).toEqual(before);
  });

  it('a Vera Italia admin manages Vera Italia\'s own, and a rule cannot mix the two restaurants', async () => {
    await asUser(VERA_ADMIN, 'veraitalia', async () => {
      const { rows } = await db.query<{ venue_id: string }>(
        `INSERT INTO public.menu_item_recommendations(source_item_id, recommended_item_id, recommendation_type, priority)
         VALUES ($1, $2, 'pair_with', 40) RETURNING venue_id`, [vera('pepperoni').id, vera('feta-dip').id]);
      expect(rows).toEqual([{ venue_id: V }]);
      await db.query(`UPDATE public.menu_item_recommendations SET priority = 45 WHERE source_item_id = $1`, [vera('pepperoni').id]);
      // A La Soul dish as what it goes with: refused.
      await expect(db.query(
        `INSERT INTO public.menu_item_recommendations(source_item_id, recommended_item_id, recommendation_type, priority)
         VALUES ($1, $2, 'pair_with', 40)`, [ls('La Soul Burger'), vera('bruschetta').id])).rejects.toThrow(/Not available at this restaurant/);
      await db.query(`DELETE FROM public.menu_item_recommendations WHERE source_item_id = $1`, [vera('pepperoni').id]);
    });
    expect((await db.query(`SELECT 1 FROM public.menu_item_recommendations WHERE source_item_id = $1`, [vera('pepperoni').id])).rows)
      .toEqual([]);
  });

  it('the owner sees each restaurant\'s rules in that restaurant, one at a time', async () => {
    expect(await asUser(OWNER, 'veraitalia', ruleVenues)).toEqual([V]);
    expect(await asUser(OWNER, 'lasoul', ruleVenues)).toEqual([L]);
  });

  it('a guest reads no rules at all', async () => {
    await db.exec('SET ROLE anon');
    try {
      await expect(db.query(`SELECT 1 FROM public.menu_item_recommendations LIMIT 1`)).rejects.toThrow(/permission denied/);
    } finally { await db.exec('RESET ROLE'); }
  });
});

describe('La Soul is exactly as it was', () => {
  const SCENARIOS: Ask[] = [];
  const add = (at: string, placement: Placement, cart: string[], ordered: string[] = []) =>
    SCENARIOS.push({ at, placement, cart: cart.map((n) => [ls(n), 1] as [string, number]), ordered: ordered.map(ls) });

  it('suggests the same, in the same order, with and without the migration', async () => {
    add('09:00', 'cart', ['Turkish Egg']);
    add('09:00', 'cart', ['Cappucino']);
    add('09:00', 'item', ['Avocado on Toast']);
    add('13:00', 'cart', ['La Soul Burger']);
    add('13:00', 'cart', ['La Soul Burger', 'Coca-Cola']);
    add('13:00', 'cart', ['Truffle Pasta']);
    add('13:00', 'item', ['Truffle Pasta', 'Coca-Cola']);
    add('13:00', 'cart', ['Caesar Salad']);
    add('13:15', 'tab', [], ['La Soul Burger', 'Truffle Pasta']);
    add('14:00', 'after_meal', [], ['La Soul Burger', 'Coca-Cola']);
    add('16:00', 'cart', ['Cappucino']);
    add('16:00', 'cart', ['Tiramisu Cup']);
    add('16:00', 'cart', ['Hot Chocolate']);
    add('20:00', 'cart', ['Pesto Risotto']);
    add('20:00', 'cart', ['Truffle Risotto']);
    add('20:00', 'item', ['Mix Slider']);
    add('21:00', 'after_meal', [], ['Pesto Risotto', 'Sparkling Water']);
    add('23:30', 'cart', ['Espresso']);
    add('23:30', 'tab', [], ['Original Cheese Fries']);

    // The same La Soul, a database that stops just before this migration.
    const without = await build(FILE.slice(0, 14));
    try {
      let k = 0;
      const month: Array<[number, string[]]> = [
        [15, ['La Soul Burger', 'Coca-Cola']], [10, ['Truffle Pasta', 'Lemon Iced Tea']],
        [10, ['Cappucino', 'Butter Croissant']], [8, ['Lava Cake', 'Espresso']], [6, ['Pesto Risotto', 'Sparkling Water']],
      ];
      for (const [n, dishes] of month) for (let i = 0; i < n; i++) await visit(without, L, DAY, dishes.map(ls), 1 + (k++ % 25), i % 60);
      await asOwner(without, () => without.query(`SELECT public.refresh_menu_intelligence()`));

      const show = (rows: Row[]) => rows.map((r) => `${r.id}|${r.recommendation_type}|${r.source_item_id}|${r.suggested_quantity}`);
      const kinds = async (d: Db) => (await d.query<{ k: string }>(
        `SELECT mi.id || '=' || public.reco_kind(mi.name, s.name, mi.meal_role, mi.station) AS k
           FROM public.menu_items mi LEFT JOIN public.subcategories s ON s.id = mi.subcategory_id
          WHERE mi.venue_id = '${L}' ORDER BY mi.id`)).rows.map((r) => r.k);
      expect(await kinds(db)).toEqual(await kinds(without));

      let offered = 0;
      for (const s of SCENARIOS) {
        const now = show(await ask(db, L, DAY, s));
        const was = show(await ask(without, L, DAY, s));
        expect(now, `${s.at} ${s.placement}`).toEqual(was);
        offered += now.length;
      }
      expect(offered).toBeGreaterThan(SCENARIOS.length);
    } finally {
      await without.close();
    }
  }, 240_000);
});
