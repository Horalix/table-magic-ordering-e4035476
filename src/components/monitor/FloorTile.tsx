import { useEffect, useRef, useState, type ReactNode } from 'react';
import { CheckCircle2, CircleDashed, Clock, Hand, Receipt, TriangleAlert, Users } from 'lucide-react';
import { ArrivalGlow } from '@/components/staff/StaffMotion';
import { TONE, toneGlow, type StaffTone } from '@/components/staff/status-tone';
import { formatMinutes } from '@/lib/timing';
import { km } from '@/lib/staff-api';
import { FLOOR_LABEL, FLOOR_WORD, type FloorKind, type FloorStatus } from './floor-state';

/** "now" for the first minute: "0m" read as nothing at all. */
const ageText = (ms: number) => (ms < 60_000 ? 'now' : formatMinutes(ms));

export interface FloorTileData {
  id: string;
  number: number;
  sectionName: string | null;
  sectionColor: string | null;
  status: FloorStatus;
  /** When the guests sat down (ISO), for "Seated 45m". */
  seatedSince: string | null;
  guestName: string | null;
  covers: number | null;
  /** What the table still owes, by the server's own rule (outstandingFor). */
  owed: number;
  /** Orders being cooked, not counting plates already up. */
  cooking: number;
  readyCount: number;
  /** Card orders whose payment has not cleared: not in the kitchen yet. */
  awaitingPayment: number;
  waiterName: string | null;
  /** Who said they are going to the call or the bill, when someone did. */
  goingName: string | null;
}

/** The staff colour of each loud kind (src/components/staff/status-tone.ts). */
const KIND_TONE: Partial<Record<FloorKind, StaffTone>> = {
  calling: 'calling', bill: 'bill', ready: 'ready', late: 'late',
};

const KIND_ICON: Record<FloorKind, (cls: string) => ReactNode> = {
  calling: (c) => <Hand className={c} aria-hidden />,
  bill: (c) => <Receipt className={c} aria-hidden />,
  ready: (c) => <CheckCircle2 className={c} aria-hidden />,
  late: (c) => <TriangleAlert className={c} aria-hidden />,
  seated: (c) => <Users className={c} aria-hidden />,
  free: (c) => <CircleDashed className={c} aria-hidden />,
};

/**
 * Three looks, told apart by fill and border before colour, so they read from
 * across the room and without colour vision:
 * - free: an outline, dashed, the number faint;
 * - seated: a solid stone tile, the number in ink;
 * - needs someone: solid in the staff colour of the one loudest thing, white
 *   type, its word and icon large.
 */
const LOOK: Record<FloorKind, string> = {
  free: 'bg-transparent border-dashed border-[hsl(36_8%_70%)] text-foreground',
  seated: 'bg-[hsl(36_18%_84%)] border-[hsl(36_12%_56%)] text-foreground shadow-[0_1px_2px_hsl(30_20%_20%/0.08)]',
  calling: `${TONE.calling.solid} border-transparent breathe motion-reduce:animate-none shadow-lux`,
  bill: `${TONE.bill.solid} border-transparent shadow-lux`,
  ready: `${TONE.ready.solid} border-transparent shadow-lux`,
  late: `${TONE.late.solid} border-transparent shadow-lux`,
};

const ALSO_WORD: Partial<Record<FloorKind, string>> = { calling: 'Calling', bill: 'Bill', ready: 'Food up', late: 'Late' };

const FloorTile = ({
  tile, now, showSection, onOpen,
}: {
  tile: FloorTileData;
  /** Minute-bucketed clock from the screen, so every tile ages together. */
  now: number;
  /** Section on the tile itself: only when the tiles are not already under section headings. */
  showSection: boolean;
  onOpen: () => void;
}) => {
  const { kind, since, also } = tile.status;
  const loud = kind !== 'free' && kind !== 'seated';
  const seatedMs = tile.seatedSince ? Math.max(0, now - new Date(tile.seatedSince).getTime()) : null;
  const age = since !== null ? ageText(Math.max(0, now - since)) : null;
  // AA on every fill: white on the staff colours (red is 5.2:1), ink at 75% on stone (grey was 4.2:1).
  const sub = loud ? 'text-white' : 'text-foreground/75';

  /*
   * A table that starts needing someone while the screen is open glows once in
   * its colour. What was already so when the screen opened is simply shown.
   */
  const last = useRef(kind);
  const [flash, setFlash] = useState<{ tone: StaffTone; at: number } | null>(null);
  useEffect(() => {
    if (last.current === kind) return;
    last.current = kind;
    const tone = KIND_TONE[kind];
    if (tone) setFlash({ tone, at: Date.now() });
  }, [kind]);

  const guests = tile.covers ? `${tile.covers} ${tile.covers === 1 ? 'guest' : 'guests'}` : null;
  // On a seated tile the guests are counted in the corner; on a loud one the
  // corner holds how long the table has been waiting, and they come here.
  const facts = [tile.guestName, loud ? guests : null].filter(Boolean).join(' · ');
  const label = [
    `Table ${tile.number} — ${FLOOR_LABEL[kind]}${age ? `, ${age}` : ''}`,
    also.length ? `also ${also.map((k) => ALSO_WORD[k]).join(', ')}` : null,
    [tile.guestName, guests, seatedMs !== null ? `seated ${formatMinutes(seatedMs)}` : null].filter(Boolean).join(', ') || null,
    tile.owed > 0 ? `owes ${km(tile.owed)}` : null,
    // Not the waiter's name: "Marko" is the name of Marko's own button on the rail.
  ].filter(Boolean).join('. ');

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={label}
      data-state={kind}
      style={kind === 'calling' ? toneGlow('calling') : undefined}
      className={`relative flex h-full w-full min-w-0 flex-col rounded-2xl border-2 p-3 lg:p-4 text-start font-sans transition-[background-color,border-color,transform,color] duration-300 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${LOOK[kind]}`}
    >
      {flash && <ArrivalGlow key={flash.at} tone={flash.tone} />}

      <span className="flex items-start justify-between gap-2">
        <span className="min-w-0">
          <span className={`block text-[11px] font-semibold uppercase tracking-[0.14em] ${kind === 'free' ? 'text-muted-foreground' : loud ? 'text-white/80' : 'text-foreground/70'}`}>Table</span>
          <span className={`block font-serif font-bold leading-[0.95] tabular-nums text-[44px] lg:text-[52px] 2xl:text-[56px] ${kind === 'free' ? 'text-foreground/35' : ''}`}>
            {tile.number}
          </span>
        </span>
        {/* A loud tile: how long it has been waiting, the number that matters.
            A seated one: how many are sitting there, when the table said. */}
        {loud && age ? (
          <span className="mt-0.5 inline-flex shrink-0 items-center gap-1 rounded-full bg-white/20 px-2.5 py-1 text-[15px] lg:text-[17px] 2xl:text-[19px] font-bold leading-none tabular-nums">
            <Clock className="h-4 w-4" aria-hidden /> {age}
          </span>
        ) : !loud && kind !== 'free' && tile.covers ? (
          <span className={`mt-0.5 inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[13px] font-semibold tabular-nums ${loud ? 'bg-white/20 text-white' : 'bg-foreground/10 text-foreground'}`}>
            <Users className="h-3.5 w-3.5" aria-hidden /> {tile.covers}
          </span>
        ) : null}
      </span>

      {/* The one loud thing, or simply "Seated" / "Free". */}
      <span className={`mt-2 flex min-w-0 items-center gap-1.5 font-bold ${loud ? 'text-[16px] lg:text-[18px] 2xl:text-[20px] uppercase tracking-[0.03em]' : 'text-[15px] lg:text-[16px]'} ${kind === 'free' ? 'text-muted-foreground font-semibold' : ''}`}>
        {KIND_ICON[kind](loud ? 'h-5 w-5 shrink-0 2xl:h-6 2xl:w-6' : 'h-4 w-4 shrink-0')}
        <span className="truncate">{FLOOR_WORD[kind]}</span>
        {kind === 'seated' && seatedMs !== null && (
          <span className="ms-auto shrink-0 inline-flex items-center gap-1 font-semibold text-foreground/75 tabular-nums">
            <Clock className="h-3.5 w-3.5" aria-hidden /> {formatMinutes(seatedMs)}
          </span>
        )}
      </span>

      {kind !== 'free' && (
        <span className={`mt-1.5 block space-y-0.5 text-[13px] lg:text-sm leading-snug ${sub}`}>
          {tile.goingName && (kind === 'calling' || kind === 'bill') && (
            <span className="block truncate font-semibold text-white">{tile.goingName} is going</span>
          )}
          {kind === 'ready' && tile.readyCount > 1 && <span className="block truncate font-semibold text-white">{tile.readyCount} plates up</span>}
          {facts && <span className="block truncate">{facts}</span>}
          {loud && seatedMs !== null && <span className="block truncate">Seated {formatMinutes(seatedMs)}</span>}
          {tile.owed > 0 && <span className={`block truncate tabular-nums ${loud ? '' : 'text-foreground'}`}>Owes {km(tile.owed)}</span>}
          {tile.cooking > 0 && kind !== 'late' && <span className="block truncate">{tile.cooking} in kitchen</span>}
          {tile.awaitingPayment > 0 && <span className="block truncate">{tile.awaitingPayment} waiting for card payment</span>}
        </span>
      )}

      {/* The other signals, small: one loud thing per tile. */}
      {also.length > 0 && (
        <span className="mt-2 flex flex-wrap gap-1">
          {also.map((k) => (
            <span key={k} className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-semibold ${loud ? 'bg-white/20 text-white' : TONE[KIND_TONE[k] ?? 'served'].chip}`}>
              {KIND_ICON[k]('h-3 w-3')} {ALSO_WORD[k]}
            </span>
          ))}
        </span>
      )}

      {(tile.waiterName || (showSection && tile.sectionName)) && (
        <span className={`mt-auto flex min-w-0 items-center gap-1.5 pt-2 text-[12px] ${sub}`}>
          {showSection && tile.sectionName && (
            <>
              <span className={`h-2 w-2 shrink-0 rounded-full ${loud ? 'ring-1 ring-white/60' : ''}`} style={{ background: tile.sectionColor ?? undefined }} aria-hidden />
              <span className="truncate uppercase tracking-wide">{tile.sectionName}</span>
            </>
          )}
          {tile.waiterName && (
            <span className={`truncate ${showSection && tile.sectionName ? 'ms-auto' : ''}`}>{tile.waiterName}</span>
          )}
        </span>
      )}
    </button>
  );
};

export default FloorTile;
