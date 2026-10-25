import { kitchenStart } from '@/components/staff/order-status';

/**
 * The kitchen board's one-key actions, for a keyboard or a bump bar.
 *
 * A bump bar is a row of big keys on the pass that sends ordinary key
 * presses. With it a cook moves the highlight to a ticket and bumps it
 * without touching the screen — wet or gloved hands, or a tablet mounted out
 * of reach. Pure, so what each key does is tested.
 */

interface BumpItem { id: string; status: string; station: string }
interface BumpOrder { id: string; status: string; created_at: string; released_to_kitchen_at?: string | null; items: BumpItem[] }

export type Station = 'all' | 'kitchen' | 'bar';

export type BumpAction =
  | { kind: 'start'; itemIds: string[]; label: string }
  | { kind: 'ready'; itemIds: string[]; label: string }
  | { kind: 'served'; label: string };

/**
 * What one bump does to a ticket — the same step the big button on the card
 * offers: start everything not started, else make everything ready, else the
 * plates went out.
 *
 * Nothing on a station view with no line of its own: an order that is on the
 * bar's board only for the drink of a kitchen combo is the kitchen's to
 * start, ready and serve.
 */
export function nextBump(order: BumpOrder, station: Station): BumpAction | null {
  const mine = station === 'all' ? order.items : order.items.filter((i) => i.station === station);
  if (station !== 'all' && mine.length === 0) return null;
  const pending = mine.filter((i) => i.status === 'pending');
  if (pending.length > 0) return { kind: 'start', itemIds: pending.map((i) => i.id), label: `Start all (${pending.length})` };
  const notReady = mine.filter((i) => i.status === 'pending' || i.status === 'preparing');
  if (notReady.length > 0) return { kind: 'ready', itemIds: notReady.map((i) => i.id), label: `All ready (${notReady.length})` };
  if (order.status === 'ready') return { kind: 'served', label: 'Mark served' };
  return null;
}

const COLUMN: Record<string, number> = { pending: 0, confirmed: 0, preparing: 1, ready: 2 };

/**
 * The order the highlight walks: down the New column, then Preparing, then
 * Ready — oldest first in each, which is the order the board draws them.
 */
export function boardSequence<T extends BumpOrder>(orders: T[]): T[] {
  return [...orders]
    .filter((o) => o.status in COLUMN)
    .sort((a, b) => (COLUMN[a.status] - COLUMN[b.status])
      || (new Date(kitchenStart(a)).getTime() - new Date(kitchenStart(b)).getTime()));
}

export type KeyCommand =
  | { kind: 'move'; by: 1 | -1 }
  | { kind: 'select'; index: number }
  | { kind: 'bump' }
  | { kind: 'undo' }
  | { kind: 'reprint' }
  | { kind: 'fullscreen' }
  | { kind: 'help' }
  | { kind: 'dismiss' };

/**
 * Map a key press to a command. Bump bars differ, but nearly all can be set
 * to send digits, arrows, Enter/Space and a couple of letters.
 */
export function keyCommand(key: string): KeyCommand | null {
  if (/^[1-9]$/.test(key)) return { kind: 'select', index: Number(key) - 1 };
  switch (key) {
    case 'ArrowRight': case 'ArrowDown': case 'j': case 'l': return { kind: 'move', by: 1 };
    case 'ArrowLeft': case 'ArrowUp': case 'k': case 'h': return { kind: 'move', by: -1 };
    case 'Enter': case ' ': case 'b': return { kind: 'bump' };
    case 'Backspace': case 'u': case 'z': return { kind: 'undo' };
    case 'p': case 'r': return { kind: 'reprint' };
    case 'f': return { kind: 'fullscreen' };
    case '?': return { kind: 'help' };
    case 'Escape': return { kind: 'dismiss' };
    default: return null;
  }
}

/** Typing in a field, or a dialog open: keys are not for the board then. */
export function keysBelongToBoard(target: EventTarget | null, doc: Document = document): boolean {
  const el = target as HTMLElement | null;
  if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return false;
  return !doc.querySelector('[role="dialog"], [role="alertdialog"]');
}

export const SHORTCUTS: { keys: string; does: string }[] = [
  { keys: '1 – 9', does: 'Pick ticket 1 to 9 (New first, oldest first)' },
  { keys: '← →  or  ↑ ↓', does: 'Move to the previous / next ticket' },
  { keys: 'Enter  or  Space', does: 'Bump: start all → all ready → served' },
  { keys: 'Backspace  or  U', does: 'Undo the last bump' },
  { keys: 'P', does: 'Reprint the picked ticket' },
  { keys: 'F', does: 'Full screen on / off' },
  { keys: '?', does: 'Show this list' },
];
