import React, { useState, useEffect, useMemo, useDeferredValue } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Plus, Minus, QrCode, Search, X } from 'lucide-react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useCartStore } from '@/lib/cart-store';
import { Skeleton } from '@/components/ui/skeleton';
import SmartImage from '@/components/ui/SmartImage';
import { prefetchImages } from '@/lib/image-cache';
import CartBar from '@/components/guest/CartBar';
import MenuItemDetail from '@/components/guest/MenuItemDetail';
import LanguageSelector from '@/components/guest/LanguageSelector';
import { useT, useLanguageStore, getLocalizedName, getLocalizedDescription } from '@/lib/i18n';
import { useSessionHeartbeat } from '@/hooks/useSessionHeartbeat';

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
  const [selectedItem, setSelectedItem] = useState<any | null>(null);
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search);
  const { addItem, removeItem, updateQuantity, items: cartItems } = useCartStore();
  const t = useT();
  const locale = useLanguageStore((s) => s.locale);

  const table = searchParams.get('table');
  const token = searchParams.get('token');
  const hasSession = !!(table && token);

  const categoryName = categoryNameMap[type || ''] || type;

  const { data: category } = useQuery({
    queryKey: ['category', categoryName],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('categories')
        .select('*')
        .eq('name', categoryName)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const { data: subcategories = [] } = useQuery({
    queryKey: ['subcategories', category?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('subcategories')
        .select('*')
        .eq('category_id', category!.id)
        .order('sort_order');
      if (error) throw error;
      return data;
    },
    enabled: !!category?.id,
  });

  const activeSubId = selectedSubcategory || subcategories[0]?.id;

  const { data: items = [], isLoading: itemsLoading } = useQuery({
    queryKey: ['menu_items', activeSubId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('menu_items')
        .select('*')
        .eq('subcategory_id', activeSubId!)
        .eq('is_available', true)
        .order('sort_order');
      if (error) throw error;
      return data;
    },
    enabled: !!activeSubId,
    placeholderData: keepPreviousData,
  });

  // Prefetch images for adjacent subcategories on idle
  useEffect(() => {
    if (!subcategories.length || !activeSubId) return;
    const idx = subcategories.findIndex((s) => s.id === activeSubId);
    const next = subcategories[idx + 1];
    if (!next) return;
    supabase
      .from('menu_items')
      .select('image_url')
      .eq('subcategory_id', next.id)
      .eq('is_available', true)
      .limit(8)
      .then(({ data }) => {
        if (data) prefetchImages(data.map((d: any) => d.image_url));
      });
  }, [activeSubId, subcategories]);

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
          {[1, 2, 3, 4].map(i => (
            <Skeleton key={i} className="h-20 w-full rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-32">
      <div className="sticky top-0 z-30 glass">
        <div className="flex items-center gap-3 px-4 py-4">
          <button onClick={goBack} className="p-2.5 -ml-2 rounded-full hover:bg-muted transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center">
            <ArrowLeft className={`w-5 h-5 text-foreground ${locale === 'ar' ? 'rotate-180' : ''}`} />
          </button>
          <h1 className="font-serif text-xl font-semibold text-foreground">
            {getLocalizedName(category as any, locale)}
          </h1>
          <div className="ml-auto flex items-center gap-2">
            {table && (
              <span className="text-xs font-sans px-3 py-1 rounded-full bg-primary/10 text-primary font-medium">
                {t('table')} {table}
              </span>
            )}
            <LanguageSelector />
          </div>
        </div>
        <div className="h-px bg-gradient-to-r from-transparent via-primary/20 to-transparent" />

        {subcategories.length > 0 && (
          <div className="flex gap-1.5 px-4 py-3 overflow-x-auto scrollbar-hide">
            {subcategories.map((sub) => {
              const isActive = activeSubId === sub.id;
              return (
                <button
                  key={sub.id}
                  onClick={() => setSelectedSubcategory(sub.id)}
                  className={`relative px-4 py-2.5 rounded-full text-sm font-sans font-medium whitespace-nowrap min-h-[44px] tap ${
                    isActive ? 'text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {isActive && (
                    <motion.span
                      layoutId="active-sub-pill"
                      transition={{ type: 'spring', stiffness: 500, damping: 38 }}
                      className="absolute inset-0 rounded-full bg-primary shadow-sm"
                    />
                  )}
                  <span className="relative z-10">{getLocalizedName(sub as any, locale)}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {!hasSession && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="mx-4 mt-3 px-4 py-3 rounded-xl bg-accent/8 border border-accent/15 flex items-center gap-3"
        >
          <QrCode className="w-4 h-4 text-accent flex-shrink-0" />
          <p className="text-xs font-sans text-accent">{t('scan_qr_order')}</p>
        </motion.div>
      )}

      {itemsLoading ? (
        <div className="px-4 pt-4 space-y-3">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="flex gap-4 p-4 rounded-xl border border-border bg-card">
              <Skeleton className="w-20 h-20 rounded-lg flex-shrink-0" />
              <div className="flex-1 space-y-2 py-1">
                <Skeleton className="h-4 w-2/3 rounded" />
                <Skeleton className="h-3 w-full rounded" />
                <Skeleton className="h-4 w-16 rounded mt-2" />
              </div>
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 px-6">
          <p className="text-muted-foreground font-sans text-sm text-center">{t('no_items_category')}</p>
        </div>
      ) : (
        <div className="px-4 pt-4 space-y-3">
          {items.map((item, i) => {
            const localizedName = getLocalizedName(item as any, locale);
            const localizedDesc = getLocalizedDescription(item as any, locale);
            return (
              <motion.div
                key={item.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(i, 5) * 0.02, duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
              >
                <button
                  onClick={() => setSelectedItem(item)}
                  className="w-full text-left tap"
                >
                  <div className="group flex gap-4 p-4 rounded-xl border border-border bg-card hover:border-primary/30 hover:shadow-md hover:-translate-y-0.5 transition-all duration-200">
                    <SmartImage
                      src={item.image_url || undefined}
                      alt={localizedName}
                      width={80}
                      height={80}
                      priority={i < 8}
                      fallbackText={localizedName}
                      wrapperClassName="w-20 h-20 rounded-lg flex-shrink-0"
                      className="group-hover:scale-105 transition-transform duration-300"
                    />
                    <div className="flex-1 min-w-0">
                      <h3 className="font-serif text-base font-semibold text-foreground">{localizedName}</h3>
                      {localizedDesc && (
                        <p className="text-sm text-muted-foreground font-sans mt-0.5 line-clamp-2">{localizedDesc}</p>
                      )}
                      <p className="text-sm font-sans font-bold text-primary mt-2 tabular-nums">{Number(item.price).toFixed(2)} KM</p>
                    </div>
                    {hasSession && (
                      <div className="flex items-center">
                        <div
                          onClick={(e) => {
                            e.stopPropagation();
                            addItem({
                              id: item.id,
                              name: item.name,
                              price: Number(item.price),
                              image_url: item.image_url || undefined,
                            });
                            if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
                              try { (navigator as any).vibrate(8); } catch {}
                            }
                          }}
                          className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center hover:bg-primary hover:text-primary-foreground active:scale-90 transition-all duration-150 cursor-pointer min-w-[44px] min-h-[44px] tap-sm"
                        >
                          <Plus className="w-4 h-4" />
                        </div>
                      </div>
                    )}
                  </div>
                </button>
              </motion.div>
            );
          })}
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
