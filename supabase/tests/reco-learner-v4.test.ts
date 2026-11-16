/**
 * @vitest-environment node
 *
 * Learner v4 (20261116130000_reco_learner_v4.sql), on La Soul's real menu:
 *
 *   - it is NOT the default (it lost to v3 in the offline simulator): a
 *     fresh database and an existing one both end up on v3, applying the
 *     file changes no ranking and closes no experiment, yet every decision
 *     records the guest's language; switching reco_learner is a policy
 *     change and closes the running experiment;
 *   - switched on, it runs under its own policy version, and the decision
 *     records each candidate's posterior and the probability its choice
 *     really had;
 *   - with the exploration dial at 0 and no language record it ranks
 *     exactly as v3 (the posterior mean is v3's acceptance), so every
 *     waiter-scenario promise of v3 still holds; 'v3' still runs the old
 *     ranker;
 *   - with the dial on, the card holds still for a visit, and the first card
 *     varies between visits only among dishes that passed every rule;
 *   - a pair taken by Arabic-reading guests and passed over by English
 *     readers leads for the first and not the second; a language with no
 *     record of its own gets the pair's record;
 *   - the old sampler's nightly switch leaves a running experiment alone.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { laSoulDatabase, MENU_TABLE, type Db } from './harness/la-soul-menu';
// @ts-expect-error -- plain JS harness, no types needed
import { createTestDatabase } from '../../scripts/db-harness.mjs';

const MIGRATIONS = path.join(__dirname, '..', 'migrations');
const migration = (file: string) => readFileSync(path.join(MIGRATIONS, file), 'utf8');

let db: Db;
const ids = new Map<string, string>();
const names = new Map<string, string>();
const id = (name: string) => {
  const v = ids.get(name.toLowerCase());
  if (!v) throw new Error(`not on the menu: ${name}`);
  return v;
};
const breathe = () => new Promise<void>((resolve) => { setImmediate(resolve); });

interface Asked { names: string[]; decision: { policy_version: string; language: string; action_probability: string; candidates: Array<{ p_mean?: number; p_sd?: number }> } }

/** A table asks once, as the card does; kept (not rolled back) when `keep`. */
async function ask(cart: string[], o: { at?: string; lang?: string; session?: string; placement?: string; keep?: boolean } = {}): Promise<Asked> {
  await breathe();
  if (!o.keep) await db.exec('BEGIN');
  try {
    await db.query(`SELECT set_config('lasoul.reco_now', $1, ${o.keep ? 'false' : 'true'})`, [`2026-10-21 ${o.at ?? '13:00'} Europe/Sarajevo`]);
    const session = o.session ?? crypto.randomUUID();
    const token = `v4-${session.slice(0, 12)}`;
    await db.query(`INSERT INTO public.table_sessions(id, table_id, token, is_active, last_heartbeat_at)
                    VALUES ($1, $2, $3, true, now()) ON CONFLICT (id) DO NOTHING`, [session, MENU_TABLE, token]);
    const { rows } = await db.query<{ id: string }>(
      `SELECT id FROM public.guest_get_recommendations($1, $2, $3::uuid[], $4, $5, 4, '{}'::text[], '{}'::text[], '{}'::uuid[], NULL)`,
      [session, token, cart.map(id), o.placement ?? 'cart', o.lang ?? 'en']);
    const { rows: d } = await db.query<Asked['decision']>(
      `SELECT policy_version, language, action_probability, candidates FROM public.recommendation_decisions
        WHERE session_id = $1 ORDER BY created_at DESC LIMIT 1`, [session]);
    return { names: rows.map((r) => names.get(r.id) ?? r.id), decision: d[0] };
  } finally {
    if (!o.keep) await db.exec('ROLLBACK');
  }
}

/** `shown` sightings of `item` suggested for `source` to guests reading `lang`, `taken` of them paid for. */
async function record(lang: string, source: string, item: string, shown: number, taken: number) {
  for (let i = 0; i < shown; i += 1) {
    await breathe();
    const session = crypto.randomUUID();
    const at = `now() - make_interval(days => ${1 + (i % 20)}, hours => 4)`;
    await db.query(`INSERT INTO public.table_sessions(id, table_id, token, is_active, last_heartbeat_at, opened_at)
                    VALUES ($1, $2, $3, false, ${at}, ${at})`, [session, MENU_TABLE, `r-${session.slice(0, 12)}`]);
    const { rows: d } = await db.query<{ id: string }>(
      `INSERT INTO public.recommendation_decisions(session_id, placement, policy_version, candidates, chosen_item_id, source_item_id,
                                                  recommendation_type, action_probability, cart_value, language, created_at)
       VALUES ($1, 'cart', 'v4-thompson-context', '[]'::jsonb, $2, $3, 'pair_with', 1, 16.5, $4, ${at}) RETURNING id`,
      [session, id(item), id(source), lang]);
    await db.query(`INSERT INTO public.recommendation_impressions(decision_id, seen_at) VALUES ($1, ${at})`, [d[0].id]);
    if (i < taken) {
      const { rows: o } = await db.query<{ id: string }>(
        `INSERT INTO public.orders(table_session_id, total, status, payment_status, payment_method, released_to_kitchen_at, paid_at, created_at)
         VALUES ($1, 0, 'served', 'paid', 'cash', ${at}, ${at}, ${at}) RETURNING id`, [session]);
      await db.query(`INSERT INTO public.order_items(order_id, menu_item_id, quantity, unit_price, status)
                      SELECT $1, id, 1, price, 'served' FROM public.menu_items WHERE id IN ($2, $3)`, [o[0].id, id(source), id(item)]);
      await db.query(`INSERT INTO public.suggestion_conversions(order_id, source_item_id, recommended_item_id, placement, quantity, line_total, decision_id, created_at)
                      SELECT $1, $2, $3, 'cart', 1, price, $4, ${at} FROM public.menu_items WHERE id = $3`,
      [o[0].id, id(source), id(item), d[0].id]);
    }
  }
}

const refresh = async () => {
  await db.query(`SELECT set_config('lasoul.scheduled_job', 'on', false)`);
  try { return (await db.query<{ r: Record<string, unknown> }>(`SELECT public.refresh_menu_intelligence() AS r`)).rows[0].r; }
  finally { await db.query(`SELECT set_config('lasoul.scheduled_job', '', false)`); }
};
const setting = (sql: string) => db.exec(`UPDATE public.restaurant_settings SET ${sql} WHERE id = 1`);

beforeAll(async () => {
  db = await laSoulDatabase();
  // The harness restates the ranker of 20261031120000; bring back the files after it.
  await db.exec(migration('20261116120000_reco_always_measured.sql'));
  await db.exec(migration('20261116130000_reco_learner_v4.sql'));
  const { rows } = await db.query<{ id: string; name: string }>(`SELECT id, btrim(name) AS name FROM public.menu_items`);
  for (const r of rows) { ids.set(r.name.toLowerCase(), r.id); names.set(r.id, r.name); }
}, 240_000);
afterAll(async () => { await db?.close(); });

const CARTS: Array<{ cart: string[]; at: string; placement?: string }> = [
  { cart: ['La Soul Burger'], at: '13:00' },
  { cart: ['Truffle Pasta'], at: '19:30' },
  { cart: ['Turkish Egg'], at: '09:30' },
  { cart: ['Caesar Salad with Chicken'], at: '13:00' },
  { cart: ['Cappuccino'], at: '16:30' },
  { cart: ['Lava Cake'], at: '16:30' },
  { cart: ['Truffle Risotto', 'Coca-Cola'], at: '20:00' },
  { cart: ['Mix Slider', 'Regular Fries'], at: '13:00' },
  { cart: ['La Soul Burger'], at: '13:00', placement: 'item' },
  { cart: [], at: '20:30', placement: 'tab' },
];

describe('v3 stays the default; v4 is a switch', () => {
  it('an existing database (settings rows present when the file runs) ends up on v3', async () => {
    const { rows } = await db.query<{ l: string }>(`SELECT DISTINCT reco_learner AS l FROM public.restaurant_settings`);
    expect(rows.map((r) => r.l)).toEqual(['v3']);
  });

  it('a fresh database, a restaurant added later, and a restaurant with no settings row all get v3', async () => {
    const fresh = (await createTestDatabase({ quiet: true })) as unknown as Db;
    try {
      const { rows } = await fresh.query<{ l: string; v: string; none: string; def: string }>(`
        SELECT (SELECT string_agg(DISTINCT reco_learner, ',') FROM public.restaurant_settings) AS l,
               public.reco_policy_version_for((SELECT venue_id FROM public.restaurant_settings LIMIT 1)) AS v,
               public.reco_learner_for('00000000-0000-4000-8000-0000000000ff') AS none,
               (SELECT column_default FROM information_schema.columns
                 WHERE table_name = 'restaurant_settings' AND column_name = 'reco_learner') AS def`);
      expect(rows[0]).toMatchObject({ l: 'v3', v: 'v3-profit', none: 'v3' });
      expect(rows[0].def).toContain("'v3'");
    } finally {
      await fresh.close();
    }
  }, 240_000);

  it('applying the file again keeps a restaurant that chose v4 on v4', async () => {
    await setting(`reco_learner = 'v4'`);
    await db.exec(migration('20261116130000_reco_learner_v4.sql'));
    const { rows } = await db.query<{ l: string }>(`SELECT reco_learner AS l FROM public.restaurant_settings WHERE id = 1`);
    expect(rows[0].l).toBe('v4');
    await setting(`reco_learner = 'v3'`);
  });

  it('on v3 the ranking and the policy are as before, and the language is still recorded', async () => {
    const a = await ask(['La Soul Burger'], { lang: 'bs' });
    expect(a.decision.policy_version).toBe('v3-profit');
    expect(a.decision.language).toBe('bs');
    expect(a.decision.candidates.every((c) => c.p_mean === undefined)).toBe(true);
  });

  it('switching the ranker closes the running experiment, and only when it really changes', async () => {
    await db.query(`SELECT set_config('lasoul.scheduled_job', 'on', false)`);
    try {
      await db.exec(`UPDATE public.restaurant_settings SET reco_auto_holdout_pct = 10 WHERE id = 1`);
      await db.query(`SELECT public.reco_keep_measuring()`);
      const open = async () => (await db.query<{ id: string; policy_version: string }>(
        `SELECT id, policy_version FROM public.experiments WHERE ended_at IS NULL AND venue_id = public.default_venue()`)).rows;
      const [first] = await open();
      expect(first.policy_version).toBe('v3-profit');
      await setting(`reco_learner = 'v3'`);
      expect((await open())[0]?.id).toBe(first.id);
      await setting(`reco_learner = 'v4'`);
      expect(await open()).toHaveLength(0);
      await db.query(`SELECT public.reco_keep_measuring()`);
      expect((await open())[0].policy_version).toBe('v4-thompson-context');
    } finally {
      await db.query(`SELECT set_config('lasoul.scheduled_job', '', false)`);
      await db.exec(`UPDATE public.restaurant_settings SET reco_auto_holdout_pct = 0 WHERE id = 1;
                     UPDATE public.experiments SET ended_at = now() WHERE ended_at IS NULL`);
    }
  });
});

describe('v4 switched on: the ledger knows what it did', () => {
  it('runs under its own policy version, with the language, the posteriors and an honest probability', async () => {
    await setting(`reco_exploration = 15, reco_learner = 'v4'`);
    const a = await ask(['La Soul Burger'], { lang: 'ar' });
    expect(a.names.length).toBeGreaterThan(0);
    expect(a.decision.policy_version).toBe('v4-thompson-context');
    expect(a.decision.language).toBe('ar');
    const c = a.decision.candidates;
    expect(c.length).toBeGreaterThan(1);
    expect(c.every((x) => Number(x.p_mean) > 0 && Number(x.p_mean) < 1 && Number(x.p_sd) > 0)).toBe(true);
    const p = Number(a.decision.action_probability);
    expect(p).toBeGreaterThan(0);
    expect(p).toBeLessThanOrEqual(1);
  });
});

describe('at dial 0 with no language record, v4 ranks exactly as v3', () => {
  it('gives the same shortlist, in the same order, on every cart and placement', async () => {
    await setting(`reco_exploration = 0, reco_learner = 'v3'`);
    const v3 = [];
    for (const c of CARTS) v3.push((await ask(c.cart, { at: c.at, placement: c.placement })).names);
    await setting(`reco_learner = 'v4'`);
    const v4 = [];
    for (const c of CARTS) v4.push((await ask(c.cart, { at: c.at, placement: c.placement })).names);
    expect(v4).toEqual(v3);
    expect(v3.flat().length).toBeGreaterThan(10);
  }, 120_000);

  it('and the probability of a choice nothing could unseat is 1', async () => {
    const a = await ask(['La Soul Burger']);
    expect(Number(a.decision.action_probability)).toBe(1);
  });
});

describe('with the dial on', () => {
  it('holds the card still for a visit', async () => {
    await setting(`reco_exploration = 15`);
    const session = crypto.randomUUID();
    const first = await ask(['Truffle Pasta'], { session, keep: true });
    for (let i = 0; i < 3; i += 1) {
      expect((await ask(['Truffle Pasta'], { session, keep: true })).names[0]).toBe(first.names[0]);
    }
  });

  it('varies the first card between visits only among what passes every rule', async () => {
    const allowed = new Set((await (async () => {
      await setting(`reco_exploration = 0`);
      const r = await db.query<{ id: string }>(
        `SELECT id FROM public.reco_rank_scored_v4(ARRAY[$1]::uuid[], 'cart', 'en', 24, NULL, '{}'::text[], NULL)`, [id('La Soul Burger')]);
      await setting(`reco_exploration = 15`);
      return r.rows.map((x) => names.get(x.id));
    })()));
    const firsts = new Map<string, number>();
    for (let i = 0; i < 30; i += 1) {
      const n = (await ask(['La Soul Burger'])).names[0];
      firsts.set(n, (firsts.get(n) ?? 0) + 1);
    }
    for (const n of firsts.keys()) expect(allowed.has(n)).toBe(true);
    expect(firsts.size).toBeGreaterThan(1);
  }, 120_000);
});

describe('the guest\'s language', () => {
  let target = '';
  it('a pair Arabic readers take and English readers pass over leads for the first, not the second', async () => {
    await setting(`reco_exploration = 0`);
    const before = await ask(['La Soul Burger'], { lang: 'ar' });
    target = before.names.find((n, i) => i > 0 && /mojito|lemonade|iced tea|water/i.test(n)) ?? before.names[1];
    expect(before.names[0]).not.toBe(target);

    await record('ar', 'La Soul Burger', target, 40, 20);
    await record('en', 'La Soul Burger', target, 120, 1);
    const r = await refresh();
    expect(Number(r.context_rows)).toBeGreaterThan(0);

    expect((await ask(['La Soul Burger'], { lang: 'ar' })).names[0]).toBe(target);
    expect((await ask(['La Soul Burger'], { lang: 'en' })).names[0]).not.toBe(target);
  }, 180_000);

  it('a language with no record of its own gets the pair\'s record, between the two', async () => {
    const post = async (lang: string) => Number((await db.query<{ mean: string }>(
      `SELECT mean FROM public.reco_posterior_v4($1, 'cart', $2, 'lunch', $3, 'x')`,
      [id(target), id('La Soul Burger'), lang])).rows[0].mean);
    const [ar, en, bs] = [await post('ar'), await post('en'), await post('bs')];
    expect(ar).toBeGreaterThan(bs);
    expect(bs).toBeGreaterThan(en);
  });
});

describe('the old sampler\'s nightly switch', () => {
  it('has nothing to switch under v4 and leaves a running experiment alone', async () => {
    await db.query(`SELECT set_config('lasoul.scheduled_job', 'on', false)`);
    try {
      await db.query(`SELECT public.reco_keep_measuring()`);
      const before = (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM public.experiments WHERE ended_at IS NULL`)).rows[0].n;
      const r = (await db.query<{ r: { reason: string } }>(`SELECT public.maybe_enable_sampling() AS r`)).rows[0].r;
      expect(r.reason).toBe('v4_samples_always');
      const after = (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM public.experiments WHERE ended_at IS NULL`)).rows[0].n;
      expect(after).toBe(before);
      expect(before).toBeGreaterThan(0);
    } finally {
      await db.query(`SELECT set_config('lasoul.scheduled_job', '', false)`);
    }
  });
});
