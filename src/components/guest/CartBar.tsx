import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence, useAnimate } from 'framer-motion';
import { ShoppingBag, Receipt } from 'lucide-react';
import { useCartStore } from '@/lib/cart-store';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useT, useI18n } from '@/lib/i18n';
import { duration, easeEnter, easeExit, exitTransition, springSnappy, useCountUp } from '@/lib/motion';
import { ADDED_LABEL_MS, useCartFx } from '@/lib/cart-fx';

/**
 * The one bar at the bottom of the menu.
 *
 * It goes straight to the order screen. It used to open a quick-view sheet
 * whose own "Checkout" button led to the order screen whose "Checkout" button
 * opened the payment sheet: three hops to send one burger. The tab link only
 * appears once the table has actually ordered something; before that it was a
 * second full-width bar covering the last dish on every page.
 *
 * It is also where an add lands: the dish photo flies into the bag
 * (`data-cart-target`, see FlyToCart), the bag pulses, and the label reads
 * "+ {name}" for a moment instead of a toast at the top of the screen.
 */
const CartBar = () => {
  const { total, itemCount, sessionId } = useCartStore();
  const sessionToken = useCartStore((s) => s.sessionToken);
  const storeTable = useCartStore((s) => s.tableNumber);
  const lastOrderTime = useCartStore((s) => s.lastOrderTime);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const count = itemCount();
  const t = useT();
  const { price, plural } = useI18n();
  const displayTotal = useCountUp(total());

  // The session lives in the store, not the URL. The PWA start_url is /menu
  // with no query string, so deriving it from search params made the cart bar
  // vanish for every installed-app guest while the add buttons stayed visible.
  const table = searchParams.get('table') ?? (storeTable ? String(storeTable) : null);
  const token = searchParams.get('token');
  const hasSession = !!(sessionId && sessionToken);
  const hasOrdered = lastOrderTime !== null;

  const [bounce, setBounce] = useState(0);
  const prevCount = React.useRef(count);
  useEffect(() => {
    // Only celebrate additions. Removing an item used to play the same pop.
    if (count > prevCount.current) setBounce((b) => b + 1);
    prevCount.current = count;
  }, [count]);

  // "+ Flat white" for a moment after each add, and the same news, with the
  // new count and total, for screen readers.
  const lastAdd = useCartFx((s) => s.lastAdd);
  const [addedName, setAddedName] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  useEffect(() => {
    if (!lastAdd) return;
    const left = ADDED_LABEL_MS - (Date.now() - lastAdd.at);
    if (left <= 0) return;
    setAddedName(lastAdd.name);
    setAnnouncement(t('cart_added_status', {
      name: lastAdd.name, items: plural('items_count', count), total: price(total()),
    }));
    const timer = setTimeout(() => setAddedName(null), left);
    return () => clearTimeout(timer);
    // Keyed on the add itself: a later quantity change must not re-announce it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastAdd]);

  // The bag pulses when a flight lands in it.
  const [bagScope, animateBag] = useAnimate<HTMLSpanElement>();
  const landed = useCartFx((s) => s.landed);
  const landedAtMount = useRef(landed);
  useEffect(() => {
    if (landed === landedAtMount.current || !bagScope.current) return;
    let cancelled = false;
    void Promise.resolve(animateBag(bagScope.current, { scale: 1.15 }, springSnappy)).then(() => {
      if (!cancelled && bagScope.current) animateBag(bagScope.current, { scale: 1 }, springSnappy);
    });
    return () => { cancelled = true; };
  }, [landed, animateBag, bagScope]);

  if (!hasSession) return null;

  const buildParams = () => {
    const params = new URLSearchParams();
    if (table) params.set('table', table);
    if (token) params.set('token', token);
    const qs = params.toString();
    return qs ? `?${qs}` : '';
  };

  const showBar = count > 0 || hasOrdered;
  const label = addedName ? t('cart_added_name', { name: addedName }) : t('view_order');

  return (
    <>
      {/* Mounted before the first add, so the first announcement is heard. */}
      <div role="status" aria-live="polite" className="sr-only">{announcement}</div>
      {showBar && (
        <div className="fixed bottom-0 inset-x-0 z-40 px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] pointer-events-none">
          <div className="flex items-stretch gap-2 max-w-lg mx-auto">
            {hasOrdered && (
              <motion.button
                initial={{ y: 40, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={springSnappy}
                onClick={() => navigate(`/tab${buildParams()}`)}
                aria-label={t('view_your_tab')}
                className={`pointer-events-auto flex items-center justify-center gap-2 rounded-2xl bg-card/95 backdrop-blur-lg border border-border text-foreground font-sans text-sm font-medium shadow-lg hover:bg-muted transition-colors min-h-[56px] tap ${count > 0 ? 'w-14 shrink-0' : 'flex-1 px-4'}`}
              >
                <Receipt className="w-5 h-5 text-primary" aria-hidden />
                {count === 0 && t('view_your_tab')}
              </motion.button>
            )}

            <AnimatePresence>
              {count > 0 && (
                <motion.button
                  data-cart-bar
                  initial={{ y: 100, opacity: 0, scale: 0.95 }}
                  animate={{ y: 0, opacity: 1, scale: 1, transition: springSnappy }}
                  exit={{ y: 100, opacity: 0, scale: 0.95, transition: exitTransition }}
                  onClick={() => navigate(`/cart${buildParams()}`)}
                  className="pointer-events-auto flex-1 min-w-0 flex items-center justify-between gap-3 px-5 rounded-2xl bg-sage-dark text-white shadow-xl shadow-primary/30 hover:shadow-primary/40 transition-shadow min-h-[56px] tap"
                >
                  <span className="flex items-center gap-3 min-w-0">
                    <span ref={bagScope} data-cart-target className="relative shrink-0 inline-flex">
                      <ShoppingBag className="w-5 h-5" aria-hidden />
                      <motion.span
                        key={bounce}
                        initial={{ scale: 0.6 }}
                        animate={{ scale: 1 }}
                        transition={springSnappy}
                        className="absolute -top-2 -end-2 min-w-5 h-5 px-1 rounded-full bg-accent text-accent-foreground text-xs font-bold flex items-center justify-center tabular-nums"
                      >
                        {count}
                      </motion.span>
                    </span>
                    <AnimatePresence mode="popLayout" initial={false}>
                      <motion.span
                        key={addedName ? `added-${addedName}` : 'view'}
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0, transition: { duration: duration.fast, ease: easeEnter } }}
                        exit={{ opacity: 0, y: -6, transition: { duration: duration.fast, ease: easeExit } }}
                        className="font-sans font-semibold text-base truncate"
                      >
                        {label}
                      </motion.span>
                    </AnimatePresence>
                  </span>
                  <span className="font-sans font-bold text-base tabular-nums shrink-0">
                    {price(displayTotal)}
                  </span>
                </motion.button>
              )}
            </AnimatePresence>
          </div>
        </div>
      )}
    </>
  );
};

export default CartBar;
