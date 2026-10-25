/**
 * @vitest-environment node
 *
 * Suggestions that make sense on a plate, and an engine that actually learns.
 *
 * The real menu has almost no history and no curated pairs, so the ranker
 * mostly runs on its fallback. These tests pin what that fallback may offer:
 * nothing that contradicts what is already on the table, nothing the guest's
 * own diet filter hides, and nothing on a UTC clock. They also pin the
 * learning loop — that the nightly job can run without a staff member, and
 * that it fills the visit-grain pair table the after-meal prompt depends on.
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
const BURGER = 'cccccccc-cccc-cccc-cccc-cccccccc0001';   // main, 16.50
const PASTA = 'cccccccc-cccc-cccc-cccc-cccccccc0002';    // main, 14
const FRIES = 'cccccccc-cccc-cccc-cccc-cccccccc0003';    // side, 5
const CAKE = 'cccccccc-cccc-cccc-cccc-cccccccc0004';     // dessert, 8
const ESPRESSO = 'cccccccc-cccc-cccc-cccc-cccccccc0005'; // hot drink, 3
const COLA = 'cccccccc-cccc-cccc-cccc-cccccccc0006';     // cold drink, 4, halal
const V60 = 'cccccccc-cccc-cccc-cccc-cccccccc0007';      // cold drink, 15, halal
const LEMONADE = 'cccccccc-cccc-cccc-cccc-cccccccc0008'; // cold drink, 6, not halal-tagged
const KIDS = 'cccccccc-cccc-cccc-cccc-cccccccc0009';     // kids' main, 9
const TABLE = 'dddddddd-0000-0000-0000-000000000001';
const SESSION = 'eeeeeeee-eeee-eeee-eeee-eeeeeeee0001';
const TOKEN = 'sess-token-7';

const DRINKS = [ESPRESSO, COLA, V60, LEMONADE];
const MAINS = [BURGER, PASTA, KIDS];

let db: Db;

async function seed() {
  await db.exec(`
    TRUNCATE public.audit_log, public.maintenance_runs, public.analytics_events,
             public.session_item_affinity, public.menu_item_affinity,
             public.recommendation_impressions, public.recommendation_decisions,
             public.session_experiment_assignment, public.experiments,
             public.suggestion_conversions, public.suggestion_stats,
             public.menu_item_recommendations, public.order_ticket_events, public.order_items,
             public.orders, public.table_sessions, public.tables,
             public.menu_items, public.subcategories, public.categories, public.order_code_counters
      RESTART IDENTITY CASCADE;
    DELETE FROM public.user_roles;
    DELETE FROM auth.users;

    UPDATE public.restaurant_settings
       SET ordering_enabled = true, online_card_enabled = false,
           recommendations_enabled = true, reco_holdout_pct = 0,
           reco_exploration = 0, after_meal_prompt_minutes = 8
     WHERE id = 1;

    INSERT INTO auth.users(id) VALUES ('${STAFF}');
    INSERT INTO public.user_roles(user_id, role) VALUES ('${STAFF}', 'admin'), ('${STAFF}', 'staff');

    INSERT INTO public.categories(id, name, sort_order) VALUES
      ('aaaaaaaa-0000-0000-0000-000000000001', 'Food', 1),
      ('aaaaaaaa-0000-0000-0000-000000000002', 'Drinks', 2),
      ('aaaaaaaa-0000-0000-0000-000000000003', 'Desserts', 3);
    INSERT INTO public.subcategories(id, category_id, name, sort_order) VALUES
      ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'Burgers', 1),
      ('bbbbbbbb-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', 'Pasta', 2),
      ('bbbbbbbb-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000001', 'Fries', 3),
      ('bbbbbbbb-0000-0000-0000-000000000004', 'aaaaaaaa-0000-0000-0000-000000000001', 'Kids Menu', 4),
      ('bbbbbbbb-0000-0000-0000-000000000005', 'aaaaaaaa-0000-0000-0000-000000000003', 'Desserts', 5),
      ('bbbbbbbb-0000-0000-0000-000000000006', 'aaaaaaaa-0000-0000-0000-000000000002', 'Coffee', 6),
      ('bbbbbbbb-0000-0000-0000-000000000007', 'aaaaaaaa-0000-0000-0000-000000000002', 'Other', 7),
      ('bbbbbbbb-0000-0000-0000-000000000008', 'aaaaaaaa-0000-0000-0000-000000000002', 'Lemonade', 8);

    INSERT INTO public.menu_items(id, subcategory_id, name, price, is_available, station, meal_role, dietary_tags, margin_score) VALUES
      ('${BURGER}',   'bbbbbbbb-0000-0000-0000-000000000001', 'La Soul Burger', 16.50, true, 'kitchen', 'main',       '{}',                       0),
      ('${PASTA}',    'bbbbbbbb-0000-0000-0000-000000000002', 'Pesto Pasta',    14.00, true, 'kitchen', 'main',       '{vegetarian}',             0),
      ('${FRIES}',    'bbbbbbbb-0000-0000-0000-000000000003', 'Fries',           5.00, true, 'kitchen', 'side',       '{vegan,vegetarian,halal}', 0),
      ('${KIDS}',     'bbbbbbbb-0000-0000-0000-000000000004', 'Kids Nuggets',    9.00, true, 'kitchen', 'main',       '{}',                       0),
      ('${CAKE}',     'bbbbbbbb-0000-0000-0000-000000000005', 'Cheesecake',      8.00, true, 'kitchen', 'dessert',    '{vegetarian}',             0),
      ('${ESPRESSO}', 'bbbbbbbb-0000-0000-0000-000000000006', 'Espresso',        3.00, true, 'bar',     'hot_drink',  '{vegan,vegetarian,halal}', 0),
      ('${COLA}',     'bbbbbbbb-0000-0000-0000-000000000007', 'Coca-Cola',       4.00, true, 'bar',     'cold_drink', '{vegan,vegetarian,halal}', 0),
      ('${V60}',      'bbbbbbbb-0000-0000-0000-000000000007', 'V60 Cold',       15.00, true, 'bar',     'cold_drink', '{vegan,vegetarian,halal}', 0),
      ('${LEMONADE}', 'bbbbbbbb-0000-0000-0000-000000000008', 'Peach Lemonade',  6.00, true, 'bar',     'cold_drink', '{vegan,vegetarian}',       0);

    INSERT INTO public.tables(id, table_number) VALUES ('${TABLE}', 7);
    INSERT INTO public.table_sessions(id, table_id, token, is_active, guest_name, last_heartbeat_at)
      VALUES ('${SESSION}', '${TABLE}', '${TOKEN}', true, 'Amina', now());
  `);
  await db.exec(`ALTER TABLE public.orders DISABLE TRIGGER trg_enforce_order_limits`);
  await actAs(db, null);
}

/**
 * One order, in its own (closed) visit unless a session is given.
 *
 * `servedMinutesAgo` stamps the lines as served, which is what the after-meal
 * logic reads. `status` lets a test place an order that is NOT a sale.
 */
async function order(
  items: string[],
  opts: { session?: string; servedMinutesAgo?: number; status?: string; minutesAgo?: number } = {},
) {
  let session = opts.session;
  if (!session) {
    session = crypto.randomUUID();
    await db.query(
      `INSERT INTO public.table_sessions(id, table_id, token, is_active, last_heartbeat_at)
       VALUES ($1, '${TABLE}', $2, false, now())`,
      [session, `v-${session.slice(0, 8)}`]);
  }
  const status = opts.status ?? 'served';
  const sale = !['awaiting_payment', 'payment_failed', 'cancelled'].includes(status);
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO public.orders(table_session_id, total, status, payment_status, payment_method,
                               released_to_kitchen_at, paid_at, created_at)
     VALUES ($1, 0, $2, $3, 'cash', CASE WHEN $4 THEN now() END, CASE WHEN $4 THEN now() END,
             now() - make_interval(mins => $5))
     RETURNING id`,
    [session, status, sale ? 'paid' : 'unpaid', sale, opts.minutesAgo ?? 0]);
  for (const item of items) {
    await db.query(
      `INSERT INTO public.order_items(order_id, menu_item_id, quantity, unit_price, status, served_at)
       SELECT $1, id, 1, price, 'served',
              CASE WHEN $3::int IS NULL THEN NULL ELSE now() - make_interval(mins => $3::int) END
         FROM public.menu_items WHERE id = $2`,
      [rows[0].id, item, opts.servedMinutesAgo ?? null]);
  }
  return session;
}

/** Make items "popular": three separate paid orders each, from other tables. */
async function popular(items: string[]) {
  for (let i = 0; i < 3; i += 1) await order(items);
}

const rank = async (cart: string[], placement = 'cart') => {
  const { rows } = await db.query<{ id: string; recommendation_type: string }>(
    `SELECT id, recommendation_type
       FROM public.rank_recommendations($1::uuid[], $2, 'en', 8, $3::uuid, '{}'::text[])`,
    [cart, placement, SESSION]);
  return rows;
};
const ids = async (cart: string[], placement = 'cart') => (await rank(cart, placement)).map((r) => r.id);

const fits = async (
  role: string | null, placement: string, cart: string[],
  opts: { rtype?: string; curated?: boolean; at?: string } = {},
) => {
  const { rows } = await db.query<{ ok: boolean }>(
    `SELECT public.reco_role_fits($1::public.meal_role, $2, $3, $4, $5::uuid[], $6::uuid,
                                  COALESCE($7::timestamptz, now())) AS ok`,
    [role, placement, opts.rtype ?? 'popular', opts.curated ?? false, cart, SESSION, opts.at ?? null]);
  return rows[0].ok;
};

// 15:00 and 09:00 in Sarajevo, summer time.
const AFTERNOON = '2026-08-02 15:00+02';
const MORNING = '2026-08-02 09:00+02';

beforeAll(async () => { db = (await createTestDatabase({ quiet: true })) as unknown as Db; }, 180_000);
afterAll(async () => { await db?.close(); });
beforeEach(seed);

describe('coursing rules', () => {
  it('never offers another main, or a dessert, next to a burger', async () => {
    expect(await fits('main', 'cart', [BURGER])).toBe(false);
    expect(await fits('dessert', 'cart', [BURGER])).toBe(false);
  });

  it('offers a cold drink with a burger, and a hot one only at breakfast', async () => {
    expect(await fits('cold_drink', 'cart', [BURGER])).toBe(true);
    expect(await fits('hot_drink', 'cart', [BURGER], { at: AFTERNOON })).toBe(false);
    expect(await fits('hot_drink', 'cart', [BURGER], { at: MORNING })).toBe(true);
  });

  it('reads breakfast on the Sarajevo clock, not UTC', async () => {
    // 10:30 in Sarajevo is 08:30 UTC — morning both ways. 11:30 in Sarajevo
    // is 09:30 UTC: a UTC clock would still call that breakfast.
    expect(await fits('hot_drink', 'cart', [BURGER], { at: '2026-08-02 10:30+02' })).toBe(true);
    expect(await fits('hot_drink', 'cart', [BURGER], { at: '2026-08-02 11:30+02' })).toBe(false);
  });

  it('offers a side only alongside a main', async () => {
    expect(await fits('side', 'cart', [BURGER])).toBe(true);
    expect(await fits('side', 'cart', [COLA])).toBe(false);
  });

  it('never offers a second drink to a cart that has one', async () => {
    expect(await fits('cold_drink', 'cart', [COLA])).toBe(false);
    expect(await fits('hot_drink', 'cart', [COLA], { at: MORNING })).toBe(false);
  });

  it('keeps alcohol and unclassified items to observed evidence', async () => {
    // At a fixed afternoon hour: alcohol is never suggested before noon at all
    // (see reco-learning-v3), so "now" would make this depend on the clock.
    expect(await fits('alcohol', 'cart', [BURGER], { at: AFTERNOON })).toBe(false);
    expect(await fits('alcohol', 'cart', [BURGER], { rtype: 'observed', at: AFTERNOON })).toBe(true);
    expect(await fits(null, 'cart', [BURGER])).toBe(false);
    expect(await fits(null, 'cart', [BURGER], { rtype: 'observed' })).toBe(true);
  });

  it('lets a curated pair choose its own moment, but never duplicate a course', async () => {
    // The owner chose it, so a dessert next to a burger or a hot drink with a
    // main is theirs to decide. Availability, diet and allergens still apply —
    // in the ranker, not here.
    expect(await fits('dessert', 'cart', [BURGER], { curated: true })).toBe(true);
    expect(await fits('hot_drink', 'cart', [BURGER], { curated: true, at: '2026-08-04T14:00:00Z' })).toBe(true);
    // What no owner means: a second main, a second drink, a second dessert.
    expect(await fits('main', 'cart', [BURGER], { curated: true })).toBe(false);
    expect(await fits('cold_drink', 'cart', [BURGER, COLA], { curated: true })).toBe(false);
    expect(await fits('dessert', 'cart', [CAKE], { curated: true })).toBe(false);
  });

  it('after the meal: dessert or a hot drink, never a main', async () => {
    expect(await fits('dessert', 'after_meal', [])).toBe(true);
    expect(await fits('hot_drink', 'after_meal', [])).toBe(true);
    expect(await fits('main', 'after_meal', [])).toBe(false);
    expect(await fits('starter', 'after_meal', [])).toBe(false);
    expect(await fits('side', 'after_meal', [])).toBe(false);
  });

  it('after the meal: a cold drink only to a table that has had none', async () => {
    await order([BURGER], { session: SESSION, servedMinutesAgo: 20 });
    expect(await fits('cold_drink', 'after_meal', [])).toBe(true);
    await order([COLA], { session: SESSION, servedMinutesAgo: 15 });
    expect(await fits('cold_drink', 'after_meal', [])).toBe(false);
  });
});

describe('the ranker obeys them', () => {
  it('suggests a cold drink, never a main or dessert, next to a burger', async () => {
    await popular([BURGER, PASTA, KIDS, FRIES, CAKE, ESPRESSO, COLA, V60, LEMONADE]);

    const rows = await rank([BURGER]);
    const got = rows.map((r) => r.id);
    for (const id of [...MAINS, CAKE]) expect(got).not.toContain(id);
    expect(got.some((id) => [COLA, V60, LEMONADE].includes(id))).toBe(true);
  });

  it('labels generic popularity honestly', async () => {
    // It used to say `frequently_bought_together`, a claim about evidence
    // that did not exist.
    await popular([FRIES]);
    const rows = await rank([BURGER]);
    expect(rows.find((r) => r.id === FRIES)?.recommendation_type).toBe('popular');
  });

  it('never offers a second drink to a drinks-only cart', async () => {
    await popular([ESPRESSO, V60, LEMONADE, PASTA]);
    const got = await ids([COLA]);
    for (const id of DRINKS) expect(got).not.toContain(id);
  });

  it('only offers dessert or a hot drink after the meal', async () => {
    await popular([BURGER, PASTA, FRIES, CAKE, ESPRESSO]);
    await order([BURGER, COLA], { session: SESSION, servedMinutesAgo: 20 });

    const got = await ids([], 'after_meal');
    expect(got).toContain(CAKE);
    for (const id of got) expect([CAKE, ESPRESSO]).toContain(id);
  });

  it('keeps kids\' dishes out unless the owner curated them', async () => {
    await popular([KIDS, PASTA]);
    expect(await ids([COLA])).not.toContain(KIDS);

    await db.query(
      `INSERT INTO public.menu_item_recommendations(source_item_id, recommended_item_id, recommendation_type, priority)
       VALUES ($1, $2, 'pair_with', 80)`, [COLA, KIDS]);
    expect(await ids([COLA])).toContain(KIDS);
  });

  it('does not push a 15 KM drink next to a 16 KM burger on the first round', async () => {
    // No history yet: the average line price now includes the cart, so the
    // price check runs from the first round.
    await popular([COLA, V60]);
    const got = await ids([BURGER]);
    expect(got).toContain(COLA);
    expect(got.indexOf(COLA)).toBeLessThan(got.indexOf(V60) === -1 ? Infinity : got.indexOf(V60));
  });

  it('runs basket completion on the dish page too', async () => {
    // Someone looking at a burger with no drink anywhere is the same gap as a
    // cart holding one. No history, nothing popular: only completion is left.
    const rows = await rank([BURGER], 'item');
    expect(rows.some((r) => [COLA, V60, LEMONADE].includes(r.id) && r.recommendation_type === 'add_on')).toBe(true);
  });
});

describe('time windows are Sarajevo time', () => {
  it('offers a dish whose window is open in Sarajevo, not one open in UTC', async () => {
    /*
     * One window around the current Sarajevo time and one around the current
     * UTC time. They are one or two hours apart all year, so a 20-minute
     * window can only contain one of them.
     */
    await db.exec(`
      UPDATE public.menu_items
         SET available_from = (now() AT TIME ZONE 'Europe/Sarajevo')::time - interval '10 minutes',
             available_to   = (now() AT TIME ZONE 'Europe/Sarajevo')::time + interval '10 minutes'
       WHERE id = '${LEMONADE}';
      UPDATE public.menu_items
         SET available_from = (now() AT TIME ZONE 'UTC')::time - interval '10 minutes',
             available_to   = (now() AT TIME ZONE 'UTC')::time + interval '10 minutes'
       WHERE id = '${COLA}';
      INSERT INTO public.menu_item_recommendations(source_item_id, recommended_item_id, recommendation_type, priority)
      VALUES ('${BURGER}', '${LEMONADE}', 'pair_with', 90),
             ('${BURGER}', '${COLA}',     'pair_with', 90);
    `);

    const got = await ids([BURGER]);
    expect(got).toContain(LEMONADE);
    expect(got).not.toContain(COLA);
  });
});

describe('what the guest receives', () => {
  const recommend = async (opts: { tags?: string[]; exclude?: string[]; limit?: number } = {}) => {
    const { rows } = await db.query<{ decision_id: string; id: string }>(
      `SELECT decision_id, id
         FROM public.guest_get_recommendations($1::uuid, $2, $3::uuid[], 'cart', 'en', $4,
                                               '{}'::text[], $5::text[], $6::uuid[])`,
      [SESSION, TOKEN, [BURGER], opts.limit ?? 4, opts.tags ?? [], opts.exclude ?? []]);
    return rows;
  };

  beforeEach(async () => {
    await popular([FRIES, COLA, V60, LEMONADE]);
  });

  it('comes back in ranked order, and the ledger records the first as the choice', async () => {
    const ranked = (await ids([BURGER])).slice(0, 4);
    const rows = await recommend();
    expect(rows.map((r) => r.id)).toEqual(ranked);

    const { rows: d } = await db.query<{ chosen_item_id: string; candidates: { item_id: string; rank: number }[] }>(
      `SELECT chosen_item_id, candidates FROM public.recommendation_decisions WHERE id = $1`,
      [rows[0].decision_id]);
    expect(d[0].chosen_item_id).toBe(rows[0].id);
    expect(d[0].candidates.map((c) => c.item_id)).toEqual(ranked);
    expect(d[0].candidates.map((c) => c.rank)).toEqual(ranked.map((_, i) => i + 1));
  });

  it('obeys the guest\'s diet filter exactly as the menu does', async () => {
    // Every active tag must be on the dish. Peach Lemonade is not tagged
    // halal, so a guest filtering for halal never sees it suggested.
    const rows = await recommend({ tags: ['halal'] });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.map((r) => r.id)).not.toContain(LEMONADE);
    const { rows: tagged } = await db.query<{ ok: boolean }>(
      `SELECT bool_and('halal' = ANY(dietary_tags)) AS ok FROM public.menu_items WHERE id = ANY($1::uuid[])`,
      [rows.map((r) => r.id)]);
    expect(tagged[0].ok).toBe(true);
  });

  it('leaves out what the guest dismissed, and records what it showed instead', async () => {
    const first = (await recommend())[0].id;
    const rows = await recommend({ exclude: [first] });
    expect(rows.map((r) => r.id)).not.toContain(first);

    const { rows: d } = await db.query<{ chosen_item_id: string }>(
      `SELECT chosen_item_id FROM public.recommendation_decisions WHERE id = $1`, [rows[0].decision_id]);
    expect(d[0].chosen_item_id).toBe(rows[0].id);
  });

  it('can be asked twice in one transaction', async () => {
    await db.exec('BEGIN');
    try {
      await recommend();
      await recommend();
    } finally {
      await db.exec('ROLLBACK');
    }
  });
});

describe('popular means paid for, more than twice', () => {
  const popularIds = async () => {
    const { rows } = await db.query<{ menu_item_id: string }>(
      `SELECT menu_item_id FROM public.get_popular_items(12, 30)`);
    return rows.map((r) => r.menu_item_id);
  };

  it('needs three orders before an item is "popular"', async () => {
    await order([CAKE]);
    await order([CAKE]);
    expect(await popularIds()).not.toContain(CAKE);
    await order([CAKE]);
    expect(await popularIds()).toContain(CAKE);
  });

  it('does not count an order nobody paid for', async () => {
    await order([CAKE]);
    await order([CAKE]);
    await order([CAKE], { status: 'awaiting_payment' });
    await order([CAKE], { status: 'cancelled' });
    expect(await popularIds()).not.toContain(CAKE);
  });
});

describe('the after-meal prompt asks once', () => {
  const moment = async () => {
    const { rows } = await db.query<{ ok: boolean }>(`SELECT public.after_meal_moment($1) AS ok`, [SESSION]);
    return rows[0].ok;
  };

  it('does not ask again once they have had dessert', async () => {
    await order([BURGER], { session: SESSION, servedMinutesAgo: 40, minutesAgo: 60 });
    expect(await moment()).toBe(true);

    // The answer to "anything else?" was a cheesecake, served a while ago.
    await order([CAKE], { session: SESSION, servedMinutesAgo: 15, minutesAgo: 25 });
    expect(await moment()).toBe(false);
  });

  it('still asks when the only coffee came with the burger', async () => {
    await order([BURGER, ESPRESSO], { session: SESSION, servedMinutesAgo: 30, minutesAgo: 50 });
    expect(await moment()).toBe(true);
  });
});

describe('the engine learns', () => {
  it('fills visit-grain pairs from the one-button refresh', async () => {
    // Burger in one round, coffee in the next, six visits. The refresh used to
    // skip this table entirely because its rewrite never matched.
    for (let i = 0; i < 6; i += 1) {
      const s = await order([BURGER]);
      await order([ESPRESSO], { session: s });
    }
    await actAs(db, STAFF);
    const { rows } = await db.query<{ r: Record<string, number> }>(`SELECT public.refresh_menu_intelligence() AS r`);
    await actAs(db, null);

    expect(Number(rows[0].r.session_pairs)).toBeGreaterThan(0);
    const { rows: pairs } = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM public.session_item_affinity WHERE item_a = $1 AND item_b = $2`,
      [BURGER, ESPRESSO]);
    expect(pairs[0].n).toBe(1);
  });

  it('runs nightly without a staff member, and learns while it does', async () => {
    for (let i = 0; i < 6; i += 1) {
      const s = await order([BURGER]);
      await order([ESPRESSO], { session: s });
    }

    // What pg_cron runs: no JWT, no auth.uid().
    const { rows } = await db.query<{ r: Record<string, unknown> }>(
      `SELECT public.run_scheduled_maintenance() AS r`);
    expect(rows[0].r.ran).toBe(true);
    expect((rows[0].r.menu_intelligence as Record<string, unknown>).error).toBeUndefined();

    const { rows: pairs } = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM public.session_item_affinity`);
    expect(pairs[0].n).toBeGreaterThan(0);

    // The scheduler's mark does not outlive the call.
    const { rows: after } = await db.query<{ v: string | null }>(
      `SELECT current_setting('lasoul.scheduled_job', true) AS v`);
    expect(after[0].v ?? '').not.toBe('on');
  });

  it('accepts the service_role key', async () => {
    await db.query(`SELECT set_config('request.jwt.claim.role', 'service_role', false)`);
    try {
      const { rows } = await db.query<{ r: Record<string, unknown> }>(`SELECT public.run_daily_maintenance() AS r`);
      expect(rows[0].r.ran).toBe(true);
    } finally {
      await db.query(`SELECT set_config('request.jwt.claim.role', '', false)`);
    }
  });

  it('still refuses an anonymous caller', async () => {
    await expect(db.query(`SELECT public.run_daily_maintenance()`)).rejects.toThrow(/Only staff/);
    await expect(db.query(`SELECT public.refresh_menu_intelligence()`)).rejects.toThrow(/Only staff/);
    await expect(db.query(`SELECT public.maybe_enable_sampling()`)).rejects.toThrow(/Only staff/);
  });

  it('keeps the scheduler entry point away from every API role', async () => {
    const { rows } = await db.query<{ anon: boolean; auth: boolean }>(`
      SELECT has_function_privilege('anon', 'public.run_scheduled_maintenance()', 'EXECUTE') AS anon,
             has_function_privilege('authenticated', 'public.run_scheduled_maintenance()', 'EXECUTE') AS auth
    `);
    expect(rows[0].anon).toBe(false);
    expect(rows[0].auth).toBe(false);
  });
});

describe('meal roles the classifier missed', () => {
  const role = async (id: string) => {
    const { rows } = await db.query<{ r: string | null }>(
      `SELECT meal_role::text AS r FROM public.menu_items WHERE id = $1`, [id]);
    return rows[0].r;
  };

  it('fills gaps and fixes contradictions, and leaves deliberate choices alone', async () => {
    await db.exec(`
      INSERT INTO public.subcategories(id, category_id, name, sort_order) VALUES
        ('bbbbbbbb-0000-0000-0000-000000000010', 'aaaaaaaa-0000-0000-0000-000000000002', 'Iced Tea', 10),
        ('bbbbbbbb-0000-0000-0000-000000000011', 'aaaaaaaa-0000-0000-0000-000000000001', 'Breakfast', 11),
        ('bbbbbbbb-0000-0000-0000-000000000012', 'aaaaaaaa-0000-0000-0000-000000000002', 'Special Drinks', 12),
        ('bbbbbbbb-0000-0000-0000-000000000013', 'aaaaaaaa-0000-0000-0000-000000000002', 'Filter Coffee', 13);
      INSERT INTO public.menu_items(id, subcategory_id, name, price, is_available, station, meal_role) VALUES
        ('cccccccc-cccc-cccc-cccc-cccccccc0101', 'bbbbbbbb-0000-0000-0000-000000000010', 'Peach Iced Tea', 8, true, 'bar',     'hot_drink'),
        ('cccccccc-cccc-cccc-cccc-cccccccc0102', 'bbbbbbbb-0000-0000-0000-000000000011', 'Turkish Egg',   15, true, 'kitchen', NULL),
        ('cccccccc-cccc-cccc-cccc-cccccccc0103', 'bbbbbbbb-0000-0000-0000-000000000012', 'Affogato',      13, true, 'bar',     'dessert'),
        ('cccccccc-cccc-cccc-cccc-cccccccc0104', 'bbbbbbbb-0000-0000-0000-000000000013', 'V60 Cold',      15, true, 'bar',     'hot_drink'),
        ('cccccccc-cccc-cccc-cccc-cccccccc0105', 'bbbbbbbb-0000-0000-0000-000000000013', 'V60 Hot',       15, true, 'bar',     'hot_drink');
      UPDATE public.menu_items SET meal_role = NULL WHERE id = '${KIDS}';
    `);

    await db.query(`SELECT public.reclassify_meal_roles()`);

    expect(await role('cccccccc-cccc-cccc-cccc-cccccccc0101')).toBe('cold_drink');
    expect(await role('cccccccc-cccc-cccc-cccc-cccccccc0102')).toBe('main');
    expect(await role('cccccccc-cccc-cccc-cccc-cccccccc0103')).toBe('dessert');
    expect(await role('cccccccc-cccc-cccc-cccc-cccccccc0104')).toBe('cold_drink');
    expect(await role('cccccccc-cccc-cccc-cccc-cccccccc0105')).toBe('hot_drink');
    expect(await role(KIDS)).toBe('main');

    // Idempotent: a second pass has nothing left to do.
    const { rows } = await db.query<{ r: Record<string, number> }>(`SELECT public.reclassify_meal_roles() AS r`);
    expect(rows[0].r).toEqual({});
  });
});
