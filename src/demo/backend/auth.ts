/**
 * Sign-in for the demo (demo mode only, src/demo): the handful of /auth/v1
 * calls supabase-js makes, answered from `auth.users` in the in-browser
 * database. Tokens are shaped like JWTs because the client and the app read
 * their claims, but nothing verifies them: there is no server to protect.
 */
import type { BackendRequest, BackendResponse, Identity, SqlDb } from './types';
import { json } from './types';

/** Ten years: a demo session never needs refreshing. */
const LIFETIME_SECONDS = 10 * 365 * 24 * 60 * 60;

export interface UserRow {
  id: string;
  email: string | null;
  created_at: string | Date;
  raw_user_meta_data: Record<string, unknown> | null;
}

const b64url = (text: string) => {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  bytes.forEach((b) => { binary += String.fromCharCode(b); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const fromB64url = (part: string) => {
  const padded = part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=');
  const binary = atob(padded);
  return new TextDecoder().decode(Uint8Array.from(binary, (ch) => ch.charCodeAt(0)));
};

export function mintAccessToken(userId: string, email: string | null, nowSeconds = Math.floor(Date.now() / 1000)): string {
  const header = b64url(JSON.stringify({ alg: 'none', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({
    sub: userId, email, role: 'authenticated', aud: 'authenticated',
    iat: nowSeconds, exp: nowSeconds + LIFETIME_SECONDS, iss: 'tableflow-demo',
  }));
  return `${header}.${payload}.demo`;
}

/** Who a request's bearer token says it is from; anyone else is a guest. */
export function identityFromHeaders(headers: Record<string, string>): Identity {
  const token = (headers.authorization ?? '').replace(/^Bearer\s+/i, '');
  try {
    const claims = JSON.parse(fromB64url(token.split('.')[1] ?? '')) as { sub?: unknown; email?: unknown; role?: unknown };
    if (typeof claims.sub === 'string' && claims.sub && claims.role === 'authenticated') {
      return { role: 'authenticated', sub: claims.sub, email: typeof claims.email === 'string' ? claims.email : null };
    }
  } catch {
    // Not a token of ours (the publishable key, nothing at all): a guest.
  }
  return { role: 'anon', sub: null, email: null };
}

export function userPayload(row: UserRow) {
  const created = new Date(row.created_at).toISOString();
  return {
    id: row.id,
    aud: 'authenticated',
    role: 'authenticated',
    email: row.email,
    email_confirmed_at: created,
    confirmed_at: created,
    last_sign_in_at: created,
    phone: '',
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: row.raw_user_meta_data ?? {},
    identities: [],
    created_at: created,
    updated_at: created,
    is_anonymous: false,
  };
}

/** What supabase-js stores as "the session": the token response. */
export function sessionPayload(row: UserRow) {
  const now = Math.floor(Date.now() / 1000);
  return {
    access_token: mintAccessToken(row.id, row.email, now),
    token_type: 'bearer',
    expires_in: LIFETIME_SECONDS,
    expires_at: now + LIFETIME_SECONDS,
    refresh_token: `demo-refresh.${row.id}`,
    user: userPayload(row),
  };
}

const USER_COLUMNS = 'id, email, created_at, raw_user_meta_data';

export async function userById(db: SqlDb, id: string): Promise<UserRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { rows } = await db.query<UserRow>(`SELECT ${USER_COLUMNS} FROM auth.users WHERE id = $1::text::uuid`, [id]);
  return rows[0] ?? null;
}

export async function userByPassword(db: SqlDb, email: string, password: string): Promise<UserRow | null> {
  const { rows } = await db.query<UserRow>(
    `SELECT ${USER_COLUMNS} FROM auth.users WHERE lower(email) = lower($1::text) AND demo_password = $2::text`, [email, password]);
  return rows[0] ?? null;
}

const refused = (message: string, status = 400, code = 'invalid_credentials') =>
  json({ code: status, error_code: code, msg: message, message, error: code, error_description: message }, status);

export async function handleAuth(db: SqlDb, req: BackendRequest): Promise<BackendResponse> {
  const route = req.path.replace(/^\/auth\/v1/, '');
  const method = req.method.toUpperCase();
  const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;

  if (route === '/token' && method === 'POST') {
    const grant = req.query.get('grant_type');
    if (grant === 'password') {
      const user = await userByPassword(db, String(body.email ?? ''), String(body.password ?? ''));
      return user ? json(sessionPayload(user)) : refused('Invalid login credentials');
    }
    if (grant === 'refresh_token') {
      const user = await userById(db, String(body.refresh_token ?? '').replace(/^demo-refresh\./, ''));
      return user ? json(sessionPayload(user)) : refused('Invalid Refresh Token: Refresh Token Not Found', 400, 'refresh_token_not_found');
    }
    return refused('unsupported_grant_type', 400, 'invalid_request');
  }

  if (route === '/user') {
    const who = identityFromHeaders(req.headers);
    const user = who.sub ? await userById(db, who.sub) : null;
    if (!user) return refused('Auth session missing!', 401, 'session_not_found');
    if (method === 'PUT') {
      if (typeof body.password === 'string' && body.password.length < 6) {
        return refused('Password should be at least 6 characters.', 422, 'weak_password');
      }
      if (typeof body.password === 'string') {
        await db.query('UPDATE auth.users SET demo_password = $2::text WHERE id = $1::text::uuid', [user.id, body.password]);
      }
    }
    return json(userPayload(user));
  }

  if (route === '/logout') return { status: 204, headers: {}, body: null };

  return refused('This sign-in feature is not part of the demo', 404, 'not_found');
}
