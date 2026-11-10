import { describe, expect, it } from 'vitest';
import { dayIsOver, endOfDay, tableList, workDayEnd, type OpenTable, type OpenTables } from './end-of-day';
import { EVERY_DAY, type OpeningHours } from './venues';

/**
 * When staff screens say "the work day is over, these tables are still open".
 */

const HOURS: OpeningHours[] = [{ days: EVERY_DAY, opens: '11:00', closes: '21:00' }];
const table = (n: number, over: Partial<OpenTable> = {}): OpenTable => ({
  session_id: `s-${n}`, table_number: n, opened_at: '2026-11-10T18:00:00Z', outstanding: 0, unpaid_orders: 0, overnight: false, ...over,
});
const open = (local_time: string, tables: OpenTable[], day_ends_at: string | null = null): OpenTables => ({
  local_time, weekday: 2, day_ends_at, closes_overnight: false, tables,
});

describe('workDayEnd', () => {
  it('is what the manager set', () => {
    expect(workDayEnd('23:30', HOURS, 2)).toBe('23:30');
    expect(workDayEnd('23:30:00', null, 2)).toBe('23:30');
  });

  it('else half an hour after the doors close that day', () => {
    expect(workDayEnd(null, HOURS, 2)).toBe('21:30');
    expect(workDayEnd(null, [{ days: ['Friday', 'Saturday'], opens: '18:00', closes: '23:45' }], 6)).toBe('00:15');
  });

  it('else is not known', () => {
    expect(workDayEnd(null, null, 2)).toBeNull();
    // Closed on Mondays: no hours for that day.
    expect(workDayEnd(null, [{ days: ['Tuesday'], opens: '11:00', closes: '21:00' }], 1)).toBeNull();
    expect(workDayEnd('nonsense', null, 2)).toBeNull();
  });
});

describe('dayIsOver', () => {
  it('from the end of the work day until the next trading day starts at 05:00', () => {
    expect(dayIsOver('21:29', '21:30')).toBe(false);
    expect(dayIsOver('21:30', '21:30')).toBe(true);
    expect(dayIsOver('23:59', '21:30')).toBe(true);
    expect(dayIsOver('00:30', '21:30')).toBe(true);
    expect(dayIsOver('04:59', '21:30')).toBe(true);
    expect(dayIsOver('05:00', '21:30')).toBe(false);
    expect(dayIsOver('11:00', '21:30')).toBe(false);
  });

  it('for a place that closes after midnight', () => {
    expect(dayIsOver('23:30', '01:00')).toBe(false);
    expect(dayIsOver('00:59', '01:00')).toBe(false);
    expect(dayIsOver('01:00', '01:00')).toBe(true);
    expect(dayIsOver('12:00', '01:00')).toBe(false);
  });

  it('is never over when the end is not known', () => {
    expect(dayIsOver('23:00', null)).toBe(false);
  });
});

describe('endOfDay', () => {
  it('is due once the day is over and a table is still open', () => {
    const state = endOfDay(open('22:00', [table(1), table(2, { outstanding: 24, unpaid_orders: 1 })]), HOURS);
    expect(state).toMatchObject({ due: true, over: true });
    expect(state.closable.map((t) => t.table_number)).toEqual([1]);
    expect(state.owing.map((t) => t.table_number)).toEqual([2]);
  });

  it('is not due during service, nor with every table free', () => {
    expect(endOfDay(open('20:00', [table(1)]), HOURS).due).toBe(false);
    expect(endOfDay(open('22:00', []), HOURS).due).toBe(false);
    expect(endOfDay(null, HOURS).due).toBe(false);
  });

  it('is due at any hour for a table left from an earlier day', () => {
    const state = endOfDay(open('12:00', [table(3, { overnight: true }), table(4)]), null);
    expect(state).toMatchObject({ due: true, over: false });
  });

  it("goes by the manager's setting before the opening hours", () => {
    expect(endOfDay(open('22:00', [table(1)], '23:00'), HOURS).due).toBe(false);
    expect(endOfDay(open('23:00', [table(1)], '23:00'), HOURS).due).toBe(true);
  });
});

describe('tableList', () => {
  it('reads as a sentence', () => {
    expect(tableList([table(4)])).toBe('Table 4');
    expect(tableList([table(2), table(7)])).toBe('Tables 2 and 7');
    expect(tableList([table(1), table(3), table(9)])).toBe('Tables 1, 3 and 9');
  });
});
