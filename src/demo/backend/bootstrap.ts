/**
 * Builds the demo database's schema (demo mode only, src/demo): the test
 * harness's stand-in for the Supabase-managed parts, then every migration in
 * supabase/migrations in order — the same SQL production runs — then the
 * demo's own additions. No copy of the schema is kept anywhere: a new
 * migration is part of the demo the moment it is committed.
 */
import type { SqlDb } from './types';

export interface SchemaSources {
  /** supabase/tests/harness/00_shim.sql */
  shim: string;
  /** src/demo/backend/sql/pre.sql */
  pre: string;
  /** supabase/migrations/*.sql, any order. */
  migrations: { name: string; sql: string }[];
  /** src/demo/backend/sql/post.sql */
  post: string;
}

export async function buildSchema(db: SqlDb, sources: SchemaSources): Promise<void> {
  await db.exec(sources.shim);
  await db.exec(sources.pre);
  const ordered = [...sources.migrations].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const migration of ordered) {
    if (!migration.sql.trim()) continue;
    try {
      // One exec per file: each migration is its own transaction, as the Supabase CLI applies them.
      await db.exec(migration.sql);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`migration ${migration.name} failed: ${message}`);
    }
  }
  await db.exec(sources.post);
}

/** True once a database has the demo's schema and seed (it survives reloads in IndexedDB). */
export async function isSeeded(db: SqlDb): Promise<boolean> {
  const { rows } = await db.query<{ ready: boolean }>(
    `SELECT to_regclass('demo.meta') IS NOT NULL AS ready`);
  if (!rows[0]?.ready) return false;
  const seeded = await db.query(`SELECT 1 FROM demo.meta WHERE key = 'seeded'`);
  return seeded.rows.length > 0;
}
