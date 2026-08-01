import React, { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Timer } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { refreshPrepStats } from '@/lib/staff-api';

/**
 * Are the prep times honest?
 *
 * Every guest estimate is built on `prep_minutes`, and until the kitchen board
 * started stamping `started_at`/`ready_at` there was no way to know whether
 * those numbers bore any relation to the kitchen. This is the feedback loop
 * made visible: the setting, the reality, and the gap.
 *
 * The gap is what a manager acts on. A dish set to 8 and taking 19 is not a
 * data-quality problem — it is either a menu setting to correct or a station
 * that needs help, and both are decisions only a person can make.
 */

interface Row {
  menu_item_id: string;
  name: string;
  prep_minutes: number | null;
  samples: number;
  median_minutes: number | null;
}

const PrepAccuracyPanel = () => {
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('menu_items')
      .select('id, name, prep_minutes, menu_item_prep_stats(samples, median_minutes)')
      .order('name');

    if (error) return;

    setRows(((data ?? []) as unknown as {
      id: string; name: string; prep_minutes: number | null;
      menu_item_prep_stats: { samples: number; median_minutes: number | null } | null;
    }[]).map((r) => ({
      menu_item_id: r.id,
      name: r.name,
      prep_minutes: r.prep_minutes,
      samples: r.menu_item_prep_stats?.samples ?? 0,
      median_minutes: r.menu_item_prep_stats?.median_minutes ?? null,
    })));
  }, []);

  useEffect(() => { void load(); }, [load]);

  const recompute = async () => {
    setBusy(true);
    try {
      const n = await refreshPrepStats(30);
      toast.success(`Recomputed prep times for ${n} dish${n === 1 ? '' : 'es'}`);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not recompute');
    } finally {
      setBusy(false);
    }
  };

  // Only rows worth a manager's attention: enough evidence, and a real gap.
  const drifted = rows
    .filter((r) => r.samples >= 5 && r.median_minutes != null && r.prep_minutes != null)
    .map((r) => ({ ...r, gap: Number(r.median_minutes) - Number(r.prep_minutes) }))
    .filter((r) => Math.abs(r.gap) >= 3)
    .sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap));

  const missing = rows.filter((r) => r.prep_minutes == null && r.samples < 5);
  const measured = rows.filter((r) => r.samples >= 5).length;

  return (
    <Card className="border-border">
      <CardHeader className="pb-3">
        <CardTitle className="font-serif text-lg flex items-center gap-2">
          <Timer className="w-5 h-5 text-primary" /> Are our prep times honest?
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm font-sans text-muted-foreground leading-relaxed">
          Every wait time a guest sees is built on these. The kitchen board now records when each
          line was started and when it went up, so the menu setting can be checked against what
          actually happens. <span className="text-foreground">{measured}</span> of{' '}
          <span className="text-foreground">{rows.length}</span> dishes have enough history to judge.
        </p>

        {drifted.length > 0 ? (
          <div className="space-y-1.5">
            <p className="text-xs uppercase tracking-wide text-muted-foreground font-sans">
              Set to one thing, taking another
            </p>
            {drifted.slice(0, 8).map((r) => (
              <div key={r.menu_item_id} className="flex items-center justify-between gap-3 py-2 px-3 rounded-lg bg-muted/40">
                <span className="text-sm font-sans font-medium truncate">{r.name}</span>
                <span className="text-sm font-sans tabular-nums shrink-0">
                  <span className="text-muted-foreground">set {r.prep_minutes}m</span>
                  {' · '}
                  <span className="text-foreground font-semibold">really {Math.round(Number(r.median_minutes))}m</span>
                  {' '}
                  <span className={r.gap > 0 ? 'text-destructive' : 'text-primary'}>
                    ({r.gap > 0 ? '+' : ''}{Math.round(r.gap)})
                  </span>
                </span>
              </div>
            ))}
            <p className="text-xs text-muted-foreground font-sans pt-1">
              Estimates already use the observed figure once there are five or more services, so
              guests are not being misled — but the menu setting is what a new dish starts from.
            </p>
          </div>
        ) : (
          <p className="text-sm font-sans text-muted-foreground">
            {measured === 0
              ? 'No dish has been through the kitchen board enough times yet. Come back after a few services.'
              : 'Nothing is drifting by more than three minutes.'}
          </p>
        )}

        {missing.length > 0 && (
          <p className="text-sm font-sans text-muted-foreground">
            <span className="text-foreground font-medium">{missing.length}</span> dish
            {missing.length === 1 ? ' has' : 'es have'} no prep time set and no history, so no
            estimate is shown for any order containing {missing.length === 1 ? 'it' : 'them'}.
          </p>
        )}

        <Button variant="outline" size="sm" onClick={recompute} disabled={busy}>
          {busy ? 'Recomputing…' : 'Recompute from the last 30 days'}
        </Button>
      </CardContent>
    </Card>
  );
};

export default PrepAccuracyPanel;
