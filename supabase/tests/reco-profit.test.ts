/**
 * @vitest-environment node
 *
 * Suggestions that earn more per visit (20261025160000_reco_profit.sql).
 *
 *   * drinks for the table: a quantity, honestly derived, recorded
 *   * the running tab ('tab'): a drink for a table that ordered food only
 *   * once a pair has a record, expected profit outranks the owner's guess
 *   * house pairings lean towards margin, once, and only where untouched
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
// @ts-expect-error -- plain JS harness, no types needed
import { createTestDatabase, actAs } from '../../scripts/db-harness.mjs';

type Db = {
  query: <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<{ rows: T[] }>;
  exec: (sql: string) => Promise<unknown>;
  close: () => Promise<void>;
};

const MIGRATIONS = path.join(__dirname, '..', 'migrations');
const HOUSE_PAIRINGS = readFileSync(path.join(MIGRATIONS, '20261024180000_house_pairings.sql'), 'utf8');
const PROFIT = readFileSync(path.join(MIGRATIONS, '20261025160000_reco_profit.sql'), 'utf8');

const STAFF = '22222222-2222-2222-2222-222222222222';
const SUB = {
  burgers: 'bbbbbbbb-0000-0000-0000-000000000001',
  fries: 'bbbbbbbb-0000-0000-0000-000000000002',
  other: 'bbbbbbbb-0000-0000-0000-000000000003',
  lemonade: 'bbbbbbbb-0000-0000-0000-000000000004',
  coffee: 'bbbbbbbb-0000-0000-0000-000000000005',
  desserts: 'bbbbbbbb-0000-0000-0000-000000000006',
  salads: 'bbbbbbbb-0000-0000-0000-000000000007',
};
const ITEM = {
  burger: 'cccccccc-0000-0000-0000-000000000001',
  fries: 'cccccccc-0000-0000-0000-000000000002',
  cola: 'cccccccc-0000-0000-0000-000000000003',
  lemonade: 'cccccccc-0000-0000-0000-000000000004',
  espresso: 'cccccccc-0000-0000-0000-000000000005',
  pudding: 'cccccccc-0000-0000-0000-000000000006',
  salad: 'cccccccc-0000-0000-0000-000000000007',
  slaw: 'cccccccc-0000-0000-0000-000000000008',
};
const TABLE = 'dddddddd-0000-0000-0000-000000000001';
const SESSION = 'eeeeeeee-eeee-eeee-eeee-eeeeeeee0001';
const TOKEN = 'sess-token-profit';

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
      ('${SUB.burgers}',  'aaaaaaaa-0000-0000-0000-000000000001', 'Burgers', 1),
      ('${SUB.fries}',    'aaaaaaaa-0000-0000-0000-000000000001', 'Fries', 2),
      ('${SUB.other}',    'aaaaaaaa-0000-0000-0000-000000000002', 'Other', 3),
      ('${SUB.lemonade}', 'aaaaaaaa-0000-0000-0000-000000000002', 'Lemonade', 4),
      ('${SUB.coffee}',   'aaaaaaaa-0000-0000-0000-000000000002', 'Coffee', 5),
      ('${SUB.desserts}', 'aaaaaaaa-0000-0000-0000-000000000001', 'Desserts', 6),
      ('${SUB.salads}',   'aaaaaaaa-0000-0000-0000-000000000001', 'Side Salads', 7);

    INSERT INTO public.menu_items(id, subcategory_id, name, price, is_available, station, meal_role) VALUES
      ('${ITEM.burger}',   '${SUB.burgers}',  'La Soul Burger',      16.50, true, 'kitchen', 'main'),
      ('${ITEM.fries}',    '${SUB.fries}',    'Regular Fries',        5.00, true, 'kitchen', 'side'),
      ('${ITEM.cola}',     '${SUB.other}',    'Coca-Cola',            4.00, true, 'bar',     'cold_drink'),
      ('${ITEM.lemonade}', '${SUB.lemonade}', 'Strawberry Lemonade',  8.00, true, 'bar',     'cold_drink'),
      ('${ITEM.espresso}', '${SUB.coffee}',   'Espresso',             3.00, true, 'bar',     'hot_drink'),
      ('${ITEM.pudding}',  '${SUB.desserts}', 'Banana Pudding',      13.00, true, 'kitchen', 'dessert'),
      ('${ITEM.salad}',    '${SUB.salads}',   'Side Salad',           6.00, true, 'kitchen', 'side'),
      ('${ITEM.slaw}',     '${SUB.salads}',   'Coleslaw',             6.00, true, 'kitchen', 'side');

    INSERT INTO public.tables(id, table_number) VALUES ('${TABLE}', 7);
    INSERT INTO public.table_sessions(id, table_id, token, is_active, guest_name, last_heartbeat_at)
      VALUES ('${SESSION}', '${TABLE}', '${TOKEN}', true, 'Amina', now());
  `);
  await db.exec(`ALTER TABLE public.orders DISABLE TRIGGER trg_enforce_order_limits`);
  await actAs(db, null);
}

interface Ranked { id: string; recommendation_type: string; suggested_quantity: number }

const rank = async (cart: string[], quantities: number[] | null = null, placement = 'cart') => {
  const { rows } = await db.query<Ranked>(
    `SELECT id, recommendation_type, suggested_quantity
       FROM public.rank_recommendations($1::uuid[], $2, 'en', 8, $3::uuid, '{}'::text[], $4::int[])`,
    [cart, placement, SESSION, quantities]);
  return rows;
};

/** An earlier round at this table, already with the kitchen. */
async function ordered(lines: [string, number][], servedMinutesAgo: number | null = null) {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO public.orders(table_session_id, total, status, payment_status, payment_method, released_to_kitchen_at)
     VALUES ($1, 0, 'preparing', 'unpaid', 'cash', now()) RETURNING id`, [SESSION]);
  for (const [item, qty] of lines) {
    await db.query(
      `INSERT INTO public.order_items(order_id, menu_item_id, quantity, unit_price, status, served_at)
       SELECT $1, id, $3, price, 'pending',
              CASE WHEN $4::int IS NULL THEN NULL ELSE now() - make_interval(mins => $4::int) END
         FROM public.menu_items WHERE id = $2`, [rows[0].id, item, qty, servedMinutesAgo]);
  }
}

const curate = (source: string, target: string, priority: number) =>
  db.query(
    `INSERT INTO public.menu_item_recommendations(source_item_id, recommended_item_id, recommendation_type, priority)
     VALUES ($1, $2, 'pair_with', $3)`, [source, target, priority]);

const stats = (item: string, source: string | null, shown: number, accepted: number) =>
  db.query(
    `INSERT INTO public.suggestion_stats(recommended_item_id, source_item_id, placement, daypart, shown, accepted)
     VALUES ($1, $2, 'cart', NULL, $3, $4)`, [item, source, shown, accepted]);

const drinks = (rows: Ranked[]) => rows.filter((r) => [ITEM.cola, ITEM.lemonade, ITEM.espresso].includes(r.id));

beforeAll(async () => { db = (await createTestDatabase({ quiet: true })) as unknown as Db; }, 180_000);
afterAll(async () => { await db?.close(); });
// The ranker's rules know the time of day (no cake at 09:00, no croissant at
// 21:00); a fixed Wednesday afternoon keeps these tests off the wall clock.
beforeAll(async () => { await db.exec(`SET lasoul.reco_now = '2026-10-21 15:00+02'`); });
beforeEach(seed);

describe('drinks for the table', () => {
  it('offers one drink for each of three burgers with nothing to drink', async () => {
    const rows = await rank([ITEM.burger], [3]);
    const drink = drinks(rows)[0];
    expect(drink).toBeDefined();
    expect(drink.suggested_quantity).toBe(3);
    // A side is still a side: one.
    expect(rows.find((r) => r.id === ITEM.fries || r.id === ITEM.salad)?.suggested_quantity ?? 1).toBe(1);
  });

  it('counts the people at the table when there are more than mains', async () => {
    await db.exec(`UPDATE public.table_sessions SET covers = 4 WHERE id = '${SESSION}'`);
    expect(drinks(await rank([ITEM.burger], [2]))[0].suggested_quantity).toBe(4);
  });

  it('offers one to one person, and counts drinks already ordered this visit', async () => {
    expect(drinks(await rank([ITEM.burger], [1]))[0].suggested_quantity).toBe(1);

    // Three mains this round; two people already have a drink from the first.
    await ordered([[ITEM.cola, 2]]);
    expect(drinks(await rank([ITEM.burger], [3]))[0].suggested_quantity).toBe(1);
  });

  it('never offers more than six', async () => {
    expect(drinks(await rank([ITEM.burger], [9]))[0].suggested_quantity).toBe(6);
  });

  it('does not offer quantities on a dish page, where the order is not in view', async () => {
    const rows = await rank([ITEM.burger], [3], 'item');
    for (const r of rows) expect(r.suggested_quantity).toBe(1);
  });

  it('records what it offered, and the guest\'s paid lines say what was bought', async () => {
    const { rows } = await db.query<{ decision_id: string; id: string; suggested_quantity: number; source_item_id: string | null }>(
      `SELECT decision_id, id, suggested_quantity, source_item_id
         FROM public.guest_get_recommendations($1::uuid, $2, $3::uuid[], 'cart', 'en', 4,
                                               '{}'::text[], '{}'::text[], '{}'::uuid[], $4::int[])`,
      [SESSION, TOKEN, [ITEM.burger], [3]]);
    const top = rows[0];
    expect(top.suggested_quantity).toBe(3);

    const { rows: d } = await db.query<{ suggested_quantity: number; candidates: { item_id: string; qty: number }[] }>(
      `SELECT suggested_quantity, candidates FROM public.recommendation_decisions WHERE id = $1`, [top.decision_id]);
    expect(d[0].suggested_quantity).toBe(3);
    expect(d[0].candidates[0].qty).toBe(3);

    // The guest took two of the three. (Only the drinks are sent here: three
    // burgers and the drinks together would be a first order big enough to be
    // held for the waiter, which is a different test.)
    await db.query(`SELECT public.guest_mark_suggestion_seen($1, $2, $3)`, [top.decision_id, SESSION, TOKEN]);
    await db.query(
      `SELECT public.guest_place_order($1, $2, 'Amina', 'cash', $3::jsonb, 0)`,
      [SESSION, TOKEN, JSON.stringify([
        { menu_item_id: top.id, quantity: 2,
          from_suggestion: { source_item_id: top.source_item_id, placement: 'cart', decision_id: top.decision_id } },
      ])]);
    const { rows: conv } = await db.query<{ quantity: number; line_total: string }>(
      `SELECT quantity, line_total FROM public.suggestion_conversions WHERE decision_id = $1`, [top.decision_id]);
    expect(conv[0].quantity).toBe(2);
    await actAs(db, STAFF);
    await db.query(`SELECT public.refresh_suggestion_stats(90)`);
    await actAs(db, null);
    const { rows: st } = await db.query<{ shown: number; accepted: number }>(
      `SELECT shown, accepted FROM public.suggestion_stats
        WHERE recommended_item_id = $1 AND daypart IS NULL AND shown > 0`, [top.id]);
    // One decision, one acceptance: the learning counts the decision, not the glasses.
    expect(st[0]).toMatchObject({ shown: 1, accepted: 1 });
  });

  it('still answers a client that sends no quantities', async () => {
    const { rows } = await db.query<{ id: string; suggested_quantity: number }>(
      `SELECT id, suggested_quantity
         FROM public.guest_get_recommendations($1::uuid, $2, $3::uuid[], 'cart', 'en', 4,
                                               '{}'::text[], '{}'::text[], '{}'::uuid[])`,
      [SESSION, TOKEN, [ITEM.burger]]);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].suggested_quantity).toBe(1);
  });
});

describe('the running tab while the table waits', () => {
  it('offers a drink, for everyone, to a table that ordered food and nothing to drink', async () => {
    await ordered([[ITEM.burger, 2]]);
    const rows = await rank([], null, 'tab');
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect([ITEM.cola, ITEM.lemonade, ITEM.espresso]).toContain(r.id);
    expect(rows[0].suggested_quantity).toBe(2);
  });

  it('says nothing once the table has a drink, or before it has ordered', async () => {
    expect(await rank([], null, 'tab')).toHaveLength(0);
    await ordered([[ITEM.burger, 2], [ITEM.cola, 1]]);
    expect(await rank([], null, 'tab')).toHaveLength(0);
  });

  it('is not the place for a side, even a curated one', async () => {
    await curate(ITEM.burger, ITEM.fries, 100);
    await ordered([[ITEM.burger, 1]]);
    expect((await rank([], null, 'tab')).map((r) => r.id)).not.toContain(ITEM.fries);
  });

  it('follows the section rules for what the table ordered', async () => {
    await db.query(
      `INSERT INTO public.menu_item_recommendations(source_subcategory_id, recommended_item_id, recommendation_type, priority)
       VALUES ($1, $2, 'pair_with', 90)`, [SUB.burgers, ITEM.lemonade]);
    await ordered([[ITEM.burger, 1]]);
    const rows = await rank([], null, 'tab');
    expect(rows[0].id).toBe(ITEM.lemonade);
  });

  it('offers coffee with a meal only in the morning', async () => {
    await ordered([[ITEM.burger, 1]]);
    const fits = async (at: string) => {
      const { rows } = await db.query<{ ok: boolean }>(
        `SELECT public.reco_role_fits('hot_drink'::public.meal_role, 'tab', 'popular', false,
                                      '{}'::uuid[], $1::uuid, $2::timestamptz) AS ok`, [SESSION, at]);
      return rows[0].ok;
    };
    expect(await fits('2026-08-02 09:00+02')).toBe(true);
    expect(await fits('2026-08-02 15:00+02')).toBe(false);
  });

  it('keeps its own learning counts, apart from the cart', async () => {
    await ordered([[ITEM.burger, 1]]);
    const { rows } = await db.query<{ decision_id: string }>(
      `SELECT decision_id FROM public.guest_get_recommendations($1::uuid, $2, '{}'::uuid[], 'tab', 'en', 4,
                                                              '{}'::text[], '{}'::text[], '{}'::uuid[])`,
      [SESSION, TOKEN]);
    await db.query(`SELECT public.guest_mark_suggestion_seen($1, $2, $3)`, [rows[0].decision_id, SESSION, TOKEN]);
    await actAs(db, STAFF);
    await db.query(`SELECT public.refresh_suggestion_stats(90)`);
    await actAs(db, null);
    const { rows: st } = await db.query<{ placement: string }>(
      `SELECT DISTINCT placement FROM public.suggestion_stats`);
    expect(st.map((r) => r.placement)).toEqual(['tab']);
  });
});

describe('relevance is a gate, not a score', () => {
  /** A paid order in its own closed visit. */
  async function basket(items: string[]) {
    const session = crypto.randomUUID();
    await db.query(
      `INSERT INTO public.table_sessions(id, table_id, token, is_active, last_heartbeat_at)
       VALUES ($1, '${TABLE}', $2, false, now())`, [session, `g-${session.slice(0, 8)}`]);
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO public.orders(table_session_id, total, status, payment_status, payment_method,
                                 released_to_kitchen_at, paid_at)
       VALUES ($1, 0, 'served', 'paid', 'cash', now(), now()) RETURNING id`, [session]);
    for (const item of items) {
      await db.query(
        `INSERT INTO public.order_items(order_id, menu_item_id, quantity, unit_price, status)
         SELECT $1, id, 1, price, 'served' FROM public.menu_items WHERE id = $2`, [rows[0].id, item]);
    }
  }

  it('says what kind of thing a dish is', async () => {
    const { rows } = await db.query<{ k: string }>(`
      SELECT public.reco_kind(name, s, role::public.meal_role, st) AS k
        FROM (VALUES ('La Soul Burger', 'Burgers', 'main', 'kitchen'), ('Butter Croissant', 'Desserts', 'dessert', 'kitchen'),
                     ('Peach Iced Tea', 'Iced Tea', 'cold_drink', 'bar'), ('V60 Cold', 'Filter Coffee', 'cold_drink', 'bar'),
                     ('Red Bull', 'Other', 'cold_drink', 'bar'), ('Chicken Burger Combo', 'Kids Menu', 'main', 'kitchen'),
                     ('Picnic Box Set', 'Desserts', 'dessert', 'kitchen'), ('Sparkling Water', 'Other', 'cold_drink', 'bar'))
             AS t(name, s, role, st)`);
    expect(rows.map((r) => r.k)).toEqual(
      ['handheld', 'pastry', 'refresher', 'iced_coffee', 'no_suggest', 'combo', 'sharing', 'water']);
  });

  it('does not let co-occurrence alone put a salad next to a burger', async () => {
    // Burgers and side salads are often ordered together here, but the fit
    // graph does not pair them: the learned pair may rank, never qualify.
    for (let i = 0; i < 8; i += 1) await basket([ITEM.burger, ITEM.salad]);
    for (let i = 0; i < 30; i += 1) await basket([ITEM.cola]);
    await actAs(db, STAFF);
    await db.query(`SELECT public.refresh_menu_affinity(365, 2)`);
    await actAs(db, null);
    const { rows } = await db.query<{ eb05: string }>(
      `SELECT eb05 FROM public.menu_item_affinity WHERE item_a = $1 AND item_b = $2`, [ITEM.burger, ITEM.salad]);
    expect(Number(rows[0].eb05)).toBeGreaterThan(1);

    const got = (await rank([ITEM.burger, ITEM.cola])).map((r) => r.id);
    expect(got).not.toContain(ITEM.salad);
    expect(got).toContain(ITEM.fries);
  });

  it('shows nothing rather than something that does not belong', async () => {
    // A drink on its own: nothing on this menu goes with a cola.
    for (let i = 0; i < 3; i += 1) await basket([ITEM.salad, ITEM.pudding, ITEM.burger]);
    expect(await rank([ITEM.cola])).toEqual([]);
  });

  it('lets the owner add to the fit graph', async () => {
    await db.exec(`INSERT INTO public.reco_fit(context_kind, candidate_kind) VALUES ('handheld', 'salad')`);
    try {
      expect((await rank([ITEM.burger, ITEM.cola])).map((r) => r.id)).toContain(ITEM.salad);
    } finally {
      await db.exec(`DELETE FROM public.reco_fit WHERE context_kind = 'handheld' AND candidate_kind = 'salad'`);
    }
  });

  it('keeps cake for the afternoon and croissants for the day', async () => {
    const vetoed = async (kind: string, at: string, placement = 'cart') => {
      const { rows } = await db.query<{ v: boolean }>(
        `SELECT public.reco_vetoed($1, NULL, false, $2::timestamptz, $3) AS v`, [kind, at, placement]);
      return rows[0].v;
    };
    expect(await vetoed('dessert', '2026-08-02 09:00+02')).toBe(true);
    expect(await vetoed('dessert', '2026-08-02 16:00+02')).toBe(false);
    expect(await vetoed('pastry', '2026-08-02 09:00+02')).toBe(false);
    expect(await vetoed('pastry', '2026-08-02 21:00+02')).toBe(true);
    expect(await vetoed('pastry', '2026-08-02 09:30+02', 'after_meal')).toBe(true);
    expect(await vetoed('breakfast', '2026-08-02 14:00+02')).toBe(true);
    expect(await vetoed('no_suggest', '2026-08-02 14:00+02')).toBe(true);
  });
});

describe('profit decides once it is known', () => {
  it('lets a measured better earner overtake the owner\'s favourite', async () => {
    await curate(ITEM.burger, ITEM.salad, 100);
    await curate(ITEM.burger, ITEM.slaw, 40);

    // Before anything is known, the owner's ranking leads.
    expect((await rank([ITEM.burger]))[0].id).toBe(ITEM.salad);

    // 400 sightings each: the coleslaw is taken 15% of the time, the salad 10%.
    await stats(ITEM.salad, ITEM.burger, 400, 40);
    await stats(ITEM.slaw, ITEM.burger, 400, 60);
    const ids = (await rank([ITEM.burger])).map((r) => r.id);
    expect(ids.indexOf(ITEM.slaw)).toBeLessThan(ids.indexOf(ITEM.salad));
  });

  it('keeps the owner\'s ranking while the evidence is thin', async () => {
    await curate(ITEM.burger, ITEM.salad, 100);
    await curate(ITEM.burger, ITEM.slaw, 40);
    await stats(ITEM.salad, ITEM.burger, 8, 1);
    await stats(ITEM.slaw, ITEM.burger, 8, 2);
    expect((await rank([ITEM.burger]))[0].id).toBe(ITEM.salad);
  });
});

describe('house pairings lean towards margin', () => {
  const priority = async (sub: string, item: string) => {
    const { rows } = await db.query<{ priority: number }>(
      `SELECT priority FROM public.menu_item_recommendations
        WHERE source_subcategory_id = $1 AND recommended_item_id = $2`, [sub, item]);
    return rows[0]?.priority;
  };
  const afterMeal = async (item: string) => {
    const { rows } = await db.query<{ priority: number }>(
      `SELECT priority FROM public.menu_item_recommendations
        WHERE recommendation_type = 'after_meal' AND recommended_item_id = $1`, [item]);
    return rows[0]?.priority;
  };

  it('moves untouched rules by margin, once, and leaves edited ones alone', async () => {
    await db.exec(HOUSE_PAIRINGS);
    expect(await priority(SUB.burgers, ITEM.cola)).toBe(60);
    expect(await priority(SUB.burgers, ITEM.lemonade)).toBe(70);
    expect(await priority(SUB.burgers, ITEM.fries)).toBe(90);
    // The owner has moved this one by hand since.
    await db.exec(`UPDATE public.menu_item_recommendations SET priority = 91
                    WHERE source_subcategory_id = '${SUB.burgers}' AND recommended_item_id = '${ITEM.fries}'`);

    await db.exec(PROFIT);
    const cola = await priority(SUB.burgers, ITEM.cola);
    const lemonade = await priority(SUB.burgers, ITEM.lemonade);
    // A 4 KM cola gives ground to an 8 KM lemonade; never more than ten points.
    expect(cola).toBeLessThan(60);
    expect(cola).toBeGreaterThanOrEqual(50);
    expect(lemonade).toBeGreaterThan(70);
    expect(lemonade).toBeLessThanOrEqual(80);
    expect(await priority(SUB.burgers, ITEM.fries)).toBe(91);
    // A new after-meal rule for a high-margin dessert.
    expect(await afterMeal(ITEM.pudding)).toBe(65);

    // Running it again changes nothing.
    await db.exec(PROFIT);
    expect(await priority(SUB.burgers, ITEM.cola)).toBe(cola);
    expect(await priority(SUB.burgers, ITEM.lemonade)).toBe(lemonade);
  });
});
