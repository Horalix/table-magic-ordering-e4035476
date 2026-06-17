import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface CartItem {
  id: string;
  name: string;
  price: number;
  quantity: number;
  notes?: string;
  image_url?: string;
}

interface CartStore {
  items: CartItem[];
  tableNumber: number | null;
  sessionToken: string | null;
  sessionId: string | null;
  guestName: string | null;
  lastOrderTime: number | null;
  /** Stable per-device id — identifies this phone across reloads (join flow). */
  clientId: string;
  addItem: (item: Omit<CartItem, 'quantity'>) => void;
  removeItem: (id: string) => void;
  updateQuantity: (id: string, quantity: number) => void;
  updateNotes: (id: string, notes: string) => void;
  clearCart: () => void;
  setTable: (tableNumber: number, token: string) => void;
  setSessionId: (id: string) => void;
  setGuestName: (name: string) => void;
  setLastOrderTime: () => void;
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

export const useCartStore = create<CartStore>()(persist((set, get) => ({
  items: [],
  tableNumber: null,
  sessionToken: null,
  sessionId: null,
  guestName: null,
  lastOrderTime: null,
  clientId: genId(),

  addItem: (item) => {
    set((state) => {
      const existing = state.items.find((i) => i.id === item.id);
      if (existing) {
        return {
          items: state.items.map((i) =>
            i.id === item.id ? { ...i, quantity: i.quantity + 1 } : i
          ),
        };
      }
      return { items: [...state.items, { ...item, quantity: 1 }] };
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

  setTable: (tableNumber, token) => set({ tableNumber, sessionToken: token }),

  setSessionId: (id) => set({ sessionId: id }),

  setGuestName: (name) => set({ guestName: name }),

  setLastOrderTime: () => set({ lastOrderTime: Date.now() }),

  total: () => get().items.reduce((sum, i) => sum + i.price * i.quantity, 0),

  itemCount: () => get().items.reduce((sum, i) => sum + i.quantity, 0),

  startHeartbeat: () => {
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    heartbeatInterval = setInterval(async () => {
      const { sessionId } = get();
      if (!sessionId) return;

      const { data, error } = await supabase
        .from('table_sessions')
        .select('is_active')
        .eq('id', sessionId)
        .single();

      if (error || !data?.is_active) {
        get().clearCart();
        set({ sessionId: null, sessionToken: null, tableNumber: null, guestName: null });
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
    sessionToken: s.sessionToken,
    sessionId: s.sessionId,
    guestName: s.guestName,
    lastOrderTime: s.lastOrderTime,
    clientId: s.clientId,
  }),
}));
