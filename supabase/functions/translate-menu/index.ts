import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { namedVenue, resolveAdminVenue, type RoleRow, type VenueRow } from "../_shared/venue-access.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-venue, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/**
 * translate-menu — fills in Bosnian and Arabic for the menu.
 *
 * One restaurant's menu per call: a restaurant's admin translates their own;
 * the owner names the restaurant (venue: slug or id, or the x-venue header).
 *
 * Body (all optional, but the owner must name a venue):
 *   venue: "lasoul"  the restaurant whose menu to translate.
 *   force: false     only fields that are empty are translated (Auto-Translate).
 *   force: true      also refreshes fields that still hold exactly what this
 *                    function wrote last time (Re-translate All). A field a
 *                    person has edited is never touched. What the function wrote
 *                    is kept in public.menu_machine_translations; if that table
 *                    is not there yet, force behaves like a plain run.
 *   overwrite: true  with force, replaces every translation, hand edits
 *                    included. The owner's only. Not offered in the admin UI
 *                    on purpose.
 *
 * Response: { message, count } as before, plus { fields, skipped }.
 */

type TargetType = "category" | "subcategory" | "item";
type TableName = "categories" | "subcategories" | "menu_items";
type Field = "name_bs" | "name_ar" | "description_bs" | "description_ar";

const TABLE: Record<TargetType, TableName> = { category: "categories", subcategory: "subcategories", item: "menu_items" };
const NAME_FIELDS: Field[] = ["name_bs", "name_ar"];
const DESCRIPTION_FIELDS: Field[] = ["description_bs", "description_ar"];
const BATCH_SIZE = 25;

interface Row {
  id: string;
  name: string;
  description?: string | null;
  name_bs?: string | null;
  name_ar?: string | null;
  description_bs?: string | null;
  description_ar?: string | null;
}

interface Target {
  type: TargetType;
  row: Row;
  fields: Field[];
}

type TranslationResult = { id: string } & Partial<Record<Field, string>>;

/**
 * Whose menu it is, and the names on it that stay names: Vera Italia's Italian
 * dish names are kept like La Soul's coffee and brand names.
 */
const RESTAURANT: Record<string, { about: string; name: string; names: string }> = {
  lasoul: {
    about: "La Soul, a café, restaurant and bar in Sarajevo",
    name: "La Soul",
    names: "La Soul, Espresso, Cappuccino, Americano, Cortado, Piccolo, Flat White, Caffe Latte, Mojito, Matcha Latte, Frappe, Cold Brew, V60, Chemex, Coca-Cola, Fanta, Sprite, Red Bull, Nutella, Oreo",
  },
  veraitalia: {
    about: "Vera Italia, a fine-dining Italian restaurant in Sarajevo",
    name: "Vera Italia",
    names: "Vera Italia, Margherita, Pepperoni, Quattro Formaggi, Burrata, Bruschetta, Caprese, Arrabbiata, Fettuccine, Penne, Risotto, Alfredo, Pesto, Pizza Napoletana, Antipasti, Insalate, Carne",
  },
};

const systemPrompt = (slug: string) => {
  const r = RESTAURANT[slug] ?? RESTAURANT.lasoul;
  return SYSTEM_PROMPT
    .replace("{about}", r.about)
    .replace("{names}", r.names)
    .replace("{name}", r.name);
};

const SYSTEM_PROMPT = `You translate the menu of {about}, from English into Bosnian and Arabic. English is the source of truth for meaning.

BOSNIAN
- Standard Bosnian as used in Sarajevo cafés: ijekavica (mlijeko, svježe, bijelo, hljeb, pecivo, cvjetni), Latin script.
- Bosnian, not Croatian or Serbian word choices: kafa (never kava), hljeb (never kruh), sos (not umak), narandža (not naranča or pomorandža), paradajz (not rajčica), krompir (not krumpir), sto (not stol), šoljica, kašika, inspirisan (not inspiriran), kombinuje.
- Sentence case in names: only the first word and proper nouns are capitalised ("Ledeni čaj od breskve", not "Ledeni Čaj Od Breskve").
- No English words mixed into Bosnian: low-fat → sa smanjenim udjelom masti; light → lagani; healthy → fit; combo → meni; mocktail → bezalkoholni koktel; shot → espresso or doza; cherry tomato → čeri paradajz; iceberg lettuce → ajsberg salata; bun → pecivo (brioche bun → brioš pecivo); beef patty → juneća pljeskavica; jalapeño → jalapeño papričice; cup (dessert) → u čaši.
- Correct case, gender and number agreement.

ARABIC
- Warm, natural Modern Standard Arabic as on good Gulf and Levant café menus. Concise, like the English. No word-for-word calques.
- Latin digits only: 0-9 and %. Never ٠١٢٣٤٥٦٧٨٩ or ٪. Prices stay in KM, e.g. "+2 KM".
- Fixed spellings, used every time: برجر، إسبريسو، كابتشينو، لاتيه، موهيتو، ماتشا، فرابيه، بودينغ، كرواسون، موزاريلا، شيدر، كيمكس.
- poached egg = بيضة بوشيه (boiled egg is بيض مسلوق — different thing); iceberg lettuce = خس آيسبرغ; pita bread = خبز عربي; mocktail = موكتيل خالٍ من الكحول.

BOTH LANGUAGES
- Real product and brand names are names, not text to translate: {names}. In Bosnian keep them exactly as written. In Arabic transliterate them (إسبريسو، كابتشينو), except "{name}" and "V60", which stay in Latin letters.
- Descriptive names ARE translated: "Fresh Orange Juice" → "Svježi sok od narandže" / "عصير برتقال طازج"; "Chicken Salad" → "Pileća salata" / "سلطة دجاج"; "Chemex Hot" → "Chemex topli" / "كيمكس ساخن". Translating a product name is as wrong as leaving a descriptive name in English.
- Allergy and diet facts keep their exact meaning: never drop nuts, peanuts, sesame, eggs, dairy, gluten, margarine, alcohol-free or vegetarian; never turn "dairy" into "lactose"; never add a fact the English does not state.
- The same ingredient gets the same word everywhere.
- Category and subcategory names are menu section headings (plural where natural: "Deserti", "Topli napici", "عصائر طازجة").`;

const ARABIC_INDIC = /[٠-٩۰-۹٪]/g;
function latinDigits(s: string): string {
  return s.replace(ARABIC_INDIC, (ch) => {
    if (ch === "٪") return "%";
    const code = ch.charCodeAt(0);
    return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
  });
}

const isBlank = (v: string | null | undefined) => !v || !v.trim();
const logKey = (table: TableName, id: string, field: Field) => `${table}:${id}:${field}`;

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

    // Admin only — translations are costly AI calls; any waiter must not trigger them.
    const userId = (claimsData.claims as { sub?: string }).sub;
    const { data: roleRows } = await supabase
      .from("user_roles")
      .select("role, venue_id")
      .eq("user_id", userId ?? "");
    const roles = (roleRows as RoleRow[] | null) ?? [];
    if (!roles.some((r) => r.role === "admin")) {
      return new Response(JSON.stringify({ error: "Admin access required" }), { status: 403, headers: corsHeaders });
    }

    let body: { force?: unknown; overwrite?: unknown; venue?: unknown } = {};
    try {
      body = (await req.json()) ?? {};
    } catch { /* no body is fine */ }

    // One restaurant's menu: the service role reads and writes both, so the
    // restaurant is decided here (supabase/functions/_shared/venue-access.ts).
    const { data: venueRows } = await supabase.from("venues").select("id, slug");
    const restaurant = resolveAdminVenue(roles, namedVenue(body, req), (venueRows as VenueRow[] | null) ?? []);
    if (!restaurant.ok) {
      return new Response(JSON.stringify({ error: restaurant.error }), {
        status: restaurant.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const venueId = restaurant.venueId;
    const instructions = systemPrompt(restaurant.slug);

    const force = body.force === true;
    // Replacing hand-edited translations is the owner's call.
    const overwrite = force && body.overwrite === true && restaurant.owner;

    const [catRes, subRes, itemRes] = await Promise.all([
      supabase.from("categories").select("id, name, name_bs, name_ar").eq("venue_id", venueId),
      supabase.from("subcategories").select("id, name, name_bs, name_ar").eq("venue_id", venueId),
      supabase.from("menu_items").select("id, name, description, name_bs, name_ar, description_bs, description_ar").eq("venue_id", venueId),
    ]);
    for (const r of [catRes, subRes, itemRes]) if (r.error) throw r.error;

    // What this function wrote last time. Missing table (migration not applied
    // yet) means nothing is known to be machine output, so nothing non-empty
    // is replaced without overwrite.
    const machine = new Map<string, string>();
    let machineLogAvailable = false;
    {
      const { data, error } = await supabase
        .from("menu_machine_translations")
        .select("source_table, row_id, field, value");
      if (!error) {
        machineLogAvailable = true;
        for (const m of (data ?? []) as { source_table: TableName; row_id: string; field: Field; value: string }[]) {
          machine.set(logKey(m.source_table, m.row_id, m.field), m.value);
        }
      } else {
        console.warn("menu_machine_translations unavailable; force will only fill empty fields:", error.message);
      }
    }

    let skipped = 0; // non-empty fields left alone because a person wrote them
    const needs = (table: TableName, row: Row, field: Field): boolean => {
      const source = field.startsWith("description") ? row.description : row.name;
      if (isBlank(source)) return false;            // nothing to translate from
      const current = row[field];
      if (isBlank(current)) return true;            // gap: always fill
      if (!force) return false;
      if (overwrite) return true;
      if (machine.get(logKey(table, row.id, field)) === current) return true; // still our own output
      skipped++;
      return false;
    };

    const targets: Target[] = [];
    const collect = (type: TargetType, rows: Row[] | null) => {
      const table = TABLE[type];
      const candidates = type === "item" ? [...NAME_FIELDS, ...DESCRIPTION_FIELDS] : NAME_FIELDS;
      for (const row of rows ?? []) {
        const fields = candidates.filter((f) => needs(table, row, f));
        if (fields.length) targets.push({ type, row, fields });
      }
    };
    collect("category", catRes.data as Row[]);
    collect("subcategory", subRes.data as Row[]);
    collect("item", itemRes.data as Row[]);

    if (targets.length === 0) {
      return new Response(JSON.stringify({ message: "All items already translated", count: 0, fields: 0, skipped }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let updated = 0;
    let fieldsWritten = 0;

    for (let start = 0; start < targets.length; start += BATCH_SIZE) {
      const batch = targets.slice(start, start + BATCH_SIZE);
      const payload = batch.map((t) => ({
        id: t.row.id,
        type: t.type,
        name: t.row.name.trim(),
        ...(t.row.description?.trim() ? { description: t.row.description.trim() } : {}),
        // Existing translations give the model context for consistency.
        ...(t.row.name_bs && !t.fields.includes("name_bs") ? { existing_name_bs: t.row.name_bs } : {}),
        ...(t.row.name_ar && !t.fields.includes("name_ar") ? { existing_name_ar: t.row.name_ar } : {}),
        return_fields: t.fields,
      }));

      const prompt = `Translate these menu entries. For each entry return ONLY the keys listed in its "return_fields" (name_bs, name_ar, description_bs, description_ar), translated from "name" and "description".

Entries:
${JSON.stringify(payload)}

Return ONLY a JSON array of objects: { "id": <same id>, <each requested field>: <translation> }.
No markdown, no explanation.`;

      const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            { role: "system", content: instructions },
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
      let content: string = aiResult.choices?.[0]?.message?.content || "";
      content = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

      let translated: TranslationResult[];
      try {
        const parsed = JSON.parse(content) as unknown;
        if (!Array.isArray(parsed)) throw new Error("Translation response was not an array");
        translated = parsed as TranslationResult[];
      } catch {
        console.error("Failed to parse AI response:", content);
        throw new Error("Failed to parse translation response");
      }

      for (const t of translated) {
        const target = batch.find((b) => b.row.id === t?.id);
        if (!target) continue;
        const table = TABLE[target.type];

        const updates: Partial<Record<Field, string>> = {};
        for (const f of target.fields) {
          const raw = t[f];
          if (typeof raw !== "string" || !raw.trim()) continue;
          updates[f] = f.endsWith("_ar") ? latinDigits(raw.trim()) : raw.trim();
        }
        const written = Object.keys(updates) as Field[];
        if (written.length === 0) continue;

        // Only write while each field still holds what we read, so an edit made
        // in Admin -> Menu during the AI call is not overwritten.
        let query = supabase.from(table).update(updates).eq("id", target.row.id).eq("venue_id", venueId);
        for (const f of written) {
          const seen = target.row[f];
          query = seen === null || seen === undefined ? query.is(f, null) : query.eq(f, seen);
        }
        const { data: hit, error: updateError } = await query.select("id");
        if (updateError) { console.error("update failed", table, target.row.id, updateError.message); continue; }
        if (!hit?.length) { skipped += written.length; continue; }

        updated++;
        fieldsWritten += written.length;

        if (machineLogAvailable) {
          const { error: logError } = await supabase.from("menu_machine_translations").upsert(
            written.map((f) => ({ source_table: table, row_id: target.row.id, field: f, value: updates[f]!, produced_at: new Date().toISOString() })),
            { onConflict: "source_table,row_id,field" },
          );
          if (logError) console.warn("could not record machine translation:", logError.message);
        }
      }
    }

    const keptNote = skipped ? `; kept ${skipped} hand-edited field${skipped === 1 ? "" : "s"}` : "";
    return new Response(JSON.stringify({
      message: `Translated ${updated} items to Arabic & Bosnian (${fieldsWritten} fields${keptNote})`,
      count: updated,
      fields: fieldsWritten,
      skipped,
    }), {
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
