import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface Body {
  email?: string;
  password?: string;
  display_name?: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;

    const authHeader = req.headers.get('Authorization') || '';
    const token = authHeader.replace('Bearer ', '');

    // Verify caller is admin
    const userClient = createClient(SUPABASE_URL, ANON, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: uErr } = await userClient.auth.getUser(token);
    if (uErr || !userData.user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { data: roles } = await admin.from('user_roles').select('role').eq('user_id', userData.user.id);
    const isAdmin = roles?.some((r: any) => r.role === 'admin');
    if (!isAdmin) {
      return new Response(JSON.stringify({ error: 'Admin only' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const body: Body = await req.json();
    const email = (body.email || '').trim().toLowerCase();
    const password = body.password || '';
    const display_name = (body.display_name || '').trim();

    if (!email || !password || password.length < 8 || !display_name) {
      return new Response(JSON.stringify({ error: 'Invalid input' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (createErr || !created.user) {
      return new Response(JSON.stringify({ error: createErr?.message || 'Create failed' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const userId = created.user.id;

    const { error: roleErr } = await admin.from('user_roles').insert({ user_id: userId, role: 'staff' });
    if (roleErr) {
      return new Response(JSON.stringify({ error: roleErr.message }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const { data: waiter, error: wErr } = await admin
      .from('waiters')
      .insert({ user_id: userId, display_name })
      .select()
      .single();
    if (wErr) {
      return new Response(JSON.stringify({ error: wErr.message }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify({ ok: true, waiter }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || 'Server error' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
