import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Plus } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useCartStore } from '@/lib/cart-store';
import CartBar from '@/components/guest/CartBar';
import MenuItemDetail from '@/components/guest/MenuItemDetail';

const categoryNameMap: Record<string, string> = {
  drinks: 'Drinks',
  food: 'Food',
  desserts: 'Desserts',
  dessert: 'Desserts',
};

const CategoryPage = () => {
  const { type } = useParams<{ type: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [selectedSubcategory, setSelectedSubcategory] = useState<string | null>(null);
  const [selectedItem, setSelectedItem] = useState<any | null>(null);
  const { addItem } = useCartStore();

  const table = searchParams.get('table');
  const token = searchParams.get('token');

  const categoryName = categoryNameMap[type || ''] || type;

  // Fetch category
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

  // Fetch subcategories
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

  // Active subcategory
  const activeSubId = selectedSubcategory || subcategories[0]?.id;
  const activeSub = subcategories.find((s) => s.id === activeSubId);

  // Fetch items for active subcategory
  const { data: items = [] } = useQuery({
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
  });

  const goBack = () => {
    const params = new URLSearchParams();
    if (table) params.set('table', table);
    if (token) params.set('token', token);
    navigate(`/menu?${params.toString()}`);
  };

  if (!category) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-32">
      {/* Header */}
      <div className="sticky top-0 z-30 glass">
        <div className="flex items-center gap-3 px-4 py-4">
          <button onClick={goBack} className="p-2 -ml-2 rounded-full hover:bg-muted transition-colors">
            <ArrowLeft className="w-5 h-5 text-foreground" />
          </button>
          <h1 className="font-serif text-xl font-semibold text-foreground">{category.name}</h1>
          {table && (
            <span className="ml-auto text-xs font-sans px-3 py-1 rounded-full bg-primary/10 text-primary">
              Table {table}
            </span>
          )}
        </div>

        {/* Subcategory tabs */}
        <div className="flex gap-1 px-4 pb-3 overflow-x-auto scrollbar-hide">
          {subcategories.map((sub) => (
            <button
              key={sub.id}
              onClick={() => setSelectedSubcategory(sub.id)}
              className={`px-4 py-2 rounded-full text-sm font-sans font-medium whitespace-nowrap transition-all ${
                activeSubId === sub.id
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80'
              }`}
            >
              {sub.name}
            </button>
          ))}
        </div>
      </div>

      {/* Items */}
      <div className="px-4 pt-4 space-y-3">
        {items.map((item, i) => (
          <motion.div
            key={item.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05, duration: 0.3 }}
          >
            <button
              onClick={() => setSelectedItem(item)}
              className="w-full text-left"
            >
              <div className="flex gap-4 p-4 rounded-xl border border-border bg-card hover:border-primary/20 hover:shadow-sm transition-all">
                {item.image_url && (
                  <div className="w-20 h-20 rounded-lg overflow-hidden flex-shrink-0 bg-muted">
                    <img src={item.image_url} alt={item.name} className="w-full h-full object-cover" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <h3 className="font-serif text-base font-semibold text-foreground">{item.name}</h3>
                  {item.description && (
                    <p className="text-sm text-muted-foreground font-sans mt-0.5 line-clamp-2">{item.description}</p>
                  )}
                  <p className="text-sm font-sans font-semibold text-accent mt-2">{Number(item.price).toFixed(2)} KM</p>
                </div>
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
                    }}
                    className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center hover:bg-primary hover:text-primary-foreground transition-colors cursor-pointer"
                  >
                    <Plus className="w-4 h-4" />
                  </div>
                </div>
              </div>
            </button>
          </motion.div>
        ))}
      </div>

      {/* Item Detail Modal */}
      <AnimatePresence>
        {selectedItem && (
          <MenuItemDetail
            item={{
              id: selectedItem.id,
              name: selectedItem.name,
              description: selectedItem.description || undefined,
              price: Number(selectedItem.price),
              image_url: selectedItem.image_url || undefined,
            }}
            onClose={() => setSelectedItem(null)}
          />
        )}
      </AnimatePresence>

      <CartBar />
    </div>
  );
};

export default CategoryPage;
