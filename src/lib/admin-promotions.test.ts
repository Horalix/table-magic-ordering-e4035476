import { describe, expect, it } from 'vitest';
import {
  emptySale, NO_SALE, parseSurcharge, saleColumns, saleDraftFromRow, saleEndPresets, salePreview, slotsPayload,
  slotsProblem, newSlot, type SaleDraft,
} from '@/lib/admin-promotions';

const draft = (over: Partial<SaleDraft>): SaleDraft => ({ ...emptySale(), on: true, ...over });
const WED_NOON = Date.parse('2026-10-21T10:00:00Z'); // 12:00 in Sarajevo

/**
 * The owner types a sale the way they would say it; these make sure what is
 * written is what they meant, and that the line under the form says it back.
 */
describe('the sale form', () => {
  it('writes nothing for a dish that is not on sale', () => {
    expect(saleColumns(emptySale(), 18)).toEqual({ ok: true, columns: NO_SALE });
  });

  it('takes "20" as 20 % off and "14,40" as a sale price', () => {
    expect(saleColumns(draft({ kind: 'percent', value: '20', label: 'happy_hour' }), 18)).toEqual({
      ok: true,
      columns: { sale_kind: 'percent', sale_value: 20, sale_starts_at: null, sale_ends_at: null, sale_label: 'happy_hour' },
    });
    const fixed = saleColumns(draft({ kind: 'price', value: '14,40' }), 18);
    expect(fixed.ok && fixed.columns.sale_value).toBe(14.4);
  });

  it('refuses what the database would refuse, in words', () => {
    expect(saleColumns(draft({ value: '12.5' }), 18)).toMatchObject({ ok: false, error: expect.stringMatching(/whole percentage/) });
    expect(saleColumns(draft({ value: '95' }), 18)).toMatchObject({ ok: false });
    expect(saleColumns(draft({ kind: 'price', value: '18' }), 18)).toMatchObject({ ok: false, error: expect.stringMatching(/below the menu price \(18\.00 KM\)/) });
    expect(saleColumns(draft({ value: '20', startDate: '2026-10-25', endDate: '2026-10-24' }), 18)).toMatchObject({ ok: false, error: 'The sale must end after it starts' });
    expect(saleColumns(draft({ value: '20', endTime: '20:00' }), 18)).toMatchObject({ ok: false, error: 'Pick a date as well as a time' });
  });

  it('reads dates as Sarajevo time; a bare end date means the whole of that day', () => {
    const result = saleColumns(draft({ value: '20', startDate: '2026-10-24', startTime: '16:00', endDate: '2026-10-25' }), 18);
    expect(result.ok && result.columns.sale_starts_at).toBe('2026-10-24T14:00:00.000Z'); // CEST
    expect(result.ok && result.columns.sale_ends_at).toBe('2026-10-25T22:59:00.000Z'); // CET, 23:59
  });

  it('says what the sale will do before it is saved', () => {
    expect(salePreview(draft({ value: '20' }), 18, WED_NOON)).toEqual({ text: '18.00 → 14.40 KM · −20% · until you end it', tone: 'ok' });
    expect(salePreview(draft({ value: '20', endDate: '2026-10-25', endTime: '20:00' }), 18, WED_NOON)?.text)
      .toBe('18.00 → 14.40 KM · −20% · ends Sun 20:00');
    expect(salePreview(draft({ value: '20', startDate: '2026-10-23', startTime: '16:00', endDate: '2026-10-23', endTime: '18:00' }), 18, WED_NOON)?.text)
      .toBe('18.00 → 14.40 KM · −20% · starts Fri 16:00 · ends Fri 18:00');
    expect(salePreview(draft({ value: '20', endDate: '2026-10-20', endTime: '20:00' }), 18, WED_NOON))
      .toEqual({ text: '18.00 → 14.40 KM · −20% · already ended 20 Oct 20:00', tone: 'warn' });
    expect(salePreview(emptySale(), 18, WED_NOON)).toBeNull();
  });

  it('opens a saved sale as it was typed', () => {
    const back = saleDraftFromRow({ sale_kind: 'price', sale_value: 14.4, sale_ends_at: '2026-10-25T19:00:00Z', sale_label: 'weekend_offer' });
    expect(back).toMatchObject({ on: true, kind: 'price', value: '14.40', label: 'weekend_offer', endDate: '2026-10-25', endTime: '20:00' });
    expect(saleDraftFromRow({ sale_kind: null })).toEqual(emptySale());
  });

  it('offers one-tap ends at 23:00 tonight, on Sunday and in a week', () => {
    expect(saleEndPresets(WED_NOON)).toEqual([
      { label: 'Ends tonight', date: '2026-10-21', time: '23:00' },
      { label: 'Ends Sunday night', date: '2026-10-25', time: '23:00' },
      { label: 'Ends in a week', date: '2026-10-28', time: '23:00' },
    ]);
  });
});

describe('the combo form', () => {
  it('reads extra charges the way they are typed', () => {
    expect(parseSurcharge('')).toBe(0);
    expect(parseSurcharge('1,50')).toBe(1.5);
    expect(parseSurcharge('+2 KM')).toBe(2);
    expect(parseSurcharge('abc')).toBeNull();
    expect(parseSurcharge('150')).toBeNull();
  });

  it('says what is missing before anything is saved', () => {
    expect(slotsProblem([])).toMatch(/at least one part/);
    expect(slotsProblem([{ ...newSlot(''), options: [{ item_id: 'a', surcharge: '' }] }])).toBe('Part 1 needs a name, e.g. “Drink”.');
    expect(slotsProblem([newSlot('Drink')])).toBe('“Drink” needs at least one dish to choose from.');
    expect(slotsProblem([{ ...newSlot('Drink'), options: [{ item_id: 'a', surcharge: 'x' }] }])).toMatch(/Check the extra charges in “Drink”/);
    expect(slotsProblem([{ ...newSlot('Drink'), options: [{ item_id: 'a', surcharge: '1' }] }])).toBeNull();
  });

  it('sends the parts as admin_save_combo takes them', () => {
    expect(slotsPayload([{ ...newSlot(' Drink '), label_bs: 'Piće', options: [{ item_id: 'a', surcharge: '' }, { item_id: 'b', surcharge: '1,5' }] }]))
      .toEqual([{ label: 'Drink', label_bs: 'Piće', label_ar: null, options: [{ item_id: 'a', surcharge: 0 }, { item_id: 'b', surcharge: 1.5 }] }]);
  });
});
