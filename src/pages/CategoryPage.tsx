import React, { useState, useEffect, useMemo, useRef, useDeferredValue, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Plus, Minus, QrCode, Search, X, Star, LayoutGrid, List } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useCartStore } from '@/lib/cart-store';
import { Skeleton } from '@/components/ui/skeleton';
import SmartImage from '@/components/ui/SmartImage';
import CartBar from '@/components/guest/CartBar';
import MenuItemDetail from '@/components/guest/MenuItemDetail';
import LanguageSelector from '@/components/guest/LanguageSelector';
import { useT, useLanguageStore, getLocalizedName, getLocalizedDescription } from '@/lib/i18n';
import { useSessionHeartbeat } from '@/hooks/useSessionHeartbeat';
import { springPill } from '@/lib/motion';
import { DIET_TAGS, DIET_BY_KEY, getItemTags } from '@/lib/dietary';
import type { Database } from '@/integrations/supabase/types';

type CategoryRow = Database['public']['Tables']['categories']['Row'];
type MenuItemRow = Database['public']['Tables']['menu_items']['Row'];
type SubcategoryRow = Database['public']['Tables']['subcategories']['Row'];

const categoryNameMap: Record<string, string> = {
  drinks: 'Drinks',
  food: 'Food',
  desserts: 'Desserts',
  dessert: 'Desserts',
};

const CategoryPage = () => {
  const { type } = useParams<{ type: string }>();
  const navigate = useNavigate();
  useSessionHeartbeat();
  const [searchParams] = useSearchParams();
  const [selectedSubcategory, setSelectedSubcategory] = useState<string | null>(null);
  const [selectedItem, setSelectedItem] = useState<MenuItemRow | null>(null);
  const [search, setSearch] = useState('');
  const [view, setView] = useState<'list' | 'grid'>(() => (typeof localStorage !== 'undefined' && localStorage.getItem('lasoul-menu-view') === 'grid' ? 'grid' : 'list'));
  const [activeDiets, setActiveDiets] = useState<string[]>([]);
  const [showHint, setShowHint] = useState(false);
  const pillRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const trackRef = useRef<HTMLDivElement | null>(null);
  const scrollRaf = useRef<number>();
  const programmaticScroll = useRef(false);
  const deferredSearch = useDeferredValue(search);
  const { addItem, removeItem, updateQuantity, items: cartItems } = useCartStore();
  const t = useT();
  const locale = useLanguageStore((s) => s.locale);

  const table = searchParams.get('table');
  const token = searchParams.get('token');
  const hasSession = !!(table && token);
  const rtl = locale === 'ar';

  const categoryName = categoryNameMap[type || ''] || type;

  const { data: category } = useQuery({
    queryKey: ['category', categoryName],
    queryFn: async () => {
      const { data, error } = await supabase.from('categories').select('*').eq('name', categoryName).single();
      if (error) throw error;
      return data;
    },
  });

  const { data: subcategories = [] } = useQuery({
    queryKey: ['subcategories', category?.id],
    queryFn: async () => {
      const { data, error } = await supabase.from('subcategories').select('*').eq('category_id', category!.id).order('sort_order');
      if (error) throw error;
      return data;
    },
    enabled: !!category?.id,
  });

  const activeSubId = selectedSubcategory || subcategories[0]?.id;
  const subIds = subcategories.map((s) => s.id);

  // Load every available item in this category once, then slice per subcategory
  // in memory — so each swipe page is ready instantly (no refetch / flicker).
  const { data: allItems = [], isLoading: allLoading } = useQuery({
    queryKey: ['menu_items_all', category?.id],
    queryFn: async () => {
      const { data, error } = await supabase.from('menu_items').select('*').in('subcategory_id', subIds).eq('is_available', true).order('sort_order');
      if (error) throw error;
      return data;
    },
    enabled: subIds.length > 0,
    staleTime: 5 * 60 * 1000,
  });

  const { data: popular = [] } = useQuery({
    queryKey: ['popular-items'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_popular_items' as never, { _limit: 12, _days: 30 } as never);
      if (error) return [] as { menu_item_id: string }[];
      return (data ?? []) as { menu_item_id: string }[];
    },
    staleTime: 10 * 60 * 1000,
  });
  const popularIds = new Set(popular.map((p) => p.menu_item_id));

  const subNameById = useMemo(
    () => new Map(subcategories.map((s) => [s.id, getLocalizedName(s as SubcategoryRow, locale)])),
    [subcategories, locale],
  );

  const filterDiet = useCallback(
    (arr: MenuItemRow[]) => (activeDiets.length ? arr.filter((it) => { const tags = getItemTags(it); return activeDiets.every((d) => tags.includes(d)); }) : arr),
    [activeDiets],
  );
  const presentTags = DIET_TAGS.filter((d) => allItems.some((it) => getItemTags(it).includes(d.key)));
  const toggleDiet = (key: string) => setActiveDiets((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));

  const q = deferredSearch.trim().toLowerCase();
  const searching = q.length > 0;
  const searchResults = useMemo(() => {
    if (!searching) return [] as MenuItemRow[];
    const matched = allItems.filter((it) => [it.name, it.name_bs, it.name_ar, it.description, it.description_bs, it.description_ar]
      .filter((v): v is string => Boolean(v)).some((f) => f.toLowerCase().includes(q)));
    return filterDiet(matched);
  }, [searching, allItems, q, filterDiet]);

  // ---- effects ----
  useEffect(() => { try { localStorage.setItem('lasoul-menu-view', view); } catch { /* ignore */ } }, [view]);

  useEffect(() => {
    if (subcategories.length > 1 && typeof localStorage !== 'undefined' && !localStorage.getItem('lasoul-swipe-hint')) setShowHint(true);
  }, [subcategories.length]);
  const dismissHint = useCallback(() => { setShowHint(false); try { localStorage.setItem('lasoul-swipe-hint', '1'); } catch { /* ignore */ } }, []);

  // Keep the active subcategory pill scrolled into view.
  useEffect(() => {
    const el = activeSubId ? pillRefs.current[activeSubId] : null;
    el?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }, [activeSubId]);

  // Keep the pager aligned to the active subcategory (e.g. after closing search,
  // which remounts the track and would otherwise reset it to the first page).
  useEffect(() => {
    if (searching || programmaticScroll.current) return;
    const el = trackRef.current;
    if (!el || !el.clientWidth) return;
    const idx = subcategories.findIndex((s) => s.id === activeSubId);
    if (idx >= 0 && Math.round(el.scrollLeft / el.clientWidth) !== idx) {
      el.scrollLeft = idx * el.clientWidth;
    }
  }, [searching, subcategories, activeSubId]);

  // The pager follows the finger natively; sync the active subcategory on snap.
  const handleTrackScroll = () => {
    if (programmaticScroll.current) return;
    if (scrollRaf.current) cancelAnimationFrame(scrollRaf.current);
    scrollRaf.current = requestAnimationFrame(() => {
      const el = trackRef.current;
      if (!el || !el.clientWidth) return;
      const idx = Math.round(el.scrollLeft / el.clientWidth);
      const sub = subcategories[idx];
      if (sub && sub.id !== activeSubId) {
        setSelectedSubcategory(sub.id);
        if (showHint) dismissHint();
        if (typeof navigator !== 'undefined' && 'vibrate' in navigator) { try { navigator.vibrate(4); } catch { /* gesture-gated */ } }
      }
    });
  };

  const scrollToSub = (id: string) => {
    const idx = subcategories.findIndex((s) => s.id === id);
    const el = trackRef.current;
    setSelectedSubcategory(id);
    if (showHint) dismissHint();
    if (el && idx >= 0) {
      programmaticScroll.current = true;
      el.scrollTo({ left: idx * el.clientWidth, behavior: 'smooth' });
      window.setTimeout(() => { programmaticScroll.current = false; }, 450);
    }
  };

  const goBack = () => {
    const params = new URLSearchParams();
    if (table) params.set('table', table);
    if (token) params.set('token', token);
    navigate(`/menu?${params.toString()}`);
  };

  if (!category) {
    return (
      <div className="min-h-screen bg-background">
        <div className="px-4 py-4 flex items-center gap-3">
          <Skeleton className="w-8 h-8 rounded-full" />
          <Skeleton className="w-32 h-6 rounded" />
        </div>
        <div className="px-4 space-y-3 mt-4">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-20 w-full rounded-xl" />)}
        </div>
      </div>
    );
  }

  // ---- item rendering (shared by every page + search results) ----
  const renderGridCard = (item: MenuItemRow, i: number) => {
    const name = getLocalizedName(item, locale);
    const tags = getItemTags(item);
    return (
      <button key={item.id} onClick={() => setSelectedItem(item)} className="text-left tap-sm card-lux card-lux-hover overflow-hidden">
        <div className="relative">
          <SmartImage src={item.image_url || undefined} id={item.id} layoutId={`item-img-${item.id}`} alt={name} width={220} height={165} priority={i < 6} fallbackText={name} wrapperClassName="w-full aspect-[4/3]" />
          {popularIds.has(item.id) && (
            <span className="absolute top-1.5 left-1.5 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-gold/90 text-[10px] font-sans font-semibold text-white shadow"><Star className="w-2.5 h-2.5 fill-white" /></span>
          )}
          {hasSession && (
            <span role="button" aria-label={`${t('add_to_order')} ${name}`}
              className="absolute bottom-1.5 right-1.5 w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow-md active:scale-90 transition-transform"
              onClick={(e) => {
                e.stopPropagation();
                addItem({ id: item.id, name: item.name, price: Number(item.price), image_url: item.image_url || undefined });
                toast.success(t('added_to_order'), { description: name, duration: 1400 });
                if (typeof navigator !== 'undefined' && 'vibrate' in navigator) { try { navigator.vibrate(8); } catch { /* gesture-gated */ } }
              }}
            ><Plus className="w-4 h-4" /></span>
          )}
        </div>
        <div className="p-2.5">
          <h3 className="font-serif text-sm font-semibold text-foreground line-clamp-1">{name}</h3>
          {tags.length > 0 && <span className="block text-xs mt-0.5">{tags.slice(0, 3).map((k) => DIET_BY_KEY[k]?.emoji).filter(Boolean).join(' ')}</span>}
          <p className="text-sm font-sans font-bold text-primary mt-1 tabular-nums">{Number(item.price).toFixed(2)} KM</p>
        </div>
      </button>
    );
  };

  const renderListRow = (item: MenuItemRow, i: number, isSearch: boolean) => {
    const localizedName = getLocalizedName(item, locale);
    const localizedDesc = getLocalizedDescription(item, locale);
    const inCart = cartItems.find((c) => (c.menuItemId ?? c.id) === item.id && !c.notes);
    const qty = inCart?.quantity ?? 0;
    return (
      <button key={item.id} onClick={() => setSelectedItem(item)} className="w-full text-left tap">
        <div className="group flex gap-4 p-4 card-lux card-lux-hover">
          <SmartImage src={item.image_url || undefined} id={item.id} layoutId={`item-img-${item.id}`} alt={localizedName} width={80} height={80} priority={i < 8} fallbackText={localizedName} wrapperClassName="w-20 h-20 rounded-lg flex-shrink-0" className="group-hover:scale-105 transition-transform duration-300" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-serif text-base font-semibold text-foreground">{localizedName}</h3>
              {popularIds.has(item.id) && (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-gold/15 text-[10px] font-sans font-semibold text-gold"><Star className="w-2.5 h-2.5 fill-gold" /> {t('popular')}</span>
              )}
              {getItemTags(item).slice(0, 3).map((k) => DIET_BY_KEY[k] && (
                <span key={k} className="text-sm leading-none" title={t(DIET_BY_KEY[k].labelKey)} aria-label={t(DIET_BY_KEY[k].labelKey)}>{DIET_BY_KEY[k].emoji}</span>
              ))}
              {isSearch && subNameById.get(item.subcategory_id || '') && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground font-sans">{subNameById.get(item.subcategory_id || '')}</span>
              )}
            </div>
            {localizedDesc && <p className="text-sm text-muted-foreground font-sans mt-0.5 line-clamp-2">{localizedDesc}</p>}
            <p className="text-sm font-sans font-bold text-primary mt-2 tabular-nums">{Number(item.price).toFixed(2)} KM</p>
          </div>
          {hasSession && (
            <div className="flex items-center" onClick={(e) => e.stopPropagation()}>
              {qty > 0 ? (
                <div role="group" aria-label={`${localizedName} quantity`} className="flex items-center gap-1 bg-primary/10 rounded-full p-1">
                  <button type="button" aria-label={`Decrease ${localizedName} quantity`} onClick={(e) => { e.stopPropagation(); if (qty <= 1) removeItem(item.id); else updateQuantity(item.id, qty - 1); }} className="w-9 h-9 rounded-full bg-card text-primary flex items-center justify-center hover:bg-muted active:scale-90 transition-all min-w-[36px] min-h-[36px]"><Minus className="w-3.5 h-3.5" /></button>
                  <span className="min-w-[20px] text-center text-sm font-sans font-bold text-primary tabular-nums">{qty}</span>
                  <button type="button" aria-label={`Increase ${localizedName} quantity`} disabled={qty >= 10} onClick={(e) => { e.stopPropagation(); updateQuantity(item.id, qty + 1); }} className="w-9 h-9 rounded-full bg-primary text-primary-foreground flex items-center justify-center hover:bg-sage-dark active:scale-90 transition-all min-w-[36px] min-h-[36px] disabled:opacity-50"><Plus className="w-3.5 h-3.5" /></button>
                </div>
              ) : (
                <button type="button" aria-label={`${t('add_to_order')} ${localizedName}`} onClick={(e) => {
                  e.stopPropagation();
                  addItem({ id: item.id, name: item.name, price: Number(item.price), image_url: item.image_url || undefined });
                  toast.success(t('added_to_order'), { description: localizedName, duration: 1600 });
                  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) { try { navigator.vibrate(8); } catch { /* gesture-gated */ } }
                }} className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center hover:bg-primary hover:text-primary-foreground active:scale-90 transition-all duration-150 min-w-[44px] min-h-[44px] tap-sm"><Plus className="w-4 h-4" /></button>
              )}
            </div>
          )}
        </div>
      </button>
    );
  };

  const renderItems = (list: MenuItemRow[], isSearch: boolean) => {
    if (list.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
          <div className="w-14 h-14 rounded-full bg-muted flex items-center justify-center mb-4"><Search className="w-5 h-5 text-muted-foreground" /></div>
          <p className="font-serif text-base font-semibold text-foreground">{isSearch ? t('no_results_title') : t('no_items_category')}</p>
          {isSearch && <p className="text-sm text-muted-foreground font-sans mt-1.5">{t('no_results_hint')}</p>}
        </div>
      );
    }
    if (view === 'grid') return <div className="px-4 pt-4 grid grid-cols-2 gap-3">{list.map((it, i) => renderGridCard(it, i))}</div>;
    return <div className="px-4 pt-4 space-y-3">{list.map((it, i) => renderListRow(it, i, isSearch))}</div>;
  };

  return (
    <div className="flex flex-col h-[100dvh] bg-background">
      <div className="shrink-0 z-30 glass">
        <div className="flex items-center gap-3 px-4 py-4">
          <button onClick={goBack} aria-label={t('back_to_menu')} className="p-2.5 -ml-2 rounded-full hover:bg-muted transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center">
            <ArrowLeft className={`w-5 h-5 text-foreground ${rtl ? 'rotate-180' : ''}`} />
          </button>
          <h1 className="font-serif text-xl font-semibold text-foreground">{getLocalizedName(category as CategoryRow, locale)}</h1>
          <div className="ml-auto flex items-center gap-2">
            {table && <span className="text-xs font-sans px-3 py-1 rounded-full bg-primary/10 text-primary font-medium">{t('table')} {table}</span>}
            <button onClick={() => setView((v) => (v === 'list' ? 'grid' : 'list'))} aria-label={view === 'list' ? t('grid_view') : t('list_view')} className="p-2 rounded-full hover:bg-muted transition-colors min-w-[40px] min-h-[40px] flex items-center justify-center text-muted-foreground">
              {view === 'list' ? <LayoutGrid className="w-5 h-5" /> : <List className="w-5 h-5" />}
            </button>
            <LanguageSelector />
          </div>
        </div>
        <div className="h-px bg-gradient-to-r from-transparent via-primary/20 to-transparent" />

        {subcategories.length > 0 && (
          <div className="flex gap-1.5 px-4 py-3 overflow-x-auto scrollbar-hide">
            {subcategories.map((sub) => {
              const isActive = activeSubId === sub.id;
              return (
                <button key={sub.id} ref={(el) => { pillRefs.current[sub.id] = el; }} onClick={() => scrollToSub(sub.id)}
                  className={`relative px-4 py-2.5 rounded-full text-sm font-sans font-medium whitespace-nowrap min-h-[44px] tap ${isActive ? 'text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
                  {isActive && <motion.span layoutId="active-sub-pill" transition={springPill} className="absolute inset-0 rounded-full bg-primary shadow-sm" />}
                  <span className="relative z-10">{getLocalizedName(sub as SubcategoryRow, locale)}</span>
                </button>
              );
            })}
          </div>
        )}

        <div className="px-4 pb-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            <input type="search" inputMode="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('search_placeholder')} aria-label={t('search_placeholder')}
              className="w-full h-11 pl-10 pr-10 rounded-full bg-muted/60 border border-border/60 text-sm font-sans text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40 transition-all" />
            {search && <button onClick={() => setSearch('')} aria-label={t('clear_search')} className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full flex items-center justify-center text-muted-foreground hover:bg-muted transition-colors"><X className="w-3.5 h-3.5" /></button>}
          </div>
        </div>

        {presentTags.length > 0 && (
          <div className="flex items-center gap-1.5 px-4 pb-3 overflow-x-auto scrollbar-hide">
            {presentTags.map((d) => {
              const on = activeDiets.includes(d.key);
              return (
                <button key={d.key} onClick={() => toggleDiet(d.key)} className={`shrink-0 inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-sans font-medium border transition-colors ${on ? 'bg-primary text-primary-foreground border-primary' : 'bg-card text-muted-foreground border-border hover:text-foreground'}`}>
                  <span aria-hidden>{d.emoji}</span>{t(d.labelKey)}
                </button>
              );
            })}
            {activeDiets.length > 0 && <button onClick={() => setActiveDiets([])} className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1.5 rounded-full text-xs font-sans text-muted-foreground hover:text-foreground"><X className="w-3 h-3" />{t('clear_filters')}</button>}
          </div>
        )}
      </div>

      {showHint && (
        <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} className="shrink-0 mx-4 mt-3 px-3.5 py-2.5 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-between gap-3">
          <span className="text-xs font-sans text-primary flex items-center gap-2">👈👉 {t('swipe_hint')}</span>
          <button onClick={dismissHint} className="text-xs font-sans font-semibold text-primary px-2.5 py-1 rounded-lg hover:bg-primary/15">{t('got_it')}</button>
        </motion.div>
      )}

      {!hasSession && (
        <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="shrink-0 mx-4 mt-3 px-4 py-3 rounded-xl bg-accent/8 border border-accent/15 flex items-center gap-3">
          <QrCode className="w-4 h-4 text-accent flex-shrink-0" />
          <p className="text-xs font-sans text-accent">{t('scan_qr_order')}</p>
        </motion.div>
      )}

      {allLoading ? (
        <div className="flex-1 overflow-y-auto px-4 pt-4 space-y-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="flex gap-4 p-4 rounded-xl border border-border bg-card">
              <Skeleton className="w-20 h-20 rounded-lg flex-shrink-0" />
              <div className="flex-1 space-y-2 py-1"><Skeleton className="h-4 w-2/3 rounded" /><Skeleton className="h-3 w-full rounded" /><Skeleton className="h-4 w-16 rounded mt-2" /></div>
            </div>
          ))}
        </div>
      ) : searching ? (
        <div className="flex-1 overflow-y-auto overscroll-y-contain pb-36">{renderItems(searchResults, true)}</div>
      ) : (
        <div ref={trackRef} dir="ltr" onScroll={handleTrackScroll} className="flex-1 flex overflow-x-auto overflow-y-hidden snap-x snap-mandatory scrollbar-hide overscroll-x-contain">
          {subcategories.map((sub) => (
            <div key={sub.id} dir={rtl ? 'rtl' : 'ltr'} className="snap-start shrink-0 w-full h-full overflow-y-auto overscroll-y-contain pb-36">
              {renderItems(filterDiet(allItems.filter((it) => it.subcategory_id === sub.id)), false)}
            </div>
          ))}
        </div>
      )}

      <AnimatePresence>
        {selectedItem && (
          <MenuItemDetail
            item={{
              id: selectedItem.id,
              name: selectedItem.name,
              name_ar: selectedItem.name_ar,
              name_bs: selectedItem.name_bs,
              description: selectedItem.description || undefined,
              description_ar: selectedItem.description_ar || undefined,
              description_bs: selectedItem.description_bs || undefined,
              price: Number(selectedItem.price),
              image_url: selectedItem.image_url || undefined,
            }}
            onClose={() => setSelectedItem(null)}
            canOrder={hasSession}
          />
        )}
      </AnimatePresence>

      {hasSession && <CartBar />}
    </div>
  );
};

export default CategoryPage;
