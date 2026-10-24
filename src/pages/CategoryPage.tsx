import React, { useState, useEffect, useLayoutEffect, useMemo, useRef, useDeferredValue, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useParams, useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import { ArrowLeft, Plus, Minus, Search, X, Star, LayoutGrid, List, SlidersHorizontal, RefreshCw } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { track } from '@/lib/analytics';
import { useItemImpression } from '@/lib/impressions';
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
import { DIET_TAGS, DIET_BY_KEY, getItemTags, matchesDietFilter, useDietFilterStore } from '@/lib/dietary';
import { merchBadges, unorderableReason, windowLabel } from '@/lib/availability';
import { sectionSlug } from '@/lib/menu-sections';
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

/**
 * A menu card that reports being looked at.
 *
 * Tapping anywhere on the card opens the dish; for keyboards and screen
 * readers the dish name itself is the button. The quantity controls are
 * siblings that stop the tap from also opening the sheet. The card used to be
 * a button with buttons inside, which is invalid HTML: screen readers read the
 * whole card, price and all, as the name of the + button.
 */
const ImpressionCard = ({
  itemId, children, className, onOpen,
}: { itemId: string; children: React.ReactNode; className?: string; onOpen: () => void }) => {
  const ref = useItemImpression(itemId);
  return (
    <div ref={ref as React.Ref<HTMLDivElement>} className={className} onClick={onOpen}>
      {children}
    </div>
  );
};

const stop = (e: React.SyntheticEvent) => e.stopPropagation();

const vibrate = (ms: number) => {
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) { try { navigator.vibrate(ms); } catch { /* gesture-gated */ } }
};

const CategoryPage = () => {
  const { type } = useParams<{ type: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  useSessionHeartbeat();
  const [searchParams] = useSearchParams();
  const [spySubId, setSpySubId] = useState<string | null>(null);
  const [selectedItem, setSelectedItem] = useState<MenuItemRow | null>(null);
  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [view, setView] = useState<'list' | 'grid'>(() => {
    try { return localStorage.getItem('lasoul-menu-view') === 'grid' ? 'grid' : 'list'; } catch { return 'list'; }
  });
  // Shared, so the cart can avoid suggesting around a filter set here.
  const activeDiets = useDietFilterStore((st) => st.activeDiets);
  const setActiveDiets = useDietFilterStore((st) => st.setActiveDiets);
  const pillRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});
  const headerRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  // While a tap-to-section scroll is in flight the spy would light up every
  // pill it passes on the way; it stays quiet until this time.
  const spyPausedUntil = useRef(0);
  const deepLinked = useRef(false);
  const deferredSearch = useDeferredValue(search);
  const { addItem, removeItem, updateQuantity, items: cartItems } = useCartStore();
  const storeSessionId = useCartStore((s) => s.sessionId);
  const storeSessionToken = useCartStore((s) => s.sessionToken);
  const storeTableNumber = useCartStore((s) => s.tableNumber);
  const t = useT();
  const locale = useLanguageStore((s) => s.locale);

  // The session lives in the store, not the URL — see the note in GuestMenu.
  const table = searchParams.get('table') ?? (storeTableNumber ? String(storeTableNumber) : null);
  const token = searchParams.get('token');
  const hasSession = !!(storeSessionId && storeSessionToken);
  const rtl = locale === 'ar';

  const categoryName = categoryNameMap[type || ''] || type;

  const { data: category, isError: categoryFailed, refetch: refetchCategory } = useQuery({
    queryKey: ['category', categoryName],
    queryFn: async () => {
      const { data, error } = await supabase.from('categories').select('*').eq('name', categoryName).single();
      if (error) throw error;
      return data;
    },
    retry: 1,
  });

  const { data: subcategories = [], isError: subsFailed } = useQuery({
    queryKey: ['subcategories', category?.id],
    queryFn: async () => {
      const { data, error } = await supabase.from('subcategories').select('*').eq('category_id', category!.id).order('sort_order');
      if (error) throw error;
      return data;
    },
    enabled: !!category?.id,
  });

  const subIds = subcategories.map((s) => s.id);

  // Every item in this category, once, sliced per section in memory.
  const { data: allItems = [], isLoading: allLoading, isError: itemsFailed, refetch: refetchItems } = useQuery({
    queryKey: ['menu_items_all', category?.id],
    queryFn: async () => {
      // Everything, including what is currently off.
      //
      // The hard `is_available = true` filter made 86'd items VANISH, while
      // MenuSearch deliberately showed them — so the two surfaces disagreed,
      // and a guest who came for one dish concluded the restaurant had stopped
      // making it. Showing it greyed out answers the question instead.
      const { data, error } = await supabase.from('menu_items').select('*').in('subcategory_id', subIds).order('sort_order');
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
  const popularIds = useMemo(() => new Set(popular.map((p) => p.menu_item_id)), [popular]);
  // Defer the heavy re-layout when toggling list/grid so the tap stays snappy.
  const deferredView = useDeferredValue(view);

  const subNameById = useMemo(
    () => new Map(subcategories.map((s) => [s.id, getLocalizedName(s as SubcategoryRow, locale)])),
    [subcategories, locale],
  );

  const filterDiet = useCallback(
    // The same rule the suggestion engine applies, so a dish the menu hides is never suggested.
    (arr: MenuItemRow[]) => (activeDiets.length ? arr.filter((it) => matchesDietFilter(it, activeDiets)) : arr),
    [activeDiets],
  );
  // Active filters are always offered, even when this category has nothing
  // tagged with them: a filter set on another page that empties this one must
  // still be visible to be switched off.
  //
  // "Contains nuts" is a warning shown on the card, never a filter: as a chip
  // it showed an allergic guest ONLY the nut dishes.
  const presentTags = DIET_TAGS.filter((d) => (d.key !== 'contains_nuts' || activeDiets.includes(d.key))
    && (activeDiets.includes(d.key) || allItems.some((it) => getItemTags(it).includes(d.key))));
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

  // Which page brought the guest here. Printed QR codes and the old site's
  // links land here directly, never passing the home screen, so the funnel's
  // first two steps are recorded here too or those visits start at step three.
  const sectionParam = searchParams.get('section');
  useEffect(() => {
    if (!category) return;
    const fromHome = (location.state as { from?: string } | null)?.from === 'home';
    track('category_viewed', {
      category: category.name,
      ...(sectionParam ? { section: sectionParam } : {}),
      entry: fromHome ? 'home' : 'link',
    });
    if (!fromHome) {
      try {
        if (!sessionStorage.getItem('lasoul-menu-viewed')) {
          sessionStorage.setItem('lasoul-menu-viewed', '1');
          track('menu_viewed', { has_session: hasSession, entry: 'deeplink' });
        }
      } catch { /* storage blocked */ }
    }
    // Once per category page, not per render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category?.id]);

  // One continuous page per category, sections in menu order. Sections a diet
  // filter has emptied are left out, along with their pill.
  const sections = useMemo(
    () => subcategories
      .map((sub) => ({ sub, items: filterDiet(allItems.filter((it) => it.subcategory_id === sub.id)) }))
      .filter((s) => s.items.length > 0),
    [subcategories, allItems, filterDiet],
  );
  const activeSubId = spySubId && sections.some((s) => s.sub.id === spySubId) ? spySubId : sections[0]?.sub.id;

  const headerHeight = () => headerRef.current?.getBoundingClientRect().height ?? 0;

  // Scroll spy: the active section is the last one whose heading has reached
  // the bottom edge of the sticky header.
  useEffect(() => {
    if (searching || sections.length === 0) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      if (Date.now() < spyPausedUntil.current) return;
      const line = headerHeight() + 24;
      const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
      let current = sections[0].sub.id;
      for (const { sub } of sections) {
        const el = sectionRefs.current[sub.id];
        if (el && el.getBoundingClientRect().top <= line) current = sub.id;
      }
      if (atBottom) current = sections[sections.length - 1].sub.id;
      setSpySubId((prev) => (prev === current ? prev : current));
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(update); };
    window.addEventListener('scroll', onScroll, { passive: true });
    update();
    return () => { window.removeEventListener('scroll', onScroll); if (frame) cancelAnimationFrame(frame); };
  }, [sections, searching]);

  // Keep the active pill in view inside its own row. scrollIntoView rather
  // than offsetLeft arithmetic, which is mirrored (and wrong) in Arabic.
  useEffect(() => {
    const el = activeSubId ? pillRefs.current[activeSubId] : null;
    el?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }, [activeSubId]);

  const scrollToSub = useCallback((id: string, smooth = true) => {
    const el = sectionRefs.current[id];
    if (!el) return;
    setSpySubId(id);
    spyPausedUntil.current = Date.now() + (smooth ? 800 : 50);
    const top = el.getBoundingClientRect().top + window.scrollY - headerHeight() + 1;
    window.scrollTo({ top: Math.max(0, top), behavior: smooth ? 'smooth' : 'auto' });
  }, []);

  const selectSub = (id: string) => {
    scrollToSub(id);
    vibrate(4);
  };

  // ?section=burgers opens the page at that section — used by the home
  // screen's "Jump to" row and by the redirects from the old menu site.
  useLayoutEffect(() => {
    if (deepLinked.current || !sectionParam || sections.length === 0) return;
    const match = sections.find(({ sub }) => sectionSlug(sub.name) === sectionParam);
    deepLinked.current = true;
    if (match) scrollToSub(match.sub.id, false);
  }, [sectionParam, sections, scrollToSub]);

  useEffect(() => { if (searchOpen) searchInputRef.current?.focus(); }, [searchOpen]);

  const goBack = () => {
    const params = new URLSearchParams();
    if (table) params.set('table', table);
    if (token) params.set('token', token);
    const qs = params.toString();
    navigate(qs ? `/menu?${qs}` : '/menu');
  };

  const closeSearch = () => { setSearch(''); setSearchOpen(false); };

  const quickAdd = (item: MenuItemRow, source: 'list' | 'grid') => {
    const name = getLocalizedName(item, locale);
    addItem({ id: item.id, name: item.name, name_bs: item.name_bs, name_ar: item.name_ar, price: Number(item.price), image_url: item.image_url || undefined });
    track('item_added', { item_id: item.id, source });
    toast.success(t('added_to_order'), { description: name, duration: 1400 });
    vibrate(8);
  };

  const blockedLabel = (item: MenuItemRow) => {
    const blocked = unorderableReason(item);
    if (!blocked) return null;
    return blocked === 'sold_out' ? t('sold_out') : windowLabel(item);
  };

  // ---- item rendering (shared by every section + search results) ----
  /**
   * The quantity control, shared by list rows and grid cards.
   *
   * A white pill sitting on the corner of the photo: "+" when the dish is not
   * in the order yet, "− 2 +" once it is. Lives on the photo because that is
   * where the eye already is, and it never covers the name or the price.
   */
  const renderStepper = (item: MenuItemRow, name: string, source: 'list' | 'grid') => {
    const inCart = cartItems.find((c) => (c.menuItemId ?? c.id) === item.id && !c.notes);
    const qty = inCart?.quantity ?? 0;
    const shell = 'bg-card text-foreground shadow-[0_2px_10px_rgba(20,30,25,0.18)] ring-1 ring-black/5';
    if (qty === 0) {
      return (
        <button
          type="button"
          aria-label={`${t('add_to_order')} ${name}`}
          onClick={(e) => { stop(e); quickAdd(item, source); }}
          className={`w-11 h-11 rounded-full ${shell} flex items-center justify-center active:scale-90 transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}
        >
          <Plus className="w-5 h-5 text-primary" strokeWidth={2.5} aria-hidden />
        </button>
      );
    }
    return (
      <div role="group" aria-label={name} onClick={stop} className={`flex items-center h-11 rounded-full ${shell}`}>
        <button
          type="button"
          aria-label={`${t('decrease')} ${name}`}
          onClick={() => { if (qty <= 1) removeItem(inCart!.id, 'menu_stepper'); else updateQuantity(inCart!.id, qty - 1); }}
          className="w-10 h-11 rounded-full flex items-center justify-center active:scale-90 transition-transform"
        >
          <Minus className="w-4 h-4" aria-hidden />
        </button>
        <span className="min-w-[18px] text-center text-[15px] font-sans font-semibold tabular-nums" aria-live="polite">{qty}</span>
        <button
          type="button"
          aria-label={`${t('increase')} ${name}`}
          disabled={qty >= 10}
          onClick={() => updateQuantity(inCart!.id, qty + 1)}
          className="w-10 h-11 rounded-full flex items-center justify-center active:scale-90 transition-transform disabled:opacity-40"
        >
          <Plus className="w-4 h-4 text-primary" strokeWidth={2.5} aria-hidden />
        </button>
      </div>
    );
  };

  const inCartQty = (item: MenuItemRow) =>
    cartItems.find((c) => (c.menuItemId ?? c.id) === item.id && !c.notes)?.quantity ?? 0;

  /** Small, quiet labels under the name. Never more than one marketing badge. */
  const renderBadges = (item: MenuItemRow, isSearch: boolean) => {
    const blocked = blockedLabel(item);
    const badges = merchBadges(item);
    const section = isSearch ? subNameById.get(item.subcategory_id || '') : undefined;
    const popular = !blocked && badges.length === 0 && popularIds.has(item.id);
    if (!blocked && badges.length === 0 && !popular && !section) return null;
    return (
      <div className="flex items-center gap-1.5 flex-wrap mt-1">
        {blocked && <span className="px-2 py-0.5 rounded-full bg-foreground/80 text-[11px] font-sans font-semibold text-background">{blocked}</span>}
        {!blocked && badges.length > 0 && <span className="text-xs font-sans font-semibold text-primary">{badges[0]}</span>}
        {popular && (
          <span className="inline-flex items-center gap-1 text-xs font-sans font-semibold text-accent">
            <Star className="w-3 h-3 fill-current" aria-hidden /> {t('popular')}
          </span>
        )}
        {section && <span className="text-xs text-muted-foreground font-sans">· {section}</span>}
      </div>
    );
  };

  const renderGridCard = (item: MenuItemRow, i: number, eager: boolean) => {
    const name = getLocalizedName(item, locale);
    const blocked = blockedLabel(item);
    return (
      <ImpressionCard key={item.id} itemId={item.id} onOpen={() => setSelectedItem(item)} className="relative cursor-pointer group">
        <div className="relative">
          <SmartImage
            src={item.image_url || undefined}
            id={item.id}
            alt={name}
            width={220}
            height={220}
            square
            sizes="(max-width: 640px) 46vw, 220px"
            priority={eager && i < 4}
            fallbackText={name}
            wrapperClassName={`w-full aspect-square rounded-2xl ${blocked ? 'opacity-45 saturate-50' : ''}`}
          />
          {hasSession && !blocked && <div className="absolute bottom-2 end-2">{renderStepper(item, name, 'grid')}</div>}
        </div>
        <div className="pt-2 pe-1">
          <h3 className="leading-snug">
            <button type="button" className={`text-start font-serif text-[15px] font-semibold line-clamp-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded ${blocked ? 'text-muted-foreground' : 'text-foreground'}`}>{name}</button>
          </h3>
          {renderBadges(item, false)}
          <p className={`text-[15px] font-sans font-semibold mt-0.5 tabular-nums ${blocked ? 'text-muted-foreground' : 'text-foreground'}`}>{Number(item.price).toFixed(2)} KM</p>
        </div>
      </ImpressionCard>
    );
  };

  const renderListRow = (item: MenuItemRow, i: number, isSearch: boolean, eager: boolean) => {
    const localizedName = getLocalizedName(item, locale);
    const localizedDesc = getLocalizedDescription(item, locale);
    const blocked = blockedLabel(item);
    const tags = getItemTags(item).slice(0, 3).filter((k) => DIET_BY_KEY[k]);
    const meta = [
      item.prep_minutes != null && !blocked ? `~${item.prep_minutes} ${t('minutes_short')}` : null,
      item.portion_note,
    ].filter(Boolean).join(' · ');
    return (
      <ImpressionCard
        key={item.id}
        itemId={item.id}
        onOpen={() => setSelectedItem(item)}
        className="relative flex gap-4 px-4 py-4 cursor-pointer transition-colors active:bg-muted/50"
      >
        <div className="flex-1 min-w-0 py-0.5">
          <h3 className="leading-snug">
            <button type="button" className={`text-start font-serif text-[17px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded ${blocked ? 'text-muted-foreground' : 'text-foreground'}`}>
              {localizedName}
            </button>
          </h3>
          {renderBadges(item, isSearch)}
          {localizedDesc && <p className="text-sm leading-relaxed text-muted-foreground font-sans mt-1 line-clamp-2">{localizedDesc}</p>}
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <p className={`text-[15px] font-sans font-semibold tabular-nums ${blocked ? 'text-muted-foreground' : 'text-foreground'}`}>{Number(item.price).toFixed(2)} KM</p>
            {meta && <span className="text-xs font-sans text-muted-foreground">{meta}</span>}
            {tags.map((k) => (
              <span key={k} className="text-sm leading-none" title={t(DIET_BY_KEY[k].labelKey)} aria-label={t(DIET_BY_KEY[k].labelKey)}>{DIET_BY_KEY[k].emoji}</span>
            ))}
          </div>
        </div>
        {item.image_url ? (
          <div className="relative shrink-0 w-[108px] self-start">
            <SmartImage
              src={item.image_url}
              id={item.id}
              alt=""
              width={108}
              height={108}
              square
              sizes="108px"
              priority={eager && i < 4}
              fallbackText={localizedName}
              wrapperClassName={`w-[108px] h-[108px] rounded-2xl ${blocked ? 'opacity-45 saturate-50' : ''}`}
            />
            {hasSession && !blocked && (
              // "+" sits on the corner; once the dish is in the order the wider
              // "− 2 +" pill centres under the photo instead of hanging off it.
              <div className={inCartQty(item) > 0 ? 'absolute -bottom-3 inset-x-0 flex justify-center' : 'absolute -bottom-2 -end-2'}>
                {renderStepper(item, localizedName, 'list')}
              </div>
            )}
          </div>
        ) : (
          hasSession && !blocked && <div className="shrink-0 self-center">{renderStepper(item, localizedName, 'list')}</div>
        )}
      </ImpressionCard>
    );
  };

  const renderEmpty = (isSearch: boolean) => (
    <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
      <div className="w-14 h-14 rounded-full bg-muted flex items-center justify-center mb-4"><Search className="w-5 h-5 text-muted-foreground" aria-hidden /></div>
      <p className="font-serif text-base font-semibold text-foreground">{isSearch ? t('no_results_title') : t('no_items_category')}</p>
      {isSearch && <p className="text-sm text-muted-foreground font-sans mt-1.5">{t('no_results_hint')}</p>}
      {activeDiets.length > 0 && (
        <button onClick={() => setActiveDiets([])} className="mt-4 inline-flex items-center gap-1.5 px-4 min-h-[44px] rounded-full border border-border text-sm font-sans font-medium text-foreground hover:bg-muted">
          <X className="w-4 h-4" aria-hidden />{t('clear_filters')}
        </button>
      )}
    </div>
  );

  /**
   * `eager` marks the section the guest is actually looking at. Only its
   * first few photos load ahead of everything else; marking the first eight
   * of EVERY section eager queued ~100 downloads on open, and the section a
   * guest had jumped to showed blurred placeholders for seconds on 4G.
   */
  const renderItems = (list: MenuItemRow[], isSearch: boolean, eager: boolean) => {
    if (list.length === 0) return renderEmpty(isSearch);
    if (deferredView === 'grid') {
      return <div className="px-4 pt-3 grid grid-cols-2 gap-x-3 gap-y-5">{list.map((it, i) => renderGridCard(it, i, eager))}</div>;
    }
    return (
      <div className="mx-4 mt-3 rounded-3xl bg-card border border-border/70 shadow-[0_1px_2px_rgba(20,30,25,0.04)] divide-y divide-border/70 overflow-hidden">
        {list.map((it, i) => renderListRow(it, i, isSearch, eager))}
      </div>
    );
  };

  // The section the page opened at: a deep link's target, else the first.
  const eagerSectionId = useMemo(() => {
    const target = sectionParam ? sections.find(({ sub }) => sectionSlug(sub.name) === sectionParam) : undefined;
    return (target ?? sections[0])?.sub.id;
  }, [sections, sectionParam]);

  // Memoized so the scroll spy moving the active pill never re-renders items.
  const sectionsView = useMemo(
    () => sections.map(({ sub, items }, si) => (
      <section
        key={sub.id}
        ref={(el) => { sectionRefs.current[sub.id] = el; }}
        id={`section-${sectionSlug(sub.name)}`}
        aria-labelledby={`section-title-${sub.id}`}
        className={si === 0 ? 'pt-4' : 'pt-8'}
      >
        <div className="px-5 flex items-baseline justify-between gap-3">
          <h2 id={`section-title-${sub.id}`} className="font-serif text-[22px] font-semibold text-foreground tracking-tight">
            {getLocalizedName(sub as SubcategoryRow, locale)}
          </h2>
          <span className="text-xs font-sans font-medium text-muted-foreground tabular-nums">{items.length}</span>
        </div>
        {renderItems(items, false, sub.id === eagerSectionId)}
      </section>
    )),
    // renderItems is recreated each render; the value deps below fully determine its output.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sections, deferredView, locale, popularIds, cartItems, hasSession, subNameById, t, eagerSectionId],
  );

  const loadFailed = categoryFailed || subsFailed || itemsFailed;

  if (loadFailed) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6 text-center" role="alert">
        <p className="font-serif text-lg font-semibold text-foreground">{t('load_failed')}</p>
        <div className="mt-5 flex gap-2">
          <button onClick={goBack} className="px-4 min-h-[44px] rounded-full border border-border text-sm font-sans font-medium">{t('back_to_menu')}</button>
          <button
            onClick={() => { void refetchCategory(); void refetchItems(); }}
            className="inline-flex items-center gap-2 px-4 min-h-[44px] rounded-full bg-primary text-primary-foreground text-sm font-sans font-medium"
          >
            <RefreshCw className="w-4 h-4" aria-hidden />{t('try_again')}
          </button>
        </div>
      </div>
    );
  }

  if (!category) {
    return (
      <div className="min-h-screen bg-background">
        <div className="px-4 py-3 flex items-center gap-3">
          <Skeleton className="w-10 h-10 rounded-full" />
          <Skeleton className="w-32 h-6 rounded" />
        </div>
        <div className="px-4 space-y-3 mt-4">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-28 w-full rounded-xl" />)}
        </div>
      </div>
    );
  }

  const localizedCategory = getLocalizedName(category as CategoryRow, locale);
  const iconButton = 'w-11 h-11 rounded-full flex items-center justify-center text-foreground hover:bg-muted transition-colors shrink-0';

  return (
    <div className="min-h-screen bg-background">
      {/* About 100px at rest instead of the ~240px the first redesign used:
          title row plus section pills. Search and diet filters sit behind
          icons because most guests never use them, and on a phone with the
          browser toolbar showing every pixel of header is a pixel of menu. */}
      <div ref={headerRef} className="sticky top-0 z-30 glass">
        <div className="flex items-center gap-1 ps-2 pe-3 h-14">
          <button onClick={goBack} aria-label={t('back_to_menu')} className={iconButton}>
            <ArrowLeft className="w-5 h-5 rtl:rotate-180" aria-hidden />
          </button>
          {searchOpen ? (
            <div className="relative flex-1 min-w-0">
              <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" aria-hidden />
              <input
                ref={searchInputRef}
                type="search"
                inputMode="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Escape') closeSearch(); }}
                placeholder={`${t('search_in')} ${localizedCategory}…`}
                aria-label={`${t('search_in')} ${localizedCategory}`}
                className="w-full h-11 ps-9 pe-11 rounded-full bg-muted/70 border border-border/60 text-base font-sans text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
              <button onClick={closeSearch} aria-label={t('clear_search')} className="absolute end-0 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full flex items-center justify-center text-muted-foreground">
                <X className="w-4 h-4" aria-hidden />
              </button>
            </div>
          ) : (
            <>
              <h1 className="flex-1 min-w-0 truncate font-serif text-xl font-semibold text-foreground ps-1">{localizedCategory}</h1>
              <button onClick={() => setSearchOpen(true)} aria-label={`${t('search_in')} ${localizedCategory}`} className={iconButton}>
                <Search className="w-5 h-5" aria-hidden />
              </button>
              <button
                onClick={() => setFiltersOpen((o) => !o)}
                aria-label={t('filters')}
                aria-expanded={filtersOpen}
                className={`${iconButton} relative ${filtersOpen ? 'bg-muted' : ''}`}
              >
                <SlidersHorizontal className="w-5 h-5" aria-hidden />
                {activeDiets.length > 0 && (
                  <span className="absolute top-1.5 end-1.5 min-w-4 h-4 px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center">{activeDiets.length}</span>
                )}
              </button>
              <LanguageSelector />
            </>
          )}
        </div>

        <AnimatePresence initial={false}>
          {filtersOpen && !searchOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden"
            >
              <div className="px-4 pb-3 space-y-3">
                <div className="flex items-center gap-2" role="group" aria-label={t('list_view')}>
                  <button onClick={() => setView('list')} aria-pressed={view === 'list'} className={`inline-flex items-center gap-1.5 px-3.5 min-h-[40px] rounded-full text-sm font-sans font-medium border ${view === 'list' ? 'bg-foreground text-background border-foreground' : 'bg-card text-foreground border-border'}`}>
                    <List className="w-4 h-4" aria-hidden />{t('list_view')}
                  </button>
                  <button onClick={() => setView('grid')} aria-pressed={view === 'grid'} className={`inline-flex items-center gap-1.5 px-3.5 min-h-[40px] rounded-full text-sm font-sans font-medium border ${view === 'grid' ? 'bg-foreground text-background border-foreground' : 'bg-card text-foreground border-border'}`}>
                    <LayoutGrid className="w-4 h-4" aria-hidden />{t('grid_view')}
                  </button>
                </div>
                {presentTags.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2">
                    {presentTags.map((d) => {
                      const on = activeDiets.includes(d.key);
                      return (
                        <button key={d.key} onClick={() => toggleDiet(d.key)} aria-pressed={on} className={`inline-flex items-center gap-1.5 px-3.5 min-h-[40px] rounded-full text-sm font-sans font-medium border transition-colors ${on ? 'bg-primary text-primary-foreground border-primary' : 'bg-card text-foreground border-border hover:bg-muted'}`}>
                          <span aria-hidden>{d.emoji}</span>{t(d.labelKey)}
                        </button>
                      );
                    })}
                    {activeDiets.length > 0 && (
                      <button onClick={() => setActiveDiets([])} className="inline-flex items-center gap-1 px-3 min-h-[40px] rounded-full text-sm font-sans text-muted-foreground hover:text-foreground">
                        <X className="w-4 h-4" aria-hidden />{t('clear_filters')}
                      </button>
                    )}
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {sections.length > 1 && !searching && (
          <nav className="flex gap-1.5 px-3 pb-2 overflow-x-auto scrollbar-hide" aria-label={t('menu_sections')}>
            {sections.map(({ sub }) => {
              const isActive = activeSubId === sub.id;
              return (
                <button
                  key={sub.id}
                  ref={(el) => { pillRefs.current[sub.id] = el; }}
                  onClick={() => selectSub(sub.id)}
                  aria-current={isActive ? 'true' : undefined}
                  className={`relative px-4 h-10 rounded-full text-sm font-sans font-medium whitespace-nowrap tap ${isActive ? 'text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  {isActive && <motion.span layoutId="active-sub-pill" transition={springPill} className="absolute inset-0 rounded-full bg-primary shadow-sm" />}
                  <span className="relative z-10">{getLocalizedName(sub as SubcategoryRow, locale)}</span>
                </button>
              );
            })}
          </nav>
        )}
        <div className="h-px bg-gradient-to-r from-transparent via-primary/20 to-transparent" />
      </div>

      {allLoading ? (
        <div className="px-4 pt-4 space-y-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="flex gap-4 p-3 rounded-xl border border-border bg-card">
              <Skeleton className="w-24 h-24 rounded-xl flex-shrink-0" />
              <div className="flex-1 space-y-2 py-1"><Skeleton className="h-4 w-2/3 rounded" /><Skeleton className="h-3 w-full rounded" /><Skeleton className="h-4 w-16 rounded mt-2" /></div>
            </div>
          ))}
        </div>
      ) : searching ? (
        <div className="pb-40">{renderItems(searchResults, true, true)}</div>
      ) : sections.length === 0 ? (
        <div className="pb-40">{renderEmpty(false)}</div>
      ) : (
        <div className="pb-40">{sectionsView}</div>
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
              // Allergens are the one field on this sheet that can matter
              // medically; they must always travel with the item.
              allergens: selectedItem.allergens ?? null,
              portion_note: selectedItem.portion_note ?? null,
              prep_minutes: selectedItem.prep_minutes ?? null,
            }}
            onClose={() => setSelectedItem(null)}
            canOrder={hasSession}
            unavailableLabel={blockedLabel(selectedItem)}
          />
        )}
      </AnimatePresence>

      {hasSession && <CartBar />}
    </div>
  );
};

export default CategoryPage;
