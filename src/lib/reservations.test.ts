import { describe, expect, it } from 'vitest';
import {
  addDays, formatReservationDay, looksLikePhone, refusalOf, reservationDays, reservationPath, reservationTimes,
  restaurantDayTime, statusNow, waitedLabel,
} from './reservations';
import { rcopy, refusalCopy, reservationCopyTable, statusTitle } from './reservation-copy';

/**
 * The booking page's days and times are the restaurant's, not the phone's: a
 * guest in Kuwait at 21:00 is offered what Sarajevo, at 19:00, still has.
 */
const options = { open: '11:00', close: '21:00', today: '2026-11-13', now: '18:20', leadMinutes: 60, daysAhead: 30 };

describe('the days and times a guest is offered', () => {
  it('today and every day the restaurant takes requests for, across a month and a year end', () => {
    const days = reservationDays(options);
    expect(days).toHaveLength(31);
    expect(days[0]).toBe('2026-11-13');
    expect(days[18]).toBe('2026-12-01');
    expect(days[30]).toBe('2026-12-13');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(reservationDays({ today: '', daysAhead: 30 })).toEqual([]);
  });

  it('every quarter hour from the first time to the last', () => {
    const times = reservationTimes(options, '2026-11-14');
    expect(times[0]).toBe('11:00');
    expect(times[1]).toBe('11:15');
    expect(times.at(-1)).toBe('21:00');
    expect(times).toHaveLength(41);
    // An opening time off the quarter hour starts at the next one.
    expect(reservationTimes({ ...options, open: '11:05' }, '2026-11-14')[0]).toBe('11:15');
  });

  it('today only what is still far enough ahead for the restaurant\'s notice', () => {
    expect(reservationTimes(options, '2026-11-13')).toEqual(['19:30', '19:45', '20:00', '20:15', '20:30', '20:45', '21:00']);
    expect(reservationTimes({ ...options, now: '20:30' }, '2026-11-13')).toEqual([]);
    expect(reservationTimes({ ...options, leadMinutes: 0, now: '20:45' }, '2026-11-13')).toEqual(['20:45', '21:00']);
    // A day already gone offers nothing.
    expect(reservationTimes(options, '2026-11-12')).toEqual([]);
  });

  it('are named in the guest\'s language, as calendar days', () => {
    expect(formatReservationDay('2026-11-14', 'en')).toBe('Saturday 14 November');
    expect(formatReservationDay('2026-11-14', 'en', 'short')).toBe('Sat 14 Nov');
    expect(formatReservationDay('2026-11-14', 'bs')).toMatch(/subota/i);
    expect(formatReservationDay('2026-11-14', 'ar')).toMatch(/السبت/);
    // Arabic keeps the digits a time is written in elsewhere on the page.
    expect(formatReservationDay('2026-11-14', 'ar')).toMatch(/14/);
    expect(formatReservationDay('soon', 'en')).toBe('soon');
  });
});

describe('what a guest types', () => {
  it('a phone number is digits and the usual separators, local or from abroad', () => {
    for (const ok of ['+387 61 123-456', '061/123-456', '+965 5000 1234', '(033) 877 779', '0038761123456']) {
      expect(looksLikePhone(ok), ok).toBe(true);
    }
    for (const bad of ['12345', 'call me', '+387 61 abc', '', '1234567890123456789']) {
      expect(looksLikePhone(bad), bad).toBe(false);
    }
  });

  it('a refusal is read from the database\'s word, and anything else is "did not go through"', () => {
    expect(refusalOf('RESERVATION:soon')).toBe('soon');
    expect(refusalOf('new row violates … RESERVATION:repeat')).toBe('repeat');
    expect(refusalOf('RESERVATION:nonsense')).toBe('unknown');
    expect(refusalOf('fetch failed')).toBe('unknown');
    expect(refusalOf(null)).toBe('unknown');
  });
});

describe('the words', () => {
  it('every line is there in English, Bosnian and Arabic, with the same marks', () => {
    for (const [key, line] of Object.entries(reservationCopyTable)) {
      const marks = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
      for (const locale of ['en', 'bs', 'ar'] as const) {
        expect(line[locale]?.trim(), `${key}.${locale}`).toBeTruthy();
        expect(marks(line[locale]), `${key}.${locale}`).toBe(marks(line.en));
      }
    }
  });

  it('fills the marks, and never says "booked" before the restaurant has answered', () => {
    expect(rcopy('call', 'en', { phone: '+387 33 877 779' })).toBe('Call +387 33 877 779');
    expect(rcopy('pending_long', 'bs', { code: 'R48213' })).toContain('R48213');
    expect(`${rcopy('pending_title', 'en')} ${rcopy('pending_body', 'en')} ${rcopy('send', 'en')}`).not.toMatch(/booked|confirmed|reserved/i);
  });

  it('each refusal and each state has its own line', () => {
    expect(refusalCopy('soon', 'en')).toMatch(/too soon/);
    expect(refusalCopy('time', 'en')).toBe(refusalCopy('hours', 'en'));
    expect(refusalCopy('disabled', 'en')).toMatch(/not open/);
    expect(refusalCopy('unknown', 'ar')).toBe(reservationCopyTable.refused_unknown.ar);
    expect(statusTitle('pending', null, 'en')).toBe('We have your request');
    expect(statusTitle('confirmed', null, 'en')).toBe('Your table is confirmed');
    expect(statusTitle('cancelled', 'guest', 'en')).toBe('You cancelled this reservation');
    expect(statusTitle('cancelled', 'restaurant', 'en')).toBe('We had to cancel this reservation');
    expect(statusTitle('expired', null, 'bs')).toBe(reservationCopyTable.expired_title.bs);
  });
});

describe('the restaurant\'s side', () => {
  it('reads an instant on the restaurant\'s own calendar and clock, summer and winter', () => {
    expect(restaurantDayTime('2026-11-14T18:30:00Z')).toEqual({ day: '2026-11-14', time: '19:30' });
    expect(restaurantDayTime('2026-07-14T22:30:00Z')).toEqual({ day: '2026-07-15', time: '00:30' });
  });

  it('a request nobody answered is expired from its time on', () => {
    const now = Date.parse('2026-11-14T18:30:00Z');
    expect(statusNow({ status: 'pending', reserved_for: '2026-11-14T18:00:00Z' }, now)).toBe('expired');
    expect(statusNow({ status: 'pending', reserved_for: '2026-11-14T19:00:00Z' }, now)).toBe('pending');
    expect(statusNow({ status: 'confirmed', reserved_for: '2026-11-14T18:00:00Z' }, now)).toBe('confirmed');
  });

  it('says how long a guest has been waiting', () => {
    const now = Date.parse('2026-11-14T18:30:00Z');
    expect(waitedLabel('2026-11-14T18:29:40Z', now)).toBe('just now');
    expect(waitedLabel('2026-11-14T18:23:00Z', now)).toBe('7 min');
    expect(waitedLabel('2026-11-14T16:30:00Z', now)).toBe('2 h');
    expect(waitedLabel('2026-11-14T16:25:00Z', now)).toBe('2 h 5 min');
  });

  it('the guest\'s page has its key in its address', () => {
    expect(reservationPath({ id: 'abc', token: 't+k' })).toBe('/reserve/abc?t=t%2Bk');
  });
});
