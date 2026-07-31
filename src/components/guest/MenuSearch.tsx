import React, { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, X, Plus } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useT, useLanguageStore, getLocalizedName, getLocalizedDescription } from '@/lib/i18n';
import { useCartStore } from '@/lib/cart-store';
import SmartImage from '@/components/ui/SmartImage';
import { track } from '@/lib/analytics';

interface SearchRow {
  id: string;
  name: string;
  name_bs: string | null;
  name_ar: string | null;
  description: string | null;
  description_bs: string | null;
  description_ar: string | null;
  price: number;
  image_url: string | null;
  dietary_tags: string[];
  merchandising_tags: string[];
  is_available: boolean;
  subcategory_id: string;
  category_name: string;
}

interface Props {
  /** Only show the quick-add button when the guest has a table session. */
  canOrder: boolean;
}

/**
 * Global menu search.
 *
 * Category-scoped search already exists inside a category; this is the one a
 * guest actually reaches for — "where is the water?" — from the landing page,
 * across every category and all three languages.
 *
 * Sold-out matches are shown rather than hidden: a guest who searched for a
 * dish deserves to be told it is unavailable instead of concluding the search
 * is broken. They simply cannot be added.
 */
const MenuSearch = ({ canOrder }: Props) => {
  const t = useT();
  const locale = useLanguageStore((s) => s.locale);
  const addItem = useCartStore((s) => s.addItem);
  const [query, setQuery] = useState('');
  const deferred = useDeferredValue(query);
  const trimmed = deferred.trim();

  const { data = [], isFetching } = useQuery({
    queryKey: ['menu-search', trimmed, locale],
    queryFn: async (): Promise<SearchRow[]> => {
      const { data: rows, error } = await supabase.rpc('guest_search_menu' as never, {
        _query: trimmed,
        _limit: 20,
      } as never);
      if (error) return [];
      return ((rows ?? []) as SearchRow[]).map((r) => ({ ...r, price: Number(r.price) }));
    },
    enabled: trimmed.length >= 2,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (trimmed.length < 2 || isFetching) return;
    track(data.length === 0 ? 'search_no_results' : 'search_performed', { length: trimmed.length, results: data.length });
  }, [trimmed, isFetching, data.length]);

  const grouped = useMemo(() => data, [data]);
  const active = trimmed.length >= 2;

  return (
    <div className="mb-3">
      <div className="relative">
        <Search className="w-4 h-4 text-muted-foreground absolute top-1/2 -translate-y-1/2 start-4 pointer-events-none" aria-hidden />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('search_placeholder')}
          aria-label={t('search')}
          className="w-full h-12 rounded-2xl border border-border bg-card ps-11 pe-11 font-sans text-[15px] text-foreground placeholder:text-muted-foreground/70 outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        />
        {query && (
          <button
            onClick={() => setQuery('')}
            aria-label={t('clear_filters')}
            className="absolute top-1/2 -translate-y-1/2 end-2 w-9 h-9 rounded-full grid place-items-center text-muted-foreground hover:bg-muted transition-colors"
          >
            <X className="w-4 h-4" aria-hidden />
          </button>
        )}
      </div>

      {active && (
        <div className="mt-2" aria-live="polite">
          {grouped.length === 0 && !isFetching ? (
            <div className="py-8 text-center">
              <p className="font-serif text-base font-semibold text-foreground">{t('search_no_results')}</p>
              <p className="text-sm text-muted-foreground font-sans mt-1">{t('search_no_results_sub')}</p>
            </div>
          ) : (
            <ul className="space-y-2">
              {grouped.map((item) => {
                const name = getLocalizedName(item, locale);
                const description = getLocalizedDescription(item, locale);
                return (
                  <li key={item.id} className="card-lux p-3 flex items-center gap-3">
                    <SmartImage
                      src={item.image_url || undefined}
                      id={item.id}
                      alt=""
                      width={56}
                      height={56}
                      wrapperClassName="w-14 h-14 rounded-xl shrink-0"
                      fallbackText={name}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="font-serif text-[15px] font-semibold text-foreground leading-tight truncate">{name}</p>
                      <p className="text-[11px] text-muted-foreground font-sans">{item.category_name}</p>
                      {description && (
                        <p className="text-xs text-muted-foreground font-sans truncate">{description}</p>
                      )}
                    </div>
                    <div className="text-end shrink-0">
                      <p className="text-sm font-sans font-bold text-primary tabular-nums">{item.price.toFixed(2)} KM</p>
                      {!item.is_available ? (
                        <span className="text-[11px] font-sans text-muted-foreground">{t('sold_out')}</span>
                      ) : canOrder ? (
                        <button
                          onClick={() => {
                            addItem({ id: item.id, menuItemId: item.id, name: item.name, price: item.price, image_url: item.image_url || undefined });
                            track('item_added', { item_id: item.id, source: 'search' });
                          }}
                          aria-label={`${t('add_to_order')} — ${name}`}
                          className="mt-1 h-9 px-3 rounded-full bg-primary text-primary-foreground font-sans font-semibold text-xs inline-flex items-center gap-1 hover:bg-sage-dark transition-colors tap-sm"
                        >
                          <Plus className="w-3.5 h-3.5" aria-hidden /> {t('add')}
                        </button>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};

export default MenuSearch;
