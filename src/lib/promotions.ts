/**
 * What a guest is charged, computed the way the server charges it.
 *
 * The server is the authority: `price_order_lines()` in
 * supabase/migrations/20261026100000_promotions.sql prices every order, and
 * refuses one whose screen showed a different price. This module exists so
 * the screen and the till agree in the first place — a strikethrough the
 * guest is not actually given is worse than no sale at all.
 *
 * Money is computed in integer cents. 4.30 at 15 % off is 365.5 cents, which
 * floating point stores as 365.4999… and rounds to 3.65; the database rounds
 * the exact value to 3.66. Integer cents make the half exact.
 */

/* ---- Sales ------------------------------------------------------------- */

/**
 * Labels the owner can put on a sale. A fixed list, translated in i18n.ts as
 * `sale_label_<key>`: free text would become fake urgency within a week and
 * could not be shown in Bosnian and Arabic.
 */
export const SALE_LABELS = ['happy_hour', 'weekend_offer', 'lunch_deal', 'ramadan_offer', 'intro_price'] as const;
export type SaleLabel = (typeof SALE_LABELS)[number];

export const SALE_LABEL_NAMES: Record<SaleLabel, string> = {
  happy_hour: 'Happy hour',
  weekend_offer: 'Weekend offer',
  lunch_deal: 'Lunch deal',
  ramadan_offer: 'Ramadan offer',
  intro_price: 'Introductory price',
};

export interface SaleFields {
  price: number | string;
  sale_kind?: string | null;
  sale_value?: number | string | null;
  sale_starts_at?: string | null;
  sale_ends_at?: string | null;
  sale_label?: string | null;
}

const cents = (amount: number | string) => Math.round(Number(amount) * 100);
const ms = (iso: string | null | undefined) => (iso ? Date.parse(iso) : null);

/** The sale price at `at`, or null when the dish is not on sale then. */
export function salePrice(item: SaleFields, at: number = Date.now()): number | null {
  if (!item.sale_kind || item.sale_value == null || item.price == null) return null;
  const start = ms(item.sale_starts_at);
  const end = ms(item.sale_ends_at);
  if (start !== null && at < start) return null;
  // The end is exclusive, as in SQL: at 20:00 a sale "until 20:00" is over.
  if (end !== null && at >= end) return null;
  const regular = cents(item.price);
  let sale: number;
  if (item.sale_kind === 'percent') sale = Math.round((regular * (100 - Number(item.sale_value))) / 100);
  else if (item.sale_kind === 'price') sale = cents(item.sale_value);
  else return null;
  // A "sale" that is not cheaper is not shown as one.
  return sale < regular ? sale / 100 : null;
}

/** What one of this dish costs at `at`. */
export const unitPrice = (item: SaleFields, at: number = Date.now()): number =>
  salePrice(item, at) ?? Number(item.price);

export interface SaleView {
  /** What the guest pays. */
  price: number;
  /** The menu price, shown struck through. */
  regular: number;
  /** A key from SALE_LABELS, or null for the plain "Sale" badge. */
  label: SaleLabel | null;
  /** When it ends (ms), if it does. */
  endsAt: number | null;
  /** Whole percent off, for "−20 %". */
  percentOff: number;
}

/** Everything a card needs to show a running sale, or null. */
export function saleView(item: SaleFields, at: number = Date.now()): SaleView | null {
  const price = salePrice(item, at);
  if (price === null) return null;
  const regular = Number(item.price);
  const label = SALE_LABELS.includes(item.sale_label as SaleLabel) ? (item.sale_label as SaleLabel) : null;
  return {
    price,
    regular,
    label,
    endsAt: ms(item.sale_ends_at),
    percentOff: Math.round((1 - price / regular) * 100),
  };
}

/** Is a sale configured that has not ended yet (running or scheduled)? */
export function saleScheduled(item: SaleFields, at: number = Date.now()): 'running' | 'scheduled' | 'ended' | null {
  if (!item.sale_kind || item.sale_value == null) return null;
  const end = ms(item.sale_ends_at);
  if (end !== null && at >= end) return 'ended';
  const start = ms(item.sale_starts_at);
  if (start !== null && at < start) return 'scheduled';
  return 'running';
}

/**
 * The next moment any of these prices changes on its own (a sale starting or
 * ending), so a screen can re-price exactly then instead of polling.
 */
export function nextPriceChange(items: SaleFields[], at: number = Date.now()): number | null {
  let next: number | null = null;
  for (const it of items) {
    if (!it.sale_kind) continue;
    for (const t of [ms(it.sale_starts_at), ms(it.sale_ends_at)]) {
      if (t !== null && t > at && (next === null || t < next)) next = t;
    }
  }
  return next;
}

/* ---- The price book ---------------------------------------------------- */

/**
 * The latest sale data seen for each dish, from any read of the menu.
 *
 * Several places add to the order from data that carries no sale columns —
 * the suggestion card (an RPC), search, "order again". The cart store checks
 * here when a line is added, so the line carries the price the guest will be
 * charged whichever button added it.
 */
const book = new Map<string, SaleFields>();

export function rememberPrices(rows: readonly (SaleFields & { id: string })[] | null | undefined) {
  for (const row of rows ?? []) {
    if (row && row.id && row.price != null) book.set(row.id, row);
  }
}

export const knownPrices = (id: string): SaleFields | undefined => book.get(id);

/** Tests only. */
export const __clearPriceBook = () => book.clear();

/* ---- What's new -------------------------------------------------------- */

export interface NewFields {
  merchandising_tags?: string[] | null;
  new_until?: string | null;
}

const SARAJEVO = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Sarajevo',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short',
});
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export interface WallClock { y: number; m: number; d: number; hh: number; mm: number; weekday: number }

/** The restaurant's wall clock at an instant, whatever the phone's own zone. */
export function sarajevoClock(at: number): WallClock {
  const parts = Object.fromEntries(SARAJEVO.formatToParts(new Date(at)).map((p) => [p.type, p.value]));
  return {
    y: Number(parts.year), m: Number(parts.month), d: Number(parts.day),
    hh: Number(parts.hour) % 24, mm: Number(parts.minute),
    weekday: Math.max(0, WEEKDAYS.indexOf(String(parts.weekday))),
  };
}

const iso = (y: number, m: number, d: number) => {
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.toISOString().slice(0, 10);
};

/** The trading day (until 05:00 Sarajevo) an instant belongs to, as YYYY-MM-DD. */
export function sarajevoBusinessDay(at: number = Date.now()): string {
  const c = sarajevoClock(at);
  return c.hh < 5 ? iso(c.y, c.m, c.d - 1) : iso(c.y, c.m, c.d);
}

/** `YYYY-MM-DD` plus `days`, on the calendar. */
export const addDays = (day: string, days: number) => {
  const [y, m, d] = day.split('-').map(Number);
  return iso(y, m, d + days);
};

/** Does this dish wear the "New" badge right now? Ends after its last trading day. */
export function isNew(item: NewFields, at: number = Date.now()): boolean {
  if (!(item.merchandising_tags ?? []).includes('new')) return false;
  if (!item.new_until) return true;
  return sarajevoBusinessDay(at) <= item.new_until;
}

/** How long a fresh "Mark as new" lasts. */
export const NEW_DEFAULT_DAYS = 30;

/* ---- Sarajevo wall-clock time, for the admin ---------------------------- */

/**
 * The instant at which Sarajevo's clock reads `date` `time`.
 *
 * The owner types "Sunday 20:00" meaning Sarajevo, on whatever device; the
 * database stores an instant. Two passes settle the offset across a DST change.
 */
export function sarajevoToInstant(date: string, time: string): number {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const wall = Date.UTC(y, m - 1, d, hh, mm);
  let guess = wall;
  for (let i = 0; i < 2; i += 1) {
    const c = sarajevoClock(guess);
    const seen = Date.UTC(c.y, c.m - 1, c.d, c.hh, c.mm);
    guess += wall - seen;
  }
  return guess;
}

/** An instant as the date and time inputs of a Sarajevo-time form. */
export function instantToSarajevoInputs(at: number): { date: string; time: string } {
  const c = sarajevoClock(at);
  const pad = (n: number) => String(n).padStart(2, '0');
  return { date: `${c.y}-${pad(c.m)}-${pad(c.d)}`, time: `${pad(c.hh)}:${pad(c.mm)}` };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * "today 20:00", "tomorrow 18:00", "Sun 20:00", "2 Nov 20:00" — for staff
 * screens, which are English. Calendar days on the Sarajevo clock.
 */
export function formatSarajevoWhen(at: number, now: number = Date.now()): string {
  const c = sarajevoClock(at);
  const n = sarajevoClock(now);
  const time = `${String(c.hh).padStart(2, '0')}:${String(c.mm).padStart(2, '0')}`;
  const days = Math.round((Date.UTC(c.y, c.m - 1, c.d) - Date.UTC(n.y, n.m - 1, n.d)) / 86_400_000);
  if (days === 0) return `today ${time}`;
  if (days === 1) return `tomorrow ${time}`;
  if (days > 1 && days < 7) return `${WEEKDAYS[c.weekday]} ${time}`;
  return `${c.d} ${MONTHS[c.m - 1]} ${time}`;
}

/**
 * When a sale ends, for the guest: an i18n key and its variables, or null
 * when it is a week or more away (not worth saying) or has no end.
 */
export function saleEndsPhrase(endsAt: number | null, now: number = Date.now()): { key: string; vars: { time: string } } | null {
  if (endsAt === null || endsAt <= now) return null;
  const c = sarajevoClock(endsAt);
  const n = sarajevoClock(now);
  const time = `${String(c.hh).padStart(2, '0')}:${String(c.mm).padStart(2, '0')}`;
  const days = Math.round((Date.UTC(c.y, c.m - 1, c.d) - Date.UTC(n.y, n.m - 1, n.d)) / 86_400_000);
  if (days === 0) return { key: 'sale_until_today', vars: { time } };
  if (days === 1) return { key: 'sale_until_tomorrow', vars: { time } };
  if (days > 1 && days < 7) return { key: `sale_until_wd_${c.weekday}`, vars: { time } };
  return null;
}

/* ---- Combos ------------------------------------------------------------ */

export interface ComboOption extends SaleFields {
  item_id: string;
  surcharge: number | string;
  name: string;
  name_bs?: string | null;
  name_ar?: string | null;
  image_url?: string | null;
  is_available?: boolean | null;
  available_from?: string | null;
  available_to?: string | null;
  station?: string | null;
}

export interface ComboSlot {
  id: string;
  label: string;
  label_bs?: string | null;
  label_ar?: string | null;
  sort_order?: number;
  options: ComboOption[];
}

/** As guest_get_combos() returns it. */
export interface ComboDef {
  combo_item_id: string;
  slots: ComboSlot[];
}

/** slot id → chosen dish id. */
export type ComboChoices = Record<string, string>;

/** A slot with a single dish is included, not chosen. */
export const isFixedSlot = (slot: ComboSlot) => slot.options.length === 1;

/** The choices that make themselves: every single-dish slot. */
export function fixedChoices(def: ComboDef): ComboChoices {
  const out: ComboChoices = {};
  for (const slot of def.slots) if (isFixedSlot(slot)) out[slot.id] = slot.options[0].item_id;
  return out;
}

const chosenOption = (slot: ComboSlot, choices: ComboChoices) =>
  slot.options.find((o) => o.item_id === choices[slot.id]) ?? null;

/** Slots still waiting for the guest to choose, in order. */
export const missingSlots = (def: ComboDef, choices: ComboChoices): ComboSlot[] =>
  def.slots.filter((slot) => !chosenOption(slot, choices));

/** Sum of the surcharges of what was chosen (cents-exact). */
export function comboSurcharge(def: ComboDef, choices: ComboChoices): number {
  let total = 0;
  for (const slot of def.slots) {
    const opt = chosenOption(slot, choices);
    if (opt) total += cents(opt.surcharge);
  }
  return total / 100;
}

/** What one of this combo costs with these choices; the cheapest choices when some are missing. */
export function comboUnitPrice(combo: SaleFields, def: ComboDef, choices: ComboChoices, at: number = Date.now()): number {
  let total = cents(unitPrice(combo, at));
  for (const slot of def.slots) {
    const opt = chosenOption(slot, choices);
    if (opt) total += cents(opt.surcharge);
    else total += Math.min(...slot.options.map((o) => cents(o.surcharge)));
  }
  return total / 100;
}

/** The combo's list price with these choices (no sale), for the strikethrough. */
export const comboRegularPrice = (combo: SaleFields, def: ComboDef, choices: ComboChoices): number =>
  (cents(combo.price) + cents(comboSurcharge(def, choices))) / 100;

/**
 * What the chosen dishes would cost ordered one by one, now (their own sales
 * included, so the saving claimed is never bigger than the real one).
 */
export function comboSeparately(def: ComboDef, choices: ComboChoices, at: number = Date.now()): number | null {
  let total = 0;
  for (const slot of def.slots) {
    const opt = chosenOption(slot, choices);
    if (!opt) return null;
    total += cents(unitPrice(opt, at));
  }
  return total / 100;
}

/** "You save X" for these choices, or null when incomplete or not a saving. */
export function comboSaving(combo: SaleFields, def: ComboDef, choices: ComboChoices, at: number = Date.now()): number | null {
  const separately = comboSeparately(def, choices, at);
  if (separately === null) return null;
  const saving = cents(separately) - cents(comboUnitPrice(combo, def, choices, at));
  return saving > 0 ? saving / 100 : null;
}

/**
 * For the admin: the smallest and largest saving across every combination of
 * choices, at menu prices. Per slot the choice that matters is the one whose
 * own price minus its surcharge is lowest (smallest saving) or highest.
 */
export function comboSavingRange(comboPrice: number, slots: { options: { price: number | string; surcharge: number | string }[] }[]):
  { separatelyMin: number; separatelyMax: number; min: number; max: number } | null {
  if (slots.length === 0 || slots.some((s) => s.options.length === 0)) return null;
  let lo = 0; let hi = 0; let sepLo = 0; let sepHi = 0;
  for (const slot of slots) {
    const nets = slot.options.map((o) => cents(o.price) - cents(o.surcharge));
    lo += Math.min(...nets);
    hi += Math.max(...nets);
    const prices = slot.options.map((o) => cents(o.price));
    sepLo += Math.min(...prices);
    sepHi += Math.max(...prices);
  }
  const base = cents(comboPrice);
  return { separatelyMin: sepLo / 100, separatelyMax: sepHi / 100, min: (lo - base) / 100, max: (hi - base) / 100 };
}

/** The choices as guest_place_order wants them, in slot order. */
export const choicesPayload = (def: ComboDef, choices: ComboChoices) =>
  def.slots.filter((s) => choices[s.id]).map((s) => ({ slot_id: s.id, item_id: choices[s.id] }));
