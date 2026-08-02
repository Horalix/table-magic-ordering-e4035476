/**
 * @vitest-environment node
 *
 * Suggestions that know what the table has already eaten.
 *
 * Two of these tests are about defects that were live before this migration:
 *
 *   - the after-meal prompt ran with an EMPTY cart, so the best upsell of the
 *     night fell through to generic popularity;
 *   - `cart_diet` was a hard filter, so one phone at a shared table ordering a
 *     salad hid every meat dish from everybody else.
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
const STEAK = 'cccccccc-cccc-cccc-cccc-cccccccc0001';   // main, 30
const SALAD = 'cccccccc-cccc-cccc-cccc-cccccccc0002';   // starter, vegan, 9
const COFFEE = 'cccccccc-cccc-cccc-cccc-cccccccc0003';  // hot_drink, 3
const CAKE = 'cccccccc-cccc-cccc-cccc-cccccccc0004';    // dessert, 8
const LOBSTER = 'cccccccc-cccc-cccc-cccc-cccccccc0005'; // main, 90
const SESSION = 'eeeeeeee-eeee-eeee-eeee-eeeeeeee0001';
const TOKEN = 'sess-token-7';

let db: Db;

async function seed() {
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
       SET ordering_enabled = true, online_card_enabled = false,
           recommendations_enabled = true, reco_holdout_pct = 0,
           reco_exploration = 0, after_meal_prompt_minutes = 8
     WHERE id = 1;

    INSERT INTO auth.users(id) VALUES ('${STAFF}');
    INSERT INTO public.user_roles(user_id, role) VALUES ('${STAFF}', 'admin'), ('${STAFF}', 'staff');

    INSERT INTO public.categories(id, name, sort_order) VALUES
      ('aaaaaaaa-0000-0000-0000-000000000001', 'Food', 1),
      ('aaaaaaaa-0000-0000-0000-000000000002', 'Drinks', 2);
    INSERT INTO public.subcategories(id, category_id, name, sort_order) VALUES
      ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'Mains', 1),
      ('bbbbbbbb-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000001', 'Sweet', 3),
      ('bbbbbbbb-0000-0000-0000-000000000004', 'aaaaaaaa-0000-0000-0000-000000000001', 'Starters', 4),
      ('bbbbbbbb-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000002', 'Hot', 2);

    INSERT INTO public.menu_items(id, subcategory_id, name, price, is_available, station, meal_role, dietary_tags) VALUES
      ('${STEAK}',   'bbbbbbbb-0000-0000-0000-000000000001', 'Steak',   30.00, true, 'kitchen', 'main',      '{}'),
      ('${SALAD}',   'bbbbbbbb-0000-0000-0000-000000000004', 'Salad',    9.00, true, 'kitchen', 'starter',   '{vegan,vegetarian}'),
      ('${COFFEE}',  'bbbbbbbb-0000-0000-0000-000000000002', 'Espresso', 3.00, true, 'bar',     'hot_drink', '{vegan,vegetarian}'),
      ('${CAKE}',    'bbbbbbbb-0000-0000-0000-000000000003', 'Cake',     8.00, true, 'kitchen', 'dessert',   '{vegetarian}'),
      ('${LOBSTER}', 'bbbbbbbb-0000-0000-0000-000000000001', 'Lobster', 90.00, true, 'kitchen', 'main',      '{}');

    INSERT INTO public.tables(id, table_number) VALUES ('dddddddd-0000-0000-0000-000000000001', 7);
    INSERT INTO public.table_sessions(id, table_id, token, is_active, guest_name, last_heartbeat_at)
      VALUES ('${SESSION}', 'dddddddd-0000-0000-0000-000000000001', '${TOKEN}', true, 'Amina', now());
  `);
  await db.exec(`ALTER TABLE public.orders DISABLE TRIGGER trg_enforce_order_limits`);
  await actAs(db, null);
}

/** An order in this session, optionally already served N minutes ago. */
async function ordered(items: string[], servedMinutesAgo: number | null = null) {
  const { rows } = await db.query<{ result: Record<string, unknown> }>(
    `SELECT public.guest_place_order($1, $2, 'Amina', 'cash', $3::jsonb, 0) AS result`,
    [SESSION, TOKEN, JSON.stringify(items.map((id) => ({ menu_item_id: id, quantity: 1 })))],
  );
  const orderId = rows[0].result.order_id as string;
  if (servedMinutesAgo !== null) {
    // Item-level served_at is what session_context reads. The order's own
    // status is left alone rather than jumped straight to 'served' — the
    // state machine rightly refuses pending -> served, and walking every
    // stage here would test the state machine, not the context.
    await db.query(
      `UPDATE public.order_items SET served_at = now() - make_interval(mins => $2) WHERE order_id = $1`,
      [orderId, servedMinutesAgo]);
  }
  return orderId;
}

const rank = async (cart: string[], placement = 'cart') => {
  const { rows } = await db.query<{ id: string; name: string }>(
    `SELECT id, name FROM public.rank_recommendations($1::uuid[], $2, 'en', 8, $3::uuid, '{}'::text[])`,
    [cart, placement, SESSION],
  );
  return rows.map((r) => r.id);
};

beforeAll(async () => { db = (await createTestDatabase({ quiet: true })) as unknown as Db; }, 180_000);
afterAll(async () => { await db?.close(); });
beforeEach(seed);

describe('the visit is in scope', () => {
  it('reports what has been ordered and served', async () => {
    await ordered([STEAK], 20);
    const { rows } = await db.query<{
      ordered_item_ids: string[]; served_item_ids: string[];
      minutes_since_served: number; has_served_main: boolean; avg_line_price: number;
    }>(`SELECT * FROM public.session_context($1)`, [SESSION]);

    expect(rows[0].ordered_item_ids).toContain(STEAK);
    expect(rows[0].served_item_ids).toContain(STEAK);
    expect(Number(rows[0].minutes_since_served)).toBeGreaterThanOrEqual(19);
    expect(rows[0].has_served_main).toBe(true);
    expect(Number(rows[0].avg_line_price)).toBe(30);
  });

  it('pairs the after-meal prompt off what was eaten, with an empty cart', async () => {
    /*
     * The headline fix. The cart is empty at this moment — they already
     * ordered — so before this the engine had nothing to pair against and fell
     * through to generic popularity.
     */
    await db.query(
      `INSERT INTO public.menu_item_recommendations(source_item_id, recommended_item_id, recommendation_type, priority)
       VALUES ($1, $2, 'after_meal', 95)`, [STEAK, CAKE]);
    await ordered([STEAK], 20);

    expect(await rank([], 'after_meal')).toContain(CAKE);
  });

  it('is not fooled by an order that is still in the kitchen', async () => {
    await ordered([STEAK], null);
    const { rows } = await db.query<{ has_served_main: boolean }>(
      `SELECT has_served_main FROM public.session_context($1)`, [SESSION]);
    expect(rows[0].has_served_main).toBe(false);
  });
});

describe('repeat rules follow the role', () => {
  it('allows a second coffee after the interval', async () => {
    // Ordinary café behaviour. A blanket "never suggest what they ordered"
    // would refuse this.
    await ordered([COFFEE], 40);
    expect(await db.query<{ blocked: boolean }>(
      `SELECT public.repeat_blocked($1, $2) AS blocked`, [COFFEE, SESSION],
    ).then((r) => r.rows[0].blocked)).toBe(false);
  });

  it('does not offer the same coffee two minutes later', async () => {
    await ordered([COFFEE], 2);
    expect(await db.query<{ blocked: boolean }>(
      `SELECT public.repeat_blocked($1, $2) AS blocked`, [COFFEE, SESSION],
    ).then((r) => r.rows[0].blocked)).toBe(true);
  });

  it('never offers a second identical main', async () => {
    await ordered([STEAK], 90);
    expect(await db.query<{ blocked: boolean }>(
      `SELECT public.repeat_blocked($1, $2) AS blocked`, [STEAK, SESSION],
    ).then((r) => r.rows[0].blocked)).toBe(true);
  });

  it('treats an unclassified item as unrepeatable', async () => {
    // The safe direction: better to under-suggest than to push a duplicate.
    await db.exec(`UPDATE public.menu_items SET meal_role = NULL WHERE id = '${CAKE}'`);
    await ordered([CAKE], 90);
    expect(await db.query<{ blocked: boolean }>(
      `SELECT public.repeat_blocked($1, $2) AS blocked`, [CAKE, SESSION],
    ).then((r) => r.rows[0].blocked)).toBe(true);
  });

  it('keeps a repeated item out of the ranking', async () => {
    await db.query(
      `INSERT INTO public.menu_item_recommendations(source_item_id, recommended_item_id, recommendation_type, priority)
       VALUES ($1, $2, 'pair_with', 95)`, [SALAD, STEAK]);
    await ordered([STEAK], 30);
    expect(await rank([SALAD])).not.toContain(STEAK);
  });
});

describe('diet is a preference, not a wall', () => {
  it('never hides meat from a shared table', async () => {
    /*
     * THE live bug. One phone, four people. Someone adds a salad, the cart
     * reads as vegetarian, and the steak disappears for everybody.
     */
    await db.query(
      `INSERT INTO public.menu_item_recommendations(source_item_id, recommended_item_id, recommendation_type, priority)
       VALUES ($1, $2, 'pair_with', 95)`, [SALAD, STEAK]);

    expect(await rank([SALAD])).toContain(STEAK);
  });

  it('still prefers the conforming option', async () => {
    // A nudge, not a wall: with equal curation the vegetarian item outranks
    // the meat one for a vegetarian cart.
    await db.exec(`
      INSERT INTO public.menu_item_recommendations(source_item_id, recommended_item_id, recommendation_type, priority)
      VALUES ('${SALAD}', '${STEAK}', 'pair_with', 90),
             ('${SALAD}', '${CAKE}',  'pair_with', 90);
    `);

    const ids = await rank([SALAD]);
    expect(ids.indexOf(CAKE)).toBeLessThan(ids.indexOf(STEAK));
  });

  it('keeps an explicit allergen filter hard', async () => {
    await db.exec(`UPDATE public.menu_items SET allergens = '{nuts}' WHERE id = '${CAKE}'`);
    await db.query(
      `INSERT INTO public.menu_item_recommendations(source_item_id, recommended_item_id, recommendation_type, priority)
       VALUES ($1, $2, 'pair_with', 95)`, [SALAD, CAKE]);

    const { rows } = await db.query<{ id: string }>(
      `SELECT id FROM public.rank_recommendations($1::uuid[], 'cart', 'en', 8, $2::uuid, $3::text[])`,
      [[SALAD], SESSION, ['nuts']]);
    expect(rows.map((r) => r.id)).not.toContain(CAKE);
  });
});

describe('suggestions stay in the table\'s price range', () => {
  it('pushes down something far above what they are spending', async () => {
    await db.exec(`
      INSERT INTO public.menu_item_recommendations(source_item_id, recommended_item_id, recommendation_type, priority)
      VALUES ('${COFFEE}', '${LOBSTER}', 'pair_with', 90),
             ('${COFFEE}', '${CAKE}',    'pair_with', 90);
    `);
    // A table whose average line is 3 KM is not the audience for a 90 KM dish.
    await ordered([COFFEE], 5);

    const ids = await rank([]);
    expect(ids.indexOf(CAKE)).toBeLessThan(ids.indexOf(LOBSTER));
  });

  it('does not penalise a cheaper suggestion', async () => {
    await db.exec(`
      INSERT INTO public.menu_item_recommendations(source_item_id, recommended_item_id, recommendation_type, priority)
      VALUES ('${STEAK}', '${COFFEE}', 'pair_with', 90);
    `);
    await ordered([STEAK], 5);
    expect(await rank([])).toContain(COFFEE);
  });
});

describe('the after-meal moment', () => {
  it('is not the moment the starters land', async () => {
    await ordered([SALAD], 2);
    const { rows } = await db.query<{ ok: boolean }>(
      `SELECT public.after_meal_moment($1) AS ok`, [SESSION]);
    expect(rows[0].ok).toBe(false);
  });

  it('is not immediately after the mains either', async () => {
    // Offering dessert the second the plate lands is rushing the table.
    await ordered([STEAK], 1);
    const { rows } = await db.query<{ ok: boolean }>(
      `SELECT public.after_meal_moment($1) AS ok`, [SESSION]);
    expect(rows[0].ok).toBe(false);
  });

  it('arrives once they have had time to eat', async () => {
    await ordered([STEAK], 20);
    const { rows } = await db.query<{ ok: boolean }>(
      `SELECT public.after_meal_moment($1) AS ok`, [SESSION]);
    expect(rows[0].ok).toBe(true);
  });

  it('is configurable', async () => {
    await db.exec(`UPDATE public.restaurant_settings SET after_meal_prompt_minutes = 45 WHERE id = 1`);
    await ordered([STEAK], 20);
    const { rows } = await db.query<{ ok: boolean }>(
      `SELECT public.after_meal_moment($1) AS ok`, [SESSION]);
    expect(rows[0].ok).toBe(false);
  });
});

describe('authorisation', () => {
  it('keeps session context away from guests', async () => {
    const { rows } = await db.query<{ ctx: boolean; repeat: boolean }>(`
      SELECT has_function_privilege('anon',
               'public.session_context(uuid)', 'EXECUTE') AS ctx,
             has_function_privilege('anon',
               'public.repeat_blocked(uuid,uuid)', 'EXECUTE') AS repeat
    `);
    expect(rows[0].ctx).toBe(false);
    expect(rows[0].repeat).toBe(false);
  });
});
