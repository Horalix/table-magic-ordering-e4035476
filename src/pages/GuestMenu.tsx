import React, { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { Phone, MapPin, ChevronRight, QrCode, RefreshCw, BadgeCheck } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import CallWaiterButton from '@/components/guest/CallWaiterButton';
import { useCartStore } from '@/lib/cart-store';
import CartBar from '@/components/guest/CartBar';
import LanguageSelector from '@/components/guest/LanguageSelector';
import SmartImage from '@/components/ui/SmartImage';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useT, useLanguageStore, getLocalizedName } from '@/lib/i18n';
import { useSessionHeartbeat } from '@/hooks/useSessionHeartbeat';
import { useSessionGuard } from '@/hooks/useSessionGuard';
import { staggerContainer, fadeUp, duration, easeEnter, PRESS_SCALE } from '@/lib/motion';
import { menuHref } from '@/lib/menu-sections';
import InstallPrompt from '@/components/guest/InstallPrompt';
import RecentOrdersRow from '@/components/guest/RecentOrdersRow';
import MenuSearch from '@/components/guest/MenuSearch';
import { track } from '@/lib/analytics';
import type { Database } from '@/integrations/supabase/types';

type CategoryRow = Database['public']['Tables']['categories']['Row'];
type SubcategoryRow = Database['public']['Tables']['subcategories']['Row'];

/** Photographed covers, cropped 16:9 from the old menu site's section images. */
const coverMap: Record<string, string> = {
  Drinks: 'drinks',
  Food: 'food',
  Desserts: 'desserts',
};

const descKeyMap: Record<string, string> = {
  Drinks: 'drinks_desc',
  Food: 'food_desc',
  Desserts: 'desserts_desc',
};

const PHONE_HREF = 'tel:+38733877779';
const MAPS_HREF = 'https://www.google.com/maps/search/?api=1&query=La+Soul+Butmirska+cesta+16A+Sarajevo';

const GuestMenu = () => {
  const navigate = useNavigate();
  useSessionHeartbeat();
  // Confirms with the server, once per app launch, that a remembered table is
  // still this visit's table. See useSessionGuard for why that matters here.
  const guard = useSessionGuard();
  const [searchParams] = useSearchParams();
  const t = useT();
  const locale = useLanguageStore((s) => s.locale);
  // A live session is the store's, not the URL's.
  //
  // The PWA start_url is /menu with no query string, and any reload or shared
  // link drops the params — so deriving "can this guest order?" from the URL
  // alone silently demoted installed-app users to browse-only. The URL is only
  // a convenience for showing the table number.
  const storeSessionId = useCartStore((s) => s.sessionId);
  const storeSessionToken = useCartStore((s) => s.sessionToken);
  const storeTableNumber = useCartStore((s) => s.tableNumber);

  const table = searchParams.get('table') ?? (storeTableNumber ? String(storeTableNumber) : null);
  const token = searchParams.get('token');
  const hasSession = guard === 'active' && !!(storeSessionId && storeSessionToken);

  const { data: categories = [], isLoading: categoriesLoading, isError: categoriesFailed, refetch: refetchCategories } = useQuery({
    queryKey: ['categories'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('categories')
        .select('*')
        .order('sort_order');
      if (error) throw error;
      return data;
    },
  });

  const { data: subcategories = [] } = useQuery({
    queryKey: ['subcategories-all'],
    queryFn: async () => {
      const { data, error } = await supabase.from('subcategories').select('*').order('sort_order');
      if (error) throw error;
      return data;
    },
    staleTime: 5 * 60 * 1000,
  });

  // Just enough of every item to give each section a photo. The full rows are
  // fetched by the category page, so this stays a few kilobytes.
  const { data: thumbs = [] } = useQuery({
    queryKey: ['menu-section-thumbs'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('menu_items')
        .select('id, subcategory_id, image_url, is_available, sort_order')
        .order('sort_order');
      if (error) throw error;
      return data;
    },
    staleTime: 5 * 60 * 1000,
  });

  const sectionsByCategory = useMemo(() => {
    // The first photographed item in each section, preferring one that is not sold out.
    const thumbBySub = new Map<string, (typeof thumbs)[number]>();
    for (const it of thumbs) {
      if (!it.image_url) continue;
      const current = thumbBySub.get(it.subcategory_id);
      if (!current || (it.is_available && !current.is_available)) thumbBySub.set(it.subcategory_id, it);
    }
    const map = new Map<string, { sub: SubcategoryRow; thumb?: { id: string; image_url: string | null } }[]>();
    for (const sub of subcategories) {
      const list = map.get(sub.category_id) ?? [];
      list.push({ sub, thumb: thumbBySub.get(sub.id) });
      map.set(sub.category_id, list);
    }
    return map;
  }, [subcategories, thumbs]);

  // Once per visit, and only after the session check has settled. Keying it on
  // `hasSession` sent one event with has_session:false while the guard was
  // still checking and a second with true, and another on every return from a
  // category page.
  React.useEffect(() => {
    if (guard === 'checking') return;
    try {
      if (sessionStorage.getItem('lasoul-menu-viewed')) return;
      sessionStorage.setItem('lasoul-menu-viewed', '1');
    } catch { /* storage blocked: an occasional duplicate is acceptable */ }
    track('menu_viewed', { has_session: hasSession, entry: 'home' });
  }, [guard, hasSession]);

  const storedQrToken = useCartStore((s) => s.qrToken);
  const cartCount = useCartStore((s) => s.items.length);
  const [confirmLeave, setConfirmLeave] = useState(false);
  // The URL token is gone after a reload or in the installed app; the one this
  // device scanned is still the venue's code.
  const changeTableHref = () => {
    const tk = token ?? storedQrToken;
    return tk ? `/start?token=${encodeURIComponent(tk)}` : '/start';
  };
  const onChangeTable = () => {
    if (cartCount > 0) setConfirmLeave(true);
    else navigate(changeTableHref());
  };

  // The category page records category_viewed itself (it is also reached
  // straight from printed QR codes); it only needs to know it came from here.
  const openCategory = (categoryName: string, section?: string) => {
    navigate(menuHref(categoryName, { section, table, token }), { state: { from: 'home' } });
  };

  const rtl = locale === 'ar';

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* A short brand band, not a full-screen splash: the first thing a guest
          at a table wants is the menu, so the photos sit above the fold. */}
      <motion.header
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: duration.base, ease: easeEnter }}
        className="hero-depth relative overflow-hidden px-5 pt-[max(1.25rem,env(safe-area-inset-top))] pb-9"
        style={{ backgroundColor: 'hsl(140, 12%, 53%)' }}
      >
        {/* The olive branch from the logo, as the band's artwork. Decorative,
            and faint enough that the buttons over it stay the thing you see. */}
        <img
          src="/brand/branch-white.webp"
          alt=""
          aria-hidden
          width={720}
          height={670}
          className="pointer-events-none select-none absolute -top-10 -end-20 w-64 opacity-[0.18] rtl:-scale-x-100"
        />
        {/* Row one is the brand and the language, nothing else, so the
            wordmark can be big enough to read across a table. */}
        <div className="relative z-10 flex items-center justify-between gap-3">
          <div dir="ltr" className="min-w-0">
            <img
              src="/brand/wordmark-white.webp"
              alt="La Soul"
              width={960}
              height={124}
              {...{ fetchpriority: 'high' }}
              className="h-7 w-auto drop-shadow-[0_1px_2px_rgba(0,0,0,0.15)]"
            />
            <p className="text-[10px] font-sans text-white/85 tracking-[0.34em] uppercase font-semibold mt-2.5 ps-0.5 rtl:tracking-normal rtl:text-xs">{t('menu')}</p>
          </div>
          <LanguageSelector variant="hero" />
        </div>

        {/* The first question many guests have, answered before they ask it. */}
        <p

          className="relative z-10 mt-3 inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-[11px] font-sans font-semibold text-white"
        >
          <BadgeCheck className="w-3.5 h-3.5" aria-hidden /> {t('halal_promise')}
        </p>

        {/* Row two is the table: where you are, and the one thing you can ask of it. */}
        {(table && hasSession) && (
          <div className="relative z-10 mt-5 flex items-center justify-between gap-2">
            <motion.button
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: duration.base, ease: easeEnter }}
              onClick={onChangeTable}
              className="px-4 min-h-[40px] rounded-full border border-white/25 bg-white/10 text-xs font-sans font-medium text-white tracking-wide rtl:tracking-normal hover:bg-white/20 transition-colors"
              title={t('not_your_table')}
            >
              {t('table_n', { n: table })} · <span className="underline underline-offset-2">{t('change_table')}</span>
            </motion.button>
            <CallWaiterButton variant="hero" />
          </div>
        )}
      </motion.header>

      <motion.main
        variants={staggerContainer()}
        initial="hidden"
        animate="show"
        className="flex-1 bg-background px-5 pt-5 pb-36 space-y-4 -mt-5 rounded-t-3xl relative z-10"
      >
        {/* Find-by-name across every category, before anything else —
            it is the first thing a guest looking for one specific thing wants. */}
        {/* Without a session the add buttons simply do not exist, and the
            only explanation used to be hidden inside an item's sheet. */}
        {guard !== 'checking' && !hasSession && (
          <div className="flex items-center gap-3 p-3.5 rounded-2xl bg-primary/10 border border-primary/20" role="note">
            <QrCode className="w-5 h-5 text-primary shrink-0" aria-hidden />
            <p className="text-sm font-sans text-foreground">{t('browse_scan_banner')}</p>
          </div>
        )}

        <MenuSearch canOrder={hasSession} />

        {hasSession && <RecentOrdersRow />}

        <div className="space-y-3">
          {categoriesLoading && [0, 1, 2].map((i) => <Skeleton key={i} className="w-full aspect-[16/9] rounded-2xl" />)}
          {categoriesFailed && (
            <div className="p-5 rounded-2xl border border-border bg-card text-center" role="alert">
              <p className="text-sm font-sans text-foreground">{t('load_failed')}</p>
              <button
                onClick={() => void refetchCategories()}
                className="mt-3 inline-flex items-center gap-2 px-4 min-h-[44px] rounded-full bg-primary text-primary-foreground text-sm font-sans font-medium"
              >
                <RefreshCw className="w-4 h-4" aria-hidden /> {t('try_again')}
              </button>
            </div>
          )}
          {categories.map((cat, i) => {
            const localizedName = getLocalizedName(cat as CategoryRow, locale);
            const cover = coverMap[cat.name];
            return (
              <motion.button
                key={cat.id}
                variants={fadeUp}
                whileTap={{ scale: PRESS_SCALE }}
                onClick={() => openCategory(cat.name)}
                className="relative block w-full aspect-[16/9] overflow-hidden rounded-2xl bg-muted text-start shadow-sm tap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                {cover ? (
                  <img
                    src={`/covers/${cover}-640.webp`}
                    srcSet={`/covers/${cover}-640.webp 640w, /covers/${cover}-1080.webp 1080w`}
                    sizes="(max-width: 640px) 100vw, 600px"
                    alt=""
                    width={640}
                    height={358}
                    loading={i === 0 ? 'eager' : 'lazy'}
                    // React 18 only passes the lowercase attribute through.
                    {...({ fetchpriority: i === 0 ? 'high' : 'auto' } as Record<string, string>)}
                    decoding="async"
                    className="absolute inset-0 w-full h-full object-cover"
                  />
                ) : cat.image_url ? (
                  <img src={cat.image_url} alt="" loading="lazy" decoding="async" className="absolute inset-0 w-full h-full object-cover" />
                ) : null}
                <span className="absolute inset-0 bg-gradient-to-t from-black/65 via-black/15 to-transparent" aria-hidden />
                <span className="absolute inset-x-0 bottom-0 p-4 flex items-end justify-between gap-3">
                  <span className="min-w-0">
                    <h2 className="font-serif text-2xl font-semibold text-white drop-shadow-sm">{localizedName}</h2>
                    {descKeyMap[cat.name] && (
                      <span className="block text-[13px] text-white/85 font-sans mt-0.5">{t(descKeyMap[cat.name])}</span>
                    )}
                  </span>
                  <span className="shrink-0 w-9 h-9 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center" aria-hidden>
                    <ChevronRight className={`w-4 h-4 text-white ${rtl ? 'rotate-180' : ''}`} />
                  </span>
                </span>
              </motion.button>
            );
          })}
        </div>

        {/* Every section of the menu, one tap away. Guests who know they want
            a burger should not have to open Food and then find Burgers. */}
        {subcategories.length > 0 && (
          <motion.nav variants={fadeUp} aria-label={t('menu_sections')} className="pt-3 space-y-4">
            <h2 className="font-serif text-lg font-semibold text-foreground">{t('jump_to')}</h2>
            {categories.map((cat) => {
              const sections = sectionsByCategory.get(cat.id) ?? [];
              if (sections.length < 2) return null;
              return (
                <div key={cat.id}>
                  <p className="text-[11px] font-sans font-semibold uppercase tracking-[0.18em] rtl:tracking-normal text-muted-foreground mb-2">
                    {getLocalizedName(cat as CategoryRow, locale)}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {sections.map(({ sub, thumb }) => {
                      const name = getLocalizedName(sub, locale);
                      return (
                        <button
                          key={sub.id}
                          onClick={() => openCategory(cat.name, sub.name)}
                          className="inline-flex items-center gap-2 ps-1 pe-3.5 py-1 min-h-[44px] rounded-full bg-card border border-border/70 text-sm font-sans font-medium text-foreground hover:border-primary/40 hover:bg-primary/5 active:scale-[0.97] transition-all"
                        >
                          {thumb?.image_url ? (
                            <SmartImage src={thumb.image_url} id={thumb.id} alt="" width={36} height={36} sizes="36px" square wrapperClassName="w-9 h-9 rounded-full shrink-0" fallbackText={name} />
                          ) : (
                            <span className="w-9 h-9 rounded-full bg-primary/10 shrink-0" aria-hidden />
                          )}
                          {name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </motion.nav>
        )}

        <InstallPrompt />

        <motion.footer variants={fadeUp} className="pt-4 border-t border-border/60 space-y-1">
          <a href={PHONE_HREF} className="flex items-center gap-3 py-2.5 text-sm font-sans text-foreground hover:text-primary transition-colors">
            <span className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0"><Phone className="w-4 h-4 text-primary" /></span>
            <span className="min-w-0">
              <span className="block text-[11px] text-muted-foreground">{t('call_us')}</span>
              <span dir="ltr" className="block">+387 33 877 779</span>
            </span>
          </a>
          <a href={MAPS_HREF} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 py-2.5 text-sm font-sans text-foreground hover:text-primary transition-colors">
            <span className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0"><MapPin className="w-4 h-4 text-primary" /></span>
            <span className="min-w-0">
              <span className="block text-[11px] text-muted-foreground">{t('find_us')}</span>
              <span className="block">{t('address')}</span>
            </span>
          </a>
          <Link to="/privacy" className="block text-center text-[11px] text-muted-foreground/70 font-sans hover:text-primary transition-colors pt-3">
            {t('privacy_security')}
          </Link>
        </motion.footer>
      </motion.main>

      {hasSession && <CartBar />}

      <AlertDialog open={confirmLeave} onOpenChange={setConfirmLeave}>
        <AlertDialogContent className="max-w-sm rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-serif">{t('leave_table_q')}</AlertDialogTitle>
            <AlertDialogDescription>{t('leave_table_body')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel className="min-h-[44px] rounded-xl">{t('stay')}</AlertDialogCancel>
            <AlertDialogAction className="min-h-[44px] rounded-xl" onClick={() => navigate(changeTableHref())}>{t('leave')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default GuestMenu;
