import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { formatStamp } from '@/lib/timing';
import { Link, useLocation } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import PrepAccuracyPanel from '@/components/admin/PrepAccuracyPanel';
import InsightCards from '@/components/admin/InsightCards';
import MenuEngineeringCard from '@/components/admin/MenuEngineeringCard';
import RecoFunnelCard from '@/components/admin/RecoFunnelCard';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  RefreshCw, TrendingUp, TrendingDown, Link2, Sparkles, Brain, AlertTriangle,
  Coins, Eye, Plus, Info, CheckCircle2, Ban, ArrowRight,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  getEngineHealth, getHoldoutComparison, getItemPerformance, getPairings,
  getSoldOutImpact, getSuggestionImpact, getSuggestionPerformance, getPlacementImpact,
  refreshIntelligence, curatePairing, placementLabel,
  findDeadWeight, findLeaks, LEAK_MIN_VIEWS,
  type EngineHealth, type HoldoutComparison, type ItemPerformance, type Pairing,
  type PlacementImpact, type SoldOutRow, type SuggestionImpact, type SuggestionRow, type SuggestionStatus,
} from '@/lib/menu-intelligence';

const km = (n: number | null | undefined) => `${Number(n ?? 0).toFixed(2)} KM`;
const pct = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `${Number(n).toFixed(1)}%`);
const when = (iso: string | null | undefined) => (iso ? formatStamp(iso) : 'never');

/**
 * One section's data, or why it is missing.
 *
 * Each read is independent. Before, all eight were awaited together and one
 * failure — a single bad analytics row was enough — blanked the whole page
 * behind a toast. Now a failed section says so in its own place and the rest
 * of the page still answers.
 */
interface Section<T> {
  data: T | null;
  error: string | null;
}

const empty = <T,>(): Section<T> => ({ data: null, error: null });

const settle = <T,>(result: PromiseSettledResult<T>): Section<T> => (
  result.status === 'fulfilled'
    ? { data: result.value, error: null }
    : { data: null, error: result.reason instanceof Error ? result.reason.message : String(result.reason) }
);

const SectionError = ({ title, message }: { title: string; message: string }) => (
  <Card className="border-destructive/30">
    <CardContent className="p-4 flex items-start gap-2">
      <AlertTriangle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
      <div className="text-sm font-sans min-w-0">
        <p className="font-semibold text-foreground">Could not load {title}.</p>
        <p className="text-muted-foreground mt-0.5 break-words">{message}</p>
      </div>
    </CardContent>
  </Card>
);

const Stat = ({ icon: Icon, label, value, sub, tone = 'text-primary' }: {
  icon: React.ElementType; label: string; value: string; sub?: React.ReactNode; tone?: string;
}) => (
  <Card className="border-border">
    <CardContent className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-sans text-muted-foreground">{label}</p>
          <p className="text-2xl font-sans font-semibold text-foreground mt-1 tabular-nums">{value}</p>
          {sub && <p className="text-xs font-sans text-muted-foreground mt-0.5 leading-snug">{sub}</p>}
        </div>
        <div className={`w-10 h-10 rounded-lg bg-muted grid place-items-center shrink-0 ${tone}`}>
          <Icon className="w-5 h-5" />
        </div>
      </div>
    </CardContent>
  </Card>
);

const STATUS_STYLE: Record<SuggestionStatus, { label: string; className: string }> = {
  strong:   { label: 'Strong',   className: 'bg-primary/10 text-primary' },
  working:  { label: 'Working',  className: 'bg-accent/10 text-accent' },
  weak:     { label: 'Weak',     className: 'bg-muted text-muted-foreground' },
  learning: { label: 'Learning', className: 'bg-muted text-muted-foreground' },
  retired:  { label: 'Retired',  className: 'bg-destructive/10 text-destructive' },
};

/**
 * The causal read, in brief.
 *
 * The full account — split health, power, guardrails, how to start a holdout —
 * lives on the impact page, which owns it. This is the one-line answer and a
 * way there. It reads the same function with the same type, per VISIT and in
 * net sales, so the two pages always say the same thing.
 */
const HoldoutSummary = ({ holdout }: { holdout: HoldoutComparison }) => {
  const treated = holdout.with_suggestions;
  const held = holdout.holdout;

  const headline = (() => {
    switch (holdout.status) {
      case 'positive':
        return (
          <>
            <p className="font-sans text-3xl font-semibold text-foreground tabular-nums">
              {km(holdout.conservative_monthly_value)}{' '}
              <span className="text-base font-sans font-normal text-muted-foreground">a month</span>
            </p>
            <p className="text-sm font-sans text-muted-foreground mt-1">
              Tables shown suggestions spend <strong className="text-foreground">{km(holdout.difference)}</strong> more
              per visit. Deliberately cautious: projected from the low end of the range
              ({km(holdout.ci_low)} to {km(holdout.ci_high)} per visit).
            </p>
          </>
        );
      case 'negative':
        return (
          <>
            <p className="font-serif text-2xl font-bold text-destructive">Suggestions are costing you money</p>
            <p className="text-sm font-sans text-muted-foreground mt-1">
              Tables shown suggestions spend{' '}
              <strong className="text-foreground">{km(Math.abs(Number(holdout.difference ?? 0)))}</strong>{' '}
              <em>less</em> per visit, by more than chance explains.
            </p>
          </>
        );
      case 'no_measurable_effect':
        return (
          <>
            <p className="font-serif text-2xl font-bold text-foreground">No measurable effect</p>
            <p className="text-sm font-sans text-muted-foreground mt-1">
              The gap between the two groups ({km(holdout.ci_low)} to {km(holdout.ci_high)} per visit) includes
              zero. That is a finding, not a missing one: suggestions are neither helping nor hurting yet.
            </p>
          </>
        );
      case 'too_early':
        return (
          <>
            <p className="font-serif text-2xl font-bold text-foreground">Not enough data yet</p>
            <p className="text-sm font-sans text-muted-foreground mt-1">
              {treated?.sessions ?? 0} visits with suggestions and {held?.sessions ?? 0} without. Any difference
              at these numbers is noise, so no figure is shown.
            </p>
          </>
        );
      case 'invalid_srm':
        return (
          <>
            <p className="font-serif text-2xl font-bold text-destructive flex items-center gap-2">
              <AlertTriangle className="w-6 h-6 shrink-0" /> The experiment is not sound
            </p>
            <p className="text-sm font-sans text-muted-foreground mt-1">
              A {holdout.srm?.expected_holdout_pct}% holdout is delivering {holdout.srm?.observed_holdout_pct}%.
              Tables are being assigned incorrectly, so no result is shown.
            </p>
          </>
        );
      default:
        return (
          <>
            <p className="font-serif text-2xl font-bold text-foreground">Not measured</p>
            <p className="text-sm font-sans text-muted-foreground mt-1">
              No holdout is running, so what suggestions are worth cannot be measured — only guessed at.
            </p>
          </>
        );
    }
  })();

  return (
    <div className="space-y-4">
      <div>{headline}</div>

      {holdout.status !== 'not_running' && holdout.status !== 'invalid_srm' && treated && held && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="rounded-xl border border-border p-4">
            <p className="text-xs font-sans text-muted-foreground">With suggestions</p>
            <p className="text-xl font-sans font-semibold tabular-nums mt-1">{km(treated.avg_net_sales)}</p>
            <p className="text-xs font-sans text-muted-foreground">per visit · {treated.sessions} visits</p>
          </div>
          <div className="rounded-xl border border-border p-4">
            <p className="text-xs font-sans text-muted-foreground">Holdout ({holdout.holdout_pct}% of tables)</p>
            <p className="text-xl font-sans font-semibold tabular-nums mt-1">{km(held.avg_net_sales)}</p>
            <p className="text-xs font-sans text-muted-foreground">per visit · {held.sessions} visits</p>
          </div>
        </div>
      )}

      <Button asChild variant="outline" size="sm" className="gap-1.5">
        <Link to="/admin/impact">
          {holdout.status === 'not_running' ? 'Start a holdout' : 'Full read: what the app earned'}
          <ArrowRight className="w-4 h-4" />
        </Link>
      </Button>
    </div>
  );
};

/**
 * Menu Intelligence.
 *
 * Answers, in order: is the suggestion engine earning its place, what is it
 * learning, which dishes are being looked at and not bought, what genuinely
 * goes with what, and what is being sold out costing.
 *
 * Deliberately shows the engine's own workings. A recommendation system nobody
 * can inspect is one nobody will trust or correct.
 */
const AdminMenuIntelligence = () => {
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [items, setItems] = useState<Section<ItemPerformance[]>>(empty);
  const [pairs, setPairs] = useState<Section<Pairing[]>>(empty);
  const [suggestions, setSuggestions] = useState<Section<SuggestionRow[]>>(empty);
  const [impact, setImpact] = useState<Section<SuggestionImpact>>(empty);
  const [health, setHealth] = useState<Section<EngineHealth>>(empty);
  const [holdout, setHoldout] = useState<Section<HoldoutComparison>>(empty);
  const [placements, setPlacements] = useState<Section<PlacementImpact[]>>(empty);
  const [soldOut, setSoldOut] = useState<Section<SoldOutRow[]>>(empty);

  const load = useCallback(async () => {
    setLoading(true);
    const [i, p, s, im, h, ho, so, pl] = await Promise.allSettled([
      getItemPerformance(days), getPairings(30), getSuggestionPerformance(50),
      getSuggestionImpact(days), getEngineHealth(), getHoldoutComparison(days),
      getSoldOutImpact(days), getPlacementImpact(days),
    ]);
    setItems(settle(i)); setPairs(settle(p)); setSuggestions(settle(s));
    setImpact(settle(im)); setHealth(settle(h)); setHoldout(settle(ho));
    setSoldOut(settle(so)); setPlacements(settle(pl));
    setLoading(false);
  }, [days]);

  useEffect(() => { void load(); }, [load]);

  // A link from the dashboard ("All 7", a card's "Open") lands on its section.
  const location = useLocation();
  useEffect(() => {
    if (!location.hash || loading) return;
    document.getElementById(location.hash.slice(1))?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [location.hash, loading]);

  const recompute = async () => {
    setRefreshing(true);
    try {
      const result = await refreshIntelligence();
      toast.success(`Recomputed — ${result.pairs} pairings, ${result.suggestion_rows} tracked suggestions`);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Refresh failed');
    } finally {
      setRefreshing(false);
    }
  };

  const curate = async (pair: Pairing) => {
    try {
      await curatePairing(pair.item_a, pair.item_b);
      toast.success(`${pair.name_a} → ${pair.name_b} added to suggestions`);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not add the pairing');
    }
  };

  const itemRows = useMemo(() => items.data ?? [], [items.data]);
  const leaks = useMemo(() => findLeaks(itemRows), [itemRows]);
  const dead = useMemo(() => findDeadWeight(itemRows, days), [itemRows, days]);
  const mostViewed = useMemo(() => [...itemRows].sort((a, b) => b.views - a.views).slice(0, 10), [itemRows]);

  const firstLoad = loading && !items.data && !items.error;
  if (firstLoad) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)}
        </div>
        {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-64 rounded-xl" />)}
      </div>
    );
  }

  const im = impact.data;
  const engine = health.data;
  const windowDays = engine?.window_days ?? 90;
  const noData = (im?.shown ?? 0) === 0 && (im?.seen ?? 0) === 0 && itemRows.every((i) => i.views === 0);

  // Prefer the server-verified measure: a recorded sighting, and a suggested
  // line that reached a completed order. Taps are shown only when the ledger
  // has nothing yet, and are called taps.
  const verified = (im?.seen ?? 0) > 0;

  // The fixed-window sections say so, because the selector above does not move them.
  const fixedWindowNote = (
    <>
      Covers the last {windowDays} days, whatever range is selected above. Last recomputed{' '}
      {when(engine?.stats_updated_at ?? engine?.affinity_computed_at)}.
    </>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-serif text-3xl font-bold text-foreground">Menu intelligence</h1>
          <p className="text-sm text-muted-foreground font-sans mt-1">
            What guests look at, what they buy, and whether the suggestions are earning their place.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={String(days)} onValueChange={(v) => setDays(Number(v))}>
            <SelectTrigger className="w-[140px]" aria-label="Range"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="7">Last 7 days</SelectItem>
              <SelectItem value="30">Last 30 days</SelectItem>
              <SelectItem value="90">Last 90 days</SelectItem>
            </SelectContent>
          </Select>
          <Button onClick={recompute} disabled={refreshing} variant="outline" className="gap-2">
            <RefreshCw className={`w-4 h-4 ${refreshing || loading ? 'animate-spin' : ''}`} /> Recompute
          </Button>
        </div>
      </div>

      {noData && !impact.error && !items.error && (
        <Card className="border-border">
          <CardContent className="p-5 flex items-start gap-3">
            <Info className="w-5 h-5 text-accent shrink-0 mt-0.5" />
            <div className="text-sm font-sans">
              <p className="font-semibold text-foreground">Nothing to learn from yet.</p>
              <p className="text-muted-foreground mt-1">
                These numbers fill in as guests use the app. A pairing needs at least three tables
                before the engine acts on it; acceptance needs about twenty impressions
                per suggestion. Come back after a full service.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ---- What to do next: every card that passed its test, worth first ---- */}
      <InsightCards id="insights" />

      <MenuEngineeringCard />

      {/* ---- Is it earning its place? ---- */}
      {impact.error ? <SectionError title="suggestion figures" message={impact.error} /> : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <Stat
            icon={Coins}
            label="Earned by suggestions (upper bound)"
            value={km(im?.attributed_revenue)}
            sub={`${pct(im?.uplift_pct)} of ${km(im?.net_sales ?? im?.total_revenue)} net sales`}
          />
          {verified ? (
            <Stat
              icon={Sparkles}
              label="Suggestions taken and paid for"
              value={pct(im?.paid_acceptance_pct)}
              sub={`${im?.paid ?? 0} paid of ${im?.seen ?? 0} actually seen`}
              tone="text-accent"
            />
          ) : (
            <Stat
              icon={Sparkles}
              label="Suggestion taps"
              value={pct(im?.overall_acceptance_pct)}
              sub={`${im?.accepted ?? 0} taps of ${im?.shown ?? 0} shown — a tap is not a sale`}
              tone="text-accent"
            />
          )}
          <Stat
            icon={Link2}
            label="Orders that took one"
            value={pct(im?.attach_rate_pct)}
            sub={`${im?.orders_with_suggestion ?? 0} of ${im?.orders ?? 0} orders`}
            tone="text-accent"
          />
        </div>
      )}

      <PrepAccuracyPanel />

      {/*
        The headline.

        Deliberately leads with the CAUSAL number and its uncertainty, not with
        attributed revenue — attribution counts the whole line every time a
        guest takes a suggestion, including the coffee they were always going
        to order. It is an upper bound wearing the costume of a measurement.
      */}
      {holdout.error ? <SectionError title="the holdout comparison" message={holdout.error} /> : (
        <Card className={
          holdout.data?.status === 'positive' ? 'border-primary/40 bg-primary/5'
            : holdout.data?.status === 'negative' || holdout.data?.status === 'invalid_srm'
              ? 'border-destructive/40 bg-destructive/5'
              : 'border-border'
        }>
          <CardHeader className="pb-3">
            <CardTitle className="font-serif text-lg flex items-center gap-2">
              <Brain className="w-5 h-5 text-primary shrink-0" /> What are the suggestions actually worth?
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {holdout.data
              ? <HoldoutSummary holdout={holdout.data} />
              : <Skeleton className="h-20 rounded-xl" />}

            {/* Per head, which takes party size out of the comparison. */}
            {im && (im.per_cover.sessions_counted ?? im.per_cover.orders_counted) > 0 && (
              <p className="text-sm font-sans text-muted-foreground">
                Per guest: <strong className="text-foreground">{km(im.per_cover.with_suggestions)}</strong> with
                suggestions vs <strong className="text-foreground">{km(im.per_cover.holdout)}</strong> without —
                net sales per head over the whole visit, from the{' '}
                {im.per_cover.sessions_counted ?? im.per_cover.orders_counted} visit
                {(im.per_cover.sessions_counted ?? im.per_cover.orders_counted) === 1 ? '' : 's'} where staff
                recorded a head count.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/*
        The tempting comparison, placed AFTER the causal one and labelled. Guests
        who take a suggestion were bigger spenders before they took it, so this
        gap overstates what suggestions did — by an unknown amount.
      */}
      {im && (
        <Card className="border-border border-dashed">
          <CardContent className="p-5 space-y-2">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <p className="text-sm font-sans text-muted-foreground flex items-center gap-1.5">
                <TrendingUp className="w-4 h-4 shrink-0" /> Order with a suggestion vs without
              </p>
              <Badge variant="outline" className="text-[11px]">Upper bound, not causal</Badge>
            </div>
            <p className="font-sans text-xl font-semibold text-foreground tabular-nums">
              {km(im.avg_order_with_suggestion)}{' '}
              <span className="text-sm font-sans font-normal text-muted-foreground">
                vs {km(im.avg_order_without_suggestion)} per order (items, excluding tips)
              </span>
            </p>
            <p className="text-xs font-sans text-muted-foreground">
              Guests who take a suggestion tend to be the bigger spenders already, so this gap is larger than
              anything the suggestions caused. Separately, <strong className="text-foreground">{km(im.attributed_revenue)}</strong>{' '}
              came from lines added straight after a suggestion — also an upper bound, because it counts the
              whole line even when the guest would have ordered it anyway. The holdout above is the number to
              trust.
            </p>
          </CardContent>
        </Card>
      )}

      <RecoFunnelCard holdout={holdout.data} />

      {/* ---- Which surface earns its space ---- */}
      {placements.error ? <SectionError title="placements" message={placements.error} /> : (placements.data?.length ?? 0) > 0 && (
        <Card className="border-border">
          <CardHeader className="pb-3">
            <CardTitle className="font-serif text-lg">Which suggestion spot earns its place</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm font-sans text-muted-foreground mb-3">
              The cart, the dish page and the after-meal prompt are three different products doing
              three different jobs. One combined number hides which to invest in — and which to
              switch off. Counts are taps on the guest&apos;s phone; money is from completed orders.
            </p>
            <div className="space-y-1.5">
              {placements.data?.map((row) => (
                <div
                  key={row.placement}
                  className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 py-2 px-3 rounded-lg bg-muted/40"
                >
                  <span className="text-sm font-sans font-medium">{placementLabel(row.placement)}</span>
                  <span className="text-sm font-sans tabular-nums text-muted-foreground">
                    {row.shown} shown · <span className="text-foreground font-semibold">{row.acceptance_pct}%</span> tapped ·{' '}
                    <span className="text-foreground font-semibold">{km(row.attributed_revenue)}</span>
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ---- What the engine is doing ---- */}
      {health.error ? <SectionError title="the engine's settings" message={health.error} /> : engine && (
        <Card className="border-border">
          <CardHeader className="pb-3">
            <CardTitle className="font-serif text-lg flex items-center gap-2">
              <Brain className="w-5 h-5 text-accent shrink-0" /> How the engine decides
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm font-sans text-muted-foreground leading-relaxed">
              Each candidate gets a score from four signals, then every guardrail is applied on top —
              never a sold-out dish, never something already in the cart, never another item from the
              same part of the menu unless you marked it an upgrade or add-on. Learning changes the
              order of good suggestions; it cannot introduce a bad one.
            </p>

            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              {([
                ['Curated', engine.weights.curated, 'Your rules'],
                ['Observed', engine.weights.observed, 'Real baskets'],
                ['Learned', engine.weights.learned, 'What guests accept'],
                ['Margin', engine.weights.margin, 'Internal only'],
                ['Exploration', engine.weights.exploration, 'Chance for new items'],
              ] as const).map(([label, weight, hint]) => (
                <div key={label} className="rounded-xl border border-border p-3">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="text-xs font-sans font-semibold text-foreground">{label}</p>
                    <p className="text-sm font-sans font-bold text-primary tabular-nums">{weight}</p>
                  </div>
                  <div className="mt-2 h-1.5 rounded-full bg-muted overflow-hidden">
                    <div className="h-full bg-primary rounded-full" style={{ width: `${weight}%` }} />
                  </div>
                  <p className="text-[11px] font-sans text-muted-foreground mt-1.5">{hint}</p>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm font-sans">
              <div><span className="text-muted-foreground">Your rules:</span> <strong>{engine.curated_rules}</strong></div>
              <div><span className="text-muted-foreground">Pairings found:</span> <strong>{engine.learned_pairs}</strong></div>
              <div><span className="text-muted-foreground">Still learning:</span> <strong>{engine.pairs_still_learning}</strong></div>
              <div><span className="text-muted-foreground">Retired:</span> <strong>{engine.pairs_retired}</strong></div>
            </div>

            <p className="text-xs font-sans text-muted-foreground">
              A pair is retired automatically once it has been shown{' '}
              {engine.retire_after_impressions}+ times and accepted less than{' '}
              {engine.retire_below_acceptance_pct}% of the time. Built from{' '}
              {engine.orders_analysed} orders in the last {windowDays} days. Pairings last recomputed{' '}
              {when(engine.affinity_computed_at)}; suggestion stats {when(engine.stats_updated_at)}.
            </p>
            {engine.learning && (
              <p className="text-xs font-sans text-muted-foreground">
                <strong className="text-foreground">Learning from {engine.learning.tables} tables</strong>{' '}
                as each order reaches the kitchen: {engine.learning.dish_pairs} dish pairs, and{' '}
                {engine.learning.family_pairs} that similar dishes inherit. A table last taught it{' '}
                {when(engine.learning.last_learned_at)}; fully refreshed {when(engine.learning.refreshed_at)}{' '}
                (every 30 minutes during service, by {engine.learning.scheduler}). What enough tables choose can
                overtake your pairings — never the rules above.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* ---- Suggestion performance ---- */}
      {suggestions.error ? <SectionError title="suggestion performance" message={suggestions.error} /> : (
        <Card className="border-border">
          <CardHeader className="pb-3">
            <CardTitle className="font-serif text-lg">Which suggestions work</CardTitle>
            <p className="text-xs font-sans text-muted-foreground">{fixedWindowNote}</p>
          </CardHeader>
          <CardContent>
            {(suggestions.data?.length ?? 0) === 0 ? (
              <p className="text-sm text-muted-foreground font-sans py-6 text-center">
                No suggestion has been shown yet.
              </p>
            ) : (
              <div className="overflow-x-auto -mx-2 px-2">
                <table className="w-full text-sm font-sans min-w-[720px]">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground border-b border-border">
                      <th className="pb-2 font-medium">Suggestion</th>
                      <th className="pb-2 font-medium">Where</th>
                      <th className="pb-2 font-medium text-right">Shown</th>
                      <th className="pb-2 font-medium text-right">Taken</th>
                      <th className="pb-2 font-medium text-right">Rate</th>
                      <th className="pb-2 font-medium text-right">Earned</th>
                      <th className="pb-2 font-medium text-right">Per show</th>
                      <th className="pb-2 font-medium" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {suggestions.data?.map((r) => (
                      // One row per (source, suggestion, placement): the server
                      // returns only the all-day row, never the daypart copies.
                      <tr key={`${r.source_item_id ?? 'any'}:${r.recommended_item_id}:${r.placement}`}>
                        <td className="py-2.5 pr-3">
                          <span className="text-muted-foreground">{r.source_name}</span>
                          <span className="mx-1.5">→</span>
                          <strong className="text-foreground">{r.recommended_name}</strong>
                        </td>
                        <td className="py-2.5 pr-3 text-muted-foreground">{placementLabel(r.placement)}</td>
                        <td className="py-2.5 text-right tabular-nums">{r.shown}</td>
                        <td className="py-2.5 text-right tabular-nums">{r.accepted}</td>
                        <td className="py-2.5 text-right tabular-nums">{pct(r.acceptance_rate)}</td>
                        <td className="py-2.5 text-right tabular-nums font-semibold">{km(r.attributed_revenue)}</td>
                        <td className="py-2.5 text-right tabular-nums text-muted-foreground">
                          {r.revenue_per_impression === null ? '—' : km(r.revenue_per_impression)}
                        </td>
                        <td className="py-2.5 pl-3">
                          <Badge className={`text-[11px] ${STATUS_STYLE[r.status].className}`}>
                            {STATUS_STYLE[r.status].label}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ---- Discovered pairings ---- */}
      {pairs.error ? <SectionError title="pairings" message={pairs.error} /> : (
        <Card id="pairings" className="border-border">
          <CardHeader className="pb-3">
            <CardTitle className="font-serif text-lg flex items-center gap-2">
              <Link2 className="w-5 h-5 text-primary shrink-0" /> What actually goes together
            </CardTitle>
            <p className="text-xs font-sans text-muted-foreground">
              Learned from tables as they order; last learned {when(engine?.learning?.last_learned_at ?? engine?.affinity_computed_at)},
              {' '}last refreshed {when(engine?.learning?.refreshed_at ?? engine?.affinity_computed_at)}.
            </p>
          </CardHeader>
          <CardContent>
            <p className="text-sm font-sans text-muted-foreground mb-4 leading-relaxed">
              Found in real orders, and already used by the suggestions — no need to add them.{' '}
              <strong className="text-foreground">Lift</strong> is how much more
              likely the second item is when someone orders the first — 2.0 means twice as likely as
              chance. A popular item that appears in everything scores about 1.0 and is not a pairing.
            </p>
            {(pairs.data?.length ?? 0) === 0 ? (
              <p className="text-sm text-muted-foreground font-sans py-6 text-center">
                No pairings yet — a pair needs at least three tables, more often than chance.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {pairs.data?.map((p) => (
                  <li key={`${p.item_a}-${p.item_b}`} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2.5">
                    <div className="flex-1 min-w-[12rem] text-sm font-sans">
                      <strong className="text-foreground">{p.name_a}</strong>
                      <span className="mx-1.5 text-muted-foreground">+</span>
                      <strong className="text-foreground">{p.name_b}</strong>
                      <span className="text-muted-foreground"> · together {p.pair_orders}×</span>
                    </div>
                    <span className="text-sm font-sans font-bold text-primary tabular-nums shrink-0">
                      {Number(p.lift).toFixed(1)}×
                    </span>
                    {p.already_curated ? (
                      <span className="text-xs font-sans text-muted-foreground inline-flex items-center gap-1 shrink-0 w-28 justify-end">
                        <CheckCircle2 className="w-3.5 h-3.5" /> Suggested
                      </span>
                    ) : (
                      <Button size="sm" variant="outline" className="gap-1.5 text-xs shrink-0 w-28" onClick={() => curate(p)}>
                        <Plus className="w-3.5 h-3.5" /> Suggest it
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      {/* ---- Item funnel ---- */}
      {items.error ? <SectionError title="the per-dish figures" message={items.error} /> : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card id="leaks" className="border-border">
            <CardHeader className="pb-3">
              <CardTitle className="font-serif text-lg flex items-center gap-2">
                <TrendingDown className="w-5 h-5 text-destructive shrink-0" /> Looked at, not ordered
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm font-sans text-muted-foreground mb-3 leading-relaxed">
                On the menu and available, looked at {LEAK_MIN_VIEWS}+ times, and fewer than one look in ten
                became an order. Almost always the photo, the description or the price — rarely the dish.
              </p>
              {leaks.length === 0 ? (
                <p className="text-sm text-muted-foreground font-sans py-4 text-center">
                  Nothing standing out. Needs {LEAK_MIN_VIEWS}+ views on an item to judge.
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {leaks.slice(0, 8).map((i) => (
                    <li key={i.item_id} className="flex flex-wrap items-center justify-between gap-x-3 py-2 text-sm font-sans">
                      <span className="text-foreground min-w-0 truncate">{i.name}</span>
                      <span className="text-muted-foreground tabular-nums shrink-0">
                        {i.views} views · {pct(i.order_rate)} bought
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card className="border-border">
            <CardHeader className="pb-3">
              <CardTitle className="font-serif text-lg flex items-center gap-2">
                <Eye className="w-5 h-5 text-accent shrink-0" /> Most looked at
              </CardTitle>
            </CardHeader>
            <CardContent>
              {mostViewed.every((i) => i.views === 0) ? (
                <p className="text-sm text-muted-foreground font-sans py-4 text-center">No views recorded yet.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {mostViewed.filter((i) => i.views > 0).map((i) => (
                    <li key={i.item_id} className="flex flex-wrap items-center justify-between gap-x-3 py-2 text-sm font-sans">
                      <span className="text-foreground min-w-0 truncate">{i.name}</span>
                      <span className="text-muted-foreground tabular-nums shrink-0">
                        {i.views} views · {km(i.revenue)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card className="border-border">
            <CardHeader className="pb-3">
              <CardTitle className="font-serif text-lg flex items-center gap-2">
                <Ban className="w-5 h-5 text-muted-foreground shrink-0" /> Not selling at all
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm font-sans text-muted-foreground mb-3">
                On the menu for the whole window, available, and never ordered. Dishes added more recently
                are left out until they have had a fair chance. Cut, re-describe, or re-price.
              </p>
              {dead.length === 0 ? (
                <p className="text-sm text-muted-foreground font-sans py-4 text-center">
                  Everything on the menu sold at least once.
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {dead.slice(0, 10).map((i) => (
                    <li key={i.item_id} className="flex flex-wrap items-center justify-between gap-x-3 py-2 text-sm font-sans">
                      <span className="text-foreground min-w-0 truncate">{i.name}</span>
                      <span className="text-muted-foreground tabular-nums shrink-0">
                        {i.views} views · {km(i.price)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* ---- Sold-out cost ---- */}
      {soldOut.error ? <SectionError title="sold-out figures" message={soldOut.error} /> : (soldOut.data?.length ?? 0) > 0 && (
        <Card className="border-border">
          <CardHeader className="pb-3">
            <CardTitle className="font-serif text-lg flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-accent shrink-0" /> What being sold out is costing
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm font-sans text-muted-foreground mb-3">
              Currently unavailable. The figure is what each dish took on a typical trading day while it was
              selling — roughly what every further day without it forgoes, before counting guests who order
              something else instead. Per day, and an upper bound.
            </p>
            <ul className="divide-y divide-border">
              {soldOut.data?.map((i) => (
                <li key={i.item_id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 py-2 text-sm font-sans">
                  <span className="text-foreground min-w-0 truncate">{i.name}</span>
                  <span className="text-muted-foreground tabular-nums shrink-0">
                    {i.selling_days > 0
                      ? <>up to {km(i.estimated_lost_revenue)} per trading day</>
                      : 'no sales in this window'}
                    {i.views > 0 && <> · {i.views} looks</>}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default AdminMenuIntelligence;
