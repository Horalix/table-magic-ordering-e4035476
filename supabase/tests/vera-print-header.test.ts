/**
 * @vitest-environment node
 *
 * Vera Italia's tickets are headed "Vera Italia" (20261031091000_vera_print_header.sql).
 *
 * Its settings row took the column default, 'La Soul', so every kitchen and
 * bar ticket it printed named the other restaurant. The migration replaces
 * only that untouched default, leaves La Soul's own header and any header an
 * owner typed alone, and does nothing the second time.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
// @ts-expect-error -- plain JS harness, no types needed
import { createTestDatabase } from '../../scripts/db-harness.mjs';

type Db = {
  query: <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<{ rows: T[] }>;
  exec: (sql: string) => Promise<unknown>;
  close: () => Promise<void>;
};

const L = 'a5000000-0000-4000-8000-000000000001'; // La Soul
const V = 'a5000000-0000-4000-8000-000000000002'; // Vera Italia

const MIGRATION = readFileSync(
  path.join(__dirname, '..', 'migrations', '20261031091000_vera_print_header.sql'),
  'utf8',
);

let db: Db;

beforeAll(async () => {
  db = (await createTestDatabase({ quiet: true })) as unknown as Db;
}, 180_000);
afterAll(async () => { await db?.close(); });

const headers = async () => {
  const { rows } = await db.query<{ venue_id: string; print_header: string }>(
    'SELECT venue_id, print_header FROM public.restaurant_settings ORDER BY venue_id',
  );
  return Object.fromEntries(rows.map((r) => [r.venue_id, r.print_header]));
};

describe("Vera Italia's ticket header", () => {
  it('is Vera Italia after the migrations, and La Soul keeps its own', async () => {
    expect(await headers()).toEqual({ [L]: 'La Soul', [V]: 'Vera Italia' });
  });

  it('replaces only the La Soul default, and a second run changes nothing', async () => {
    await db.exec(`UPDATE public.restaurant_settings SET print_header = 'Vera Italia · Sarajevo' WHERE venue_id = '${V}'`);
    await db.exec(MIGRATION);
    expect(await headers()).toEqual({ [L]: 'La Soul', [V]: 'Vera Italia · Sarajevo' });

    await db.exec(`UPDATE public.restaurant_settings SET print_header = 'La Soul' WHERE venue_id = '${V}'`);
    await db.exec(MIGRATION);
    await db.exec(MIGRATION);
    expect(await headers()).toEqual({ [L]: 'La Soul', [V]: 'Vera Italia' });
  });
});
