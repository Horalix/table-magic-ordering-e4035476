/**
 * @vitest-environment node
 *
 * The migration preflight agrees with the schema production has before the
 * pending migrations, and with the schema they leave.
 *
 * docs/migration-preflight.sql is run against the LIVE database before the
 * pending migrations, to catch drift — a missing column, a name already
 * taken — before anything is changed (the first October attempt failed on
 * exactly that kind of thing). This test builds the database up to the first
 * pending file and requires every row to be found there, and again after
 * everything, so the preflight can be re-run once the batch has gone in.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error -- plain JS harness, no types needed
import { createTestDatabase } from '../../scripts/db-harness.mjs';

/** The first file not yet applied on production (the October batch is live). */
const FIRST_PENDING = '20261027090000';
const SQL = readFileSync(path.join(__dirname, '..', '..', 'docs', 'migration-preflight.sql'), 'utf8');

describe('migration preflight', () => {
  it('passes on production as it stands: everything before the pending files applied', async () => {
    const db = await createTestDatabase({ quiet: true, until: FIRST_PENDING });
    const { rows } = await db.query<{ rewrite: string; found: boolean }>(SQL);
    await db.close();
    expect(rows.length).toBeGreaterThan(3);
    expect(rows.filter((r) => !r.found).map((r) => r.rewrite)).toEqual([]);
  }, 180_000);

  it('still passes once the pending files are in', async () => {
    const db = await createTestDatabase({ quiet: true });
    const { rows } = await db.query<{ rewrite: string; found: boolean }>(SQL);
    await db.close();
    expect(rows.filter((r) => !r.found).map((r) => r.rewrite)).toEqual([]);
  }, 180_000);
});
