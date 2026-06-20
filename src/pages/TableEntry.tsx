import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useCartStore } from '@/lib/cart-store';
import { Loader2, AlertCircle, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import GuestNameModal from '@/components/guest/GuestNameModal';
import { useT } from '@/lib/i18n';
import {
  autoApproveJoinRequest,
  getJoinRequest,
  inspectTable,
  requestJoin,
  startTableSession,
  type GuestJoinResult,
} from '@/lib/guest-api';

type Phase = 'loading' | 'error' | 'name' | 'waiting' | 'declined';

// If nobody at the table responds in this window, the joiner is let in
// automatically so a sleeping host phone never leaves them stuck.
const AUTO_APPROVE_MS = 30000;

const TableEntry = () => {
  const { tableNumber } = useParams<{ tableNumber: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { setTable, setSession, setGuestName, startHeartbeat, clientId } = useCartStore();
  const t = useT();

  const [phase, setPhase] = useState<Phase>('loading');
  const [error, setError] = useState<string | null>(null);
  const [role, setRole] = useState<'host' | 'joiner'>('host');
  const [sessionId, setLocalSessionId] = useState<string | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);
  const nameRef = useRef<string>('');

  const token = searchParams.get('token');

  const enterMenu = useCallback((sid: string, sessionToken: string, name: string) => {
    if (!tableNumber || !token) return;
    setTable(Number.parseInt(tableNumber, 10), token);
    setSession(sid, sessionToken);
    setGuestName(name);
    startHeartbeat();
    const params = new URLSearchParams({ table: tableNumber, token });
    navigate(`/menu?${params.toString()}`, { replace: true });
  }, [navigate, setGuestName, setSession, setTable, startHeartbeat, tableNumber, token]);

  // 1. Validate QR and resolve whether this device is host / returning / joiner.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const parsedTable = tableNumber ? Number.parseInt(tableNumber, 10) : Number.NaN;
      if (!tableNumber || !token || Number.isNaN(parsedTable)) { setError(t('invalid_qr')); setPhase('error'); return; }
      try {
        const entry = await inspectTable(parsedTable, token, clientId);
        if (cancelled) return;
        if (entry.status === 'invalid') { setError(t('qr_expired')); setPhase('error'); return; }

        setTable(parsedTable, token);

        if (entry.status === 'empty') {
          setRole('host');
          setPhase('name');
          return;
        }

        if (entry.status === 'returning' && entry.session_id && entry.session_token) {
          enterMenu(entry.session_id, entry.session_token, entry.guest_name || t('new_guest'));
          return;
        }

        if (entry.status === 'join_required' && entry.session_id) {
          setLocalSessionId(entry.session_id);
          setRole('joiner');
          setPhase('name');
          return;
        }

        setError(t('something_wrong'));
        setPhase('error');
      } catch (e) {
        console.error('Table entry error:', e);
        if (!cancelled) { setError(t('something_wrong')); setPhase('error'); }
      }
    })();
    return () => { cancelled = true; };
  }, [clientId, enterMenu, setTable, t, tableNumber, token]);

  const createJoinRequest = useCallback(async (sid: string, name: string) => {
    if (!tableNumber || !token) { setError(t('invalid_qr')); setPhase('error'); return; }
    const parsedTable = Number.parseInt(tableNumber, 10);
    try {
      const result = await requestJoin(parsedTable, token, clientId, name);
      if (result.status === 'approved' && result.session_id && result.session_token) {
        enterMenu(result.session_id, result.session_token, result.guest_name || name);
        return;
      }
      if (result.status === 'pending' && result.request_id) {
        setLocalSessionId(result.session_id || sid);
        setRequestId(result.request_id);
        setPhase('waiting');
        return;
      }
      if (result.status === 'not_active') {
        setError(t('table_not_active'));
        setPhase('error');
        return;
      }
      setError(t('table_not_active')); setPhase('error'); return;
    } catch (err) {
      console.error('Join request error:', err);
      setError(t('table_not_active'));
      setPhase('error');
    }
  }, [clientId, enterMenu, t, tableNumber, token]);

  const handleNameSubmit = async (name: string) => {
    nameRef.current = name;

    if (role === 'joiner') {
      if (!sessionId) { setError(t('table_not_active')); setPhase('error'); return; }
      await createJoinRequest(sessionId, name);
      return;
    }

    const parsedTable = tableNumber ? Number.parseInt(tableNumber, 10) : Number.NaN;
    if (!tableNumber || !token || Number.isNaN(parsedTable)) { setError(t('invalid_qr')); setPhase('error'); return; }

    try {
      const result = await startTableSession(parsedTable, token, clientId, name);
      if (result.status === 'invalid') { setError(t('qr_expired')); setPhase('error'); return; }
      if ((result.status === 'created' || result.status === 'returning') && result.session_id && result.session_token) {
        enterMenu(result.session_id, result.session_token, result.guest_name || name);
        return;
      }
      if (result.status === 'join_required' && result.session_id) {
        setLocalSessionId(result.session_id);
        setRole('joiner');
        await createJoinRequest(result.session_id, name);
        return;
      }
      setError(t('session_failed'));
      setPhase('error');
    } catch (err) {
      console.error('Session start error:', err);
      setError(t('session_failed'));
      setPhase('error');
    }
  };

  // 2. While waiting: listen for approval/decline + auto-approve fallback.
  useEffect(() => {
    if (phase !== 'waiting' || !requestId || !sessionId) return;
    let done = false;

    const resolve = (result: GuestJoinResult) => {
      if (done) return;
      if (result.status === 'approved') {
        if (!result.session_token) {
          setError(t('something_wrong'));
          setPhase('error');
          return;
        }
        done = true;
        enterMenu(sessionId, result.session_token, result.guest_name || nameRef.current);
      } else if (result.status === 'declined') {
        done = true;
        setPhase('declined');
      } else if (result.status === 'expired' || result.status === 'missing') {
        done = true;
        setError(t('session_expired'));
        setPhase('error');
      }
    };

    const poll = () => {
      getJoinRequest(sessionId, requestId, clientId)
        .then(resolve)
        .catch((err) => console.error('Join request poll error:', err));
    };
    poll();
    const pollTimer = setInterval(poll, 2000);

    const timer = setTimeout(async () => {
      if (done) return;
      if (!tableNumber || !token) return;
      try {
        const auto = await autoApproveJoinRequest(Number.parseInt(tableNumber, 10), token, sessionId, requestId, clientId);
        resolve(auto);
      } catch (err) {
        console.error('Auto approval error:', err);
      }
    }, AUTO_APPROVE_MS);

    return () => { done = true; clearInterval(pollTimer); clearTimeout(timer); };
  }, [clientId, enterMenu, phase, requestId, sessionId, t, tableNumber, token]);

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
