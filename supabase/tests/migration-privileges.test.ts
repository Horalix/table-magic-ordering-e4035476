/**
 * @vitest-environment node
 *
 * The pending batch applies without superuser rights.
 *
 * The test database runs every migration as a superuser; Supabase's
 * `postgres` role, which Lovable applies migrations as, is not one. Lovable
 * stopped at the maintenance file for exactly that: a function attribute
 * `SET lasoul.scheduled_job = 'on'` needs a superuser. Here the schema
 * production already has is built as the superuser and handed to an ordinary
 * role that owns it, as `postgres` owns it on Supabase; the pending files are
 * then applied as that role, and the scheduler's entry points run as it, the
 * way pg_cron runs them.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error -- plain JS harness, no types needed
import { createTestDatabase, migrationFiles } from '../../scripts/db-harness.mjs';

// The first file not yet applied on production.
const FIRST_PENDING = '20260805090000';

const HAND_OVER = `
  CREATE ROLE migrator NOSUPERUSER NOLOGIN;
  ALTER SCHEMA public OWNER TO migrator;
  GRANT ALL ON SCHEMA auth, storage, extensions TO migrator;
  GRANT ALL ON ALL TABLES IN SCHEMA auth, storage TO migrator;
  GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO migrator;
  DO $$
  DECLARE r record;
  BEGIN
    -- Tables, views and free-standing sequences (a column's sequence follows its table).
    FOR r IN
      SELECT c.oid::regclass AS obj,
             CASE c.relkind WHEN 'S' THEN 'SEQUENCE' WHEN 'v' THEN 'VIEW'
                            WHEN 'm' THEN 'MATERIALIZED VIEW' ELSE 'TABLE' END AS kind
        FROM pg_class c
       WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p', 'v', 'm', 'S')
         AND NOT EXISTS (SELECT 1 FROM pg_depend d
                          WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid
                            AND d.deptype IN ('a', 'i', 'e'))
    LOOP
      EXECUTE format('ALTER %s %s OWNER TO migrator', r.kind, r.obj);
    END LOOP;
    FOR r IN
      SELECT p.oid::regprocedure AS obj,
             CASE p.prokind WHEN 'p' THEN 'PROCEDURE' WHEN 'a' THEN 'AGGREGATE' ELSE 'FUNCTION' END AS kind
        FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace
         AND NOT EXISTS (SELECT 1 FROM pg_depend d
                          WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
    LOOP
      EXECUTE format('ALTER %s %s OWNER TO migrator', r.kind, r.obj);
    END LOOP;
    FOR r IN
      SELECT t.oid::regtype AS obj, CASE t.typtype WHEN 'd' THEN 'DOMAIN' ELSE 'TYPE' END AS kind
        FROM pg_type t
       WHERE t.typnamespace = 'public'::regnamespace
         AND (t.typtype IN ('e', 'd')
              OR (t.typtype = 'c' AND (SELECT relkind FROM pg_class WHERE oid = t.typrelid) = 'c'))
         AND NOT EXISTS (SELECT 1 FROM pg_depend d
                          WHERE d.classid = 'pg_type'::regclass AND d.objid = t.oid AND d.deptype = 'e')
    LOOP
      EXECUTE format('ALTER %s %s OWNER TO migrator', r.kind, r.obj);
    END LOOP;
  END $$;
`;

describe('migration privileges', () => {
  it('applies every pending migration as an owner without superuser rights', async () => {
    const db = await createTestDatabase({ quiet: true, until: FIRST_PENDING });
    await db.exec(HAND_OVER);
    await db.exec('SET ROLE migrator');
    const { rows: who } = await db.query<{ su: boolean }>(
      `SELECT rolsuper AS su FROM pg_roles WHERE rolname = current_user`);
    expect(who[0].su).toBe(false);

    let failed: string | null = null;
    for (const file of (migrationFiles() as string[]).filter((f) => f >= FIRST_PENDING)) {
      try {
        await db.exec(readFileSync(path.join(__dirname, '..', 'migrations', file), 'utf8'));
      } catch (error) {
        failed = `${file}: ${(error as Error).message}`;
        break;
      }
    }
    expect(failed).toBeNull();

    // pg_cron runs the entry points as that same ordinary role.
    for (const entry of ['run_scheduled_maintenance', 'run_scheduled_learning_refresh']) {
      const { rows } = await db.query<{ r: { ran?: boolean } }>(`SELECT public.${entry}() AS r`);
      expect(rows[0].r).toBeTruthy();
      const { rows: mark } = await db.query<{ v: string | null }>(
        `SELECT current_setting('lasoul.scheduled_job', true) AS v`);
      expect(mark[0].v ?? '').not.toBe('on');
    }
    await db.close();
  }, 240_000);

  // pg_get_functiondef() raises on aggregates, and the live planner evaluated
  // a WHERE condition on all of pg_proc before the schema filter: business_day
  // stopped on "array_agg is an aggregate function". The test database plans
  // it the other way, so only a rule catches it: match on prosrc in filters,
  // and call pg_get_functiondef() only on rows already chosen.
  it('never calls pg_get_functiondef() inside a filter', () => {
    const problems: string[] = [];
    for (const file of (migrationFiles() as string[]).filter((f) => f >= FIRST_PENDING)) {
      const sql = readFileSync(path.join(__dirname, '..', 'migrations', file), 'utf8').replace(/--[^\n]*/g, '');
      const lines = sql.split('\n');
      lines.forEach((line, i) => {
        if (/\b(WHERE|AND|OR|ON)\s+(NOT\s+)?(position\([^)]*\bin\s+)?pg_get_functiondef\(/i.test(line)
          || /pg_get_functiondef\([^)]*\)\s*(NOT\s+)?(LIKE|ILIKE|~|=|<>)/i.test(line)) {
          problems.push(`${file}:${i + 1}: ${line.trim()}`);
        }
      });
    }
    expect(problems).toEqual([]);
  });
});
