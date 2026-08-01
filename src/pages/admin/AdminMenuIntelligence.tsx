import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  RefreshCw, TrendingUp, TrendingDown, Link2, Sparkles, Brain, AlertTriangle,
  Coins, Eye, Plus, Info, CheckCircle2, Ban,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  getEngineHealth, getHoldoutComparison, getItemPerformance, getPairings,
  getSoldOutImpact, getSuggestionImpact, getSuggestionPerformance,
  refreshIntelligence, curatePairing,
  findDeadWeight, findLeaks, findStars,
  type EngineHealth, type HoldoutComparison, type ItemPerformance, type Pairing,
  type SoldOutRow, type SuggestionImpact, type SuggestionRow, type SuggestionStatus,
} from '@/lib/menu-intelligence';

const km = (n: number | null | undefined) => `${Number(n ?? 0).toFixed(2)} KM`;
const pct = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `${Number(n).toFixed(1)}%`);

const Stat = ({ icon: Icon, label, value, sub, tone = 'text-primary' }: {
  icon: React.ElementType; label: string; value: string; sub?: string; tone?: string;
}) => (
  <Card className="border-border">
    <CardContent className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-sans text-muted-foreground">{label}</p>
          <p className="text-2xl font-serif font-bold text-foreground mt-1 tabular-nums">{value}</p>
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

  const [items, setItems] = useState<ItemPerformance[]>([]);
  const [pairs, setPairs] = useState<Pairing[]>([]);
  const [suggestions, setSuggestions] = useState<SuggestionRow[]>([]);
  const [impact, setImpact] = useState<SuggestionImpact | null>(null);
  const [health, setHealth] = useState<EngineHealth | null>(null);
  const [holdout, setHoldout] = useState<HoldoutComparison | null>(null);
  const [soldOut, setSoldOut] = useState<SoldOutRow[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [i, p, s, im, h, ho, so] = await Promise.all([
        getItemPerformance(days), getPairings(30), getSuggestionPerformance(50),
        getSuggestionImpact(days), getEngineHealth(), getHoldoutComparison(days),
        getSoldOutImpact(days),
      ]);
      setItems(i); setPairs(p); setSuggestions(s);
      setImpact(im); setHealth(h); setHoldout(ho); setSoldOut(so);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not load menu intelligence');
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => { void load(); }, [load]);

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

  const leaks = useMemo(() => findLeaks(items), [items]);
  const dead = useMemo(() => findDeadWeight(items), [items]);
  const stars = useMemo(() => findStars(items), [items]);
  const mostViewed = useMemo(() => [...items].sort((a, b) => b.views - a.views).slice(0, 10), [items]);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)}
        </div>
        {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-64 rounded-xl" />)}
      </div>
    );
  }

  const noData = (impact?.shown ?? 0) === 0 && items.every((i) => i.views === 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-serif text-3xl font-bold text-foreground">Menu intelligence</h1>
          <p className="text-sm text-muted-foreground font-sans mt-1">
            What guests look at, what they buy, and whether the suggestions are earning their place.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={String(days)} onValueChange={(v) => setDays(Number(v))}>
            <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="7">Last 7 days</SelectItem>
              <SelectItem value="30">Last 30 days</SelectItem>
              <SelectItem value="90">Last 90 days</SelectItem>
            </SelectContent>
          </Select>
          <Button onClick={recompute} disabled={refreshing} variant="outline" className="gap-2">
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} /> Recompute
          </Button>
        </div>
      </div>

      {noData && (
        <Card className="border-border">
          <CardContent className="p-5 flex items-start gap-3">
            <Info className="w-5 h-5 text-accent shrink-0 mt-0.5" />
            <div className="text-sm font-sans">
              <p className="font-semibold text-foreground">Nothing to learn from yet.</p>
              <p className="text-muted-foreground mt-1">
                These numbers fill in as guests use the app. Pairings need at least five orders
                before the engine will claim anything; acceptance needs about twenty impressions
                per suggestion. Come back after a full service.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ---- Is it earning its place? ---- */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat
          icon={Coins}
          label="Earned by suggestions"
          value={km(impact?.attributed_revenue)}
          sub={`${pct(impact?.uplift_pct)} of ${km(impact?.total_revenue)} total`}
        />
        <Stat
          icon={Sparkles}
          label="Suggestion acceptance"
          value={pct(impact?.overall_acceptance_pct)}
          sub={`${impact?.accepted ?? 0} taken of ${impact?.shown ?? 0} shown`}
          tone="text-accent"
        />
        <Stat
          icon={TrendingUp}
          label="Order with a suggestion"
          value={km(impact?.avg_order_with_suggestion)}
          sub={`vs ${km(impact?.avg_order_without_suggestion)} without`}
        />
        <Stat
          icon={Link2}
          label="Orders that took one"
          value={pct(impact?.attach_rate_pct)}
          sub={`${impact?.orders_with_suggestion ?? 0} of ${impact?.orders ?? 0} orders`}
          tone="text-accent"
        />
      </div>

      {/* Attribution is an upper bound. Say so, and offer the honest number. */}
      <Card className="border-border">
        <CardHeader className="pb-3">
          <CardTitle className="font-serif text-lg flex items-center gap-2">
            <Brain className="w-5 h-5 text-primary" /> How much of that is really the suggestions?
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm font-sans text-muted-foreground leading-relaxed">
            <strong className="text-foreground">{km(impact?.attributed_revenue)}</strong> came from lines a guest
            added after seeing a suggestion. Read that as an upper bound: some of those guests
            would have ordered the coffee anyway. The only way to know the real number is to show
            nothing to a small share of tables and compare.
          </p>

          {holdout && holdout.holdout_pct > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="rounded-xl border border-border p-4">
                <p className="text-xs font-sans text-muted-foreground">With suggestions</p>
                <p className="text-xl font-serif font-bold tabular-nums mt-1">{km(holdout.with_suggestions.avg_order)}</p>
                <p className="text-xs font-sans text-muted-foreground">{holdout.with_suggestions.orders} orders</p>
              </div>
              <div className="rounded-xl border border-border p-4">
                <p className="text-xs font-sans text-muted-foreground">Holdout ({holdout.holdout_pct}% of tables)</p>
                <p className="text-xl font-serif font-bold tabular-nums mt-1">{km(holdout.holdout.avg_order)}</p>
                <p className="text-xs font-sans text-muted-foreground">{holdout.holdout.orders} orders</p>
              </div>
              <div className={`rounded-xl border p-4 ${holdout.reliable ? 'border-primary/30 bg-primary/5' : 'border-border'}`}>
                <p className="text-xs font-sans text-muted-foreground">Difference per order</p>
                <p className="text-xl font-serif font-bold tabular-nums mt-1">
                  {holdout.difference >= 0 ? '+' : ''}{km(holdout.difference)}
                </p>
                <p className={`text-xs font-sans mt-0.5 ${holdout.reliable ? 'text-primary' : 'text-muted-foreground'}`}>
                  {holdout.reliable
                    ? 'Enough data to act on'
                    : 'Not yet reliable — needs 100+ orders on each side'}
                </p>
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-border p-4 text-sm font-sans">
              <p className="text-foreground font-semibold">No holdout running.</p>
              <p className="text-muted-foreground mt-1">
                Set a 10% holdout in <strong>Service &amp; suggestions</strong> for a couple of weeks
                when you want a number you can defend. One table in ten sees no suggestions, and the
                difference in average order value is the real effect.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ---- What the engine is doing ---- */}
      {health && (
        <Card className="border-border">
          <CardHeader className="pb-3">
            <CardTitle className="font-serif text-lg flex items-center gap-2">
              <Brain className="w-5 h-5 text-accent" /> How the engine decides
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
                ['Curated', health.weights.curated, 'Your rules'],
                ['Observed', health.weights.observed, 'Real baskets'],
                ['Learned', health.weights.learned, 'What guests accept'],
                ['Margin', health.weights.margin, 'Internal only'],
                ['Exploration', health.weights.exploration, 'Chance for new items'],
              ] as const).map(([label, weight, hint]) => (
                <div key={label} className="rounded-xl border border-border p-3">
                  <div className="flex items-baseline justify-between">
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
              <div><span className="text-muted-foreground">Your rules:</span> <strong>{health.curated_rules}</strong></div>
              <div><span className="text-muted-foreground">Pairings found:</span> <strong>{health.learned_pairs}</strong></div>
              <div><span className="text-muted-foreground">Still learning:</span> <strong>{health.pairs_still_learning}</strong></div>
              <div><span className="text-muted-foreground">Retired:</span> <strong>{health.pairs_retired}</strong></div>
            </div>

            <p className="text-xs font-sans text-muted-foreground">
              A pair is retired automatically once it has been shown{' '}
              {health.retire_after_impressions}+ times and accepted less than{' '}
              {health.retire_below_acceptance_pct}% of the time. Built from{' '}
              {health.orders_analysed} orders in the last 90 days.
              {health.affinity_computed_at && (
                <> Last recomputed {new Date(health.affinity_computed_at).toLocaleString()}.</>
              )}
            </p>
          </CardContent>
        </Card>
      )}

      {/* ---- Suggestion performance ---- */}
      <Card className="border-border">
        <CardHeader className="pb-3">
          <CardTitle className="font-serif text-lg">Which suggestions work</CardTitle>
        </CardHeader>
        <CardContent>
          {suggestions.length === 0 ? (
            <p className="text-sm text-muted-foreground font-sans py-6 text-center">
              No suggestion has been shown yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
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
                  {suggestions.map((r) => (
                    <tr key={`${r.source_item_id ?? 'any'}-${r.recommended_item_id}-${r.placement}`}>
                      <td className="py-2.5 pr-3">
                        <span className="text-muted-foreground">{r.source_name}</span>
                        <span className="mx-1.5">→</span>
                        <strong className="text-foreground">{r.recommended_name}</strong>
                      </td>
                      <td className="py-2.5 pr-3 text-muted-foreground">
                        {r.placement === 'after_meal' ? 'After the meal' : 'Cart'}
                      </td>
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

      {/* ---- Discovered pairings ---- */}
      <Card className="border-border">
        <CardHeader className="pb-3">
          <CardTitle className="font-serif text-lg flex items-center gap-2">
            <Link2 className="w-5 h-5 text-primary" /> What actually goes together
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm font-sans text-muted-foreground mb-4 leading-relaxed">
            Found in real orders. <strong className="text-foreground">Lift</strong> is how much more
            likely the second item is when someone orders the first — 2.0 means twice as likely as
            chance. A popular item that appears in everything scores about 1.0 and is not a pairing.
          </p>
          {pairs.length === 0 ? (
            <p className="text-sm text-muted-foreground font-sans py-6 text-center">
              No pairings yet — needs at least five orders, and three for any single pair.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {pairs.map((p) => (
                <li key={`${p.item_a}-${p.item_b}`} className="flex items-center gap-3 py-2.5">
                  <div className="flex-1 min-w-0 text-sm font-sans">
                    <strong className="text-foreground">{p.name_a}</strong>
                    <span className="mx-1.5 text-muted-foreground">+</span>
                    <strong className="text-foreground">{p.name_b}</strong>
                    <span className="text-muted-foreground"> · {p.pair_orders} orders together</span>
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

      {/* ---- Item funnel ---- */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="border-border">
          <CardHeader className="pb-3">
            <CardTitle className="font-serif text-lg flex items-center gap-2">
              <TrendingDown className="w-5 h-5 text-destructive" /> Looked at, not ordered
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm font-sans text-muted-foreground mb-3 leading-relaxed">
              High interest, low conversion. Almost always the photo, the description or the price —
              rarely the dish.
            </p>
            {leaks.length === 0 ? (
              <p className="text-sm text-muted-foreground font-sans py-4 text-center">
                Nothing standing out. Needs 20+ views on an item to judge.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {leaks.slice(0, 8).map((i) => (
                  <li key={i.item_id} className="flex items-center justify-between py-2 text-sm font-sans">
                    <span className="text-foreground truncate pr-3">{i.name}</span>
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
              <Eye className="w-5 h-5 text-accent" /> Most looked at
            </CardTitle>
          </CardHeader>
          <CardContent>
            {mostViewed.every((i) => i.views === 0) ? (
              <p className="text-sm text-muted-foreground font-sans py-4 text-center">No views recorded yet.</p>
            ) : (
              <ul className="divide-y divide-border">
                {mostViewed.filter((i) => i.views > 0).map((i) => (
                  <li key={i.item_id} className="flex items-center justify-between py-2 text-sm font-sans">
                    <span className="text-foreground truncate pr-3">{i.name}</span>
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
              <TrendingUp className="w-5 h-5 text-primary" /> Worth protecting
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm font-sans text-muted-foreground mb-3">
              Highest revenue weighted by your margin score. Keep these in stock and on the first screen.
            </p>
            {stars.length === 0 ? (
              <p className="text-sm text-muted-foreground font-sans py-4 text-center">No sales in this window.</p>
            ) : (
              <ul className="divide-y divide-border">
                {stars.map((i) => (
                  <li key={i.item_id} className="flex items-center justify-between py-2 text-sm font-sans">
                    <span className="text-foreground truncate pr-3">{i.name}</span>
                    <span className="text-muted-foreground tabular-nums shrink-0">
                      {i.units} sold · {km(i.revenue)}
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
              <Ban className="w-5 h-5 text-muted-foreground" /> Not selling at all
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm font-sans text-muted-foreground mb-3">
              Available the whole window and never ordered. Cut, re-describe, or re-price.
            </p>
            {dead.length === 0 ? (
              <p className="text-sm text-muted-foreground font-sans py-4 text-center">
                Everything on the menu sold at least once.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {dead.slice(0, 10).map((i) => (
                  <li key={i.item_id} className="flex items-center justify-between py-2 text-sm font-sans">
                    <span className="text-foreground truncate pr-3">{i.name}</span>
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

      {/* ---- Sold-out cost ---- */}
      {soldOut.length > 0 && (
        <Card className="border-border">
          <CardHeader className="pb-3">
            <CardTitle className="font-serif text-lg flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-accent" /> What being sold out is costing
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm font-sans text-muted-foreground mb-3">
              Currently unavailable, with roughly a day&apos;s usual takings for each.
            </p>
            <ul className="divide-y divide-border">
              {soldOut.map((i) => (
                <li key={i.item_id} className="flex items-center justify-between py-2 text-sm font-sans">
                  <span className="text-foreground truncate pr-3">{i.name}</span>
                  <span className="text-muted-foreground tabular-nums shrink-0">
                    ~{km(i.estimated_lost_revenue)} a day
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
