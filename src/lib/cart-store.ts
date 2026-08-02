import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { toast } from 'sonner';
import { touchSession } from '@/lib/guest-api';

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
  removeItem: (id: string) => void;
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
          items: state.items.map((i) =>
            i.id === existing.id ? { ...i, quantity: i.quantity + 1 } : i
          ),
        };
      }
      return { items: [...state.items, { ...item, id, menuItemId, notes, quantity: 1 }] };
    });
  },

  removeItem: (id) => {
    set((state) => ({ items: state.items.filter((i) => i.id !== id) }));
  },

  updateQuantity: (id, quantity) => {
    if (quantity <= 0) {
      get().removeItem(id);
      return;
    }
    if (quantity > 10) return; // Max 10 per item
    set((state) => ({
      items: state.items.map((i) => (i.id === id ? { ...i, quantity } : i)),
    }));
  },

  updateNotes: (id, notes) => {
    set((state) => ({
      items: state.items.map((i) => (i.id === id ? { ...i, notes } : i)),
    }));
  },

  clearCart: () => set({ items: [] }),

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
    });
  },

  total: () => get().items.reduce((sum, i) => sum + i.price * i.quantity, 0),

  itemCount: () => get().items.reduce((sum, i) => sum + i.quantity, 0),

  startHeartbeat: () => {
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    heartbeatInterval = setInterval(async () => {
      const { sessionId } = get();
      const { sessionToken } = get();
      if (!sessionId || !sessionToken) return;

      const isActive = await touchSession(sessionId, sessionToken).catch(() => false);

      if (!isActive) {
        get().clearCart();
        set({ sessionId: null, sessionToken: null, tableNumber: null, qrToken: null, guestName: null, pendingPayment: null });
        toast.error('Your session has expired. Please scan the QR code again.');
        if (heartbeatInterval) {
          clearInterval(heartbeatInterval);
          heartbeatInterval = null;
        }
        // Redirect to menu without session
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
    clientId: s.clientId,
  }),
}));
