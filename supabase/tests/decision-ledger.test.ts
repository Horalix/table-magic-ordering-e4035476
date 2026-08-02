/**
 * @vitest-environment node
 *
 * The decision ledger.
 *
 * Everything that learns — social proof, off-policy evaluation, eventually a
 * bandit — reads from here, so these tests are about whether the evidence can
 * be trusted rather than whether the ranking is good.
 *
 * Four specific lies the previous client-side counting could tell, each with a
 * test: a mount counted as a sighting, a remount counted twice, two components
 * counted twice, and a tap counted as revenue even when the order died.
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
const BURGER = 'cccccccc-cccc-cccc-cccc-cccccccc0001';
const COFFEE = 'cccccccc-cccc-cccc-cccc-cccccccc0003';
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
           recommendations_enabled = true, reco_holdout_pct = 0
     WHERE id = 1;

    INSERT INTO auth.users(id) VALUES ('${ADMIN}'), ('${STAFF}');
    INSERT INTO public.user_roles(user_id, role) VALUES ('${ADMIN}', 'admin'), ('${STAFF}', 'staff');

    INSERT INTO public.categories(id, name, sort_order) VALUES
      ('aaaaaaaa-0000-0000-0000-000000000001', 'Food', 1),
      ('aaaaaaaa-0000-0000-0000-000000000002', 'Drinks', 2);
    INSERT INTO public.subcategories(id, category_id, name, sort_order) VALUES
      ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'Mains', 1),
      ('bbbbbbbb-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000002', 'Hot', 2);
    INSERT INTO public.menu_items(id, subcategory_id, name, price, is_available, station) VALUES
      ('${BURGER}', 'bbbbbbbb-0000-0000-0000-000000000001', 'Burger', 20.00, true, 'kitchen'),
      ('${COFFEE}', 'bbbbbbbb-0000-0000-0000-000000000002', 'Espresso', 3.00, true, 'bar');

    INSERT INTO public.menu_item_recommendations(source_item_id, recommended_item_id, recommendation_type, priority)
    VALUES ('${BURGER}', '${COFFEE}', 'pair_with', 90);

    INSERT INTO public.tables(id, table_number) VALUES ('dddddddd-0000-0000-0000-000000000001', 7);
    INSERT INTO public.table_sessions(id, table_id, token, is_active, guest_name, last_heartbeat_at)
      VALUES ('${SESSION}', 'dddddddd-0000-0000-0000-000000000001', '${TOKEN}', true, 'Amina', now());
  `);
  await actAs(db, null);
}

const recommend = async (cart: string[], placement = 'cart') => {
  const { rows } = await db.query<{ decision_id: string; id: string; name: string }>(
    `SELECT decision_id, id, name
       FROM public.guest_get_recommendations($1::uuid, $2, $3::uuid[], $4, 'en', 4, '{}'::text[])`,
    [SESSION, TOKEN, cart, placement],
  );
  return rows;
};

const decisions = async () => {
  const { rows } = await db.query<{
    id: string; chosen_item_id: string | null; policy_version: string;
    action_probability: number; candidates: unknown[];
  }>(`SELECT id, chosen_item_id, policy_version, action_probability, candidates
        FROM public.recommendation_decisions ORDER BY created_at`);
  return rows;
};

const impressionCount = async () => {
  const { rows } = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM public.recommendation_impressions`);
  return rows[0].n;
};

const markSeen = (decisionId: string) =>
  db.query(`SELECT public.guest_mark_suggestion_seen($1, $2, $3)`, [decisionId, SESSION, TOKEN]);

beforeAll(async () => { db = (await createTestDatabase({ quiet: true })) as unknown as Db; }, 180_000);
afterAll(async () => { await db?.close(); });
beforeEach(seed);

describe('every decision is recorded', () => {
  it('records what was chosen, under which policy', async () => {
    const rows = await recommend([BURGER]);
    expect(rows.length).toBeGreaterThan(0);

    const d = await decisions();
    expect(d).toHaveLength(1);
    expect(d[0].chosen_item_id).toBe(COFFEE);
    expect(d[0].policy_version).toBe('v1-fixed-ranker');
    expect(Number(d[0].action_probability)).toBe(1);
  });

  it('records the shortlist, not only the winner', async () => {
    // Off-policy evaluation cannot estimate a policy you did not run without
    // knowing what else was on the table.
    await recommend([BURGER]);
    const d = await decisions();
    expect(Array.isArray(d[0].candidates)).toBe(true);
    expect((d[0].candidates as { item_id: string }[]).some((c) => c.item_id === COFFEE)).toBe(true);
  });

  it('records the decision to suggest NOTHING', async () => {
    /*
     * The denominator. Without this row you can measure the acceptance rate of
     * suggestions that were made, but never how often the engine had nothing
     * useful to say — which is the number that says whether it is working.
     */
    await db.exec(`UPDATE public.restaurant_settings SET recommendations_enabled = false WHERE id = 1`);
    const rows = await recommend([BURGER]);

    expect(rows).toHaveLength(0);
    const d = await decisions();
    expect(d).toHaveLength(1);
    expect(d[0].chosen_item_id).toBeNull();
  });

  it('ties the decision to the experiment arm', async () => {
    await actAs(db, ADMIN);
    await db.query(`SELECT public.start_experiment('ledger', 'v1-fixed-ranker', 50::smallint)`);
    await actAs(db, null);
    await db.query(
      `INSERT INTO public.session_experiment_assignment(session_id, experiment_id, arm)
       SELECT $1, id, 'treatment' FROM public.experiments WHERE ended_at IS NULL
       ON CONFLICT (session_id) DO NOTHING`, [SESSION]);

    await recommend([BURGER]);
    const { rows } = await db.query<{ arm: string }>(
      `SELECT arm FROM public.recommendation_decisions LIMIT 1`);
    expect(rows[0].arm).toBe('treatment');
  });
});

describe('an impression is a sighting', () => {
  it('is not recorded merely because a decision was computed', async () => {
    // The old event fired on mount. Computing a suggestion and a guest seeing
    // it are different things, and only the second is an impression.
    await recommend([BURGER]);
    expect(await impressionCount()).toBe(0);
  });

  it('is recorded once when the guest actually sees it', async () => {
    const rows = await recommend([BURGER]);
    await markSeen(rows[0].decision_id);
    expect(await impressionCount()).toBe(1);
  });

  it('cannot be inflated by a remount', async () => {
    const rows = await recommend([BURGER]);
    await markSeen(rows[0].decision_id);
    await markSeen(rows[0].decision_id);
    await markSeen(rows[0].decision_id);
    expect(await impressionCount()).toBe(1);
  });

  it('cannot be inflated by two components rendering the same decision', async () => {
    // `placement="cart"` is rendered from both CartPage and CartSheet. Under
    // the old client-side counting that was a genuine double-count.
    const rows = await recommend([BURGER]);
    await Promise.all([markSeen(rows[0].decision_id), markSeen(rows[0].decision_id)]);
    expect(await impressionCount()).toBe(1);
  });

  it('cannot be claimed for another table', async () => {
    const rows = await recommend([BURGER]);
    await db.exec(`
      INSERT INTO public.table_sessions(id, table_id, token, is_active, last_heartbeat_at)
      VALUES ('eeeeeeee-0000-0000-0000-00000000ffff',
              'dddddddd-0000-0000-0000-000000000001', 'other-token', true, now());
    `);
    await db.query(`SELECT public.guest_mark_suggestion_seen($1, $2, $3)`,
      [rows[0].decision_id, 'eeeeeeee-0000-0000-0000-00000000ffff', 'other-token']);

    // The decision belongs to a different session, so nothing is recorded.
    expect(await impressionCount()).toBe(0);
  });
});

describe('authorisation', () => {
  it('requires a session token', async () => {
    await expect(db.query(
      `SELECT * FROM public.guest_get_recommendations($1::uuid, 'wrong-token', '{}'::uuid[], 'cart', 'en', 4, '{}'::text[])`,
      [SESSION],
    )).rejects.toThrow();
  });

  it('keeps the raw ranker away from guests', async () => {
    const { rows } = await db.query<{ has: boolean }>(`
      SELECT has_function_privilege('anon', p.oid, 'EXECUTE') AS has
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'rank_recommendations'
    `);
    expect(rows[0].has).toBe(false);
  });
});

describe('acceptance means paid for', () => {
  it('links a converted line back to its decision', async () => {
    const rows = await recommend([BURGER]);
    const decisionId = rows[0].decision_id;

    const payload = JSON.stringify([
      { menu_item_id: BURGER, quantity: 1 },
      {
        menu_item_id: COFFEE,
        quantity: 1,
        from_suggestion: { source_item_id: BURGER, placement: 'cart', decision_id: decisionId },
      },
    ]);
    await db.query(
      `SELECT public.guest_place_order($1, $2, 'Amina', 'cash', $3::jsonb, 0)`,
      [SESSION, TOKEN, payload]);

    const { rows: conv } = await db.query<{ decision_id: string; line_total: number }>(
      `SELECT decision_id, line_total FROM public.suggestion_conversions`);
    expect(conv).toHaveLength(1);
    expect(conv[0].decision_id).toBe(decisionId);
    // Priced from menu_items, never from the client.
    expect(Number(conv[0].line_total)).toBe(3);
  });

  it('reports acceptance against sightings, not against mounts', async () => {
    const rows = await recommend([BURGER]);
    await markSeen(rows[0].decision_id);

    const payload = JSON.stringify([{
      menu_item_id: COFFEE, quantity: 1,
      from_suggestion: { source_item_id: BURGER, placement: 'cart', decision_id: rows[0].decision_id },
    }]);
    await db.query(`SELECT public.guest_place_order($1, $2, 'Amina', 'cash', $3::jsonb, 0)`,
      [SESSION, TOKEN, payload]);

    await actAs(db, STAFF);
    const { rows: perf } = await db.query<{ seen: number; accepted: number; acceptance_pct: number }>(
      `SELECT seen, accepted, acceptance_pct FROM public.decision_performance(30) WHERE placement = 'cart'`);
    await actAs(db, null);

    expect(Number(perf[0].seen)).toBe(1);
    expect(Number(perf[0].accepted)).toBe(1);
    expect(Number(perf[0].acceptance_pct)).toBe(100);
  });

  it('counts the no-suggestion decisions in the denominator', async () => {
    await recommend([BURGER]);
    await db.exec(`UPDATE public.restaurant_settings SET recommendations_enabled = false WHERE id = 1`);
    await recommend([BURGER]);

    await actAs(db, STAFF);
    const { rows } = await db.query<{ decisions: number; with_suggestion: number }>(
      `SELECT decisions, with_suggestion FROM public.decision_performance(30) WHERE placement = 'cart'`);
    await actAs(db, null);

    expect(Number(rows[0].decisions)).toBe(2);
    expect(Number(rows[0].with_suggestion)).toBe(1);
  });

  it('is staff-only to read', async () => {
    await expect(db.query(`SELECT * FROM public.decision_performance(30)`))
      .rejects.toThrow(/Only staff/);
  });
});
