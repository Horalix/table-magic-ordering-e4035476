/**
 * Casa Demo before its first guest (demo mode only): the restaurant itself —
 * its floor, its people, its settings, its menu and what is on offer.
 * Written straight into the tables, as the restaurant's own setup would
 * have left them.
 */
import type { SqlDb } from '../backend/types';
import { ACCOUNTS, RESTAURANT, SPARE_VENUE, VENUE_QR_TOKEN, tableQrToken } from '../brand';
import { CATEGORIES, COMBO, ITEM, ITEMS, PAIRINGS, SUBCATEGORIES } from './menu';
import { addDays, atLocal, businessDay, insertRows, iso } from './util';

const VENUE = RESTAURANT.dbId;

export const SECTIONS = [
  { id: '5ec70000-0000-4000-8000-000000000001', name: 'Terrace', color: '#B0641F', tables: [1, 2, 3, 4, 5] },
  { id: '5ec70000-0000-4000-8000-000000000002', name: 'Dining room', color: '#5E7F5A', tables: [6, 7, 8, 9, 10] },
  { id: '5ec70000-0000-4000-8000-000000000003', name: 'Garden', color: '#3F7C85', tables: [11, 12, 13, 14] },
] as const;

export const TABLE_COUNT = 14;
export const tableId = (n: number) => `7ab1e000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;
export const sectionOfTable = (n: number) => SECTIONS.find((s) => (s.tables as readonly number[]).includes(n))!;

export interface DemoWaiter {
  /** waiters.id */
  id: string;
  userId: string;
  name: string;
  username: string;
  /** The section they usually work. */
  section: string;
  /** How well guests rate them, 1–5: gives the performance page something to compare. */
  skill: number;
}

export const WAITERS: DemoWaiter[] = [
  { id: 'a17e0000-0000-4000-8000-000000000001', userId: ACCOUNTS.waiter.id, name: 'Amra Kovač', username: 'amra', section: SECTIONS[0].id, skill: 4.8 },
  { id: 'a17e0000-0000-4000-8000-000000000002', userId: 'de300000-0000-4000-8000-000000000012', name: 'Tarik Begić', username: 'tarik', section: SECTIONS[1].id, skill: 4.5 },
  { id: 'a17e0000-0000-4000-8000-000000000003', userId: 'de300000-0000-4000-8000-000000000013', name: 'Selma Hodžić', username: 'selma', section: SECTIONS[2].id, skill: 4.6 },
  { id: 'a17e0000-0000-4000-8000-000000000004', userId: 'de300000-0000-4000-8000-000000000014', name: 'Emir Delić', username: 'emir', section: SECTIONS[1].id, skill: 4.1 },
];

export const MANAGER = { id: 'de300000-0000-4000-8000-000000000004', email: 'dino@casademo.example', name: 'Dino Softić' };

export const waiterForTable = (tableNumber: number, variant = 0): DemoWaiter => {
  const section = sectionOfTable(tableNumber).id;
  const there = WAITERS.filter((w) => w.section === section);
  return there[variant % there.length];
};

export async function seedRestaurant(db: SqlDb, now: Date): Promise<void> {
  const today = businessDay(now);
  const opened = iso(atLocal(addDays(today, -200), 9));

  // ---- the restaurant
  await db.query(`UPDATE public.venues SET slug = $2, name = $3, is_live = true WHERE id = $1::text::uuid`, [VENUE, RESTAURANT.slug, RESTAURANT.name]);
  // The schema ships a second restaurant with a menu of its own. The demo is one restaurant: it goes, with everything of its.
  await db.query(
    `DO $$
     DECLARE r record;
     BEGIN
       FOR r IN SELECT c.table_name FROM information_schema.columns c JOIN information_schema.tables t
                  ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
                 WHERE c.table_schema = 'public' AND c.column_name = 'venue_id' LOOP
         EXECUTE format('DELETE FROM public.%I WHERE venue_id = %L', r.table_name, '${SPARE_VENUE.dbId}');
       END LOOP;
       DELETE FROM public.venues WHERE id = '${SPARE_VENUE.dbId}';
     END $$`);
  await db.query(
    `UPDATE public.restaurant_settings SET
       print_header = $2, print_footer = 'Hvala / Thank you', print_enabled = true, print_auto = true,
       ordering_enabled = true, pay_at_table_enabled = true, online_card_enabled = true, recommendations_enabled = true,
       venue_qr_token = $3, kitchen_capacity_minutes = 240,
       -- A first order has to be large before it waits for a waiter to confirm it (one such order is seeded).
       hold_first_order_km = 150, hold_first_order_items = 16, hold_unpaid_km = 400, hold_burst_sessions = NULL,
       -- No service hours: the demo takes orders whenever it is shown, at midnight too.
       service_open = NULL, service_close = NULL,
       reservations_enabled = true, reservations_open = '11:00', reservations_close = '22:00',
       reservations_max_party = 12, reservations_days_ahead = 30, reservations_lead_minutes = 60,
       reservations_phone = $4, reservations_note = 'Tables are held for 15 minutes.'
     WHERE venue_id = $1::text::uuid`,
    [VENUE, RESTAURANT.name, VENUE_QR_TOKEN, RESTAURANT.phone],
  );

  // ---- the floor
  await insertRows(db, 'sections', SECTIONS.map((s, i) => ({ id: s.id, name: s.name, color: s.color, sort_order: i + 1, venue_id: VENUE, created_at: opened })));
  await insertRows(db, 'tables', Array.from({ length: TABLE_COUNT }, (_, i) => i + 1).map((n) => ({
    id: tableId(n), table_number: n, status: 'available', qr_token: tableQrToken(n), section_id: sectionOfTable(n).id, venue_id: VENUE, created_at: opened,
  })));

  // ---- the people
  const users = [
    { ...ACCOUNTS.admin, name: 'Lejla Hadžić' },
    { ...ACCOUNTS.kitchen, name: 'Kitchen display' },
    { ...ACCOUNTS.monitor, name: 'Floor screen' },
    { id: MANAGER.id, email: MANAGER.email, password: 'demo-manager-pass', name: MANAGER.name },
    ...WAITERS.map((w) => ({
      id: w.userId, email: w.userId === ACCOUNTS.waiter.id ? ACCOUNTS.waiter.email : `${w.username}@staff.casademo.example`,
      password: ACCOUNTS.waiter.password, name: w.name,
    })),
  ];
  await insertRows(db, 'auth.users', users.map((u) => ({
    id: u.id, email: u.email, demo_password: u.password, created_at: opened, raw_user_meta_data: { name: u.name },
  })));
  await insertRows(db, 'user_roles', [
    // The owner: admin of no one restaurant, which is how the schema says "of all of them".
    { user_id: ACCOUNTS.admin.id, role: 'admin', venue_id: null },
    { user_id: MANAGER.id, role: 'admin', venue_id: VENUE },
    { user_id: ACCOUNTS.kitchen.id, role: 'staff', venue_id: VENUE },
    { user_id: ACCOUNTS.monitor.id, role: 'staff', venue_id: VENUE },
    ...WAITERS.map((w) => ({ user_id: w.userId, role: 'staff', venue_id: VENUE })),
  ]);
  await insertRows(db, 'waiters', WAITERS.map((w) => ({
    id: w.id, user_id: w.userId, display_name: w.name, username: w.username, is_active: true, venue_id: VENUE, created_at: opened,
  })));
  await db.query(
    `UPDATE public.waiters SET pin_hash = extensions.crypt($1::text, extensions.gen_salt('bf', 4)), pin_set_at = $2::text::timestamptz WHERE venue_id = $3::text::uuid`,
    [RESTAURANT.floorPin, opened, VENUE],
  );
  await insertRows(db, 'section_assignments', WAITERS.map((w) => ({ section_id: w.section, waiter_id: w.id, shift_date: today, venue_id: VENUE })));

  // ---- the menu
  await insertRows(db, 'categories', CATEGORIES.map((c, i) => ({
    id: c.id, name: c.name, name_bs: c.name_bs, name_ar: c.name_ar, sort_order: i + 1, venue_id: VENUE, created_at: opened,
  })));
  await insertRows(db, 'subcategories', SUBCATEGORIES.map((s, i) => ({
    id: s.id, category_id: s.category, name: s.name, name_bs: s.name_bs, name_ar: s.name_ar, sort_order: i + 1, venue_id: VENUE, created_at: opened,
  })));
  await insertRows(db, 'menu_items', ITEMS.map((item, i) => ({
    id: item.id, subcategory_id: item.sub,
    name: item.name, name_bs: item.name_bs, name_ar: item.name_ar,
    description: item.description, description_bs: item.description_bs, description_ar: item.description_ar,
    price: item.price, food_cost: item.cost, image_url: `/menu/${item.id}/768.webp`,
    is_available: true, sort_order: i + 1, station: item.station, meal_role: item.role, prep_minutes: item.prep,
    allergens: item.allergens, dietary_tags: item.diet, merchandising_tags: item.badges, portion_note: item.portion ?? null,
    margin_score: Math.round(100 * (1 - item.cost / item.price)), venue_id: VENUE, created_at: opened, updated_at: opened,
  })));

  // The combo: its parts, and what may fill each.
  const slotId = (i: number) => `c0b00000-0000-4000-8000-00000000000${i + 1}`;
  await insertRows(db, 'menu_combo_slots', COMBO.slots.map((slot, i) => ({
    id: slotId(i), combo_item_id: COMBO.item, sort_order: i + 1, label: slot.label, label_bs: slot.label_bs, label_ar: slot.label_ar, venue_id: VENUE,
  })));
  await insertRows(db, 'menu_combo_options', COMBO.slots.flatMap((slot, i) => slot.options.map(([itemId, surcharge], j) => ({
    slot_id: slotId(i), item_id: itemId, surcharge, sort_order: j + 1, venue_id: VENUE,
  }))));

  // What the manager chose to suggest with what.
  await insertRows(db, 'menu_item_recommendations', PAIRINGS.map(([source, recommended, type], i) => ({
    source_item_id: source, recommended_item_id: recommended, recommendation_type: type, priority: 80 - i, enabled: true, venue_id: VENUE,
  })));

  // On offer this week: featured dishes, a lunch deal, a weekend offer, two new arrivals.
  const feature = (id: string, rank: number, note: [string, string, string]) => db.query(
    `UPDATE public.menu_items SET featured_rank = $2::int, featured_note = $3, featured_note_bs = $4, featured_note_ar = $5 WHERE id = $1::text::uuid`,
    [id, rank, ...note],
  );
  await feature(ITEM.truffleRisotto, 1, ['Black truffle from Istria, shaved to order', 'Crni tartuf iz Istre, ribamo ga pred vama', 'كمأة سوداء من إستريا تُبشر عند الطلب']);
  await feature(ITEM.casaBurger, 2, ['Our best seller since day one', 'Naš najprodavaniji od prvog dana', 'الأكثر مبيعاً منذ اليوم الأول']);
  await feature(ITEM.cheesecake, 3, ['Baked every morning', 'Pečemo ga svako jutro', 'تُخبز كل صباح']);
  const saleEnds = iso(atLocal(addDays(today, 9), 23));
  await db.query(
    `UPDATE public.menu_items SET sale_kind = 'percent', sale_value = 20, sale_label = 'lunch_deal', sale_starts_at = $2::text::timestamptz, sale_ends_at = $3::text::timestamptz WHERE id = $1::text::uuid`,
    [ITEM.arrabbiata, iso(atLocal(addDays(today, -5), 8)), saleEnds],
  );
  await db.query(
    `UPDATE public.menu_items SET sale_kind = 'price', sale_value = 5.5, sale_label = 'happy_hour', sale_starts_at = $2::text::timestamptz, sale_ends_at = $3::text::timestamptz WHERE id = $1::text::uuid`,
    [ITEM.lemonMint, iso(atLocal(addDays(today, -2), 8)), saleEnds],
  );
  await db.query(
    `UPDATE public.menu_items SET merchandising_tags = array_append(merchandising_tags, 'new'), new_until = $2::text::date WHERE id = ANY($1::text::uuid[])`,
    [`{${ITEM.matcha},${ITEM.arancini}}`, addDays(today, 12)],
  );

  // Two ticket printers that check in over the network (Admin → Printing).
  await insertRows(db, 'printers', [
    { name: 'Kitchen pass', station: 'kitchen', paper_width: 80, enabled: true, protocol: 'star_cloudprnt', device_mac: '00:11:62:1b:4f:a2', last_seen_at: iso(now), last_status: 'online', venue_id: VENUE, created_at: opened },
    { name: 'Bar', station: 'bar', paper_width: 80, enabled: true, protocol: 'epson_sdp', device_mac: '64:eb:8c:7d:20:19', last_seen_at: iso(now), last_status: 'online', venue_id: VENUE, created_at: opened },
  ]);
}
