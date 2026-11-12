import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import {
  BellOff, BellRing, CalendarClock, Check, Copy, Loader2, MessageCircle, MessageSquareText, MessagesSquare, Phone, Smartphone, Users, X,
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import type { AdminOutletContext } from '@/components/admin/AdminLayout';
import { VENUES } from '@/lib/venues';
import { VENUE_URLS } from '@/lib/seo/site-url';
import { useLockScreenAlerts } from '@/hooks/useLockScreenAlerts';
import { isIos, STAFF_PUSH_MESSAGE, type AlertsState } from '@/lib/push-alerts';
import { playWaiterCallAlert, vibrate } from '@/lib/kitchen-sounds';
import {
  decideReservation, formatReservationDay, listReservations, restaurantDayTime, statusNow, waitedLabel,
  type AdminReservation, type Decision, type ReservationStatus,
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
    <div data-testid="reservation-alerts" className={`rounded-xl border px-4 py-3 font-sans ${on ? 'border-border/60 bg-muted/30' : 'border-primary/30 bg-primary/5'}`}>
      <div className="flex items-center gap-3">
        <Icon className={`w-5 h-5 shrink-0 ${on ? 'text-primary' : 'text-muted-foreground'}`} aria-hidden />
        <label htmlFor="reservation-alerts" className="flex-1 min-w-0 text-sm font-semibold text-foreground">
          Alert this phone
          {actionable && <span className="ml-2 text-xs font-normal text-muted-foreground">{on ? 'On' : 'Off'}</span>}
        </label>
        <Switch id="reservation-alerts" checked={on} disabled={!actionable || busy} onCheckedChange={toggle} className="scale-125 origin-right" />
      </div>
      <p className="mt-1.5 text-xs text-muted-foreground leading-relaxed">{explainAlerts(state)}</p>
      {on && (
        <button type="button" onClick={test} className="mt-2 min-h-[40px] px-3 rounded-lg border border-border bg-background text-xs font-semibold">
          Send a test
        </button>
      )}
    </div>
  );
};

const telHref = (phone: string) => `tel:${phone.replace(/[^\d+]/g, '')}`;

/** An answer the guest has not been told in a message yet: who, which answer, and the restaurant's own line. */
interface Told { r: AdminReservation; kind: GuestMessageKind; reply: string }

const LANGUAGE: Record<Locale, string> = { en: 'English', bs: 'Bosnian', ar: 'Arabic' };
const sendButton = 'inline-flex items-center justify-center gap-2 min-h-[44px] rounded-lg border border-border bg-background px-3 text-sm font-semibold text-foreground hover:border-primary/50 transition-colors';

/**
 * "Tell the guest": after an answer, the message for the guest, written in
 * the language they asked in, and one tap to send it from this phone's own
 * WhatsApp, Viber or Messages. The guest's page already shows the answer;
 * this reaches a guest who has closed it. Nothing is sent by the system.
 */
const TellGuest = ({ told, venueName, phone, onDone }: { told: Told; venueName: string; phone: string | null; onDone: () => void }) => {
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
    <Card data-testid="tell-guest" className="border-primary/40 bg-primary/[0.03]">
      <CardContent className="pt-5 space-y-3 font-sans">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-semibold text-foreground">Tell {r.guest_name}</p>
            <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
              Their page already shows your answer. A message from your own phone makes sure they see it. It is written in {LANGUAGE[locale]}, the language they asked in.
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={onDone} className="shrink-0">Done</Button>
        </div>
        <p dir="auto" data-testid="tell-guest-text" className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground whitespace-pre-wrap">{text}</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <a href={whatsappLink(r.guest_phone, text)} target="_blank" rel="noreferrer" className={sendButton}>
            <MessageCircle className="w-4 h-4 text-primary" aria-hidden /> WhatsApp
          </a>
          <a href={viberLink(r.guest_phone)} onClick={() => void copy('Message copied: paste it in Viber')} className={sendButton}>
            <MessagesSquare className="w-4 h-4 text-primary" aria-hidden /> Viber
          </a>
          <a href={smsLink(r.guest_phone, text)} className={sendButton}>
            <MessageSquareText className="w-4 h-4 text-primary" aria-hidden /> Text message
          </a>
          <button type="button" onClick={() => void copy('Message copied')} className={sendButton}>
            <Copy className="w-4 h-4 text-primary" aria-hidden /> Copy
          </button>
        </div>
      </CardContent>
    </Card>
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
  const [now, setNow] = useState(() => Date.now());
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

  if (!venueId) return <Skeleton className="h-64 w-full rounded-xl" />;

  if (notReady) {
    return (
      <div className="space-y-4 max-w-2xl">
        <h1 className="font-serif text-2xl font-bold text-foreground">Reservations</h1>
        <Card>
          <CardContent className="pt-6 space-y-2 font-sans text-sm text-muted-foreground">
            <p className="text-foreground font-semibold">Reservations are not switched on{venueName ? ` for ${venueName}` : ''} yet.</p>
            <p>The database update for reservations has not been applied. Once it is, this page shows the switch, the rules and every request.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const changed = !!draft && !!rules && JSON.stringify({ ...draft, reservations_enabled: rules.reservations_enabled }) !== JSON.stringify(rules);

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-serif text-2xl font-bold text-foreground">Reservations</h1>
          <p className="text-sm text-muted-foreground font-sans mt-0.5">
            Guests ask for a table on your website. You confirm or decline here, and they see your answer within seconds.
          </p>
        </div>
        {pending.length > 0 && (
          <Badge className="text-sm px-3 py-1" data-testid="pending-count">{pending.length} waiting for your answer</Badge>
        )}
      </div>

      {loadError && <p role="alert" className="rounded-xl bg-destructive/10 px-4 py-3 text-sm font-sans text-destructive">Could not load: {loadError}</p>}

      {told && (
        <TellGuest told={told} venueName={venueName ?? venue?.name ?? ''} phone={rules?.reservations_phone ?? (venue?.phone || null)} onDone={() => setTold(null)} />
      )}

      {/* Waiting for an answer: first, because a guest is looking at their phone. */}
      <section aria-labelledby="waiting-heading" className="space-y-3">
        <h2 id="waiting-heading" className="font-serif text-lg font-semibold text-foreground">Waiting for your answer</h2>
        {rows === null ? (
          <Skeleton className="h-28 w-full rounded-xl" />
        ) : pending.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm font-sans text-muted-foreground">
            {rules && !rules.reservations_enabled ? 'Nothing here: online reservations are switched off.' : 'Nobody is waiting. New requests appear here by themselves.'}
          </p>
        ) : pending.map((r) => (
          <Card key={r.id} data-testid="pending-reservation" className="border-primary/40">
            <CardContent className="pt-5 space-y-3 font-sans">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs text-muted-foreground">{dayHeading(r.at.day)}</p>
                  <p className="font-serif text-3xl font-semibold text-foreground leading-none mt-1">{r.at.time}</p>
                </div>
                <div className="text-right">
                  <p className="inline-flex items-center gap-1.5 text-lg font-semibold text-foreground"><Users className="w-4 h-4" aria-hidden /> {r.party_size}</p>
                  <p className="text-xs text-muted-foreground">asked {waitedLabel(r.created_at, now)}{waitedLabel(r.created_at, now) === 'just now' ? '' : ' ago'} · {r.code}</p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <span className="font-semibold text-foreground">{r.guest_name}</span>
                <a href={telHref(r.guest_phone)} className="inline-flex items-center gap-1.5 text-sm text-primary underline underline-offset-4 min-h-[36px]">
                  <Phone className="w-3.5 h-3.5" aria-hidden /> {r.guest_phone}
                </a>
              </div>
              {r.note && <p className="text-sm text-foreground bg-muted/50 rounded-lg px-3 py-2">“{r.note}”</p>}
              <div>
                <Label htmlFor={`reply-${r.id}`} className="text-xs text-muted-foreground">A line for the guest (optional)</Label>
                <Input id={`reply-${r.id}`} value={replies[r.id] ?? ''} maxLength={300}
                  onChange={(e) => setReplies((all) => ({ ...all, [r.id]: e.target.value }))}
                  placeholder="By the window · We are full at 20:00, 21:15 is free" className="mt-1 h-11" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Button onClick={() => void answer(r, 'confirm', replies[r.id] ?? '')} disabled={answering === r.id} className="h-12 gap-2 font-semibold">
                  {answering === r.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Confirm
                </Button>
                <Button variant="outline" onClick={() => void answer(r, 'decline', replies[r.id] ?? '')} disabled={answering === r.id} className="h-12 gap-2 font-semibold">
                  <X className="w-4 h-4" /> Decline
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </section>

      {/* The tables promised, day by day. */}
      <section aria-labelledby="confirmed-heading" className="space-y-3">
        <h2 id="confirmed-heading" className="font-serif text-lg font-semibold text-foreground">Confirmed</h2>
        {rows !== null && confirmedByDay.length === 0 && (
          <p className="text-sm font-sans text-muted-foreground">No confirmed reservations ahead.</p>
        )}
        {confirmedByDay.map(([day, list]) => (
          <Card key={day}>
            <CardHeader className="pb-2">
              <CardTitle className="font-sans text-sm font-semibold text-muted-foreground">
                {dayHeading(day)} · {list.length} {list.length === 1 ? 'table' : 'tables'}, {list.reduce((n, r) => n + r.party_size, 0)} guests
              </CardTitle>
            </CardHeader>
            <CardContent className="divide-y divide-border font-sans">
              {list.map((r) => (
                <div key={r.id} data-testid="confirmed-reservation" className="py-3 flex flex-wrap items-center gap-x-4 gap-y-1">
                  <span className="font-serif text-xl font-semibold text-foreground w-16">{r.at.time}</span>
                  <span className="inline-flex items-center gap-1 text-sm font-semibold"><Users className="w-3.5 h-3.5" aria-hidden /> {r.party_size}</span>
                  <span className="font-semibold text-foreground">{r.guest_name}</span>
                  <a href={telHref(r.guest_phone)} className="text-sm text-primary underline underline-offset-4">{r.guest_phone}</a>
                  <span className="text-xs text-muted-foreground">{r.code}</span>
                  <span className="ml-auto flex items-center gap-1">
                    <Button variant="ghost" size="sm" onClick={() => setTold({ r, kind: 'confirmed', reply: r.reply ?? '' })} className="text-primary">Message</Button>
                    <Button variant="ghost" size="sm" onClick={() => { setCancelReply(''); setCancelling(r); }} className="text-muted-foreground">Cancel</Button>
                  </span>
                  {(r.note || r.reply) && (
                    <p className="basis-full text-xs text-muted-foreground">
                      {r.note && <>Guest: “{r.note}” </>}{r.reply && <>· You: “{r.reply}”</>}
                    </p>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        ))}
      </section>

      {/* The switch and the rules. */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="font-serif text-lg flex items-center gap-2"><CalendarClock className="w-5 h-5 text-primary" aria-hidden /> Online reservations</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5 font-sans">
          {!rules || !draft ? <Skeleton className="h-40 w-full" /> : (
            <>
              {/* The switch is drawn a quarter larger than the room it takes: the gap leaves it that room. */}
              <div className="flex items-center gap-6">
                <Switch id="reservations-enabled" checked={rules.reservations_enabled} disabled={saving}
                  onCheckedChange={(on) => void saveRules({ reservations_enabled: on }, on ? 'Guests can now ask for a table online' : 'Online reservations are off')}
                  className="scale-125 origin-left" />
                <Label htmlFor="reservations-enabled" className="text-sm font-semibold">
                  Take reservation requests on the website
                  <span className="block text-xs font-normal text-muted-foreground">
                    {rules.reservations_enabled ? 'On: the page below takes requests.' : 'Off: the page tells guests to call instead.'}
                  </span>
                </Label>
              </div>

              <div className="rounded-xl bg-muted/40 px-4 py-3 flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted-foreground">The page guests use</span>
                <a href={guestLink} target="_blank" rel="noreferrer" className="text-sm font-semibold text-primary underline underline-offset-4 break-all">{guestLink}</a>
                <Button type="button" variant="outline" size="sm" onClick={() => void copyLink()} className="ml-auto gap-1.5"><Copy className="w-3.5 h-3.5" /> Copy</Button>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Put this link where guests look for you: on your Google Maps listing, as its reservation link, and in your Instagram bio.
                Your website shows it by itself while reservations are on.
              </p>

              <AlertThisPhone venueId={venueId} />

              <form onSubmit={saveDraft} className="space-y-4">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <div>
                    <Label htmlFor="res-open" className="text-xs">First time</Label>
                    <Input id="res-open" type="time" step={900} value={hhmm(draft.reservations_open)}
                      onChange={(e) => setDraft({ ...draft, reservations_open: e.target.value })} className="mt-1 h-11" />
                  </div>
                  <div>
                    <Label htmlFor="res-close" className="text-xs">Last time</Label>
                    <Input id="res-close" type="time" step={900} value={hhmm(draft.reservations_close)}
                      onChange={(e) => setDraft({ ...draft, reservations_close: e.target.value })} className="mt-1 h-11" />
                  </div>
                  <div>
                    <Label htmlFor="res-party" className="text-xs">Largest group</Label>
                    <Input id="res-party" type="number" inputMode="numeric" min={1} max={50} value={draft.reservations_max_party}
                      onChange={(e) => setDraft({ ...draft, reservations_max_party: Number(e.target.value) })} className="mt-1 h-11" />
                  </div>
                  <div>
                    <Label htmlFor="res-ahead" className="text-xs">Days ahead</Label>
                    <Input id="res-ahead" type="number" inputMode="numeric" min={1} max={365} value={draft.reservations_days_ahead}
                      onChange={(e) => setDraft({ ...draft, reservations_days_ahead: Number(e.target.value) })} className="mt-1 h-11" />
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="res-notice" className="text-xs">Notice you need</Label>
                    <select id="res-notice" value={draft.reservations_lead_minutes}
                      onChange={(e) => setDraft({ ...draft, reservations_lead_minutes: Number(e.target.value) })}
                      className="mt-1 w-full h-11 rounded-md border border-input bg-background px-3 text-sm">
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
                </div>
                <div>
                  <Label htmlFor="res-note" className="text-xs">A line guests read before they ask (optional)</Label>
                  <Input id="res-note" value={draft.reservations_note ?? ''} maxLength={200} placeholder="We hold a table for 15 minutes."
                    onChange={(e) => setDraft({ ...draft, reservations_note: e.target.value })} className="mt-1 h-11" />
                </div>
                <Button type="submit" disabled={!changed || saving} className="gap-2">
                  {saving && <Loader2 className="w-4 h-4 animate-spin" />} Save the rules
                </Button>
              </form>
            </>
          )}
        </CardContent>
      </Card>

      {rest.length > 0 && (
        <section aria-labelledby="answered-heading" className="space-y-2">
          <h2 id="answered-heading" className="font-serif text-lg font-semibold text-foreground">Declined, cancelled and past</h2>
          <Card>
            <CardContent className="divide-y divide-border font-sans pt-2">
              {rest.map((r) => (
                <div key={r.id} className="py-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                  <Badge variant="outline" className="font-normal">
                    {r.shown === 'cancelled' && r.cancelled_by === 'guest' ? 'Cancelled by guest' : STATUS_LABEL[r.shown]}
                  </Badge>
                  <span className="text-muted-foreground">{formatReservationDay(r.at.day, 'en', 'short')}, {r.at.time}</span>
                  <span className="font-medium text-foreground">{r.guest_name}</span>
                  <span className="text-muted-foreground">{r.party_size} {r.party_size === 1 ? 'guest' : 'guests'}</span>
                  <a href={telHref(r.guest_phone)} className="text-primary underline underline-offset-4">{r.guest_phone}</a>
                  {r.shown === 'declined' && Date.parse(r.reserved_for) > now && (
                    <Button variant="ghost" size="sm" disabled={answering === r.id} onClick={() => void answer(r, 'confirm', r.reply ?? '')} className="ml-auto">
                      Confirm after all
                    </Button>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        </section>
      )}

      <AlertDialog open={!!cancelling} onOpenChange={(open) => { if (!open) setCancelling(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-serif">Cancel this reservation?</AlertDialogTitle>
            <AlertDialogDescription>
              {cancelling && <>{cancelling.guest_name}, {cancelling.party_size} {cancelling.party_size === 1 ? 'guest' : 'guests'}, {formatReservationDay(restaurantDayTime(cancelling.reserved_for).day, 'en', 'short')} at {restaurantDayTime(cancelling.reserved_for).time}. Their page will say the restaurant cancelled. Call them too: they may not look.</>}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div>
            <Label htmlFor="cancel-reply" className="text-xs text-muted-foreground">A line for the guest (optional)</Label>
            <Input id="cancel-reply" value={cancelReply} maxLength={300} onChange={(e) => setCancelReply(e.target.value)} className="mt-1 h-11" />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction onClick={() => { const r = cancelling; setCancelling(null); if (r) void answer(r, 'cancel', cancelReply); }}>
              Cancel the reservation
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default AdminReservations;
