/**
 * @vitest-environment node
 *
 * The analytics screens, held to the till.
 *
 * Each block here pins one way a chart used to be quietly wrong — in the wrong
 * day, counted six times, two hours early, or one malformed event away from an
 * error page — against real PostgreSQL via PGlite.
 *
 * Times are written as Sarajevo wall-clock moments and kept away from the
 * small hours, so the assertions do not depend on where the trading day's
 * cutoff sits (midnight today; 05:00 is planned).
 */
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
// @ts-expect-error -- plain JS harness, no types needed
import { createTestDatabase, actAs } from '../../scripts/db-harness.mjs';

type Db = {
  query: <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<{ rows: T[] }>;
  exec: (sql: string) => Promise<unknown>;
  close: () => Promise<void>;
};

const ADMIN = '11111111-1111-1111-1111-111111111111';
const STAFF = '22222222-2222-2222-2222-222222222222';
const WAITER = '33333333-3333-3333-3333-333333333333';
const BURGER = 'cccccccc-0000-0000-0000-000000000001';
const FRIES = 'cccccccc-0000-0000-0000-000000000002';
const CAKE = 'cccccccc-0000-0000-0000-000000000003';
const TABLE = 'dddddddd-0000-0000-0000-000000000001';

let db: Db;

async function seed() {
  await db.exec(`
    TRUNCATE public.audit_log, public.session_experiment_assignment, public.experiments,
             public.analytics_events, public.suggestion_conversions, public.suggestion_stats,
             public.order_ticket_events, public.order_items, public.orders,
             public.server_ratings, public.table_sessions, public.tables, public.waiters,
             public.menu_items, public.subcategories, public.categories, public.order_code_counters
      RESTART IDENTITY CASCADE;
    DELETE FROM public.user_roles;
    DELETE FROM auth.users;

    UPDATE public.restaurant_settings SET reco_holdout_pct = 0 WHERE id = 1;

    INSERT INTO auth.users(id) VALUES ('${ADMIN}'), ('${STAFF}');
    INSERT INTO public.user_roles(user_id, role) VALUES ('${ADMIN}', 'admin'), ('${STAFF}', 'staff');
    INSERT INTO public.waiters(id, user_id, display_name) VALUES ('${WAITER}', '${STAFF}', 'Amra');

    INSERT INTO public.categories(id, name, sort_order) VALUES ('aaaaaaaa-0000-0000-0000-000000000001', 'Food', 1);
    INSERT INTO public.subcategories(id, category_id, name, sort_order)
      VALUES ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'Mains', 1);
    INSERT INTO public.menu_items(id, subcategory_id, name, price, is_available) VALUES
      ('${BURGER}', 'bbbbbbbb-0000-0000-0000-000000000001', 'Burger', 20.00, true),
      ('${FRIES}',  'bbbbbbbb-0000-0000-0000-000000000001', 'Fries',   6.00, true),
      ('${CAKE}',   'bbbbbbbb-0000-0000-0000-000000000001', 'Cake',   10.00, true);
    -- Old enough that "created inside the window" is not what is being tested.
    UPDATE public.menu_items SET created_at = now() - interval '200 days';

    INSERT INTO public.tables(id, table_number) VALUES ('${TABLE}', 7);
  `);
  await db.exec(`ALTER TABLE public.orders DISABLE TRIGGER trg_enforce_order_limits`);
  await actAs(db, null);
}

/** A session, and orders in it, at an exact moment (default: now). */
async function sale(opts: {
  items?: number;
  tip?: number;
  status?: string;
  at?: string;           // Sarajevo wall clock, e.g. '2026-08-03 21:30:00'
  daysAgo?: number;
  covers?: number | null;
  waiter?: string | null;
  session?: string;
  item?: string;
}) {
  const session = opts.session ?? crypto.randomUUID();
  const when = opts.at
    ? `($3::timestamp AT TIME ZONE 'Europe/Sarajevo')`
    : `now() - make_interval(days => $3::int)`;
  const whenArg = opts.at ?? (opts.daysAgo ?? 0);
  if (!opts.session) {
    await db.query(
      `INSERT INTO public.table_sessions(id, table_id, token, is_active, covers, opened_at, assigned_waiter_id)
       VALUES ($1, '${TABLE}', $2, false, $4, ${when}, $5)`,
      [session, `s-${session.slice(0, 8)}`, whenArg, opts.covers ?? null, opts.waiter ?? null],
    );
  }
  const items = opts.items ?? 20;
  const tip = opts.tip ?? 0;
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO public.orders(table_session_id, total, tip_amount, status, payment_status, payment_method,
                               released_to_kitchen_at, created_at, paid_at, assigned_waiter_id,
                               confirmed_at, served_at, reco_holdout)
     VALUES ($1, $2, $6, $4::public.order_status, 'paid', 'cash', ${when}, ${when}, ${when}, $5,
             ${when} + interval '2 minutes', ${when} + interval '12 minutes', false)
     RETURNING id`,
    [session, items + tip, whenArg, opts.status ?? 'served', opts.waiter ?? null, tip],
  );
  if (opts.item) {
    await db.query(
      `INSERT INTO public.order_items(order_id, menu_item_id, quantity, unit_price, status)
       VALUES ($1, $2, 1, $3, 'served')`, [rows[0].id, opts.item, items]);
  }
  return { session, order: rows[0].id };
}

async function asStaff<T>(sql: string, params: unknown[] = []) {
  await actAs(db, STAFF);
  try {
    return (await db.query<T>(sql, params)).rows;
  } finally {
    await actAs(db, null);
  }
}

const send = (events: unknown[], visit = 'visit-1') =>
  db.query<{ n: number }>(`SELECT public.record_analytics_events($1, $2::jsonb) AS n`,
    [visit, JSON.stringify(events)]);

beforeAll(async () => { db = (await createTestDatabase({ quiet: true })) as unknown as Db; }, 180_000);
afterAll(async () => { await db?.close(); });
beforeEach(seed);

// ---------------------------------------------------------------------------

describe('ingest', () => {
  it('drops an item id that is not a uuid, and keeps the event', async () => {
    const { rows } = await send([
      { event: 'item_viewed', props: { item_id: 'undefined' } },
      { event: 'suggestion_shown', props: { item_id: BURGER, source_item_id: '42', placement: 'cart' } },
      { event: 'item_added', props: { item_id: 7 } },
    ]);
    expect(rows[0].n).toBe(3);

    const { rows: stored } = await db.query<{ props: Record<string, unknown> }>(
      `SELECT props FROM public.analytics_events ORDER BY id`);
    expect(stored[0].props).toEqual({});
    expect(stored[1].props).toEqual({ item_id: BURGER, placement: 'cart' });
    expect(stored[2].props).toEqual({});
  });

  it('keeps the rest of the batch when one timestamp is garbage', async () => {
    const { rows } = await send([
      { event: 'menu_viewed', props: {}, at: 'not a date' },
      { event: 'item_viewed', props: { item_id: BURGER }, at: new Date().toISOString() },
      { event: 'cart_viewed', props: {}, at: 12345 },
    ]);
    expect(rows[0].n).toBe(3);
  });

  it('clamps a phone clock that is wrong by a year in either direction', async () => {
    await send([
      { event: 'menu_viewed', props: {}, at: '2020-01-01T00:00:00Z' },
      { event: 'cart_viewed', props: {}, at: '2099-01-01T00:00:00Z' },
    ]);
    const { rows } = await db.query<{ event: string; past_ok: boolean; future_ok: boolean }>(`
      SELECT event,
             occurred_at >= now() - interval '1 hour' - interval '1 second' AS past_ok,
             occurred_at <= now() + interval '1 minute' + interval '1 second' AS future_ok
        FROM public.analytics_events ORDER BY id`);
    expect(rows.every((r) => r.past_ok && r.future_ok)).toBe(true);
  });

  it('still refuses unknown events and oversized batches', async () => {
    expect((await send([{ event: 'drop_table', props: {} }])).rows[0].n).toBe(0);
    expect((await send(Array.from({ length: 26 }, () => ({ event: 'menu_viewed' })))).rows[0].n).toBe(0);
  });

  it('survives a malformed element instead of failing the request', async () => {
    const { rows } = await send(['oops', { event: 'menu_viewed', props: 'nope' }]);
    expect(rows[0].n).toBe(1);
  });
});

describe('one bad row cannot take a report down', () => {
  it('reads past a malformed item id written before the ingest fix', async () => {
    // Written directly, as an older version of the RPC would have stored it.
    await db.exec(`
      INSERT INTO public.analytics_events(visit_id, event, props)
      VALUES ('v1', 'item_viewed', '{"item_id":"undefined"}'),
             ('v1', 'item_viewed', '{"item_id":"${BURGER}"}');
      UPDATE public.menu_items SET is_available = false WHERE id = '${CAKE}';
    `);

    const perf = await asStaff<{ item_id: string; views: string }>(
      `SELECT item_id, views FROM public.menu_item_performance(30)`);
    expect(Number(perf.find((r) => r.item_id === BURGER)?.views)).toBe(1);

    const sold = await asStaff(`SELECT * FROM public.sold_out_impact(30)`);
    expect(sold).toHaveLength(1);
  });
});

describe('management reads are staff-only', () => {
  const calls = [
    'SELECT * FROM public.menu_item_performance(30)',
    'SELECT * FROM public.sold_out_impact(30)',
    'SELECT * FROM public.menu_pairings(10)',
    'SELECT * FROM public.suggestion_performance(10)',
    'SELECT * FROM public.looked_at_not_ordered(30, 5)',
    'SELECT public.funnel_summary()',
    'SELECT public.staff_performance()',
  ];
  for (const sql of calls) {
    it(`refuses an anonymous caller: ${sql}`, async () => {
      await actAs(db, null);
      await expect(db.query(sql)).rejects.toThrow(/Only staff/i);
    });
  }
});

describe('each suggestion pair is listed once', () => {
  it('ignores the per-daypart rows in the table and the engine counts', async () => {
    await db.exec(`
      INSERT INTO public.suggestion_stats(recommended_item_id, source_item_id, placement, daypart, shown, accepted)
      VALUES ('${FRIES}', '${BURGER}', 'cart', NULL,        60, 12),
             ('${FRIES}', '${BURGER}', 'cart', 'morning',   10,  1),
             ('${FRIES}', '${BURGER}', 'cart', 'lunch',     20,  5),
             ('${FRIES}', '${BURGER}', 'cart', 'evening',   30,  6);
    `);

    const rows = await asStaff<{ shown: number }>(`SELECT * FROM public.suggestion_performance(50)`);
    expect(rows).toHaveLength(1);
    expect(rows[0].shown).toBe(60);

    const [health] = await asStaff<{ r: { tracked_pairs: number; pairs_still_learning: number } }>(
      `SELECT public.recommendation_engine_health() AS r`);
    expect(Number(health.r.tracked_pairs)).toBe(1);
    expect(Number(health.r.pairs_still_learning)).toBe(0);
  });
});

describe('dayparts', () => {
  it('calls the small hours late, not morning', async () => {
    const { rows } = await db.query<Record<string, string>>(`
      SELECT public.daypart_of(timestamptz '2026-08-02 03:00+02') AS small_hours,
             public.daypart_of(timestamptz '2026-08-02 04:59+02') AS before_dawn,
             public.daypart_of(timestamptz '2026-08-02 05:00+02') AS dawn,
             public.daypart_of(timestamptz '2026-08-02 09:00+02') AS breakfast,
             public.daypart_of(timestamptz '2026-08-02 23:30+02') AS nightcap`);
    expect(rows[0]).toEqual({
      small_hours: 'late', before_dawn: 'late', dawn: 'morning', breakfast: 'morning', nightcap: 'late',
    });
  });
});

describe('sales analytics on Sarajevo time', () => {
  type Report = {
    totals: { net_sales: string; revenue: string; tips: string; orders: number };
    by_day: { day: string; net_sales: string }[];
    by_hour: { hour: number; orders: number }[];
  };

  it('puts the 21:30 rush at 21:00, not 19:00', async () => {
    await sale({ at: '2026-08-03 21:30:00' });
    const [{ r }] = await asStaff<{ r: Report }>(
      `SELECT public.sales_analytics('2026-08-03'::date, '2026-08-03'::date) AS r`);
    expect(r.by_hour.find((h) => h.hour === 21)?.orders).toBe(1);
    expect(r.by_hour.find((h) => h.hour === 19)?.orders).toBe(0);
  });

  it('draws a late-evening sale in its own day', async () => {
    // 23:30 local; the UTC hour is 21. Both the day and the hour must be local.
    await sale({ at: '2026-08-03 23:30:00' });
    const [{ r }] = await asStaff<{ r: Report }>(
      `SELECT public.sales_analytics('2026-08-02'::date, '2026-08-04'::date) AS r`);
    const byDay = Object.fromEntries(r.by_day.map((d) => [d.day, Number(d.net_sales)]));
    expect(byDay).toEqual({ '2026-08-02': 0, '2026-08-03': 20, '2026-08-04': 0 });
    expect(r.by_hour.find((h) => h.hour === 23)?.orders).toBe(1);
  });

  it('has day bars that sum to the headline, whatever the cutoff', async () => {
    /*
     * 01:00 local is 23:00 UTC the day before. Bucketed by the UTC date, that
     * sale was inside the range but drawn in a bar outside it, so the bars
     * came up short of the Revenue card by exactly the late-night trade. The
     * invariant holds whether the trading day turns over at midnight or 05:00.
     */
    await sale({ at: '2026-08-04 01:00:00' });
    await sale({ at: '2026-08-04 12:00:00' });
    await sale({ at: '2026-08-04 23:30:00' });
    await sale({ at: '2026-08-05 01:00:00' });
    const [{ r }] = await asStaff<{ r: Report }>(
      `SELECT public.sales_analytics('2026-08-04'::date, '2026-08-04'::date) AS r`);
    const sum = r.by_day.reduce((acc, d) => acc + Number(d.net_sales), 0);
    expect(Number(r.totals.orders)).toBeGreaterThanOrEqual(2);
    expect(sum).toBe(Number(r.totals.net_sales));
    expect(r.by_hour.find((h) => h.hour === 1)?.orders).toBe(1);
  });

  it('keeps tips out of net sales and reports them beside it', async () => {
    await sale({ at: '2026-08-03 20:00:00', items: 30, tip: 5 });
    const [{ r }] = await asStaff<{ r: Report }>(
      `SELECT public.sales_analytics('2026-08-03'::date, '2026-08-03'::date) AS r`);
    expect(Number(r.totals.net_sales)).toBe(30);
    expect(Number(r.totals.tips)).toBe(5);
    // Gross stays available, so the page can still be reconciled with the Daily Report.
    expect(Number(r.totals.revenue)).toBe(35);
  });
});

describe('the holdout projection', () => {
  it('projects from the days the experiment ran, not the whole window', async () => {
    /*
     * The experiment started two days ago inside a 30-day window. Dividing its
     * sessions by 30 understated the daily rate — and the money — by fifteen
     * times.
     */
    await db.exec(`
      INSERT INTO public.experiments(id, name, policy_version, holdout_pct, started_at)
      VALUES ('eeeeeeee-0000-0000-0000-00000000e001', 'two days', 'v1', 50, now() - interval '2 days');
    `);
    for (let i = 0; i < 60; i += 1) {
      for (const arm of ['treatment', 'holdout'] as const) {
        const { session } = await sale({ items: arm === 'treatment' ? 45 + (i % 5) : 30 + (i % 5) });
        await db.query(`DELETE FROM public.session_experiment_assignment WHERE session_id = $1`, [session]);
        await db.query(
          `INSERT INTO public.session_experiment_assignment(session_id, experiment_id, arm)
           VALUES ($1, 'eeeeeeee-0000-0000-0000-00000000e001', $2)`, [session, arm]);
      }
    }

    const [{ r }] = await asStaff<{ r: Record<string, unknown> }>(
      `SELECT public.reco_holdout_comparison(30) AS r`);
    expect(r.status).toBe('positive');
    expect(Number(r.measured_days)).toBeCloseTo(2, 0);

    const perDay = 120 / Number(r.measured_days);
    const expected = Math.round(Number(r.ci_low) * perDay * 30);
    expect(Math.abs(Number(r.conservative_monthly_value) - expected)).toBeLessThanOrEqual(1);
  });
});

describe('revenue per guest is per visit', () => {
  it('divides a party\'s whole spend by its head count once', async () => {
    // Two rounds of 20 from a party of two: 20 a head, not 10.
    const { session } = await sale({ items: 20, covers: 2 });
    await sale({ items: 20, session });

    const [{ r }] = await asStaff<{ r: { per_cover: { sessions_counted: number; with_suggestions: string } } }>(
      `SELECT public.suggestion_impact(30) AS r`);
    expect(r.per_cover.sessions_counted).toBe(1);
    expect(Number(r.per_cover.with_suggestions)).toBe(20);
  });
});

describe('the funnel', () => {
  it('counts each visit once per step', async () => {
    await send([
      { event: 'menu_viewed' }, { event: 'menu_viewed' },
      { event: 'item_viewed', props: { item_id: BURGER } },
      { event: 'item_added', props: { item_id: BURGER } },
      { event: 'order_placed' },
    ], 'visit-a');
    await send([{ event: 'menu_viewed' }, { event: 'category_viewed' }], 'visit-b');
    // A deep link straight into a category — no menu_viewed at all.
    await send([{ event: 'category_viewed' }], 'visit-c');

    const [{ r }] = await asStaff<{ r: { visits: number; steps: { step: string; visits: number }[] } }>(
      `SELECT public.funnel_summary() AS r`);
    const steps = Object.fromEntries(r.steps.map((s) => [s.step, Number(s.visits)]));
    expect(Number(r.visits)).toBe(3);
    expect(steps).toEqual({
      menu_viewed: 2, category_viewed: 2, item_viewed: 1, item_added: 1,
      cart_viewed: 0, checkout_opened: 0, order_placed: 1,
    });
    expect(r.steps.map((s) => s.step)[0]).toBe('menu_viewed');
  });
});

describe('staff performance', () => {
  it('credits only completed sales, net of tips, to the waiter', async () => {
    await sale({ items: 40, tip: 4, waiter: WAITER });
    await sale({ items: 99, waiter: WAITER, status: 'awaiting_payment' });
    await sale({ items: 15 });

    const [{ r }] = await asStaff<{ r: {
      waiters: { name: string; orders: number; net_sales: string; tips: string; avg_confirm_minutes: string }[];
      unassigned: { orders: number; net_sales: string };
    } }>(`SELECT public.staff_performance() AS r`);

    const amra = r.waiters.find((w) => w.name === 'Amra');
    expect(amra?.orders).toBe(1);
    expect(Number(amra?.net_sales)).toBe(40);
    expect(Number(amra?.tips)).toBe(4);
    expect(Number(amra?.avg_confirm_minutes)).toBe(2);
    expect(r.unassigned.orders).toBe(1);
    expect(Number(r.unassigned.net_sales)).toBe(15);
  });
});

describe('looked at, not ordered', () => {
  it('ignores a dish nobody could order because it was sold out', async () => {
    await db.exec(`
      INSERT INTO public.analytics_events(visit_id, event, props)
      SELECT 'v' || g, 'item_viewed', jsonb_build_object('item_id', i)
        FROM generate_series(1, 25) g, unnest(ARRAY['${BURGER}', '${CAKE}']::text[]) i;
      UPDATE public.menu_items SET is_available = false WHERE id = '${CAKE}';
    `);
    const rows = await asStaff<{ name: string }>(`SELECT * FROM public.looked_at_not_ordered(30, 10)`);
    expect(rows.map((r) => r.name)).toEqual(['Burger']);
  });
});

describe('what being sold out costs', () => {
  it('spreads takings over the trading days it was selling, not just the days it sold', async () => {
    // Cake sells once, three days ago; the restaurant traded on four days.
    await sale({ daysAgo: 3, items: 30, item: CAKE });
    await sale({ daysAgo: 3, items: 20, item: BURGER });
    await sale({ daysAgo: 2, items: 20, item: BURGER });
    await sale({ daysAgo: 1, items: 20, item: BURGER });
    await sale({ daysAgo: 0, items: 20, item: BURGER });
    await db.query(`UPDATE public.menu_items SET is_available = false WHERE id = $1`, [CAKE]);

    const rows = await asStaff<{ item_id: string; selling_days: number; estimated_lost_revenue: string }>(
      `SELECT * FROM public.sold_out_impact(30)`);
    const cake = rows.find((r) => r.item_id === CAKE);
    // It stopped selling three days ago, so only the days up to then count.
    expect(cake?.selling_days).toBe(1);
    expect(Number(cake?.estimated_lost_revenue)).toBe(30);
  });

  it('counts the open days between sales against the dish', async () => {
    await sale({ daysAgo: 3, items: 30, item: CAKE });
    await sale({ daysAgo: 2, items: 20, item: BURGER });
    await sale({ daysAgo: 1, items: 30, item: CAKE });
    await db.query(`UPDATE public.menu_items SET is_available = false WHERE id = $1`, [CAKE]);

    const rows = await asStaff<{ item_id: string; selling_days: number; estimated_lost_revenue: string }>(
      `SELECT * FROM public.sold_out_impact(30)`);
    const cake = rows.find((r) => r.item_id === CAKE);
    // 60 KM over three trading days, not over the two on which it happened to sell.
    expect(cake?.selling_days).toBe(3);
    expect(Number(cake?.estimated_lost_revenue)).toBe(20);
  });
});

describe('menu item performance', () => {
  it('says when a dish was added, so a new one is not called a failure', async () => {
    await db.query(`UPDATE public.menu_items SET created_at = now() WHERE id = $1`, [FRIES]);
    const rows = await asStaff<{ item_id: string; created_at: string }>(
      `SELECT item_id, created_at FROM public.menu_item_performance(30)`);
    const fries = rows.find((r) => r.item_id === FRIES);
    expect(new Date(fries!.created_at).getTime()).toBeGreaterThan(Date.now() - 60_000);
  });
});
