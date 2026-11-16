import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import {
  BellOff, BellRing, CalendarCheck2, CalendarClock, Check, Copy, History, Inbox, Link2, Loader2, MessageCircle,
  MessageSquareText, MessagesSquare, Phone, SlidersHorizontal, Smartphone, Users, X,
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { AdminPageHeader, AdminSection } from '@/components/admin/AdminPage';
import { AdminCard, AdminCardContent, AdminCardHeader, EmptyState } from '@/components/admin/AdminCard';
import { TONE, type StaffTone } from '@/components/staff/status-tone';
import { cn } from '@/lib/utils';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import type { AdminOutletContext } from '@/components/admin/AdminLayout';
import { VENUES } from '@/lib/venues';
import { VENUE_URLS } from '@/lib/seo/site-url';
import { useLockScreenAlerts } from '@/hooks/useLockScreenAlerts';
import ReservationWhatsApp from '@/components/admin/ReservationWhatsApp';
import { isIos, STAFF_PUSH_MESSAGE, type AlertsState } from '@/lib/push-alerts';
import { playWaiterCallAlert, vibrate } from '@/lib/kitchen-sounds';
import {
  decideReservation, formatReservationDay, listReservations, listSentMessages, restaurantDayTime, statusNow, waitedLabel,
  type AdminReservation, type Decision, type ReservationStatus, type SentMessage,
} from '@/lib/reservations';
import { guestMessage, smsLink, viberLink, whatsappLink, type GuestMessageKind } from '@/lib/reservation-messages';
import type { Locale } from '@/lib/i18n';

/** How often the page asks for news while it is open; an alert on the phone asks at once. */
const REFRESH_MS = 10_000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const untyped = supabase as unknown as { from: (table: string) => any };

interface Rules {
  id: number;
  reservations_enabled: boolean;
  reservations_open: string;
  reservations_close: string;
  reservations_max_party: number;
  reservations_days_ahead: number;
  reservations_lead_minutes: number;
  reservations_phone: string | null;
  reservations_note: string | null;
}
const RULE_COLUMNS = 'id, reservations_enabled, reservations_open, reservations_close, reservations_max_party, reservations_days_ahead, reservations_lead_minutes, reservations_phone, reservations_note';

/** `time` columns come back as "18:00:00"; the time input wants "18:00". */
const hhmm = (t: string | null | undefined) => (t ? t.slice(0, 5) : '');

const NOTICE_CHOICES = [
  { minutes: 0, label: 'No notice' },
  { minutes: 30, label: '30 minutes' },
  { minutes: 60, label: '1 hour' },
  { minutes: 120, label: '2 hours' },
  { minutes: 180, label: '3 hours' },
  { minutes: 1440, label: 'A day' },
];

const STATUS_LABEL: Record<ReservationStatus, string> = {
  pending: 'Waiting', confirmed: 'Confirmed', declined: 'Declined', cancelled: 'Cancelled', expired: 'Not answered',
};

/** The shared staff colours (status-tone.ts): waiting is new, a promised table is ready, the rest is done. */
const STATUS_TONE: Record<ReservationStatus, StaffTone> = {
  pending: 'new', confirmed: 'ready', declined: 'served', cancelled: 'served', expired: 'served',
};

/** A state as a word in a soft pill, with a dot: the same pill on every Ops page. */
const Pill = ({ tone, children, className, ...rest }: React.HTMLAttributes<HTMLSpanElement> & { tone: StaffTone }) => (
  <span className={cn('inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium leading-5', TONE[tone].chip, className)} {...rest}>
    <span className={cn('h-1.5 w-1.5 rounded-full', TONE[tone].dot)} aria-hidden />
    {children}
  </span>
);

/** How long ago, in the words a manager uses: "just now", "12 min", "3 h 5 min", "2 days". */
const agoLabel = (iso: string, now: number) => {
  const minutes = Math.max(0, Math.floor((now - Date.parse(iso)) / 60_000));
  if (minutes >= 48 * 60) return `${Math.floor(minutes / 1440)} days ago`;
  if (minutes >= 24 * 60) return 'a day ago';
  const waited = waitedLabel(iso, now);
  return waited === 'just now' ? waited : `${waited} ago`;
};

/** How far ahead a table is, for today's agenda: "in 25 min", "in 2 h 10 min"; null once it has started. */
const inLabel = (iso: string, now: number) => {
  const minutes = Math.round((Date.parse(iso) - now) / 60_000);
  if (minutes <= 0) return null;
  if (minutes < 60) return `in ${minutes} min`;
  return minutes % 60 ? `in ${Math.floor(minutes / 60)} h ${minutes % 60} min` : `in ${minutes / 60} h`;
};

const guests = (n: number) => `${n} ${n === 1 ? 'guest' : 'guests'}`;

function explainAlerts(state: AlertsState): string {
  switch (state) {
    case 'on':
      return 'This phone rings when a guest asks for a table, even when it is locked, and once more after five minutes if nobody has answered.';
    case 'off':
      return 'Ring this phone the moment a guest asks for a table, even when it is locked or the admin is closed.';
    case 'needs-home-screen':
      return 'On iPhone and iPad this works only from the Manager app on the Home Screen (iOS 16.4 or later). In Safari tap Share, then Add to Home Screen. Open Manager from the Home Screen, sign in, and turn this on there.';
    case 'blocked':
      return isIos()
        ? 'Notifications are blocked for this app. Allow them in Settings → Notifications, then come back.'
        : 'Notifications are blocked for this site. Allow them in the browser\'s site settings (the icon left of the address), then come back.';
    case 'unsupported':
      return isIos()
        ? 'This iPhone needs iOS 16.4 or later for alerts.'
        : 'This browser cannot show alerts. Use Chrome on Android or a computer, or the Home Screen app on iPhone.';
    case 'not-ready':
      return 'Alerts are not switched on for this restaurant yet.';
    default:
      return '';
  }
}

/** "Alert this phone": the admin's own switch, one per phone and restaurant. */
const AlertThisPhone = ({ venueId }: { venueId: string }) => {
  const { state, busy, toggle, test } = useLockScreenAlerts(venueId, 'reservations');
  if (state === 'checking') return <Skeleton className="h-20 w-full rounded-xl" />;
  const on = state === 'on';
  const actionable = on || state === 'off';
  const Icon = on ? BellRing : state === 'needs-home-screen' ? Smartphone : BellOff;
  return (
    <div data-testid="reservation-alerts" className={cn('rounded-xl border px-4 py-3.5 font-sans', on ? 'border-border/70 bg-muted/30' : 'border-primary/25 bg-primary/[0.04]')}>
      <div className="flex items-center gap-3">
        <span className={cn('grid h-8 w-8 shrink-0 place-items-center rounded-lg', on ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground')} aria-hidden>
          <Icon className="h-4 w-4" />
        </span>
        <label htmlFor="reservation-alerts" className="min-w-0 flex-1 text-sm font-semibold text-foreground">
          Alert this phone
          {actionable && <span className="ms-2 text-xs font-normal text-muted-foreground">{on ? 'On' : 'Off'}</span>}
        </label>
        {/* Drawn a quarter larger than the room it takes: the gap leaves it that room. */}
        <Switch id="reservation-alerts" checked={on} disabled={!actionable || busy} onCheckedChange={toggle} className="me-1 scale-125 origin-right" />
      </div>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{explainAlerts(state)}</p>
      {/* A page of its own, not part of the app: how to add the Manager app, step by step. */}
      {state === 'needs-home-screen' && (
        <Button asChild variant="outline" size="sm" className="mt-3 h-11 sm:h-9">
          <a href="/manager-app/" data-testid="manager-app-link">Step by step</a>
        </Button>
      )}
      {on && (
        <Button type="button" variant="outline" size="sm" onClick={test} className="mt-3 h-11 sm:h-9">
          Send a test
        </Button>
      )}
    </div>
  );
};

const telHref = (phone: string) => `tel:${phone.replace(/[^\d+]/g, '')}`;

/** An answer the guest has not been told in a message yet: who, which answer, and the restaurant's own line. */
interface Told { r: AdminReservation; kind: GuestMessageKind; reply: string }

const LANGUAGE: Record<Locale, string> = { en: 'English', bs: 'Bosnian', ar: 'Arabic' };
const sendButton = 'inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg border border-border bg-background px-3 text-sm font-semibold text-foreground transition-colors hover:border-primary/50 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

/**
 * "Tell the guest": after an answer, the message for the guest, written in
 * the language they asked in, and one tap to send it from this phone's own
 * WhatsApp, Viber or Messages. The guest's page already shows the answer;
 * this reaches a guest who has closed it. Nothing is sent by the system.
 */
const TellGuest = ({ told, venueName, phone, auto, onDone }: {
  told: Told; venueName: string; phone: string | null;
  /** The same answer, if it went out by itself on WhatsApp. */
  auto?: SentMessage;
  onDone: () => void;
}) => {
  const { r, kind, reply } = told;
  const locale: Locale = r.locale === 'bs' || r.locale === 'ar' ? r.locale : 'en';
  const at = restaurantDayTime(r.reserved_for);
  const text = guestMessage(kind, {
    venue: venueName, day: formatReservationDay(at.day, locale), time: at.time, party: r.party_size, code: r.code, reply, phone,
  }, locale);
  const copy = async (done: string) => {
    try { await navigator.clipboard.writeText(text); toast.success(done); } catch { toast.error('Could not copy. Select the message and copy it.'); }
  };
  return (
    <AdminCard data-testid="tell-guest" className="border-primary/30 bg-gradient-to-br from-primary/[0.05] to-transparent">
      <AdminCardHeader
        icon={MessageCircle}
        title={`Tell ${r.guest_name}`}
        description={`Their page already shows your answer. A message from your own phone makes sure they see it. It is written in ${LANGUAGE[locale]}, the language they asked in.`}
        action={<Button variant="outline" size="sm" onClick={onDone} className="h-11 px-4 sm:h-9">Done</Button>}
      />
      <AdminCardContent className="space-y-3 font-sans">
        {auto && auto.status !== 'sending' && (
          <p data-testid="tell-guest-auto" className={cn('rounded-lg px-3 py-2 text-xs font-medium', auto.status === 'sent' ? 'bg-primary/10 text-foreground' : 'bg-destructive/10 text-destructive')}>
            {auto.status === 'sent'
              ? 'Already sent by itself on WhatsApp. Send it yourself as well only if you want to.'
              : `WhatsApp could not deliver it by itself${auto.detail ? ` (${auto.detail})` : ''}. Send it yourself:`}
          </p>
        )}
        <p dir="auto" data-testid="tell-guest-text" className="max-w-prose whitespace-pre-wrap rounded-xl border border-border/80 bg-background px-4 py-3 text-sm leading-relaxed text-foreground">{text}</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <a href={whatsappLink(r.guest_phone, text)} target="_blank" rel="noreferrer" className={sendButton}>
            <MessageCircle className="h-4 w-4 text-primary" aria-hidden /> WhatsApp
          </a>
          <a href={viberLink(r.guest_phone)} onClick={() => void copy('Message copied: paste it in Viber')} className={sendButton}>
            <MessagesSquare className="h-4 w-4 text-primary" aria-hidden /> Viber
          </a>
          <a href={smsLink(r.guest_phone, text)} className={sendButton}>
            <MessageSquareText className="h-4 w-4 text-primary" aria-hidden /> Text message
          </a>
          <button type="button" onClick={() => void copy('Message copied')} className={sendButton}>
            <Copy className="h-4 w-4 text-primary" aria-hidden /> Copy
          </button>
        </div>
      </AdminCardContent>
    </AdminCard>
  );
};

/**
 * Admin → Reservations: whether guests can ask for a table online and under
 * which rules, the requests waiting for an answer, and the tables promised.
 *
 * A request is answered here and nowhere else: Confirm or Decline, with a
 * line for the guest if wanted, and the guest's own page shows it within
 * seconds. The page asks for news every ten seconds while it is open, and at
 * once when this phone's alert arrives.
 */
const AdminReservations = () => {
  const { venueSlug, venueName } = useOutletContext<AdminOutletContext>();
  const venue = venueSlug ? VENUES[venueSlug] : null;
  const venueId = venue?.dbId ?? null;

  const [rules, setRules] = useState<Rules | null>(null);
  const [draft, setDraft] = useState<Rules | null>(null);
  const [rows, setRows] = useState<AdminReservation[] | null>(null);
  /** The database has no reservations yet: the update has not been applied. */
  const [notReady, setNotReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [replies, setReplies] = useState<Record<string, string>>({});
  const [answering, setAnswering] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<AdminReservation | null>(null);
  const [cancelReply, setCancelReply] = useState('');
  /** The answer just given, until the guest has been told or the admin says it is done. */
  const [told, setTold] = useState<Told | null>(null);
  /** What went out by itself on WhatsApp, so the admin does not send it twice. */
  const [sentMessages, setSentMessages] = useState<SentMessage[]>([]);
  const [now, setNow] = useState(() => Date.now());
  /** The answered list shows its latest few until asked for the rest. */
  const [allAnswered, setAllAnswered] = useState(false);
  const knownPending = useRef<Set<string> | null>(null);

  const loadRules = useCallback(async () => {
    const { data, error } = await untyped.from('restaurant_settings').select(RULE_COLUMNS).maybeSingle();
    if (error) {
      // A database from before the reservations update has none of these columns.
      if (/42703|PGRST204|does not exist/.test(`${error.code} ${error.message}`)) setNotReady(true);
      else setLoadError(error.message);
      return;
    }
    if (data) {
      setRules(data as Rules);
      setDraft((current) => current ?? (data as Rules));
    }
  }, []);

  const loadRows = useCallback(async () => {
    if (!venueId) return;
    try {
      const list = await listReservations(venueId);
      if (list === null) { setNotReady(true); return; }
      setLoadError(null);
      setNow(Date.now());
      const pending = new Set(list.filter((r) => statusNow(r) === 'pending').map((r) => r.id));
      // A request that was not here a moment ago: say so, the way a waiter call does.
      if (knownPending.current && [...pending].some((id) => !knownPending.current!.has(id))) {
        playWaiterCallAlert();
        vibrate([300, 100, 300]);
        toast.info('A guest has asked for a table');
      }
      knownPending.current = pending;
      setRows(list);
      // What went out by itself on WhatsApp; nothing, before the database knows messages.
      void listSentMessages(venueId).then(setSentMessages);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Could not load the reservations');
    }
  }, [venueId]);

  useEffect(() => { void loadRules(); }, [loadRules, venueId]);

  useEffect(() => {
    if (!venueId) return;
    knownPending.current = null;
    setRows(null);
    void loadRows();
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void loadRows(); }, REFRESH_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') void loadRows(); };
    // The alert that just rang this phone (public/sw-push.js): load it now.
    const onPush = (event: MessageEvent) => { if (event.data?.type === STAFF_PUSH_MESSAGE) void loadRows(); };
    document.addEventListener('visibilitychange', onVisible);
    navigator.serviceWorker?.addEventListener('message', onPush);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      navigator.serviceWorker?.removeEventListener('message', onPush);
    };
  }, [venueId, loadRows]);

  const today = restaurantDayTime(new Date(now).toISOString()).day;
  const dayHeading = (day: string) => {
    const named = formatReservationDay(day, 'en');
    const [y, m, d] = today.split('-').map(Number);
    const tomorrow = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
    return day === today ? `Today · ${named}` : day === tomorrow ? `Tomorrow · ${named}` : named;
  };

  const { pending, confirmedByDay, rest } = useMemo(() => {
    const list = rows ?? [];
    const withNow = list.map((r) => ({ ...r, shown: statusNow(r, now), at: restaurantDayTime(r.reserved_for) }));
    const waiting = withNow.filter((r) => r.shown === 'pending').sort((a, b) => a.created_at.localeCompare(b.created_at));
    const promised = withNow.filter((r) => r.shown === 'confirmed' && Date.parse(r.reserved_for) > now - 3 * 3600_000);
    const byDay = new Map<string, typeof promised>();
    for (const r of promised) byDay.set(r.at.day, [...(byDay.get(r.at.day) ?? []), r]);
    const others = withNow.filter((r) => !waiting.includes(r) && !promised.includes(r))
      .sort((a, b) => (b.decided_at ?? b.created_at).localeCompare(a.decided_at ?? a.created_at)).slice(0, 30);
    return { pending: waiting, confirmedByDay: [...byDay.entries()], rest: others };
  }, [rows, now]);

  const saveRules = async (patch: Partial<Rules>, done: string) => {
    if (!rules) return;
    setSaving(true);
    const { error } = await untyped.from('restaurant_settings').update(patch).eq('id', rules.id);
    setSaving(false);
    if (error) {
      toast.error(/reservations_check/.test(error.message)
        ? 'Check the times and numbers: the first time must be before the last, and the group at least 1.'
        : error.message);
      return false;
    }
    setRules({ ...rules, ...patch });
    setDraft((current) => (current ? { ...current, ...patch } : current));
    toast.success(done);
    return true;
  };

  const saveDraft = (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft) return;
    void saveRules({
      reservations_open: hhmm(draft.reservations_open),
      reservations_close: hhmm(draft.reservations_close),
      reservations_max_party: Math.min(50, Math.max(1, Math.round(Number(draft.reservations_max_party) || 1))),
      reservations_days_ahead: Math.min(365, Math.max(1, Math.round(Number(draft.reservations_days_ahead) || 1))),
      reservations_lead_minutes: draft.reservations_lead_minutes,
      reservations_phone: draft.reservations_phone?.trim() || null,
      reservations_note: draft.reservations_note?.trim() || null,
    }, 'Reservation rules saved');
  };

  const answer = async (r: AdminReservation, decision: Decision, reply: string) => {
    setAnswering(r.id);
    try {
      await decideReservation(r.id, decision, reply);
      toast.success(decision === 'confirm' ? `Confirmed for ${r.guest_name}` : decision === 'decline' ? `Declined for ${r.guest_name}` : `Cancelled for ${r.guest_name}`);
      setReplies((all) => { const next = { ...all }; delete next[r.id]; return next; });
      setTold({ r, kind: decision === 'confirm' ? 'confirmed' : decision === 'decline' ? 'declined' : 'cancelled', reply });
      await loadRows();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save the answer');
      void loadRows();
    } finally {
      setAnswering(null);
    }
  };

  const guestLink = venue ? `${VENUE_URLS[venue.slug] ?? window.location.origin}/reserve` : '';
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(guestLink);
      toast.success('Link copied');
    } catch {
      toast.error('Could not copy. Select the link and copy it.');
    }
  };

  if (!venueId) return <ReservationsSkeleton />;

  if (notReady) {
    return (
      <div className="mx-auto w-full max-w-3xl">
        <AdminPageHeader title="Reservations" description="Guests ask for a table on your website, and you answer here." />
        <AdminCard>
          <EmptyState
            icon={CalendarClock}
            title={`Reservations are not switched on${venueName ? ` for ${venueName}` : ''} yet.`}
            hint="The database update for reservations has not been applied. Once it is, this page shows the switch, the rules and every request."
          />
        </AdminCard>
      </div>
    );
  }

  const changed = !!draft && !!rules && JSON.stringify({ ...draft, reservations_enabled: rules.reservations_enabled }) !== JSON.stringify(rules);
  const todayList = confirmedByDay.find(([day]) => day === today)?.[1] ?? [];
  const nextToday = todayList.find((r) => Date.parse(r.reserved_for) > now);
  const answeredShown = allAnswered ? rest : rest.slice(0, 6);

  return (
    <div className="mx-auto w-full max-w-6xl">
      <AdminPageHeader
        title="Reservations"
        description="Guests ask for a table on your website. You answer here, and they see it within seconds."
        actions={guestLink ? (
          <Button type="button" variant="outline" onClick={() => void copyLink()} className="hidden h-10 gap-2 sm:inline-flex">
            <Link2 className="h-4 w-4" aria-hidden /> Copy booking link
          </Button>
        ) : undefined}
      >
        {/* The day at a glance: what is waiting, what is promised today, whether guests can ask. */}
        <div className="flex flex-wrap items-center gap-2 font-sans">
          {pending.length > 0 && (
            <Pill tone="new" data-testid="pending-count" className="px-2.5 py-1 text-[13px]">{pending.length} waiting for your answer</Pill>
          )}
          {rows !== null && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-[13px] font-medium tabular-nums text-muted-foreground">
              <CalendarCheck2 className="h-3.5 w-3.5" aria-hidden />
              {todayList.length === 0 ? 'No tables booked today' : `Today: ${todayList.length} ${todayList.length === 1 ? 'table' : 'tables'}, ${guests(todayList.reduce((n, r) => n + r.party_size, 0))}`}
            </span>
          )}
          {rules && (
            <span className={cn('hidden items-center gap-1.5 rounded-full px-2.5 py-1 text-[13px] font-medium sm:inline-flex', rules.reservations_enabled ? TONE.ready.chip : 'bg-muted text-muted-foreground')}>
              <span className={cn('h-1.5 w-1.5 rounded-full', rules.reservations_enabled ? TONE.ready.dot : TONE.served.dot)} aria-hidden />
              {rules.reservations_enabled ? 'Taking requests online' : 'Online booking off'}
            </span>
          )}
        </div>
      </AdminPageHeader>

      {loadError && (
        <p role="alert" className="mb-6 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm font-sans text-destructive">
          Could not load: {loadError}
        </p>
      )}

      <div className="grid items-start gap-x-8 gap-y-10 lg:grid-cols-[minmax(0,1fr)_360px]">
        {/* The day's work: answers first, then the tables promised, then what is done. */}
        <div className="min-w-0 space-y-10">
          {told && (
            <TellGuest told={told} venueName={venueName ?? venue?.name ?? ''} phone={rules?.reservations_phone ?? (venue?.phone || null)}
              auto={sentMessages.find((m) => m.reservation_id === told.r.id && m.kind === `guest_${told.kind}`)} onDone={() => setTold(null)} />
          )}

          {/* Waiting for an answer: first, because a guest is looking at their phone. */}
          <AdminSection titleId="waiting-heading" title="Waiting for your answer"
            description={pending.length > 1 ? <span className="hidden sm:inline">The oldest request first.</span> : undefined}>
            {rows === null ? (
              <Skeleton className="h-[248px] w-full rounded-2xl" />
            ) : pending.length === 0 ? (
              <AdminCard>
                <EmptyState
                  icon={Inbox}
                  title={rules && !rules.reservations_enabled ? 'Nothing here: online reservations are switched off.' : 'Nobody is waiting. New requests appear here by themselves.'}
                  hint={rules && !rules.reservations_enabled ? 'Switch them on under Online booking.' : 'This page checks every ten seconds while it is open.'}
                  className="py-8"
                />
              </AdminCard>
            ) : (
              <div className="space-y-3">
                {pending.map((r) => (
                  <AdminCard key={r.id} data-testid="pending-reservation" className="relative overflow-hidden">
                    <span className={cn('absolute inset-y-0 start-0 w-1', TONE.new.bar)} aria-hidden />
                    <div className="space-y-3 p-4 ps-5 font-sans sm:p-5 sm:ps-6">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-muted-foreground">{dayHeading(r.at.day)}</p>
                          <p className="mt-1 flex items-baseline gap-3">
                            <span className="font-serif text-[2rem] font-semibold leading-none tabular-nums text-foreground">{r.at.time}</span>
                            <span className="inline-flex items-center gap-1 text-base font-semibold text-foreground">
                              <Users className="h-4 w-4 text-muted-foreground" aria-hidden /> {guests(r.party_size)}
                            </span>
                          </p>
                        </div>
                        <p className="shrink-0 pt-0.5 text-end text-xs leading-relaxed text-muted-foreground">
                          asked {agoLabel(r.created_at, now)}<br /><span className="tabular-nums">{r.code}</span>
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
                        <span className="min-w-0 break-words text-[15px] font-semibold text-foreground">{r.guest_name}</span>
                        <PhoneLink phone={r.guest_phone} />
                      </div>
                      {r.note && <p dir="auto" className="rounded-lg bg-muted/50 px-3 py-2 text-sm text-foreground">“{r.note}”</p>}
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                        <div className="min-w-0 flex-1">
                          <Label htmlFor={`reply-${r.id}`} className="text-xs text-muted-foreground">A line for the guest (optional)</Label>
                          <Input id={`reply-${r.id}`} value={replies[r.id] ?? ''} maxLength={300}
                            onChange={(e) => setReplies((all) => ({ ...all, [r.id]: e.target.value }))}
                            placeholder="By the window · 21:15 is free" className="mt-1 h-11" />
                        </div>
                        <div className="grid grid-cols-2 gap-2 sm:flex sm:shrink-0">
                          <Button variant="outline" onClick={() => void answer(r, 'decline', replies[r.id] ?? '')} disabled={answering === r.id} className="h-12 gap-2 font-semibold sm:h-11 sm:px-5">
                            <X className="h-4 w-4" aria-hidden /> Decline
                          </Button>
                          <Button onClick={() => void answer(r, 'confirm', replies[r.id] ?? '')} disabled={answering === r.id} className="h-12 gap-2 font-semibold sm:h-11 sm:px-6">
                            {answering === r.id ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden /> : <Check className="h-4 w-4" aria-hidden />} Confirm
                          </Button>
                        </div>
                      </div>
                    </div>
                  </AdminCard>
                ))}
              </div>
            )}
          </AdminSection>

          {/* The tables promised, day by day. */}
          <AdminSection titleId="confirmed-heading" title="Confirmed" description="Every table promised, day by day.">
            {rows === null ? (
              <Skeleton className="h-40 w-full rounded-2xl" />
            ) : confirmedByDay.length === 0 ? (
              <AdminCard>
                <EmptyState icon={CalendarCheck2} title="No confirmed reservations ahead." hint="A request you confirm appears here, under its day." className="py-8" />
              </AdminCard>
            ) : (
              <div className="space-y-3">
                {confirmedByDay.map(([day, list]) => (
                  <AdminCard key={day} className="overflow-hidden">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 border-b border-border/70 bg-muted/30 px-4 py-2.5 font-sans sm:px-5">
                      <h3 className="text-sm font-semibold text-foreground">{dayHeading(day)}</h3>
                      <p className="text-xs font-medium tabular-nums text-muted-foreground">
                        {list.length} {list.length === 1 ? 'table' : 'tables'} · {guests(list.reduce((n, r) => n + r.party_size, 0))}
                      </p>
                    </div>
                    <ul className="divide-y divide-border/70 font-sans">
                      {list.map((r) => {
                        const started = Date.parse(r.reserved_for) <= now;
                        const soon = day === today && Date.parse(r.reserved_for) - now < 6 * 3600_000 ? inLabel(r.reserved_for, now) : null;
                        return (
                          <li key={r.id} data-testid="confirmed-reservation"
                            className="grid grid-cols-[3.5rem_minmax(0,1fr)] gap-x-3 gap-y-2 px-4 py-3 sm:grid-cols-[4rem_minmax(0,1fr)_auto] sm:items-center sm:px-5">
                            <p className={cn('pt-0.5 font-serif text-xl font-semibold leading-none tabular-nums text-foreground', started && 'opacity-50')}>{r.at.time}</p>
                            <div className="min-w-0">
                              <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                                <span className="min-w-0 break-words font-semibold text-foreground">{r.guest_name}</span>
                                <span className="inline-flex items-center gap-1 text-sm font-medium tabular-nums text-muted-foreground">
                                  <Users className="h-3.5 w-3.5" aria-hidden /> {r.party_size}
                                </span>
                                {r === nextToday && <Pill tone="ready">Next</Pill>}
                              </p>
                              <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-sm">
                                <PhoneLink phone={r.guest_phone} compact />
                                <span className="text-xs tabular-nums text-muted-foreground">{r.code}</span>
                                {soon && <span className={cn('text-xs font-medium', r === nextToday ? TONE.ready.text : 'text-muted-foreground')}>{soon}</span>}
                              </p>
                              {(r.note || r.reply) && (
                                <p dir="auto" className="mt-1 text-xs leading-relaxed text-muted-foreground">
                                  {r.note && <>Guest: “{r.note}”</>}{r.note && r.reply && ' · '}{r.reply && <>You: “{r.reply}”</>}
                                </p>
                              )}
                            </div>
                            <div className="col-start-2 flex items-center gap-1 sm:col-start-auto sm:justify-end">
                              <Button variant="ghost" size="sm" onClick={() => setTold({ r, kind: 'confirmed', reply: r.reply ?? '' })} className="h-11 gap-1.5 px-3 text-primary sm:h-9">
                                <MessageCircle className="h-4 w-4" aria-hidden /> Message
                              </Button>
                              <Button variant="ghost" size="sm" onClick={() => { setCancelReply(''); setCancelling(r); }} className="h-11 px-3 text-muted-foreground hover:text-destructive sm:h-9">
                                Cancel
                              </Button>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </AdminCard>
                ))}
              </div>
            )}
          </AdminSection>

          {rest.length > 0 && (
            <AdminSection titleId="answered-heading" title="Declined, cancelled and past" description="The latest answers. A request declined by mistake can still be confirmed while its time is ahead.">
              <AdminCard className="overflow-hidden">
                <ul className="divide-y divide-border/70 font-sans">
                  {answeredShown.map((r) => {
                    const label = r.shown === 'cancelled' && r.cancelled_by === 'guest' ? 'Cancelled by guest' : STATUS_LABEL[r.shown];
                    return (
                      <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm sm:px-5">
                        <div className="min-w-0 flex-1">
                          <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <span className="min-w-0 break-words font-medium text-foreground">{r.guest_name}</span>
                            <Pill tone={STATUS_TONE[r.shown]}>{label}</Pill>
                          </p>
                          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                            <span className="tabular-nums">{formatReservationDay(r.at.day, 'en', 'short')}, {r.at.time}</span>
                            <span aria-hidden>·</span>
                            <span>{guests(r.party_size)}</span>
                            <span aria-hidden>·</span>
                            <PhoneLink phone={r.guest_phone} compact />
                          </p>
                        </div>
                        {r.shown === 'declined' && Date.parse(r.reserved_for) > now && (
                          <Button variant="outline" size="sm" disabled={answering === r.id} onClick={() => void answer(r, 'confirm', r.reply ?? '')} className="h-11 sm:h-9">
                            Confirm after all
                          </Button>
                        )}
                      </li>
                    );
                  })}
                </ul>
                {rest.length > answeredShown.length && (
                  <div className="border-t border-border/70 px-4 py-2 sm:px-5">
                    <Button variant="ghost" size="sm" onClick={() => setAllAnswered(true)} className="h-11 w-full gap-1.5 text-muted-foreground sm:h-9 sm:w-auto">
                      <History className="h-4 w-4" aria-hidden /> Show {rest.length - answeredShown.length} more
                    </Button>
                  </div>
                )}
              </AdminCard>
            </AdminSection>
          )}
        </div>

        {/* Set once, looked at rarely: beside the day's work on a computer, below it on a phone. */}
        <aside aria-label="Reservation settings" className="min-w-0 space-y-4">
          <AdminCard>
            <AdminCardHeader icon={CalendarClock} title="Online booking" description="Whether guests can ask for a table on your website, and where they do it." />
            <AdminCardContent className="space-y-4 font-sans">
              {!rules ? <Skeleton className="h-28 w-full rounded-xl" /> : (
                <>
                  {/* The switch is drawn a quarter larger than the room it takes: the gap leaves it that room. */}
                  <div className="flex items-start gap-5">
                    <Switch id="reservations-enabled" checked={rules.reservations_enabled} disabled={saving}
                      onCheckedChange={(on) => void saveRules({ reservations_enabled: on }, on ? 'Guests can now ask for a table online' : 'Online reservations are off')}
                      className="ms-1 mt-0.5 scale-125 origin-left" />
                    <Label htmlFor="reservations-enabled" className="text-sm font-semibold leading-snug">
                      Take reservation requests on the website
                      <span className="mt-0.5 block text-xs font-normal leading-relaxed text-muted-foreground">
                        {rules.reservations_enabled ? 'On: the page below takes requests.' : 'Off: the page tells guests to call instead.'}
                      </span>
                    </Label>
                  </div>
                  <div className="rounded-xl border border-border/70 bg-muted/30 p-3">
                    <p className="text-xs text-muted-foreground">The page guests use</p>
                    <div className="mt-1 flex items-center gap-2">
                      <a href={guestLink} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate text-sm font-semibold text-primary underline-offset-4 hover:underline">
                        {guestLink}
                      </a>
                      <Button type="button" variant="outline" size="sm" onClick={() => void copyLink()} className="h-11 shrink-0 gap-1.5 sm:h-9">
                        <Copy className="h-3.5 w-3.5" aria-hidden /> Copy
                      </Button>
                    </div>
                  </div>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    Put this link where guests look for you: on your Google Maps listing, as its reservation link, and in your Instagram bio.
                    Your website shows it by itself while reservations are on.
                  </p>
                </>
              )}
            </AdminCardContent>
          </AdminCard>

          <AdminCard>
            <AdminCardHeader icon={BellRing} title="Being told" description="How you hear about a request, and how guests hear your answer." />
            <AdminCardContent className="space-y-3">
              <AlertThisPhone venueId={venueId} />
              {venueSlug && <ReservationWhatsApp venueSlug={venueSlug} />}
            </AdminCardContent>
          </AdminCard>

          <AdminCard>
            <AdminCardHeader icon={SlidersHorizontal} title="Rules" description="When guests can ask, for how many, and how far ahead." />
            <AdminCardContent className="font-sans">
              {!draft ? <Skeleton className="h-64 w-full rounded-xl" /> : (
                <form onSubmit={saveDraft} className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label htmlFor="res-open" className="text-xs">First time</Label>
                      <Input id="res-open" type="time" step={900} value={hhmm(draft.reservations_open)}
                        onChange={(e) => setDraft({ ...draft, reservations_open: e.target.value })} className="mt-1 h-11 tabular-nums" />
                    </div>
                    <div>
                      <Label htmlFor="res-close" className="text-xs">Last time</Label>
                      <Input id="res-close" type="time" step={900} value={hhmm(draft.reservations_close)}
                        onChange={(e) => setDraft({ ...draft, reservations_close: e.target.value })} className="mt-1 h-11 tabular-nums" />
                    </div>
                    <div>
                      <Label htmlFor="res-party" className="text-xs">Largest group</Label>
                      <Input id="res-party" type="number" inputMode="numeric" min={1} max={50} value={draft.reservations_max_party}
                        onChange={(e) => setDraft({ ...draft, reservations_max_party: Number(e.target.value) })} className="mt-1 h-11 tabular-nums" />
                    </div>
                    <div>
                      <Label htmlFor="res-ahead" className="text-xs">Days ahead</Label>
                      <Input id="res-ahead" type="number" inputMode="numeric" min={1} max={365} value={draft.reservations_days_ahead}
                        onChange={(e) => setDraft({ ...draft, reservations_days_ahead: Number(e.target.value) })} className="mt-1 h-11 tabular-nums" />
                    </div>
                  </div>
                  <div>
                    <Label htmlFor="res-notice" className="text-xs">Notice you need</Label>
                    <select id="res-notice" value={draft.reservations_lead_minutes}
                      onChange={(e) => setDraft({ ...draft, reservations_lead_minutes: Number(e.target.value) })}
                      className="mt-1 h-11 w-full rounded-md border border-input bg-background px-3 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:text-sm">
                      {NOTICE_CHOICES.map((c) => <option key={c.minutes} value={c.minutes}>{c.label}</option>)}
                      {!NOTICE_CHOICES.some((c) => c.minutes === draft.reservations_lead_minutes) && (
                        <option value={draft.reservations_lead_minutes}>{draft.reservations_lead_minutes} minutes</option>
                      )}
                    </select>
                  </div>
                  <div>
                    <Label htmlFor="res-phone" className="text-xs">Phone guests can call</Label>
                    <Input id="res-phone" type="tel" value={draft.reservations_phone ?? ''} placeholder={venue?.phone || '+387 …'}
                      onChange={(e) => setDraft({ ...draft, reservations_phone: e.target.value })} className="mt-1 h-11" />
                  </div>
                  <div>
                    <Label htmlFor="res-note" className="text-xs">A line guests read before they ask (optional)</Label>
                    <Input id="res-note" value={draft.reservations_note ?? ''} maxLength={200} placeholder="We hold a table for 15 minutes."
                      onChange={(e) => setDraft({ ...draft, reservations_note: e.target.value })} className="mt-1 h-11" />
                  </div>
                  <div className="flex items-center gap-3 pt-1">
                    <Button type="submit" disabled={!changed || saving} className="h-11 gap-2 sm:h-10">
                      {saving && <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />} Save the rules
                    </Button>
                    {changed && !saving && <span className="text-xs text-muted-foreground">Not saved yet</span>}
                  </div>
                </form>
              )}
            </AdminCardContent>
          </AdminCard>
        </aside>
      </div>

      <AlertDialog open={!!cancelling} onOpenChange={(open) => { if (!open) setCancelling(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-serif">Cancel this reservation?</AlertDialogTitle>
            <AlertDialogDescription>
              {cancelling && <>{cancelling.guest_name}, {guests(cancelling.party_size)}, {formatReservationDay(restaurantDayTime(cancelling.reserved_for).day, 'en', 'short')} at {restaurantDayTime(cancelling.reserved_for).time}. Their page will say the restaurant cancelled. Call them too: they may not look.</>}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div>
            <Label htmlFor="cancel-reply" className="text-xs text-muted-foreground">A line for the guest (optional)</Label>
            <Input id="cancel-reply" value={cancelReply} maxLength={300} onChange={(e) => setCancelReply(e.target.value)} className="mt-1 h-11" />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11 sm:h-10">Keep it</AlertDialogCancel>
            <AlertDialogAction onClick={() => { const r = cancelling; setCancelling(null); if (r) void answer(r, 'cancel', cancelReply); }}
              className="h-11 bg-destructive text-destructive-foreground hover:bg-destructive/90 sm:h-10">
              Cancel the reservation
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

/** The shape of the page while it loads: a request, a day of tables, and the settings beside them. */
const ReservationsSkeleton = () => (
  <div className="mx-auto w-full max-w-6xl" aria-busy="true" aria-label="Loading reservations">
    <Skeleton className="h-9 w-48 rounded-lg" />
    <Skeleton className="mt-3 h-4 w-full max-w-md rounded" />
    <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="space-y-3">
        <Skeleton className="h-[248px] rounded-2xl" />
        <Skeleton className="h-40 rounded-2xl" />
      </div>
      <Skeleton className="h-72 rounded-2xl" />
    </div>
  </div>
);

/** A guest's number, one tap to call. */
const PhoneLink = ({ phone, compact = false }: { phone: string; compact?: boolean }) => (
  <a href={telHref(phone)}
    className={cn('inline-flex items-center gap-1.5 tabular-nums text-primary underline-offset-4 hover:underline', compact ? 'min-h-[32px] text-xs sm:text-sm' : 'min-h-[44px] text-sm sm:min-h-[32px]')}>
    {!compact && <Phone className="h-3.5 w-3.5" aria-hidden />}{phone}
  </a>
);

export default AdminReservations;
