/**
 * @vitest-environment node
 *
 * Whether the uplift number can be believed — round two.
 *
 * The previous pass fixed the obvious faults. This one fixes the subtle ones,
 * which are more dangerous because they all inflate confidence:
 *
 *   - treatment assigned per SESSION but averaged per ORDER, so three rounds
 *     from one table counted as three independent samples;
 *   - tips counted as uplift;
 *   - refunds ignored.
 *
 * The load-bearing test here is `manufactures no significance from correlated
 * orders` — it constructs data where the old per-order maths would have
 * reported a real effect, and asserts the session-grain version does not.
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
const TABLE = 'dddddddd-0000-0000-0000-000000000001';

let db: Db;

async function seed() {
  await db.exec(`
    TRUNCATE public.audit_log, public.session_experiment_assignment, public.experiments,
             public.analytics_events, public.suggestion_conversions, public.suggestion_stats,
             public.order_ticket_events, public.order_items, public.orders,
             public.server_ratings, public.table_sessions, public.tables,
             public.menu_items, public.subcategories, public.categories, public.order_code_counters
      RESTART IDENTITY CASCADE;
    DELETE FROM public.user_roles;
    DELETE FROM auth.users;

    UPDATE public.restaurant_settings SET reco_holdout_pct = 0 WHERE id = 1;

    INSERT INTO auth.users(id) VALUES ('${ADMIN}'), ('${STAFF}');
    INSERT INTO public.user_roles(user_id, role) VALUES ('${ADMIN}', 'admin'), ('${STAFF}', 'staff');
    INSERT INTO public.tables(id, table_number) VALUES ('${TABLE}', 7);
  `);
  await db.exec(`ALTER TABLE public.orders DISABLE TRIGGER trg_enforce_order_limits`);
  await actAs(db, null);
}

/**
 * A visit: one session, N orders, in a chosen arm.
 *
 * `orderTotals` are ITEM totals. The tip is added on top when the row is
 * written, mirroring guest_place_order (`total = v_items_total + v_tip`) — so
 * a test asserting "tips are excluded" is asserting against the real shape.
 */
async function visit(opts: {
  arm: 'treatment' | 'holdout';
  orderTotals: number[];
  tipEach?: number;
  refundEach?: number;
  covers?: number | null;
  rating?: number | null;
}) {
  const session = crypto.randomUUID();
  await db.query(
    `INSERT INTO public.table_sessions(id, table_id, token, is_active, covers, opened_at, last_heartbeat_at)
     VALUES ($1, '${TABLE}', $2, true, $3, now(), now())`,
    [session, `t-${session.slice(0, 8)}`, opts.covers ?? null],
  );
  // The AFTER INSERT trigger auto-assigns; override to the arm under test.
  await db.query(`DELETE FROM public.session_experiment_assignment WHERE session_id = $1`, [session]);
  await db.query(
    `INSERT INTO public.session_experiment_assignment(session_id, experiment_id, arm)
     SELECT $1, id, $2 FROM public.experiments WHERE ended_at IS NULL LIMIT 1`,
    [session, opts.arm],
  );

  for (const total of opts.orderTotals) {
    await db.query(
      `INSERT INTO public.orders(table_session_id, total, tip_amount, refunded_amount, status,
                                 payment_status, payment_method, released_to_kitchen_at, paid_at)
       VALUES ($1, $2, $3, $4, 'served', 'paid', 'cash', now(), now())`,
      [session, total + (opts.tipEach ?? 0), opts.tipEach ?? 0, opts.refundEach ?? 0],
    );
  }

  if (opts.rating != null) {
    await db.query(
      `INSERT INTO public.server_ratings(table_session_id, rating) VALUES ($1, $2)`,
      [session, opts.rating],
    );
  }
  return session;
}

const startExperiment = async (pct = 50) => {
  await actAs(db, ADMIN);
  await db.query(`SELECT public.start_experiment('test', 'v1', $1::smallint)`, [pct]);
  await actAs(db, null);
};

const compare = async (days = 30) => {
  await actAs(db, STAFF);
  const { rows } = await db.query<{ result: Record<string, unknown> }>(
    `SELECT public.reco_holdout_comparison($1) AS result`, [days]);
  await actAs(db, null);
  return rows[0].result;
};

beforeAll(async () => { db = (await createTestDatabase({ quiet: true })) as unknown as Db; }, 180_000);
afterAll(async () => { await db?.close(); });
beforeEach(seed);

describe('the unit of analysis is the visit', () => {
  it('counts one session with three orders as one observation', async () => {
    await startExperiment();
    await visit({ arm: 'treatment', orderTotals: [10, 10, 10] });
    await visit({ arm: 'holdout', orderTotals: [30] });

    const r = await compare();
    expect((r.with_suggestions as { sessions: number }).sessions).toBe(1);
    expect((r.holdout as { sessions: number }).sessions).toBe(1);
    // Same money either way — the grain must not change the total.
    expect(Number((r.with_suggestions as { avg_net_sales: number }).avg_net_sales)).toBe(30);
  });

  it('manufactures no significance from correlated orders', async () => {
    /*
     * THE regression test.
     *
     * Both arms spend identically per VISIT. The treatment arm simply splits
     * its spend across three rounds — normal café behaviour. Per-order maths
     * sees 90 treatment "samples" against 30 holdout ones, all tightly
     * clustered, and reports a confident difference between 10 and 30. Per
     * session there is no difference at all, which is the truth.
     */
    await startExperiment();
    for (let i = 0; i < 30; i += 1) {
      await visit({ arm: 'treatment', orderTotals: [10, 10, 10] });
      await visit({ arm: 'holdout', orderTotals: [30] });
    }

    const r = await compare();
    expect(Number(r.difference)).toBe(0);
    expect(r.significant).toBe(false);
    expect(r.status).toBe('no_measurable_effect');
  });

  it('says which unit and which measure it used', async () => {
    await startExperiment();
    await visit({ arm: 'treatment', orderTotals: [20] });
    const r = await compare();
    expect(r.unit).toBe('table_session');
    expect(r.measure).toBe('net_sales_excl_tips_and_refunds');
  });
});

describe('the money is attributable money', () => {
  it('excludes tips', async () => {
    // A tip is the guest's generosity, not an effect of a suggestion.
    await startExperiment();
    await visit({ arm: 'treatment', orderTotals: [20], tipEach: 10 });
    await visit({ arm: 'holdout', orderTotals: [20], tipEach: 0 });

    const r = await compare();
    expect(Number((r.with_suggestions as { avg_net_sales: number }).avg_net_sales)).toBe(20);
    expect(Number(r.difference)).toBe(0);
  });

  it('nets off refunds', async () => {
    await startExperiment();
    await visit({ arm: 'treatment', orderTotals: [50], refundEach: 20 });

    const r = await compare();
    expect(Number((r.with_suggestions as { avg_net_sales: number }).avg_net_sales)).toBe(30);
  });

  it('ignores a table that never ordered', async () => {
    await startExperiment();
    await visit({ arm: 'treatment', orderTotals: [] });
    await visit({ arm: 'treatment', orderTotals: [20] });

    const r = await compare();
    expect((r.with_suggestions as { sessions: number }).sessions).toBe(1);
  });
});

describe('assignment is a historical fact', () => {
  it('is written once, at the door', async () => {
    await startExperiment();
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO public.table_sessions(id, table_id, token, is_active)
       VALUES (gen_random_uuid(), '${TABLE}', 'auto', true) RETURNING id`);
    const { rows: a } = await db.query(
      `SELECT arm FROM public.session_experiment_assignment WHERE session_id = $1`, [rows[0].id]);
    expect(a).toHaveLength(1);
  });

  it('cannot be edited afterwards', async () => {
    await startExperiment();
    const s = await visit({ arm: 'treatment', orderTotals: [10] });
    await expect(db.query(
      `UPDATE public.session_experiment_assignment SET arm = 'holdout' WHERE session_id = $1`, [s],
    )).rejects.toThrow(/cannot be changed after the fact/);
  });

  it('does not move history when the dial changes', async () => {
    await startExperiment(50);
    for (let i = 0; i < 5; i += 1) {
      await visit({ arm: 'treatment', orderTotals: [20] });
      await visit({ arm: 'holdout', orderTotals: [20] });
    }
    const before = await compare();
    await db.exec(`UPDATE public.restaurant_settings SET reco_holdout_pct = 10 WHERE id = 1`);
    const after = await compare();

    expect((after.holdout as { sessions: number }).sessions)
      .toBe((before.holdout as { sessions: number }).sessions);
  });

  it('starts a new experiment for a new policy, rather than appending', async () => {
    await startExperiment(50);
    await visit({ arm: 'treatment', orderTotals: [20] });

    await actAs(db, ADMIN);
    await db.query(`SELECT public.start_experiment('v2 rollout', 'v2', 50::smallint)`);
    await actAs(db, null);

    const { rows } = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM public.experiments`);
    expect(rows[0].n).toBe(2);

    // Only one collects at a time; the v1 sessions are not mixed into v2.
    const r = await compare();
    expect((r.experiment as { policy_version: string }).policy_version).toBe('v2');
    expect((r.with_suggestions as { sessions: number }).sessions).toBe(0);
  });

  it('allows only one running experiment', async () => {
    await startExperiment();
    const { rows } = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM public.experiments WHERE ended_at IS NULL`);
    expect(rows[0].n).toBe(1);
  });

  it('is manager-only to start or stop', async () => {
    await actAs(db, STAFF);
    await expect(db.query(`SELECT public.start_experiment('x', 'v1', 10::smallint)`))
      .rejects.toThrow(/Only a manager/);
    await actAs(db, null);
  });
});

describe('health is checked before any result', () => {
  it('suppresses the result when the split is wrong', async () => {
    // Configured 10%, delivered ~50%. Something is broken and the effect
    // estimate is worthless — so it is not shown at all.
    await startExperiment(10);
    for (let i = 0; i < 40; i += 1) {
      await visit({ arm: 'treatment', orderTotals: [20] });
      await visit({ arm: 'holdout', orderTotals: [40] });
    }

    const r = await compare();
    const srm = r.srm as { healthy: boolean; observed_holdout_pct: number };
    expect(srm.healthy).toBe(false);
    expect(r.status).toBe('invalid_srm');
    expect(r.conservative_monthly_value).toBeNull();
  });

  it('does not cry wolf on a correct split', async () => {
    await startExperiment(50);
    for (let i = 0; i < 40; i += 1) {
      await visit({ arm: 'treatment', orderTotals: [20] });
      await visit({ arm: 'holdout', orderTotals: [20] });
    }
    expect((await compare()).status).not.toBe('invalid_srm');
  });

  it('says how much longer, not just "too early"', async () => {
    await startExperiment(50);
    for (let i = 0; i < 12; i += 1) {
      await visit({ arm: 'treatment', orderTotals: [20 + (i % 5)] });
      await visit({ arm: 'holdout', orderTotals: [20 + (i % 5)] });
    }

    const r = await compare();
    const power = r.power as { ready: boolean; sessions_needed_per_arm: number; days_remaining: number };
    expect(r.status).toBe('too_early');
    expect(power.ready).toBe(true);
    expect(power.sessions_needed_per_arm).toBeGreaterThan(0);
  });

  it('reports guardrails so revenue cannot be bought with service', async () => {
    await startExperiment(50);
    for (let i = 0; i < 5; i += 1) {
      await visit({ arm: 'treatment', orderTotals: [30], rating: 3 });
      await visit({ arm: 'holdout', orderTotals: [20], rating: 5 });
    }

    const g = (await compare()).guardrails as { rating_treatment: number; rating_holdout: number };
    expect(Number(g.rating_treatment)).toBe(3);
    expect(Number(g.rating_holdout)).toBe(5);
  });
});

describe('a real effect is still found', () => {
  it('reports it, with a conservative projection', async () => {
    await startExperiment(50);
    for (let i = 0; i < 60; i += 1) {
      await visit({ arm: 'treatment', orderTotals: [45 + (i % 5)] });
      await visit({ arm: 'holdout', orderTotals: [30 + (i % 5)] });
    }

    const r = await compare();
    expect(r.status).toBe('positive');
    expect(Number(r.difference)).toBeGreaterThan(10);
    expect(Number(r.ci_low)).toBeGreaterThan(0);
    expect(Number(r.conservative_monthly_value)).toBeGreaterThan(0);
    // Conservative: projected from the bottom of the interval.
    expect(Number(r.ci_low)).toBeLessThan(Number(r.difference));
  });

  it('notices when suggestions make things worse', async () => {
    // An engine can be actively harmful — pushing the wrong thing, or adding
    // friction. If it is, the dashboard has to say so rather than reporting
    // "no effect" and letting it run.
    await startExperiment(50);
    for (let i = 0; i < 60; i += 1) {
      await visit({ arm: 'treatment', orderTotals: [25 + (i % 5)] });
      await visit({ arm: 'holdout', orderTotals: [40 + (i % 5)] });
    }

    const r = await compare();
    expect(r.status).toBe('negative');
    expect(Number(r.difference)).toBeLessThan(0);
    expect(r.conservative_monthly_value).toBeNull();
  });
});
