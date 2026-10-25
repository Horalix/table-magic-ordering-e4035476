/**
 * @vitest-environment node
 *
 * The migration preflight agrees with the schema production is expected to
 * have before the pending batch.
 *
 * docs/migration-preflight.sql is run against the LIVE database before the
 * pending migrations, to find any function whose text differs from what the
 * repository says it is (the first attempt failed on exactly that). This test
 * builds the database only up to the first pending file and requires every
 * row to be found there; a false row on production is then real drift.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error -- plain JS harness, no types needed
import { createTestDatabase } from '../../scripts/db-harness.mjs';

const FIRST_PENDING = '20260804090300';

describe('migration preflight', () => {
  it('finds every search literal in the schema production should have', async () => {
    const db = await createTestDatabase({ quiet: true, until: FIRST_PENDING });
    const sql = readFileSync(path.join(__dirname, '..', '..', 'docs', 'migration-preflight.sql'), 'utf8');
    const { rows } = await db.query<{ rewrite: string; found: boolean }>(sql);
    await db.close();
    expect(rows.length).toBeGreaterThan(40);
    expect(rows.filter((r) => !r.found).map((r) => r.rewrite)).toEqual([]);
  }, 180_000);

  // Production on 26 October 2026: session_context applied (Lovable's earlier
  // batch), nothing after it. The texts that file replaced are gone there by
  // design; the preflight must still say every row is fine.
  it('passes on production as it stands: session_context applied, the rest pending', async () => {
    const db = await createTestDatabase({ quiet: true, until: '20260804090400' });
    const sql = readFileSync(path.join(__dirname, '..', '..', 'docs', 'migration-preflight.sql'), 'utf8');
    const { rows } = await db.query<{ rewrite: string; found: boolean }>(sql);
    await db.close();
    expect(rows.filter((r) => !r.found).map((r) => r.rewrite)).toEqual([]);
  }, 180_000);
});
