import React, { useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { supabase } from '@/integrations/supabase/client';
import { useCartStore } from '@/lib/cart-store';
import { Loader2, AlertCircle, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import GuestNameModal from '@/components/guest/GuestNameModal';
import { useT } from '@/lib/i18n';

type Phase = 'loading' | 'error' | 'name' | 'waiting' | 'declined';

// If nobody at the table responds in this window, the joiner is let in
// automatically so a sleeping host phone never leaves them stuck.
const AUTO_APPROVE_MS = 30000;

// The join-request table isn't in the generated Supabase types yet; the
// codebase casts anon writes as any, so we follow that convention here.
const sjr = () => (supabase as any).from('session_join_requests');

const TableEntry = () => {
  const { tableNumber } = useParams<{ tableNumber: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { setTable, setSessionId, setGuestName, startHeartbeat, clientId } = useCartStore();
  const t = useT();

  const [phase, setPhase] = useState<Phase>('loading');
  const [error, setError] = useState<string | null>(null);
  const [role, setRole] = useState<'host' | 'joiner'>('host');
  const [sessionId, setLocalSessionId] = useState<string | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);
  const nameRef = useRef<string>('');

  const token = searchParams.get('token');

  const enterMenu = (sid: string, name: string) => {
    setTable(parseInt(tableNumber!), token!);
    setSessionId(sid);
    setGuestName(name);
    startHeartbeat();
    const params = new URLSearchParams({ table: tableNumber!, token: token! });
    navigate(`/menu?${params.toString()}`, { replace: true });
  };

  // 1. Validate QR and resolve whether this device is host / returning / joiner.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!tableNumber || !token) { setError(t('invalid_qr')); setPhase('error'); return; }
      try {
        const { data: table, error: tableError } = await supabase
          .from('tables').select('id').eq('table_number', parseInt(tableNumber)).eq('qr_token', token).single();
        if (cancelled) return;
        if (tableError || !table) { setError(t('qr_expired')); setPhase('error'); return; }

        const { data: existing } = await (supabase as any)
          .from('table_sessions')
          .select('*')
          .eq('table_id', table.id).eq('is_active', true).maybeSingle();
        if (cancelled) return;

        setTable(parseInt(tableNumber), token);

        if (!existing) { setRole('host'); setPhase('name'); return; }

        setLocalSessionId(existing.id);

        // Returning device: already the host, or already approved here.
        if (existing.host_client_id && existing.host_client_id === clientId) {
          enterMenu(existing.id, existing.guest_name || t('new_guest'));
          return;
        }
        const { data: mine } = await sjr()
          .select('guest_name, status')
          .eq('table_session_id', existing.id).eq('client_id', clientId)
          .eq('status', 'approved').maybeSingle();
        if (cancelled) return;
        if (mine) { enterMenu(existing.id, mine.guest_name || t('new_guest')); return; }

        setRole('joiner');
        setPhase('name');
      } catch (e) {
        console.error('Table entry error:', e);
        if (!cancelled) { setError(t('something_wrong')); setPhase('error'); }
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tableNumber, token]);

  const createJoinRequest = async (sid: string, name: string) => {
    const { data, error: rErr } = await sjr()
      .insert({ table_session_id: sid, guest_name: name, client_id: clientId, status: 'pending' })
      .select('id').single();

    if (rErr) {
      // A pending/approved request may already exist for this device — resume it.
      const { data: existingReq } = await sjr()
        .select('id, status')
        .eq('table_session_id', sid).eq('client_id', clientId)
        .order('created_at', { ascending: false }).limit(1).maybeSingle();
      if (existingReq?.status === 'approved') { enterMenu(sid, name); return; }
      if (existingReq?.id) { setRequestId(existingReq.id); setPhase('waiting'); return; }
      setError(t('table_not_active')); setPhase('error'); return;
    }
    setRequestId(data.id);
    setPhase('waiting');
  };

  const handleNameSubmit = async (name: string) => {
    nameRef.current = name;

    if (role === 'joiner') {
      if (!sessionId) { setError(t('table_not_active')); setPhase('error'); return; }
      await createJoinRequest(sessionId, name);
      return;
    }

    // Host: re-check for a session that appeared in the meantime, else create.
    const { data: table } = await supabase
      .from('tables').select('id').eq('table_number', parseInt(tableNumber!)).eq('qr_token', token!).single();
    if (!table) { setError(t('qr_expired')); setPhase('error'); return; }

    const { data: existing2 } = await (supabase as any)
      .from('table_sessions').select('*')
      .eq('table_id', table.id).eq('is_active', true).maybeSingle();

    if (existing2) {
      setLocalSessionId(existing2.id);
      if (existing2.host_client_id === clientId) { enterMenu(existing2.id, name); return; }
      setRole('joiner');
      await createJoinRequest(existing2.id, name);
      return;
    }

    // Create the session as host. Fall back to a plain insert if the join
    // migration (host_client_id column) hasn't been applied yet, so single-
    // phone ordering keeps working regardless.
    let created = await (supabase as any)
      .from('table_sessions')
      .insert({ table_id: table.id, host_client_id: clientId, guest_name: name })
      .select('id').single();
    if (created.error) {
      created = await (supabase as any)
        .from('table_sessions')
        .insert({ table_id: table.id })
        .select('id').single();
    }
    if (created.error || !created.data) { setError(t('session_failed')); setPhase('error'); return; }
    enterMenu(created.data.id, name);
  };

  // 2. While waiting: listen for approval/decline + auto-approve fallback.
  useEffect(() => {
    if (phase !== 'waiting' || !requestId || !sessionId) return;
    let done = false;

    const resolve = (status: string) => {
      if (done) return;
      if (status === 'approved') { done = true; enterMenu(sessionId, nameRef.current); }
      else if (status === 'declined') { done = true; setPhase('declined'); }
    };

    // Catch a status that may have changed before the subscription attached.
    sjr().select('status').eq('id', requestId).maybeSingle()
      .then(({ data }: any) => { if (data) resolve(data.status); });

    const ch = supabase.channel(`join-req-${requestId}`)
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'session_join_requests', filter: `id=eq.${requestId}` },
        (payload: any) => resolve(payload.new.status))
      .subscribe();

    const timer = setTimeout(async () => {
      if (done) return;
      const { data } = await sjr().select('status').eq('id', requestId).maybeSingle();
      if (data?.status === 'pending') {
        // Atomic guard: only self-approve if still pending (never override a decline).
        await sjr().update({ status: 'approved', resolved_by_name: 'auto' })
          .eq('id', requestId).eq('status', 'pending');
        if (!done) { done = true; enterMenu(sessionId, nameRef.current); }
      } else if (data) {
        resolve(data.status);
      }
    }, AUTO_APPROVE_MS);

    return () => { done = true; clearTimeout(timer); supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, requestId, sessionId]);

  if (phase === 'loading') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin text-primary mx-auto" />
          <p className="text-muted-foreground font-sans mt-4 text-sm">{t('setting_up_table')}</p>
        </div>
      </div>
    );
  }

  if (phase === 'name') {
    return <GuestNameModal onSubmit={handleNameSubmit} />;
  }

  if (phase === 'waiting') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-6">
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          className="w-full max-w-sm text-center"
        >
          <div className="relative w-20 h-20 mx-auto mb-6">
            <span className="absolute inset-0 rounded-full bg-primary/10 animate-ping" />
            <span className="relative w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center">
              <Users className="w-9 h-9 text-primary" />
            </span>
          </div>
          <h2 className="font-serif text-2xl font-bold text-foreground">{t('waiting_to_join')}</h2>
          <p className="text-muted-foreground font-sans text-sm mt-2 leading-relaxed">{t('waiting_to_join_sub')}</p>
          <Loader2 className="w-5 h-5 animate-spin text-primary/60 mx-auto mt-6" />
          <button
            onClick={() => navigate('/menu')}
            className="mt-8 text-xs text-muted-foreground underline underline-offset-4 font-sans"
          >
            {t('browse_menu')}
          </button>
        </motion.div>
      </div>
    );
  }

  if (phase === 'declined') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-6">
        <div className="text-center max-w-sm">
          <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center mx-auto mb-4">
            <AlertCircle className="w-8 h-8 text-destructive" />
          </div>
          <h2 className="font-serif text-xl font-bold text-foreground">{t('join_declined')}</h2>
          <div className="mt-6 flex flex-col gap-2">
            <Button
              onClick={() => { if (sessionId) { setPhase('waiting'); createJoinRequest(sessionId, nameRef.current); } }}
              className="rounded-full"
            >
              {t('try_again')}
            </Button>
            <Button onClick={() => navigate('/menu')} variant="outline" className="rounded-full">
              {t('browse_menu')}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // error
  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-6">
      <div className="text-center max-w-sm">
        <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center mx-auto mb-4">
          <AlertCircle className="w-8 h-8 text-destructive" />
        </div>
        <h2 className="font-serif text-xl font-bold text-foreground">{error}</h2>
        <Button onClick={() => navigate('/menu')} variant="outline" className="mt-6 rounded-full">
          {t('browse_menu')}
        </Button>
      </div>
    </div>
  );
};

export default TableEntry;
