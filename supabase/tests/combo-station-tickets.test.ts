/**
 * @vitest-environment node
 *
 * Combo parts reach their own station (20261026130000_combo_station_tickets.sql).
 *
 * A combo is one order line at the combo dish's station — the kitchen — with
 * the chosen parts frozen on it. Its drink is the bar's. Before this
 * migration an order of one combo produced no bar ticket at all: the drink
 * existed only as "[BAR]" on the kitchen's paper.
 *
 * What has to hold:
 *  - a combo-only order with a bar drink queues a bar ticket with the drink on
 *    it, its quantity, the line's notes, the drink's own allergens and what it
 *    is part of — through the real release path, held orders included;
 *  - a bar network printer picks that ticket up like any other;
 *  - the kitchen ticket is the combo line, as before, now saying what it held;
 *  - nothing changes for an order without combos: food alone queues no bar
 *    ticket, a plain drink still does;
 *  - "all day" counts the combo's drink at the bar, but never hands the bar an
 *    id that would bump the whole combo.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
// @ts-expect-error -- plain JS harness, no types needed
import { createTestDatabase, actAs } from '../../scripts/db-harness.mjs';

type Db = {
  query: <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<{ rows: T[] }>;
  exec: (sql: string) => Promise<unknown>;
  close: () => Promise<void>;
};

let db: Db;

const SESSION = 'eeeeeeee-0000-0000-0000-000000000001';
const TOKEN = 'sess-token-7';
const STAFF = '0a0a0a0a-0000-4000-8000-000000000002';
const BAR_TOKEN = 'b'.repeat(40);
const KITCHEN_TOKEN = 'k'.repeat(40);

const CHICKEN = 'cccccccc-0000-0000-0000-000000000001';
const FRIES = 'cccccccc-0000-0000-0000-000000000003';
const COLA = 'cccccccc-0000-0000-0000-000000000005';
const LEMONADE = 'cccccccc-0000-0000-0000-000000000006';
const COMBO = 'cccccccc-0000-0000-0000-000000000010';
/** A bar combo with a kitchen part: the same rule, the other way round. */
const COFFEE_CAKE = 'cccccccc-0000-0000-0000-000000000020';
const ESPRESSO = 'cccccccc-0000-0000-0000-000000000021';
const CAKE = 'cccccccc-0000-0000-0000-000000000022';

const SLOT_MAIN = 'f0000000-0000-4000-8000-000000000001';
const SLOT_SIDE = 'f0000000-0000-4000-8000-000000000002';
const SLOT_DRINK = 'f0000000-0000-4000-8000-000000000003';
const SLOT_COFFEE = 'f0000000-0000-4000-8000-000000000021';
const SLOT_CAKE = 'f0000000-0000-4000-8000-000000000022';

async function seed() {
  await db.exec(`
    TRUNCATE public.audit_log, public.order_ticket_events, public.suggestion_conversions,
             public.order_items, public.orders, public.printers,
             public.table_sessions, public.tables, public.menu_combo_options, public.menu_combo_slots,
             public.menu_items, public.subcategories, public.categories, public.order_code_counters
      RESTART IDENTITY CASCADE;
    DELETE FROM public.user_roles;
    DELETE FROM auth.users;
    INSERT INTO auth.users(id) VALUES ('${STAFF}');
    INSERT INTO public.user_roles(user_id, role) VALUES ('${STAFF}', 'staff');

    UPDATE public.restaurant_settings
       SET ordering_enabled = true, online_card_enabled = false, hold_first_order_km = NULL
     WHERE id = 1;

    INSERT INTO public.categories(id, name, sort_order) VALUES
      ('aaaaaaaa-0000-0000-0000-000000000001', 'Food', 1),
      ('aaaaaaaa-0000-0000-0000-000000000002', 'Drinks', 2);
    INSERT INTO public.subcategories(id, category_id, name, sort_order) VALUES
      ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'Burgers', 1),
      ('bbbbbbbb-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000002', 'Soft drinks', 1);
    INSERT INTO public.menu_items(id, subcategory_id, name, price, is_available, station, allergens) VALUES
      ('${CHICKEN}',     'bbbbbbbb-0000-0000-0000-000000000001', 'Chicken Burger', 16.00, true, 'kitchen', ARRAY['gluten','egg']),
      ('${FRIES}',       'bbbbbbbb-0000-0000-0000-000000000001', 'Fries', 5.00, true, 'kitchen', '{}'),
      ('${COLA}',        'bbbbbbbb-0000-0000-0000-000000000003', 'Coca-Cola', 4.00, true, 'bar', '{}'),
      ('${LEMONADE}',    'bbbbbbbb-0000-0000-0000-000000000003', 'Strawberry Lemonade', 5.50, true, 'bar', ARRAY['sulphites']),
      ('${COMBO}',       'bbbbbbbb-0000-0000-0000-000000000001', 'Chicken Burger Combo', 22.00, true, 'kitchen', ARRAY['gluten']),
      ('${ESPRESSO}',    'bbbbbbbb-0000-0000-0000-000000000003', 'Espresso', 3.00, true, 'bar', '{}'),
      ('${CAKE}',        'bbbbbbbb-0000-0000-0000-000000000001', 'Chocolate Cake', 6.00, true, 'kitchen', ARRAY['milk','egg']),
      ('${COFFEE_CAKE}', 'bbbbbbbb-0000-0000-0000-000000000003', 'Coffee & Cake', 8.00, true, 'bar', '{}');

    INSERT INTO public.menu_combo_slots(id, combo_item_id, sort_order, label) VALUES
      ('${SLOT_MAIN}',   '${COMBO}', 1, 'Burger'),
      ('${SLOT_SIDE}',   '${COMBO}', 2, 'Side'),
      ('${SLOT_DRINK}',  '${COMBO}', 3, 'Drink'),
      ('${SLOT_COFFEE}', '${COFFEE_CAKE}', 1, 'Coffee'),
      ('${SLOT_CAKE}',   '${COFFEE_CAKE}', 2, 'Cake');
    INSERT INTO public.menu_combo_options(slot_id, item_id, surcharge, sort_order) VALUES
      ('${SLOT_MAIN}',   '${CHICKEN}', 0, 1),
      ('${SLOT_SIDE}',   '${FRIES}', 0, 1),
      ('${SLOT_DRINK}',  '${COLA}', 0, 1),
      ('${SLOT_DRINK}',  '${LEMONADE}', 1, 2),
      ('${SLOT_COFFEE}', '${ESPRESSO}', 0, 1),
      ('${SLOT_CAKE}',   '${CAKE}', 0, 1);

    INSERT INTO public.tables(id, table_number) VALUES ('dddddddd-0000-0000-0000-000000000001', 7);
    INSERT INTO public.table_sessions(id, table_id, token, is_active, guest_name, last_heartbeat_at) VALUES
      ('${SESSION}', 'dddddddd-0000-0000-0000-000000000001', '${TOKEN}', true, 'Amina', now());

    INSERT INTO public.printers(name, station, poll_token) VALUES
      ('Kitchen printer', 'kitchen', '${KITCHEN_TOKEN}'),
      ('Bar printer', 'bar', '${BAR_TOKEN}');
  `);
  // A test places several orders in a row; the per-minute burst guard has its own tests.
  await db.exec(`ALTER TABLE public.orders DISABLE TRIGGER trg_enforce_order_limits`);
  await actAs(db, null);
}

type Result = { order_id: string; held?: boolean };

let keyN = 0;
async function place(items: unknown[]): Promise<Result> {
  keyN += 1;
  const key = `00000000-0000-4000-8000-${String(keyN).padStart(12, '0')}`;
  const { rows } = await db.query<{ result: Result }>(
    `SELECT public.guest_place_order($1, $2, 'Amina', 'cash', $3::jsonb, 0, $4) AS result`,
    [SESSION, TOKEN, JSON.stringify(items), key],
  );
  return rows[0].result;
}

const combo = (drink: string, extra: Record<string, unknown> = {}) => ({
  menu_item_id: COMBO,
  quantity: 1,
  choices: [{ slot_id: SLOT_DRINK, item_id: drink }],
  ...extra,
});

interface PayloadItem {
  id: string; menu_item_id: string | null; name: string; quantity: number; notes: string | null;
  status: string; station: string; allergens: string[]; components?: { name: string; station: string }[];
  part_of?: string; slot_label?: string; combo_menu_item_id?: string;
}

const tickets = async (orderId: string) => {
  const { rows } = await db.query<{ ticket_type: string; status: string; payload: { station: string; items: PayloadItem[] } }>(
    `SELECT ticket_type, status, payload FROM public.order_ticket_events WHERE order_id = $1 ORDER BY ticket_type`,
    [orderId]);
  return rows;
};

const ticket = async (orderId: string, type: string) => (await tickets(orderId)).find((t) => t.ticket_type === type);

describe('combo parts at their own station', () => {
  beforeAll(async () => { db = await createTestDatabase({ quiet: true }); }, 180_000);
  afterAll(async () => { await db?.close(); });
  beforeEach(seed);

  describe('the bar ticket', () => {
    it('is queued for an order of one combo with a bar drink', async () => {
      const { order_id } = await place([combo(LEMONADE, { quantity: 2, notes: 'lemonade without ice' })]);
      const rows = await tickets(order_id);
      expect(rows.map((r) => [r.ticket_type, r.status])).toEqual([['bar', 'queued'], ['kitchen', 'queued']]);

      const bar = (await ticket(order_id, 'bar'))!;
      expect(bar.payload.station).toBe('bar');
      expect(bar.payload.items).toHaveLength(1);
      const [drink] = bar.payload.items;
      expect(drink).toMatchObject({
        menu_item_id: LEMONADE,
        name: 'Strawberry Lemonade',
        quantity: 2,
        notes: 'lemonade without ice',
        status: 'pending',
        station: 'bar',
        allergens: ['sulphites'],
        slot_label: 'Drink',
        part_of: 'Chicken Burger Combo',
        combo_menu_item_id: COMBO,
      });
      // The part is that order line, seen from the bar.
      const { rows: lines } = await db.query<{ id: string }>(`SELECT id FROM public.order_items WHERE order_id = $1`, [order_id]);
      expect(drink.id).toBe(lines[0].id);
    });

    it('lists the combo drink next to a plain drink', async () => {
      const { order_id } = await place([combo(COLA), { menu_item_id: ESPRESSO, quantity: 1 }]);
      const names = (await ticket(order_id, 'bar'))!.payload.items.map((i) => [i.name, i.part_of ?? null]);
      expect(names.sort()).toEqual([['Coca-Cola', 'Chicken Burger Combo'], ['Espresso', null]]);
    });

    it('is queued when a held combo order is confirmed, not before', async () => {
      await db.exec(`UPDATE public.restaurant_settings SET hold_first_order_km = 10 WHERE id = 1`);
      const held = await place([combo(LEMONADE)]);
      expect(held.held).toBe(true);
      expect(await tickets(held.order_id)).toEqual([]);

      await actAs(db, STAFF);
      await db.query(`SELECT public.staff_release_held_order($1)`, [held.order_id]);
      await actAs(db, null);

      expect((await tickets(held.order_id)).map((t) => t.ticket_type)).toEqual(['bar', 'kitchen']);
      expect((await ticket(held.order_id, 'bar'))!.payload.items[0]).toMatchObject({ name: 'Strawberry Lemonade', part_of: 'Chicken Burger Combo' });
    });

    it('is picked up by the bar network printer like any other', async () => {
      const { order_id } = await place([combo(LEMONADE)]);
      const barTicket = (await db.query<{ id: string }>(
        `SELECT id FROM public.order_ticket_events WHERE order_id = $1 AND ticket_type = 'bar'`, [order_id])).rows[0];

      const { rows: checkin } = await db.query<{ r: { next_ticket_id: string | null } }>(
        `SELECT public.cloud_printer_checkin($1, 'star_cloudprnt', NULL, '200 OK') AS r`, [BAR_TOKEN]);
      expect(checkin[0].r.next_ticket_id).toBe(barTicket.id);

      const { rows: claimed } = await db.query<{ r: Record<string, unknown> | null }>(
        `SELECT public.cloud_print_claim($1, NULL) AS r`, [BAR_TOKEN]);
      expect(claimed[0].r).toMatchObject({ ticket_id: barTicket.id, order_id, ticket_type: 'bar' });

      // The kitchen printer gets the kitchen ticket, and only that.
      const { rows: kitchen } = await db.query<{ r: Record<string, unknown> | null }>(
        `SELECT public.cloud_print_claim($1, NULL) AS r`, [KITCHEN_TOKEN]);
      expect(kitchen[0].r).toMatchObject({ order_id, ticket_type: 'kitchen' });
      expect((await db.query<{ r: unknown }>(`SELECT public.cloud_print_claim($1, NULL) AS r`, [KITCHEN_TOKEN])).rows[0].r).toBeNull();
    });
  });

  describe('the kitchen ticket', () => {
    it('is the combo line, as before, saying what it held', async () => {
      const { order_id } = await place([combo(LEMONADE, { notes: 'no mayo' })]);
      const kitchen = (await ticket(order_id, 'kitchen'))!;
      expect(kitchen.payload.items).toHaveLength(1);
      const [line] = kitchen.payload.items;
      expect(line).toMatchObject({
        menu_item_id: COMBO, name: 'Chicken Burger Combo', quantity: 1, notes: 'no mayo',
        station: 'kitchen', allergens: ['gluten'],
      });
      expect(line.part_of).toBeUndefined();
      // Every part, the bar's drink marked as the bar's.
      expect(line.components?.map((c) => [c.name, c.station])).toEqual([
        ['Chicken Burger', 'kitchen'], ['Fries', 'kitchen'], ['Strawberry Lemonade', 'bar'],
      ]);
    });

    it('a plain dish carries no components key at all', async () => {
      const { order_id } = await place([{ menu_item_id: CHICKEN, quantity: 1 }]);
      const [line] = (await ticket(order_id, 'kitchen'))!.payload.items;
      expect(Object.keys(line).sort()).toEqual(['allergens', 'id', 'menu_item_id', 'name', 'notes', 'quantity', 'station', 'status']);
    });

    it('gets a kitchen part of a bar combo as its own line', async () => {
      const { order_id } = await place([{ menu_item_id: COFFEE_CAKE, quantity: 1 }]);
      expect((await ticket(order_id, 'bar'))!.payload.items.map((i) => i.name)).toEqual(['Coffee & Cake']);
      expect((await ticket(order_id, 'kitchen'))!.payload.items).toEqual([
        expect.objectContaining({ name: 'Chocolate Cake', part_of: 'Coffee & Cake', allergens: ['milk', 'egg'], station: 'kitchen' }),
      ]);
    });
  });

  describe('orders without combos', () => {
    it('food alone still queues no bar ticket', async () => {
      const { order_id } = await place([{ menu_item_id: CHICKEN, quantity: 1 }, { menu_item_id: FRIES, quantity: 1 }]);
      expect((await tickets(order_id)).map((t) => t.ticket_type)).toEqual(['kitchen']);
    });

    it('a plain drink still queues a bar ticket, and only that', async () => {
      const { order_id } = await place([{ menu_item_id: ESPRESSO, quantity: 2, notes: 'extra hot' }]);
      const rows = await tickets(order_id);
      expect(rows.map((t) => t.ticket_type)).toEqual(['bar']);
      expect(rows[0].payload.items).toEqual([expect.objectContaining({
        menu_item_id: ESPRESSO, name: 'Espresso', quantity: 2, notes: 'extra hot', station: 'bar', allergens: [],
      })]);
      expect(rows[0].payload.items[0].part_of).toBeUndefined();
    });

    it('a combo whose parts are all made in the kitchen queues no bar ticket', async () => {
      await db.exec(`UPDATE public.menu_items SET station = 'kitchen' WHERE id = '${COLA}'`);
      const { order_id } = await place([combo(COLA)]);
      expect((await tickets(order_id)).map((t) => t.ticket_type)).toEqual(['kitchen']);
    });

    it('a receipt-type ticket still gets every line and no part lines', async () => {
      const { order_id } = await place([combo(LEMONADE), { menu_item_id: ESPRESSO, quantity: 1 }]);
      await db.query(`SELECT public.enqueue_order_ticket($1, 'receipt')`, [order_id]);
      const receipt = (await ticket(order_id, 'receipt'))!;
      expect(receipt.payload.items.map((i) => i.name).sort()).toEqual(['Chicken Burger Combo', 'Espresso']);
    });
  });

  describe('all day', () => {
    type Row = { menu_item_id: string; name: string; station: string; qty_pending: number; qty_preparing: number; pending_ids: string[]; open_ids: string[] };
    const allDay = async (station: string | null) => {
      await actAs(db, STAFF);
      const { rows } = await db.query<Row>(
        `SELECT menu_item_id, name, station, qty_pending, qty_preparing, pending_ids, open_ids FROM public.kds_all_day($1)`, [station]);
      await actAs(db, null);
      return rows;
    };

    it('counts the combo drink at the bar, without an id the bar could bump', async () => {
      await place([combo(LEMONADE, { quantity: 2 })]);
      await place([{ menu_item_id: LEMONADE, quantity: 1 }]);
      const bar = await allDay('bar');
      expect(bar).toHaveLength(1);
      expect(bar[0]).toMatchObject({ menu_item_id: LEMONADE, name: 'Strawberry Lemonade', station: 'bar', qty_pending: 3 });
      // Only the plain lemonade's line: the combo line is the kitchen's to bump.
      const { rows: plain } = await db.query<{ id: string }>(
        `SELECT id FROM public.order_items WHERE menu_item_id = $1`, [LEMONADE]);
      expect(bar[0].pending_ids).toEqual([plain[0].id]);
      expect(bar[0].open_ids).toEqual([plain[0].id]);
    });

    it('a row made only of combo parts has no ids', async () => {
      await place([combo(COLA)]);
      const [row] = await allDay('bar');
      expect(row).toMatchObject({ name: 'Coca-Cola', qty_pending: 1, pending_ids: [], open_ids: [] });
    });

    it('moves with the combo line', async () => {
      const { order_id } = await place([combo(COLA)]);
      const { rows } = await db.query<{ id: string }>(`SELECT id FROM public.order_items WHERE order_id = $1`, [order_id]);
      await actAs(db, STAFF);
      await db.query(`SELECT public.staff_bump_order_item($1, 'preparing')`, [rows[0].id]);
      await actAs(db, null);
      expect((await allDay('bar'))[0]).toMatchObject({ qty_pending: 0, qty_preparing: 1 });
    });

    it('leaves the kitchen count as it was: the combo, not its parts', async () => {
      await place([combo(LEMONADE)]);
      const kitchen = await allDay('kitchen');
      expect(kitchen.map((r) => [r.name, r.qty_pending])).toEqual([['Chicken Burger Combo', 1]]);
      expect(kitchen[0].pending_ids).toHaveLength(1);

      const everything = await allDay(null);
      expect(everything.map((r) => [r.name, r.station]).sort()).toEqual([
        ['Chicken Burger Combo', 'kitchen'], ['Strawberry Lemonade', 'bar'],
      ]);
    });
  });

  it('a second run of the migration changes nothing', async () => {
    const sql = readFileSync(path.join(__dirname, '..', 'migrations', '20261026130000_combo_station_tickets.sql'), 'utf8');
    await db.exec(sql);
    const { order_id } = await place([combo(LEMONADE)]);
    expect((await tickets(order_id)).map((t) => t.ticket_type)).toEqual(['bar', 'kitchen']);
  });
});
