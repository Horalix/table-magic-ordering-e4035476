import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useCartStore } from '@/lib/cart-store';
import { t } from '@/lib/i18n';
import { unorderableReason } from '@/lib/availability';
import {
  isNew, nextPriceChange, rememberPrices, saleView,
  type ComboDef,
} from '@/lib/promotions';
import type { Database } from '@/integrations/supabase/types';

/**
 * The promotion columns added by 20261026100000 — optional, so the app
 * typechecks against a database that has not been given that migration yet,
 * matching the runtime code that treats their absence as "no promotion".
 * When the migration is applied and the types regenerate, this stays true.
 */
export type PromoColumns = {
  sale_kind?: string | null;
  sale_value?: number | string | null;
  sale_starts_at?: string | null;
  sale_ends_at?: string | null;
  sale_label?: string | null;
  new_until?: string | null;
  featured_rank?: number | null;
  featured_note?: string | null;
  featured_note_bs?: string | null;
  featured_note_ar?: string | null;
};

export type MenuItemRow = Database['public']['Tables']['menu_items']['Row'] & PromoColumns;

/**
 * Every combo with its parts and choices.
 *
 * `null` when it could not be read — a dropped request, or a database that
 * has not been given 20261026100000 yet. Callers treat null as "unknown"
 * rather than "there are no combos", so a cart never loses a surcharge to a
 * failed request.
 */
export async function fetchCombos(): Promise<ComboDef[] | null> {
  // Not in the generated types until 20261026100000 is applied; the runtime
  // answer (error → null) is already the safe path for a missing RPC.
  const { data, error } = await supabase.rpc('guest_get_combos' as never);
  if (error) return null;
  return Array.isArray(data) ? (data as unknown as ComboDef[]) : [];
}

export function useCombos(enabled = true) {
  return useQuery({
    queryKey: ['combos'],
    queryFn: fetchCombos,
    staleTime: 5 * 60 * 1000,
    retry: 1,
    enabled,
  });
}

/** Combos by their dish id. Empty while loading or when there are none. */
export function useComboMap(enabled = true) {
  const { data } = useCombos(enabled);
  return useMemo(() => new Map((data ?? []).map((c) => [c.combo_item_id, c])), [data]);
}

/**
 * Everything the home screen promotes: featured dishes, running sales, new
 * dishes and combos — full rows, so a card opens straight into the dish sheet
 * with its allergens.
 *
 * One read, filtered on the server where it can be. A database without the
 * promotion columns answers with an error; the rows are then simply absent.
 */
export function usePromotedItems() {
  const combos = useCombos();
  const comboIds = useMemo(() => (combos.data ?? []).map((c) => c.combo_item_id).sort(), [combos.data]);
  const query = useQuery({
    queryKey: ['promoted-items', comboIds.join(',')],
    queryFn: async (): Promise<MenuItemRow[]> => {
      const filters = ['featured_rank.not.is.null', 'sale_kind.not.is.null', 'merchandising_tags.cs.{new}'];
      if (comboIds.length > 0) filters.push(`id.in.(${comboIds.join(',')})`);
      const { data, error } = await supabase.from('menu_items').select('*').or(filters.join(',')).order('sort_order');
      if (error) return [];
      rememberPrices(data);
      return data ?? [];
    },
    enabled: !combos.isLoading,
    staleTime: 2 * 60 * 1000,
  });

  const rows = query.data;
  const [now, setNow] = useState(() => Date.now());
  // A sale that starts or ends while the home screen is open changes the rows.
  useEffect(() => {
    const next = nextPriceChange(rows ?? [], Date.now());
    if (next === null) return;
    const timer = setTimeout(() => setNow(Date.now()), Math.min(next - Date.now() + 250, 2 ** 31 - 1));
    return () => clearTimeout(timer);
  }, [rows, now]);

  return useMemo(() => {
    const all = rows ?? [];
    const comboSet = new Set(comboIds);
    const featured = all
      .filter((r) => r.featured_rank != null)
      .sort((a, b) => Number(a.featured_rank) - Number(b.featured_rank))
      .slice(0, 3);
    return {
      loaded: query.isFetched,
      all,
      featured,
      offers: all.filter((r) => r.is_available && saleView(r, now) !== null),
      fresh: all.filter((r) => r.is_available && isNew(r, now)),
      combos: all.filter((r) => r.is_available && comboSet.has(r.id)),
      now,
    };
  }, [rows, comboIds, query.isFetched, now]);
}

/**
 * Keep the cart's prices true while the guest is ordering.
 *
 * Mounted wherever the cart is visible (the cart bar on the menu, the cart
 * page). Re-reads the dishes in the cart, re-prices them (a sale that started
 * or ended, a price the owner changed, a combo surcharge), marks what can no
 * longer be ordered, and wakes up again exactly when the next sale in the cart
 * starts or ends. The server refuses an order whose prices the guest did not
 * see, so this is about never getting that far.
 */
export function useCartLivePrices() {
  const items = useCartStore((s) => s.items);
  const reprice = useCartStore((s) => s.reprice);
  const setUnavailable = useCartStore((s) => s.setUnavailable);
  const queryClient = useQueryClient();

  const idsKey = [...new Set(items.map((i) => i.menuItemId ?? i.id))].sort().join(',');
  const hasCombo = items.some((i) => i.combo);
  const combos = useCombos(hasCombo);

  const { data: rows } = useQuery({
    queryKey: ['cart-live-prices', idsKey],
    queryFn: async () => {
      // Every column: before 20261026100000 the sale columns do not exist, and
      // naming them would turn a missing feature into a broken cart.
      const { data, error } = await supabase.from('menu_items').select('*').in('id', idsKey.split(','));
      if (error) throw error;
      return data ?? [];
    },
    enabled: idsKey.length > 0,
    staleTime: 30 * 1000,
    refetchOnWindowFocus: true,
    retry: 1,
  });

  const [tick, setTick] = useState(0);
  const comboDefs = hasCombo ? combos.data ?? null : null;

  useEffect(() => {
    if (!rows || rows.length === 0) return;
    rememberPrices(rows);
    const now = Date.now();
    if (reprice(rows, comboDefs, now)) {
      toast.info(t('prices_updated'));
      // The page behind the cart may still be showing the old price.
      void queryClient.invalidateQueries({ queryKey: ['menu_items_all'] });
      void queryClient.invalidateQueries({ queryKey: ['promoted-items'] });
    }

    const blocked: string[] = rows.filter((r) => unorderableReason(r) !== null).map((r) => r.id);
    // A combo whose chosen drink has sold out: only that line, by its own id.
    for (const line of useCartStore.getState().items) {
      if (!line.combo || !comboDefs) continue;
      const def = comboDefs.find((c) => c.combo_item_id === (line.menuItemId ?? line.id));
      const gone = line.combo.components.some((c) => {
        const opt = def?.slots.find((s) => s.id === c.slot_id)?.options.find((o) => o.item_id === c.item_id);
        return !opt || unorderableReason(opt) !== null;
      });
      if (gone) blocked.push(line.id);
    }
    setUnavailable(blocked);

    const next = nextPriceChange(rows, now);
    if (next === null) return;
    const timer = setTimeout(() => setTick((n) => n + 1), Math.min(next - now + 500, 2 ** 31 - 1));
    return () => clearTimeout(timer);
    // `tick` re-runs this at a sale boundary with the same rows.
  }, [rows, comboDefs, tick, reprice, setUnavailable, queryClient]);
}
