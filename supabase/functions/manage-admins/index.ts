import { createClient, type SupabaseClient, type User } from "https://esm.sh/@supabase/supabase-js@2.45.0";

/**
 * manage-admins — the owner's Team page (src/pages/admin/AdminTeam.tsx).
 *
 * The owner (an admin of no one restaurant, docs/two-restaurants.md) is the
 * only one who may call it; everyone else gets 403, a restaurant's own admin
 * included. Body `{ action, … }`:
 *
 *   list                        every owner, restaurant admin, waiter and
 *                               kitchen account, with its restaurant.
 *   appoint { email, venue,     make the account with that email the admin
 *             password? }       of that restaurant (slug). An existing account
 *                               only gets the role. A new one is created with
 *                               the initial password the owner typed — 10+
 *                               characters, confirmed, so it signs in at once
 *                               — which the new admin changes after signing
 *                               in. The password goes to Supabase Auth and
 *                               nowhere else: never logged, never stored,
 *                               never sent back.
 *   revoke { user_id, venue }   remove that restaurant's admin role from that
 *                               account, and nothing else: its other roles and
 *                               the account itself stay. An owner is never a
 *                               restaurant's admin (one admin role per account,
 *                               user_roles), so no owner — the caller or the
 *                               last one — can be removed through here.
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type Action = 'list' | 'appoint' | 'revoke';

interface Body {
  action?: Action;
  email?: string;
  venue?: string;
  password?: string;
  user_id?: string;
}

interface RoleRow {
  user_id: string;
  role: string;
  venue_id: string | null;
}

interface VenueRow {
  id: string;
  slug: string;
  name: string;
}

interface WaiterRow {
  user_id: string | null;
  username: string | null;
  display_name: string;
}

/** What the Team page shows: one row per role an account holds. */
interface Account {
  user_id: string;
  /** Null for a waiter, who signs in with a username. */
  email: string | null;
  username: string | null;
  display_name: string | null;
  kind: 'owner' | 'admin' | 'waiter' | 'kitchen';
  /** The restaurant's slug; null for the owner, who has every one. */
  venue: string | null;
  you: boolean;
}

const MIN_PASSWORD = 10;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** create-waiter's sign-in addresses: a waiter is not appointed by email. */
const WAITER_DOMAIN = '@waiter.lasoul.local';

const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'Server error';

/** Every account in Supabase Auth, a page at a time. */
async function allUsers(admin: SupabaseClient): Promise<User[]> {
  const users: User[] = [];
  for (let page = 1; page <= 50; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    users.push(...data.users);
    if (data.users.length < 1000) break;
  }
  return users;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;

    const authHeader = req.headers.get('Authorization') || '';
    const token = authHeader.replace('Bearer ', '');

    const userClient = createClient(SUPABASE_URL, ANON, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: uErr } = await userClient.auth.getUser(token);
    if (uErr || !userData.user) return reply({ error: 'Unauthorized' }, 401);
    const me = userData.user;

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
    const { data: myRoles } = await admin.from('user_roles').select('role, venue_id').eq('user_id', me.id);
    const owner = ((myRoles as Omit<RoleRow, 'user_id'>[] | null) ?? []).some((r) => r.role === 'admin' && r.venue_id === null);
    if (!owner) return reply({ error: 'Only the owner manages restaurant admins' }, 403);

    const body: Body = await req.json().catch(() => ({}));
    const { data: venueRows, error: vErr } = await admin.from('venues').select('id, slug, name').order('created_at');
    if (vErr) return reply({ error: vErr.message }, 500);
    const venues = (venueRows as VenueRow[] | null) ?? [];
    const venueBySlug = (slug: string | undefined) => venues.find((v) => v.slug === slug) ?? null;

    if (body.action === 'list') {
      const [{ data: roleRows, error: rErr }, { data: waiterRows }, users] = await Promise.all([
        admin.from('user_roles').select('user_id, role, venue_id'),
        admin.from('waiters').select('user_id, username, display_name'),
        allUsers(admin),
      ]);
      if (rErr) return reply({ error: rErr.message }, 500);
      const emails = new Map(users.map((u) => [u.id, u.email ?? null]));
      const waiters = new Map(((waiterRows as WaiterRow[] | null) ?? []).filter((w) => w.user_id).map((w) => [w.user_id as string, w]));
      const slugOf = new Map(venues.map((v) => [v.id, v.slug]));

      const accounts: Account[] = ((roleRows as RoleRow[] | null) ?? []).map((r) => {
        const waiter = waiters.get(r.user_id);
        const kind: Account['kind'] = r.role === 'admin'
          ? (r.venue_id === null ? 'owner' : 'admin')
          // Staff with a waiter's row sign in on the floor; without one, it is a kitchen screen's account.
          : waiter ? 'waiter' : 'kitchen';
        return {
          user_id: r.user_id,
          email: kind === 'waiter' ? null : emails.get(r.user_id) ?? null,
          username: kind === 'waiter' ? waiter?.username ?? null : null,
          display_name: kind === 'waiter' ? waiter?.display_name ?? null : null,
          kind,
          venue: r.venue_id ? slugOf.get(r.venue_id) ?? null : null,
          you: r.user_id === me.id,
        };
      });
      return reply({ venues: venues.map(({ slug, name }) => ({ slug, name })), accounts });
    }

    if (body.action === 'appoint') {
      const email = (body.email ?? '').trim().toLowerCase();
      const venue = venueBySlug(body.venue);
      if (!EMAIL.test(email)) return reply({ error: 'Type the email address they will sign in with' }, 400);
      if (email.endsWith(WAITER_DOMAIN)) return reply({ error: 'That is a waiter\'s sign-in. Appoint an admin by their own email address' }, 400);
      if (!venue) return reply({ error: 'Choose the restaurant' }, 400);

      const existing = (await allUsers(admin)).find((u) => (u.email ?? '').toLowerCase() === email);

      if (existing) {
        const { data: theirs } = await admin.from('user_roles').select('role, venue_id').eq('user_id', existing.id);
        const adminRole = ((theirs as Omit<RoleRow, 'user_id'>[] | null) ?? []).find((r) => r.role === 'admin');
        if (adminRole?.venue_id === null) {
          return reply({ error: `${email} is the owner, who already runs every restaurant` }, 409);
        }
        if (adminRole?.venue_id === venue.id) return reply({ ok: true, created: false, already: true });
        if (adminRole) {
          const other = venues.find((v) => v.id === adminRole.venue_id)?.name ?? 'another restaurant';
          // One admin role per account (user_roles is unique on user and role).
          return reply({ error: `${email} is already the admin of ${other}. Revoke that first, or appoint another address` }, 409);
        }
        const { error: insErr } = await admin.from('user_roles').insert({ user_id: existing.id, role: 'admin', venue_id: venue.id });
        if (insErr) return reply({ error: insErr.message }, 400);
        return reply({ ok: true, created: false });
      }

      const password = typeof body.password === 'string' ? body.password : '';
      if (!password) {
        return reply({
          error: `No account uses ${email} yet. Type an initial password (${MIN_PASSWORD}+ characters) to create it`,
          code: 'needs_password',
        }, 400);
      }
      if (password.length < MIN_PASSWORD) {
        return reply({ error: `The initial password needs at least ${MIN_PASSWORD} characters`, code: 'needs_password' }, 400);
      }

      // Confirmed now: nothing is emailed, and the owner hands the password over in person.
      const { data: created, error: createErr } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
      if (createErr || !created.user) return reply({ error: createErr?.message || 'Could not create the account' }, 400);

      const { error: roleErr } = await admin.from('user_roles').insert({ user_id: created.user.id, role: 'admin', venue_id: venue.id });
      if (roleErr) {
        // An account with no role can sign in to nothing; do not leave one behind.
        await admin.auth.admin.deleteUser(created.user.id).catch(() => undefined);
        return reply({ error: roleErr.message }, 400);
      }
      return reply({ ok: true, created: true });
    }

    if (body.action === 'revoke') {
      const venue = venueBySlug(body.venue);
      if (!body.user_id || !venue) return reply({ error: 'Which admin, at which restaurant?' }, 400);
      // Only that restaurant's admin row: an owner's has no restaurant, so it never matches.
      const { data: removed, error: delErr } = await admin
        .from('user_roles')
        .delete()
        .eq('user_id', body.user_id)
        .eq('role', 'admin')
        .eq('venue_id', venue.id)
        .select('id');
      if (delErr) return reply({ error: delErr.message }, 400);
      if (!removed?.length) return reply({ error: `Not an admin of ${venue.name}` }, 404);
      return reply({ ok: true });
    }

    return reply({ error: 'Unknown action' }, 400);
  } catch (e: unknown) {
    return reply({ error: errorMessage(e) }, 500);
  }
});
