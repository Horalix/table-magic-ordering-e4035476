import { describe, expect, it } from 'vitest';
import {
  describeAnomaly, describePace, describeSalesChange, describeStation, signedPct,
  type ChangeTerm, type SalesDecomposition,
} from '@/lib/reporting';

/** Build a decomposition the way the server would, from the factor changes. */
function decomposition(opts: {
  visits: [number, number];
  itemsPerVisit?: [number, number];
  netPerItem?: [number, number];
  covers?: { guests: [number, number] };
  dayparts?: { daypart: string; visits: number; compare_visits: number }[];
}): SalesDecomposition {
  const [v1, v0] = opts.visits;
  const [i1, i0] = opts.itemsPerVisit ?? [3, 3];
  const [p1, p0] = opts.netPerItem ?? [10, 10];
  const term = (key: ChangeTerm['key'], cur: number, old: number): ChangeTerm => ({
    key, current: cur, compare: old, dlog: Math.log(cur / old), change_pct: 100 * (cur / old - 1),
  });
  let terms: ChangeTerm[];
  if (opts.covers) {
    const [g1, g0] = opts.covers.guests;
    terms = [term('visits', v1, v0), term('guests_per_visit', g1, g0),
      term('items_per_guest', i1 / g1, i0 / g0), term('net_per_item', p1, p0)];
  } else {
    terms = [term('visits', v1, v0), term('items_per_visit', i1, i0), term('net_per_item', p1, p0)];
  }
  const net1 = v1 * i1 * p1;
  const net0 = v0 * i0 * p0;
  return {
    from: '2026-10-18', to: '2026-10-24', cmp_from: '2026-10-11', cmp_to: '2026-10-17', scale: 1,
    basis: opts.covers ? 'covers' : 'visits',
    current: { net: net1, visits: v1, units: v1 * i1, covered_visits: 0, covers: 0 },
    compare: { net: net0, visits: v0, units: v0 * i0, covered_visits: 0, covers: 0 },
    total: {
      comparable: true, net: net1, compare_net: net0, change_pct: 100 * (net1 / net0 - 1),
      dlog: Math.log(net1 / net0), terms,
    },
    dayparts: (opts.dayparts ?? []).map((p) => ({
      ...p, comparable: true, net: 0, compare_net: 0, change_pct: 0, terms: [],
    })),
  };
}

describe('why sales changed, in one sentence', () => {
  it('names fewer tables, where they went missing, and the spend per table', () => {
    const d = decomposition({
      visits: [90, 100],
      itemsPerVisit: [3.06, 3],
      dayparts: [
        { daypart: 'lunch', visits: 50, compare_visits: 60 },
        { daypart: 'evening', visits: 40, compare_visits: 40 },
      ],
    });
    expect(describeSalesChange(d)).toBe('Net sales −8% vs last week: 10% fewer tables at lunch; spend per table +2%.');
  });

  it('leads with whatever explains most of the change, and does not name a daypart that is not the story', () => {
    const d = decomposition({
      visits: [101, 100],
      netPerItem: [11.5, 10],
      dayparts: [
        { daypart: 'lunch', visits: 51, compare_visits: 50 },
        { daypart: 'evening', visits: 50, compare_visits: 50 },
        { daypart: 'late', visits: 1, compare_visits: 0 },
      ],
    });
    expect(describeSalesChange(d, 'the last 4 weeks'))
      .toBe('Net sales +16% vs the last 4 weeks: spend per table +15%; 1% more tables.');
  });

  it('talks about guests when head counts are recorded', () => {
    const d = decomposition({ visits: [100, 100], covers: { guests: [2.2, 2.5] }, itemsPerVisit: [3, 3] });
    expect(describeSalesChange(d)).toBe('Net sales flat vs last week: parties 12% smaller; spend per guest +14%; as many tables.');
  });

  it('says so when there is nothing to compare', () => {
    const d = decomposition({ visits: [10, 10] });
    d.total = { comparable: false, net: 40, compare_net: 0, change_pct: null, terms: [] };
    expect(describeSalesChange(d)).toBe('No sales to compare with last week yet.');
  });

  it('formats a signed percentage with a real minus sign', () => {
    expect(signedPct(-0.081)).toBe('−8%');
    expect(signedPct(0.02)).toBe('+2%');
    expect(signedPct(0.001)).toBe('0%');
  });
});

describe('is today normal', () => {
  const today = {
    day: '2026-10-20', so_far: 1240, history: 6, usual_so_far: 1100, usual_total: 2700,
    usual_share: 0.43, pace: 1.13, projected: 2884, z: 1.2, status: 'normal' as const, alert: false,
  };

  it('puts today next to the same moment of a usual weekday', () => {
    expect(describePace(today)).toBe(
      '1,240 KM so far, 113% of a usual Tuesday by this time — on course for about 2,884 KM (a usual Tuesday takes 2,700 KM).');
  });

  it('will not judge the pace without history or too early in the day', () => {
    expect(describePace({ ...today, status: 'learning', history: 2 })).toBe(
      '1,240 KM so far. Pace needs four Tuesdays of history; there are 2.');
    expect(describePace({ ...today, status: 'too_early' })).toBe('1,240 KM so far. Too early in the day to judge the pace.');
  });

  it('describes a day that broke from its weekday', () => {
    expect(describeAnomaly({
      day: '2026-10-21', weekday: 'Wednesday', net: 600, traded: true, history: 6, median: 1000,
      z: -5, status: 'low', alert: true,
    })).toBe('Wednesday 21 Oct: 600 KM, 40% below a usual Wednesday (1,000 KM).');
  });

  it('describes a station against its own usual', () => {
    const base = {
      station: 'kitchen', daypart: 'lunch', tickets: 14, p50: 11, p90: 18.2, baseline_p90: 12,
      baseline_tickets: 120, baseline_daypart: 'lunch', ratio: 1.52, status: 'slow' as const, alert: true,
    };
    expect(describeStation(base)).toBe('Kitchen: slowest 1 in 10 tickets 18 min in the last 2 hours, usually 12 (1.5×).');
    expect(describeStation({ ...base, station: 'bar', status: 'too_few_tickets', tickets: 1 }))
      .toBe('Bar: 1 ticket in the last 2 hours — too few to judge.');
  });
});
