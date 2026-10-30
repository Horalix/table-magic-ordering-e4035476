#!/usr/bin/env node
/**
 * Try Vera Italia on this computer before its menu is in the live database.
 *
 *   node scripts/vera-italia/preview.mjs        then open http://localhost:8090/veraitalia/
 *
 * Starts two things:
 *   - a stand-in for the database on :54390 that answers the way the real
 *     one will once its menu migration is applied — Vera Italia's courses,
 *     sections and dishes from menu.json, for requests naming Vera Italia
 *     (x-venue), and the guest calls a table needs: the QR code, the session,
 *     placing an order, the tab. Nothing leaves this computer; orders live in
 *     memory until it stops.
 *   - the app (vite) on :8090, pointed at it, with Vera Italia switched on.
 *
 * To sit at a table: http://localhost:8090/table/7?token=preview
 * (or the room code: http://localhost:8090/start?token=preview).
 */
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const API_PORT = 54390;
const APP_PORT = 8090;
const VERA = 'veraitalia';

const menu = JSON.parse(readFileSync(join(HERE, 'menu.json'), 'utf8'));
const categories = menu.categories.map(({ sections: _s, ...c }) => ({ ...c, image_url: null, venue_id: menu.venue_id, created_at: '2026-10-30T00:00:00Z' }));
const sections = menu.categories.flatMap((c) => c.sections.map(({ items: _i, ...s }) => ({ ...s, category_id: c.id, venue_id: menu.venue_id })));
const items = menu.categories.flatMap((c) => c.sections.flatMap((s) => s.items.map((it, i) => ({
  id: it.id, subcategory_id: s.id, venue_id: menu.venue_id, category_name: c.name,
  name: it.name, name_bs: it.name_bs, name_ar: it.name_ar,
  description: it.description, description_bs: it.description_bs, description_ar: it.description_ar,
  price: it.price, is_available: true, station: 'kitchen', allergens: it.allergens, dietary_tags: it.dietary_tags,
  merchandising_tags: [], meal_role: it.meal_role, sort_order: i + 1,
  image_url: it.no_photo ? null : `/menu/${it.id}/1152.webp`,
  featured_rank: it.featured_rank ?? null, featured_note: it.featured_note ?? null,
  featured_note_bs: it.featured_note_bs ?? null, featured_note_ar: it.featured_note_ar ?? null,
  portion_note: null, prep_minutes: null, new_until: null, sale_kind: null, sale_value: null, sale_label: null,
  sale_starts_at: null, sale_ends_at: null, available_from: null, available_to: null, margin_score: 0, food_cost: null,
}))));
const byId = new Map(items.map((it) => [it.id, it]));

/** PostgREST's filters, as far as the guest app uses them. */
function filter(rows, params) {
  let out = rows;
  for (const [key, value] of params) {
    if (['select', 'order', 'limit', 'offset'].includes(key)) continue;
    if (key === 'or') { out = out.filter((r) => r.featured_rank != null); continue; }
    if (value.startsWith('eq.')) out = out.filter((r) => String(r[key]) === decodeURIComponent(value.slice(3)));
    else if (value.startsWith('in.(')) {
      const set = new Set(value.slice(4, -1).split(',').map((v) => v.replace(/^"|"$/g, '')));
      out = out.filter((r) => set.has(String(r[key])));
    } else if (value === 'not.is.null') out = out.filter((r) => r[key] != null);
    else if (value === 'is.null') out = out.filter((r) => r[key] == null);
  }
  return out;
}

const SESSION = { id: 'preview-session', token: 'preview-session-token', table: 7, guest: null };
const orders = [];

function rpc(fn, body) {
  switch (fn) {
    case 'guest_table_venue': return { venue: VERA };
    case 'guest_check_venue_token': return { valid: true, ordering_enabled: true, paused_message: null, max_table_number: 20, venue: VERA };
    case 'guest_inspect_table':
      return SESSION.guest
        ? { status: 'returning', role: 'host', session_id: SESSION.id, session_token: SESSION.token, guest_name: SESSION.guest }
        : { status: 'empty' };
    case 'guest_start_table_session':
      SESSION.guest = body._guest_name || 'Guest';
      SESSION.table = Number(body._table_number) || 7;
      return { status: 'created', role: 'host', session_id: SESSION.id, session_token: SESSION.token, guest_name: SESSION.guest };
    case 'guest_resume_session':
      return { status: 'active', session_id: SESSION.id, table_number: SESSION.table, guest_name: SESSION.guest };
    case 'guest_get_service_status':
      return { ordering_enabled: true, online_card_enabled: false, pay_at_table_enabled: true, paused_message: null, last_order_time: null, kitchen_delay_minutes: 0, recommendations_enabled: false };
    case 'touch_session': return true;
    case 'guest_search_menu': {
      const q = String(body._query ?? '').toLowerCase();
      return q.length < 2 ? [] : items.filter((it) => [it.name, it.name_bs, it.name_ar, it.description].some((t) => String(t ?? '').toLowerCase().includes(q)));
    }
    case 'guest_place_order': {
      const lines = (body._items ?? []).map((l) => ({ ...l, item: byId.get(l.menu_item_id) })).filter((l) => l.item);
      const tip = Number(body._tip ?? 0);
      const total = lines.reduce((s, l) => s + Number(l.item.price) * (l.quantity ?? 1), 0) + tip;
      const code = String(orders.length + 1).padStart(3, '0');
      const order = {
        id: `preview-order-${orders.length + 1}`, status: 'pending', total, notes: body._notes ?? null,
        guest_name: body._guest_name ?? SESSION.guest, payment_method: body._payment_method ?? 'cash',
        payment_status: 'unpaid', created_at: new Date().toISOString(), held: false,
        order_items: lines.map((l, i) => ({
          id: `line-${orders.length + 1}-${i}`, quantity: l.quantity ?? 1, unit_price: Number(l.item.price),
          notes: l.notes ?? null, status: 'pending', components: null,
          menu_items: { name: l.item.name, name_bs: l.item.name_bs, name_ar: l.item.name_ar },
        })),
      };
      orders.push(order);
      console.log(`  order #${code} for table ${SESSION.table}: ${lines.map((l) => `${l.quantity ?? 1}× ${l.item.name}`).join(', ')} — ${total.toFixed(2)} KM`);
      return {
        order_id: order.id, order_code: code, status: 'pending', total, tip_amount: tip,
        payment_method: order.payment_method, payment_status: 'unpaid', awaiting_payment: false,
        client_order_id: body._client_order_id ?? null, held: false, held_reason: null,
      };
    }
    case 'guest_get_tab': return { orders, bill_request: null, members: [SESSION.guest ?? 'Guest'] };
    case 'guest_call_waiter': console.log(`  table ${SESSION.table} calls the waiter (${body._reason ?? 'assist'})`); return { call_id: 'preview-call', status: 'pending' };
    case 'guest_request_bill': console.log(`  table ${SESSION.table} asks for the bill`); return { bill_request_id: 'preview-bill', status: 'pending' };
    case 'guest_list_pending_join_requests': return [];
    case 'guest_get_recommendations': case 'get_popular_items': case 'guest_get_combos': return [];
    case 'record_analytics_events': return 1;
    default: return null;
  }
}

const api = createServer((req, res) => {
  const cors = {
    'Access-Control-Allow-Origin': req.headers.origin ?? '*',
    'Access-Control-Allow-Headers': req.headers['access-control-request-headers'] ?? '*',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Expose-Headers': 'Content-Range',
  };
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    const url = new URL(req.url, `http://localhost:${API_PORT}`);
    const send = (body, status = 200) => { res.writeHead(status, { ...cors, 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
    const vera = (req.headers['x-venue'] ?? '') === VERA;
    const one = (req.headers.accept ?? '').includes('vnd.pgrst.object');
    const table = url.pathname.match(/^\/rest\/v1\/([a-z_]+)$/)?.[1];
    if (url.pathname.startsWith('/rest/v1/rpc/')) {
      let body = {};
      try { body = raw ? JSON.parse(raw) : {}; } catch { /* empty */ }
      return send(rpc(url.pathname.slice('/rest/v1/rpc/'.length), body));
    }
    if (table) {
      // Only Vera Italia's rows exist here; La Soul's stay in the real database.
      const rows = !vera ? [] : table === 'categories' ? categories : table === 'subcategories' ? sections : table === 'menu_items' ? items : [];
      const found = filter(rows, url.searchParams);
      return send(one ? (found[0] ?? null) : found);
    }
    send({});
  });
});

api.listen(API_PORT, () => {
  console.log(`\n  Vera Italia preview: database stand-in on http://localhost:${API_PORT}`);
  const vite = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['vite', '--port', String(APP_PORT), '--strictPort'], {
    cwd: ROOT,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: {
      ...process.env,
      VITE_SUPABASE_URL: `http://localhost:${API_PORT}`,
      VITE_SUPABASE_PUBLISHABLE_KEY: 'preview-not-a-key',
      VITE_SUPABASE_PROJECT_ID: 'preview',
      VITE_SENTRY_DSN: '',
      VITE_MONRI_ENABLED: 'false',
      VITE_PREVIEW_VENUES: VERA,
    },
  });
  vite.on('exit', (code) => { api.close(); process.exit(code ?? 0); });
  console.log(`  the app on http://localhost:${APP_PORT}/veraitalia/ (website) and /menu/veraitalia/ (menu)\n`);
});
