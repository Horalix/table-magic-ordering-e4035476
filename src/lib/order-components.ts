/**
 * What a combo line contained, for the kitchen display and every ticket.
 *
 * `order_items.components` (20261026100000_promotions.sql) is written once,
 * when the order is placed, and never changes:
 *
 *   [{ slot_label, item_id, name, name_bs, name_ar, station }, …]   in slot order
 *
 * and is NULL for every line that is not a combo. Staff screens are English,
 * so the lines use `slot_label` and `name`.
 *
 * The combo LINE has one station (the combo dish's own, usually kitchen), but
 * its parts may be made elsewhere — the drink of a burger combo is the bar's.
 * Such a part is marked with its station so whoever reads the kitchen ticket
 * knows to pass it on. Routing parts to their own station's board and printer
 * is a separate change.
 */

export interface OrderComponent {
  slot_label: string;
  item_id: string;
  name: string;
  name_bs?: string | null;
  name_ar?: string | null;
  station?: string | null;
}

/** The components of a line, tolerating null, a missing column, or junk. */
export function parseComponents(raw: unknown): OrderComponent[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((c): c is OrderComponent =>
    !!c && typeof c === 'object' && typeof (c as OrderComponent).name === 'string');
}

/**
 * One short line per part: "Burger: Classic", "Drink: Lemonade (BAR)".
 *
 * `lineStation` is the station of the combo line itself; a part made at
 * another station says so.
 */
export function formatComponents(raw: unknown, lineStation?: string | null): string[] {
  return parseComponents(raw).map((c) => {
    const label = c.slot_label?.trim();
    const text = label ? `${label}: ${c.name}` : c.name;
    const elsewhere = c.station && lineStation && c.station !== lineStation;
    return elsewhere ? `${text} (${c.station!.toUpperCase()})` : text;
  });
}
