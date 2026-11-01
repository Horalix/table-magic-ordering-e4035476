import { describe, expect, it } from 'vitest';
import { attentionSummary, plural } from './floor-words';

describe('plural', () => {
  it('counts one and many', () => {
    expect(plural(1, 'call')).toBe('1 call');
    expect(plural(2, 'call')).toBe('2 calls');
    expect(plural(0, 'table')).toBe('0 tables');
    expect(plural(3, 'person', 'people')).toBe('3 people');
  });
});

describe('attentionSummary', () => {
  it('groups by what to do, food first and the bill last', () => {
    expect(attentionSummary({ ready: [7], calls: [3, 7], bills: [6] }))
      .toBe('Food up T7 · Calling T3, T7 · Bill T6');
  });

  it('names a table once per group', () => {
    // Two orders up for table 7 are one trip to the pass.
    expect(attentionSummary({ ready: [7, 7, 2], calls: [], bills: [] })).toBe('Food up T7, T2');
  });

  it('leaves out what is not waiting', () => {
    expect(attentionSummary({ ready: [], calls: [], bills: [6] })).toBe('Bill T6');
    expect(attentionSummary({ ready: [], calls: [], bills: [] })).toBe('');
  });
});
