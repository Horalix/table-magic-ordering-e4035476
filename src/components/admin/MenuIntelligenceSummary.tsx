import type React from 'react';
import { ArrowRight, Calculator, Coins, LayoutGrid, Lightbulb } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import CountUp from '@/components/admin/CountUp';
import { Stagger } from '@/components/admin/AdminCard';
import type { HoldoutComparison, Insight, MenuEngineeringRow, Quadrant, SuggestionImpact } from '@/lib/menu-intelligence';
import { quadrantCounts, suggestionsHeadline } from '@/lib/menu-matrix';

/**
 * Menu intelligence in four numbers, before anything else on the page:
 * what the waiting actions are worth a week, what the suggestions earn, the
 * shape of the menu, and how many margins are exact. Each opens its part of
 * the page.
 *
 * Nothing here is a new measure. Each is the headline of a section below,
 * with the same caution: the suggestions' figure is the measured one when a
 * holdout has run, and is called an upper bound when it has not.
 */

export type IntelligenceTab = 'actions' | 'menu' | 'suggestions' | 'kitchen';

const km0 = (n: number) => `${Math.round(n).toLocaleString('en')} KM`;

const Tile = ({ icon: Icon, label, onOpen, children }: {
  icon: React.ElementType; label: string; onOpen: () => void; children: React.ReactNode;
}) => (
  <button
    type="button"
    onClick={onOpen}
    className="group flex h-full w-full flex-col items-stretch justify-start text-left rounded-2xl border border-border/80 bg-card p-4 sm:p-5 shadow-lux transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-px hover:border-primary/40 hover:shadow-lux-lg motion-reduce:transform-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
  >
    <span className="flex items-start justify-between gap-2">
      <span className="text-[13px] font-sans font-medium leading-snug text-muted-foreground">{label}</span>
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground" aria-hidden>
        <Icon className="w-4 h-4 group-hover:hidden" />
        <ArrowRight className="hidden w-4 h-4 group-hover:block" />
      </span>
    </span>
    {children}
  </button>
);

const Big = ({ children }: { children: React.ReactNode }) => (
  <span className="mt-1.5 block font-sans text-[22px] sm:text-[26px] font-semibold leading-tight tracking-tight text-foreground">{children}</span>
);
const Sub = ({ children }: { children: React.ReactNode }) => (
  <span className="mt-1.5 block text-xs font-sans text-muted-foreground leading-snug">{children}</span>
);

const SHAPE: { q: Exclude<Quadrant, 'insufficient'>; one: string; many: string; bar: string }[] = [
  { q: 'star', one: 'star', many: 'stars', bar: 'bg-primary' },
  { q: 'plowhorse', one: 'plowhorse', many: 'plowhorses', bar: 'bg-[hsl(var(--gold))]' },
  { q: 'puzzle', one: 'puzzle', many: 'puzzles', bar: 'bg-accent' },
  { q: 'dog', one: 'dog', many: 'dogs', bar: 'bg-destructive' },
];

const MenuIntelligenceSummary = ({ insights, holdout, impact, rows, onOpen }: {
  /** The "What to do next" cards; null while they load. */
  insights: Insight[] | null;
  holdout: HoldoutComparison | null;
  impact: SuggestionImpact | null;
  /** The matrix's rows; null while they load. */
  rows: MenuEngineeringRow[] | null;
  onOpen: (tab: IntelligenceTab, anchor?: string) => void;
}) => {
  // A sales day's gap is not a weekly figure, so it is left out of the sum.
  const weekly = (insights ?? []).filter((i) => i.kind !== 'anomaly');
  const worth = weekly.reduce((sum, i) => sum + Number(i.est_km_per_week ?? 0), 0);
  const counts = rows ? quadrantCounts(rows) : null;
  const placed = counts ? SHAPE.reduce((sum, s) => sum + counts[s.q], 0) : 0;
  const exact = (rows ?? []).filter((r) => !r.cost_estimated).length;
  const suggestions = suggestionsHeadline(holdout, impact);

  return (
    <Stagger as="section" aria-label="Summary" className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4">
      <Tile icon={Lightbulb} label="Worth acting on" onOpen={() => onOpen('actions')}>
        {insights === null ? <Skeleton className="mt-2 h-14 rounded-xl" /> : weekly.length === 0 ? (
          <><Big>Nothing waiting</Big><Sub>No action has passed its test right now.</Sub></>
        ) : (
          <>
            <Big><CountUp value={worth} format={(n) => `~${km0(n)} a week`} /></Big>
            <Sub>{weekly.length === 1 ? '1 thing to do' : `${weekly.length} things to do`}, each tested and worth 20 KM a week or more.</Sub>
          </>
        )}
      </Tile>

      <Tile icon={Coins} label="Suggestions earn" onOpen={() => onOpen('suggestions')}>
        <Big>{suggestions.big}</Big>
        <Sub>{suggestions.sub}</Sub>
      </Tile>

      <Tile icon={LayoutGrid} label="Menu shape" onOpen={() => onOpen('menu', 'engineering')}>
        {!counts ? <Skeleton className="mt-2 h-14 rounded-xl" /> : placed === 0 ? (
          <><Big>No sales yet</Big><Sub>The matrix fills in once dishes have sold.</Sub></>
        ) : (
          <>
            <span className="mt-3 flex h-3 overflow-hidden rounded-full bg-muted" aria-hidden>
              {SHAPE.map((s) => counts[s.q] > 0 && (
                <span key={s.q} className={s.bar} style={{ width: `${(counts[s.q] / placed) * 100}%` }} />
              ))}
            </span>
            <span className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-xs font-sans text-foreground tabular-nums">
              {SHAPE.map((s) => (
                <span key={s.q} className="inline-flex items-center gap-1.5">
                  <span className={`h-2 w-2 rounded-full ${s.bar}`} aria-hidden /> {counts[s.q]} {counts[s.q] === 1 ? s.one : s.many}
                </span>
              ))}
            </span>
            {counts.insufficient > 0 && <Sub>{counts.insufficient} more too close to call.</Sub>}
          </>
        )}
      </Tile>

      <Tile icon={Calculator} label="Exact margins" onOpen={() => onOpen('menu', 'costs')}>
        {!rows ? <Skeleton className="mt-2 h-14 rounded-xl" /> : (
          <>
            <Big><CountUp value={exact} format={(n) => `${Math.round(n)} of ${rows.length}`} /></Big>
            <Sub>
              {exact === rows.length && rows.length > 0
                ? 'Every dish that sold has its real ingredient cost.'
                : 'dishes that sold have a recorded cost; the rest are estimates. Record costs →'}
            </Sub>
          </>
        )}
      </Tile>
    </Stagger>
  );
};

export default MenuIntelligenceSummary;
