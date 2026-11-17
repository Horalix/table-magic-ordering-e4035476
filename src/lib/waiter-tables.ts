/**
 * What "My tables" on the waiter phone lists.
 *
 * It used to list only the tables with guests at them. Some waiters are used
 * to seeing every table they look after, free ones too, so the phone has a
 * setting (the gear in its header): "Only seated tables" or "All my tables".
 *
 * "All my tables" means every table in the sections the waiter is on for
 * today's trading day (section_assignments, business_day()), plus any seated
 * table that is theirs from outside those sections (taken with "Take table").
 * A section can have more than one waiter, so a table there may be seated with
 * a colleague, or seated with nobody yet; the phone says which.
 *
 * The choice is kept on the phone, per waiter, so a tablet shared at the bar
 * keeps each person's own. Nothing is stored in the database.
 */
import { useCallback, useEffect, useState } from 'react';

export type TablesView = 'seated' | 'all';

/** Before anyone chooses: what the phone always showed. */
export const DEFAULT_TABLES_VIEW: TablesView = 'seated';

export const tablesViewKey = (waiterId: string) => `waiter-tables-view:${waiterId}`;

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readTablesView(waiterId: string | null): TablesView {
  if (!waiterId) return DEFAULT_TABLES_VIEW;
  try {
    const saved = storage()?.getItem(tablesViewKey(waiterId));
    return saved === 'all' || saved === 'seated' ? saved : DEFAULT_TABLES_VIEW;
  } catch {
    return DEFAULT_TABLES_VIEW;
  }
}

export function saveTablesView(waiterId: string | null, view: TablesView): void {
  if (!waiterId) return;
  try {
    storage()?.setItem(tablesViewKey(waiterId), view);
  } catch {
    // Storage blocked (a private window): the choice holds until the page reloads.
  }
}

/** This waiter's choice on this phone, and a setter that remembers it. */
export function useTablesView(waiterId: string | null): [TablesView, (view: TablesView) => void] {
  const [view, setView] = useState<TablesView>(() => readTablesView(waiterId));
  useEffect(() => { setView(readTablesView(waiterId)); }, [waiterId]);
  const choose = useCallback((next: TablesView) => {
    saveTablesView(waiterId, next);
    setView(next);
  }, [waiterId]);
  return [view, choose];
}

/** A table in one of the waiter's sections today. */
export interface SectionTable {
  id: string;
  table_number: number;
  section_id: string | null;
}

/** An open table session on one of those tables, whoever has it. */
export interface SectionSession {
  id: string;
  table_id: string;
  assigned_waiter_id: string | null;
}

/** A table this waiter has, seated, from anywhere in the room. */
export interface MySeatedTable {
  id: string;
  table_id: string;
  opened_at: string;
  guest_name: string | null;
  tables: { table_number: number } | null;
}

export type FloorTile =
  | { kind: 'mine'; tableNumber: number; sessionId: string; openedAt: string; guestName: string | null }
  | { kind: 'free'; tableNumber: number; tableId: string }
  | { kind: 'colleague'; tableNumber: number; tableId: string; waiterName: string }
  | { kind: 'nobody'; tableNumber: number; sessionId: string };

/** What is happening at one seated table, for its tile. */
export interface TableSignals {
  /** Plates up on the pass for it. */
  ready: number;
  /** A guest pressed "Call waiter" and nobody has finished it. */
  calling: boolean;
  /** A guest asked for the bill and nobody has finished it. */
  bill: boolean;
  /** Orders in the kitchen, not yet up. */
  cooking: number;
  /** What is still to be paid, in KM. */
  owed: number;
}

export const NO_SIGNALS: TableSignals = { ready: 0, calling: false, bill: false, cooking: 0, owed: 0 };

/**
 * The one thing a tile is coloured by, in the order of "Attention needed":
 * food going cold, then a guest waiting, then the bill.
 */
export function urgentSignal(s: TableSignals): 'ready' | 'calling' | 'bill' | null {
  if (s.ready > 0) return 'ready';
  if (s.calling) return 'calling';
  if (s.bill) return 'bill';
  return null;
}

/** "Table 7, yours, food ready, owes 24.00 KM": what a screen reader says for a tile. */
export function tileLabel(tile: FloorTile, s: TableSignals = NO_SIGNALS, km: (n: number) => string = (n) => `${n.toFixed(2)} KM`): string {
  const parts = [`Table ${tile.tableNumber}`];
  if (tile.kind === 'free') return `${parts[0]}, free`;
  if (tile.kind === 'colleague') return `${parts[0]}, seated with ${tile.waiterName}`;
  parts.push(tile.kind === 'mine' ? 'yours' : 'seated, no waiter');
  if (s.ready > 0) parts.push('food ready');
  if (s.calling) parts.push('calling you');
  if (s.bill) parts.push('wants the bill');
  if (s.cooking > 0) parts.push(`${s.cooking} in the kitchen`);
  if (s.owed > 0) parts.push(`owes ${km(s.owed)}`);
  if (tile.kind === 'nobody') parts.push('tap to take it');
  return parts.join(', ');
}

/** "2 yours · 1 with Lejla · 1 no waiter · 6 free": the floor in one line. */
export function floorSummary(tiles: FloorTile[]): { kind: FloorTile['kind']; count: number; text: string }[] {
  const count = (kind: FloorTile['kind']) => tiles.filter((t) => t.kind === kind).length;
  const colleagues = [...new Set(tiles.flatMap((t) => (t.kind === 'colleague' ? [t.waiterName] : [])))];
  const rows: { kind: FloorTile['kind']; count: number; text: string }[] = [
    { kind: 'mine', count: count('mine'), text: 'yours' },
    { kind: 'colleague', count: count('colleague'), text: colleagues.length === 1 ? `with ${colleagues[0]}` : 'with others' },
    { kind: 'nobody', count: count('nobody'), text: 'no waiter' },
    { kind: 'free', count: count('free'), text: 'free' },
  ];
  return rows.filter((r) => r.count > 0);
}

/**
 * One tile per table, by table number: the waiter's own seated tables (from
 * any section), then every other table in their sections as free, with a
 * colleague, or seated with nobody yet.
 */
export function floorTiles({
  sectionTables, sectionSessions, mine, myWaiterId, waiterNames,
}: {
  sectionTables: SectionTable[];
  sectionSessions: SectionSession[];
  mine: MySeatedTable[];
  myWaiterId: string;
  /** waiters.id → display name. */
  waiterNames: Record<string, string>;
}): FloorTile[] {
  const tiles = new Map<string, FloorTile>();
  for (const session of mine) {
    tiles.set(session.table_id, {
      kind: 'mine',
      tableNumber: session.tables?.table_number ?? 0,
      sessionId: session.id,
      openedAt: session.opened_at,
      guestName: session.guest_name,
    });
  }
  const seated = new Map(sectionSessions.map((s) => [s.table_id, s]));
  for (const table of sectionTables) {
    if (tiles.has(table.id)) continue;
    const session = seated.get(table.id);
    if (!session) {
      tiles.set(table.id, { kind: 'free', tableNumber: table.table_number, tableId: table.id });
    } else if (session.assigned_waiter_id === null) {
      tiles.set(table.id, { kind: 'nobody', tableNumber: table.table_number, sessionId: session.id });
    } else if (session.assigned_waiter_id !== myWaiterId) {
      tiles.set(table.id, {
        kind: 'colleague',
        tableNumber: table.table_number,
        tableId: table.id,
        waiterName: waiterNames[session.assigned_waiter_id] ?? 'Another waiter',
      });
    }
    // Seated with this waiter but not in `mine`: the two reads crossed a
    // change. It is in `mine` at the next refresh; no tile beats a wrong one.
  }
  return [...tiles.values()].sort((a, b) => a.tableNumber - b.tableNumber);
}
