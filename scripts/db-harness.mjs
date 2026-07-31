/**
 * Boot an in-process PostgreSQL (PGlite), apply the test shim and every
 * migration in supabase/migrations, and hand back a live database.
 *
 * Used by the SQL integration tests so the payment/state-machine guarantees
 * are verified against a real Postgres planner, triggers and PL/pgSQL — not a
 * mock. No Docker, no network, no Supabase project required.
 */
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const MIGRATIONS_DIR = path.join(ROOT, 'supabase', 'migrations');
const SHIM = path.join(ROOT, 'supabase', 'tests', 'harness', '00_shim.sql');

export function migrationFiles() {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
}

/**
 * @param {{ quiet?: boolean }} [opts]
 * @returns {Promise<import('@electric-sql/pglite').PGlite>}
 */
export async function createTestDatabase(opts = {}) {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.waitReady;

  await db.exec(readFileSync(SHIM, 'utf8'));

  for (const file of migrationFiles()) {
    const sql = readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    if (!sql.trim()) continue;
    try {
      // Each migration runs in its own transaction, matching how the Supabase
      // CLI applies them — which is what makes the split enum migration valid.
      await db.exec(sql);
    } catch (error) {
      error.message = `migration ${file} failed: ${error.message}`;
      throw error;
    }
    if (!opts.quiet) console.log(`  applied ${file}`);
  }

  return db;
}

/** Impersonate a signed-in user for auth.uid()-dependent code. */
export async function actAs(db, userId) {
  await db.query(`SELECT set_config('request.jwt.claim.sub', $1, false)`, [userId ?? '']);
}
