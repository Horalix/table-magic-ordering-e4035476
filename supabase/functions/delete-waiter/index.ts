import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { managesVenue, mayRemoveLogin, type RoleRow } from "../_shared/venue-access.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-venue',
};

const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'Server error';

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
    if (uErr || !userData.user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { data: roles } = await admin.from('user_roles').select('role, venue_id').eq('user_id', userData.user.id);
    const callerRoles = (roles as RoleRow[] | null) ?? [];
    if (!callerRoles.some((r) => r.role === 'admin')) {
      return new Response(JSON.stringify({ error: 'Admin only' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const { waiter_id } = await req.json();
    if (!waiter_id) {
      return new Response(JSON.stringify({ error: 'waiter_id required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const { data: waiter } = await admin.from('waiters').select('user_id, venue_id').eq('id', waiter_id).maybeSingle();
    // The owner removes anyone; a restaurant admin only their own restaurant's
    // waiters — the other restaurant's are "not found" to them.
    const mayRemove = waiter && managesVenue(callerRoles, waiter.venue_id);
    if (!waiter || !mayRemove) {
      return new Response(JSON.stringify({ error: 'Waiter not found' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Detach references so we can delete the waiter row
    await admin.from('section_assignments').delete().eq('waiter_id', waiter_id);
    await admin.from('table_sessions').update({ assigned_waiter_id: null }).eq('assigned_waiter_id', waiter_id);
    await admin.from('orders').update({ assigned_waiter_id: null }).eq('assigned_waiter_id', waiter_id);

    await admin.from('waiters').delete().eq('id', waiter_id);
    let loginRemoved = false;
    if (waiter.user_id) {
      // Only their place at this restaurant. The same account may wait tables
      // at the other restaurant, or manage one: those roles are not this
      // admin's to take away.
      await admin.from('user_roles').delete()
        .eq('user_id', waiter.user_id).eq('venue_id', waiter.venue_id).eq('role', 'staff');

      // The sign-in goes only with the last of its roles and waiter rows, and
      // never the caller's own.
      const [{ count: rolesLeft, error: rolesErr }, { count: waitersLeft, error: waitersErr }] = await Promise.all([
        admin.from('user_roles').select('id', { count: 'exact', head: true }).eq('user_id', waiter.user_id),
        admin.from('waiters').select('id', { count: 'exact', head: true }).eq('user_id', waiter.user_id),
      ]);
      loginRemoved = mayRemoveLogin({
        roles: rolesErr ? null : rolesLeft,
        waiters: waitersErr ? null : waitersLeft,
        userId: waiter.user_id,
        callerId: userData.user.id,
      });
      if (loginRemoved) {
        // Best effort: the waiter is already gone from this restaurant.
        try {
          await admin.auth.admin.deleteUser(waiter.user_id);
        } catch (error) {
          console.warn('Failed to delete waiter auth user', error);
        }
      }
    }

    return new Response(JSON.stringify({ ok: true, login_removed: loginRemoved }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e: unknown) {
    return new Response(JSON.stringify({ error: errorMessage(e) }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
