/**
 * @vitest-environment node
 *
 * The engine learns from what tables order, by itself, and acts on it
 * (20261026110000_reco_adaptive.sql) — on the real menu.
 *
 *   * Learning runs without anyone: an order reaching the kitchen updates the
 *     counters in its own transaction; the heavier refresh runs when it is
 *     due and never twice at once.
 *   * "Lots of tables order A with B" overtakes the house pairing within
 *     days; one or two tables change nothing. The numbers are below.
 *   * A dish with no record of its own inherits its section's (and failing
 *     that its kind's); a dish with a record follows its own.
 *   * Learning ranks inside the relevance gate and never widens it.
 *   * The card says why, and management can see what was learned and when.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { actAs, laSoulDatabase, MENU_TABLE, ordinaryWeeks, tables, type Db } from './harness/la-soul-menu';

const STAFF = '33333333-3333-3333-3333-333333333333';

let db: Db;
const ids = new Map<string, string>();
const names = new Map<string, string>();

const idOf = (name: string) => {
  const id = ids.get(name.toLowerCase());
  if (!id) throw new Error(`not on the menu: ${name}`);
  return id;
};

/** Forget every visit and everything learned from them; keep the menu. */
async function forget() {
  await db.exec(`
    TRUNCATE public.table_sessions, public.orders, public.order_items, public.suggestion_conversions,
             public.recommendation_decisions, public.recommendation_impressions,
             public.reco_learning, public.reco_learned_visits,
             public.menu_item_affinity, public.session_item_affinity, public.subcategory_affinity,
             public.item_section_share, public.suggestion_stats, public.suggestion_priors
      RESTART IDENTITY CASCADE;
    DELETE FROM public.maintenance_runs;
  `);
}

const asStaff = async <T,>(sql: string, params: unknown[] = []) => {
  await actAs(db, STAFF);
  try {
    return (await db.query<T>(sql, params)).rows;
  } finally {
    await actAs(db, null);
  }
};

/** What the nightly job, a staff screen or pg_cron would run. */
const refresh = () => asStaff(`SELECT public.refresh_menu_intelligence() AS r`);

/**
 * Ask the ranker for a table at a time of day (Sarajevo, a Wednesday). What
 * the table already had is written unreleased, so the probe itself teaches
 * the engine nothing.
 */
async function suggest(at: string, placement: string, cart: string[], ordered: string[] = [], limit = 3) {
  await db.exec(`SET lasoul.reco_now = '2026-10-21 ${at}+02'`);
  const session = crypto.randomUUID();
  await db.query(
    `INSERT INTO public.table_sessions(id, table_id, token, is_active, last_heartbeat_at)
     VALUES ($1, '${MENU_TABLE}', $2, false, now())`, [session, `p-${session.slice(0, 8)}`]);
  if (ordered.length) {
    const served = placement === 'after_meal';
    await db.query(
      `WITH o AS (
         INSERT INTO public.orders(table_session_id, total, status, payment_status, payment_method, created_at)
         VALUES ($1, 0, $2, 'unpaid', 'cash', now() - interval '50 minutes') RETURNING id)
       INSERT INTO public.order_items(order_id, menu_item_id, quantity, unit_price, status, served_at)
       SELECT o.id, mi.id, 1, mi.price, $3, CASE WHEN $4 THEN now() - interval '25 minutes' END
         FROM o, public.menu_items mi WHERE mi.id = ANY($5::uuid[])`,
      [session, served ? 'served' : 'preparing', served ? 'served' : 'pending', served, ordered.map(idOf)]);
  }
  const { rows } = await db.query<{ id: string; recommendation_type: string; source_item_id: string | null }>(
    `SELECT id, recommendation_type, source_item_id
       FROM public.rank_recommendations($1::uuid[], $2, 'en', $4, $3::uuid, '{}'::text[], NULL)`,
    [cart.map(idOf), placement, session, limit]);
  await db.exec(`RESET lasoul.reco_now`);
  return rows.map((r) => ({ ...r, name: names.get(r.id) ?? r.id, source: r.source_item_id ? names.get(r.source_item_id) : null }));
}
const top = async (at: string, placement: string, cart: string[], ordered: string[] = []) =>
  (await suggest(at, placement, cart, ordered)).map((r) => r.name);

/**
 * The drink the table is offered: the first drink on the shortlist. (With
 * three weeks of burger tables behind it, fries — which two in five of them
 * had — may lead the card; the drink is the question here.)
 */
const firstDrink = async (at: string, placement: string, cart: string[], ordered: string[] = []) =>
  (await suggest(at, placement, cart, ordered, 8)).find((r) => DRINKS.includes(r.name));

const counter = async (level: string, key: string, item: string | null) => {
  const { rows } = await db.query<{ tables: number }>(
    `SELECT tables FROM public.reco_learning
      WHERE ctx_level = $1 AND ctx_key = $2 AND item_id IS NOT DISTINCT FROM $3::uuid`, [level, key, item]);
  return rows[0]?.tables ?? 0;
};
const pairTables = (a: string, b: string) => counter('item', idOf(a), idOf(b));
const visitsLearned = () => counter('all', '*', null);

const evidence = async (source: string, item: string) => {
  const { rows } = await db.query<{ e: Record<string, unknown> }>(
    `SELECT public.suggestion_evidence($1, $2) AS e`, [idOf(source), idOf(item)]);
  return rows[0].e;
};

const BURGER_PEACH = [['La Soul Burger', 'Peach Lemonade']];
const DRINKS = ['Strawberry Lemonade', 'Peach Lemonade', 'Passion Fruit Lemonade', 'Classic Mojito', 'Mango Mojito',
  'Lemon Iced Tea', 'Peach Iced Tea', 'Hibiscus Iced Tea', 'Coca-Cola', 'Coca-Cola Zero', 'Fanta', 'Sprite',
  'Sparkling Water', 'Bottled Water', 'Fresh Lemon & Mint Juice', 'Fresh Orange Juice', 'Apple Juice'];
const SWEET = ['Tiramisu Cup', 'Tiramisu with Espresso Coffee Shot', 'Lava Cake', 'San Sebastian Cheesecake',
  'Creme Brulee', 'Chocolate Mousse Cup', 'Red Velvet Cup', 'Butter Croissant', 'Churros', 'Banana Pudding'];
const FRIES = ['Regular Fries', 'La Soul Fries', 'Seasoned Truffle Fries', 'Original Cheese Fries', 'Commando Fries'];
const HOT = ['Cappuccino', 'Espresso', 'Flat White', 'Spanish Latte', 'Caffe Latte', 'Americano', 'Hot Chocolate'];

beforeAll(async () => {
  db = await laSoulDatabase();
  await db.exec(`
    INSERT INTO auth.users(id) VALUES ('${STAFF}');
    INSERT INTO public.user_roles(user_id, role) VALUES ('${STAFF}', 'admin'), ('${STAFF}', 'staff');
  `);
  // La Soul's dishes: Vera Italia's menu has some of the same names.
  const { rows } = await db.query<{ id: string; name: string }>(`SELECT id, btrim(name) AS name FROM public.menu_items WHERE venue_id = public.default_venue()`);
  for (const r of rows) {
    ids.set(r.name.toLowerCase(), r.id);
    names.set(r.id, r.name);
  }
}, 240_000);
afterAll(async () => { await db?.close(); });

// ---------------------------------------------------------------------------

describe('learning runs by itself', () => {
  it('learns an order the moment it reaches the kitchen: no refresh, no scheduler, no person', async () => {
    await forget();
    await tables(db, 1, BURGER_PEACH);
    expect(await pairTables('La Soul Burger', 'Peach Lemonade')).toBe(1);
    expect(await pairTables('Peach Lemonade', 'La Soul Burger')).toBe(1);
    expect(await visitsLearned()).toBe(1);
    // ... and by section and by kind, for the dishes that have no record yet.
    const burgers = (await db.query<{ id: string }>(`SELECT id FROM public.subcategories WHERE name = 'Burgers'`)).rows[0].id;
    expect(await counter('section', burgers, idOf('Peach Lemonade'))).toBe(1);
    expect(await counter('kind', 'handheld', idOf('Peach Lemonade'))).toBe(1);
  });

  it('counts a card order when its payment releases it, not before', async () => {
    await forget();
    const session = crypto.randomUUID();
    await db.query(
      `INSERT INTO public.table_sessions(id, table_id, token, is_active, last_heartbeat_at)
       VALUES ($1, '${MENU_TABLE}', 'card', true, now())`, [session]);
    const { rows } = await db.query<{ id: string }>(
      `WITH o AS (
         INSERT INTO public.orders(table_session_id, total, status, payment_status, payment_method)
         VALUES ($1, 0, 'awaiting_payment', 'pending', 'card_online') RETURNING id)
       INSERT INTO public.order_items(order_id, menu_item_id, quantity, unit_price, status)
       SELECT o.id, mi.id, 1, mi.price, 'pending' FROM o, public.menu_items mi WHERE mi.id = ANY($2::uuid[])
       RETURNING order_id AS id`, [session, [idOf('La Soul Burger'), idOf('Peach Lemonade')]]);
    expect(await visitsLearned()).toBe(0);

    // What the payment callback does.
    await db.exec(`
      BEGIN;
      SELECT set_config('lasoul.financial_ctx', 'on', true);
      UPDATE public.orders SET status = 'pending', payment_status = 'paid', released_to_kitchen_at = now()
       WHERE id = '${rows[0].id}';
      COMMIT;`);
    expect(await pairTables('La Soul Burger', 'Peach Lemonade')).toBe(1);
  });

  it('counts a table once, however many rounds and phones it orders from', async () => {
    await forget();
    await tables(db, 1, Array.from({ length: 6 }, () => ['La Soul Burger', 'Peach Lemonade']));
    expect(await pairTables('La Soul Burger', 'Peach Lemonade')).toBe(1);
    expect(await visitsLearned()).toBe(1);
  });

  it('learns a pair split across two rounds of one visit', async () => {
    await forget();
    await tables(db, 1, [['La Soul Burger'], ['Peach Lemonade']]);
    expect(await pairTables('La Soul Burger', 'Peach Lemonade')).toBe(1);
    expect(await counter('item', idOf('La Soul Burger'), null)).toBe(1);
  });

  it('does not count what the guest took from a suggestion card as their own choice', async () => {
    // Taking the card's offer is measured as acceptance. Counting it again as
    // "what tables choose" would teach the engine its own suggestions.
    await forget();
    await tables(db, 5, BURGER_PEACH, 0, 0, ['Peach Lemonade']);
    expect(await pairTables('La Soul Burger', 'Peach Lemonade')).toBe(0);
    expect(await counter('item', idOf('La Soul Burger'), null)).toBe(5);
  });

  it('keeps live the very counters a full rebuild computes', async () => {
    await forget();
    await tables(db, 3, [['La Soul Burger', 'Coca-Cola'], ['Lava Cake']]);
    await tables(db, 2, [['Mushroom Burger'], ['Peach Lemonade', 'Regular Fries']]);
    await tables(db, 2, [['Truffle Pasta', 'Lemon Iced Tea', 'Shopska Salad']]);
    await tables(db, 2, [['Cappuccino', 'Butter Croissant']]);
    await tables(db, 1, [['Mix Slider', 'Midnight Slider', 'Peach Lemonade']]);
    const snapshot = async () => (await db.query<{ k: string }>(
      `SELECT ctx_level || ':' || ctx_key || ':' || COALESCE(item_id::text, '-') || '=' || tables AS k
         FROM public.reco_learning ORDER BY 1`)).rows.map((r) => r.k);
    const live = await snapshot();
    expect(live.length).toBeGreaterThan(50);
    await refresh();
    expect(await snapshot()).toEqual(live);
  });

  it('corrects an order cancelled after the kitchen saw it at the next refresh', async () => {
    await forget();
    await tables(db, 2, BURGER_PEACH);
    // What cancel_order() does, as a manager.
    await db.exec(`
      BEGIN;
      SELECT set_config('lasoul.financial_ctx', 'on', true);
      UPDATE public.orders SET status = 'cancelled'
       WHERE id = (SELECT id FROM public.orders ORDER BY created_at DESC, id LIMIT 1);
      COMMIT;`);
    expect(await pairTables('La Soul Burger', 'Peach Lemonade')).toBe(2);
    await refresh();
    expect(await pairTables('La Soul Burger', 'Peach Lemonade')).toBe(1);
  });

  it('never costs an order: a learning failure is a warning, not an error', async () => {
    await forget();
    await db.exec(`ALTER TABLE public.reco_learning ADD CONSTRAINT t_broken CHECK (tables < 0) NOT VALID`);
    try {
      await tables(db, 1, BURGER_PEACH);
    } finally {
      await db.exec(`ALTER TABLE public.reco_learning DROP CONSTRAINT t_broken`);
    }
    const { rows } = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM public.order_items`);
    expect(rows[0].n).toBe(2);
    expect(await visitsLearned()).toBe(0);
  });
});

describe('the refresh runs when it is due, and only then', () => {
  const maybe = () => asStaff<{ r: { ran: boolean; reason?: string } }>(
    `SELECT public.maybe_refresh_menu_intelligence() AS r`).then((rows) => rows[0].r);

  it('refreshes when it never has, then not again for half an hour', async () => {
    await forget();
    await tables(db, 3, BURGER_PEACH);
    expect((await maybe()).ran).toBe(true);
    expect(await maybe()).toMatchObject({ ran: false, reason: 'fresh' });
  });

  it('skips a quiet half hour, and refreshes once something happened', async () => {
    await forget();
    await tables(db, 3, BURGER_PEACH, 0, 1);   // an hour ago
    await maybe();
    await db.exec(`UPDATE public.maintenance_runs SET last_run_at = now() - interval '31 minutes' WHERE job = 'menu_intelligence'`);
    expect(await maybe()).toMatchObject({ ran: false, reason: 'nothing_new' });
    await tables(db, 1, BURGER_PEACH);
    expect((await maybe()).ran).toBe(true);
  });

  it('runs from the pg_cron entry point with no user, and from nobody else without staff rights', async () => {
    await forget();
    await tables(db, 1, BURGER_PEACH);
    const { rows } = await db.query<{ r: { ran: boolean } }>(`SELECT public.run_scheduled_learning_refresh() AS r`);
    expect(rows[0].r.ran).toBe(true);
    const { rows: mark } = await db.query<{ v: string | null }>(`SELECT current_setting('lasoul.scheduled_job', true) AS v`);
    expect(mark[0].v ?? '').not.toBe('on');

    await expect(db.query(`SELECT public.maybe_refresh_menu_intelligence()`)).rejects.toThrow(/Only staff/);
    await expect(db.query(`SELECT public.rebuild_reco_learning()`)).rejects.toThrow(/Only staff/);
    const { rows: grants } = await db.query<{ anon: boolean; auth: boolean }>(`
      SELECT has_function_privilege('anon', 'public.run_scheduled_learning_refresh()', 'EXECUTE') AS anon,
             has_function_privilege('authenticated', 'public.run_scheduled_learning_refresh()', 'EXECUTE') AS auth`);
    expect(grants[0]).toEqual({ anon: false, auth: false });
  });

  it('never runs twice at once', async () => {
    const { rows } = await db.query<{ maybe: string; full: string }>(`
      SELECT pg_get_functiondef('public.maybe_refresh_menu_intelligence(int)'::regprocedure) AS maybe,
             pg_get_functiondef('public.refresh_menu_intelligence()'::regprocedure) AS full`);
    expect(rows[0].maybe).toContain(`pg_try_advisory_xact_lock(hashtext('lasoul.menu_intelligence'))`);
    expect(rows[0].full).toContain(`pg_advisory_xact_lock(hashtext('lasoul.menu_intelligence'))`);
  });

  it('records when it last refreshed, for the admin page', async () => {
    const [h] = await asStaff<{ r: { learning: Record<string, unknown> } }>(`SELECT public.recommendation_engine_health() AS r`);
    expect(h.r.learning.refreshed_at).toBeTruthy();
    expect(h.r.learning.last_learned_at).toBeTruthy();
    expect(Number(h.r.learning.tables)).toBeGreaterThan(0);
  });
});

describe('lots of tables ordering A with B overtakes the house pairing', () => {
  /*
   * Three ordinary weeks (168 tables; the La Soul Burger once a day, with
   * fries or with one of six drinks, none more than three times; Peach
   * Lemonade with a slider every other day), then k tables over the last
   * three days order the La Soul Burger with a Peach Lemonade. Which drink
   * does the next guest with a La Soul Burger at lunch get offered?
   */
  const sweep: Array<[number, string]> = [];

  beforeAll(async () => {
    await forget();
    await ordinaryWeeks(db);
  }, 240_000);

  afterAll(() => {
    if (process.env.RECO_REPORT) console.info(`tables → first drink with the La Soul Burger: ${sweep.map(([k, d]) => `${k}: ${d}`).join(', ')}`);
  });

  let placed = 0;
  for (const k of [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 12]) {
    it(`${k} table${k === 1 ? '' : 's'} with the burger and a Peach Lemonade`, async () => {
      // One every five hours over the last three days, oldest first.
      for (; placed < k; placed += 1) {
        await db.query(`SELECT public.t_visit($1::jsonb, $2)`, [JSON.stringify(BURGER_PEACH), 70 - 5 * placed]);
      }
      await refresh();

      const shortlist = await suggest('13:00', 'cart', ['La Soul Burger'], [], 8);
      const drink = shortlist.find((r) => DRINKS.includes(r.name))!;
      sweep.push([k, drink.name]);
      // Only what goes with a burger: a drink, or fries.
      for (const r of shortlist) expect([...DRINKS, ...FRIES]).toContain(r.name);
      if (k <= 2) expect(drink.name).toBe('Strawberry Lemonade');
      if (k >= 8) {
        expect(drink.name).toBe('Peach Lemonade');
        expect(drink.source).toBe('La Soul Burger');
        expect(drink.recommendation_type).toBe('frequently_bought_together');
      }
    });
  }

  it('says why on the card, honestly', async () => {
    const e = await evidence('La Soul Burger', 'Peach Lemonade');
    expect(['qualitative', 'quantified']).toContain(e.kind);
    // A drink no table had with it earns no claim.
    expect((await evidence('La Soul Burger', 'Passion Fruit Lemonade')).kind).toBe('none');
  });

  it('shows management what it learned, and when', async () => {
    const pairs = await asStaff<{ name_a: string; name_b: string; pair_orders: number }>(
      `SELECT * FROM public.menu_pairings(30)`);
    const pair = pairs.find((p) => [p.name_a, p.name_b].sort().join(' + ') === 'La Soul Burger + Peach Lemonade');
    expect(pair?.pair_orders).toBe(12);
  });
});

describe('the same day counts, without waiting for any refresh', () => {
  it('a lunch of burger-and-peach tables changes the next suggestion straight away', async () => {
    await forget();
    await ordinaryWeeks(db);
    await refresh();   // last night's job
    expect((await firstDrink('13:00', 'cart', ['La Soul Burger']))?.name).toBe('Strawberry Lemonade');

    // Today, between 11:00 and now: learned by the orders themselves.
    await tables(db, 10, BURGER_PEACH, 8, 0);
    expect((await firstDrink('13:00', 'cart', ['La Soul Burger']))?.name).toBe('Peach Lemonade');
  }, 240_000);
});

describe('similar dishes inherit, and a dish with its own record follows it', () => {
  beforeAll(async () => {
    await forget();
    await ordinaryWeeks(db);
    // Ten tables over three days, five different burgers — none of them the
    // Mushroom Burger — each with a Peach Lemonade.
    for (const burger of ['Volcano Beef Burger', 'Original Burger', 'Manhattan Burger', 'Classic Crispy Chicken Burger', 'Dynamite Chicken Burger']) {
      await tables(db, 2, [[burger, 'Peach Lemonade']], 48, 6);
    }
    // And tables with pasta took to the Mango Mojito; nobody has had a risotto.
    for (const pasta of ['Pasta Arrabbiata', 'Alfredo Fettuccine', 'Pesto Alfredo Fettuccine', 'Eggplant Spaghetti Truffle']) {
      await tables(db, 3, [[pasta, 'Mango Mojito']], 48, 6);
    }
    await refresh();
  }, 240_000);

  it('a burger nobody has ordered yet gets what tables with burgers chose', async () => {
    const drink = await firstDrink('20:00', 'cart', ['Mushroom Burger']);
    expect(drink?.name).toBe('Peach Lemonade');
    expect(drink?.source).toBe('Mushroom Burger');
    // Inherited, and the card says so: "Often ordered with dishes like this".
    expect((await evidence('Mushroom Burger', 'Peach Lemonade')).kind).toBe('similar');
  });

  it('a risotto inherits from the pasta tables, by kind', async () => {
    expect((await firstDrink('20:00', 'cart', ['Pesto Risotto']))?.name).toBe('Mango Mojito');
  });

  it('on the tab, too: a table waiting for its Mushroom Burger is offered what burger tables drink', async () => {
    const got = await suggest('20:15', 'tab', [], ['Mushroom Burger']);
    expect(got[0].name).toBe('Peach Lemonade');
  });

  it("a dish's own record outweighs its section's", async () => {
    // The La Soul Burger has three weeks of tables of its own, none with a
    // Peach Lemonade: it keeps the house pairing.
    expect((await firstDrink('20:00', 'cart', ['La Soul Burger']))?.name).toBe('Strawberry Lemonade');

    // Twelve tables now have the Mushroom Burger, with a cola, never a lemonade.
    await tables(db, 12, [['Mushroom Burger', 'Coca-Cola']], 48, 6);
    await refresh();
    expect((await firstDrink('20:00', 'cart', ['Mushroom Burger']))?.name).toBe('Coca-Cola');
  });
});

describe('learning ranks inside the gate, and never widens it', () => {
  beforeAll(async () => {
    await forget();
    await ordinaryWeeks(db);
    // Twelve tables each: things that are often ordered together but are
    // never the right thing to volunteer next to a burger.
    await tables(db, 12, [['La Soul Burger', 'Tiramisu Cup']], 48, 6);
    await tables(db, 12, [['La Soul Burger', 'Red Bull']], 48, 6);
    await tables(db, 12, [['La Soul Burger', 'Cappuccino']], 48, 6);
    await tables(db, 12, [['La Soul Burger', 'Mushroom Burger']], 48, 6);
    await tables(db, 12, [['La Soul Burger', 'Classic Egg Benedict']], 48, 6);
    await tables(db, 12, [['La Soul Burger', 'Coca-Cola'], ['Lava Cake']], 48, 6);
    await refresh();
  }, 240_000);

  it('no cake, coffee, energy drink, second main or breakfast next to a burger in the cart', async () => {
    for (const at of ['13:00', '20:00']) {
      const got = await top(at, 'cart', ['La Soul Burger']);
      expect(got.length).toBeGreaterThan(0);
      for (const n of got) {
        expect([...SWEET, ...HOT, 'Red Bull', 'Mushroom Burger', 'Classic Egg Benedict']).not.toContain(n);
      }
    }
  });

  it('nothing at all when the order is already complete', async () => {
    expect(await top('13:00', 'cart', ['La Soul Burger', 'Regular Fries', 'Strawberry Lemonade'])).toEqual([]);
  });

  it('after the meal, the dessert those tables had — where cake belongs', async () => {
    // Without the history this is the house's Tiramisu with Espresso.
    const got = await top('14:00', 'after_meal', [], ['La Soul Burger', 'Coca-Cola']);
    expect(['Lava Cake', 'Tiramisu Cup']).toContain(got[0]);
    for (const n of got) expect([...SWEET, ...HOT]).toContain(n);
  });
});
