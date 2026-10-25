import { describe, expect, it } from 'vitest';
import { boardSequence, keyCommand, keysBelongToBoard, nextBump } from '@/lib/kds-actions';

const at = (m: number) => new Date(Date.UTC(2026, 9, 25, 18, m)).toISOString();
const order = (id: string, status: string, minute: number, items: { id: string; status: string; station?: string }[] = []) => ({
  id, status, created_at: at(minute), released_to_kitchen_at: at(minute),
  items: items.map((i) => ({ station: 'kitchen', ...i })),
});

describe('one bump', () => {
  it('starts everything not started first', () => {
    const o = order('a', 'pending', 0, [{ id: '1', status: 'pending' }, { id: '2', status: 'preparing' }]);
    expect(nextBump(o, 'all')).toEqual({ kind: 'start', itemIds: ['1'], label: 'Start all (1)' });
  });

  it('then makes everything ready', () => {
    const o = order('a', 'preparing', 0, [{ id: '1', status: 'preparing' }, { id: '2', status: 'ready' }]);
    expect(nextBump(o, 'all')).toEqual({ kind: 'ready', itemIds: ['1'], label: 'All ready (1)' });
  });

  it('then the plates went out', () => {
    const o = order('a', 'ready', 0, [{ id: '1', status: 'ready' }]);
    expect(nextBump(o, 'all')).toEqual({ kind: 'served', label: 'Mark served' });
  });

  it('only touches this station’s lines', () => {
    // The barman's bump must not start the steak.
    const o = order('a', 'pending', 0, [{ id: 'steak', status: 'pending' }, { id: 'cola', status: 'pending', station: 'bar' }]);
    expect(nextBump(o, 'bar')).toEqual({ kind: 'start', itemIds: ['cola'], label: 'Start all (1)' });
  });

  it('does nothing on the bar for an order it only has a combo’s drink on', () => {
    // The combo line is the kitchen's; serving it from the bar would send the
    // burger out before anyone looked at it.
    const pending = order('a', 'pending', 0, [{ id: 'combo', status: 'pending' }]);
    const ready = order('b', 'ready', 0, [{ id: 'combo', status: 'ready' }]);
    expect(nextBump(pending, 'bar')).toBeNull();
    expect(nextBump(ready, 'bar')).toBeNull();
    expect(nextBump(ready, 'kitchen')).toEqual({ kind: 'served', label: 'Mark served' });
  });
});

describe('the order the highlight walks', () => {
  it('New, then Preparing, then Ready — oldest first in each', () => {
    const seq = boardSequence([
      order('ready-old', 'ready', 1), order('new-late', 'pending', 9), order('prep', 'preparing', 3),
      order('new-early', 'pending', 2), order('served', 'served', 0),
    ]);
    expect(seq.map((o) => o.id)).toEqual(['new-early', 'new-late', 'prep', 'ready-old']);
  });
});

describe('keys', () => {
  it('digits pick a ticket; arrows move; Enter and Space bump', () => {
    expect(keyCommand('3')).toEqual({ kind: 'select', index: 2 });
    expect(keyCommand('ArrowRight')).toEqual({ kind: 'move', by: 1 });
    expect(keyCommand('ArrowLeft')).toEqual({ kind: 'move', by: -1 });
    expect(keyCommand('Enter')).toEqual({ kind: 'bump' });
    expect(keyCommand(' ')).toEqual({ kind: 'bump' });
    expect(keyCommand('Backspace')).toEqual({ kind: 'undo' });
    expect(keyCommand('0')).toBeNull();
    expect(keyCommand('x')).toBeNull();
  });

  it('leave typing and dialogs alone', () => {
    const input = document.createElement('input');
    expect(keysBelongToBoard(input)).toBe(false);
    expect(keysBelongToBoard(document.body)).toBe(true);
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    document.body.appendChild(dialog);
    expect(keysBelongToBoard(document.body)).toBe(false);
    dialog.remove();
  });
});
