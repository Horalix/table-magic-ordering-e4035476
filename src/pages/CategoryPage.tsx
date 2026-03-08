import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Plus, Minus, ShoppingBag, X } from 'lucide-react';
import { menuData } from '@/lib/menu-data';
import { useCartStore } from '@/lib/cart-store';
import { Button } from '@/components/ui/button';
import CartBar from '@/components/guest/CartBar';
import MenuItemDetail from '@/components/guest/MenuItemDetail';

const CategoryPage = () => {
  const { type } = useParams<{ type: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [selectedSubcategory, setSelectedSubcategory] = useState<string | null>(null);
  const [selectedItem, setSelectedItem] = useState<any | null>(null);
  const { addItem, itemCount } = useCartStore();

  const table = searchParams.get('table');
  const token = searchParams.get('token');

  const category = menuData.find((c) => c.type === type);
  if (!category) return <div className="p-6">Category not found</div>;

  const activeSubcategory = selectedSubcategory || category.subcategories[0]?.name;

  const goBack = () => {
    const params = new URLSearchParams();
    if (table) params.set('table', table);
    if (token) params.set('token', token);
    navigate(`/menu?${params.toString()}`);
  };

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
          {category.subcategories.map((sub) => (
            <button
              key={sub.name}
              onClick={() => setSelectedSubcategory(sub.name)}
              className={`px-4 py-2 rounded-full text-sm font-sans font-medium whitespace-nowrap transition-all ${
                activeSubcategory === sub.name
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
        {category.subcategories
          .filter((sub) => sub.name === activeSubcategory)
          .map((sub) =>
            sub.items.map((item, i) => (
              <motion.div
                key={item.name}
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
                      <p className="text-sm font-sans font-semibold text-accent mt-2">{item.price.toFixed(2)} KM</p>
                    </div>
                    <div className="flex items-center">
                      <div
                        onClick={(e) => {
                          e.stopPropagation();
                          addItem({
                            id: `${type}-${sub.name}-${item.name}`,
                            name: item.name,
                            price: item.price,
                            image_url: item.image_url,
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
            ))
          )}
      </div>

      {/* Item Detail Modal */}
      <AnimatePresence>
        {selectedItem && (
          <MenuItemDetail
            item={selectedItem}
            categoryType={type || ''}
            subcategoryName={activeSubcategory}
            onClose={() => setSelectedItem(null)}
          />
        )}
      </AnimatePresence>

      {/* Cart Bar */}
      <CartBar />
    </div>
  );
};

export default CategoryPage;
