import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Fetch items needing Arabic translation
    const { data: items } = await supabase
      .from("menu_items")
      .select("id, name, description")
      .is("name_ar", null);

    const { data: categories } = await supabase
      .from("categories")
      .select("id, name")
      .is("name_ar", null);

    const { data: subcategories } = await supabase
      .from("subcategories")
      .select("id, name")
      .is("name_ar", null);

    const toTranslate: { type: string; id: string; name: string; description?: string }[] = [];

    categories?.forEach((c) => toTranslate.push({ type: "category", id: c.id, name: c.name }));
    subcategories?.forEach((s) => toTranslate.push({ type: "subcategory", id: s.id, name: s.name }));
    items?.forEach((i) => toTranslate.push({ type: "item", id: i.id, name: i.name, description: i.description || undefined }));

    if (toTranslate.length === 0) {
      return new Response(JSON.stringify({ message: "All items already translated", count: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Build prompt
    const prompt = `Translate the following restaurant menu items from English to Arabic. Return a JSON array with the same structure but with Arabic translations. Keep it natural for a restaurant menu context.

Items to translate:
${JSON.stringify(toTranslate.map((t) => ({ id: t.id, type: t.type, name: t.name, description: t.description })))}

Return ONLY a JSON array where each object has: id, name_ar, description_ar (if original had description). No markdown, no explanation.`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: "You are a professional translator specializing in restaurant menus. Translate English to Arabic naturally." },
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

      if (original.type === "category") {
        await supabase.from("categories").update({ name_ar: t.name_ar }).eq("id", t.id);
      } else if (original.type === "subcategory") {
        await supabase.from("subcategories").update({ name_ar: t.name_ar }).eq("id", t.id);
      } else if (original.type === "item") {
        await supabase.from("menu_items").update({
          name_ar: t.name_ar,
          description_ar: t.description_ar || null,
        }).eq("id", t.id);
      }
      updated++;
    }

    return new Response(JSON.stringify({ message: `Translated ${updated} items`, count: updated }), {
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
