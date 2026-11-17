/**
 * Small tools the demo seed is built from (demo mode only): a repeatable
 * random source, restaurant-local time, and bulk inserts.
 */
import type { SqlDb } from '../backend/types';

/** The restaurant keeps Sarajevo time, as the database's business_day() does. */
export const RESTAURANT_TZ = 'Europe/Sarajevo';

/** A repeatable random source: the same seed gives the same restaurant day. */
export class Random {
  private state: number;

  constructor(seed: string) {
    let h = 1779033703 ^ seed.length;
    for (let i = 0; i < seed.length; i += 1) {
      h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    this.state = h >>> 0;
  }

  /** 0 ≤ n < 1 */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  chance(p: number): boolean { return this.next() < p; }

  /** Whole number, both ends included. */
  int(min: number, max: number): number { return min + Math.floor(this.next() * (max - min + 1)); }

  between(min: number, max: number): number { return min + this.next() * (max - min); }

  pick<T>(list: readonly T[]): T { return list[Math.floor(this.next() * list.length)]; }

  weighted<T>(list: readonly T[], weight: (item: T) => number): T {
    const total = list.reduce((sum, item) => sum + weight(item), 0);
    let at = this.next() * total;
    for (const item of list) {
      at -= weight(item);
      if (at <= 0) return item;
    }
    return list[list.length - 1];
  }

  /** A UUID from this source, so a regenerated day gets the same ids. */
  uuid(): string {
    const hex = (n: number) => Array.from({ length: n }, () => Math.floor(this.next() * 16).toString(16)).join('');
    return `${hex(8)}-${hex(4)}-4${hex(3)}-${'89ab'[Math.floor(this.next() * 4)]}${hex(3)}-${hex(12)}`;
  }

  token(length = 32): string {
    return Array.from({ length }, () => Math.floor(this.next() * 16).toString(16)).join('');
  }
}

const partsFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: RESTAURANT_TZ, hourCycle: 'h23',
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short',
});

export interface LocalTime {
  /** YYYY-MM-DD in the restaurant's time zone. */
  date: string;
  hour: number;
  minute: number;
  /** 0 = Sunday … 6 = Saturday */
  weekday: number;
}

export function localTime(at: Date): LocalTime {
  const parts = Object.fromEntries(partsFormat.formatToParts(at).map((p) => [p.type, p.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday),
  };
}

/** The instant a wall-clock time in the restaurant's zone happens at. */
export function atLocal(date: string, hour: number, minute = 0, second = 0): Date {
  const [y, m, d] = date.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d, hour, minute, second);
  // How far the zone is from UTC at that moment (one correction is enough away from the clock change).
  const shown = localTime(new Date(guess));
  const [sy, sm, sd] = shown.date.split('-').map(Number);
  const offset = Date.UTC(sy, sm - 1, sd, shown.hour, shown.minute, second) - guess;
  return new Date(guess - offset);
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** The business day a moment belongs to: the night's last orders count for the day before, as business_day() has it. */
export const businessDay = (at: Date): string => localTime(new Date(at.getTime() - 5 * 3600_000)).date;

export const minutes = (n: number) => n * 60_000;
export const plus = (at: Date, ms: number) => new Date(at.getTime() + ms);
export const iso = (at: Date | null | undefined) => (at ? at.toISOString() : null);
export const money = (n: number) => Math.round(n * 100) / 100;

const ident = (name: string) => `"${name.replace(/"/g, '""')}"`;

/**
 * Inserts rows a few thousand at a time. Only the columns the rows name are
 * written; the table supplies the rest (ids, defaults). `table` may be
 * schema-qualified.
 */
export async function insertRows(db: SqlDb, table: string, rows: Record<string, unknown>[], chunk = 2500): Promise<void> {
  if (!rows.length) return;
  const columns = Object.keys(rows[0]);
  const qualified = table.includes('.') ? table.split('.').map(ident).join('.') : `public.${ident(table)}`;
  const list = columns.map(ident).join(', ');
  for (let i = 0; i < rows.length; i += chunk) {
    await db.query(
      `INSERT INTO ${qualified} (${list}) SELECT ${list} FROM jsonb_populate_recordset(NULL::${qualified}, $1::text::jsonb)`,
      [JSON.stringify(rows.slice(i, i + chunk))],
    );
  }
}

/**
 * Runs `work` as a restore would: triggers and foreign-key checks off, the
 * rows trusted as they are. The schema guards its tables against edits that
 * only make sense as mistakes (a QR token changed by hand, an order moved
 * from "pending" straight to "served"); writing a restaurant's past is not
 * one of those, and is done the way a backup is loaded.
 */
export async function asRestore<T>(db: SqlDb, work: () => Promise<T>): Promise<T> {
  await db.exec('SET session_replication_role = replica');
  try {
    return await work();
  } finally {
    await db.exec('SET session_replication_role = origin');
  }
}
