import { create } from 'zustand';

/**
 * Add-to-order feedback, as events.
 *
 * Every "add" button in the guest app (menu rows, search, order-again, the
 * dish sheet, suggestions) calls `emitAdd` right after `addItem`. Two things
 * listen:
 *
 *  - FlyToCart flies a small copy of the dish photo from the tap to the bag
 *    icon in the CartBar (or, when no CartBar is on screen, shows a short
 *    toast instead);
 *  - CartBar swaps its label to "+ {name}" for a moment and announces the
 *    new count and total to screen readers.
 *
 * This replaced a toast per add: it covered the top of the menu, said the
 * same thing every time, and never told the guest where the dish went.
 */

export interface AddEvent {
  /** Menu item id. Used to find the local photo when there is one. */
  id?: string;
  /** Remote photo, when the item has no local one. */
  imageUrl?: string | null;
  /** Where the tap happened. Without it there is no flight, only the label. */
  from?: DOMRect | null;
  /** The dish name as the guest reads it (already localised). */
  name: string;
  /** Hold the flight back, e.g. until a closing sheet is out of the way. */
  delayMs?: number;
}

export interface Flight extends AddEvent {
  key: number;
}

/** How long CartBar shows "+ {name}" instead of "View order". */
export const ADDED_LABEL_MS = 1200;

interface CartFxState {
  seq: number;
  /** The latest add, for the CartBar label and its announcement. */
  lastAdd: { key: number; name: string; at: number } | null;
  /** Flights waiting for FlyToCart to pick them up. */
  queue: Flight[];
  /** Bumped when a flight reaches the bag, so the bag can pulse. */
  landed: number;
  emitAdd: (event: AddEvent) => number;
  take: (key: number) => void;
  land: () => void;
}

export const useCartFx = create<CartFxState>((set, get) => ({
  seq: 0,
  lastAdd: null,
  queue: [],
  landed: 0,
  emitAdd: (event) => {
    const key = get().seq + 1;
    set((s) => ({
      seq: key,
      lastAdd: { key, name: event.name, at: Date.now() },
      queue: [...s.queue, { ...event, key }],
    }));
    return key;
  },
  take: (key) => set((s) => ({ queue: s.queue.filter((f) => f.key !== key) })),
  land: () => set((s) => ({ landed: s.landed + 1 })),
}));

/**
 * Report an add. Safe to call from anywhere, including outside React:
 *
 *   addItem(...);
 *   emitAdd({ id: item.id, imageUrl: item.image_url, from: button.getBoundingClientRect(), name });
 */
export const emitAdd = (event: AddEvent) => useCartFx.getState().emitAdd(event);
