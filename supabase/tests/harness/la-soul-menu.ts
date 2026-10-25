/**
 * The live La Soul menu of 24 October 2026, loaded into a fresh test database
 * and brought to where production will be once the pending batch has run —
 * the same steps as reco-waiter-scenarios.test.ts — plus a helper that
 * writes whole visits the way the app does: one transaction per order, so
 * the commit-time learning trigger sees the order with all its lines.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
// @ts-expect-error -- plain JS harness, no types needed
import { createTestDatabase, actAs } from '../../../scripts/db-harness.mjs';

export type Db = {
  query: <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<{ rows: T[] }>;
  exec: (sql: string) => Promise<unknown>;
  close: () => Promise<void>;
};

const MIGRATIONS = path.join(__dirname, '..', '..', 'migrations');
const migration = (file: string) => readFileSync(path.join(MIGRATIONS, file), 'utf8');
const MENU = JSON.parse(readFileSync(path.join(__dirname, '..', 'fixtures', 'la-soul-menu-2026-10-24.json'), 'utf8')) as {
  categories: Record<string, unknown>[];
  subcategories: Record<string, unknown>[];
  menu_items: Record<string, unknown>[];
};

export const MENU_TABLE = 'dddddddd-0000-0000-0000-0000000000bb';

export async function laSoulDatabase(): Promise<Db> {
  const db = (await createTestDatabase({ quiet: true })) as unknown as Db;
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

  await db.exec(migration('20261024120000_menu_prices_and_new_items.sql'));
  await db.query(`SELECT public.reclassify_meal_roles()`);
  await db.exec(migration('20261024180000_house_pairings.sql'));
  await db.exec(`DROP FUNCTION IF EXISTS public.reco_role_fits(public.meal_role, text, text, boolean, uuid[], uuid, timestamptz)`);
  await db.exec(migration('20261025150000_menu_corrections.sql'));
  await db.exec(migration('20261025160000_reco_profit.sql'));
  await db.exec(migration('20261026110000_reco_adaptive.sql'));
  await db.exec(`
    UPDATE public.restaurant_settings
       SET recommendations_enabled = true, reco_holdout_pct = 0, reco_exploration = 0
     WHERE id = 1;
    INSERT INTO public.tables(id, table_number) VALUES ('${MENU_TABLE}', 98);
    ALTER TABLE public.orders DISABLE TRIGGER trg_enforce_order_limits;

    /*
     * One visit as the app writes it: a table session, then each round as
     * one transaction (order and lines together). Dishes by name; lines in
     * _suggested are attributed to a suggestion card, as guest_place_order
     * does. Raises on a name that is not on the menu.
     */
    CREATE OR REPLACE FUNCTION public.t_visit(_rounds jsonb, _hours_ago numeric DEFAULT 0,
                                              _suggested text[] DEFAULT '{}')
    RETURNS uuid
    LANGUAGE plpgsql
    AS $fn$
    DECLARE
      v_session uuid := gen_random_uuid();
      v_at timestamptz := now() - make_interval(secs => (_hours_ago * 3600)::double precision);
      v_order uuid;
      v_round jsonb;
      v_missing text;
    BEGIN
      INSERT INTO public.table_sessions(id, table_id, token, is_active, last_heartbeat_at, opened_at)
      VALUES (v_session, '${MENU_TABLE}', 't-' || left(v_session::text, 8), false, now(), v_at);
      FOR v_round IN SELECT * FROM jsonb_array_elements(_rounds) LOOP
        SELECT string_agg(n, ', ') INTO v_missing
          FROM jsonb_array_elements_text(v_round) n
         WHERE NOT EXISTS (SELECT 1 FROM public.menu_items mi WHERE lower(btrim(mi.name)) = lower(n));
        IF v_missing IS NOT NULL THEN RAISE EXCEPTION 'not on the menu: %', v_missing; END IF;
        INSERT INTO public.orders(table_session_id, total, status, payment_status, payment_method,
                                  released_to_kitchen_at, paid_at, created_at)
        VALUES (v_session, 0, 'served', 'paid', 'cash', v_at, v_at, v_at)
        RETURNING id INTO v_order;
        INSERT INTO public.order_items(order_id, menu_item_id, quantity, unit_price, status)
        SELECT v_order, mi.id, 1, mi.price, 'served'
          FROM jsonb_array_elements_text(v_round) n
          JOIN public.menu_items mi ON lower(btrim(mi.name)) = lower(n);
        INSERT INTO public.suggestion_conversions(order_id, recommended_item_id, placement, quantity, line_total)
        SELECT v_order, mi.id, 'cart', 1, mi.price
          FROM jsonb_array_elements_text(v_round) n
          JOIN public.menu_items mi ON lower(btrim(mi.name)) = lower(n)
         WHERE n = ANY(_suggested);
      END LOOP;
      RETURN v_session;
    END;
    $fn$;
  `);
  await actAs(db, null);
  return db;
}

/** Same visit, many tables: `count` visits spread evenly over `overHours`, the last `fromHours` ago. */
export async function tables(db: Db, count: number, rounds: string[][], overHours = 0, fromHours = 0,
                             suggested: string[] = []) {
  for (let i = 0; i < count; i += 1) {
    const hoursAgo = fromHours + (count > 1 ? (overHours * i) / (count - 1) : 0);
    await db.query(`SELECT public.t_visit($1::jsonb, $2, $3::text[])`,
      [JSON.stringify(rounds), hoursAgo, suggested]);
  }
}

/**
 * Three ordinary weeks at La Soul, before anything unusual happens: nine
 * tables a day, breakfast to dinner, each drink choice spread the way it is
 * when nothing in particular is in fashion. The La Soul Burger goes out once
 * a day — with fries, or with one of a cola, the house Strawberry Lemonade, a
 * lemon iced tea, a sparkling water or a mojito, none of them more than one
 * day in seven — the Volcano Beef Burger every other day with fries, and
 * Peach Lemonade on the other days with a slider. Nobody here has the
 * Mushroom Burger or a risotto.
 */
export async function ordinaryWeeks(db: Db, days = 21) {
  const pasta = ['Lemon Iced Tea', 'Sparkling Water', 'Coca-Cola'];
  const burger: string[][] = [
    ['La Soul Burger', 'Coca-Cola'],
    ['La Soul Burger', 'Regular Fries'],
    ['La Soul Burger', 'Strawberry Lemonade'],
    ['La Soul Burger', 'Regular Fries', 'Lemon Iced Tea'],
    ['La Soul Burger', 'Sparkling Water'],
    ['La Soul Burger', 'La Soul Fries'],
    ['La Soul Burger', 'Classic Mojito'],
  ];
  for (let d = 0; d < days; d += 1) {
    // Three weeks, ending three days ago: the tests own the last three days.
    const base = 24 * (days - d) + 72;
    const visits: string[][] = [
      ['Turkish Egg', 'Cappuccino'],
      ['Avocado on Toast', 'Fresh Orange Juice'],
      ['Cappuccino', 'Tiramisu Cup'],
      ['Truffle Pasta', pasta[d % pasta.length]],
      ['Caesar Salad', 'Sparkling Water'],
      burger[d % burger.length],
      d % 2 === 0 ? ['Mix Slider', 'Peach Lemonade'] : ['Volcano Beef Burger', 'Regular Fries'],
      ['Spanish Latte', 'Butter Croissant'],
    ];
    for (const [i, visit] of visits.entries()) {
      await db.query(`SELECT public.t_visit($1::jsonb, $2)`, [JSON.stringify([visit]), base + i + 1]);
    }
  }
}

export { actAs };
