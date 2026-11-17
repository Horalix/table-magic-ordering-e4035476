import { afterEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import {
  DEFAULT_TABLES_VIEW, NO_SIGNALS, floorSummary, floorTiles, readTablesView, saveTablesView, tablesViewKey, tileLabel,
  urgentSignal, useTablesView, type FloorTile, type MySeatedTable, type SectionSession, type SectionTable,
} from './waiter-tables';

afterEach(() => localStorage.clear());

describe('the "My tables" setting on the waiter phone', () => {
  it('starts as it always was: only seated tables', () => {
    expect(DEFAULT_TABLES_VIEW).toBe('seated');
    expect(readTablesView('waiter-1')).toBe('seated');
    expect(readTablesView(null)).toBe('seated');
  });

  it('remembers each waiter’s own choice on a shared phone', () => {
    saveTablesView('waiter-1', 'all');
    expect(readTablesView('waiter-1')).toBe('all');
    expect(readTablesView('waiter-2')).toBe('seated');
    expect(localStorage.getItem(tablesViewKey('waiter-1'))).toBe('all');
  });

  it('ignores anything it did not write', () => {
    localStorage.setItem(tablesViewKey('waiter-1'), 'everything');
    expect(readTablesView('waiter-1')).toBe('seated');
  });

  it('switches at once and keeps the choice after a reload', () => {
    const { result } = renderHook(() => useTablesView('waiter-1'));
    expect(result.current[0]).toBe('seated');
    act(() => result.current[1]('all'));
    expect(result.current[0]).toBe('all');
    const again = renderHook(() => useTablesView('waiter-1'));
    expect(again.result.current[0]).toBe('all');
  });

  it('reads the choice once the waiter is known', () => {
    saveTablesView('waiter-1', 'all');
    const { result, rerender } = renderHook(({ id }: { id: string | null }) => useTablesView(id), {
      initialProps: { id: null as string | null },
    });
    expect(result.current[0]).toBe('seated');
    rerender({ id: 'waiter-1' });
    expect(result.current[0]).toBe('all');
  });
});

describe('all my tables', () => {
  const table = (id: string, n: number, section = 'terrace'): SectionTable => ({ id, table_number: n, section_id: section });
  const seat = (id: string, tableId: string, waiter: string | null): SectionSession => ({ id, table_id: tableId, assigned_waiter_id: waiter });
  const mine = (id: string, tableId: string, n: number): MySeatedTable => ({
    id, table_id: tableId, opened_at: '2026-11-14T18:00:00Z', guest_name: 'Amina', tables: { table_number: n },
  });

  it('lists every table in my sections, by number, and says what each one is', () => {
    const tiles = floorTiles({
      sectionTables: [table('t3', 3), table('t1', 1), table('t2', 2), table('t4', 4)],
      sectionSessions: [seat('s1', 't1', 'me'), seat('s2', 't2', 'lejla'), seat('s4', 't4', null)],
      mine: [mine('s1', 't1', 1)],
      myWaiterId: 'me',
      waiterNames: { lejla: 'Lejla' },
    });
    expect(tiles.map((t) => [t.tableNumber, t.kind])).toEqual([
      [1, 'mine'], [2, 'colleague'], [3, 'free'], [4, 'nobody'],
    ]);
    expect(tiles[1]).toMatchObject({ waiterName: 'Lejla' });
    expect(tiles[3]).toMatchObject({ sessionId: 's4' });
  });

  it('keeps a table I took from outside my sections', () => {
    const tiles = floorTiles({
      sectionTables: [table('t1', 1)],
      sectionSessions: [],
      mine: [mine('s9', 't9', 9)],
      myWaiterId: 'me',
      waiterNames: {},
    });
    expect(tiles.map((t) => [t.tableNumber, t.kind])).toEqual([[1, 'free'], [9, 'mine']]);
  });

  it('names a colleague it does not know as another waiter', () => {
    const tiles = floorTiles({
      sectionTables: [table('t5', 5)],
      sectionSessions: [seat('s5', 't5', 'someone')],
      mine: [],
      myWaiterId: 'me',
      waiterNames: {},
    });
    expect(tiles).toEqual([{ kind: 'colleague', tableNumber: 5, tableId: 't5', waiterName: 'Another waiter' }]);
  });

  it('with no section today, still shows my seated tables', () => {
    expect(floorTiles({
      sectionTables: [], sectionSessions: [], mine: [mine('s1', 't1', 1)], myWaiterId: 'me', waiterNames: {},
    }).map((t) => t.kind)).toEqual(['mine']);
  });
});

describe('what a tile says', () => {
  const mineTile: FloorTile = { kind: 'mine', tableNumber: 7, sessionId: 's7', openedAt: '2026-11-14T18:00:00Z', guestName: null };
  const nobodyTile: FloorTile = { kind: 'nobody', tableNumber: 9, sessionId: 's9' };

  it('is coloured by the most urgent thing, in the order of "Attention needed"', () => {
    expect(urgentSignal(NO_SIGNALS)).toBeNull();
    expect(urgentSignal({ ...NO_SIGNALS, bill: true, calling: true, ready: 1 })).toBe('ready');
    expect(urgentSignal({ ...NO_SIGNALS, bill: true, calling: true })).toBe('calling');
    expect(urgentSignal({ ...NO_SIGNALS, bill: true, cooking: 2 })).toBe('bill');
    expect(urgentSignal({ ...NO_SIGNALS, cooking: 2, owed: 30 })).toBeNull();
  });

  it('reads out everything that is going on at a table', () => {
    expect(tileLabel(mineTile, { ready: 1, calling: true, bill: true, cooking: 2, owed: 24 }))
      .toBe('Table 7, yours, food ready, calling you, wants the bill, 2 in the kitchen, owes 24.00 KM');
    expect(tileLabel(mineTile)).toBe('Table 7, yours');
    expect(tileLabel(nobodyTile, { ...NO_SIGNALS, calling: true })).toBe('Table 9, seated, no waiter, calling you, tap to take it');
    expect(tileLabel({ kind: 'free', tableNumber: 5, tableId: 't5' })).toBe('Table 5, free');
    expect(tileLabel({ kind: 'colleague', tableNumber: 8, tableId: 't8', waiterName: 'Lejla' })).toBe('Table 8, seated with Lejla');
  });

  it('sums the floor up in one line, leaving out what is not there', () => {
    const tiles: FloorTile[] = [
      mineTile, nobodyTile,
      { kind: 'free', tableNumber: 5, tableId: 't5' }, { kind: 'free', tableNumber: 6, tableId: 't6' },
      { kind: 'colleague', tableNumber: 8, tableId: 't8', waiterName: 'Lejla' },
    ];
    expect(floorSummary(tiles).map((r) => `${r.count} ${r.text}`)).toEqual(['1 yours', '1 with Lejla', '1 no waiter', '2 free']);
    expect(floorSummary([...tiles, { kind: 'colleague', tableNumber: 4, tableId: 't4', waiterName: 'Emir' }])[1].text).toBe('with others');
    expect(floorSummary([{ kind: 'free', tableNumber: 5, tableId: 't5' }]).map((r) => r.kind)).toEqual(['free']);
  });
});
