/**
 * Orders the database held back instead of printing.
 *
 * The rules live in SQL (`order_hold_reason`, migration
 * 20261024190000_order_abuse_guards.sql); this file only turns the reason code
 * into the words a waiter reads, and decides which reasons look like a prank
 * rather than a big, real table — those are the ones that get a "Block table"
 * button. A large first order is usually a birthday, not an attack, so it gets
 * Confirm and Reject only.
 *
 * Staff screens are English-only, so nothing here is translated.
 */

export type HeldReasonCode =
  | 'large_first_order'
  | 'unpaid_exposure'
  | 'outside_hours'
  | 'auto_admitted'
  | 'second_session'
  | 'venue_burst'
  | 'table_recently_blocked';

/** `unpaid_exposure:150` carries the limit that was crossed; split it off. */
export function parseHeldReason(reason: string | null | undefined): { code: string; detail: string | null } {
  if (!reason) return { code: '', detail: null };
  const at = reason.indexOf(':');
  return at === -1
    ? { code: reason, detail: null }
    : { code: reason.slice(0, at), detail: reason.slice(at + 1) || null };
}

export function heldReasonLabel(reason: string | null | undefined, tableNumber?: number | null): string {
  const { code, detail } = parseHeldReason(reason);
  switch (code) {
    case 'large_first_order': return 'Large first order';
    case 'unpaid_exposure': return detail ? `Over ${detail} KM unpaid` : 'Large unpaid total';
    case 'outside_hours': return 'Outside opening hours';
    case 'auto_admitted': return 'Joined without approval';
    case 'second_session': return tableNumber ? `Second session on table ${tableNumber}` : 'Second session on this table';
    case 'venue_burst': return 'Many new tables at once';
    case 'table_recently_blocked': return 'Table was blocked recently';
    // A reason this build does not know yet (a newer migration): still hold it
    // in front of a person rather than hide it.
    default: return 'Needs a check';
  }
}

const SUSPICIOUS = new Set<string>([
  'outside_hours', 'auto_admitted', 'second_session', 'venue_burst', 'table_recently_blocked',
]);

/** Whether to offer "Block table" alongside Confirm and Reject. */
export function heldReasonIsSuspicious(reason: string | null | undefined): boolean {
  return SUSPICIOUS.has(parseHeldReason(reason).code);
}
