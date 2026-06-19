import React, { useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Hand, Check } from 'lucide-react';
import { useCartStore } from '@/lib/cart-store';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useT } from '@/lib/i18n';

interface Props {
  variant?: 'default' | 'hero';
}

const CallWaiterButton = ({ variant = 'default' }: Props) => {
  const { sessionId } = useCartStore();
  const [called, setCalled] = useState(false);
  const [loading, setLoading] = useState(false);
  const callingRef = useRef(false);
  const t = useT();

  if (!sessionId) return null;

  const handleCall = async () => {
    if (called || callingRef.current) return;
    callingRef.current = true;
    setLoading(true);

    try {
      const { error } = await supabase
        .from('waiter_calls')
        .insert({ table_session_id: sessionId });

      if (error) throw error;

      setCalled(true);
      toast.success(t('waiter_notified'));
      setTimeout(() => setCalled(false), 30000);
    } catch (err) {
      console.error('Call waiter error:', err);
      toast.error('Could not notify waiter. Please try again.');
    } finally {
      callingRef.current = false;
      setLoading(false);
    }
  };

  const isHero = variant === 'hero';

  return (
    <motion.button
      onClick={handleCall}
      disabled={called || loading}
      aria-busy={loading}
      whileTap={{ scale: 0.95 }}
      className={`flex items-center gap-2 px-4 py-2.5 rounded-full font-sans text-sm font-medium transition-all duration-300 ${
        called
          ? isHero
            ? 'bg-white/20 text-white border border-white/30'
            : 'bg-primary/10 text-primary border border-primary/20'
          : isHero
            ? 'bg-white/10 text-white border border-white/20 hover:bg-white/20'
            : 'bg-accent/10 text-accent border border-accent/20 hover:bg-accent/20'
      }`}
    >
      <AnimatePresence mode="wait">
        {called ? (
          <motion.span key="check" initial={{ scale: 0 }} animate={{ scale: 1 }} className="flex items-center gap-2">
            <Check className="w-4 h-4" />
            {t('waiter_notified')}
          </motion.span>
        ) : (
          <motion.span key="call" initial={{ scale: 0 }} animate={{ scale: 1 }} className="flex items-center gap-2">
            <Hand className="w-4 h-4" />
            {loading ? t('calling') : t('call_waiter')}
          </motion.span>
        )}
      </AnimatePresence>
    </motion.button>
  );
};

export default CallWaiterButton;
