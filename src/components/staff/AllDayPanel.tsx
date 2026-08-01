import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ChefHat, CupSoda } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { allDay, bumpOrderItems, type AllDayRow, type Station } from '@/lib/staff-api';
import { staffKeys } from '@/lib/realtime';
import { useNow } from '@/lib/clock';
import { formatMinutes, orderUrgency, urgencyMark, urgencyText } from '@/lib/timing';
import type { StationFilter } from '@/components/staff/KitchenOrderCard';

/**
 * "All day" — how much of each dish is outstanding across every open order.
 *
 * This is the number a cook batches against: eight portions of fries go in one
 * basket, not eight. Reading it off the board is not equivalent, because the
 * board is capped at a fixed number of rows and the shortfall is *silent* — a
 * missing order card is obvious, an undercounted "8× Fries" is not. So the
 * count comes from a SQL aggregate over every open order, and the ids come back
 * with it so "all fries up" is one round trip against exactly what was shown.
 */

interface Props {
  station: StationFilter;
  onChanged: () => void;
}

const AllDayPanel = ({ station, onChanged }: Props) => {
  const now = useNow();
  const [busy, setBusy] = useState<string | null>(null);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: [...staffKeys.allDay, station],
    queryFn: () => allDay(station === 'all' ? undefined : (station as Station)),
    staleTime: 5_000,
  });

  const bump = async (row: AllDayRow, status: 'preparing' | 'ready', ids: string[]) => {
    if (ids.length === 0) return;
    setBusy(`${row.menu_item_id}:${status}`);
    try {
      const result = await bumpOrderItems(ids, status);
      if (result.failed > 0) {
        // Per-item failures are reported honestly rather than swallowed: a
        // partial batch is exactly the situation where a cook must look.
        toast.warning(`${result.updated} updated, ${result.failed} could not be`);
      } else {
        toast.success(`${row.name} — ${status === 'ready' ? 'all up' : 'started'}`);
      }
      await refetch();
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not update those lines');
    } finally {
      setBusy(null);
    }
  };

  if (isLoading) {
    return <p className="px-6 py-10 text-sm text-muted-foreground font-sans">Counting…</p>;
  }

  if (error) {
    return (
      <div className="px-6 py-10">
        <p className="text-sm text-destructive font-sans mb-3">
          Could not load the all-day counts. Do not batch off the board — it only shows part of the queue.
        </p>
        <Button variant="outline" size="sm" onClick={() => void refetch()}>Try again</Button>
      </div>
    );
  }

  const rows = data ?? [];
  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <ChefHat className="w-12 h-12 text-muted-foreground mb-4" />
        <p className="text-muted-foreground font-sans">Nothing outstanding</p>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-2">
      <p className="px-1 pb-1 text-xs text-muted-foreground font-sans">
        Every open order, not just what fits on the board.
      </p>
      {rows.map((row) => {
        const outstanding = row.qty_pending + row.qty_preparing;
        const ageMs = Math.max(0, now - new Date(row.oldest_at).getTime());
        const urgency = outstanding > 0 ? orderUrgency(ageMs) : 'fresh';

        return (
          <div
            key={`${row.menu_item_id}-${row.station}`}
            className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 min-h-[64px]"
          >
            <span className="font-serif text-2xl font-bold tabular-nums text-foreground w-14 shrink-0">
              {outstanding > 0 ? outstanding : row.qty_ready}
            </span>

            <div className="flex-1 min-w-0">
              <p className="text-sm font-sans font-semibold text-foreground truncate">
                {row.name}
                {row.station === 'bar' && <CupSoda className="inline w-3.5 h-3.5 ml-1.5 text-muted-foreground" aria-label="bar" />}
              </p>
              <p className="text-xs font-sans text-muted-foreground tabular-nums">
                {row.qty_pending > 0 && <>{row.qty_pending} waiting · </>}
                {row.qty_preparing > 0 && <>{row.qty_preparing} in prep · </>}
                {row.qty_ready > 0 && <>{row.qty_ready} up · </>}
                <span className={urgencyText(urgency)}>
                  {urgencyMark(urgency)} oldest {formatMinutes(ageMs)}
                </span>
              </p>
            </div>

            <div className="flex gap-2 shrink-0">
              {row.qty_pending > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy === `${row.menu_item_id}:preparing`}
                  onClick={() => bump(row, 'preparing', row.pending_ids)}
                  className="h-10 rounded-lg text-xs font-sans"
                >
                  Start all
                </Button>
              )}
              {outstanding > 0 && (
                <Button
                  size="sm"
                  disabled={busy === `${row.menu_item_id}:ready`}
                  onClick={() => bump(row, 'ready', row.open_ids)}
                  className="h-10 rounded-lg bg-primary text-primary-foreground text-xs font-sans active:scale-95 transition-transform"
                >
                  All up
                </Button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default AllDayPanel;
