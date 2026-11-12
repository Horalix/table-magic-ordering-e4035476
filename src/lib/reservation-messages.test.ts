/**
 * @vitest-environment node
 *
 * What the restaurant tells a guest in a message of its own, the links that
 * open WhatsApp, Viber and Messages with it written, and the calendar entry
 * for a confirmed table (./reservation-messages.ts). And the booking page's
 * day chips and parts of the day (./reservations.ts).
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));

import { calendarEntry, calendarLink, guestMessage, phoneDigits, smsLink, viberLink, whatsappLink } from './reservation-messages';
import { DAY_PARTS, formatReservationDay, intlTag, partOfDay, reservationDayParts, usualTime } from './reservations';

const facts = { venue: 'La Soul', day: 'Saturday 14 November', time: '19:30', party: 4, code: 'R48213' };

describe('the message for the guest', () => {
  it('says who, what and when, with the restaurant’s own line and its number', () => {
    expect(guestMessage('confirmed', { ...facts, reply: 'By the window, as you asked', phone: '+387 33 877 779' }, 'en')).toBe(
      'La Soul: your table is confirmed. Saturday 14 November at 19:30, guests: 4. Reservation R48213. By the window, as you asked. Questions? Call +387 33 877 779.',
    );
  });

  it('a decline and a cancellation are sorry, and carry the reason when the restaurant gave one', () => {
    expect(guestMessage('declined', { ...facts, reply: 'Full at 19:30, 21:00 is free.' }, 'en'))
      .toBe('La Soul: we are sorry, we cannot take your reservation for Saturday 14 November at 19:30. Full at 19:30, 21:00 is free.');
    expect(guestMessage('cancelled', facts, 'en')).toBe('La Soul: we are sorry, we had to cancel your reservation for Saturday 14 November at 19:30.');
  });

  it('is written in the language the guest asked in, with every mark filled', () => {
    const bs = guestMessage('confirmed', { ...facts, day: 'subota, 14. novembar', phone: '+387 33 877 779' }, 'bs');
    expect(bs).toBe('La Soul: vaš sto je potvrđen. subota, 14. novembar u 19:30, broj osoba: 4. Rezervacija R48213. Pitanja? Pozovite +387 33 877 779.');
    for (const kind of ['confirmed', 'declined', 'cancelled'] as const) {
      for (const locale of ['en', 'bs', 'ar'] as const) {
        const text = guestMessage(kind, { ...facts, reply: 'x', phone: '+387 33 877 779' }, locale);
        expect(text).not.toMatch(/[{}]/);
        expect(text).toContain('La Soul');
        expect(text).toContain('19:30');
      }
    }
    expect(guestMessage('confirmed', facts, 'ar')).toContain('تم تأكيد طاولتك');
  });

  it('never says more than the answer: no empty line, no doubled full stop', () => {
    expect(guestMessage('confirmed', { ...facts, reply: '   ' }, 'en')).toBe('La Soul: your table is confirmed. Saturday 14 November at 19:30, guests: 4. Reservation R48213.');
    expect(guestMessage('declined', { ...facts, reply: 'Call us!' }, 'en')).toMatch(/19:30\. Call us!$/);
  });
});

describe('one tap to send it', () => {
  const text = 'La Soul: your table is confirmed. 19:30 & 4 guests';

  it('reads a number however it was typed', () => {
    expect(phoneDigits('+387 61 123-456')).toBe('38761123456');
    expect(phoneDigits('00387 (61) 123 456')).toBe('38761123456');
  });

  it('WhatsApp opens the chat with the message written', () => {
    expect(whatsappLink('+387 61 123-456', text)).toBe(`https://wa.me/38761123456?text=${encodeURIComponent(text)}`);
  });

  it('Viber opens the chat; Messages gets the number and the text', () => {
    expect(viberLink('+387 61 123 456')).toBe('viber://chat?number=%2B38761123456');
    expect(smsLink('+387 61 123 456', text)).toBe(`sms:+38761123456?&body=${encodeURIComponent(text)}`);
  });
});

describe('a confirmed table in the guest’s calendar', () => {
  const entry = calendarEntry({
    id: '7b1f6a52', day: '2026-11-14', time: '19:30', title: 'Table at La Soul', where: 'La Soul, Butmirska cesta 16A | 16B, Sarajevo',
    details: 'Guests: 4. Reservation R48213', stamp: new Date('2026-11-13T09:00:00Z'),
  });

  it('is two hours from its time, on the restaurant’s clock', () => {
    expect(entry).toContain('DTSTART;TZID=Europe/Sarajevo:20261114T193000');
    expect(entry).toContain('DTEND;TZID=Europe/Sarajevo:20261114T213000');
    expect(entry).toContain('DTSTAMP:20261113T090000Z');
    expect(entry).toContain('SUMMARY:Table at La Soul');
    expect(entry).toContain('LOCATION:La Soul\\, Butmirska cesta 16A | 16B\\, Sarajevo');
    expect(entry.split('\r\n')[0]).toBe('BEGIN:VCALENDAR');
    expect(entry.endsWith('END:VCALENDAR')).toBe(true);
  });

  it('a late table ends on the next day', () => {
    expect(calendarEntry({ id: 'x', day: '2026-12-31', time: '23:00', title: 't' })).toContain('DTEND;TZID=Europe/Sarajevo:20270101T010000');
  });

  it('is a link a phone opens straight into its calendar', () => {
    expect(calendarLink({ id: 'x', day: '2026-11-14', time: '19:30', title: 't' })).toMatch(/^data:text\/calendar;charset=utf-8,BEGIN%3AVCALENDAR/);
  });
});

describe('the booking page’s choices', () => {
  it('a day is a weekday, a number and a month, in the guest’s language', () => {
    expect(reservationDayParts('2026-11-14', 'en')).toEqual({ weekday: 'Sat', number: '14', month: 'Nov' });
    const bs = reservationDayParts('2026-11-14', 'bs');
    expect(bs.number).toBe('14');
    expect(bs.weekday.length).toBeGreaterThan(1);
    // Arabic keeps Latin digits, as the rest of the page does.
    expect(reservationDayParts('2026-11-14', 'ar').number).toBe('14');
  });

  it('a date is always in words: a browser that knows no Bosnian is given the nearest language that reads the same', () => {
    expect(formatReservationDay('2026-11-14', 'bs')).not.toMatch(/M\d\d/);
    expect(formatReservationDay('2026-11-14', 'bs')).toMatch(/14/);
    expect(['bs-BA', 'sr-Latn-BA', 'hr-HR']).toContain(intlTag('bs'));
    expect(intlTag('en')).toBe('en-GB');
    expect(formatReservationDay('2026-11-14', 'en')).toBe('Saturday 14 November');
  });

  it('a time belongs to midday, the afternoon or the evening', () => {
    expect(DAY_PARTS).toEqual(['midday', 'afternoon', 'evening']);
    expect(['11:00', '14:45', '15:00', '17:45', '18:00', '21:00'].map(partOfDay))
      .toEqual(['midday', 'midday', 'afternoon', 'afternoon', 'evening', 'evening']);
  });

  it('a part of the day opens on its usual time, or its first when the day no longer has that', () => {
    const all = ['11:00', '13:00', '15:30', '16:00', '18:15', '19:00', '20:45'];
    expect(usualTime(all, 'midday')).toBe('13:00');
    expect(usualTime(all, 'afternoon')).toBe('16:00');
    expect(usualTime(all, 'evening')).toBe('19:00');
    expect(usualTime(['19:30', '20:00'], 'evening')).toBe('19:30');
    expect(usualTime(['19:30'], 'midday')).toBe('');
  });
});
