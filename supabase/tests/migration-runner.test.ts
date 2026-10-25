/**
 * @vitest-environment node
 *
 * docs/migration-runner.sql applies the pending batch without anyone copying
 * it: the live database fetches each file (pg_net) and runs it only on an
 * exact MD5 match. Lovable stopped retyping 735 KB of SQL by hand after one
 * slipped character; this is what replaces that.
 *
 * Here the downloads are placed in net._http_response the way pg_net leaves
 * them, the runner's own blocks are run as an ordinary owner role (as on
 * Supabase), and the result must be the schema and seeded rules that
 * applying the files directly gives.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error -- plain JS harness, no types needed
import { createTestDatabase, migrationFiles } from '../../scripts/db-harness.mjs';
import { HAND_OVER } from './harness/hand-over';

type Db = Awaited<ReturnType<typeof createTestDatabase>>;

const ROOT = path.join(__dirname, '..', '..');
const RUNNER = readFileSync(path.join(ROOT, 'docs', 'migration-runner.sql'), 'utf8').replace(/\r\n/g, '\n');
const pinned = [...RUNNER.matchAll(/\((\d+), '([^']+\.sql)', '([0-9a-f]{32})'\)/g)]
  .map((m) => ({ n: Number(m[1]), file: m[2], md5: m[3] }));
const blocks = RUNNER.match(/DO \$apply\$[\s\S]*?END \$apply\$;/g) ?? [];
const arrived = RUNNER.match(/SELECT f\.n, f\.file,[\s\S]*?ORDER BY f\.n;/)?.[0] ?? '';
const fileText = (file: string) =>
  readFileSync(path.join(ROOT, 'supabase', 'migrations', file), 'utf8').replace(/\r\n/g, '\n');
const md5 = (s: string) => createHash('md5').update(s, 'utf8').digest('hex');

/** What a migration leaves behind: function bodies, columns, policies, seeded rules. */
async function fingerprint(db: Db) {
  const { rows } = await db.query<Record<string, string>>(`
    SELECT
      (SELECT md5(string_agg(p.oid::regprocedure::text || E'\\n' || pg_get_functiondef(p.oid), E'\\n' ORDER BY p.oid::regprocedure::text))
         FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.prokind = 'f') AS functions,
      (SELECT md5(string_agg(table_name || '.' || column_name || ':' || data_type || ':' || COALESCE(column_default, ''), E'\\n' ORDER BY table_name, column_name))
         FROM information_schema.columns WHERE table_schema = 'public') AS columns,
      (SELECT md5(string_agg(tablename || ':' || policyname || ':' || COALESCE(qual, '') || ':' || COALESCE(with_check, ''), E'\\n' ORDER BY tablename, policyname))
         FROM pg_policies WHERE schemaname = 'public') AS policies,
      (SELECT md5(string_agg(x, E'\\n' ORDER BY x)) FROM (
         SELECT 'fit:' || context_kind || '>' || candidate_kind AS x FROM public.reco_fit
         UNION ALL SELECT 'clash:' || context_kind || '>' || candidate_kind FROM public.reco_clash) seeded) AS seeded`);
  return rows[0];
}

describe('migration runner', () => {
  it('pins every pending file, byte for byte as it is in the repository', () => {
    expect(pinned.length).toBeGreaterThan(0);
    const pending = (migrationFiles() as string[]).filter((f) => f >= pinned[0].file);
    expect(pinned.map((p) => p.file)).toEqual(pending);
    for (const p of pinned) expect(md5(fileText(p.file)), p.file).toBe(p.md5);
    // One block per file, in order, each naming its own file and hash.
    expect(blocks.length).toBe(pinned.length);
    blocks.forEach((b, i) => {
      expect(b).toContain(`md5(r.content) = '${pinned[i].md5}'`);
      expect(b).toContain(`'applied ${pinned[i].file}'`);
    });
  });

  it('applies them as an ordinary owner, and ends exactly where the files do', async () => {
    const db = await createTestDatabase({ quiet: true, until: pinned[0].file.slice(0, 14) });
    await db.exec(`
      CREATE SCHEMA net;
      CREATE TABLE net._http_response (
        id bigserial PRIMARY KEY, status_code int, content text, created timestamptz NOT NULL DEFAULT now());`);
    for (const p of pinned) {
      await db.query(`INSERT INTO net._http_response(status_code, content) VALUES (200, $1)`, [fileText(p.file)]);
    }
    // A newer, corrupted copy of the first file (one character off): it must be passed over.
    await db.query(`INSERT INTO net._http_response(status_code, content, created) VALUES (200, $1, now() + interval '1 minute')`,
      [fileText(pinned[0].file).replace(';', ':')]);
    await db.exec(HAND_OVER);
    await db.exec('GRANT USAGE ON SCHEMA net TO migrator; GRANT SELECT ON net._http_response TO migrator;');
    await db.exec('SET ROLE migrator');

    const { rows: check } = await db.query<{ arrived_exactly: boolean }>(arrived);
    expect(check.map((r) => r.arrived_exactly)).toEqual(pinned.map(() => true));

    // A block whose file has not arrived exactly runs nothing.
    await expect(db.exec(blocks[0].replace(/md5\(r\.content\) = '[0-9a-f]{32}'/, `md5(r.content) = '${'0'.repeat(32)}'`)))
      .rejects.toThrow(/has not arrived exactly/);

    let failed: string | null = null;
    for (const [i, b] of blocks.entries()) {
      try { await db.exec(b); } catch (error) { failed = `${pinned[i].file}: ${(error as Error).message}`; break; }
    }
    expect(failed).toBeNull();

    await db.exec('RESET ROLE');
    const viaRunner = await fingerprint(db);
    await db.close();
    const direct = await createTestDatabase({ quiet: true });
    const viaFiles = await fingerprint(direct);
    await direct.close();
    expect(Object.values(viaFiles).every(Boolean)).toBe(true);
    expect(viaRunner).toEqual(viaFiles);
  }, 300_000);
});
