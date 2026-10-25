/**
 * @vitest-environment node
 *
 * Every table a migration creates states its access explicitly.
 *
 * Supabase no longer grants new public tables to the API roles by default,
 * and Lovable refuses to apply a migration that relies on it (26 Oct 2026:
 * it stopped at session_affinity for exactly this). A table is accepted when
 * its own file enables row level security, revokes from PUBLIC, and grants
 * the server role — whatever it then grants anon/authenticated must match its
 * policies, which the behaviour tests cover.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const DIR = path.join(__dirname, '..', 'migrations');
// Everything before this was applied with the old defaults.
const FROM = '20260804090400';

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

describe('migration grants', () => {
  it('every table created from the pending batch on states its access', () => {
    const problems: string[] = [];
    for (const file of readdirSync(DIR).filter((f) => f.endsWith('.sql') && f >= FROM).sort()) {
      const sql = readFileSync(path.join(DIR, file), 'utf8');
      for (const m of sql.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?(?:public\.)?([a-z_]+)/gi)) {
        const name = `(?:public\\.)?${esc(m[1])}\\b`;
        if (!new RegExp(`ALTER TABLE (?:IF EXISTS )?${name}[^;]*ENABLE ROW LEVEL SECURITY`, 'i').test(sql)) problems.push(`${file}: ${m[1]} has no row level security`);
        if (!new RegExp(`REVOKE [^;]* ON (?:TABLE )?${name}[^;]* FROM [^;]*PUBLIC`, 'i').test(sql)) problems.push(`${file}: ${m[1]} is not revoked from PUBLIC`);
        if (!new RegExp(`GRANT [^;]* ON (?:TABLE )?${name}[^;]* TO [^;]*service_role`, 'i').test(sql)) problems.push(`${file}: ${m[1]} is not granted to service_role`);
      }
    }
    expect(problems).toEqual([]);
  });
});
