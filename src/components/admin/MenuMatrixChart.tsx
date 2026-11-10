import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Pencil } from 'lucide-react';
import {
  CartesianGrid, Cell, ReferenceArea, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis,
} from 'recharts';
import { Button } from '@/components/ui/button';
import { editDishLink } from '@/lib/insight-actions';
import { menuClassLabel, QUADRANTS, type MenuEngineeringRow, type Quadrant } from '@/lib/menu-intelligence';
import { marginPct, MATRIX_MAX, matrixPoints, priceNudge, type MatrixPoint } from '@/lib/menu-matrix';

/**
 * The menu matrix as a picture: every dish a dot, popular to the right,
 * profitable to the top, the two lines that make the four boxes drawn in.
 *
 * The boxes below it (MenuEngineeringCard) say the same in words; this is
 * for seeing the whole menu at once — which dishes sit just short of a line,
 * which one stands alone in a corner. Tap a dot for the dish: what it keeps
 * a portion, how many go a week, what its box advises, and Edit dish.
 */

const COLOUR: Record<Quadrant, string> = {
  star: 'hsl(var(--primary))',
  plowhorse: 'hsl(var(--gold))',
  puzzle: 'hsl(var(--accent))',
  dog: 'hsl(var(--destructive))',
  insufficient: 'hsl(var(--muted-foreground))',
};

const km = (x: number) => `${x.toFixed(2)} KM`;

const Hover = ({ active, payload }: { active?: boolean; payload?: { payload: MatrixPoint }[] }) => {
  const p = active ? payload?.[0]?.payload : undefined;
  if (!p) return null;
  return (
    <div className="rounded-xl border border-border bg-background px-3 py-2 shadow-lux text-xs font-sans">
      <p className="font-semibold text-foreground text-sm">{p.name}</p>
      <p className="text-muted-foreground">{QUADRANTS[p.quadrant].label} · {menuClassLabel(p.row.menu_class).toLowerCase()}</p>
      <p className="text-foreground mt-1 tabular-nums">Keeps {km(p.row.unit_cm)} a portion · {p.row.units_per_week.toFixed(0)} a week</p>
    </div>
  );
};

const MenuMatrixChart = ({ rows, menuClass }: { rows: MenuEngineeringRow[]; menuClass?: string }) => {
  const points = useMemo(() => matrixPoints(rows, menuClass), [rows, menuClass]);
  const [picked, setPicked] = useState<string | null>(null);
  const chosen = points.find((p) => p.id === picked) ?? null;

  if (points.length === 0) return null;
  const counts = points.reduce<Record<string, number>>((acc, p) => ({ ...acc, [p.quadrant]: (acc[p.quadrant] ?? 0) + 1 }), {});

  return (
    <div>
      <div
        role="img"
        aria-label={`Menu map: ${counts.star ?? 0} stars, ${counts.plowhorse ?? 0} plowhorses, ${counts.puzzle ?? 0} puzzles, ${counts.dog ?? 0} dogs`}
        className="relative h-[280px] sm:h-[340px] rounded-2xl border border-border bg-muted/20"
      >
        {/* The four boxes, named where they are. */}
        <span className="pointer-events-none absolute right-3 top-2 text-[11px] font-sans font-semibold uppercase tracking-wide text-primary">Stars</span>
        <span className="pointer-events-none absolute left-12 top-2 text-[11px] font-sans font-semibold uppercase tracking-wide text-accent">Puzzles</span>
        <span className="pointer-events-none absolute right-3 bottom-9 text-[11px] font-sans font-semibold uppercase tracking-wide text-muted-foreground">Plowhorses</span>
        <span className="pointer-events-none absolute left-12 bottom-9 text-[11px] font-sans font-semibold uppercase tracking-wide text-destructive">Dogs</span>
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 22, right: 14, bottom: 6, left: 0 }}>
            <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="2 4" />
            <ReferenceArea x1={1} x2={MATRIX_MAX} y1={1} y2={MATRIX_MAX} fill="hsl(var(--primary))" fillOpacity={0.05} />
            <ReferenceArea x1={0} x2={1} y1={0} y2={1} fill="hsl(var(--destructive))" fillOpacity={0.04} />
            <XAxis
              type="number" dataKey="x" domain={[0, MATRIX_MAX]} ticks={[0, 1, 2]}
              tickFormatter={(v) => (v === 1 ? 'popular from here' : '')}
              tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false}
              label={{ value: 'More popular →', position: 'insideBottomRight', offset: 0, fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
            />
            <YAxis
              type="number" dataKey="y" domain={[0, MATRIX_MAX]} ticks={[0, 1, 2]} width={40}
              tickFormatter={(v) => (v === 1 ? 'avg' : '')}
              tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false}
              label={{ value: 'Higher margin →', angle: -90, position: 'insideLeft', offset: 18, fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
            />
            <ZAxis type="number" dataKey="weekly" range={[70, 520]} />
            <ReferenceLine x={1} stroke="hsl(var(--foreground))" strokeOpacity={0.35} strokeDasharray="4 4" />
            <ReferenceLine y={1} stroke="hsl(var(--foreground))" strokeOpacity={0.35} strokeDasharray="4 4" />
            <Tooltip content={<Hover />} cursor={false} />
            <Scatter data={points} onClick={(p: { id?: string }) => setPicked(p?.id ?? null)} isAnimationActive={false}>
              {points.map((p) => (
                <Cell
                  key={p.id}
                  fill={COLOUR[p.quadrant]}
                  fillOpacity={picked && picked !== p.id ? 0.35 : 0.85}
                  stroke={picked === p.id ? 'hsl(var(--foreground))' : 'hsl(var(--background))'}
                  strokeWidth={picked === p.id ? 2 : 1}
                  style={{ cursor: 'pointer' }}
                />
              ))}
            </Scatter>
          </ScatterChart>
        </ResponsiveContainer>
      </div>
      <p className="text-[11px] font-sans text-muted-foreground mt-1.5">
        Each dot is a dish, placed against the others of its kind; a bigger dot takes more money a week. Tap one for the dish.
      </p>

      {chosen && (
        <div data-testid="matrix-dish" className="mt-3 rounded-2xl border border-border bg-card p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-serif text-lg font-semibold text-foreground leading-tight">{chosen.name}</p>
              <p className="text-xs font-sans text-muted-foreground">
                {QUADRANTS[chosen.quadrant].label}: {QUADRANTS[chosen.quadrant].summary.toLowerCase()}
              </p>
            </div>
            <Button asChild size="sm" variant="outline" className="gap-1.5 rounded-xl min-h-[40px]">
              <Link to={editDishLink(chosen.id)}><Pencil className="w-3.5 h-3.5" /> Edit dish</Link>
            </Button>
          </div>
          <dl className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm font-sans">
            <div>
              <dt className="text-xs text-muted-foreground">Price</dt>
              <dd className="font-semibold tabular-nums text-foreground">{km(chosen.row.price)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Keeps a portion{chosen.row.cost_estimated ? ' (estimate)' : ''}</dt>
              <dd className="font-semibold tabular-nums text-foreground">
                {km(chosen.row.unit_cm)}
                {marginPct(chosen.row.price, chosen.row.unit_cost) !== null && (
                  <span className="font-normal text-muted-foreground"> · {marginPct(chosen.row.price, chosen.row.unit_cost)}%</span>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Sold a week</dt>
              <dd className="font-semibold tabular-nums text-foreground">{chosen.row.units_per_week.toFixed(0)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">+0.50 KM on the price</dt>
              <dd className="font-semibold tabular-nums text-foreground">
                +{priceNudge(chosen.row)} KM a week
                <span className="block text-[11px] font-normal text-muted-foreground">if it sells the same</span>
              </dd>
            </div>
          </dl>
          <p className="text-sm font-sans text-foreground mt-3 leading-snug">{QUADRANTS[chosen.quadrant].action}</p>
        </div>
      )}
    </div>
  );
};

export default MenuMatrixChart;
