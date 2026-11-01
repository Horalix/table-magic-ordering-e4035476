import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { managesVenue, mayResetLogin, namedVenue, resolveAdminVenue, type RoleRow, type VenueRow } from "../_shared/venue-access.ts";

/**
 * create-waiter — Admin → Waiters (src/pages/admin/AdminWaiters.tsx).
 *
 * An admin (a restaurant's, or the owner) calls it. Body `{ action?, … }`:
 *
 *   (no action)      add a waiter or kitchen tablet: a sign-in with the
 *                    username's synthetic email, a staff role and a waiters
 *                    row at the restaurant, and a Floor PIN.
 *   reset_password   { waiter_id, password } — a waiter who forgot theirs
 *                    gets a new one. Only from an admin of every restaurant
 *                    that sign-in works at, and never for an account that
 *                    manages one (mayResetLogin).
 *
 * Passwords need MIN_PASSWORD characters, the live project's Supabase Auth
 * minimum (set 31 October 2026); when Auth refuses one anyway, its own words
 * go back with code `weak_password`. A password is passed to Auth and
 * nowhere else: never logged, stored or sent back.
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-venue',
};

interface Body {
  action?: 'reset_password';
  username?: string;
  password?: string;
  display_name?: string;
  pin?: string;
  /** The restaurant (slug) the owner is adding them to; a restaurant admin always adds to their own. */
  venue?: string;
  /** reset_password: whose. */
  waiter_id?: string;
}

const MIN_PASSWORD = 10;

const synthEmail = (u: string) => `${u}@waiter.lasoul.local`;
const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'Server error';
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

/** Auth's refusal, in Auth's words, tagged so the form can say it next to the right field. */
function authRefusal(error: { message?: string; code?: string } | null, fallback: string) {
  const message = error?.message || fallback;
  if (error?.code === 'weak_password' || /password/i.test(message)) {
    return reply({ error: `Supabase Auth refused the password: ${message}`, code: 'weak_password' }, 400);
  }
  if (error?.code === 'email_exists' || /already (been )?registered/i.test(message)) {
    return reply({ error: 'An older sign-in already uses that username. Pick another one.', code: 'username_taken' }, 400);
  }
  return reply({ error: message }, 400);
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
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { data: roles } = await admin.from('user_roles').select('role, venue_id').eq('user_id', userData.user.id);
    const callerRoles = (roles as RoleRow[] | null) ?? [];
    if (!callerRoles.some((r) => r.role === 'admin')) return reply({ error: 'Admin only' }, 403);

    const body: Body = await req.json();
    const password = body.password || '';

    if (body.action === 'reset_password') {
      if (!body.waiter_id) return reply({ error: 'Which waiter?' }, 400);
      const { data: waiter } = await admin.from('waiters').select('user_id, venue_id, username').eq('id', body.waiter_id).maybeSingle();
      // The other restaurant's waiters are "not found" to a restaurant's admin, as in delete-waiter.
      if (!waiter || !managesVenue(callerRoles, waiter.venue_id)) return reply({ error: 'Waiter not found' }, 404);
      if (!waiter.user_id) return reply({ error: 'This waiter has no sign-in to reset. Remove them and add them again.' }, 400);
      const { data: theirs, error: tErr } = await admin.from('user_roles').select('role, venue_id').eq('user_id', waiter.user_id);
      if (!mayResetLogin(callerRoles, tErr ? null : (theirs as RoleRow[] | null) ?? [], { userId: waiter.user_id, callerId: userData.user.id })) {
        return reply({ error: 'This sign-in also manages a restaurant or works at one you do not run. Its own admin, or the owner, changes it.' }, 403);
      }
      if (password.length < MIN_PASSWORD) {
        return reply({ error: `The password needs at least ${MIN_PASSWORD} characters.`, code: 'weak_password' }, 400);
      }
      const { error: updErr } = await admin.auth.admin.updateUserById(waiter.user_id, { password });
      if (updErr) return authRefusal(updErr, 'Could not change the password');
      return reply({ ok: true, reset: true, username: waiter.username });
    }

    // Which restaurant the waiter works at: the owner (an admin of no one
    // restaurant) names it, and naming none is refused rather than read as
    // La Soul; a restaurant admin can only add to their own.
    const { data: venueRows } = await admin.from('venues').select('id, slug');
    const target = resolveAdminVenue(callerRoles, namedVenue(body, req), (venueRows as VenueRow[] | null) ?? []);
    if (!target.ok) return reply({ error: target.error }, target.status);
    const venueId = target.venueId;
    const username = (body.username || '').trim().toLowerCase().replace(/[^a-z0-9_.-]/g, '');
    const display_name = (body.display_name || '').trim();

    if (!username || username.length < 3 || !display_name) {
      return reply({ error: 'A name and a username of 3 or more characters are required' }, 400);
    }
    if (password.length < MIN_PASSWORD) {
      return reply({ error: `The password needs at least ${MIN_PASSWORD} characters.`, code: 'weak_password' }, 400);
    }

    // Usernames are shared by both restaurants: one sign-in address each.
    const { data: existing } = await admin.from('waiters').select('id').eq('username', username).maybeSingle();
    if (existing) {
      return reply({ error: 'That username is taken (both restaurants share usernames). Pick another one.', code: 'username_taken' }, 400);
    }

    const email = synthEmail(username);
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (createErr || !created.user) return authRefusal(createErr, 'Create failed');

    const userId = created.user.id;
    // A sign-in with no role or no waiter row can do nothing and keeps the
    // username taken for good; take it away again (its roles go with it).
    const undo = () => admin.auth.admin.deleteUser(userId).catch(() => undefined);

    const { error: roleErr } = await admin.from('user_roles').insert({ user_id: userId, role: 'staff', venue_id: venueId });
    if (roleErr) {
      await undo();
      return reply({ error: roleErr.message }, 400);
    }

    const { data: waiter, error: wErr } = await admin
      .from('waiters')
      .insert({ user_id: userId, display_name, username, venue_id: venueId })
      .select()
      .single();
    if (wErr) {
      await undo();
      return reply({ error: wErr.message }, 400);
    }

    // Set PIN (provided or auto-generated). Use the admin's JWT so the RPC's auth check passes.
    let pin = (body.pin || '').replace(/\D/g, '');
    if (pin && pin.length !== 4) pin = '';
    if (!pin) pin = String(Math.floor(1000 + Math.random() * 9000));
    const { error: pinErr } = await userClient.rpc('admin_set_waiter_pin', { _waiter_id: waiter.id, _pin: pin });
    if (pinErr) {
      return reply({ ok: true, waiter, pin: null, warning: `Created but PIN not set: ${pinErr.message}` });
    }

    return reply({ ok: true, waiter, pin });
  } catch (e: unknown) {
    return reply({ error: errorMessage(e) }, 500);
  }
});
