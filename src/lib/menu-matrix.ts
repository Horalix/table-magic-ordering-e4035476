import type { HoldoutComparison, MenuEngineeringRow, Quadrant, SuggestionImpact } from './menu-intelligence';

/**
 * The menu-engineering matrix as a picture (src/components/admin/MenuMatrixChart.tsx).
 *
 * `menu_engineering()` judges each dish against the others of its kind:
 * popular means at least 70% of an equal share of its kind's portions, high
 * margin means at least its kind's average margin per portion. To draw every
 * kind on one chart, each dish is placed by how far it is from its own two
 * lines: 1.0 across is exactly on the popularity line, 1.0 up is exactly its
 * kind's average margin. A coffee and a burger are then comparable, which
 * their raw shares and margins are not.
 */

export interface MatrixPoint {
  id: string;
  name: string;
  quadrant: Quadrant;
  /** Share of its kind's portions ÷ the popularity line; 1 is on the line. Capped for drawing. */
  x: number;
  /** Margin per portion ÷ its kind's average; 1 is on the line. Capped for drawing. */
  y: number;
  /** What it takes a week, for the size of the dot. */
  weekly: number;
  row: MenuEngineeringRow;
}

/** Past this a dot would squash everything else into a corner; it is drawn at the edge instead. */
export const MATRIX_MAX = 2.5;

const cap = (v: number) => Math.min(MATRIX_MAX, Math.max(0, v));

/** Every dish that can be placed: it has a share and its kind has a line and an average. */
export function matrixPoints(rows: readonly MenuEngineeringRow[], menuClass?: string): MatrixPoint[] {
  return rows
    .filter((r) => (!menuClass || r.menu_class === menuClass)
      && r.menu_mix !== null && r.popularity_threshold > 0 && r.class_avg_cm > 0)
    .map((r) => ({
      id: r.item_id,
      name: r.name,
      quadrant: r.quadrant,
      x: cap((r.menu_mix as number) / r.popularity_threshold),
      y: cap(r.unit_cm / r.class_avg_cm),
      weekly: Math.max(0, r.units_per_week * r.price),
      row: r,
    }));
}

/** How many dishes are in each box, for the summary's one-line picture of the menu. */
export function quadrantCounts(rows: readonly MenuEngineeringRow[]): Record<Quadrant, number> {
  const out: Record<Quadrant, number> = { star: 0, plowhorse: 0, puzzle: 0, dog: 0, insufficient: 0 };
  for (const r of rows) out[r.quadrant] += 1;
  return out;
}

/**
 * What a small price change is worth a week, if the dish sells as it does
 * now. Arithmetic, not a forecast: a dearer dish may sell less, and the page
 * says "if it sells the same" beside the number.
 */
export function priceNudge(row: Pick<MenuEngineeringRow, 'units_per_week'>, byKm = 0.5): number {
  return Math.round(Math.max(0, row.units_per_week) * byKm);
}

/** Share of the price the house keeps after ingredients, 0–100, or null when there is no price. */
export function marginPct(price: number, cost: number): number | null {
  if (!(price > 0)) return null;
  return Math.round(((price - cost) / price) * 100);
}

/** A dish in the cost editor (src/components/admin/DishCostEditor.tsx). */
export interface CostDish {
  id: string;
  name: string;
  price: number;
  food_cost: number | null;
}

/** "4,50" and "4.50" are both 4.5; anything else is not a cost. */
export function parseCost(raw: string): number | null {
  const text = raw.trim().replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
  return Number(text);
}

/** Dishes with no cost first, the ones taking the most money a week leading; then the rest by name. */
export function costOrder(dishes: readonly CostDish[], weekly: ReadonlyMap<string, number>): CostDish[] {
  return [...dishes].sort((a, b) =>
    Number(a.food_cost !== null) - Number(b.food_cost !== null)
    || (weekly.get(b.id) ?? 0) - (weekly.get(a.id) ?? 0)
    || a.name.localeCompare(b.name));
}

const km0 = (n: number) => `${Math.round(n).toLocaleString('en')} KM`;

/** What the suggestions' tile says, by how far the measurement has got. */
export function suggestionsHeadline(holdout: HoldoutComparison | null, impact: SuggestionImpact | null): { big: string; sub: string } {
  switch (holdout?.status) {
    case 'positive':
      return { big: `+${km0(Number(holdout.conservative_monthly_value ?? 0))} a month`, sub: 'Measured against tables shown no suggestions, on the cautious end.' };
    case 'negative':
      return { big: 'Costing money', sub: 'Tables shown suggestions spend less. Open it before anything else.' };
    case 'no_measurable_effect':
      return { big: 'No effect yet', sub: 'Measured: neither helping nor hurting so far.' };
    case 'too_early':
      return {
        big: 'Measuring…',
        sub: `${holdout.with_suggestions?.sessions ?? 0} visits with suggestions and ${holdout.holdout?.sessions ?? 0} without so far.`,
      };
    case 'invalid_srm':
      return { big: 'Not sound', sub: 'The measurement is assigning tables wrongly, so it shows no result.' };
    default:
      return impact && Number(impact.attributed_revenue ?? 0) > 0
        ? { big: `up to ${km0(Number(impact.attributed_revenue))}`, sub: 'Paid for after a suggestion. An upper bound: start a holdout to measure it.' }
        : { big: 'Not measured', sub: 'No holdout is running, so what they earn is not known yet.' };
  }
}
