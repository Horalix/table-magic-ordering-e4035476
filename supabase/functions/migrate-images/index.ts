// One-shot migration: download all external menu_items.image_url
// to the menu-images bucket and rewrite the row to the new public URL.
// Idempotent: safe to re-run (skips rows already on our domain).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BUCKET = "menu-images";

function extFromContentType(ct: string | null, fallback = "jpg"): string {
  if (!ct) return fallback;
  if (ct.includes("webp")) return "webp";
  if (ct.includes("png")) return "png";
  if (ct.includes("jpeg") || ct.includes("jpg")) return "jpg";
  if (ct.includes("gif")) return "gif";
  return fallback;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Auth: require admin
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });
  const token = authHeader.replace("Bearer ", "");
  const { data: claims, error: claimsErr } = await userClient.auth.getClaims(token);
  if (claimsErr || !claims?.claims) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const userId = claims.claims.sub as string;
  const { data: roleRow } = await userClient
    .from("user_roles").select("role").eq("user_id", userId).eq("role", "admin").maybeSingle();
  if (!roleRow) {
    return new Response(JSON.stringify({ error: "Admin only" }), {
      status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const ourHost = new URL(SUPABASE_URL).host;

  const { data: items, error: selErr } = await admin
    .from("menu_items")
    .select("id, image_url")
    .not("image_url", "is", null);

  if (selErr) {
    return new Response(JSON.stringify({ error: selErr.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const todo = (items ?? []).filter((row: any) => {
    if (!row.image_url) return false;
    try {
      const u = new URL(row.image_url);
      return u.host !== ourHost; // not yet self-hosted
    } catch { return false; }
  });

  let migrated = 0, skipped = (items?.length ?? 0) - todo.length, failed = 0;
  const errors: string[] = [];

  // Batch in chunks of 6 to avoid bursting the upstream
  const CHUNK = 6;
  for (let i = 0; i < todo.length; i += CHUNK) {
    const batch = todo.slice(i, i + CHUNK);
    await Promise.all(batch.map(async (row: any) => {
      try {
        const res = await fetch(row.image_url, { redirect: "follow" });
        if (!res.ok) throw new Error(`fetch ${res.status}`);
        const ct = res.headers.get("content-type");
        const ext = extFromContentType(ct, row.image_url.split(".").pop() || "jpg");
        const path = `${row.id}.${ext}`;
        const buf = new Uint8Array(await res.arrayBuffer());
        const { error: upErr } = await admin.storage.from(BUCKET).upload(path, buf, {
          contentType: ct || `image/${ext}`,
          upsert: true,
          cacheControl: "31536000",
        });
        if (upErr) throw upErr;
        const { data: pub } = admin.storage.from(BUCKET).getPublicUrl(path);
        const { error: updErr } = await admin
          .from("menu_items").update({ image_url: pub.publicUrl }).eq("id", row.id);
        if (updErr) throw updErr;
        migrated++;
      } catch (e: any) {
        failed++;
        errors.push(`${row.id}: ${e?.message ?? String(e)}`);
      }
    }));
  }

  return new Response(JSON.stringify({ migrated, skipped, failed, total: items?.length ?? 0, errors: errors.slice(0, 10) }), {
    status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
