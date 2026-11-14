/**
 * The demo backend's shapes (demo mode only, src/demo).
 *
 * The backend is the app's real database — every migration in
 * supabase/migrations applied to a PostgreSQL that runs in the browser
 * (PGlite) — behind a small stand-in for the three Supabase services the app
 * talks to over HTTP: PostgREST (/rest/v1), sign-in (/auth/v1) and the edge
 * functions (/functions/v1).
 */

/** The little of PGlite the backend needs; satisfied by PGlite, PGliteWorker and the test harness. */
export interface SqlDb {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[]; affectedRows?: number }>;
  exec(sql: string): Promise<unknown>;
}

/** An HTTP request the app made to its Supabase address. */
export interface BackendRequest {
  method: string;
  /** Path after the origin, e.g. /rest/v1/orders. */
  path: string;
  query: URLSearchParams;
  /** Lower-cased names. */
  headers: Record<string, string>;
  /** Parsed JSON, or null when there was no body. */
  body: unknown;
  /** The page's path when it asked: demo sign-in is per area of the app (src/demo/session.ts). */
  pagePath?: string;
}

export interface BackendResponse {
  status: number;
  headers: Record<string, string>;
  /** JSON text, or null for an empty body. */
  body: string | null;
}

/** Who a request is from. */
export interface Identity {
  role: 'anon' | 'authenticated';
  sub: string | null;
  email: string | null;
}

export interface PgError {
  code: string;
  message: string;
  details: string | null;
  hint: string | null;
}

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}): BackendResponse => ({
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  body: JSON.stringify(body),
});

export const empty = (status = 204, headers: Record<string, string> = {}): BackendResponse => ({ status, headers, body: null });
