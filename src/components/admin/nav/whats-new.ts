import { WHATS_NEW_VERSION, whatsNewKey } from './whats-new-version';

/**
 * "What's new": a one-minute walkthrough of the admin, shown once to each
 * admin on each device after the navigation was rebuilt (November 2026), and
 * there again whenever they ask for it (the account area, More on a phone,
 * or "tour" in the search).
 *
 * This file is what it says and where it points; WhatsNewTour.tsx draws it.
 * Each step points at the real thing on the screen in hand, found by a
 * `data-tour` name the navigation's own files carry, and falls back to a
 * card in the middle where that thing is not on this screen.
 *
 * Words: what a manager needs to find their way, in the admin's own voice.
 * Keep every step true of the app as shipped; a tour that describes a button
 * that is not there teaches people to stop reading.
 */

/** Has this account been through (or put away) the current walkthrough on this device? */
export function whatsNewSeen(userId: string): boolean {
  try {
    return localStorage.getItem(whatsNewKey(userId)) === WHATS_NEW_VERSION;
  } catch {
    // Storage off: it cannot be remembered, so it is not shown at every sign-in either.
    return true;
  }
}

export function markWhatsNewSeen(userId: string): void {
  try {
    localStorage.setItem(whatsNewKey(userId), WHATS_NEW_VERSION);
  } catch {
    // Storage off or full: nothing to remember it in.
  }
}

export interface TourAudience {
  /** The owner also has Team and Both restaurants. */
  owner: boolean;
  /** A laptop or wider: the sidebar. Otherwise the phone's bars. */
  wide: boolean;
  /** The offline demo: a prospect never saw the old layout, so nothing is "new". */
  demo: boolean;
  /** Opened from the Home Screen: already the Manager app. */
  standalone: boolean;
  /** "Ctrl K" or "⌘K", for this keyboard. */
  shortcut: string;
}

export interface TourStep {
  id: string;
  title: string;
  body: string;
  /** Short lines under the body, one fact each. */
  points?: string[];
  /** A last line, set apart. */
  note?: string;
  /**
   * What to point at: `data-tour` names, the first that is on screen wins.
   * None, or none on this screen, and the step is a card in the middle.
   */
  anchors?: string[];
}

/** What the walkthrough is called where it is offered. */
export const tourLabel = (demo: boolean) => (demo ? 'Take the tour' : 'What’s new');

export function tourSteps({ owner, wide, demo, standalone, shortcut }: TourAudience): TourStep[] {
  const steps: TourStep[] = [
    demo
      ? {
        id: 'welcome',
        title: 'A quick tour of the admin',
        body: 'Everything a manager does is here, sorted into five areas by what they are doing. This takes a minute.',
      }
      : {
        id: 'welcome',
        title: 'The admin has a new layout',
        body: 'Nothing was removed. Every page is still here, sorted into five areas by what you are doing. This takes a minute.',
      },
    {
      id: 'areas',
      title: 'Five areas',
      body: wide
        ? 'Home, Service, Menu, Reports and Setup. Open one, and its pages are the tabs across the top.'
        : 'Home, Service, Menu and Reports are in this bar, and Setup is under More. Open one, and its pages are the row at the top.',
      points: demo ? undefined : [
        'Menu is now Dishes, under Menu.',
        'Daily report, Analytics and Audit log are under Reports.',
        'Tables, QR codes, Floor sections, Waiters and Printing are under Setup.',
        ...(owner ? ['Team is under Setup. Overview is now Both restaurants, under Home.'] : []),
      ],
      anchors: ['areas'],
    },
    {
      id: 'search',
      title: 'Find anything',
      body: wide
        ? `Press ${shortcut}, or click here, and type what you want: “printer”, “PIN”, “refund”. It takes you to the page.`
        : 'Tap the magnifier and type what you want: “printer”, “PIN”, “refund”. It takes you to the page.',
      anchors: ['search'],
    },
    {
      id: 'service',
      title: 'Service',
      body: 'What is happening now, in three pages.',
      points: [
        'Orders: find one by its code or its table.',
        'Reservations: requests waiting for you come first, to Confirm or Decline.',
        'Tonight’s waiters: who has which section.',
      ],
      note: 'A number on Service is guests waiting for an answer about a table.',
      anchors: ['service'],
    },
    {
      id: 'iphone',
      title: 'On your iPhone',
      body: standalone
        ? 'This is the Manager app. Open Service, then Reservations, and turn on “Alert this phone”: it rings when a guest asks for a table, even with the phone locked.'
        : 'In Safari, tap Share, then Add to Home Screen: the admin becomes the Manager app. Then open Service, then Reservations, and turn on “Alert this phone”. It rings when a guest asks for a table.',
    },
    {
      id: 'floor',
      title: 'The floor monitor',
      body: `${wide ? 'Under Other screens.' : 'Under More, in Other screens.'} A taken table is a solid tile and a free one an outline. A colour says what a table needs: Calling, Bill, Food up or Late.`,
      anchors: ['floor-monitor', 'more'],
    },
    {
      id: 'earned',
      title: 'What the app earned',
      body: 'Under Reports. It says what ordering from the table brought in, and “Are suggestions earning?” measures the extra margin the menu’s suggestions bring.',
      anchors: ['reports'],
    },
    {
      id: 'done',
      title: 'That is the tour',
      body: wide
        ? `To see it again, click ${tourLabel(demo)} here, or type “tour” in the search.`
        : `To see it again, tap More, then ${tourLabel(demo)}, or type “tour” in the search.`,
      anchors: ['whats-new', 'more'],
    },
  ];
  return steps;
}

export interface Box { top: number; left: number; width: number; height: number }

const GAP = 14;
const MARGIN = 12;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, Math.max(min, max)));

/**
 * Where the step's card goes, given the thing it points at.
 *
 * Beside it on a laptop (the sidebar's things), above it when it is in the
 * lower half (the phone's bottom bar), below it when it is at the top (the
 * magnifier); in the middle when there is nothing to point at, or no room.
 * Always inside `frame`: the screen less the notch and the home indicator.
 */
export function placeCallout(target: Box | null, card: { width: number; height: number }, frame: Box): { top: number; left: number } {
  const right = frame.left + frame.width;
  const bottom = frame.top + frame.height;
  const centred = {
    top: clamp(frame.top + (frame.height - card.height) / 2, frame.top + MARGIN, bottom - MARGIN - card.height),
    left: clamp(frame.left + (frame.width - card.width) / 2, frame.left + MARGIN, right - MARGIN - card.width),
  };
  if (!target) return centred;
  const across = (left: number) => clamp(left, frame.left + MARGIN, right - MARGIN - card.width);
  const down = (top: number) => clamp(top, frame.top + MARGIN, bottom - MARGIN - card.height);
  const targetRight = target.left + target.width;
  const targetBottom = target.top + target.height;
  // Beside it: only for something narrow at the side, with room for the whole card.
  if (target.width < frame.width / 2 && targetRight + GAP + card.width <= right - MARGIN && targetRight < frame.left + frame.width / 2) {
    return { left: targetRight + GAP, top: down(target.top + Math.min(0, (target.height - card.height) / 2)) };
  }
  const middle = target.left + target.width / 2 - card.width / 2;
  const roomAbove = target.top - GAP - card.height >= frame.top + MARGIN;
  const roomBelow = targetBottom + GAP + card.height <= bottom - MARGIN;
  const low = target.top + target.height / 2 > frame.top + frame.height / 2;
  if (low && roomAbove) return { left: across(middle), top: target.top - GAP - card.height };
  if (roomBelow) return { left: across(middle), top: targetBottom + GAP };
  if (roomAbove) return { left: across(middle), top: target.top - GAP - card.height };
  return centred;
}
