import { supabase } from '@/integrations/supabase/client';
import type { Locale } from '@/lib/i18n';
import type { Refusal, ReservationStatus } from './reservation-types';

/**
 * Table reservations (supabase/migrations/20261113090000_reservations.sql).
 *
 * A guest asks for a table on the restaurant's website (/reserve); the
 * restaurant's admin confirms or declines on Admin → Reservations; the guest
 * reads the answer on their own page (/reservation/<id>?t=<token>), which asks
 * again every few seconds while it waits.
 *
 * Until that migration is applied the functions and the table are not in the
 * generated types and may not exist at all, so they are reached untyped and
 * every reader says "not ready" instead of failing (as push-alerts.ts does).
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const untyped = supabase as unknown as { from: (table: string) => any; rpc: (fn: string, args?: Record<string, unknown>) => any };

/** The database does not know this function or table yet: the migration has not been applied. */
const missing = (error: { code?: string; message?: string } | null) =>
  !!error && /PGRST202|PGRST205|42883|42P01|does not exist|Could not find/.test(`${error.code ?? ''} ${error.message ?? ''}`);

// The two types the guest's wording also needs live in a module without imports (./reservation-types.ts).
export type { Refusal, ReservationStatus };

/** What the booking page is told before anything is typed (guest_reservation_options). */
export interface ReservationOptions {
  enabled: boolean;
  /** "11:00" */
  open: string;
  close: string;
  maxParty: number;
  daysAhead: number;
  leadMinutes: number;
  phone: string | null;
  note: string | null;
  /** The restaurant's own date and time: a guest's phone may be in another zone. */
  today: string;
  now: string;
}

const OFF: ReservationOptions = {
  enabled: false, open: '11:00', close: '21:00', maxParty: 10, daysAhead: 30, leadMinutes: 60, phone: null, note: null, today: '', now: '00:00',
};

/** The restaurant's rules for the booking page; `enabled: false` while it takes none, or is not set up yet. */
export async function readReservationOptions(venueSlug: string): Promise<ReservationOptions> {
  try {
    const { data, error } = await untyped.rpc('guest_reservation_options', { _venue: venueSlug });
    if (error || !data || typeof data !== 'object') return OFF;
    const o = data as Record<string, unknown>;
    return {
      enabled: o.enabled === true,
      open: typeof o.open === 'string' ? o.open : OFF.open,
      close: typeof o.close === 'string' ? o.close : OFF.close,
      maxParty: Number(o.max_party) || OFF.maxParty,
      daysAhead: Number(o.days_ahead) || OFF.daysAhead,
      leadMinutes: Number.isFinite(Number(o.lead_minutes)) ? Number(o.lead_minutes) : OFF.leadMinutes,
      phone: typeof o.phone === 'string' && o.phone ? o.phone : null,
      note: typeof o.note === 'string' && o.note ? o.note : null,
      today: typeof o.today === 'string' ? o.today : '',
      now: typeof o.now === 'string' ? o.now : '00:00',
    };
  } catch {
    return OFF;
  }
}

const REFUSALS: Refusal[] = ['disabled', 'name', 'phone', 'party', 'time', 'hours', 'soon', 'far', 'repeat', 'busy'];

export function refusalOf(message: string | null | undefined): Refusal {
  const word = /RESERVATION:([a-z]+)/.exec(message ?? '')?.[1] as Refusal | undefined;
  return word && REFUSALS.includes(word) ? word : 'unknown';
}

export class ReservationRefused extends Error {
  constructor(public readonly reason: Refusal) {
    super(`RESERVATION:${reason}`);
  }
}

export interface ReservationRequest {
  venueSlug: string;
  name: string;
  phone: string;
  party: number;
  /** "2026-11-15" and "19:30", on the restaurant's own calendar and clock. */
  day: string;
  time: string;
  note: string;
  locale: Locale;
  /** The field no person fills in. */
  trap: string;
}

/** The address of the guest's own page. */
export interface ReservationKey {
  id: string;
  token: string;
}

export async function requestReservation(r: ReservationRequest): Promise<ReservationKey & { code: string }> {
  const { data, error } = await untyped.rpc('guest_request_reservation', {
    _venue: r.venueSlug, _name: r.name, _phone: r.phone, _party: r.party, _day: r.day, _time: r.time,
    _note: r.note.trim() || null, _locale: r.locale, _trap: r.trap || null,
  });
  if (error) throw new ReservationRefused(missing(error) ? 'disabled' : refusalOf(error.message));
  const row = data as { id?: string; token?: string; code?: string } | null;
  if (!row?.id || !row.token) throw new ReservationRefused('unknown');
  return { id: row.id, token: row.token, code: row.code ?? '' };
}

/** The guest's own request, as their page shows it (guest_reservation). */
export interface GuestReservation {
  id: string;
  code: string;
  venue: string;
  status: ReservationStatus;
  name: string;
  partySize: number;
  day: string;
  time: string;
  note: string | null;
  reply: string | null;
  cancelledBy: 'guest' | 'restaurant' | null;
  waitedSeconds: number;
  phone: string | null;
}

function toGuestReservation(data: unknown): GuestReservation | null {
  if (!data || typeof data !== 'object') return null;
  const r = data as Record<string, unknown>;
  if (typeof r.id !== 'string' || typeof r.status !== 'string') return null;
  return {
    id: r.id,
    code: String(r.code ?? ''),
    venue: String(r.venue ?? ''),
    status: r.status as ReservationStatus,
    name: String(r.name ?? ''),
    partySize: Number(r.party_size) || 1,
    day: String(r.day ?? ''),
    time: String(r.time ?? ''),
    note: typeof r.note === 'string' && r.note ? r.note : null,
    reply: typeof r.reply === 'string' && r.reply ? r.reply : null,
    cancelledBy: r.cancelled_by === 'guest' || r.cancelled_by === 'restaurant' ? r.cancelled_by : null,
    waitedSeconds: Number(r.waited_seconds) || 0,
    phone: typeof r.phone === 'string' && r.phone ? r.phone : null,
  };
}

/** `null`: no such request for this key. Throws when the answer could not be fetched at all. */
export async function readReservation(key: ReservationKey): Promise<GuestReservation | null> {
  const { data, error } = await untyped.rpc('guest_reservation', { _id: key.id, _token: key.token });
  if (error) {
    if (missing(error) || /22P02|invalid input syntax/.test(`${error.code} ${error.message}`)) return null;
    throw new Error(error.message);
  }
  return toGuestReservation(data);
}

export async function cancelReservation(key: ReservationKey): Promise<GuestReservation | null> {
  const { data, error } = await untyped.rpc('guest_cancel_reservation', { _id: key.id, _token: key.token });
  if (error) throw new Error(error.message);
  return toGuestReservation(data);
}

// ---------------------------------------------------------------------
// Days and times, on the restaurant's own calendar
// ---------------------------------------------------------------------

const minutesOf = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
};
const hhmmOf = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

/** A table can be asked for on the quarter hour (the database refuses any other time). */
export const SLOT_MINUTES = 15;

/** "2026-11-13" plus n days, with no clock or time zone in it. */
export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Today and every day the restaurant takes requests for. */
export function reservationDays(o: Pick<ReservationOptions, 'today' | 'daysAhead'>): string[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(o.today)) return [];
  return Array.from({ length: o.daysAhead + 1 }, (_, i) => addDays(o.today, i));
}

/**
 * The times that can still be asked for on `day`: every quarter hour from the
 * first to the last, and today only those far enough ahead for the
 * restaurant's notice.
 */
export function reservationTimes(o: Pick<ReservationOptions, 'open' | 'close' | 'today' | 'now' | 'leadMinutes'>, day: string): string[] {
  const first = Math.ceil(minutesOf(o.open) / SLOT_MINUTES) * SLOT_MINUTES;
  const last = minutesOf(o.close);
  const earliest = day === o.today ? minutesOf(o.now) + o.leadMinutes : day < o.today ? Infinity : -Infinity;
  const times: string[] = [];
  for (let t = first; t <= last; t += SLOT_MINUTES) {
    if (t >= earliest) times.push(hhmmOf(t));
  }
  return times;
}

const INTL: Record<Locale, string[]> = { en: ['en-GB'], bs: ['bs-BA', 'sr-Latn-BA', 'hr-HR'], ar: ['ar-u-nu-latn'] };
const tagFor = new Map<string, string>();

/**
 * The language a date is written in. Some browsers accept Bosnian and carry
 * none of its words (a date then reads "M11 14, Sat"), so each candidate is
 * tried on a known day and the first that names the month is kept: Bosnian,
 * else Serbian in Latin script, which names days and months the same way.
 */
export function intlTag(locale: Locale): string {
  let tag = tagFor.get(locale);
  if (!tag) {
    const probe = new Date(Date.UTC(2026, 10, 14));
    tag = (INTL[locale] ?? INTL.en).find((candidate) => {
      try {
        return !/^M?\d+$/.test(new Intl.DateTimeFormat(candidate, { timeZone: 'UTC', month: 'long' }).format(probe));
      } catch {
        return false;
      }
    }) ?? 'en-GB';
    tagFor.set(locale, tag);
  }
  return tag;
}

/** "Saturday 15 November" in the guest's language; the day is a calendar day, not an instant. */
export function formatReservationDay(day: string, locale: Locale, style: 'long' | 'short' = 'long'): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return day;
  const [y, m, d] = day.split('-').map(Number);
  return new Intl.DateTimeFormat(intlTag(locale), {
    timeZone: 'UTC', weekday: style, day: 'numeric', month: style,
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

/** A day as a chip shows it: "Sat", "14", "Nov", in the guest's language. */
export function reservationDayParts(day: string, locale: Locale): { weekday: string; number: string; month: string } {
  const [y, m, d] = day.split('-').map(Number);
  const at = new Date(Date.UTC(y, m - 1, d));
  const part = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(intlTag(locale), { timeZone: 'UTC', ...o }).format(at);
  return { weekday: part({ weekday: 'short' }), number: part({ day: 'numeric' }).replace(/\.$/, ''), month: part({ month: 'short' }).replace(/\.$/, '') };
}

/** The three parts a restaurant's day is offered in, so a guest picks among a dozen times, not forty. */
export const DAY_PARTS = ['midday', 'afternoon', 'evening'] as const;
export type DayPart = (typeof DAY_PARTS)[number];

export const partOfDay = (time: string): DayPart => (time < '15:00' ? 'midday' : time < '18:00' ? 'afternoon' : 'evening');

/** The time a part of the day opens on: the usual one where the day still has it, else its first. */
export function usualTime(times: string[], part: DayPart): string {
  const inPart = times.filter((t) => partOfDay(t) === part);
  const usual = { midday: '13:00', afternoon: '16:00', evening: '19:00' }[part];
  return inPart.includes(usual) ? usual : inPart[0] ?? '';
}

/** What a phone field may hold: digits and the usual separators, eight to fifteen digits. */
export function looksLikePhone(raw: string): boolean {
  return /^[0-9+() ./-]{6,30}$/.test(raw.trim()) && /^\d{8,15}$/.test(raw.replace(/\D/g, ''));
}

// ---------------------------------------------------------------------
// The guest's key, kept on their own phone
// ---------------------------------------------------------------------

const keyName = (venueSlug: string) => `reservation:${venueSlug}`;

export function rememberReservation(venueSlug: string, key: ReservationKey): void {
  try { localStorage.setItem(keyName(venueSlug), JSON.stringify({ id: key.id, token: key.token })); } catch { /* private mode: the page's address still holds it */ }
}

export function recallReservation(venueSlug: string): ReservationKey | null {
  try {
    const kept = JSON.parse(localStorage.getItem(keyName(venueSlug)) ?? 'null') as Partial<ReservationKey> | null;
    return kept && typeof kept.id === 'string' && typeof kept.token === 'string' ? { id: kept.id, token: kept.token } : null;
  } catch {
    return null;
  }
}

export function forgetReservation(venueSlug: string): void {
  try { localStorage.removeItem(keyName(venueSlug)); } catch { /* nothing kept */ }
}

/**
 * The guest's own page. Not under /reserve/: that is the booking page's
 * address, which search engines list, and everything below a guest's page is
 * kept out of search results, caches and referrers (public/_headers).
 */
export const reservationPath = (key: ReservationKey) => `/reservation/${key.id}?t=${encodeURIComponent(key.token)}`;

/** Asked once per page load and restaurant, however many parts of the page want to know. */
const asked = new Map<string, Promise<boolean>>();

/** Whether this restaurant takes table requests online now. Never a yes when the database cannot say. */
export function reservationsOpen(venueSlug: string): Promise<boolean> {
  let answer = asked.get(venueSlug);
  if (!answer) {
    answer = readReservationOptions(venueSlug).then((o) => o.enabled, () => false);
    asked.set(venueSlug, answer);
  }
  return answer;
}

// ---------------------------------------------------------------------
// The restaurant's side (Admin → Reservations)
// ---------------------------------------------------------------------

/** A request as the restaurant's admin reads it (public.reservations). */
export interface AdminReservation {
  /** The language the guest asked in: a message to them is written in it. */
  locale?: string | null;
  id: string;
  code: string;
  status: ReservationStatus;
  guest_name: string;
  guest_phone: string;
  party_size: number;
  reserved_for: string;
  note: string | null;
  reply: string | null;
  cancelled_by: 'guest' | 'restaurant' | null;
  created_at: string;
  decided_at: string | null;
}

const ADMIN_COLUMNS = 'id, code, status, guest_name, guest_phone, party_size, reserved_for, note, reply, cancelled_by, created_at, decided_at, locale';

/**
 * This restaurant's requests from yesterday on, soonest first. `null`: the
 * database has no reservations yet (the migration has not been applied).
 */
export async function listReservations(venueId: string, now = Date.now()): Promise<AdminReservation[] | null> {
  const since = new Date(now - 24 * 3600_000).toISOString();
  const { data, error } = await untyped.from('reservations').select(ADMIN_COLUMNS)
    .eq('venue_id', venueId).gte('reserved_for', since).order('reserved_for', { ascending: true }).limit(500);
  if (error) {
    if (missing(error)) return null;
    throw new Error(error.message);
  }
  return (data ?? []) as AdminReservation[];
}

/** How many requests are waiting for an answer; 0 when there is nothing to count yet. */
export async function countPendingReservations(venueId: string, now = Date.now()): Promise<number> {
  try {
    const { count, error } = await untyped.from('reservations').select('id', { count: 'exact', head: true })
      .eq('venue_id', venueId).eq('status', 'pending').gt('reserved_for', new Date(now).toISOString());
    return error ? 0 : count ?? 0;
  } catch {
    return 0;
  }
}

export type Decision = 'confirm' | 'decline' | 'cancel';

export async function decideReservation(id: string, decision: Decision, reply: string): Promise<ReservationStatus> {
  const { data, error } = await untyped.rpc('staff_decide_reservation', { _id: id, _decision: decision, _reply: reply.trim() || null });
  if (error) throw new Error(error.message);
  return (data as { status: ReservationStatus }).status;
}

/** A request nobody answered reads as expired from its time on, whether or not the sweep has marked it. */
export function statusNow(r: Pick<AdminReservation, 'status' | 'reserved_for'>, now = Date.now()): ReservationStatus {
  return r.status === 'pending' && Date.parse(r.reserved_for) < now ? 'expired' : r.status;
}

const SARAJEVO = { timeZone: 'Europe/Sarajevo' } as const;
const dayKey = new Intl.DateTimeFormat('en-CA', { ...SARAJEVO, year: 'numeric', month: '2-digit', day: '2-digit' });
const clock = new Intl.DateTimeFormat('en-GB', { ...SARAJEVO, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

/** The restaurant's own calendar day ("2026-11-15") and time ("19:30") of an instant. */
export function restaurantDayTime(iso: string): { day: string; time: string } {
  const at = new Date(iso);
  return { day: dayKey.format(at), time: clock.format(at) };
}

/** "3 min", "2 h 5 min": how long a guest has been waiting. */
export function waitedLabel(sinceIso: string, now = Date.now()): string {
  const minutes = Math.max(0, Math.floor((now - Date.parse(sinceIso)) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return minutes % 60 ? `${hours} h ${minutes % 60} min` : `${hours} h`;
}
