import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { AlertTriangle, ArrowRight, Lightbulb, Plus } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  curatePairing, insightSentence, INSIGHT_MIN_KM_PER_WEEK, loadInsights,
  type Insight, type InsightKind,
} from '@/lib/menu-intelligence';

/**
 * "What to do next": one card per action, each with what it is worth and what
 * it rests on.
 *
 * The cards come from `management_insights()` (menu engineering, looked-at-
 * not-ordered, sold-out cost, unusual days, uncurated pairings, retired
 * suggestions) and from the trend test in src/lib/trends.ts, merged and
 * floored at 20 KM a week in `mergeInsights()`. Anything that did not pass
 * its own statistical test never reaches this list — an empty list is a
 * finding, not a failure.
 */

const KIND_LABEL: Record<InsightKind, string> = {
  puzzle: 'Menu',
  dog: 'Menu',
  leak: 'Menu',
  sold_out: 'Sold out',
  anomaly: 'Sales day',
  pairing: 'Suggestions',
  retired: 'Suggestions',
  trend_up: 'Rising',
  trend_down: 'Falling',
};

const KIND_TONE: Partial<Record<InsightKind, string>> = {
  anomaly: 'bg-destructive/10 text-destructive',
  trend_down: 'bg-destructive/10 text-destructive',
  trend_up: 'bg-primary/10 text-primary',
  pairing: 'bg-accent/10 text-accent',
};

const InsightCard = ({ insight, onCurate, busy }: {
  insight: Insight; onCurate?: (i: Insight) => void; busy: boolean;
}) => (
  <li className="rounded-2xl border border-border bg-card p-4">
    <div className="flex flex-wrap items-center gap-2 mb-1.5">
      <span className={`text-[11px] font-sans font-semibold px-2 py-0.5 rounded-full ${KIND_TONE[insight.kind] ?? 'bg-muted text-muted-foreground'}`}>
        {KIND_LABEL[insight.kind] ?? insight.kind}
      </span>
      {insight.confidence === 'medium' && (
        <span className="text-[11px] font-sans text-muted-foreground">estimate</span>
      )}
      <span className="ml-auto text-sm font-sans font-semibold tabular-nums text-foreground">
        ~{Math.round(insight.est_km_per_week).toLocaleString('en')} KM{insight.kind === 'anomaly' ? '' : ' / week'}
      </span>
    </div>
    <p className="font-sans font-semibold text-foreground leading-snug">{insight.headline}</p>
    <p className="text-sm font-sans text-muted-foreground mt-1 leading-relaxed">{insight.why}</p>
    <p className="text-sm font-sans text-foreground mt-2 leading-relaxed">{insightSentence(insight)}</p>
    <div className="flex flex-wrap items-center gap-2 mt-3">
      {insight.kind === 'pairing' && onCurate && insight.item_id && insight.related_item_id && (
        <Button size="sm" variant="outline" className="gap-1.5 rounded-xl min-h-[40px]" disabled={busy} onClick={() => onCurate(insight)}>
          <Plus className="w-3.5 h-3.5" /> Suggest it
        </Button>
      )}
      {insight.link && (
        <Button asChild size="sm" variant="ghost" className="gap-1 rounded-xl min-h-[40px] text-xs">
          <Link to={insight.link}>Open <ArrowRight className="w-3.5 h-3.5" /></Link>
        </Button>
      )}
    </div>
  </li>
);

const InsightCards = ({
  limit, days = 28, title = 'What to do next', showAllLink = false, id,
}: {
  /** Show only the top N (the dashboard shows three). */
  limit?: number;
  days?: number;
  title?: string;
  /** Link through to the full list on Menu Intelligence. */
  showAllLink?: boolean;
  id?: string;
}) => {
  const [insights, setInsights] = useState<Insight[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [trendsFailed, setTrendsFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const result = await loadInsights(days);
      setInsights(result.insights);
      setTrendsFailed(result.trendsFailed);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [days]);

  useEffect(() => { void load(); }, [load]);

  const curate = async (i: Insight) => {
    if (!i.item_id || !i.related_item_id) return;
    setBusy(true);
    try {
      await curatePairing(i.item_id, i.related_item_id);
      toast.success('Added to suggestions');
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not add the suggestion');
    } finally {
      setBusy(false);
    }
  };

  const shown = insights ? (limit ? insights.slice(0, limit) : insights) : null;

  return (
    <Card id={id} className="rounded-2xl border-border">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="font-serif text-lg flex items-center gap-2">
            <Lightbulb className="w-5 h-5 text-primary shrink-0" /> {title}
          </CardTitle>
          {showAllLink && insights && insights.length > (limit ?? 0) && (
            <Button asChild variant="ghost" size="sm" className="gap-1 text-xs">
              <Link to="/admin/menu-intelligence#insights">All {insights.length} <ArrowRight className="w-3.5 h-3.5" /></Link>
            </Button>
          )}
        </div>
        <p className="text-xs font-sans text-muted-foreground">
          Only what passed its test and is worth {INSIGHT_MIN_KM_PER_WEEK} KM a week or more, in margin after
          ingredient cost. Last {days} complete trading days.
        </p>
      </CardHeader>
      <CardContent>
        {error ? (
          <div className="flex items-start gap-2 text-sm font-sans">
            <AlertTriangle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
            <p className="text-muted-foreground break-words">Could not load recommendations: {error}</p>
          </div>
        ) : !shown ? (
          <div className="space-y-3">
            {Array.from({ length: limit ?? 3 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-2xl" />)}
          </div>
        ) : shown.length === 0 ? (
          <p className="text-sm font-sans text-muted-foreground py-4 text-center">
            Nothing worth your time right now. A card appears here once something clears its test and is
            worth at least {INSIGHT_MIN_KM_PER_WEEK} KM a week.
          </p>
        ) : (
          <ul className="space-y-3" aria-label={title}>
            {shown.map((i) => (
              <InsightCard
                key={`${i.kind}:${i.item_id ?? ''}:${i.related_item_id ?? ''}:${i.headline}`}
                insight={i}
                busy={busy}
                onCurate={curate}
              />
            ))}
          </ul>
        )}
        {trendsFailed && (
          <p className="text-[11px] font-sans text-muted-foreground mt-3">Rising and falling dishes could not be checked this time.</p>
        )}
      </CardContent>
    </Card>
  );
};

export default InsightCards;
