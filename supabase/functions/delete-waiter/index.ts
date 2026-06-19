import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface RoleRow {
  role: string;
}

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
    const { data: roles } = await admin.from('user_roles').select('role').eq('user_id', userData.user.id);
    const isAdmin = (roles as RoleRow[] | null)?.some((r) => r.role === 'admin');
    if (!isAdmin) {
      return new Response(JSON.stringify({ error: 'Admin only' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const { waiter_id } = await req.json();
    if (!waiter_id) {
      return new Response(JSON.stringify({ error: 'waiter_id required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const { data: waiter } = await admin.from('waiters').select('user_id').eq('id', waiter_id).maybeSingle();
    if (!waiter) {
      return new Response(JSON.stringify({ error: 'Waiter not found' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Detach references so we can delete the waiter row
    await admin.from('section_assignments').delete().eq('waiter_id', waiter_id);
    await admin.from('table_sessions').update({ assigned_waiter_id: null }).eq('assigned_waiter_id', waiter_id);
    await admin.from('orders').update({ assigned_waiter_id: null }).eq('assigned_waiter_id', waiter_id);

    await admin.from('waiters').delete().eq('id', waiter_id);
    await admin.from('user_roles').delete().eq('user_id', waiter.user_id);

    // Delete auth user (best effort)
    try {
      await admin.auth.admin.deleteUser(waiter.user_id);
    } catch (error) {
      console.warn('Failed to delete waiter auth user', error);
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e: unknown) {
    return new Response(JSON.stringify({ error: errorMessage(e) }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
