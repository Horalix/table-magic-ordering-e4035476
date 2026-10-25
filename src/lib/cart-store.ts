import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { toast } from 'sonner';
import { touchSession } from '@/lib/guest-api';
import { track } from '@/lib/analytics';
import { t } from '@/lib/i18n';
import { knownPrices, unitPrice, salePrice, type ComboDef, type SaleFields } from '@/lib/promotions';
import { menuPath } from '@/lib/venues';

/** Where a cart line came from, when it came from a suggestion. */
export interface SuggestionOrigin {
  sourceItemId: string | null;
  placement: string;
  /**
   * The server-side decision that produced this suggestion.
   *
   * Carried all the way into the order line so a completed sale joins back to
   * the exact decision, policy version and experiment arm — turning "this
   * feature earned X" from an inference into a join.
   */
  decisionId?: string | null;
}

/** One part of a combo, as the guest chose it. Names travel with it, like the line's own. */
export interface CartComboComponent {
  slot_id: string;
  slot_label: string;
  slot_label_bs?: string | null;
  slot_label_ar?: string | null;
  item_id: string;
  name: string;
  name_bs?: string | null;
  name_ar?: string | null;
  /** Extra charge for this choice, already inside the line's price. */
  surcharge: number;
}

export interface CartItem {
  /** Cart-line id. For plain items this is the menu item id; special requests get a distinct line id. */
  id: string;
  /** Stable menu item id used when writing order_items.menu_item_id. */
  menuItemId?: string;
  name: string;
  /** Kept on the line so the cart reads in the guest's language, not English. */
  name_bs?: string | null;
  name_ar?: string | null;
  price: number;
  /**
   * The menu price, when the line is on sale: shown struck through next to
   * `price`. Absent when there is no sale.
   */
  regularPrice?: number;
  /** The sale's label key (happy_hour, ...) or '' for a plain sale. */
  saleLabel?: string | null;
  /** Set for a combo: what was chosen for each part. Part of the line's identity. */
  combo?: { components: CartComboComponent[] };
  quantity: number;
  notes?: string;
  image_url?: string;
  /**
   * Set when the guest added this from a suggestion. Sent at checkout so the
   * server can attribute the revenue. It never affects the price.
   */
  fromSuggestion?: SuggestionOrigin;
}

/**
 * An order that exists on the server but whose payment has not resolved.
 *
 * Persisted so that closing the tab, reloading during 3-D Secure, or losing
 * the network mid-payment recovers into the payment screen instead of an empty
 * cart — and, critically, so the guest cannot accidentally place the same
 * order twice while the first one is still in flight.
 */
export interface PendingPayment {
  orderId: string;
  orderCode: string;
  total: number;
  createdAt: number;
}

interface CartStore {
  items: CartItem[];
  tableNumber: number | null;
  qrToken: string | null;
  sessionToken: string | null;
  sessionId: string | null;
  guestName: string | null;
  lastOrderTime: number | null;
  pendingPayment: PendingPayment | null;
  /**
   * Idempotency key for the checkout in progress. Created on the first attempt
   * and reused by every retry of it, so a request that committed but whose
   * response was lost cannot become a second ticket. Any change to the cart
   * retires it: a different cart is a different order.
   */
  checkoutKey: string | null;
  /** Lines the server refused because they sold out or are out of hours. */
  unavailableIds: string[];
  /** Stable per-device id — identifies this phone across reloads (join flow). */
  clientId: string;
  /**
   * Issue a new device identifier.
   *
   * Part of "forget this device": without it the server would forget the old
   * id and the phone would immediately start rebuilding the same profile under
   * it on the next visit, which would make the deletion cosmetic.
   */
  rotateClientId: () => void;
  addItem: (item: Omit<CartItem, 'quantity'>) => void;
  /** `source` says which control removed it, for the cart-abandon metric. */
  removeItem: (id: string, source?: string) => void;
  beginCheckout: () => string;
  finishCheckout: () => void;
  setUnavailable: (menuItemIds: string[]) => void;
  /**
   * Refresh prices and names from the live menu, at `at`: sales that started
   * or ended, combo surcharges. Returns true if a price moved.
   */
  reprice: (menu: RepriceRow[], combos?: ComboDef[] | null, at?: number) => boolean;
  /**
   * Take the prices the server quoted when it refused an order because the
   * screen was out of date ('Prices changed'). `lineIds` is the cart as it
   * was sent, so `line` indexes into it.
   */
  applyServerPrices: (changes: ServerPriceChange[], lineIds: string[]) => void;
  updateQuantity: (id: string, quantity: number) => void;
  updateNotes: (id: string, notes: string) => void;
  clearCart: () => void;
  setTable: (tableNumber: number, token: string) => void;
  setSessionId: (id: string) => void;
  setSession: (id: string, token: string) => void;
  setGuestName: (name: string) => void;
  setLastOrderTime: () => void;
  setPendingPayment: (pending: PendingPayment | null) => void;
  /** Forget the table entirely — the visit is over. */
  endVisit: () => void;
  /**
   * Stop being at this table but keep what is in the cart. Used when a guest
   * says they are at a different table: their unsent order is still what they
   * want, and the cart page re-prices it against the live menu anyway.
   */
  leaveTable: () => void;
  total: () => number;
  itemCount: () => number;
  startHeartbeat: () => void;
  stopHeartbeat: () => void;
}

export type RepriceRow = SaleFields & { id: string; price: number | string; name: string; name_bs?: string | null; name_ar?: string | null };

export interface ServerPriceChange {
  line: number;
  menu_item_id: string;
  unit_price: number;
  regular_unit_price?: number;
}

let heartbeatInterval: ReturnType<typeof setInterval> | null = null;

const genId = (): string => {
  try {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  } catch { /* fall through */ }
  return `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
};

const normalizeNotes = (notes?: string): string | undefined => {
  const trimmed = notes?.trim();
  return trimmed ? trimmed : undefined;
};

const getMenuItemId = (item: Pick<CartItem, 'id' | 'menuItemId'>): string => item.menuItemId ?? item.id;

/** The chosen dishes of a combo line, as part of its identity. */
const comboKey = (combo?: CartItem['combo']): string =>
  combo ? combo.components.map((c) => `${c.slot_id}=${c.item_id}`).join('&') : '';

const buildCartLineId = (menuItemId: string, notes?: string, combo?: CartItem['combo']): string => {
  const key = comboKey(combo);
  const base = key ? `${menuItemId}::combo:${key}` : menuItemId;
  if (!notes) return base;
  return `${base}::${encodeURIComponent(notes.toLowerCase())}`;
};

const toCents = (n: number) => Math.round(n * 100);

/**
 * The price a plain line is added at: the latest sale data seen for the dish
 * if there is any (see the price book in promotions.ts), else what the button
 * that added it said. Combos are priced by the sheet that built them.
 */
const livePricing = (item: Pick<CartItem, 'price' | 'regularPrice' | 'saleLabel' | 'combo'>, menuItemId: string) => {
  const given = { price: item.price, regularPrice: item.regularPrice, saleLabel: item.saleLabel };
  if (item.combo) return given;
  const known = knownPrices(menuItemId);
  if (!known) return given;
  const sale = salePrice(known);
  return sale === null
    ? { price: Number(known.price), regularPrice: undefined, saleLabel: undefined }
    : { price: sale, regularPrice: Number(known.price), saleLabel: known.sale_label ?? '' };
};

export const useCartStore = create<CartStore>()(persist((set, get) => ({
  items: [],
  tableNumber: null,
  qrToken: null,
  sessionToken: null,
  sessionId: null,
  guestName: null,
  lastOrderTime: null,
  pendingPayment: null,
  checkoutKey: null,
  unavailableIds: [],
  clientId: genId(),
  rotateClientId: () => set({ clientId: genId() }),

  addItem: (item) => {
    set((state) => {
      const notes = normalizeNotes(item.notes);
      const menuItemId = item.menuItemId ?? item.id;
      const id = buildCartLineId(menuItemId, notes, item.combo);
      const existing = state.items.find((i) => getMenuItemId(i) === menuItemId
        && normalizeNotes(i.notes) === notes && comboKey(i.combo) === comboKey(item.combo));
      if (existing) {
        // Silently capping at 10 made the eleventh tap look broken.
        if (existing.quantity >= 10) toast(t('max_quantity_reached'));
        return {
          checkoutKey: null,
          items: state.items.map((i) =>
            i.id === existing.id ? { ...i, quantity: Math.min(i.quantity + 1, 10) } : i
          ),
        };
      }
      const pricing = livePricing(item, menuItemId);
      return { checkoutKey: null, items: [...state.items, { ...item, ...pricing, id, menuItemId, notes, quantity: 1 }] };
    });
  },

  // Every way a line leaves the cart goes through here, so the removal is
  // tracked once. Stepping a quantity down to zero used to vanish silently.
  removeItem: (id, source = 'cart') => {
    const line = get().items.find((i) => i.id === id);
    if (line) track('cart_item_removed', { item_id: getMenuItemId(line), quantity: line.quantity, source });
    set((state) => ({
      checkoutKey: null,
      items: state.items.filter((i) => i.id !== id),
      unavailableIds: line ? state.unavailableIds.filter((u) => u !== getMenuItemId(line)) : state.unavailableIds,
    }));
  },

  beginCheckout: () => {
    const existing = get().checkoutKey;
    if (existing) return existing;
    const key = genId();
    set({ checkoutKey: key });
    return key;
  },

  finishCheckout: () => set({ checkoutKey: null, unavailableIds: [] }),

  setUnavailable: (menuItemIds) => set({ unavailableIds: menuItemIds }),

  reprice: (menu, combos, at = Date.now()) => {
    const byId = new Map(menu.map((m) => [m.id, m]));
    const comboById = new Map((combos ?? []).map((c) => [c.combo_item_id, c]));
    let moved = false;
    const items = get().items.map((line) => {
      const live = byId.get(getMenuItemId(line));
      if (!live) return line;
      let surcharge = 0;
      let components = line.combo?.components;
      if (line.combo) {
        // Surcharges from the live combo when it is known; the ones the line
        // was added with otherwise. A choice that is no longer on offer keeps
        // its old surcharge here: the server refuses that line and names it.
        const def = comboById.get(getMenuItemId(line));
        components = line.combo.components.map((c) => {
          const opt = def?.slots.find((s) => s.id === c.slot_id)?.options.find((o) => o.item_id === c.item_id);
          return opt ? { ...c, surcharge: Number(opt.surcharge) } : c;
        });
        surcharge = components.reduce((sum, c) => sum + toCents(c.surcharge), 0) / 100;
      }
      const sale = salePrice(live, at);
      const price = (toCents(unitPrice(live, at)) + toCents(surcharge)) / 100;
      const regular = (toCents(Number(live.price)) + toCents(surcharge)) / 100;
      if (toCents(price) !== toCents(line.price)) moved = true;
      return {
        ...line,
        price,
        regularPrice: sale === null ? undefined : regular,
        saleLabel: sale === null ? undefined : (live.sale_label ?? ''),
        ...(line.combo ? { combo: { components: components ?? [] } } : {}),
        name: live.name,
        name_bs: live.name_bs ?? null,
        name_ar: live.name_ar ?? null,
      };
    });
    set(moved ? { items, checkoutKey: null } : { items });
    return moved;
  },

  applyServerPrices: (changes, lineIds) => {
    const byLine = new Map<string, ServerPriceChange>();
    for (const change of changes) {
      const id = lineIds[change.line];
      if (id) byLine.set(id, change);
    }
    if (byLine.size === 0) return;
    set((state) => ({
      checkoutKey: null,
      items: state.items.map((line) => {
        const change = byLine.get(line.id);
        if (!change || getMenuItemId(line) !== change.menu_item_id) return line;
        const price = Number(change.unit_price);
        const regular = change.regular_unit_price != null ? Number(change.regular_unit_price) : undefined;
        const onSale = regular !== undefined && toCents(regular) > toCents(price);
        return {
          ...line,
          price,
          regularPrice: onSale ? regular : undefined,
          saleLabel: onSale ? (line.saleLabel ?? '') : undefined,
        };
      }),
    }));
  },

  updateQuantity: (id, quantity) => {
    if (quantity <= 0) {
      get().removeItem(id);
      return;
    }
    if (quantity > 10) { toast(t('max_quantity_reached')); return; } // Max 10 per item
    set((state) => ({
      checkoutKey: null,
      items: state.items.map((i) => (i.id === id ? { ...i, quantity } : i)),
    }));
  },

  updateNotes: (id, notes) => {
    set((state) => ({
      items: state.items.map((i) => (i.id === id ? { ...i, notes } : i)),
    }));
  },

  clearCart: () => set({ items: [], checkoutKey: null, unavailableIds: [] }),

  setTable: (tableNumber, token) => set({ tableNumber, qrToken: token, sessionId: null, sessionToken: null }),

  setSessionId: (id) => set({ sessionId: id }),

  setSession: (id, token) => set({ sessionId: id, sessionToken: token }),

  setGuestName: (name) => set({ guestName: name }),

  setLastOrderTime: () => set({ lastOrderTime: Date.now() }),

  setPendingPayment: (pendingPayment) => set({ pendingPayment }),

  /**
   * End the visit on this device.
   *
   * Clears the cart too: carrying a half-built order from last week's table
   * into a new visit is worse than starting empty, and the prices may have
   * changed. Does NOT close the server session — other phones may still be on
   * that table and the tab must survive one guest pocketing their phone.
   */
  endVisit: () => {
    get().stopHeartbeat();
    try { sessionStorage?.removeItem('lasoul-session-checked'); } catch { /* not available */ }
    set({
      items: [],
      sessionId: null,
      sessionToken: null,
      tableNumber: null,
      qrToken: null,
      guestName: null,
      pendingPayment: null,
      checkoutKey: null,
      unavailableIds: [],
    });
  },

  leaveTable: () => {
    get().stopHeartbeat();
    try { sessionStorage?.removeItem('lasoul-session-checked'); } catch { /* not available */ }
    set({ sessionId: null, sessionToken: null, tableNumber: null, guestName: null, pendingPayment: null, checkoutKey: null });
  },

  // In cents: 3 x 14.40 is 43.199999... in floating point.
  total: () => get().items.reduce((sum, i) => sum + toCents(i.price) * i.quantity, 0) / 100,

  itemCount: () => get().items.reduce((sum, i) => sum + i.quantity, 0),

  startHeartbeat: () => {
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    heartbeatInterval = setInterval(async () => {
      const { sessionId } = get();
      const { sessionToken } = get();
      if (!sessionId || !sessionToken) return;

      // A failed request is NOT an expired session. Restaurant Wi-Fi drops
      // requests all evening, and treating every blip as "session over" wiped
      // carts mid-order. Only the server saying "no" ends the visit.
      let isActive: boolean;
      try {
        isActive = await touchSession(sessionId, sessionToken);
      } catch {
        return;
      }

      if (!isActive) {
        // The cart stays: the guest may simply rescan and send it. Only the
        // table identity is dropped, because the server no longer honours it.
        set({ sessionId: null, sessionToken: null, tableNumber: null, qrToken: null, guestName: null, pendingPayment: null, checkoutKey: null });
        toast.error(t('session_expired'));
        if (heartbeatInterval) {
          clearInterval(heartbeatInterval);
          heartbeatInterval = null;
        }
        window.location.href = menuPath();
      }
    }, 60000);
  },

  stopHeartbeat: () => {
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    }
  },
}), {
  name: 'lasoul-cart',
  // Persist session identity + cart so a refresh doesn't drop the table
  // (which previously blocked re-ordering). clientId stays stable per device.
  partialize: (s) => ({
    items: s.items,
    tableNumber: s.tableNumber,
    qrToken: s.qrToken,
    sessionToken: s.sessionToken,
    sessionId: s.sessionId,
    guestName: s.guestName,
    lastOrderTime: s.lastOrderTime,
    pendingPayment: s.pendingPayment,
    checkoutKey: s.checkoutKey,
    clientId: s.clientId,
  }),
}));
