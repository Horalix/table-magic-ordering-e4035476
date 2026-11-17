import { useMemo } from 'react';
import { LayoutGroup, motion, useReducedMotion } from 'framer-motion';
import { BellRing, Grid3x3 } from 'lucide-react';
import { staffMove } from '@/components/staff/staff-motion';
import FloorTile, { type FloorTileData } from './FloorTile';
import { compareNeedsFirst, floorSummary } from './floor-state';

export type FloorOrder = 'table' | 'urgency';

/** Wide enough for "TABLE 12" and "WANTS BILL 12m"; more columns on a TV, two on a phone. */
const GRID = 'grid gap-2.5 sm:gap-3 2xl:gap-4 grid-cols-[repeat(auto-fill,minmax(148px,1fr))] md:grid-cols-[repeat(auto-fill,minmax(176px,1fr))] 2xl:grid-cols-[repeat(auto-fill,minmax(216px,1fr))]';

/**
 * The floor: a summary line ("9 taken · 5 free · 2 need you"), a choice of
 * order, and a tile per table.
 *
 * "By table" (the default) keeps every table where it was, under its section,
 * in number order: a waiter learns where table 7 is on the wall and finds it
 * there all night. "Needs you first" is one list, loudest first; it moves, so
 * it is a choice and not the default.
 */
const FloorView = ({
  tiles, order, onOrderChange, showWaiter, now, onOpen, title, emptyText,
}: {
  /** In table-number order. */
  tiles: FloorTileData[];
  order: FloorOrder;
  onOrderChange: (order: FloorOrder) => void;
  showWaiter: boolean;
  now: number;
  onOpen: (tableId: string) => void;
  /** A heading above the floor, where it shares the page (the rail). */
  title?: string;
  emptyText: string;
}) => {
  const reduced = useReducedMotion();
  const summary = useMemo(() => floorSummary(tiles.map((t) => t.status)), [tiles]);

  const groups = useMemo(() => {
    if (order === 'urgency') {
      const sorted = [...tiles].sort((a, b) => compareNeedsFirst({ status: a.status, number: a.number }, { status: b.status, number: b.number }));
      return [{ key: 'all', name: null as string | null, color: null as string | null, tiles: sorted }];
    }
    // Sections in the order of their lowest table number, as a floor plan reads.
    const bySection = new Map<string, { key: string; name: string | null; color: string | null; tiles: FloorTileData[] }>();
    for (const t of tiles) {
      const key = t.sectionName ?? '';
      const g = bySection.get(key) ?? { key: key || 'none', name: t.sectionName, color: t.sectionColor, tiles: [] };
      g.tiles.push(t);
      bySection.set(key, g);
    }
    const list = [...bySection.values()];
    // One section, or none: no headings, just the tables.
    if (list.length === 1) return [{ ...list[0], name: null }];
    return list.map((g) => (g.name ? g : { ...g, name: 'Other tables' }));
  }, [order, tiles]);

  if (tiles.length === 0) {
    return (
      <div className="max-w-md mx-auto my-12 rounded-xl border border-dashed border-border bg-muted/30 px-6 py-10 text-center text-muted-foreground font-sans flex flex-col items-center gap-2">
        <Grid3x3 className="w-6 h-6 opacity-60" aria-hidden />
        {emptyText}
      </div>
    );
  }

  return (
    <section aria-label={title ?? 'Tables'}>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          {title && <h2 className="font-serif text-xl font-semibold mb-1">{title}</h2>}
          {/* The summary, with its own legend: a solid square is taken, a dashed one free. */}
          <p className="flex flex-wrap items-center gap-x-4 gap-y-1 font-sans text-base lg:text-lg text-muted-foreground" aria-live="polite">
            <span className="inline-flex items-center gap-2">
              <span aria-hidden className="h-4 w-4 rounded-[5px] border-2 border-[hsl(36_12%_56%)] bg-[hsl(36_18%_84%)]" />
              <b className="font-serif text-2xl lg:text-3xl font-bold text-foreground tabular-nums">{summary.taken}</b> taken
            </span>
            <span className="inline-flex items-center gap-2">
              <span aria-hidden className="h-4 w-4 rounded-[5px] border-2 border-dashed border-[hsl(36_8%_62%)]" />
              <b className="font-serif text-2xl lg:text-3xl font-bold text-foreground tabular-nums">{summary.free}</b> free
            </span>
            <span className="inline-flex items-center gap-2">
              <BellRing className={`h-4 w-4 ${summary.needYou ? 'text-foreground' : ''}`} aria-hidden />
              <b className="font-serif text-2xl lg:text-3xl font-bold text-foreground tabular-nums">{summary.needYou}</b> need you
            </span>
          </p>
        </div>
        <div role="group" aria-label="Order the tables" className="inline-flex shrink-0 rounded-full border border-border bg-card p-1">
          {([['table', 'By table'], ['urgency', 'Needs you first']] as const).map(([value, text]) => (
            <button
              key={value}
              type="button"
              aria-pressed={order === value}
              onClick={() => onOrderChange(value)}
              className={`min-h-[40px] rounded-full px-4 text-sm font-sans font-semibold transition-colors ${order === value ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground'}`}
            >
              {text}
            </button>
          ))}
        </div>
      </div>

      <LayoutGroup id="floor-grid">
        <div className="space-y-4">
          {groups.map((g) => {
            const taken = g.tiles.filter((t) => t.status.kind !== 'free').length;
            return (
              <div key={g.key}>
                {g.name && (
                  <h3 className="mb-2 flex items-center gap-2 font-sans text-[13px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: g.color ?? undefined }} aria-hidden />
                    {g.name}
                    <span className="font-medium normal-case tracking-normal">· {taken} of {g.tiles.length} taken</span>
                  </h3>
                )}
                <div className={GRID}>
                  {g.tiles.map((t) => (
                    // Tiles slide only when "Needs you first" reorders them; by table they stay put.
                    <motion.div
                      key={t.id}
                      layout={order === 'urgency' && !reduced ? 'position' : false}
                      transition={{ layout: staffMove }}
                      className="min-w-0 flex"
                    >
                      <FloorTile
                        tile={showWaiter ? t : { ...t, waiterName: null }}
                        now={now}
                        showSection={order === 'urgency'}
                        onOpen={() => onOpen(t.id)}
                      />
                    </motion.div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </LayoutGroup>
    </section>
  );
};

export default FloorView;
