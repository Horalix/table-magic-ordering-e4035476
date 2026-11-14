/**
 * The demo backend's front door (demo mode only, src/demo): every request
 * the app sends to its Supabase address ends up here and is answered from
 * the in-browser database.
 */
import { handleAuth, identityFromHeaders } from './auth';
import { handleFunction } from './functions';
import { compileRpc, compileTable, RestError, statusForPgError, type Compiled } from './postgrest';
import { loadSchemaCache, type SchemaCache } from './schema-cache';
import type { BackendRequest, BackendResponse, Identity, PgError, SqlDb } from './types';
import { empty, json } from './types';

/** Request headers the SQL reads (current_venue(), menu_deleted_asked()). */
const FORWARDED_HEADERS = ['x-venue', 'x-menu-deleted'];

/**
 * A photo "uploaded" in the menu editor goes nowhere in the demo (there is no
 * storage to hold it), so its address would show a broken picture. The dish
 * or category keeps the photo it has instead.
 */
function keepPhoto(req: BackendRequest): BackendRequest {
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) return req;
  const url = (body as { image_url?: unknown }).image_url;
  if (typeof url !== 'string' || !url.includes('/storage/v1/')) return req;
  const { image_url: _dropped, ...rest } = body as Record<string, unknown>;
  return { ...req, body: rest };
}

export class DemoBackend {
  private schema: Promise<SchemaCache> | null = null;

  constructor(readonly db: SqlDb) {}

  private schemaCache(): Promise<SchemaCache> {
    if (!this.schema) this.schema = loadSchemaCache(this.db);
    return this.schema;
  }

  /** Runs compiled SQL as the caller, the way PostgREST would, and shapes the answer. */
  async run(compiled: Compiled, who: Identity, headers: Record<string, string>): Promise<BackendResponse> {
    const forwarded = Object.fromEntries(FORWARDED_HEADERS.filter((h) => headers[h]).map((h) => [h, headers[h]]));
    const claims = who.sub ? JSON.stringify({ sub: who.sub, role: who.role, email: who.email }) : JSON.stringify({ role: who.role });
    const { rows } = await this.db.query<{ r: string | null }>(
      'SELECT demo.run($1::text, $2::text::jsonb, $3::text, $4::text, $5::text, $6::text) AS r',
      [compiled.sql, JSON.stringify(compiled.params), who.role, who.sub ?? '', claims, JSON.stringify(forwarded)],
    );
    const out = JSON.parse(rows[0]?.r ?? '{"b":null,"c":null}') as { b?: unknown; c?: number | null; error?: PgError };
    if (out.error) return json(out.error, statusForPgError(out.error.code, who.role === 'anon'));

    const responseHeaders: Record<string, string> = {};
    const count = typeof out.c === 'number' ? out.c : null;
    if (compiled.wantsCount && count !== null) {
      const shown = Array.isArray(out.b) ? out.b.length : 0;
      responseHeaders['content-range'] = `${shown ? `0-${shown - 1}` : '*'}/${count}`;
    }
    if (!compiled.returnBody || compiled.head) return empty(compiled.head ? 200 : compiled.successStatus, responseHeaders);

    let body = out.b;
    if (compiled.single && Array.isArray(body)) {
      if (body.length !== 1) {
        return json({
          code: 'PGRST116', message: 'Cannot coerce the result to a single JSON object',
          details: `The result contains ${body.length} rows`, hint: null,
        }, 406);
      }
      body = body[0];
    }
    return json(body ?? null, compiled.successStatus, responseHeaders);
  }

  /** An RPC as a given caller, from inside the backend (the edge-function stand-ins, the simulator). */
  async rpc<T = unknown>(name: string, args: Record<string, unknown>, who: Identity, headers: Record<string, string> = {}): Promise<{ data: T | null; error: PgError | null }> {
    const res = await this.handle({
      method: 'POST', path: `/rest/v1/rpc/${name}`, query: new URLSearchParams(), body: args,
      headers: { ...headers, 'x-demo-identity': JSON.stringify(who) },
    });
    const parsed = res.body ? JSON.parse(res.body) : null;
    return res.status >= 400 ? { data: null, error: parsed as PgError } : { data: parsed as T, error: null };
  }

  async handle(req: BackendRequest): Promise<BackendResponse> {
    try {
      if (req.method.toUpperCase() === 'OPTIONS') return empty(204);
      if (req.path.startsWith('/rest/v1')) {
        const who = req.headers['x-demo-identity']
          ? JSON.parse(req.headers['x-demo-identity']) as Identity
          : identityFromHeaders(req.headers);
        const schema = await this.schemaCache();
        const rest = req.path.replace(/^\/rest\/v1\/?/, '');
        if (rest === '') return json({});
        const compiled = rest.startsWith('rpc/')
          ? compileRpc(schema, decodeURIComponent(rest.slice(4)), req)
          : compileTable(schema, decodeURIComponent(rest), keepPhoto(req));
        return await this.run(compiled, who, req.headers);
      }
      if (req.path.startsWith('/auth/v1')) return await handleAuth(this.db, req);
      if (req.path.startsWith('/functions/v1')) return await handleFunction(this, req);
      if (req.path.startsWith('/storage/v1')) return json({ Key: 'demo', path: 'demo' });
      return json({ message: 'Not part of the demo backend' }, 404);
    } catch (error) {
      if (error instanceof RestError) return json(error.body, error.status);
      const message = error instanceof Error ? error.message : String(error);
      return json({ code: 'DEMO500', message, details: null, hint: null }, 500);
    }
  }
}
