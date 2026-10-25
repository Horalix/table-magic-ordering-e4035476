import { formatClock } from '@/lib/timing';
import type { PrinterHealth, PrinterStation } from '@/lib/printers-api';

/**
 * Who prints which ticket, and how to say what happened to it.
 *
 * Pure so the wording — which is what a cook actually reads — is tested.
 */

export type TicketType = 'kitchen' | 'bar';
export type Tone = 'ok' | 'busy' | 'bad' | 'idle';

export const stationCovers = (station: PrinterStation, type: TicketType) =>
  station === 'all' || station === type;

/**
 * Ticket types an ONLINE network printer is already printing.
 *
 * A tablet set to auto-print must leave those alone. The database claim would
 * stop a duplicate anyway, but the tablet losing the race still costs a print
 * dialog popping up over the board, and winning it moves the ticket from the
 * printer at the pass to the tablet's — so the tablet steps aside. If the
 * printer goes quiet for a minute, it is no longer "online" and the tablet
 * takes over again by itself: the fallback needs nobody to notice.
 */
export function cloudCoveredTypes(printers: PrinterHealth[]): Set<TicketType> {
  const out = new Set<TicketType>();
  for (const p of printers) {
    if (!p.enabled || !p.online) continue;
    if (stationCovers(p.station, 'kitchen')) out.add('kitchen');
    if (stationCovers(p.station, 'bar')) out.add('bar');
  }
  return out;
}

/** The printer a ticket type goes to, preferring one that is online. */
export function printerFor(printers: PrinterHealth[], type: TicketType): PrinterHealth | null {
  const mine = printers.filter((p) => p.enabled && stationCovers(p.station, type));
  return mine.find((p) => p.online) ?? mine[0] ?? null;
}

const minutesSince = (at: string | null, now: number) =>
  at ? Math.max(0, Math.round((now - new Date(at).getTime()) / 60_000)) : null;

/** "Online", "Offline — last seen 4 min ago", "Never connected". */
export function printerSummary(p: Pick<PrinterHealth, 'enabled' | 'online' | 'last_seen_at' | 'last_error'>, now = Date.now()): { tone: Tone; label: string } {
  if (!p.enabled) return { tone: 'idle', label: 'Switched off here' };
  if (p.online) return p.last_error ? { tone: 'bad', label: `Online — ${p.last_error}` } : { tone: 'ok', label: 'Online' };
  const mins = minutesSince(p.last_seen_at, now);
  if (mins === null) return { tone: 'idle', label: 'Never connected' };
  if (mins < 1) return { tone: 'bad', label: 'Offline — just now' };
  if (mins < 120) return { tone: 'bad', label: `Offline — last seen ${mins} min ago` };
  return { tone: 'bad', label: `Offline since ${formatClock(p.last_seen_at)}` };
}

/** "cloud:Kitchen printer" → "Kitchen printer"; a tablet id → "a tablet". */
export const deviceLabel = (device: string | null | undefined) =>
  !device ? null : device.startsWith('cloud:') ? device.slice(6) : 'a tablet';

export interface TicketState {
  status: string;
  printed_at?: string | null;
  print_verified?: boolean | null;
  claimed_by_device?: string | null;
  last_error?: string | null;
}

/** What happened to one ticket, in words a cook can act on. */
export function ticketStateLabel(t: TicketState): { tone: Tone; label: string } {
  const by = deviceLabel(t.claimed_by_device);
  switch (t.status) {
    case 'printed':
      return {
        tone: 'ok',
        label: `Printed ${formatClock(t.printed_at)}${by ? ` · ${by}` : ''}${t.print_verified ? '' : ' (unconfirmed)'}`,
      };
    case 'claimed':
      return { tone: 'busy', label: `Printing${by ? ` on ${by}` : ''}…` };
    case 'failed':
      return { tone: 'bad', label: `Did not print${t.last_error ? ` — ${t.last_error}` : ''}` };
    case 'queued':
      return { tone: 'idle', label: 'Waiting for a printer' };
    case 'cancelled':
      return { tone: 'idle', label: 'Cancelled' };
    default:
      return { tone: 'idle', label: t.status };
  }
}

/** The ticket states that need a person: failed, or stuck waiting. */
export const needsAttention = (t: TicketState & { updated_at?: string }, now = Date.now()) =>
  t.status === 'failed'
  || (t.status === 'queued' && !!t.updated_at && now - new Date(t.updated_at).getTime() > 2 * 60_000)
  || (t.status === 'claimed' && !!t.updated_at && now - new Date(t.updated_at).getTime() > 90_000);
