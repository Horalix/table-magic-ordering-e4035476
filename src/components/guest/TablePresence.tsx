import React, { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { UserPlus } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useCartStore } from '@/lib/cart-store';
import { Button } from '@/components/ui/button';
import { useT } from '@/lib/i18n';
import { springSoft, fade } from '@/lib/motion';

interface JoinReq {
  id: string;
  guest_name: string;
  client_id: string;
  status: 'pending' | 'approved' | 'declined';
}

/**
 * Mounted globally for guests. When this device is in an active table session,
 * it listens for other phones requesting to join and shows an Accept/Decline
 * prompt. Anyone already at the table can approve; realtime closes the prompt
 * on everyone's phone once one person acts (or the 30s auto-approve fires).
 */
const TablePresence = () => {
  const sessionId = useCartStore((s) => s.sessionId);
  const clientId = useCartStore((s) => s.clientId);
  const guestName = useCartStore((s) => s.guestName);
  const t = useT();
  const [pending, setPending] = useState<JoinReq[]>([]);

  const load = useCallback(async () => {
    if (!sessionId) { setPending([]); return; }
    const { data } = await supabase
      .from('session_join_requests')
      .select('id, guest_name, client_id, status')
      .eq('table_session_id', sessionId)
      .eq('status', 'pending')
      .order('created_at', { ascending: true });
    // Never prompt a device to approve its own request.
    setPending((data || []).filter((r) => r.client_id !== clientId) as JoinReq[]);
  }, [sessionId, clientId]);

  useEffect(() => {
    if (!sessionId) { setPending([]); return; }
    load();
    const ch = supabase
      .channel(`presence-${sessionId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'session_join_requests', filter: `table_session_id=eq.${sessionId}` },
        () => load(),
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [sessionId, load]);

  const resolve = async (id: string, status: 'approved' | 'declined') => {
    setPending((p) => p.filter((r) => r.id !== id)); // optimistic
    await supabase
      .from('session_join_requests')
      .update({ status, resolved_by_name: guestName || null })
      .eq('id', id)
      .eq('status', 'pending');
  };

  const current = pending[0];

  return (
    <AnimatePresence>
      {current && (
        <motion.div
          key={current.id}
          variants={fade}
          initial="hidden"
          animate="show"
          exit="exit"
          className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center"
        >
          <div className="absolute inset-0 bg-foreground/40 backdrop-blur-sm" />
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={springSoft}
            className="relative w-full max-w-sm bg-card rounded-t-3xl sm:rounded-3xl p-6 text-center shadow-lux-lg"
          >
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
              <UserPlus className="w-8 h-8 text-primary" />
            </div>
            <h2 className="font-serif text-xl font-bold text-primary">{current.guest_name}</h2>
            <p className="text-sm text-muted-foreground font-sans mt-1">{t('wants_to_join')}</p>
            <div className="mt-6 flex gap-3">
              <Button variant="outline" className="flex-1 rounded-full tap" onClick={() => resolve(current.id, 'declined')}>
                {t('decline')}
              </Button>
              <Button
                className="flex-1 rounded-full bg-primary text-primary-foreground hover:bg-sage-dark tap"
                onClick={() => resolve(current.id, 'approved')}
              >
                {t('accept')}
              </Button>
            </div>
            {pending.length > 1 && (
              <p className="text-[11px] text-muted-foreground mt-3 font-sans tabular-nums">+{pending.length - 1} more waiting</p>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default TablePresence;
