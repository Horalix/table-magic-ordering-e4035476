import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface Body {
  username?: string;
  password?: string;
}

const normalizeUsername = (value: string) =>
  value.trim().toLowerCase().replace(/[^a-z0-9_.-]/g, "");

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const invalidLogin = () => json({ error: "Invalid username or password" }, 401);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;

    const body: Body = await req.json().catch(() => ({}));
    const username = normalizeUsername(body.username || "");
    const password = body.password || "";

    if (!username || !password) return invalidLogin();

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: waiter, error: waiterError } = await admin
      .from("waiters")
      .select("id, user_id, is_active")
      .eq("username", username)
      .maybeSingle();

    if (waiterError) throw waiterError;
    if (!waiter || !waiter.is_active) return invalidLogin();

    const { data: userData, error: userError } = await admin.auth.admin.getUserById(waiter.user_id);
    const email = userData.user?.email;
    if (userError || !email) return invalidLogin();

    const auth = createClient(SUPABASE_URL, ANON, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: authData, error: authError } = await auth.auth.signInWithPassword({
      email,
      password,
    });

    if (authError || !authData.session || !authData.user) return invalidLogin();

    return json({
      ok: true,
      session: {
        access_token: authData.session.access_token,
        refresh_token: authData.session.refresh_token,
        expires_at: authData.session.expires_at,
        expires_in: authData.session.expires_in,
        token_type: authData.session.token_type,
      },
      user: {
        id: authData.user.id,
        email: authData.user.email,
      },
      waiter: {
        id: waiter.id,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Server error";
    return json({ error: message }, 500);
  }
});
