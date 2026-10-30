/**
 * @vitest-environment node
 *
 * Vera Italia's menu (20261030120000_vera_italia_menu.sql, generated from
 * scripts/vera-italia/menu.json): every course, section and dish is Vera
 * Italia's, La Soul's guests never see one, and every dish that should have
 * a photograph has one in the app.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
// @ts-expect-error -- plain JS harness, no types needed
import { createTestDatabase } from '../../scripts/db-harness.mjs';

type Db = {
  query: <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<{ rows: T[] }>;
  exec: (sql: string) => Promise<unknown>;
  close: () => Promise<void>;
};

const ROOT = path.resolve(__dirname, '..', '..');
const L = 'a5000000-0000-4000-8000-000000000001';
const V = 'a5000000-0000-4000-8000-000000000002';
const menu = JSON.parse(readFileSync(path.join(ROOT, 'scripts/vera-italia/menu.json'), 'utf8'));
const dishes: { id: string; name: string; no_photo?: boolean; price: number }[] =
  menu.categories.flatMap((c: { sections: { items: unknown[] }[] }) => c.sections.flatMap((s) => s.items));

let db: Db;
beforeAll(async () => {
  db = (await createTestDatabase({ quiet: true })) as unknown as Db;
  await db.exec(`
    GRANT USAGE ON SCHEMA public TO anon, authenticated;
    GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon;
  `);
}, 180_000);
afterAll(async () => { await db?.close(); });

/** What a guest's phone reads, showing one restaurant (the x-venue header). */
async function guestSees(slug: string | null, sql: string) {
  await db.query(`SELECT set_config('request.headers', $1, false)`, [slug ? JSON.stringify({ 'x-venue': slug }) : '']);
  await db.exec('SET ROLE anon');
  try {
    return (await db.query<{ name: string }>(sql)).rows.map((r) => r.name);
  } finally {
    await db.exec('RESET ROLE');
    await db.query(`SELECT set_config('request.headers', '', false)`);
  }
}

describe('Vera Italia’s menu', () => {
  it('is all Vera Italia’s, as the owner sent it', async () => {
    const rows = (await db.query<{ venue_id: string; n: number }>(
      `SELECT venue_id, count(*)::int AS n FROM public.menu_items WHERE id = ANY($1::uuid[]) GROUP BY 1`,
      [dishes.map((d) => d.id)])).rows;
    expect(rows).toEqual([{ venue_id: V, n: dishes.length }]);
    const prices = (await db.query<{ name: string; price: string }>(
      `SELECT name, price::text FROM public.menu_items WHERE venue_id = $1 ORDER BY name`, [V])).rows;
    expect(Object.fromEntries(prices.map((p) => [p.name, Number(p.price)])))
      .toEqual(Object.fromEntries(dishes.map((d) => [d.name, d.price])));
  });

  it('is what a guest at Vera Italia sees, and never what a guest at La Soul sees', async () => {
    const vera = await guestSees('veraitalia', 'SELECT name FROM public.categories ORDER BY sort_order');
    expect(vera).toEqual(['Antipasti & Insalate', 'Pasta & Risotto', 'Pizza Napoletana', 'Carne']);
    // By id: the two menus share some names (Truffle Pasta, Pesto Risotto…).
    const veraIds = new Set(dishes.map((d) => d.id));
    for (const slug of ['lasoul', null]) {
      const seen = await guestSees(slug, 'SELECT id::text AS name FROM public.menu_items');
      expect(seen.filter((id) => veraIds.has(id))).toEqual([]);
    }
    const atVera = await guestSees('veraitalia', 'SELECT id::text AS name FROM public.menu_items');
    expect(new Set(atVera)).toEqual(veraIds);
  });

  it('features its own three dishes, apart from La Soul’s', async () => {
    const featured = (await db.query<{ venue_id: string; name: string }>(
      `SELECT venue_id, name FROM public.menu_items WHERE featured_rank IS NOT NULL AND venue_id = $1 ORDER BY featured_rank`, [V])).rows;
    expect(featured.map((r) => r.name)).toEqual(['Truffle Pizza', 'Burrata Pizza', 'Truffle Pasta']);
    expect((await db.query(`SELECT 1 FROM public.menu_items WHERE venue_id = $1 AND id = ANY($2::uuid[])`, [L, dishes.map((d) => d.id)])).rows).toHaveLength(0);
  });

  it('has every photograph the app shows, at every size', () => {
    const manifest = JSON.parse(readFileSync(path.join(ROOT, 'src/lib/image-manifest.json'), 'utf8'));
    for (const d of dishes.filter((x) => !x.no_photo)) {
      expect(manifest[d.id], d.name).toBeDefined();
      for (const w of manifest[d.id].widths) expect(existsSync(path.join(ROOT, 'public/menu', d.id, `${w}.webp`)), `${d.name} ${w}`).toBe(true);
      for (const s of manifest[d.id].squares) expect(existsSync(path.join(ROOT, 'public/menu', d.id, `sq-${s}.webp`)), `${d.name} sq-${s}`).toBe(true);
    }
  });
});
