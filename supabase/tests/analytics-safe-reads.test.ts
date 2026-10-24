/**
 * @vitest-environment node
 *
 * One bad event must not take a screen down.
 *
 * Ingest now drops item ids that are not uuids, but rows written before that
 * (or by anything that bypasses ingest) are still in the table. The readers
 * have to survive them on their own.
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
const BURGER = 'cccccccc-cccc-cccc-cccc-cccccccc0001';
const FRIES = 'cccccccc-cccc-cccc-cccc-cccccccc0002';

let db: Db;

async function seed() {
  await db.exec(`
    TRUNCATE public.analytics_events, public.suggestion_stats,
             public.menu_items, public.subcategories, public.categories
      RESTART IDENTITY CASCADE;
    DELETE FROM public.user_roles;
    DELETE FROM auth.users;
    INSERT INTO auth.users(id) VALUES ('${STAFF}');
    INSERT INTO public.user_roles(user_id, role) VALUES ('${STAFF}', 'staff');

    INSERT INTO public.categories(id, name, sort_order) VALUES ('aaaaaaaa-0000-0000-0000-000000000001', 'Food', 1);
    INSERT INTO public.subcategories(id, category_id, name, sort_order) VALUES
      ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'Mains', 1);
    INSERT INTO public.menu_items(id, subcategory_id, name, price, is_available, station) VALUES
      ('${BURGER}', 'bbbbbbbb-0000-0000-0000-000000000001', 'Burger', 20.00, true, 'kitchen'),
      ('${FRIES}',  'bbbbbbbb-0000-0000-0000-000000000001', 'Fries', 6.00, true, 'kitchen');

    -- Written straight into the table, the way a pre-fix client or a forged
    -- request would have left them.
    INSERT INTO public.analytics_events(visit_id, event, props) VALUES
      ('v1', 'item_viewed', '{"item_id": "not-a-uuid"}'),
      ('v1', 'suggestion_shown', '{"item_id": "x", "source_item_id": "y", "placement": "cart"}'),
      ('v2', 'item_viewed', '{"item_id": "${BURGER}"}'),
      ('v2', 'suggestion_shown', '{"item_id": "${FRIES}", "source_item_id": "${BURGER}", "placement": "cart"}'),
      ('v2', 'suggestion_accepted', '{"item_id": "${FRIES}", "source_item_id": "${BURGER}", "placement": "cart"}');
  `);
}

describe('analytics readers and malformed events', () => {
  beforeAll(async () => { db = await createTestDatabase({ quiet: true }); }, 180_000);
  afterAll(async () => { await db?.close(); });
  beforeEach(seed);

  it('the impact page still loads', async () => {
    await actAs(db, STAFF);
    const { rows } = await db.query<{ r: Record<string, unknown> }>(`SELECT public.app_impact_summary(30) AS r`);
    await actAs(db, null);
    expect(rows[0].r).toBeTruthy();
  });

  it('nightly learning still runs, and learns from the good rows', async () => {
    await actAs(db, STAFF);
    await db.query(`SELECT public.refresh_suggestion_stats()`);
    await actAs(db, null);
    const { rows } = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM public.suggestion_stats WHERE recommended_item_id = $1`, [FRIES]);
    expect(rows[0].n).toBeGreaterThan(0);
  });
});
