import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertTriangle, CheckCircle2, Eye, HelpCircle, TrendingDown, TrendingUp } from 'lucide-react';
import { toast } from 'sonner';

/**
 * What did this app earn us?
 *
 * The question an owner actually has, answered in one sentence at the top of
 * one page. Everything here already existed inside Menu Intelligence, which is
 * a diagnostics screen — useful, but not where you go to find out whether the
 * thing is worth having.
 *
 * Three rules this page keeps:
 *
 *   1. The CAUSAL number leads, and it is allowed to say it does not know.
 *   2. Experiment health gates the result. A broken split is not a caveat to
 *      print under a figure; it means there is no figure.
 *   3. Attributed revenue is shown, and labelled as an upper bound, below the
 *      causal answer — never instead of it.
 */

const km = (n: number | null | undefined) => `${Number(n ?? 0).toFixed(2)} KM`;

interface Causal {
  status: 'not_running' | 'too_early' | 'no_measurable_effect' | 'positive' | 'negative' | 'invalid_srm';
  holdout_pct?: number;
  with_suggestions?: { sessions: number; avg_net_sales: number };
  holdout?: { sessions: number; avg_net_sales: number };
  difference?: number | null;
  ci_low?: number | null;
  ci_high?: number | null;
  conservative_monthly_value?: number | null;
  experiment?: { name: string; policy_version: string; started_at: string } | null;
  srm?: { checked: boolean; healthy: boolean; observed_holdout_pct: number; expected_holdout_pct: number } | null;
  power?: { ready: boolean; sessions_needed_per_arm: number; days_remaining: number | null } | null;
  guardrails?: {
    rating_treatment: number | null; rating_holdout: number | null;
    minutes_treatment: number | null; minutes_holdout: number | null;
  } | null;
}

interface Summary {
  days: number;
  sessions: number;
  net_sales: number;
  causal: Causal;
  attributed: { revenue: number; orders: number; is_causal: false };
  looked_at_not_ordered: { name: string; views: number; adds: number }[];
  food_cost: { items: number; with_cost: number; coverage: number };
}

const AdminImpact = () => {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data: result, error: err } = await supabase.rpc('app_impact_summary' as never, { _days: days } as never);
    if (err) { setError(err.message); setData(null); }
    else { setError(null); setData(result as unknown as Summary); }
    setLoading(false);
  }, [days]);

  useEffect(() => { void load(); }, [load]);

  const startExperiment = async () => {
    const { error: err } = await supabase.rpc('start_experiment' as never, {
      _name: `Suggestions ${new Date().toISOString().slice(0, 10)}`,
      _policy_version: 'v1-fixed-ranker',
      _holdout_pct: 10,
    } as never);
    if (err) toast.error(err.message);
    else { toast.success('Holdout started — one table in ten will see no suggestions'); void load(); }
  };

  const c = data?.causal;

  return (
    <div>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-2">
        <div>
          <h1 className="font-serif text-3xl font-bold text-foreground">What the app earned</h1>
          <p className="text-sm text-muted-foreground font-sans">
            Measured against tables that were shown no suggestions at all.
          </p>
        </div>
        <Select value={String(days)} onValueChange={(v) => setDays(Number(v))}>
          <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="7">Last 7 days</SelectItem>
            <SelectItem value="30">Last 30 days</SelectItem>
            <SelectItem value="90">Last 90 days</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {error && (
        <Card className="border-destructive/40 mb-4">
          <CardContent className="p-4">
            <p className="text-sm font-sans text-destructive">Could not load: {error}</p>
          </CardContent>
        </Card>
      )}

      {loading ? (
        <div className="space-y-4">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-40 w-full rounded-xl" />)}</div>
      ) : data && c ? (
        <div className="space-y-4">
          {/* ---- The headline ---- */}
          <Card className={
            c.status === 'positive' ? 'border-primary/40 bg-primary/5'
              : c.status === 'negative' ? 'border-destructive/40 bg-destructive/5'
                : c.status === 'invalid_srm' ? 'border-destructive/40'
                  : 'border-border'
          }>
            <CardContent className="p-6">
              {c.status === 'positive' && (
                <>
                  <p className="font-serif text-4xl font-bold text-foreground tabular-nums">
                    {km(c.conservative_monthly_value)}
                    <span className="text-lg font-sans font-normal text-muted-foreground"> a month</span>
                  </p>
                  <p className="text-sm font-sans text-muted-foreground mt-2 max-w-2xl">
                    Tables shown suggestions spend <strong className="text-foreground">{km(c.difference)}</strong> more
                    per visit than tables shown none. The figure above is the cautious one — it uses the low end of
                    the likely range ({km(c.ci_low)} to {km(c.ci_high)} per visit), so the true value is probably
                    higher.
                  </p>
                </>
              )}

              {c.status === 'negative' && (
                <>
                  <p className="font-serif text-3xl font-bold text-destructive">Suggestions are costing you money</p>
                  <p className="text-sm font-sans text-muted-foreground mt-2 max-w-2xl">
                    Tables shown suggestions spend <strong className="text-foreground">{km(Math.abs(Number(c.difference ?? 0)))}</strong> LESS
                    per visit, by more than chance explains. Worth turning the suggestions off and reviewing the
                    worst-performing pairs before leaving this running.
                  </p>
                </>
              )}

              {c.status === 'no_measurable_effect' && (
                <>
                  <p className="font-serif text-3xl font-bold text-foreground">No measurable effect</p>
                  <p className="text-sm font-sans text-muted-foreground mt-2 max-w-2xl">
                    There is enough data now, and the gap between the two groups is inside what chance alone
                    produces ({km(c.ci_low)} to {km(c.ci_high)} per visit — the range includes zero). That is a real
                    finding, not a missing one: right now suggestions are neither helping nor hurting.
                  </p>
                </>
              )}

              {c.status === 'too_early' && (
                <>
                  <p className="font-serif text-3xl font-bold text-foreground">Still gathering data</p>
                  <p className="text-sm font-sans text-muted-foreground mt-2 max-w-2xl">
                    {c.with_suggestions?.sessions ?? 0} visits with suggestions, {c.holdout?.sessions ?? 0} without.
                    {c.power?.ready && c.power.days_remaining != null && (
                      <> At the current rate you can expect a usable answer in
                        {' '}<strong className="text-foreground">about {c.power.days_remaining} days</strong>.</>
                    )}
                    {' '}No figure is shown before then, because any difference at these numbers would be noise.
                  </p>
                </>
              )}

              {c.status === 'invalid_srm' && (
                <>
                  <p className="font-serif text-3xl font-bold text-destructive flex items-center gap-2">
                    <AlertTriangle className="w-7 h-7" /> The experiment is not sound
                  </p>
                  <p className="text-sm font-sans text-muted-foreground mt-2 max-w-2xl">
                    You configured a {c.srm?.expected_holdout_pct}% holdout and are seeing{' '}
                    {c.srm?.observed_holdout_pct}%. Something is assigning tables incorrectly, so no result can be
                    trusted and none is shown. Stop and restart the experiment.
                  </p>
                </>
              )}

              {c.status === 'not_running' && (
                <>
                  <p className="font-serif text-3xl font-bold text-foreground">Not measured yet</p>
                  <p className="text-sm font-sans text-muted-foreground mt-2 mb-4 max-w-2xl">
                    The only honest way to know what suggestions are worth is to show none to a small share of
                    tables and compare. One table in ten, for a couple of weeks. Nobody notices, and at the end
                    you have a number you can act on.
                  </p>
                  <Button onClick={startExperiment}>Start a 10% holdout</Button>
                </>
              )}
            </CardContent>
          </Card>

          {/* ---- Health, before any detail ---- */}
          {c.status !== 'not_running' && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="font-serif text-lg">Is this measurement sound?</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm font-sans">
                <div>
                  <p className="text-xs text-muted-foreground">Split</p>
                  <p className="flex items-center gap-1.5 mt-1">
                    {c.srm?.checked
                      ? c.srm.healthy
                        ? <><CheckCircle2 className="w-4 h-4 text-primary" /> as configured</>
                        : <><AlertTriangle className="w-4 h-4 text-destructive" /> wrong ({c.srm.observed_holdout_pct}%)</>
                      : <><HelpCircle className="w-4 h-4 text-muted-foreground" /> too few visits to check</>}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Guest ratings</p>
                  {/* An engine that lifts spend while lowering ratings has not won. */}
                  <p className="mt-1 tabular-nums">
                    {c.guardrails?.rating_treatment ?? '—'} vs {c.guardrails?.rating_holdout ?? '—'}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Minutes to served</p>
                  <p className="mt-1 tabular-nums">
                    {c.guardrails?.minutes_treatment ?? '—'} vs {c.guardrails?.minutes_holdout ?? '—'}
                  </p>
                </div>
              </CardContent>
            </Card>
          )}

          {/* ---- The upper bound, labelled as such ---- */}
          <Card>
            <CardContent className="p-5">
              <p className="text-sm font-sans text-muted-foreground">
                Separately, <strong className="text-foreground">{km(data.attributed.revenue)}</strong> of revenue
                came from lines a guest added straight after seeing a suggestion, across{' '}
                {data.attributed.orders} orders.{' '}
                <span className="text-foreground">This is an upper bound, not a measurement</span> — it counts the
                whole line even when the guest would have ordered it anyway. The figure at the top of this page is
                the one to trust.
              </p>
              <p className="text-xs font-sans text-muted-foreground mt-2">
                {data.sessions} visits in this period, {km(data.net_sales)} in net sales (excluding tips and refunds).
              </p>
            </CardContent>
          </Card>

          {/* ---- Money left on the table ---- */}
          {data.looked_at_not_ordered.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="font-serif text-lg flex items-center gap-2">
                  <Eye className="w-5 h-5 text-accent" /> Looked at, almost never ordered
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm font-sans text-muted-foreground mb-3">
                  Guests open these and walk away. Usually the photo, the description or the price — rarely the
                  dish. The cheapest revenue on this page.
                </p>
                <div className="space-y-1.5">
                  {data.looked_at_not_ordered.map((row) => (
                    <div key={row.name} className="flex items-center justify-between gap-3 py-2 px-3 rounded-lg bg-muted/40">
                      <span className="text-sm font-sans font-medium">{row.name}</span>
                      <span className="text-sm font-sans tabular-nums text-muted-foreground">
                        {row.views} looks · <span className="text-destructive font-semibold">{row.adds} added</span>
                      </span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Only offered when it can be answered honestly. */}
          {data.food_cost.coverage < 0.5 && (
            <p className="text-xs font-sans text-muted-foreground">
              Figures above are net sales, not profit. Add ingredient costs to menu items
              ({data.food_cost.with_cost} of {data.food_cost.items} have one) and this page can report
              contribution margin instead.
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
};

export default AdminImpact;
