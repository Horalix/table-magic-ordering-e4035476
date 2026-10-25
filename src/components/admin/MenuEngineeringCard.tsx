import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, LayoutGrid } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  getMenuEngineering, groupByQuadrant, menuClassLabel, QUADRANTS,
  type MenuEngineeringRow, type Quadrant,
} from '@/lib/menu-intelligence';

/**
 * The menu-engineering matrix (Kasavana & Smith), per menu class.
 *
 * Laid out the way the textbook draws it — popular on top, high margin on the
 * left — so the four actions sit where an owner who has seen the matrix
 * before expects them. On a phone the boxes stack in the same reading order.
 * Dishes whose share is within noise of the popularity line are listed apart,
 * not forced into a box.
 */

const pct = (x: number | null) => (x === null ? '—' : `${(x * 100).toFixed(1)}%`);
const km = (x: number) => `${x.toFixed(2)} KM`;

const BOX_TONE: Record<Exclude<Quadrant, 'insufficient'>, string> = {
  star: 'border-primary/40 bg-primary/5',
  plowhorse: 'border-accent/40 bg-accent/5',
  puzzle: 'border-accent/40 bg-accent/5',
  dog: 'border-destructive/30 bg-destructive/5',
};

const ItemLine = ({ r }: { r: MenuEngineeringRow }) => (
  <li className="py-1.5 text-sm font-sans">
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-foreground min-w-0 truncate">{r.name}</span>
      <span className="tabular-nums text-foreground shrink-0">{km(r.unit_cm)}</span>
    </div>
    <div className="flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground tabular-nums">
      <span>{pct(r.menu_mix)} of {menuClassLabel(r.menu_class).toLowerCase()} (line {pct(r.popularity_threshold)})</span>
      <span>· avg margin {km(r.class_avg_cm)}</span>
      {r.cost_estimated && (
        <span className="px-1.5 rounded-full bg-muted text-muted-foreground" title="No food cost recorded; a typical cost share for this kind of dish was used.">
          estimated cost
        </span>
      )}
      {r.available_days < r.trading_days && (
        <span>· on sale {r.available_days} of {r.trading_days} days</span>
      )}
    </div>
  </li>
);

const Box = ({ q, rows }: { q: Exclude<Quadrant, 'insufficient'>; rows: MenuEngineeringRow[] }) => {
  const [open, setOpen] = useState(false);
  const visible = open ? rows : rows.slice(0, 6);
  return (
    <section className={`rounded-2xl border p-4 ${BOX_TONE[q]}`} aria-label={QUADRANTS[q].label}>
      <div className="flex items-baseline justify-between gap-2">
        <h4 className="font-sans font-semibold text-foreground">{QUADRANTS[q].label}</h4>
        <span className="text-xs font-sans text-muted-foreground tabular-nums">{rows.length}</span>
      </div>
      <p className="text-xs font-sans text-muted-foreground">{QUADRANTS[q].summary}</p>
      <p className="text-sm font-sans text-foreground mt-2 leading-snug">{QUADRANTS[q].action}</p>
      {rows.length === 0 ? (
        <p className="text-xs font-sans text-muted-foreground mt-2">None.</p>
      ) : (
        <ul className="mt-2 divide-y divide-border/60">
          {visible.map((r) => <ItemLine key={r.item_id} r={r} />)}
        </ul>
      )}
      {rows.length > 6 && (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="mt-2 text-xs font-sans font-semibold text-primary min-h-[32px]"
        >
          {open ? 'Show fewer' : `Show all ${rows.length}`}
        </button>
      )}
    </section>
  );
};

const MenuEngineeringCard = ({ days = 28 }: { days?: number }) => {
  const [rows, setRows] = useState<MenuEngineeringRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [menuClass, setMenuClass] = useState<string>('');

  useEffect(() => {
    let cancelled = false;
    getMenuEngineering(days)
      .then((r) => { if (!cancelled) { setRows(r); setError(null); } })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); });
    return () => { cancelled = true; };
  }, [days]);

  const classes = useMemo(() => [...new Set((rows ?? []).map((r) => r.menu_class))].sort(), [rows]);
  const boxes = useMemo(() => groupByQuadrant(rows ?? [], menuClass || undefined), [rows, menuClass]);
  const scoped = (rows ?? []).filter((r) => !menuClass || r.menu_class === menuClass);
  const estimated = scoped.filter((r) => r.cost_estimated).length;
  const assumed = scoped.some((r) => r.availability_basis === 'assumed');

  return (
    <Card id="engineering" className="rounded-2xl border-border">
      <CardHeader className="pb-3">
        <CardTitle className="font-serif text-lg flex items-center gap-2">
          <LayoutGrid className="w-5 h-5 text-primary shrink-0" /> Menu engineering
        </CardTitle>
        <p className="text-xs font-sans text-muted-foreground">
          Each dish against the others of its kind, over the last {days} complete trading days. Popular means at
          least 70% of an equal share; high margin means at least the kind&apos;s average margin per portion.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? (
          <div className="flex items-start gap-2 text-sm font-sans">
            <AlertTriangle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
            <p className="text-muted-foreground break-words">Could not load the matrix: {error}</p>
          </div>
        ) : !rows ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-40 rounded-2xl" />)}
          </div>
        ) : rows.length === 0 ? (
          <p className="text-sm font-sans text-muted-foreground py-4 text-center">No sales in this window yet.</p>
        ) : (
          <>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Kind of dish">
              {['', ...classes].map((c) => (
                <button
                  key={c || 'all'}
                  type="button"
                  onClick={() => setMenuClass(c)}
                  aria-pressed={menuClass === c}
                  className={`px-3 min-h-[36px] rounded-full text-xs font-sans font-medium border transition-colors ${
                    menuClass === c ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground hover:bg-muted'
                  }`}
                >
                  {c ? menuClassLabel(c) : 'All'}
                </button>
              ))}
            </div>

            <div className="hidden md:grid grid-cols-[auto_1fr_1fr] gap-x-3 text-[11px] font-sans uppercase tracking-wide text-muted-foreground">
              <span />
              <span>Margin at or above average</span>
              <span>Margin below average</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-[auto_1fr_1fr] gap-3 items-stretch">
              <span className="hidden md:flex items-center text-[11px] font-sans uppercase tracking-wide text-muted-foreground [writing-mode:vertical-rl] rotate-180">Popular</span>
              <Box q="star" rows={boxes.star} />
              <Box q="plowhorse" rows={boxes.plowhorse} />
              <span className="hidden md:flex items-center text-[11px] font-sans uppercase tracking-wide text-muted-foreground [writing-mode:vertical-rl] rotate-180">Not popular</span>
              <Box q="puzzle" rows={boxes.puzzle} />
              <Box q="dog" rows={boxes.dog} />
            </div>

            {boxes.insufficient.length > 0 && (
              <div className="rounded-2xl border border-dashed border-border p-4">
                <p className="text-sm font-sans font-semibold text-foreground">
                  {QUADRANTS.insufficient.label} <span className="text-muted-foreground font-normal tabular-nums">· {boxes.insufficient.length}</span>
                </p>
                <p className="text-xs font-sans text-muted-foreground mt-0.5">
                  Their share of orders is within noise of the popularity line (80% interval), so they are not put
                  in a box yet. {QUADRANTS.insufficient.action}
                </p>
                <p className="text-sm font-sans text-foreground mt-2 leading-relaxed">
                  {boxes.insufficient.map((r) => r.name).join(', ')}
                </p>
              </div>
            )}

            <div className="text-[11px] font-sans text-muted-foreground space-y-1">
              {estimated > 0 && (
                <p>
                  {estimated} of {scoped.length} dishes have no food cost recorded; their margin uses a typical café
                  cost share for their kind of dish. Recording real food costs makes the matrix sharper.
                </p>
              )}
              {assumed && (
                <p>
                  Each dish is judged only on the days it was on sale. Availability history is recorded from this
                  release on; before it, a dish counts as on sale unless it is sold out now and stopped selling.
                </p>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
};

export default MenuEngineeringCard;
