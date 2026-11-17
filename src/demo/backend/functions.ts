/**
 * Stand-ins for the edge functions (supabase/functions) in the demo
 * (demo mode only): the same requests and the same answers, with the parts
 * that need a real outside service — Supabase Auth's admin API, the Monri
 * card gateway, WhatsApp, a translation model — played from the in-browser
 * database instead. Each handler names the function it stands in for; where
 * the real one calls a database function, so does this.
 */
import { identityFromHeaders, sessionPayload, userById, userByPassword } from './auth';
import type { DemoBackend } from './router';
import type { BackendRequest, BackendResponse, Identity, SqlDb } from './types';
import { json } from './types';

const WAITER_DOMAIN = '@staff.casademo.example';
const MIN_PASSWORD = 10;

interface RoleRow { user_id: string; role: string; venue_id: string | null }
interface VenueRow { id: string; slug: string; name: string }

const normalizeUsername = (value: unknown) => String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9_.-]/g, '');
const body = (req: BackendRequest) => (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;

async function rolesOf(db: SqlDb, userId: string): Promise<RoleRow[]> {
  const { rows } = await db.query<RoleRow>(`SELECT user_id, role::text AS role, venue_id FROM public.user_roles WHERE user_id = $1::text::uuid`, [userId]);
  return rows;
}

async function venues(db: SqlDb): Promise<VenueRow[]> {
  const { rows } = await db.query<VenueRow>(`SELECT id, slug, name FROM public.venues WHERE is_live ORDER BY created_at, slug`);
  return rows;
}

/** The restaurant an admin acts on: the one they named if they may, else their own. */
function targetVenue(roles: RoleRow[], named: unknown, all: VenueRow[]): VenueRow | null {
  const owner = roles.some((r) => r.role === 'admin' && r.venue_id === null);
  const asked = all.find((v) => v.slug === named || v.id === named) ?? null;
  if (owner) return asked ?? all[0] ?? null;
  const own = roles.filter((r) => r.role === 'admin' && r.venue_id).map((r) => r.venue_id);
  if (asked && own.includes(asked.id)) return asked;
  return all.find((v) => own.includes(v.id)) ?? null;
}

// ---------------------------------------------------------------- waiter-login

async function waiterLogin(db: SqlDb, req: BackendRequest): Promise<BackendResponse> {
  const invalid = () => json({ error: 'Invalid username or password' }, 401);
  const { username, password } = body(req);
  const name = normalizeUsername(username);
  if (!name || !password) return invalid();
  const { rows } = await db.query<{ id: string; user_id: string; is_active: boolean; email: string | null }>(
    `SELECT w.id, w.user_id, w.is_active, u.email FROM public.waiters w JOIN auth.users u ON u.id = w.user_id WHERE w.username = $1::text`, [name]);
  const waiter = rows[0];
  if (!waiter || !waiter.is_active || !waiter.email) return invalid();
  const user = await userByPassword(db, waiter.email, String(password));
  if (!user) return invalid();
  const session = sessionPayload(user);
  return json({
    ok: true,
    session: {
      access_token: session.access_token, refresh_token: session.refresh_token,
      expires_at: session.expires_at, expires_in: session.expires_in, token_type: session.token_type,
    },
    user: { id: user.id, email: user.email },
    waiter: { id: waiter.id },
  });
}

// ---------------------------------------------------------------- create-waiter / delete-waiter

async function createWaiter(backend: DemoBackend, req: BackendRequest, who: Identity): Promise<BackendResponse> {
  const { db } = backend;
  if (!who.sub) return json({ error: 'Unauthorized' }, 401);
  const roles = await rolesOf(db, who.sub);
  if (!roles.some((r) => r.role === 'admin')) return json({ error: 'Admin only' }, 403);
  const input = body(req);
  const password = String(input.password ?? '');

  if (input.action === 'reset_password') {
    if (password.length < MIN_PASSWORD) return json({ error: `The password needs at least ${MIN_PASSWORD} characters.`, code: 'weak_password' }, 400);
    const { rows } = await db.query<{ user_id: string }>(`SELECT user_id FROM public.waiters WHERE id = $1::text::uuid`, [String(input.waiter_id ?? '')]);
    if (!rows[0]) return json({ error: 'Waiter not found' }, 404);
    await db.query(`UPDATE auth.users SET demo_password = $2::text WHERE id = $1::text::uuid`, [rows[0].user_id, password]);
    return json({ ok: true, reset: true });
  }

  const venue = targetVenue(roles, input.venue ?? req.headers['x-venue'], await venues(db));
  if (!venue) return json({ error: 'Choose the restaurant' }, 400);
  const username = normalizeUsername(input.username);
  const displayName = String(input.display_name ?? '').trim();
  if (!username || username.length < 3 || !displayName) return json({ error: 'A name and a username of 3 or more characters are required' }, 400);
  if (password.length < MIN_PASSWORD) return json({ error: `The password needs at least ${MIN_PASSWORD} characters.`, code: 'weak_password' }, 400);
  const taken = await db.query(`SELECT 1 FROM public.waiters WHERE username = $1::text`, [username]);
  if (taken.rows.length) return json({ error: 'That username is taken. Pick another one.', code: 'username_taken' }, 400);

  const user = await db.query<{ id: string }>(
    `INSERT INTO auth.users(email, demo_password) VALUES ($1::text, $2::text) RETURNING id`, [`${username}${WAITER_DOMAIN}`, password]);
  const userId = user.rows[0].id;
  await db.query(`INSERT INTO public.user_roles(user_id, role, venue_id) VALUES ($1::text::uuid, 'staff', $2::text::uuid)`, [userId, venue.id]);
  const waiter = await db.query<Record<string, unknown>>(
    `INSERT INTO public.waiters(user_id, display_name, username, venue_id) VALUES ($1::text::uuid, $2::text, $3::text, $4::text::uuid)
     RETURNING id, user_id, display_name, username, is_active, has_pin, created_at, venue_id`,
    [userId, displayName, username, venue.id]);

  let pin = String(input.pin ?? '').replace(/\D/g, '');
  if (pin.length !== 4) pin = String(Math.floor(1000 + Math.random() * 9000));
  const set = await backend.rpc('admin_set_waiter_pin', { _waiter_id: waiter.rows[0].id, _pin: pin }, who, { 'x-venue': venue.slug });
  if (set.error) return json({ ok: true, waiter: waiter.rows[0], pin: null, warning: `Created but PIN not set: ${set.error.message}` });
  return json({ ok: true, waiter: waiter.rows[0], pin });
}

async function removeLogin(db: SqlDb, userId: string): Promise<void> {
  await db.query(`DELETE FROM public.user_roles WHERE user_id = $1::text::uuid`, [userId]);
  await db.query(`DELETE FROM auth.users WHERE id = $1::text::uuid`, [userId]);
}

async function deleteWaiter(db: SqlDb, req: BackendRequest, who: Identity): Promise<BackendResponse> {
  if (!who.sub) return json({ error: 'Unauthorized' }, 401);
  if (!(await rolesOf(db, who.sub)).some((r) => r.role === 'admin')) return json({ error: 'Admin only' }, 403);
  const waiterId = String(body(req).waiter_id ?? '');
  if (!waiterId) return json({ error: 'waiter_id required' }, 400);
  const { rows } = await db.query<{ user_id: string }>(`SELECT user_id FROM public.waiters WHERE id = $1::text::uuid`, [waiterId]);
  if (!rows[0]) return json({ error: 'Waiter not found' }, 404);
  if (!/^[0-9a-f-]{36}$/i.test(waiterId)) return json({ error: 'Waiter not found' }, 404);
  await db.query(`DELETE FROM public.section_assignments WHERE waiter_id = $1::text::uuid`, [waiterId]);
  // History keeps its orders and tables; they simply no longer name the waiter.
  // One statement batch, so the guards on old orders are off for this change
  // alone and not for whatever another tab does meanwhile. (The id was checked above.)
  await db.exec(`
    BEGIN;
    SET LOCAL session_replication_role = replica;
    UPDATE public.table_sessions SET assigned_waiter_id = NULL WHERE assigned_waiter_id = '${waiterId}';
    UPDATE public.orders SET assigned_waiter_id = NULL WHERE assigned_waiter_id = '${waiterId}';
    UPDATE public.server_ratings SET waiter_id = NULL WHERE waiter_id = '${waiterId}';
    COMMIT;`);
  await db.query(`DELETE FROM public.waiters WHERE id = $1::text::uuid`, [waiterId]);
  await removeLogin(db, rows[0].user_id);
  return json({ ok: true, login_removed: true });
}

// ---------------------------------------------------------------- manage-admins

async function manageAdmins(db: SqlDb, req: BackendRequest, who: Identity): Promise<BackendResponse> {
  if (!who.sub) return json({ error: 'Unauthorized' }, 401);
  const mine = await rolesOf(db, who.sub);
  if (!mine.some((r) => r.role === 'admin' && r.venue_id === null)) return json({ error: 'Only the owner manages restaurant admins' }, 403);
  const input = body(req);
  const all = await venues(db);

  if (input.action === 'list') {
    const roles = (await db.query<RoleRow>(`SELECT user_id, role::text AS role, venue_id FROM public.user_roles`)).rows;
    const users = (await db.query<{ id: string; email: string | null }>(`SELECT id, email FROM auth.users`)).rows;
    const waiters = (await db.query<{ user_id: string; username: string | null; display_name: string }>(`SELECT user_id, username, display_name FROM public.waiters`)).rows;
    const emailOf = new Map(users.map((u) => [u.id, u.email]));
    const waiterOf = new Map(waiters.map((w) => [w.user_id, w]));
    const slugOf = new Map(all.map((v) => [v.id, v.slug]));
    // Shown as "last signed in": the demo's accounts are in use today.
    const lately = (hoursAgo: number) => new Date(Date.now() - hoursAgo * 3600_000).toISOString();
    const accounts = roles
      // The schema's spare second restaurant is not part of the demo.
      .filter((r) => r.venue_id === null || slugOf.has(r.venue_id))
      .map((r, i) => {
        const waiter = waiterOf.get(r.user_id);
        const kind = r.role === 'admin' ? (r.venue_id === null ? 'owner' : 'admin') : waiter ? 'waiter' : 'kitchen';
        return {
          user_id: r.user_id,
          email: kind === 'waiter' ? null : emailOf.get(r.user_id) ?? null,
          username: kind === 'waiter' ? waiter?.username ?? null : null,
          display_name: kind === 'waiter' ? waiter?.display_name ?? null : null,
          kind,
          venue: r.venue_id ? slugOf.get(r.venue_id) ?? null : null,
          you: r.user_id === who.sub,
          last_sign_in_at: lately(r.user_id === who.sub ? 0.1 : 1 + i * 2.5),
        };
      });
    return json({ venues: all.map(({ slug, name }) => ({ slug, name })), accounts });
  }

  if (input.action === 'appoint') {
    const email = String(input.email ?? '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: 'Type the email address they will sign in with' }, 400);
    const named = Array.isArray(input.venues) ? input.venues : [input.venue];
    const picked = named.map((slug) => all.find((v) => v.slug === slug)).filter((v): v is VenueRow => !!v);
    if (!picked.length) return json({ error: 'Choose the restaurant' }, 400);
    const existing = await db.query<{ id: string }>(`SELECT id FROM auth.users WHERE lower(email) = $1::text`, [email]);
    let userId = existing.rows[0]?.id;
    const created = !userId;
    if (!userId) {
      const password = String(input.password ?? '');
      if (password.length < MIN_PASSWORD) return json({ error: `The initial password needs at least ${MIN_PASSWORD} characters`, code: 'needs_password' }, 400);
      userId = (await db.query<{ id: string }>(`INSERT INTO auth.users(email, demo_password) VALUES ($1::text, $2::text) RETURNING id`, [email, password])).rows[0].id;
    }
    const has = await rolesOf(db, userId);
    if (has.some((r) => r.role === 'admin' && r.venue_id === null)) return json({ error: `${email} is the owner, who already runs every restaurant` }, 409);
    const add = picked.filter((v) => !has.some((r) => r.role === 'admin' && r.venue_id === v.id));
    if (!add.length) return json({ ok: true, created: false, already: true });
    for (const venue of add) {
      await db.query(`INSERT INTO public.user_roles(user_id, role, venue_id) VALUES ($1::text::uuid, 'admin', $2::text::uuid)`, [userId, venue.id]);
    }
    return json({ ok: true, created });
  }

  if (input.action === 'revoke') {
    const venue = all.find((v) => v.slug === input.venue);
    if (!input.user_id || !venue) return json({ error: 'Which admin, at which restaurant?' }, 400);
    const gone = await db.query(
      `DELETE FROM public.user_roles WHERE user_id = $1::text::uuid AND role = 'admin' AND venue_id = $2::text::uuid RETURNING id`, [String(input.user_id), venue.id]);
    if (!gone.rows.length) return json({ error: `Not an admin of ${venue.name}` }, 404);
    return json({ ok: true });
  }

  if (input.action === 'reset_password') {
    const userId = String(input.user_id ?? '');
    if (!userId) return json({ error: 'Whose password?' }, 400);
    if (userId === who.sub) return json({ error: 'Change your own password in the admin menu → Change password' }, 403);
    const password = String(input.password ?? '');
    if (password.length < MIN_PASSWORD) return json({ error: `The new password needs at least ${MIN_PASSWORD} characters`, code: 'weak_password' }, 400);
    await db.query(`UPDATE auth.users SET demo_password = $2::text WHERE id = $1::text::uuid`, [userId, password]);
    return json({ ok: true, reset: true });
  }

  if (input.action === 'remove') {
    const userId = String(input.user_id ?? '');
    if (!userId) return json({ error: 'Whose account?' }, 400);
    if (userId === who.sub) return json({ error: 'You cannot remove your own account' }, 403);
    if (!(await userById(db, userId))) return json({ error: 'No such account: it may already be removed' }, 404);
    const waiter = await db.query<{ id: string }>(`SELECT id FROM public.waiters WHERE user_id = $1::text::uuid`, [userId]);
    if (waiter.rows[0]) {
      return deleteWaiter(db, { ...req, body: { waiter_id: waiter.rows[0].id } }, who).then((res) => (res.status === 200 ? json({ ok: true, removed: true }) : res));
    }
    await removeLogin(db, userId);
    return json({ ok: true, removed: true });
  }

  return json({ error: 'Unknown action' }, 400);
}

// ---------------------------------------------------------------- monri-create-payment (and the demo's card result)

/** What the fake card form sends when the guest taps Pay: `demo:<monri order number>`. */
export const demoClientSecret = (orderNumber: string) => `demo:${orderNumber}`;

async function monriCreatePayment(db: SqlDb, req: BackendRequest): Promise<BackendResponse> {
  // GET: is the card gateway connected? In the demo, a simulated one always is.
  if (req.method.toUpperCase() === 'GET') return json({ configured: true, environment: 'test', currency: 'BAM' });
  const input = body(req);
  const { rows } = await db.query<{ r: Record<string, unknown> }>(
    `SELECT public.monri_register_attempt($1::text::uuid, $2::text::uuid, $3::text, 'BAM', 'purchase') AS r`,
    [String(input.order_id ?? ''), String(input.session_id ?? ''), String(input.session_token ?? '')],
  );
  const attempt = rows[0]?.r ?? {};
  if (attempt.status === 'card_disabled') return json({ error: 'card_unavailable', reason: 'disabled' }, 503);
  if (attempt.status !== 'ok') return json({ error: String(attempt.status ?? 'payment_start_failed') }, 400);
  const orderNumber = String(attempt.monri_order_number);
  await db.query(`UPDATE public.payment_transactions SET status = 'pending', updated_at = now() WHERE id = $1::text::uuid AND status = 'created'`, [String(attempt.payment_transaction_id)]);
  return json({
    ok: true,
    payment_transaction_id: attempt.payment_transaction_id,
    monri_order_number: orderNumber,
    monri_payment_id: `demo-${orderNumber}`,
    client_secret: demoClientSecret(orderNumber),
    authenticity_token: 'demo-authenticity-token',
    environment: 'test',
  });
}

/**
 * The gateway's answer, which in production arrives as a signed webhook
 * (monri-webhook). Here the demo's card form reports it, and the same
 * database function applies it: checks the amount, marks the order paid and
 * releases it to the kitchen.
 */
async function demoCardResult(db: SqlDb, req: BackendRequest): Promise<BackendResponse> {
  const input = body(req);
  const orderNumber = String(input.client_secret ?? '').replace(/^demo:/, '');
  const approved = input.approved !== false;
  const { rows: tx } = await db.query<{ amount_minor: number; currency: string }>(
    `SELECT amount_minor, currency FROM public.payment_transactions WHERE monri_order_number = $1::text`, [orderNumber]);
  if (!tx[0]) return json({ error: 'unknown_transaction' }, 404);
  const { rows } = await db.query<{ r: Record<string, unknown> }>(
    `SELECT public.monri_apply_callback($1::text, $2::text, $3::text, $4::text, $5::int, $6::text, $7::text::jsonb) AS r`,
    [
      `demo-${orderNumber}-${approved ? 'approved' : 'declined'}-${Date.now()}`, orderNumber, `demo-${orderNumber}`,
      approved ? 'approved' : 'declined', tx[0].amount_minor, tx[0].currency,
      JSON.stringify({ source: 'tableflow-demo', masked_pan: '424242******4242', response_code: approved ? '0000' : '1051' }),
    ],
  );
  return json({ ok: true, ...(rows[0]?.r ?? {}) });
}

// ---------------------------------------------------------------- the front door

export async function handleFunction(backend: DemoBackend, req: BackendRequest): Promise<BackendResponse> {
  const name = req.path.replace(/^\/functions\/v1\//, '').split('/')[0];
  const who = identityFromHeaders(req.headers);
  const { db } = backend;
  switch (name) {
    case 'waiter-login': return waiterLogin(db, req);
    case 'create-waiter': return createWaiter(backend, req, who);
    case 'delete-waiter': return deleteWaiter(db, req, who);
    case 'manage-admins': return manageAdmins(db, req, who);
    case 'monri-create-payment': return monriCreatePayment(db, req);
    case 'demo-card-result': return demoCardResult(db, req);
    // Lock-screen alerts need a push service; the demo has none, and says so the way an unconfigured server does.
    case 'notify-staff': return json(req.method.toUpperCase() === 'GET' ? { configured: false } : { ok: true, sent: 0 });
    // WhatsApp confirmations need a WhatsApp Business account: reported as not connected.
    case 'reservation-messages': return json({ configured: false, number: false, ready: false, templates: [] });
    // Every dish in the demo already has its three languages.
    case 'translate-menu': return json({ ok: true, message: 'Every name and description is already translated.' });
    case 'migrate-images': return json({ migrated: 0, skipped: 0, failed: 0 });
    default: return json({ error: `The ${name} function is not part of the demo` }, 404);
  }
}
