/**
 * @vitest-environment node
 *
 * An offline simulator for the suggestion engine: La Soul's real menu, the
 * real migrations and the real ranker in PGlite, and simulated tables whose
 * tastes the engine cannot see. Each simulated day the tables ask exactly as
 * the guest app does (guest_get_recommendations), see the first card, take
 * it or not, and pay; each night the engine learns from its own ledger with
 * the same refresh production runs. Used to compare rankers — today's (v3)
 * and v4 — on the same tables with the same luck (common random numbers).
 *
 * Off by default (it takes minutes per simulated month). Run one ranker per
 * process, side by side:
 *
 *   RECO_SIM=v3 RECO_SIM_OUT=sim-v3.json npx vitest run supabase/tests/reco-simulator.test.ts
 *   RECO_SIM=v4 RECO_SIM_OUT=sim-v4.json npx vitest run supabase/tests/reco-simulator.test.ts
 *
 * RECO_SIM_DAYS (28), RECO_SIM_TABLES per day (36), RECO_SIM_SEED (1),
 * RECO_SIM_WORLD: 'tourists' (default: Arabic, Bosnian and English guests
 * differ in taste) or 'flat' (they do not; what context costs when it is
 * not needed).
 *
 * The hidden tastes (below, `truth`) are assumptions, not data: base rates
 * by kind of thing and placement, a random appeal per dish, a random
 * preference per dish and language, and price sensitivity. What the
 * simulator shows is how each ranker LEARNS in such a world, not what La
 * Soul's guests will do.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { laSoulDatabase, MENU_TABLE, type Db } from './harness/la-soul-menu';

const RUN = process.env.RECO_SIM ?? '';
const DAYS = Number(process.env.RECO_SIM_DAYS ?? 28);
const TABLES = Number(process.env.RECO_SIM_TABLES ?? 36);
const SEED = Number(process.env.RECO_SIM_SEED ?? 1);
const WORLD = process.env.RECO_SIM_WORLD ?? 'tourists';
const OUT = process.env.RECO_SIM_OUT;

const MIGRATIONS = path.join(__dirname, '..', 'migrations');
const migration = (file: string) => readFileSync(path.join(MIGRATIONS, file), 'utf8');

/* ---------------- random numbers ---------------- */

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hash = (...xs: Array<number | string>) => {
  let h = 2166136261;
  for (const ch of xs.join('|')) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
};
const normal = (r: () => number) => Math.sqrt(-2 * Math.log(Math.max(r(), 1e-12))) * Math.cos(2 * Math.PI * r());
const pick = <T extends string>(r: () => number, w: Record<T, number>): T => {
  const entries = Object.entries(w) as Array<[T, number]>;
  let x = r() * entries.reduce((s, [, v]) => s + v, 0);
  for (const [k, v] of entries) { x -= v; if (x <= 0) return k; }
  return entries[entries.length - 1][0];
};

/* ---------------- the guests ---------------- */

type Lang = 'en' | 'bs' | 'ar';
type Daypart = 'morning' | 'lunch' | 'afternoon' | 'evening';
type Placement = 'cart' | 'after_meal';

const BREAKFAST = { 'Turkish Egg': 3, 'Avocado on Toast': 3, 'Classic Egg Benedict': 2, 'Truffle Egg Benedict': 2, 'Breakfast Platter': 2,
  'Shakshuka Platter': 2, 'French Toast': 2, 'Granola Bowl': 1, 'Stuffed Croissant with Eggs & Cheese': 1.5, 'Puff Truffle Egg': 1 };
const MORNING_DRINK = { Cappuccino: 5, 'Flat White': 2, 'Spanish Latte': 2, 'Fresh Orange Juice': 4, 'English Breakfast Tea': 1, Americano: 1.5 };
const MAINS = { 'La Soul Burger': 5, 'Dynamite Chicken Burger': 2, 'Classic Crispy Chicken Burger': 2, 'Manhattan Burger': 1.5,
  'Mushroom Burger': 1, 'Volcano Beef Burger': 2, 'Mix Slider': 2, 'Truffle Pasta': 3, 'Alfredo Fettuccine': 1.5, 'Pasta Arrabbiata': 1,
  'Truffle Risotto': 2, 'Pesto Risotto': 1.5, 'Caesar Salad with Chicken': 2.5, 'Caesar Salad': 2, 'Falafel Salad': 1 };
const MEAL_DRINK = { 'Coca-Cola': 6, 'Strawberry Lemonade': 3, 'Lemon Iced Tea': 3, 'Classic Mojito': 2.5, 'Sparkling Water': 2.5, 'Bottled Water': 2 };
const AFTERNOON = { Cappuccino: 3, 'Spanish Latte': 3, 'Iced Spanish Latte': 3, 'Iced Latte': 2, 'Oreo Frappe': 1.5, 'Hot Chocolate': 1.5 };
const CAKE = { 'San Sebastian Cheesecake': 3, 'Lava Cake': 3, 'Tiramisu Cup': 2, 'Dubai Pudding': 1.5 };

interface Table {
  day: number; n: number; daypart: Daypart; at: string; covers: number; lang: Lang;
  cart: Map<string, number>;
  /** Fixed per table, the same under every ranker: the luck of the draw. */
  u: [number, number];
}

const LANGS: Record<Lang, number> = { en: 0.4, bs: 0.35, ar: 0.25 };
const HOURS: Record<Daypart, [number, number]> = { morning: [9, 11], lunch: [12, 15], afternoon: [16, 18], evening: [18, 22] };

function tablesFor(day: number): Table[] {
  const out: Table[] = [];
  for (let n = 0; n < TABLES; n += 1) {
    const r = rng(hash(SEED, 'table', day, n));
    const daypart = pick<Daypart>(r, { morning: 0.25, lunch: 0.3, afternoon: 0.2, evening: 0.25 });
    const [h0, h1] = HOURS[daypart];
    const mins = Math.floor((h0 + r() * (h1 - h0)) * 60);
    const covers = pick(r, { 1: 0.35, 2: 0.4, 3: 0.15, 4: 0.1 } as Record<string, number>);
    const lang = pick<Lang>(r, LANGS);
    const cart = new Map<string, number>();
    const add = (name: string) => cart.set(name, (cart.get(name) ?? 0) + 1);
    for (let p = 0; p < Number(covers); p += 1) {
      if (daypart === 'morning') {
        if (r() < 0.82) add(pick(r, BREAKFAST));
        if (r() < 0.4) add(pick(r, MORNING_DRINK));
      } else if (daypart === 'afternoon') {
        add(pick(r, AFTERNOON));
        if (r() < 0.3) add(pick(r, CAKE));
      } else {
        add(pick(r, MAINS));
        if (r() < 0.35) add(pick(r, MEAL_DRINK));
      }
    }
    if (!cart.size) add(pick(r, MORNING_DRINK));
    out.push({ day, n, daypart, at: `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`,
      covers: Number(covers), lang, cart, u: [r(), r()] });
  }
  return out;
}

/* ---------------- what the guests would take (hidden) ---------------- */

interface Dish { id: string; name: string; price: number; grp: string; kind: string; cm: number }

const BASE: Record<Placement, Record<string, number>> = {
  cart: { cold_drink: 0.16, hot_drink: 0.07, iced_coffee: 0.08, sweet: 0.06, starter: 0.07, fries: 0.13, side: 0.12, salad: 0.06, extra: 0.1, main: 0.03 },
  after_meal: { sweet: 0.15, hot_drink: 0.18, iced_coffee: 0.07, cold_drink: 0.04 },
};
const LANG_TASTE: Record<Lang, Record<string, number>> = {
  ar: { sweet: 1.8, hot_drink: 1.15, cold_drink: 1.1, iced_coffee: 1.3 },
  bs: { hot_drink: 1.5, sweet: 0.8, cold_drink: 0.9, iced_coffee: 0.8 },
  en: {},
};

function truth(d: Dish, placement: Placement, t: Table, avgLine: number, qty: number): number {
  const base = BASE[placement][d.grp] ?? 0.05;
  const lang = WORLD === 'flat' ? 1 : (LANG_TASTE[t.lang][d.grp] ?? 1);
  const appeal = Math.exp(0.55 * normal(rng(hash(SEED, 'appeal', d.id))));
  const idio = WORLD === 'flat' ? 1 : Math.exp(0.45 * normal(rng(hash(SEED, 'idio', d.id, t.lang))));
  const ratio = avgLine > 0 ? d.price / avgLine : 0.5;
  const price = ratio <= 0.6 ? 1 : 0.6 / ratio;
  return Math.min(0.6, base * lang * appeal * idio * price * (qty > 1 ? 0.85 : 1));
}

/* ---------------- the simulation ---------------- */

interface Row { decision_id: string; id: string; suggested_quantity: number }
interface Week {
  tables: number; asks: number; shown: number; taken: number;
  margin: number; expected: number; oracle: number;
  byLang: Record<Lang, { shown: number; taken: number; expected: number; oracle: number }>;
  firstCards: Record<string, number>;
}
const emptyWeek = (): Week => ({ tables: 0, asks: 0, shown: 0, taken: 0, margin: 0, expected: 0, oracle: 0,
  byLang: { en: { shown: 0, taken: 0, expected: 0, oracle: 0 }, bs: { shown: 0, taken: 0, expected: 0, oracle: 0 }, ar: { shown: 0, taken: 0, expected: 0, oracle: 0 } },
  firstCards: {} });

const breathe = () => new Promise<void>((resolve) => { setImmediate(resolve); });

async function simulate(policy: 'v3' | 'v4') {
  const db: Db = await laSoulDatabase();
  // The harness restates the live ranker of 20261031120000; bring back the
  // files after it, as production will have them.
  await db.exec(migration('20261116120000_reco_always_measured.sql'));
  await db.exec(migration('20261116130000_reco_learner_v4.sql'));
  await db.exec(`
    UPDATE public.restaurant_settings
       SET recommendations_enabled = true, reco_holdout_pct = 0, reco_auto_holdout_pct = 0,
           reco_exploration = 15, reco_sampling_enabled = false, reco_learner = '${policy}';
    UPDATE public.experiments SET ended_at = now() WHERE ended_at IS NULL;
  `);

  const dishes = new Map<string, Dish>();
  const byName = new Map<string, Dish>();
  const { rows } = await db.query<{ id: string; name: string; price: string; grp: string; kind: string; cm: string }>(`
    SELECT mi.id, btrim(mi.name) AS name, mi.price, public.reco_kind_group(public.reco_kind(mi.name, s.name, mi.meal_role, mi.station)) AS grp,
           public.reco_kind(mi.name, s.name, mi.meal_role, mi.station) AS kind, um.unit_cm AS cm
      FROM public.menu_items mi LEFT JOIN public.subcategories s ON s.id = mi.subcategory_id
      JOIN public.menu_unit_margins() um ON um.item_id = mi.id`);
  for (const r of rows) {
    const d = { id: r.id, name: r.name, price: Number(r.price), grp: r.grp, kind: r.kind, cm: Number(r.cm) };
    dishes.set(d.id, d);
    byName.set(d.name.toLowerCase(), d);
  }
  const dish = (name: string) => {
    const d = byName.get(name.toLowerCase());
    if (!d) throw new Error(`not on the menu: ${name}`);
    return d;
  };

  const weeks: Week[] = [];
  const t0 = Date.now();
  for (let day = 0; day < DAYS; day += 1) {
    const week = (weeks[Math.floor(day / 7)] ??= emptyWeek());
    const daysAgo = DAYS - day;
    for (const t of tablesFor(day)) {
      await breathe();
      week.tables += 1;
      const { rows: ts } = await db.query<{ t: string }>(
        `SELECT ((date_trunc('day', now() AT TIME ZONE 'Europe/Sarajevo') - make_interval(days => $1)) + $2::time)
                 AT TIME ZONE 'Europe/Sarajevo' AS t`, [daysAgo, t.at]);
      const at = new Date(ts[0].t);
      const session = crypto.randomUUID();
      const token = `sim-${session.slice(0, 12)}`;
      await db.query(`INSERT INTO public.table_sessions(id, table_id, token, is_active, covers, last_heartbeat_at, opened_at)
                      VALUES ($1, $2, $3, true, $4, now(), $5)`, [session, MENU_TABLE, token, t.covers, at.toISOString()]);

      const cartDishes = [...t.cart.entries()].map(([n, q]) => [dish(n), q] as const);
      const avgLine = cartDishes.reduce((s, [d, q]) => s + d.price * q, 0) / cartDishes.reduce((s, [, q]) => s + q, 0);

      const ask = async (placement: Placement, when: Date, cart: ReadonlyArray<readonly [Dish, number]>, u: number) => {
        week.asks += 1;
        await db.query(`SELECT set_config('lasoul.reco_now', $1, false)`, [when.toISOString()]);
        const { rows: got } = await db.query<Row>(
          `SELECT decision_id, id, suggested_quantity
             FROM public.guest_get_recommendations($1, $2, $3::uuid[], $4, $5, 8, '{}'::text[], '{}'::text[], '{}'::uuid[], $6::int[])`,
          [session, token, cart.map(([d]) => d.id), placement, t.lang, placement === 'cart' ? cart.map(([, q]) => q) : null]);
        if (!got.length) return null;
        const shown = got[0];
        const sd = dishes.get(shown.id)!;
        const q = Math.max(1, shown.suggested_quantity ?? 1);
        const p = truth(sd, placement, t, avgLine, q);
        const best = Math.max(...got.map((g) => {
          const gd = dishes.get(g.id)!;
          const gq = Math.max(1, g.suggested_quantity ?? 1);
          return truth(gd, placement, t, avgLine, gq) * gd.cm * gq;
        }));
        await db.query(`UPDATE public.recommendation_decisions SET created_at = $2 WHERE id = $1`, [shown.decision_id, when.toISOString()]);
        await db.query(`INSERT INTO public.recommendation_impressions(decision_id, seen_at) VALUES ($1, $2)`, [shown.decision_id, when.toISOString()]);
        const taken = u < p;
        week.shown += 1;
        week.expected += p * sd.cm * q;
        week.oracle += best;
        const bl = week.byLang[t.lang];
        bl.shown += 1; bl.expected += p * sd.cm * q; bl.oracle += best;
        if (placement === 'cart' && day >= DAYS - 7) {
          const key = `${t.lang}:${cart.map(([d]) => d.name).sort().join('+')} → ${sd.name}`;
          week.firstCards[key] = (week.firstCards[key] ?? 0) + 1;
        }
        if (taken) { week.taken += 1; bl.taken += 1; week.margin += sd.cm * q; }
        return taken ? { decision: shown.decision_id, dish: sd, q } : null;
      };

      const order = async (when: Date, lines: ReadonlyArray<readonly [Dish, number]>, suggestion: { decision: string; dish: Dish; q: number } | null, placement: Placement) => {
        const all = suggestion ? [...lines, [suggestion.dish, suggestion.q] as const] : lines;
        if (!all.length) return;
        const { rows: o } = await db.query<{ id: string }>(
          `INSERT INTO public.orders(table_session_id, total, status, payment_status, payment_method, released_to_kitchen_at, paid_at, created_at)
           VALUES ($1, $2, 'served', 'paid', 'cash', $3, $3, $3) RETURNING id`,
          [session, all.reduce((s, [d, q]) => s + d.price * q, 0), when.toISOString()]);
        for (const [d, q] of all) {
          await db.query(`INSERT INTO public.order_items(order_id, menu_item_id, quantity, unit_price, status, served_at)
                          VALUES ($1, $2, $3, $4, 'served', $5)`, [o[0].id, d.id, q, d.price, when.toISOString()]);
        }
        if (suggestion) {
          await db.query(`INSERT INTO public.suggestion_conversions(order_id, recommended_item_id, placement, quantity, line_total, decision_id, created_at)
                          VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [o[0].id, suggestion.dish.id, placement, suggestion.q, suggestion.dish.price * suggestion.q, suggestion.decision, when.toISOString()]);
        }
      };

      const first = await ask('cart', at, cartDishes, t.u[0]);
      await order(at, cartDishes, first, 'cart');
      const hasMain = cartDishes.some(([d]) => d.grp === 'main');
      if (hasMain && (t.daypart === 'lunch' || t.daypart === 'evening')) {
        const later = new Date(at.getTime() + 45 * 60_000);
        const second = await ask('after_meal', later, [], t.u[1]);
        if (second) await order(later, [], second, 'after_meal');
      }
      await db.query(`UPDATE public.table_sessions SET is_active = false WHERE id = $1`, [session]);
    }
    // The night: what production runs every half hour, once a day here.
    await db.query(`SELECT set_config('lasoul.reco_now', '', false)`);
    await db.query(`SELECT set_config('lasoul.scheduled_job', 'on', false)`);
    await db.query(`SELECT public.refresh_menu_intelligence()`);
    await db.query(`SELECT set_config('lasoul.scheduled_job', '', false)`);
    console.log(`[sim ${policy}] day ${day + 1}/${DAYS} · ${Math.round((Date.now() - t0) / 1000)} s`);
  }
  await db.close();
  return weeks;
}

describe.skipIf(!RUN)('offline simulator', () => {
  for (const policy of RUN.split(',').filter((p): p is 'v3' | 'v4' => p === 'v3' || p === 'v4')) {
    it(`simulates ${DAYS} days of ${TABLES} tables a day under ${policy} (seed ${SEED}, ${WORLD})`, async () => {
      const weeks = await simulate(policy);
      const total = weeks.reduce((s, w) => ({ shown: s.shown + w.shown, taken: s.taken + w.taken, margin: s.margin + w.margin,
        expected: s.expected + w.expected, oracle: s.oracle + w.oracle, tables: s.tables + w.tables }),
      { shown: 0, taken: 0, margin: 0, expected: 0, oracle: 0, tables: 0 });
      const result = { policy, seed: SEED, world: WORLD, days: DAYS, tablesPerDay: TABLES, total, weeks };
      if (OUT) writeFileSync(OUT, JSON.stringify(result, null, 2));
      expect(total.shown).toBeGreaterThan(0);
    }, 6 * 3_600_000);
  }
});
