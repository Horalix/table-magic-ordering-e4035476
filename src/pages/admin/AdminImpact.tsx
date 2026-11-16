import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { AdminCard, AdminCardContent, AdminCardHeader, EmptyState, KpiCard, Stagger } from '@/components/admin/AdminCard';
import { AdminPageHeader, AdminSection } from '@/components/admin/AdminPage';
import { money, moneyKM, whole } from '@/components/admin/admin-format';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertTriangle, CheckCircle2, Eye, FlaskConical, HelpCircle, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import type { HoldoutComparison } from '@/lib/menu-intelligence';

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

const km = (n: number | null | undefined) => moneyKM(Number(n ?? 0));

/** The holdout read. One shared type with Menu Intelligence, so the two pages cannot drift apart. */
type Causal = HoldoutComparison;

interface LookedAt {
  name: string;
  views: number;
  adds: number;
}

interface Summary {
  days: number;
  sessions: number;
  net_sales: number;
  causal: Causal;
  attributed: { revenue: number; orders: number; is_causal: false };
  looked_at_not_ordered: LookedAt[];
  food_cost: { items: number; with_cost: number; coverage: number };
}

interface Readiness {
  ready: boolean;
  sampling_enabled: boolean;
  policy_version: string;
  decisions: number;
  checks: { check: string; pass: boolean; have?: number; need?: number; note?: string }[];
}

/**
 * The ranker can weigh a pair it has seen four times against one it has seen
 * four hundred times only if it knows the difference. Sampling from the
 * acceptance posterior is how it learns that; it switches itself on the first
 * night the evidence supports it, so this is a countdown rather than a button.
 */
const CHECK_LABELS: Record<string, string> = {
  impressions_are_server_verified: 'Sightings counted on the server',
  acceptance_linked_to_paid_outcome: 'Acceptance means paid for',
  action_probabilities_logged: 'Decisions recorded with their odds',
  enough_decisions: 'Enough suggestions made',
  enough_pairs_with_support: 'Enough pairings with real history',
  conversions_observed: 'Someone has actually accepted one',
};

const AdminImpact = () => {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<Summary | null>(null);
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [lookedAt, setLookedAt] = useState<LookedAt[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [summary, gate, looked] = await Promise.all([
      supabase.rpc('app_impact_summary' as never, { _days: days } as never),
      supabase.rpc('bandit_readiness' as never),
      // The shared "looked at, not ordered" rule — the same list Menu
      // Intelligence shows. Sold-out dishes are left out: nobody could order them.
      supabase.rpc('looked_at_not_ordered' as never, { _days: days, _limit: 5 } as never),
    ]);
    if (summary.error) { setError(summary.error.message); setData(null); }
    else { setError(null); setData(summary.data as unknown as Summary); }
    // The gate is a footnote, not the page. A failure to read it must not
    // replace the number the owner came here for.
    setReadiness(gate.error ? null : (gate.data as unknown as Readiness));
    // Falls back to the summary's own list on a database without the shared rule.
    setLookedAt(looked.error ? null : (looked.data as unknown as LookedAt[]));
    setLoading(false);
  }, [days]);

  useEffect(() => { void load(); }, [load]);

  const startExperiment = async () => {
    // Label the experiment with the ranking policy actually running. A
    // hard-coded label would tie this holdout to a ranker that no longer
    // exists, and every later comparison by policy would be wrong.
    const { data: policy, error: policyErr } = await supabase.rpc('reco_policy_version' as never);
    if (policyErr || typeof policy !== 'string' || !policy) {
      toast.error(policyErr?.message ?? 'Could not read the current suggestion policy, so no holdout was started');
      return;
    }
    const { error: err } = await supabase.rpc('start_experiment' as never, {
      _name: `Suggestions ${new Date().toISOString().slice(0, 10)}`,
      _policy_version: policy,
      _holdout_pct: 10,
    } as never);
    if (err) toast.error(err.message);
    else { toast.success('Holdout started — one table in ten will see no suggestions'); void load(); }
  };

  const c = data?.causal;
  const looked = lookedAt ?? data?.looked_at_not_ordered ?? [];

  const tone = c?.status === 'positive' ? 'border-primary/30 bg-primary/5'
    : c?.status === 'negative' || c?.status === 'invalid_srm' ? 'border-destructive/40 bg-destructive/5'
      : '';
  const lead = 'mt-2 max-w-2xl text-sm font-sans leading-relaxed text-muted-foreground text-pretty';
  const headline = 'font-serif text-2xl font-bold leading-tight text-balance sm:text-3xl';

  return (
    <div>
      <AdminPageHeader
        title="What the app earned"
        description="Measured against tables that were shown no suggestions at all."
        loading={loading && !!data}
        actions={(
          <Select value={String(days)} onValueChange={(v) => setDays(Number(v))}>
            <SelectTrigger className="h-11 w-[160px] rounded-xl text-base sm:text-sm" aria-label="Period"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="7">Last 7 days</SelectItem>
              <SelectItem value="30">Last 30 days</SelectItem>
              <SelectItem value="90">Last 90 days</SelectItem>
            </SelectContent>
          </Select>
        )}
      />

      {error && (
        <AdminCard className="mb-4 border-destructive/40" role="alert">
          <AdminCardContent className="pt-5">
            <p className="flex items-start gap-2 text-sm font-sans text-destructive">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> Could not load: {error}
            </p>
            <Button variant="outline" className="mt-3 h-11" onClick={() => void load()}>Try again</Button>
          </AdminCardContent>
        </AdminCard>
      )}

      {loading && !data ? (
        <div className="space-y-4" aria-busy="true" aria-label="Loading">
          <Skeleton className="h-52 w-full rounded-2xl" />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
            {[1, 2, 3].map((i) => <Skeleton key={i} className="h-[104px] rounded-2xl" />)}
          </div>
          <Skeleton className="h-40 w-full rounded-2xl" />
        </div>
      ) : data && c ? (
        <div className={`space-y-6 transition-opacity ${loading ? 'opacity-60' : ''}`}>
          {/* ---- The headline ---- */}
          <AdminCard className={tone}>
            <AdminCardContent className="pt-5 sm:pt-6">
              {c.status === 'positive' && (
                <>
                  <p className="text-[13px] font-sans font-medium text-muted-foreground">Cautious estimate</p>
                  <p className="mt-1 font-sans text-4xl font-semibold leading-none tracking-tight text-foreground tabular-nums sm:text-5xl">
                    {km(c.conservative_monthly_value)}
                    <span className="text-lg font-sans font-normal text-muted-foreground"> a month</span>
                  </p>
                  <p className={lead}>
                    Tables shown suggestions spend <strong className="text-foreground">{km(c.difference)}</strong> more
                    per visit, in net sales (items, excluding tips), than tables shown none. The figure above is the
                    cautious one — it uses the low end of the likely range ({km(c.ci_low)} to {km(c.ci_high)} per
                    visit), so the true value is probably higher.
                    {c.measured_days != null && (
                      <> Projected from the {Number(c.measured_days).toFixed(0)} day
                        {Number(c.measured_days) >= 1.5 ? 's' : ''} the experiment has been running.</>
                    )}
                  </p>
                </>
              )}

              {c.status === 'negative' && (
                <>
                  <p className={`${headline} text-destructive`}>Suggestions are costing you money</p>
                  <p className={lead}>
                    Tables shown suggestions spend <strong className="text-foreground">{km(Math.abs(Number(c.difference ?? 0)))}</strong> LESS
                    per visit, by more than chance explains. Worth turning the suggestions off and reviewing the
                    worst-performing pairs before leaving this running.
                  </p>
                </>
              )}

              {c.status === 'no_measurable_effect' && (
                <>
                  <p className={`${headline} text-foreground`}>No measurable effect</p>
                  <p className={lead}>
                    There is enough data now, and the gap between the two groups is inside what chance alone
                    produces ({km(c.ci_low)} to {km(c.ci_high)} per visit — the range includes zero). That is a real
                    finding, not a missing one: right now suggestions are neither helping nor hurting.
                  </p>
                </>
              )}

              {c.status === 'too_early' && (
                <>
                  <p className={`${headline} text-foreground`}>Still gathering data</p>
                  <p className={lead}>
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
                  <p className={`${headline} flex items-center gap-2 text-destructive`}>
                    <AlertTriangle className="h-7 w-7 shrink-0" aria-hidden /> The experiment is not sound
                  </p>
                  <p className={lead}>
                    You configured a {c.srm?.expected_holdout_pct}% holdout and are seeing{' '}
                    {c.srm?.observed_holdout_pct}%. Something is assigning tables incorrectly, so no result can be
                    trusted and none is shown. Stop and restart the experiment.
                  </p>
                </>
              )}

              {c.status === 'not_running' && (
                <>
                  <p className={`${headline} text-foreground`}>Not measured yet</p>
                  <p className={`${lead} mb-5`}>
                    The only honest way to know what suggestions are worth is to show none to a small share of
                    tables and compare. One table in ten, for a couple of weeks. Nobody notices, and at the end
                    you have a number you can act on.
                  </p>
                  <Button className="h-11 rounded-xl px-5" onClick={startExperiment}>Start a 10% holdout</Button>
                </>
              )}
            </AdminCardContent>
          </AdminCard>

          {/* ---- Health, before any detail ---- */}
          {c.status !== 'not_running' && (
            <AdminCard>
              <AdminCardHeader icon={FlaskConical} title="Is this measurement sound?" description="Checked before any figure is trusted." />
              <AdminCardContent className="grid grid-cols-1 gap-3 text-sm font-sans sm:grid-cols-3">
                <div className="rounded-xl bg-muted/40 p-3.5">
                  <p className="text-xs text-muted-foreground">Split</p>
                  <p className="mt-1.5 flex items-center gap-1.5 font-medium">
                    {c.srm?.checked
                      ? c.srm.healthy
                        ? <><CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden /> as configured</>
                        : <><AlertTriangle className="h-4 w-4 text-destructive" aria-hidden /> wrong ({c.srm.observed_holdout_pct}%)</>
                      : <><HelpCircle className="h-4 w-4 text-muted-foreground" aria-hidden /> too few visits to check</>}
                  </p>
                </div>
                <div className="rounded-xl bg-muted/40 p-3.5">
                  <p className="text-xs text-muted-foreground">Guest ratings</p>
                  {/* An engine that lifts spend while lowering ratings has not won. */}
                  <p className="mt-1.5 font-medium tabular-nums">
                    {c.guardrails?.rating_treatment ?? '—'} <span className="font-normal text-muted-foreground">vs</span> {c.guardrails?.rating_holdout ?? '—'}
                  </p>
                </div>
                <div className="rounded-xl bg-muted/40 p-3.5">
                  <p className="text-xs text-muted-foreground">Minutes to served</p>
                  <p className="mt-1.5 font-medium tabular-nums">
                    {c.guardrails?.minutes_treatment ?? '—'} <span className="font-normal text-muted-foreground">vs</span> {c.guardrails?.minutes_holdout ?? '—'}
                  </p>
                </div>
              </AdminCardContent>
            </AdminCard>
          )}

          {/* ---- The upper bound, labelled as such ---- */}
          <AdminSection title="The wider picture" titleId="impact-wider">
            <Stagger className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
              <KpiCard label="Visits" value={data.sessions} format={whole} hint={`last ${days} days`} />
              <KpiCard label="Net sales" value={data.net_sales} format={money} unit="KM" hint="items after refunds, no tips" />
              <KpiCard
                className="col-span-2 sm:col-span-1"
                label="Linked to a suggestion"
                value={data.attributed.revenue}
                format={money}
                unit="KM"
                hint={`${whole(data.attributed.orders)} orders · upper bound`}
              />
            </Stagger>
            <p className="mt-3 max-w-3xl text-[13px] font-sans leading-relaxed text-muted-foreground text-pretty">
              <strong className="text-foreground">{km(data.attributed.revenue)}</strong> of revenue
              came from lines a guest added straight after seeing a suggestion, across{' '}
              {data.attributed.orders} orders.{' '}
              <span className="text-foreground">This is an upper bound, not a measurement</span> — it counts the
              whole line even when the guest would have ordered it anyway. The figure at the top of this page is
              the one to trust. Net sales are items after refunds, with tips left out because a suggestion did not earn them.
            </p>
          </AdminSection>

          {/* ---- Money left on the table ---- */}
          {looked.length > 0 && (
            <AdminCard>
              <AdminCardHeader
                icon={Eye}
                tone="accent"
                title="Looked at, almost never ordered"
                description="Guests open these and walk away. Usually the photo, the description or the price — rarely the dish. The cheapest revenue on this page."
              />
              <AdminCardContent>
                <ul className="divide-y divide-border/60">
                  {looked.map((row) => (
                    <li key={row.name} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 py-3 first:pt-0 last:pb-0">
                      <span className="min-w-0 text-sm font-sans font-medium text-foreground">{row.name}</span>
                      <span className="text-sm font-sans tabular-nums text-muted-foreground">
                        {whole(row.views)} looks · <span className="font-semibold text-destructive">{whole(row.adds)} added</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </AdminCardContent>
            </AdminCard>
          )}

          {/* ---- Learning readiness: a countdown, not a switch ---- */}
          {readiness && (
            <AdminCard className={readiness.sampling_enabled ? 'border-primary/30' : undefined}>
              <AdminCardHeader
                icon={Sparkles}
                tone="accent"
                title="How the app is choosing suggestions"
                description={readiness.sampling_enabled
                  ? 'It is testing as it goes. When it has only seen a pairing a handful of times it treats that as a guess rather than a fact, and gives it a share of the suggestions until it knows either way. Turned on automatically once there was enough history to learn from.'
                  : "It is following fixed rules — your pairings, what sells together, and the kitchen's load. Once there is enough history it will start testing as it goes, treating a pairing it has seen four times as the guess it is instead of ranking it against one it has seen four hundred times. That happens on its own overnight; nothing to press."}
              />
              {!readiness.sampling_enabled && (
                <AdminCardContent>
                  <ul className="divide-y divide-border/60">
                    {readiness.checks.map((row) => (
                      <li key={row.check} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                        <span className="flex min-w-0 items-center gap-2.5 text-sm font-sans">
                          {row.pass
                            ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
                            : <span className="h-4 w-4 shrink-0 rounded-full border-2 border-muted-foreground/40" aria-hidden />}
                          <span className={row.pass ? 'text-muted-foreground' : 'font-medium text-foreground'}>
                            {CHECK_LABELS[row.check] ?? row.check}
                          </span>
                        </span>
                        <span className="shrink-0 text-sm font-sans tabular-nums text-muted-foreground">
                          {row.need !== undefined
                            ? `${whole(row.have ?? 0)} of ${whole(row.need)}`
                            : row.pass ? 'ready' : 'waiting'}
                        </span>
                      </li>
                    ))}
                  </ul>
                </AdminCardContent>
              )}
            </AdminCard>
          )}

          {/* Only offered when it can be answered honestly. */}
          {data.food_cost.coverage < 0.5 && (
            <p className="text-xs font-sans leading-relaxed text-muted-foreground">
              Figures above are net sales, not profit. Add ingredient costs to menu items
              ({data.food_cost.with_cost} of {data.food_cost.items} have one) and this page can report
              contribution margin instead.
            </p>
          )}
        </div>
      ) : !error ? (
        <AdminCard><EmptyState icon={FlaskConical} title="Nothing to show yet." hint="Figures appear here once guests have been seated." /></AdminCard>
      ) : null}
    </div>
  );
};

export default AdminImpact;
