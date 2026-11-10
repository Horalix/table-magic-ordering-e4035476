import { supabase } from '@/integrations/supabase/client';
import type { OpeningHours, Weekday } from './venues';

/**
 * Tables left open after the work day (20261110120000_close_all_tables.sql).
 *
 * Waiters do not always free their tables when the guests leave. Once the
 * work day is over, staff screens say which tables are still open and offer
 * to close them all (src/components/staff/EndOfDayTables.tsx). A table that
 * owes money is never closed that way: it is named, with what it owes.
 *
 * "Over" is decided on the restaurant's own clock, which the database sends
 * with the tables — a waiter's phone with the wrong time must not decide it.
 */

export interface OpenTable {
  session_id: string;
  table_number: number;
  opened_at: string;
  /** What the table still owes; 0 when it can be freed. */
  outstanding: number;
  unpaid_orders: number;
  /** Opened on an earlier trading day: nobody freed it last night. */
  overnight: boolean;
}

export interface OpenTables {
  /** The restaurant's clock, "HH:MM". */
  local_time: string;
  /** Of the trading day, 1 (Monday) to 7: half past midnight is still last evening's. */
  weekday: number;
  /** Admin → Ordering & service → "Work day ends at", or null when not set. */
  day_ends_at: string | null;
  /** Settled tables whose guests have gone are freed by the database overnight. */
  closes_overnight: boolean;
  tables: OpenTable[];
}

export interface ClosedTables {
  closed: number;
  /** The tables that owe money: they stay open. */
  kept: Pick<OpenTable, 'session_id' | 'table_number' | 'outstanding' | 'unpaid_orders'>[];
}

/** Null on a database from before this feature: the notice then shows nothing. */
export async function fetchOpenTables(): Promise<OpenTables | null> {
  const { data, error } = await supabase.rpc('staff_open_tables' as never);
  // Anything but the function's own answer (an older database, a stub) is "not known".
  if (error || !data || typeof data !== 'object' || Array.isArray(data)) return null;
  const open = data as unknown as OpenTables;
  if (typeof open.local_time !== 'string') return null;
  return {
    ...open,
    tables: (open.tables ?? []).map((t) => ({ ...t, outstanding: Number(t.outstanding ?? 0) })),
  };
}

export async function closeAllTables(): Promise<ClosedTables> {
  const { data, error } = await supabase.rpc('staff_close_all_tables' as never);
  if (error) throw new Error(error.message);
  const result = data as unknown as ClosedTables;
  return { closed: result.closed ?? 0, kept: (result.kept ?? []).map((t) => ({ ...t, outstanding: Number(t.outstanding ?? 0) })) };
}

const WEEKDAYS: Weekday[] = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
/** The trading day runs 05:00 to 05:00 (business_day(), 20260805090000_business_day.sql). */
const DAY_STARTS_MIN = 5 * 60;
/** After the doors close, before the notice: the last guests are still paying. */
export const AFTER_CLOSING_MIN = 30;

const minutes = (hhmm: string): number | null => {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm);
  if (!m) return null;
  const total = Number(m[1]) * 60 + Number(m[2]);
  return Number(m[1]) < 24 && Number(m[2]) < 60 ? total : null;
};
/** How far into the trading day a clock time is: 23:00 is 18 h in, 01:00 is 20 h in. */
const intoDay = (min: number) => (min - DAY_STARTS_MIN + 1440) % 1440;
const clock = (min: number) => `${String(Math.floor((min % 1440) / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

/**
 * When the work day ends, "HH:MM": what the manager set, else half an hour
 * after the doors close on that weekday (the opening hours on the website),
 * else null — then only tables left from an earlier day are flagged.
 */
export function workDayEnd(setting: string | null, hours: OpeningHours[] | null | undefined, weekday: number): string | null {
  if (setting && minutes(setting) !== null) return setting.slice(0, 5);
  const day = WEEKDAYS[weekday - 1];
  const closes = hours?.find((h) => h.days.includes(day))?.closes;
  const at = closes ? minutes(closes) : null;
  return at === null ? null : clock(at + AFTER_CLOSING_MIN);
}

/** Has the work day ended, by the restaurant's clock? Stays so until the next trading day starts at 05:00. */
export function dayIsOver(localTime: string, endsAt: string | null): boolean {
  const now = minutes(localTime);
  const end = endsAt ? minutes(endsAt) : null;
  if (now === null || end === null) return false;
  return intoDay(now) >= intoDay(end);
}

export interface EndOfDay {
  /** Show the notice. */
  due: boolean;
  /** The work day has ended (as opposed to: only tables from an earlier day). */
  over: boolean;
  /** Tables that owe nothing: Close all tables frees these. */
  closable: OpenTable[];
  /** Tables that owe money: they stay open. */
  owing: OpenTable[];
}

/** What the notice says, from what the database sent and the restaurant's opening hours. */
export function endOfDay(open: OpenTables | null | undefined, hours: OpeningHours[] | null | undefined): EndOfDay {
  const tables = open?.tables ?? [];
  const over = !!open && dayIsOver(open.local_time, workDayEnd(open.day_ends_at, hours, open.weekday));
  return {
    over,
    due: tables.length > 0 && (over || tables.some((t) => t.overnight)),
    closable: tables.filter((t) => t.unpaid_orders === 0),
    owing: tables.filter((t) => t.unpaid_orders > 0),
  };
}

/** "Table 4", "Tables 2 and 7", "Tables 1, 3 and 9". */
export function tableList(tables: readonly Pick<OpenTable, 'table_number'>[]): string {
  const n = tables.map((t) => t.table_number);
  if (n.length === 0) return '';
  if (n.length === 1) return `Table ${n[0]}`;
  return `Tables ${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}`;
}
