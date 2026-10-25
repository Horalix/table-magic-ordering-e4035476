/**
 * What a station makes from an order — for the kitchen display.
 *
 * A combo is ONE order line, at the combo dish's own station (usually the
 * kitchen), with its parts frozen in `order_items.components`. The drink of a
 * burger combo is the bar's to make, so the Bar view has to show it — on an
 * order whose only bar item is that drink too, or the barman never hears of it.
 *
 * Such a part is a DERIVED line: it has no status of its own and moves with
 * its combo line, which the combo's own station starts, readies and serves.
 * The board shows it ("1× Strawberry Lemonade · part of Chicken Burger
 * Combo") and offers no per-item action on it: bumping it would bump the
 * whole combo, burger and all, from the bar.
 *
 * Same rule as the station ticket (enqueue_order_ticket in
 * 20261026130000_combo_station_tickets.sql, and planLines in the shared
 * ticket layout): a part counts at its station when its line is made
 * somewhere else. Pure, so it is unit-tested.
 */

export type StationView = 'all' | 'kitchen' | 'bar';

export interface StationLinePart {
  slot_label?: string | null;
  item_id?: string | null;
  name: string;
  station?: string | null;
  allergens?: readonly string[] | null;
}

/** The fields of an order line this module reads. */
export interface StationLineLike<S extends string = string> {
  id: string;
  quantity: number;
  notes: string | null;
  status: S;
  station: string;
  menu_item_name: string;
  components?: readonly StationLinePart[] | null;
}

/** A combo part made at this station under a combo line made elsewhere. */
export interface StationPart<S extends string = string> {
  /** Stable key: the line id and the part's position in it. */
  key: string;
  /** The combo line it belongs to. Never bumped from the part's station. */
  lineId: string;
  /** Where the combo line is made — who moves it, and so this part. */
  lineStation: string;
  quantity: number;
  name: string;
  slotLabel: string | null;
  itemId: string | null;
  station: string;
  /** The combo's name. */
  partOf: string;
  /** The combo line's notes: one note per combo, and it may be about the drink. */
  notes: string | null;
  /** The part's OWN allergens, when the board looked them up. */
  allergens: string[] | null;
  /** The combo line's status. */
  status: S;
}

/** The order's own lines this station makes, and acts on. */
export function stationLines<L extends StationLineLike>(items: readonly L[], station: StationView): L[] {
  return station === 'all' ? [...items] : items.filter((i) => i.station === station);
}

/** Combo parts this station makes, under combo lines made elsewhere. None for "All". */
export function stationParts<S extends string>(
  items: readonly StationLineLike<S>[],
  station: StationView,
): StationPart<S>[] {
  if (station === 'all') return [];
  const out: StationPart<S>[] = [];
  for (const line of items) {
    if (line.station === station || !Array.isArray(line.components)) continue;
    line.components.forEach((part, index) => {
      if (!part || typeof part.name !== 'string' || part.station !== station) return;
      out.push({
        key: `${line.id}:part:${index}`,
        lineId: line.id,
        lineStation: line.station,
        quantity: line.quantity,
        name: part.name,
        slotLabel: part.slot_label ?? null,
        itemId: part.item_id ?? null,
        station,
        partOf: line.menu_item_name,
        notes: line.notes,
        allergens: Array.isArray(part.allergens) ? [...part.allergens] : null,
        status: line.status,
      });
    });
  }
  return out;
}

/** Whether this station has anything on the order: a line of its own, or a combo part. */
export function worksAt(items: readonly StationLineLike[], station: StationView): boolean {
  return station === 'all' || stationLines(items, station).length > 0 || stationParts(items, station).length > 0;
}

/** Every station with something on the order, combo parts included. */
export function stationsInvolved(items: readonly StationLineLike[]): Set<string> {
  const out = new Set<string>();
  for (const line of items) {
    out.add(line.station);
    for (const part of Array.isArray(line.components) ? line.components : []) {
      if (part && typeof part.station === 'string' && part.station) out.add(part.station);
    }
  }
  return out;
}
