import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { X, Plus, Minus, QrCode, UtensilsCrossed } from 'lucide-react';
import { useCartStore } from '@/lib/cart-store';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

interface Props {
  item: {
    id: string;
    name: string;
    description?: string;
    price: number;
    image_url?: string;
  };
  onClose: () => void;
  canOrder?: boolean;
}

const MenuItemDetail = ({ item, onClose, canOrder = true }: Props) => {
  const [quantity, setQuantity] = useState(1);
  const [notes, setNotes] = useState('');
  const { addItem } = useCartStore();

  const handleAdd = () => {
    if (!canOrder) return;
    for (let i = 0; i < quantity; i++) {
      addItem({
        id: item.id,
        name: item.name,
        price: item.price,
        image_url: item.image_url,
        notes: notes || undefined,
      });
    }
    onClose();
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
    >
      <div className="absolute inset-0 bg-foreground/40 backdrop-blur-sm" onClick={onClose} />

      <motion.div
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 28, stiffness: 300 }}
        className="relative w-full max-w-lg bg-card rounded-t-3xl sm:rounded-3xl overflow-hidden"
      >
        {/* [UX] Close button with proper touch target */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 z-10 w-10 h-10 rounded-full bg-card/80 backdrop-blur flex items-center justify-center min-w-[44px] min-h-[44px]"
          aria-label="Close"
        >
          <X className="w-4 h-4 text-foreground" />
        </button>

        {item.image_url ? (
          <div className="w-full h-52 bg-muted overflow-hidden">
            <img src={item.image_url} alt={item.name} className="w-full h-full object-cover" />
          </div>
        ) : (
          /* [ART] Styled placeholder when no image */
          <div className="w-full h-36 bg-primary/5 flex items-center justify-center">
            <UtensilsCrossed className="w-10 h-10 text-primary/20" />
          </div>
        )}

        <div className="p-6">
          <h2 className="font-serif text-2xl font-bold text-foreground">{item.name}</h2>
          {item.description && (
            <p className="text-sm text-muted-foreground font-sans mt-2 leading-relaxed">{item.description}</p>
          )}
          <p className="text-lg font-sans font-bold text-primary mt-3">{item.price.toFixed(2)} KM</p>

          {canOrder ? (
            <>
              <div className="mt-5">
                <label className="text-sm font-sans font-medium text-foreground">Special requests</label>
                <Textarea
                  placeholder="E.g. no onions, extra sauce..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="mt-1.5 bg-muted border-border text-sm"
                  rows={2}
                />
              </div>

              <div className="flex items-center gap-4 mt-6">
                <div className="flex items-center gap-3 bg-muted rounded-full px-2 py-1">
                  <button
                    onClick={() => setQuantity(Math.max(1, quantity - 1))}
                    className="w-9 h-9 rounded-full flex items-center justify-center hover:bg-card transition-colors min-w-[44px] min-h-[44px]"
                    aria-label="Decrease quantity"
                  >
                    <Minus className="w-4 h-4" />
                  </button>
                  <span className="text-base font-sans font-semibold w-6 text-center">{quantity}</span>
                  <button
                    onClick={() => setQuantity(quantity + 1)}
                    className="w-9 h-9 rounded-full flex items-center justify-center hover:bg-card transition-colors min-w-[44px] min-h-[44px]"
                    aria-label="Increase quantity"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>

                {/* [ART] Sage green CTA */}
                <Button
                  onClick={handleAdd}
                  className="flex-1 h-12 rounded-full bg-primary text-primary-foreground font-sans font-semibold text-base hover:bg-sage-dark transition-colors"
                >
                  Add to order · {(item.price * quantity).toFixed(2)} KM
                </Button>
              </div>
            </>
          ) : (
            <div className="mt-6 flex items-center gap-3 px-4 py-3.5 rounded-xl bg-accent/8 border border-accent/15">
              <QrCode className="w-4 h-4 text-accent flex-shrink-0" />
              <p className="text-xs font-sans text-accent">
                Scan the QR code at your table to order
              </p>
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
};

export default MenuItemDetail;
