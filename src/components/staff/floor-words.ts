/**
 * Counts and summaries in the words the floor screens use.
 *
 * The floor monitor said "2 call" and "1 bill | 3 seated"; the waiter phone's
 * "what is waiting" bar listed every alert as its own sentence, so with three
 * or four of them the bill — always last — was cut off behind an ellipsis.
 */

/** "1 call", "2 calls". */
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "T3, T7" — each table once, in the order given. */
const tableList = (tables: (number | string)[]) => [...new Set(tables.map(String))].map((t) => `T${t}`).join(', ');

/**
 * One line a waiter reads in a glance: what is waiting, grouped by what to
 * do about it, most urgent first — "Food up T7 · Calling T3, T7 · Bill T6".
 * Grouped, it stays short enough to fit a phone with the bill still on it.
 */
export function attentionSummary({ ready, calls, bills }: {
  ready: (number | string)[];
  calls: (number | string)[];
  bills: (number | string)[];
}): string {
  return [
    ready.length > 0 ? `Food up ${tableList(ready)}` : null,
    calls.length > 0 ? `Calling ${tableList(calls)}` : null,
    bills.length > 0 ? `Bill ${tableList(bills)}` : null,
  ].filter(Boolean).join(' · ');
}
