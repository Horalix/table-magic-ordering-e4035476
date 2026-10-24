import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { toast } from 'sonner';
import { touchSession } from '@/lib/guest-api';
import { track } from '@/lib/analytics';
import { t } from '@/lib/i18n';

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
  /** Refresh prices and names from the live menu; returns true if a price moved. */
  reprice: (menu: { id: string; price: number; name: string; name_bs?: string | null; name_ar?: string | null }[]) => boolean;
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

const buildCartLineId = (menuItemId: string, notes?: string): string => {
  if (!notes) return menuItemId;
  return `${menuItemId}::${encodeURIComponent(notes.toLowerCase())}`;
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
      const id = buildCartLineId(menuItemId, notes);
      const existing = state.items.find((i) => getMenuItemId(i) === menuItemId && normalizeNotes(i.notes) === notes);
      if (existing) {
        return {
          checkoutKey: null,
          items: state.items.map((i) =>
            i.id === existing.id ? { ...i, quantity: Math.min(i.quantity + 1, 10) } : i
          ),
        };
      }
      return { checkoutKey: null, items: [...state.items, { ...item, id, menuItemId, notes, quantity: 1 }] };
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

  reprice: (menu) => {
    const byId = new Map(menu.map((m) => [m.id, m]));
    let moved = false;
    const items = get().items.map((line) => {
      const live = byId.get(getMenuItemId(line));
      if (!live) return line;
      if (Number(live.price) !== line.price) moved = true;
      return { ...line, price: Number(live.price), name: live.name, name_bs: live.name_bs ?? null, name_ar: live.name_ar ?? null };
    });
    set(moved ? { items, checkoutKey: null } : { items });
    return moved;
  },

  updateQuantity: (id, quantity) => {
    if (quantity <= 0) {
      get().removeItem(id);
      return;
    }
    if (quantity > 10) return; // Max 10 per item
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

  total: () => get().items.reduce((sum, i) => sum + i.price * i.quantity, 0),

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
        window.location.href = '/menu';
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
