import { describe, expect, it } from 'vitest';
import { heldReasonIsSuspicious, heldReasonLabel, parseHeldReason } from './held-orders';

describe('held order reasons', () => {
  it('reads the limit out of an unpaid-total reason', () => {
    expect(parseHeldReason('unpaid_exposure:150')).toEqual({ code: 'unpaid_exposure', detail: '150' });
    expect(heldReasonLabel('unpaid_exposure:150')).toBe('Over 150 KM unpaid');
    expect(heldReasonLabel('unpaid_exposure:72.5')).toBe('Over 72.5 KM unpaid');
  });

  it('names the table for a second session', () => {
    expect(heldReasonLabel('second_session', 7)).toBe('Second session on table 7');
  });

  it('says every known reason in words', () => {
    expect(heldReasonLabel('large_first_order')).toBe('Large first order');
    expect(heldReasonLabel('outside_hours')).toBe('Outside opening hours');
    expect(heldReasonLabel('auto_admitted')).toBe('Joined without approval');
    expect(heldReasonLabel('venue_burst')).toBe('Many new tables at once');
  });

  it('still shows a reason it does not recognise', () => {
    expect(heldReasonLabel('something_new')).toBe('Needs a check');
  });

  it('offers blocking only for reasons that look like a prank', () => {
    expect(heldReasonIsSuspicious('large_first_order')).toBe(false);
    expect(heldReasonIsSuspicious('unpaid_exposure:150')).toBe(false);
    expect(heldReasonIsSuspicious('venue_burst')).toBe(true);
    expect(heldReasonIsSuspicious('second_session')).toBe(true);
    expect(heldReasonIsSuspicious(null)).toBe(false);
  });
});
