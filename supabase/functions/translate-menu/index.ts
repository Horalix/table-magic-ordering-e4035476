import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    // Verify auth
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }

    const anonClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await anonClient.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Parse body for force param
    let force = false;
    try {
      const body = await req.json();
      force = body?.force === true;
    } catch { /* no body is fine */ }

    // Fetch items needing translation (both AR and BS)
    let itemsQuery = supabase.from("menu_items").select("id, name, description");
    let categoriesQuery = supabase.from("categories").select("id, name");
    let subcategoriesQuery = supabase.from("subcategories").select("id, name");

    if (!force) {
      // Get items where EITHER ar or bs is missing
      itemsQuery = supabase.from("menu_items").select("id, name, description, name_ar, name_bs");
      categoriesQuery = supabase.from("categories").select("id, name, name_ar, name_bs");
      subcategoriesQuery = supabase.from("subcategories").select("id, name, name_ar, name_bs");
    }

    const { data: items } = await itemsQuery;
    const { data: categories } = await categoriesQuery;
    const { data: subcategories } = await subcategoriesQuery;

    const toTranslate: { type: string; id: string; name: string; description?: string; needs_ar: boolean; needs_bs: boolean }[] = [];

    categories?.forEach((c: any) => {
      const needs_ar = force || !c.name_ar;
      const needs_bs = force || !c.name_bs;
      if (needs_ar || needs_bs) toTranslate.push({ type: "category", id: c.id, name: c.name, needs_ar, needs_bs });
    });
    subcategories?.forEach((s: any) => {
      const needs_ar = force || !s.name_ar;
      const needs_bs = force || !s.name_bs;
      if (needs_ar || needs_bs) toTranslate.push({ type: "subcategory", id: s.id, name: s.name, needs_ar, needs_bs });
    });
    items?.forEach((i: any) => {
      const needs_ar = force || !i.name_ar;
      const needs_bs = force || !i.name_bs;
      if (needs_ar || needs_bs) toTranslate.push({ type: "item", id: i.id, name: i.name, description: i.description || undefined, needs_ar, needs_bs });
    });

    if (toTranslate.length === 0) {
      return new Response(JSON.stringify({ message: "All items already translated", count: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Build prompt for both AR and BS
    const prompt = `Translate the following restaurant menu items. For each item, provide Arabic and Bosnian translations.

CRITICAL RULES:
- Do NOT translate brand names like "La Soul", "LA SOUL" — keep them as-is in all languages
- Keep translations natural for a restaurant menu context
- Arabic should use proper Arabic script
- Bosnian should use Latin script (not Cyrillic)

Items to translate:
${JSON.stringify(toTranslate.map((t) => ({ id: t.id, type: t.type, name: t.name, description: t.description })))}

Return ONLY a JSON array where each object has:
- id (same as input)
- name_ar (Arabic translation of name)
- name_bs (Bosnian translation of name)  
- description_ar (Arabic translation of description, only if original had description)
- description_bs (Bosnian translation of description, only if original had description)

No markdown, no explanation, ONLY the JSON array.`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: "You are a professional translator specializing in restaurant menus. Translate English to Arabic and Bosnian naturally. Never translate brand names." },
          { role: "user", content: prompt },
        ],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("AI gateway error:", response.status, errText);
      throw new Error(`AI gateway error: ${response.status}`);
    }

    const aiResult = await response.json();
    let content = aiResult.choices?.[0]?.message?.content || "";

    // Clean markdown code fences if present
    content = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

    let translated: any[];
    try {
      translated = JSON.parse(content);
    } catch {
      console.error("Failed to parse AI response:", content);
      throw new Error("Failed to parse translation response");
    }

    // Apply translations
    let updated = 0;
    for (const t of translated) {
      const original = toTranslate.find((o) => o.id === t.id);
      if (!original) continue;

      const updates: Record<string, any> = {};
      if (original.needs_ar && t.name_ar) updates.name_ar = t.name_ar;
      if (original.needs_bs && t.name_bs) updates.name_bs = t.name_bs;

      if (original.type === "item") {
        if (original.needs_ar && t.description_ar) updates.description_ar = t.description_ar;
        if (original.needs_bs && t.description_bs) updates.description_bs = t.description_bs;
      }

      if (Object.keys(updates).length === 0) continue;

      const table = original.type === "category" ? "categories" : original.type === "subcategory" ? "subcategories" : "menu_items";
      await supabase.from(table).update(updates).eq("id", t.id);
      updated++;
    }

    return new Response(JSON.stringify({ message: `Translated ${updated} items to Arabic & Bosnian`, count: updated }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("translate-menu error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
