/**
 * What the restaurant tells a guest about their reservation in a message of
 * its own (WhatsApp, Viber, a text), in the guest's language, and the links
 * that open each of those apps with the message already written. Also the
 * calendar entry a guest keeps once a table is confirmed.
 *
 * No imports that need the app: plain words in, plain words out.
 */
import type { Locale } from './i18n';
import { rcopy } from './reservation-copy';

export type GuestMessageKind = 'confirmed' | 'declined' | 'cancelled';

export interface GuestMessageFacts {
  venue: string;
  /** "Saturday 14 November", already in the guest's language. */
  day: string;
  /** "19:30" */
  time: string;
  party: number;
  code: string;
  /** The restaurant's own line for the guest, if it wrote one. */
  reply?: string | null;
  /** The number a guest can call, if the restaurant has one. */
  phone?: string | null;
}

/** One message, one paragraph: who, what, when, the restaurant's own line, and how to reach it. */
export function guestMessage(kind: GuestMessageKind, facts: GuestMessageFacts, locale: Locale): string {
  const said = rcopy(`msg_${kind}`, locale, { venue: facts.venue, day: facts.day, time: facts.time, party: facts.party, code: facts.code });
  const reply = facts.reply?.trim();
  const call = facts.phone ? rcopy('msg_call', locale, { phone: facts.phone }) : '';
  return [said, reply ? (/[.!?؟]$/.test(reply) ? reply : `${reply}.`) : '', call].filter(Boolean).join(' ');
}

/** Digits only, as the messaging apps want a number: "+387 61 123-456" → "38761123456". */
export const phoneDigits = (phone: string): string => phone.replace(/\D/g, '').replace(/^00/, '');

/** WhatsApp, on a phone or a computer, with the chat open and the message written. */
export const whatsappLink = (phone: string, text: string): string =>
  `https://wa.me/${phoneDigits(phone)}?text=${encodeURIComponent(text)}`;

/** Viber opens the chat; it takes no text, so the message is copied first and pasted there. */
export const viberLink = (phone: string): string => `viber://chat?number=%2B${phoneDigits(phone)}`;

/** The phone's own Messages app, with the number and the text filled in (the form both iOS and Android read). */
export const smsLink = (phone: string, text: string): string =>
  `sms:+${phoneDigits(phone)}?&body=${encodeURIComponent(text)}`;

const icsText = (s: string) => s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');
const compact = (day: string, time: string) => `${day.replace(/-/g, '')}T${time.replace(':', '')}00`;

/** "19:30" plus two hours, on the same or the next calendar day: how long a table is kept in a calendar. */
function twoHoursOn(day: string, time: string): string {
  const [y, m, d] = day.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const end = new Date(Date.UTC(y, m - 1, d, hh + 2, mm));
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${end.getUTCFullYear()}${pad(end.getUTCMonth() + 1)}${pad(end.getUTCDate())}T${pad(end.getUTCHours())}${pad(end.getUTCMinutes())}00`;
}

export interface CalendarFacts {
  id: string;
  /** The restaurant's own calendar day and clock: "2026-11-14", "19:30". */
  day: string;
  time: string;
  title: string;
  where?: string;
  details?: string;
  /** When the entry was written, for the calendar's own bookkeeping. */
  stamp?: Date;
}

/**
 * A confirmed table as a calendar entry (.ics): two hours from its time, on
 * the restaurant's clock, wherever the guest's phone thinks it is.
 */
export function calendarEntry(c: CalendarFacts): string {
  const stamp = (c.stamp ?? new Date()).toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Table reservation//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${c.id}@reservation`,
    `DTSTAMP:${stamp}`,
    `DTSTART;TZID=Europe/Sarajevo:${compact(c.day, c.time)}`,
    `DTEND;TZID=Europe/Sarajevo:${twoHoursOn(c.day, c.time)}`,
    `SUMMARY:${icsText(c.title)}`,
    ...(c.where ? [`LOCATION:${icsText(c.where)}`] : []),
    ...(c.details ? [`DESCRIPTION:${icsText(c.details)}`] : []),
    'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n');
}

/** The entry as a link a phone opens straight into its calendar. */
export const calendarLink = (c: CalendarFacts): string => `data:text/calendar;charset=utf-8,${encodeURIComponent(calendarEntry(c))}`;
