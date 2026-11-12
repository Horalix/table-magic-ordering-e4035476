import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, CalendarCheck, CalendarClock, CalendarX, Clock, Loader2, Phone, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useLanguageStore } from '@/lib/i18n';
import { HOME_VENUE } from '@/lib/home-venue';
import { VENUES, venueBySlug } from '@/lib/venues';
import { sitePath } from '@/lib/seo/structured-data';
import { useNoIndex } from '@/lib/seo/noindex';
import { rcopy, statusTitle } from '@/lib/reservation-copy';
import {
  cancelReservation, forgetReservation, formatReservationDay, readReservation, rememberReservation,
  type GuestReservation, type ReservationStatus,
} from '@/lib/reservations';

/** While waiting: often enough that an answer feels immediate. Once confirmed: enough to learn of a cancellation. */
const WAITING_MS = 5_000;
const CONFIRMED_MS = 30_000;
/** After this long without an answer the page says "call us". */
const LONG_WAIT_SECONDS = 8 * 60;

const pollEvery = (status: ReservationStatus | null): number | null =>
  status === 'pending' ? WAITING_MS : status === 'confirmed' ? CONFIRMED_MS : status === null ? WAITING_MS : null;

type Found = { kind: 'loading' } | { kind: 'missing' } | { kind: 'found'; reservation: GuestReservation };

const LOOK: Record<ReservationStatus, { icon: typeof Clock; tone: string }> = {
  pending: { icon: Clock, tone: 'bg-primary/10 text-primary' },
  confirmed: { icon: CalendarCheck, tone: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400' },
  declined: { icon: CalendarX, tone: 'bg-destructive/10 text-destructive' },
  cancelled: { icon: CalendarX, tone: 'bg-muted text-muted-foreground' },
  expired: { icon: CalendarX, tone: 'bg-muted text-muted-foreground' },
};

/**
 * The guest's own reservation (/reservation/<id>?t=<token>): what they asked for
 * and the restaurant's answer, which appears by itself. The page asks again
 * every few seconds while the request waits, and when the phone comes back
 * to it; nobody has to reload.
 */
const ReservationPage = () => {
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const token = params.get('t') ?? '';
  const locale = useLanguageStore((s) => s.locale);
  // Not named t: src/lib/i18n.test.ts reads every rc('…') in the app as a key of the menu's own dictionary.
  const rc = (key: Parameters<typeof rcopy>[0], vars?: Record<string, string | number>) => rcopy(key, locale, vars);
  useNoIndex();

  const [found, setFound] = useState<Found>({ kind: 'loading' });
  const [offline, setOffline] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const lastStatus = useRef<ReservationStatus | null>(null);

  const reservation = found.kind === 'found' ? found.reservation : null;
  const status = reservation?.status ?? null;

  const take = useCallback((r: GuestReservation | null) => {
    if (!r) { setFound({ kind: 'missing' }); return; }
    // The answer has just arrived: a short buzz, where the phone allows one.
    if (lastStatus.current === 'pending' && r.status !== 'pending') {
      try { navigator.vibrate?.([200, 100, 200]); } catch { /* not allowed here */ }
    }
    lastStatus.current = r.status;
    setFound({ kind: 'found', reservation: r });
    if (r.status === 'pending' || r.status === 'confirmed') rememberReservation(r.venue, { id, token });
    else forgetReservation(r.venue);
  }, [id, token]);

  const load = useCallback(async () => {
    if (!id || !token) { setFound({ kind: 'missing' }); return; }
    try {
      take(await readReservation({ id, token }));
      setOffline(false);
    } catch {
      setOffline(true);
    }
  }, [id, token, take]);

  // Ask now, then again for as long as an answer can still change.
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      await load();
      if (stopped) return;
      const every = pollEvery(lastStatus.current);
      if (every !== null && id && token) timer = setTimeout(tick, every);
    };
    void tick();
    const onVisible = () => { if (document.visibilityState === 'visible') void load(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onVisible);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onVisible);
    };
  }, [load, id, token]);

  const venue = (reservation && venueBySlug(reservation.venue)) || VENUES[HOME_VENUE];
  useEffect(() => {
    document.title = `${status ? statusTitle(status, reservation?.cancelledBy ?? null, locale) : rcopy('title', locale)} · ${venue.name}`;
  }, [status, reservation?.cancelledBy, locale, venue.name]);

  const phoneShown = reservation?.phone ?? (venue.phone || null);
  const phoneHref = (phoneShown ?? '').replace(/[^\d+]/g, '');

  /*
   * A phone number inside an Arabic sentence: kept in its own left-to-right
   * run, or its groups are laid out last-first ("779 877 33 387+").
   */
  const ltr = (text: string) => (locale === 'ar' ? `\u2066${text}\u2069` : text);

  const cancel = async () => {
    if (cancelling) return;
    setCancelling(true);
    try {
      take(await cancelReservation({ id, token }));
    } catch {
      setOffline(true);
    } finally {
      setCancelling(false);
      setConfirmCancel(false);
    }
  };

  const body = (() => {
    if (!reservation) return '';
    switch (reservation.status) {
      case 'pending': return reservation.waitedSeconds > LONG_WAIT_SECONDS && phoneShown
        ? rc('pending_long', { code: ltr(reservation.code) }) : rc('pending_body');
      case 'confirmed': return rc('confirmed_body');
      case 'declined': return rc('declined_body');
      case 'cancelled': return reservation.cancelledBy === 'restaurant' ? rc('cancelled_restaurant_body') : '';
      default: return rc('expired_body');
    }
  })();

  const look = status ? LOOK[status] : LOOK.pending;
  const Icon = look.icon;
  const over = status === 'declined' || status === 'cancelled' || status === 'expired';

  return (
    <div className="min-h-screen bg-background pb-16" dir={locale === 'ar' ? 'rtl' : 'ltr'}>
      <div className="sticky top-0 z-30 glass">
        <div className="flex items-center gap-3 px-4 py-4 max-w-xl mx-auto">
          <Link to={sitePath(locale)} aria-label={rc('back', { venue: venue.name })} className="p-2.5 -ms-2 rounded-full hover:bg-muted transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center">
            <ArrowLeft className={`w-5 h-5 text-foreground ${locale === 'ar' ? 'rotate-180' : ''}`} />
          </Link>
          <div className="flex items-center gap-2 min-w-0">
            <CalendarClock className="w-5 h-5 text-primary shrink-0" aria-hidden />
            <p className="font-serif text-xl font-semibold text-foreground truncate">{rc('title')}</p>
          </div>
          <span className="ms-auto text-sm font-sans text-muted-foreground truncate">{venue.name}</span>
        </div>
        <div className="h-px bg-gradient-to-r from-transparent via-primary/20 to-transparent" />
      </div>

      <main className="px-4 pt-5 space-y-4 max-w-xl mx-auto">
        {offline && <p role="status" className="rounded-xl bg-muted px-4 py-3 text-sm font-sans text-muted-foreground">{rc('offline')}</p>}

        {found.kind === 'loading' && !offline && (
          <div className="card-lux p-6 space-y-4" aria-busy="true">
            <Skeleton className="h-12 w-12 rounded-full mx-auto" />
            <Skeleton className="h-6 w-2/3 mx-auto" />
            <Skeleton className="h-20 w-full" />
          </div>
        )}

        {found.kind === 'missing' && (
          <div className="card-lux p-6 text-center space-y-3">
            <h1 className="font-serif text-xl font-semibold text-foreground">{rc('not_found_title')}</h1>
            <p className="text-sm text-muted-foreground font-sans">{rc('not_found_body')}</p>
            <Button asChild className="h-12 rounded-xl font-sans font-semibold"><Link to="/reserve">{rc('another')}</Link></Button>
          </div>
        )}

        {reservation && (
          <>
            <section className="card-lux p-6 text-center space-y-3" aria-live="polite">
              <span className={`w-14 h-14 rounded-full grid place-items-center mx-auto ${look.tone}`}>
                {status === 'pending' ? <Loader2 className="w-7 h-7 animate-spin" aria-hidden /> : <Icon className="w-7 h-7" aria-hidden />}
              </span>
              <h1 data-testid="reservation-status" data-status={reservation.status} className="font-serif text-2xl font-semibold text-foreground">
                {statusTitle(reservation.status, reservation.cancelledBy, locale)}
              </h1>
              {body && <p className="text-sm text-muted-foreground font-sans leading-relaxed">{body}</p>}
              {reservation.reply && (
                <div className="rounded-xl bg-muted/60 px-4 py-3 text-start">
                  <p className="text-[11px] font-sans font-semibold uppercase tracking-wide text-muted-foreground">{rc('from_restaurant')}</p>
                  <p className="text-sm font-sans text-foreground mt-0.5" dir="auto">{reservation.reply}</p>
                </div>
              )}
            </section>

            <section className="card-lux p-5 space-y-3 font-sans">
              <div className="flex items-start gap-3">
                <CalendarClock className="w-5 h-5 text-primary shrink-0 mt-0.5" aria-hidden />
                <div>
                  <p className="font-semibold text-foreground">{formatReservationDay(reservation.day, locale)}</p>
                  <p className="text-2xl font-serif font-semibold text-foreground leading-tight" dir="ltr">{reservation.time}</p>
                </div>
              </div>
              <div className="flex items-center gap-3 text-sm text-foreground">
                <Users className="w-5 h-5 text-primary shrink-0" aria-hidden />
                <span>{rc('for_guests', { count: reservation.partySize })} · <span dir="auto">{reservation.name}</span></span>
              </div>
              {reservation.note && (
                <p className="text-sm text-muted-foreground"><span className="font-semibold">{rc('your_note')}:</span> <span dir="auto">{reservation.note}</span></p>
              )}
              <p className="text-xs text-muted-foreground">{rc('code', { code: ltr(reservation.code) })}</p>
            </section>

            <div className="flex flex-col gap-2">
              {phoneShown && (
                <a href={`tel:${phoneHref}`} className="inline-flex items-center justify-center gap-2 min-h-[48px] px-5 rounded-xl border border-border bg-background font-sans font-semibold text-foreground">
                  <Phone className="w-4 h-4" aria-hidden />
                  <span>{rc('call', { phone: ltr(phoneShown) })}</span>
                </a>
              )}
              {over && (
                <Button asChild className="h-12 rounded-xl font-sans font-semibold"><Link to="/reserve">{rc('another')}</Link></Button>
              )}
              {(status === 'pending' || status === 'confirmed') && (
                <Button type="button" variant="ghost" onClick={() => setConfirmCancel(true)} className="h-12 rounded-xl font-sans text-muted-foreground">
                  {rc('cancel')}
                </Button>
              )}
            </div>
          </>
        )}
      </main>

      <AlertDialog open={confirmCancel} onOpenChange={setConfirmCancel}>
        <AlertDialogContent dir={locale === 'ar' ? 'rtl' : 'ltr'}>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-serif">{rc('cancel_confirm')}</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{rc('cancel_no')}</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); void cancel(); }} disabled={cancelling}>
              {cancelling ? <Loader2 className="w-4 h-4 animate-spin" /> : rc('cancel_yes')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default ReservationPage;
