import { describe, expect, it } from 'vitest';
import { compileRpc, compileTable, parseSelect, pickFunction, RestError, splitTop, statusForPgError } from './postgrest';
import type { SchemaCache } from './schema-cache';
import type { BackendRequest } from './types';

/** A small schema: orders → table_sessions → tables, orders ← order_items → menu_items. */
const schema: SchemaCache = {
  tables: new Map([
    ['orders', new Map([['id', 'uuid'], ['status', 'order_status'], ['total', 'numeric(10,2)'], ['created_at', 'timestamp with time zone'], ['table_session_id', 'uuid'], ['held_reason', 'text']])],
    ['order_items', new Map([['id', 'uuid'], ['order_id', 'uuid'], ['menu_item_id', 'uuid'], ['quantity', 'integer']])],
    ['menu_items', new Map([['id', 'uuid'], ['name', 'text'], ['merchandising_tags', 'text[]'], ['featured_rank', 'smallint']])],
    ['menu_item_prep_stats', new Map([['menu_item_id', 'uuid'], ['samples', 'integer']])],
    ['table_sessions', new Map([['id', 'uuid'], ['table_id', 'uuid']])],
    ['tables', new Map([['id', 'uuid'], ['table_number', 'integer']])],
  ]),
  primaryKeys: new Map([['orders', ['id']], ['menu_items', ['id']]]),
  foreignKeys: [
    { name: 'orders_table_session_id_fkey', child: 'orders', childCols: ['table_session_id'], parent: 'table_sessions', parentCols: ['id'], childUnique: false },
    { name: 'order_items_order_id_fkey', child: 'order_items', childCols: ['order_id'], parent: 'orders', parentCols: ['id'], childUnique: false },
    { name: 'order_items_menu_item_id_fkey', child: 'order_items', childCols: ['menu_item_id'], parent: 'menu_items', parentCols: ['id'], childUnique: false },
    { name: 'table_sessions_table_id_fkey', child: 'table_sessions', childCols: ['table_id'], parent: 'tables', parentCols: ['id'], childUnique: false },
    { name: 'menu_item_prep_stats_menu_item_id_fkey', child: 'menu_item_prep_stats', childCols: ['menu_item_id'], parent: 'menu_items', parentCols: ['id'], childUnique: true },
  ],
  functions: new Map([
    ['guest_place_order', [{
      name: 'guest_place_order', returnsSet: false, returnsVoid: false, returnsRows: false,
      args: [
        { name: '_session_id', type: 'uuid', hasDefault: false }, { name: '_items', type: 'jsonb', hasDefault: false },
        { name: '_tip', type: 'numeric', hasDefault: true }, { name: '_client_order_id', type: 'uuid', hasDefault: true },
      ],
    }]],
    ['kitchen_load', [{ name: 'kitchen_load', returnsSet: true, returnsVoid: false, returnsRows: true, args: [] }]],
    ['mark_seen', [{ name: 'mark_seen', returnsSet: false, returnsVoid: true, returnsRows: false, args: [{ name: '_id', type: 'uuid', hasDefault: false }] }]],
  ]),
};

const request = (method: string, query: Record<string, string> = {}, body: unknown = null, headers: Record<string, string> = {}): BackendRequest => ({
  method, path: '/rest/v1/x', query: new URLSearchParams(query), headers, body,
});

describe('reading select=', () => {
  it('splits on commas outside brackets and quotes', () => {
    expect(splitTop('a,b(c,d),"e,f",g')).toEqual(['a', 'b(c,d)', '"e,f"', 'g']);
  });

  it('reads columns, aliases, casts and nested embeds', () => {
    expect(parseSelect('id, total::text, when:created_at, order_items!inner(quantity, menu_items(name))')).toEqual([
      { kind: 'column', name: 'id', alias: undefined, cast: undefined },
      { kind: 'column', name: 'total', alias: undefined, cast: 'text' },
      { kind: 'column', name: 'created_at', alias: 'when', cast: undefined },
      {
        kind: 'embed', relation: 'order_items', alias: undefined, hint: undefined, inner: true,
        children: [
          { kind: 'column', name: 'quantity', alias: undefined, cast: undefined },
          { kind: 'embed', relation: 'menu_items', alias: undefined, hint: undefined, inner: false, children: [{ kind: 'column', name: 'name', alias: undefined, cast: undefined }] },
        ],
      },
    ]);
  });

  it('takes an empty select as every column', () => {
    expect(parseSelect('')).toEqual([{ kind: 'star' }]);
  });
});

describe('table requests become SQL', () => {
  it('casts filter values to the column type and keeps them out of the SQL text', () => {
    const c = compileTable(schema, 'orders', request('GET', { select: 'id', status: 'eq.pending', total: 'gte.10' }));
    expect(c.sql).toContain('t1."status" = ($1->>0)::order_status');
    expect(c.sql).toContain('t1."total" >= ($1->>1)::numeric(10,2)');
    expect(c.params).toEqual(['pending', '10']);
    expect(c.sql).not.toContain('pending');
  });

  it('understands in, is, not and or', () => {
    const c = compileTable(schema, 'orders', request('GET', {
      status: 'in.(pending,"confirmed",preparing)', held_reason: 'not.is.null', or: '(held_reason.is.null,total.gt.50)',
    }));
    expect(c.params[0]).toEqual(['pending', 'confirmed', 'preparing']);
    expect(c.sql).toContain('= ANY(ARRAY(SELECT jsonb_array_elements_text(($1->0)))::order_status[])');
    expect(c.sql).toContain('NOT (t1."held_reason" IS NULL)');
    expect(c.sql).toContain('(t1."held_reason" IS NULL OR t1."total" > ($1->>1)::numeric(10,2))');
  });

  it('reads array containment for the "new" badge', () => {
    const c = compileTable(schema, 'menu_items', request('GET', { or: '(featured_rank.not.is.null,merchandising_tags.cs.{new})' }));
    expect(c.sql).toContain('t1."merchandising_tags" @> ($1->>0)::text[]');
    expect(c.params).toEqual(['{new}']);
  });

  it('embeds the one a row points at as an object and the many that point at it as a list', () => {
    const c = compileTable(schema, 'orders', request('GET', { select: '*,table_sessions(tables(table_number)),order_items(quantity)' }));
    expect(c.sql).toMatch(/\(SELECT row_to_json\(_e\) FROM \(SELECT .* FROM public\."table_sessions" t2 WHERE t2\."id" = t1\."table_session_id" LIMIT 1\) _e\) AS "table_sessions"/);
    expect(c.sql).toMatch(/COALESCE\(\(SELECT json_agg\(row_to_json\(_e\)\) FROM \(SELECT .* FROM public\."order_items" t\d WHERE t\d\."order_id" = t1\."id"\) _e\), '\[\]'::json\) AS "order_items"/);
  });

  it('embeds a one-to-one as an object', () => {
    const c = compileTable(schema, 'menu_items', request('GET', { select: 'id,menu_item_prep_stats(samples)' }));
    expect(c.sql).toContain('AS "menu_item_prep_stats"');
    expect(c.sql).toMatch(/row_to_json\(_e\) FROM \(SELECT t2\."samples" AS "samples" FROM public\."menu_item_prep_stats"/);
  });

  it('keeps only rows with a match for an !inner embed', () => {
    const c = compileTable(schema, 'orders', request('GET', { select: 'id,table_sessions!inner(tables!inner(table_number))', 'table_sessions.tables.table_number': 'eq.5' }));
    expect(c.sql).toMatch(/WHERE EXISTS \(SELECT 1 FROM public\."table_sessions" t\d WHERE .* AND EXISTS \(SELECT 1 FROM public\."tables" t\d WHERE .*"table_number" = \(\$1->>\d\)::integer\)\)/);
  });

  it('orders, limits and counts', () => {
    const c = compileTable(schema, 'orders', request('GET', { order: 'created_at.desc.nullslast,id', limit: '20', offset: '40' }, null, { prefer: 'count=exact' }));
    expect(c.sql).toContain('ORDER BY t1."created_at" DESC NULLS LAST, t1."id" ASC LIMIT 20 OFFSET 40');
    expect(c.sql).toContain('SELECT count(*) FROM public."orders" t1');
    expect(c.wantsCount).toBe(true);
  });

  it('inserts only the columns sent, and upserts on the key it is given', () => {
    const insert = compileTable(schema, 'menu_items', request('POST', {}, { name: 'Soup' }, { prefer: 'return=representation' }));
    expect(insert.sql).toContain('INSERT INTO public."menu_items" ("name") SELECT "name" FROM jsonb_populate_recordset(NULL::public."menu_items", ($1->0))');
    expect(insert.successStatus).toBe(201);
    expect(insert.returnBody).toBe(true);
    const upsert = compileTable(schema, 'menu_items', request('POST', { on_conflict: 'id' }, [{ id: 'x', name: 'Soup' }], { prefer: 'resolution=merge-duplicates' }));
    expect(upsert.sql).toContain('ON CONFLICT ("id") DO UPDATE SET "name" = EXCLUDED."name"');
    expect(upsert.returnBody).toBe(false);
  });

  it('updates and deletes only what the filters match', () => {
    const update = compileTable(schema, 'orders', request('PATCH', { id: 'eq.abc' }, { status: 'ready' }));
    expect(update.sql).toMatch(/UPDATE public\."orders" t\d SET "status" = _b\."status" FROM .* WHERE t\d\."id" = \(\$1->>1\)::uuid/);
    expect(update.successStatus).toBe(204);
    const remove = compileTable(schema, 'orders', request('DELETE', { id: 'eq.abc' }));
    expect(remove.sql).toMatch(/DELETE FROM public\."orders" t\d WHERE t\d\."id" = \(\$1->>0\)::uuid/);
  });

  it('refuses a table or column that does not exist, before any SQL runs', () => {
    expect(() => compileTable(schema, 'secrets', request('GET'))).toThrowError(RestError);
    expect(() => compileTable(schema, 'orders', request('GET', { 'nope; DROP TABLE orders': 'eq.1' }))).toThrowError(/does not exist/);
    expect(() => compileTable(schema, 'orders', request('GET', { select: 'id,waiters(name)' }))).toThrowError(/relationship/);
  });
});

describe('RPC requests become SQL', () => {
  it('calls by argument name, typing each argument from the function', () => {
    const c = compileRpc(schema, 'guest_place_order', request('POST', {}, { _session_id: 's', _items: [{ menu_item_id: 'm' }] }));
    expect(c.sql).toContain('FROM jsonb_to_record(($1->0)) AS _a("_session_id" uuid, "_items" jsonb)');
    expect(c.sql).toContain('public."guest_place_order"("_session_id" := _a."_session_id", "_items" := _a."_items")');
    expect(c.params).toEqual([{ _session_id: 's', _items: [{ menu_item_id: 'm' }] }]);
  });

  it('answers PGRST202 when no function takes those arguments — the app falls back on that code', () => {
    try {
      pickFunction(schema, 'guest_place_order', ['_session_id', '_items', '_unknown']);
      throw new Error('should have refused');
    } catch (error) {
      expect(error).toBeInstanceOf(RestError);
      expect((error as RestError).body.code).toBe('PGRST202');
      expect((error as RestError).status).toBe(404);
    }
    expect(() => pickFunction(schema, 'guest_place_order', ['_session_id'])).toThrowError(RestError);
  });

  it('returns rows as a list, and nothing for a void function', () => {
    expect(compileRpc(schema, 'kitchen_load', request('POST', {}, {})).sql).toContain('json_agg(_g)');
    const none = compileRpc(schema, 'mark_seen', request('POST', {}, { _id: 'x' }));
    expect(none.returnBody).toBe(false);
    expect(none.successStatus).toBe(204);
  });
});

describe('database errors get the status PostgREST gives them', () => {
  it('maps permission, conflict and raised errors', () => {
    expect(statusForPgError('42501', true)).toBe(401);
    expect(statusForPgError('42501', false)).toBe(403);
    expect(statusForPgError('23505', false)).toBe(409);
    expect(statusForPgError('P0001', false)).toBe(400);
  });
});
