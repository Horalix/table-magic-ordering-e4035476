/**
 * @vitest-environment node
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { createDemoSchema } from '../testing/node-database';
import { DemoBackend } from './router';
import type { BackendRequest } from './types';

let db: PGlite;
let backend: DemoBackend;

const request = (method: string, path: string, opts: { query?: Record<string, string>; body?: unknown; headers?: Record<string, string> } = {}): BackendRequest => ({
  method, path, query: new URLSearchParams(opts.query ?? {}), headers: opts.headers ?? {}, body: opts.body ?? null,
});

beforeAll(async () => {
  db = await createDemoSchema();
  backend = new DemoBackend(db);
}, 180_000);

afterAll(async () => { await db.close(); });

describe('the demo backend answers like PostgREST', () => {
  it('lets a guest read the menu tables', async () => {
    const res = await backend.handle(request('GET', '/rest/v1/categories', { query: { select: '*', order: 'sort_order' } }));
    expect(res.status).toBe(200);
    expect(Array.isArray(JSON.parse(res.body!))).toBe(true);
  });

  it('embeds related rows', async () => {
    const res = await backend.handle(request('GET', '/rest/v1/categories', { query: { select: 'id,name,subcategories(id,name,menu_items(id,name,price))' } }));
    expect(res.status).toBe(200);
    const rows = JSON.parse(res.body!);
    expect(rows[0]).toHaveProperty('subcategories');
  });

  it('calls a function by argument name', async () => {
    const res = await backend.handle(request('POST', '/rest/v1/rpc/guest_get_service_status', { body: {} }));
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body!)).toHaveProperty('ordering_enabled');
  });

  it('answers PGRST202 for a function that does not exist', async () => {
    const res = await backend.handle(request('POST', '/rest/v1/rpc/no_such_function', { body: { _x: 1 } }));
    expect(res.status).toBe(404);
    expect(JSON.parse(res.body!).code).toBe('PGRST202');
  });
});
