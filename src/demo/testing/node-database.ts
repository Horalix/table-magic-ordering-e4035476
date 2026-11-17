/**
 * The demo database for tests, in Node: the same schema build the browser
 * runs (src/demo/backend/bootstrap.ts), with the SQL read from disk.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { buildSchema } from '../backend/bootstrap';

const ROOT = join(__dirname, '..', '..', '..');
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');

export async function createDemoSchema(): Promise<PGlite> {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.waitReady;
  const dir = join(ROOT, 'supabase', 'migrations');
  await buildSchema(db, {
    shim: read('supabase/tests/harness/00_shim.sql'),
    pre: read('src/demo/backend/sql/pre.sql'),
    migrations: readdirSync(dir).filter((f) => f.endsWith('.sql')).map((name) => ({ name, sql: readFileSync(join(dir, name), 'utf8') })),
    post: read('src/demo/backend/sql/post.sql'),
  });
  return db;
}
