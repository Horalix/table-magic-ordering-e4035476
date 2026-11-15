import { describe, expect, it } from 'vitest';
import { TONE, orderTone, type StaffTone } from './status-tone';

const hue = (tone: StaffTone) => Number(TONE[tone].hsl.split(' ')[0]);

describe('staff status colours', () => {
  it('gives every kitchen status one tone, and nothing to states the kitchen never sees', () => {
    expect(orderTone('pending')).toBe('new');
    expect(orderTone('confirmed')).toBe('new');
    expect(orderTone('preparing')).toBe('preparing');
    expect(orderTone('ready')).toBe('ready');
    expect(orderTone('served')).toBe('served');
    expect(orderTone('awaiting_payment')).toBeNull();
    expect(orderTone('cancelled')).toBeNull();
    expect(orderTone(null)).toBeNull();
  });

  it('keeps the coloured states apart on the colour wheel', () => {
    // served (grey) and bill (ink) are told apart by lightness, not hue.
    const coloured: StaffTone[] = ['new', 'preparing', 'ready', 'late', 'calling'];
    for (const a of coloured) {
      for (const b of coloured) {
        if (a === b) continue;
        const d = Math.abs(hue(a) - hue(b));
        expect(Math.min(d, 360 - d), `${a} vs ${b}`).toBeGreaterThanOrEqual(30);
      }
    }
  });

  it('says only "late" in red', () => {
    for (const tone of Object.keys(TONE) as StaffTone[]) {
      if (tone === 'late') continue;
      const h = hue(tone);
      expect(Math.min(h, 360 - h), tone).toBeGreaterThan(20);
    }
  });
});
