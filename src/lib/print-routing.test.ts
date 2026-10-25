import { describe, expect, it } from 'vitest';
import {
  cloudCoveredTypes, deviceLabel, needsAttention, printerFor, printerSummary, ticketStateLabel,
} from '@/lib/print-routing';
import type { PrinterHealth } from '@/lib/printers-api';

const printer = (over: Partial<PrinterHealth> = {}): PrinterHealth => ({
  id: 'p1', name: 'Kitchen printer', station: 'kitchen', protocol: 'star_cloudprnt', enabled: true,
  online: true, last_seen_at: new Date().toISOString(), last_status: '200 OK', last_error: null, waiting: 0,
  ...over,
});

describe('who prints', () => {
  it('a tablet steps aside for a station an online printer covers', () => {
    expect([...cloudCoveredTypes([printer()])]).toEqual(['kitchen']);
    expect([...cloudCoveredTypes([printer({ station: 'all' })])].sort()).toEqual(['bar', 'kitchen']);
  });

  it('and takes over again by itself when the printer goes quiet', () => {
    expect(cloudCoveredTypes([printer({ online: false })]).size).toBe(0);
    expect(cloudCoveredTypes([printer({ enabled: false })]).size).toBe(0);
  });

  it('routes a ticket to an online printer first', () => {
    const off = printer({ id: 'a', online: false });
    const on = printer({ id: 'b', station: 'all' });
    expect(printerFor([off, on], 'kitchen')?.id).toBe('b');
    expect(printerFor([off], 'kitchen')?.id).toBe('a');
    expect(printerFor([off], 'bar')).toBeNull();
  });
});

describe('printer status in words', () => {
  const now = Date.parse('2026-10-25T19:00:00Z');
  it('says online, offline with how long, or never connected', () => {
    expect(printerSummary(printer(), now)).toEqual({ tone: 'ok', label: 'Online' });
    expect(printerSummary(printer({ online: false, last_seen_at: '2026-10-25T18:56:00Z' }), now))
      .toEqual({ tone: 'bad', label: 'Offline — last seen 4 min ago' });
    expect(printerSummary(printer({ online: false, last_seen_at: null }), now).label).toBe('Never connected');
  });

  it('an online printer with a problem is not "fine"', () => {
    expect(printerSummary(printer({ last_error: 'The printer reported 511 Media Decoding Error' }), now).tone).toBe('bad');
  });
});

describe('ticket status in words', () => {
  it('says who printed it and whether the printer confirmed', () => {
    expect(ticketStateLabel({ status: 'printed', printed_at: '2026-10-25T18:14:00Z', print_verified: true, claimed_by_device: 'cloud:Bar printer' }))
      .toEqual({ tone: 'ok', label: 'Printed 19:14 · Bar printer' });
    expect(ticketStateLabel({ status: 'printed', printed_at: '2026-10-25T18:14:00Z', print_verified: false, claimed_by_device: 'a1b2c3d4' }).label)
      .toBe('Printed 19:14 · a tablet (unconfirmed)');
  });

  it('says why it did not print', () => {
    expect(ticketStateLabel({ status: 'failed', last_error: 'The printer is out of paper' }))
      .toEqual({ tone: 'bad', label: 'Did not print — The printer is out of paper' });
  });

  it('flags a ticket nobody has picked up for two minutes', () => {
    const now = Date.parse('2026-10-25T19:00:00Z');
    expect(needsAttention({ status: 'queued', updated_at: '2026-10-25T18:59:30Z' }, now)).toBe(false);
    expect(needsAttention({ status: 'queued', updated_at: '2026-10-25T18:57:00Z' }, now)).toBe(true);
    expect(needsAttention({ status: 'failed' }, now)).toBe(true);
    expect(needsAttention({ status: 'printed' }, now)).toBe(false);
  });

  it('names devices without leaking ids', () => {
    expect(deviceLabel('cloud:Kitchen printer')).toBe('Kitchen printer');
    expect(deviceLabel('9f3a2b1c')).toBe('a tablet');
    expect(deviceLabel(null)).toBeNull();
  });
});
