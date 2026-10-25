/**
 * @vitest-environment node
 *
 * The recommendation funnel (20261025125000), the trend counts
 * (20261025123000) and the insight cards (20261025126000).
 *
 *   - Each funnel stage is a subset of the one before, and "paid" is exactly
 *     the ledger's conversions on orders that became sales.
 *   - Trend exposure only counts days a dish could be ordered.
 *   - Insight cards come out in a stable order, and nothing under the floor
 *     reaches the page.
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
const BURGER = 'cccccccc-0000-0000-0000-000000000001';
const FRIES = 'cccccccc-0000-0000-0000-000000000002';
const COLA = 'cccccccc-0000-0000-0000-000000000003';
const CAKE = 'cccccccc-0000-0000-0000-000000000004';
const SALAD = 'cccccccc-0000-0000-0000-000000000005';
const SODA = 'cccccccc-0000-0000-0000-000000000006';
const TABLE = 'dddddddd-0000-0000-0000-000000000001';

let db: Db;

async function reset() {
  await db.exec(`
    TRUNCATE public.analytics_events, public.suggestion_conversions, public.recommendation_impressions,
             public.recommendation_decisions, public.menu_item_affinity, public.menu_item_recommendations,
             public.suggestion_stats, public.menu_item_availability_log,
             public.order_ticket_events, public.order_items, public.orders, public.table_sessions,
             public.tables, public.menu_items, public.subcategories, public.categories
      RESTART IDENTITY CASCADE;
    DELETE FROM public.user_roles;
    DELETE FROM auth.users;
    INSERT INTO auth.users(id) VALUES ('${STAFF}');
    INSERT INTO public.user_roles(user_id, role) VALUES ('${STAFF}', 'staff');
    INSERT INTO public.categories(id, name, sort_order) VALUES ('aaaaaaaa-0000-0000-0000-000000000001', 'Food', 1);
    INSERT INTO public.subcategories(id, category_id, name, sort_order)
      VALUES ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'All', 1);
    INSERT INTO public.menu_items(id, subcategory_id, name, price, food_cost, meal_role, is_available, created_at) VALUES
      ('${BURGER}', 'bbbbbbbb-0000-0000-0000-000000000001', 'Burger', 20, 7,    'main',       true,  now() - interval '400 days'),
      ('${FRIES}',  'bbbbbbbb-0000-0000-0000-000000000001', 'Fries',   6, 1.5,  'side',       true,  now() - interval '400 days'),
      ('${COLA}',   'bbbbbbbb-0000-0000-0000-000000000001', 'Cola',    4, NULL, 'cold_drink', true,  now() - interval '400 days'),
      ('${CAKE}',   'bbbbbbbb-0000-0000-0000-000000000001', 'Cake',   12, 4,    'dessert',    false, now() - interval '400 days'),
      ('${SALAD}',  'bbbbbbbb-0000-0000-0000-000000000001', 'Salad',  14, 5,    'main',       true,  now() - interval '400 days'),
      ('${SODA}',   'bbbbbbbb-0000-0000-0000-000000000001', 'Soda',    3, NULL, 'cold_drink', true,  now() - interval '400 days');
    INSERT INTO public.tables(id, table_number) VALUES ('${TABLE}', 7);
  `);
  await db.exec(`ALTER TABLE public.orders DISABLE TRIGGER trg_enforce_order_limits`);
  await actAs(db, null);
}

/** A visit with one order on the trading day `daysAgo` before today; lines are [item, qty, price]. */
async function order(daysAgo: number, lines: [string, number, number][], status = 'served') {
  const at = `((public.business_day() - ${daysAgo}) + time '13:00')::timestamp AT TIME ZONE 'Europe/Sarajevo'`;
  const session = crypto.randomUUID();
  await db.query(
    `INSERT INTO public.table_sessions(id, table_id, token, is_active, opened_at)
     VALUES ($1, '${TABLE}', $2, false, ${at})`, [session, `t-${session}`]);
  const total = lines.reduce((s, [, q, p]) => s + q * p, 0);
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO public.orders(table_session_id, total, status, payment_status, payment_method,
                               released_to_kitchen_at, created_at)
     VALUES ($1, $2, $3::public.order_status, 'paid', 'cash', ${at}, ${at}) RETURNING id`,
    [session, total, status]);
  for (const [item, qty, price] of lines) {
    await db.query(
      `INSERT INTO public.order_items(order_id, menu_item_id, quantity, unit_price, status)
       VALUES ($1, $2, $3, $4, 'served')`, [rows[0].id, item, qty, price]);
  }
  return { session, order: rows[0].id };
}

async function asStaff<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  await actAs(db, STAFF);
  try {
    return (await db.query<T>(sql, params)).rows;
  } finally {
    await actAs(db, null);
  }
}

beforeAll(async () => { db = await createTestDatabase({ quiet: true }); }, 180_000);
afterAll(async () => { await db?.close(); });
beforeEach(reset);

interface FunnelRow {
  placement: string; week_start: string;
  decisions: number; with_suggestion: number; seen: number; tapped: number; paid: number;
  paid_km: string; km_per_1000_seen: string | null;
}

describe('the recommendation funnel', () => {
  async function decision(placement: string, chosen: string | null, session: string) {
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO public.recommendation_decisions(session_id, placement, policy_version, chosen_item_id, source_item_id)
       VALUES ($1, $2, 'v1', $3, '${BURGER}') RETURNING id`, [session, placement, chosen]);
    return rows[0].id;
  }
  const seen = (d: string) => db.query(`INSERT INTO public.recommendation_impressions(decision_id) VALUES ($1)`, [d]);
  const tap = (d: string) => db.query(
    `INSERT INTO public.analytics_events(visit_id, event, props) VALUES ('v', 'suggestion_accepted', $1::jsonb)`,
    [JSON.stringify({ decision_id: d, placement: 'cart' })]);
  const convert = (d: string, orderId: string, item: string, km: number) => db.query(
    `INSERT INTO public.suggestion_conversions(order_id, decision_id, recommended_item_id, placement, line_total)
     VALUES ($1, $2, $3, 'cart', $4)`, [orderId, d, item, km]);

  it('narrows at every stage, and "paid" is exactly the ledger', async () => {
    const paidOrder = await order(0, [[BURGER, 1, 20], [FRIES, 1, 6]]);
    const cancelled = await order(0, [[BURGER, 1, 20], [FRIES, 1, 6]], 'cancelled');
    const s = paidOrder.session;

    const d1 = await decision('cart', FRIES, s); await seen(d1); await tap(d1); await convert(d1, paidOrder.order, FRIES, 6);
    const d2 = await decision('cart', FRIES, s); await seen(d2); await tap(d2); await convert(d2, cancelled.order, FRIES, 6);
    const d3 = await decision('cart', FRIES, s); await seen(d3);
    await decision('cart', null, s);
    // The phone's sighting and tap never arrived, but the line was paid for.
    const d5 = await decision('item', COLA, s); await convert(d5, paidOrder.order, COLA, 4);
    // Tapped, sighting lost.
    const d6 = await decision('cart', FRIES, s); await tap(d6);
    // A tap on a card that was not this decision's pick is not its tap…
    const d7 = await decision('cart', FRIES, s); await seen(d7);
    await db.query(
      `INSERT INTO public.analytics_events(visit_id, event, props) VALUES ('v', 'suggestion_accepted', $1::jsonb)`,
      [JSON.stringify({ decision_id: d7, item_id: COLA, placement: 'cart' })]);
    // …and a tap sent without a decision id belongs to no decision.
    await db.query(
      `INSERT INTO public.analytics_events(visit_id, event, props) VALUES ('v', 'suggestion_accepted', $1::jsonb)`,
      [JSON.stringify({ decision_id: null, item_id: FRIES, placement: 'cart' })]);

    const rows = await asStaff<FunnelRow>(`SELECT * FROM public.reco_funnel(28)`);
    const cart = rows.find((r) => r.placement === 'cart')!;
    const item = rows.find((r) => r.placement === 'item')!;
    expect([cart.decisions, cart.with_suggestion, cart.seen, cart.tapped, cart.paid].map(Number)).toEqual([6, 5, 5, 3, 1]);
    expect(Number(cart.paid_km)).toBe(6);
    expect(Number(cart.km_per_1000_seen)).toBe(1200);
    expect([item.decisions, item.with_suggestion, item.seen, item.tapped, item.paid].map(Number)).toEqual([1, 1, 1, 1, 1]);

    for (const r of rows) {
      const stages = [r.decisions, r.with_suggestion, r.seen, r.tapped, r.paid].map(Number);
      for (let i = 1; i < stages.length; i += 1) expect(stages[i]).toBeLessThanOrEqual(stages[i - 1]);
    }

    const ledger = await asStaff<{ n: number; km: string }>(
      `SELECT count(DISTINCT sc.decision_id)::int AS n, sum(sc.line_total) AS km
         FROM public.suggestion_conversions sc
         JOIN public.completed_orders co ON co.id = sc.order_id`);
    expect(rows.reduce((n, r) => n + Number(r.paid), 0)).toBe(ledger[0].n);
    expect(rows.reduce((n, r) => n + Number(r.paid_km), 0)).toBe(Number(ledger[0].km));
  });

  it('refuses a caller who is not staff', async () => {
    await expect(db.query(`SELECT * FROM public.reco_funnel(28)`)).rejects.toThrow(/staff/i);
  });
});

describe('trend counts', () => {
  it('counts orders and visits per window, and leaves sold-out days out of the exposure', async () => {
    // 70 trading days; Fries on every one of them; Cola sold out for days 20–40 ago.
    for (let d = 1; d <= 70; d += 1) {
      const lines: [string, number, number][] = [[FRIES, 1, 6]];
      if (d < 20 || d > 40) lines.push([COLA, 1, 4]);
      await order(d, lines);
    }
    await db.query(
      `INSERT INTO public.menu_item_availability_log(menu_item_id, is_available, changed_at) VALUES
         ($1, false, ((public.business_day() - 40) + time '18:00')::timestamp AT TIME ZONE 'Europe/Sarajevo'),
         ($1, true,  ((public.business_day() - 19) + time '06:00')::timestamp AT TIME ZONE 'Europe/Sarajevo')`, [COLA]);

    const rows = await asStaff<{ name: string; k1: string; k0: string; e1: string; e0: string; days0: number }>(
      `SELECT * FROM public.item_trends(14, 56)`);
    const fries = rows.find((r) => r.name === 'Fries')!;
    const cola = rows.find((r) => r.name === 'Cola')!;
    expect([fries.k1, fries.k0, fries.e1, fries.e0].map(Number)).toEqual([14, 56, 14, 56]);
    // Prior window = days 15–70. Cola sold on 15–19 and 41–70: 35 orders. It
    // went off at 18:00 on day 40, so it was on sale that morning and day 40
    // is exposure; days 39 to 20 are not. 36 days, one visit each.
    expect(Number(cola.k0)).toBe(35);
    expect(Number(cola.e0)).toBe(36);
    expect(cola.days0).toBe(36);
  });
});

interface Insight {
  kind: string; item_id: string | null; related_item_id: string | null;
  headline: string; why: string; action: string;
  est_km_per_week: string; confidence: string; evidence: number; evidence_label: string; link: string;
}

describe('insight cards', () => {
  async function seedInsights() {
    // Ten trading days. Cake sold every day and is now sold out.
    for (let d = 1; d <= 10; d += 1) {
      await order(d, [[BURGER, 4, 20], [FRIES, 4, 6], [CAKE, 5, 12], [COLA, 3, 4]]);
    }
    await order(3, [[SALAD, 1, 14]]);
    // A strong pairing nobody has made a suggestion yet, and a weak one.
    await db.exec(`
      INSERT INTO public.menu_item_affinity(item_a, item_b, pair_orders, a_orders, confidence, lift) VALUES
        ('${BURGER}', '${COLA}', 2000, 5000, 0.40, 3.0),
        ('${FRIES}',  '${SODA}', 100,  500,  0.20, 2.0);
    `);
    // The salad is looked at constantly and almost never ordered.
    await db.exec(`
      INSERT INTO public.analytics_events(visit_id, event, props, occurred_at)
      SELECT 'v' || g, 'item_viewed', jsonb_build_object('item_id', i.id), now() - interval '2 days'
        FROM generate_series(1, 40) g
        CROSS JOIN (VALUES ('${BURGER}'::uuid), ('${FRIES}'::uuid)) i(id);
      INSERT INTO public.analytics_events(visit_id, event, props, occurred_at)
      SELECT 'v' || g, 'item_viewed', jsonb_build_object('item_id', '${SALAD}'), now() - interval '2 days'
        FROM generate_series(1, 300) g;
    `);
  }

  it('lists what passes in a stable order, worth first, and nothing under 20 KM a week', async () => {
    await seedInsights();
    const first = await asStaff<Insight>(`SELECT * FROM public.management_insights(28)`);
    const second = await asStaff<Insight>(`SELECT * FROM public.management_insights(28)`);
    expect(second).toEqual(first);

    expect(first.length).toBeGreaterThanOrEqual(3);
    const worth = first.map((r) => Number(r.est_km_per_week));
    expect([...worth].sort((a, b) => b - a)).toEqual(worth);
    for (const w of worth) expect(w).toBeGreaterThanOrEqual(20);

    const kinds = first.map((r) => r.kind);
    expect(kinds).toContain('sold_out');
    expect(kinds).toContain('pairing');
    expect(kinds).toContain('leak');

    const pairing = first.find((r) => r.kind === 'pairing')!;
    expect([pairing.item_id, pairing.related_item_id]).toEqual([BURGER, COLA]);
    expect(pairing.headline).toBe('Suggest Cola with Burger');
    // The fries → soda pairing is real but worth about 3 KM a week: below the floor.
    expect(first.some((r) => r.related_item_id === SODA)).toBe(false);

    const all = await asStaff<Insight>(`SELECT * FROM public.management_insights(28, 0)`);
    expect(all.some((r) => r.kind === 'pairing' && r.related_item_id === SODA)).toBe(true);
  });

  it('names a curated suggestion the engine has retired by its own rule', async () => {
    await seedInsights();
    await db.exec(`
      INSERT INTO public.menu_item_recommendations(source_item_id, recommended_item_id) VALUES ('${BURGER}', '${FRIES}');
      INSERT INTO public.suggestion_stats(source_item_id, recommended_item_id, placement, shown, accepted, attributed_revenue, daypart) VALUES
        ('${BURGER}', '${FRIES}', 'cart', 3000, 0, 0, NULL),
        ('${BURGER}', '${CAKE}',  'cart', 1000, 200, 2400, NULL);
    `);
    const rows = await asStaff<Insight>(`SELECT * FROM public.management_insights(28)`);
    const retired = rows.find((r) => r.kind === 'retired')!;
    expect([retired.item_id, retired.related_item_id]).toEqual([FRIES, BURGER]);
    // 3,000 sightings over 90 days, each 0.60 KM short of the placement's average.
    expect(Number(retired.est_km_per_week)).toBe(140);
    // The one that works is not called retired.
    expect(rows.filter((r) => r.kind === 'retired')).toHaveLength(1);
  });

  it('stops suggesting a pairing once it is curated, and refuses a caller who is not staff', async () => {
    await seedInsights();
    await db.query(
      `INSERT INTO public.menu_item_recommendations(source_item_id, recommended_item_id) VALUES ($1, $2)`, [BURGER, COLA]);
    const rows = await asStaff<Insight>(`SELECT * FROM public.management_insights(28)`);
    expect(rows.some((r) => r.kind === 'pairing' && r.related_item_id === COLA)).toBe(false);
    await expect(db.query(`SELECT * FROM public.management_insights(28)`)).rejects.toThrow(/staff/i);
  });
});
