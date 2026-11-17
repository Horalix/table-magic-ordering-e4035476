import { beforeEach, describe, expect, it } from 'vitest';
import { PAGES, searchScore } from './admin-nav';
import { markWhatsNewSeen, placeCallout, tourLabel, tourSteps, whatsNewSeen, type TourAudience } from './whats-new';
import { WHATS_NEW_VERSION, whatsNewKey } from './whats-new-version';

/**
 * The walkthrough's words and rules (whats-new.ts). The words are held to
 * the navigation they describe: a tour that names a page the admin does not
 * have teaches people to stop reading.
 */

const base: TourAudience = { owner: false, wide: true, demo: false, standalone: false, shortcut: 'Ctrl K' };
const all = (who: Partial<TourAudience>) => tourSteps({ ...base, ...who });
const words = (who: Partial<TourAudience>) => all(who).map((s) => [s.title, s.body, ...(s.points ?? []), s.note ?? ''].join(' ')).join('\n');

describe('the walkthrough', () => {
  it('is eight short steps, the same number for everyone', () => {
    for (const who of [{}, { owner: true }, { wide: false }, { demo: true }, { standalone: true, wide: false }]) {
      const steps = all(who);
      expect(steps.map((s) => s.id)).toEqual(['welcome', 'areas', 'search', 'service', 'iphone', 'floor', 'earned', 'done']);
      for (const step of steps) {
        expect(step.title.length, step.id).toBeLessThanOrEqual(32);
        expect(step.body.length, step.id).toBeLessThanOrEqual(230);
        expect([step.title, step.body, ...(step.points ?? []), step.note ?? ''].join(' '), step.id).not.toMatch(/!/);
      }
    }
  });

  it('names only pages the admin really has, by the names the navigation gives them', () => {
    const labels = PAGES.map((p) => p.label);
    for (const name of ['Dishes', 'Daily report', 'Analytics', 'Audit log', 'Tables', 'QR codes', 'Floor sections', 'Waiters', 'Printing', 'Orders', 'Reservations', 'Tonight’s waiters', 'What the app earned', 'Team', 'Both restaurants']) {
      expect(labels, name).toContain(name);
      expect(words({ owner: true }), name).toContain(name);
    }
  });

  it('tells only the owner about Team and Both restaurants', () => {
    expect(words({ owner: true })).toMatch(/Team is under Setup\. Overview is now Both restaurants, under Home\./);
    for (const who of [{}, { wide: false }]) expect(words(who)).not.toMatch(/Team|Both restaurants|Overview/);
  });

  it('speaks of the bars on a phone and the sidebar on a laptop', () => {
    expect(words({ wide: true })).toContain('its pages are the tabs across the top');
    expect(words({ wide: true })).toContain('Press Ctrl K, or click here');
    expect(words({ wide: true, shortcut: '⌘K' })).toContain('Press ⌘K, or click here');
    expect(words({ wide: false })).toContain('Setup is under More');
    expect(words({ wide: false })).toContain('Tap the magnifier');
    expect(words({ wide: false })).toContain('Under More, in Other screens.');
    expect(words({ wide: false })).toContain('tap More, then What’s new');
    expect(words({ wide: false })).not.toMatch(/Ctrl K|click here/);
  });

  it('does not tell someone already in the Manager app to add it to the Home Screen', () => {
    expect(words({ standalone: true })).toContain('This is the Manager app.');
    expect(words({ standalone: true })).not.toContain('Add to Home Screen');
    expect(words({})).toContain('Add to Home Screen');
    for (const who of [{}, { standalone: true }]) expect(words(who)).toContain('“Alert this phone”');
  });

  it('in the demo says nothing of a layout that changed, and is called a tour', () => {
    expect(words({ demo: true })).not.toMatch(/new layout|Nothing was removed|is now|Overview/);
    expect(all({ demo: true })[1].points).toBeUndefined();
    expect(tourLabel(true)).toBe('Take the tour');
    expect(tourLabel(false)).toBe('What’s new');
    expect(words({ demo: true })).toContain('click Take the tour here');
  });

  it('points only at names the navigation carries', () => {
    const known = ['areas', 'search', 'service', 'reports', 'floor-monitor', 'more', 'whats-new'];
    for (const step of all({ owner: true })) for (const anchor of step.anchors ?? []) expect(known, `${step.id} → ${anchor}`).toContain(anchor);
    // Welcome and the iPhone have nothing on screen to point at.
    expect(all({}).filter((s) => !s.anchors).map((s) => s.id)).toEqual(['welcome', 'iphone']);
  });
});

describe('seen, once for each admin on each device', () => {
  beforeEach(() => localStorage.clear());

  it('is unseen until put away, then seen for that account only', () => {
    expect(whatsNewSeen('ana')).toBe(false);
    markWhatsNewSeen('ana');
    expect(whatsNewSeen('ana')).toBe(true);
    expect(whatsNewSeen('marco')).toBe(false);
    expect(localStorage.getItem(whatsNewKey('ana'))).toBe(WHATS_NEW_VERSION);
    expect(whatsNewKey('ana')).toBe('tf.whatsNew.ana');
  });

  it('shows again after a later update changes the version', () => {
    localStorage.setItem(whatsNewKey('ana'), '2025-01-old');
    expect(whatsNewSeen('ana')).toBe(false);
  });
});

describe('where the card goes', () => {
  const phone = { top: 0, left: 0, width: 390, height: 844 };
  const laptop = { top: 0, left: 0, width: 1440, height: 900 };
  const card = { width: 366, height: 300 };
  const inside = (at: { top: number; left: number }, frame: typeof phone) => at.left >= frame.left + 12 && at.top >= frame.top + 12
    && at.left + card.width <= frame.left + frame.width - 12 && at.top + card.height <= frame.top + frame.height - 12;
  const clear = (at: { top: number; left: number }, t: { top: number; left: number; width: number; height: number }) =>
    at.left >= t.left + t.width || t.left >= at.left + card.width || at.top >= t.top + t.height || t.top >= at.top + card.height;

  it('is in the middle with nothing to point at', () => {
    expect(placeCallout(null, card, phone)).toEqual({ left: 12, top: 272 });
    expect(placeCallout(null, card, laptop)).toEqual({ left: 537, top: 300 });
  });

  it('is above the phone’s bottom bar, and under the magnifier at the top', () => {
    const bar = { top: 781, left: -6, width: 402, height: 69 };
    const above = placeCallout(bar, card, phone);
    expect(above.top + card.height).toBeLessThanOrEqual(bar.top - 12);
    expect(inside(above, phone)).toBe(true);
    const magnifier = { top: 0, left: 334, width: 56, height: 56 };
    const below = placeCallout(magnifier, card, phone);
    expect(below.top).toBeGreaterThanOrEqual(magnifier.top + magnifier.height + 12);
    expect(inside(below, phone)).toBe(true);
  });

  it('is beside the sidebar’s things on a laptop, even the one at the very bottom', () => {
    for (const target of [{ top: 136, left: 6, width: 244, height: 252 }, { top: 201, left: 6, width: 244, height: 56 }, { top: 756, left: 6, width: 244, height: 56 }]) {
      const at = placeCallout(target, card, laptop);
      expect(at.left).toBeGreaterThanOrEqual(target.left + target.width + 12);
      expect(inside(at, laptop), JSON.stringify(at)).toBe(true);
      expect(clear(at, target)).toBe(true);
    }
  });

  it('keeps clear of the notch and the home indicator', () => {
    const safe = { top: 47, left: 0, width: 390, height: 844 - 47 - 34 };
    const more = { top: 760, left: 306, width: 90, height: 68 };
    const at = placeCallout(more, card, safe);
    expect(at.top).toBeGreaterThanOrEqual(47 + 12);
    expect(at.top + card.height).toBeLessThanOrEqual(844 - 34 - 12);
    expect(placeCallout(null, card, safe).top + card.height).toBeLessThanOrEqual(844 - 34 - 12);
  });

  it('falls back to the middle when the screen is too small for a place beside it', () => {
    const tiny = { top: 0, left: 0, width: 320, height: 420 };
    const bar = { top: 360, left: 0, width: 320, height: 60 };
    const at = placeCallout(bar, { width: 296, height: 380 }, tiny);
    expect(at).toEqual({ left: 12, top: 20 });
  });
});

describe('the search finds it', () => {
  const keywords = ['tour', 'take the tour', 'whats new', 'what is new', 'new', 'help', 'how to', 'guide', 'walkthrough'];
  it.each(['tour', 'help', 'what\'s new', 'what’s new', 'whats new', 'What\'s'])('"%s"', (query) => {
    expect(searchScore('What’s new', keywords, query)).toBeGreaterThan(0.5);
  });

  it('and a page spelled with ’ is found with the apostrophe a keyboard types', () => {
    expect(searchScore('Tonight’s waiters', [], 'tonight\'s')).toBeGreaterThan(0.9);
  });
});
