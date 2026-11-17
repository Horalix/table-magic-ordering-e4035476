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
import { TONE } from '@/components/staff/status-tone';

/**
 * "All day" — how much of each dish is outstanding across every open order.
 *
 * This is the number a cook batches against: eight portions of fries go in one
 * basket, not eight. Reading it off the board is not equivalent, because the
 * board is capped at a fixed number of rows and the shortfall is *silent* — a
 * missing order card is obvious, an undercounted "8× Fries" is not. So the
 * count comes from a SQL aggregate over every open order, and the ids come back
 * with it so "all fries up" is one round trip against exactly what was shown.
 *
 * A station's count includes combo parts made there under a combo line made
 * elsewhere — the bar counts the lemonade of a burger combo. Those move with
 * their combo line, so the database never returns their ids: the buttons act
 * on real lines only, and a row that is nothing but combo parts has none.
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
        toast.success(`${row.name}: ${status === 'ready' ? 'all ready' : 'started'}`);
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
    // The rows' own shape while counting, so nothing jumps when they arrive.
    return (
      <div className="p-4 sm:px-6 grid gap-2.5 lg:grid-cols-2" aria-busy="true" aria-label="Counting">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-[76px] rounded-2xl border border-border bg-card animate-pulse motion-reduce:animate-none" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-4 sm:mx-6 my-6 rounded-2xl border border-destructive/40 bg-destructive/5 px-5 py-4">
        <p className="text-base text-foreground font-sans font-semibold">Could not load the all-day counts</p>
        <p className="text-sm text-muted-foreground font-sans mt-0.5 mb-3">
          Do not batch off the board: it only shows part of the queue.
        </p>
        <Button variant="outline" onClick={() => void refetch()} className="min-h-[44px]">Try again</Button>
      </div>
    );
  }

  const rows = data ?? [];
  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
        <span className="w-16 h-16 rounded-full bg-muted grid place-items-center mb-4" aria-hidden>
          <ChefHat className="w-7 h-7 text-muted-foreground" />
        </span>
        <p className="font-serif text-xl font-semibold text-foreground">Nothing outstanding</p>
        <p className="mt-1 text-sm font-sans text-muted-foreground">Every dish ordered is up or served.</p>
      </div>
    );
  }

  // Read from the stove, like the board: the count and the dish are the row.
  // Two columns on a wide screen, so a long list is not a strip of white.
  return (
    <div className="p-4 sm:px-6">
      <p className="px-1 pb-3 text-sm text-muted-foreground font-sans">
        Every open order, not just what fits on the board.
      </p>
      <div className="grid gap-2.5 lg:grid-cols-2">
      {rows.map((row) => {
        const outstanding = row.qty_pending + row.qty_preparing;
        const ageMs = Math.max(0, now - new Date(row.oldest_at).getTime());
        /** All of what is outstanding is combo parts, which the combo's own station moves. */
        const onlyCombos = outstanding > 0 && row.open_ids.length === 0;
        const urgency = outstanding > 0 ? orderUrgency(ageMs) : 'fresh';

        return (
          <div
            key={`${row.menu_item_id ?? row.name}-${row.station}`}
            className={`flex flex-wrap items-center gap-x-3.5 gap-y-2 rounded-2xl border bg-card shadow-lux px-2.5 py-2.5 min-h-[76px] ${
              urgency === 'late' || urgency === 'critical' ? TONE.late.border : 'border-border'
            }`}
          >
            {/* What is left to cook; a row that is all up shows its count in the green of ready. */}
            <span className={`w-14 h-14 shrink-0 rounded-xl grid place-items-center font-sans text-[28px] font-bold tabular-nums leading-none ${
              outstanding > 0 ? 'bg-foreground/[0.06] text-foreground' : TONE.ready.chip
            }`}>
              {outstanding > 0 ? outstanding : row.qty_ready}
            </span>

            {/* On a phone the buttons go under the dish rather than off the screen. */}
            <div className="flex-1 min-w-[9rem]">
              <p className="text-lg md:text-xl font-sans font-semibold leading-snug text-foreground">
                {row.name}
                {row.station === 'bar' && <CupSoda className="inline w-4 h-4 ml-1.5 -mt-0.5 text-muted-foreground" aria-label="bar" />}
              </p>
              <p className="text-sm font-sans text-muted-foreground tabular-nums mt-0.5">
                {row.qty_pending > 0 && <>{row.qty_pending} waiting · </>}
                {row.qty_preparing > 0 && <>{row.qty_preparing} in prep · </>}
                {row.qty_ready > 0 && <>{row.qty_ready} up · </>}
                <span className={urgencyText(urgency)}>
                  {urgencyMark(urgency)} oldest {formatMinutes(ageMs)}
                </span>
                {onlyCombos && <> · in combos, moves with the combo</>}
              </p>
            </div>

            <div className="flex gap-2 shrink-0 ms-auto">
              {row.qty_pending > 0 && row.pending_ids.length > 0 && (
                <Button
                  variant="outline"
                  disabled={busy === `${row.menu_item_id}:preparing`}
                  onClick={() => bump(row, 'preparing', row.pending_ids)}
                  className="min-h-[52px] px-4 rounded-[10px] bg-card text-sm md:text-base font-sans font-semibold"
                >
                  Start all
                </Button>
              )}
              {outstanding > 0 && row.open_ids.length > 0 && (
                // The board's words and colour for the same action: "All ready", in the green of ready.
                <Button
                  disabled={busy === `${row.menu_item_id}:ready`}
                  onClick={() => bump(row, 'ready', row.open_ids)}
                  className={`min-h-[52px] px-4 rounded-[10px] ${TONE.ready.solid} hover:bg-[hsl(150_46%_28%)] text-sm md:text-base font-sans font-semibold active:scale-95 transition-transform`}
                >
                  All ready
                </Button>
              )}
            </div>
          </div>
        );
      })}
      </div>
    </div>
  );
};

export default AllDayPanel;
