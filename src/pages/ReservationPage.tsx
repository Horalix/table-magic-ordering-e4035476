import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRight, CalendarCheck, CalendarPlus, CalendarX, Check, Clock, Loader2, MapPin, MessageSquareText, Phone, SearchX, Users, WifiOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { ReserveCard, ReserveEyebrow, ReserveFrame, ReservePhotoImage, ReserveRise, RESERVE_PILL } from '@/components/reserve/ReserveShell';
import { reserveLook } from '@/components/reserve/reserve-look';
import { cn } from '@/lib/utils';
import { springSuccess } from '@/lib/motion';
import { useLanguageStore } from '@/lib/i18n';
import { HOME_VENUE } from '@/lib/home-venue';
import { VENUES, venueBySlug } from '@/lib/venues';
import { useNoIndex } from '@/lib/seo/noindex';
import { rcopy, statusTitle } from '@/lib/reservation-copy';
import {
  cancelReservation, forgetReservation, formatReservationDay, readReservation, rememberReservation,
  type GuestReservation, type ReservationStatus,
} from '@/lib/reservations';
import { calendarLink } from '@/lib/reservation-messages';

/** While waiting: often enough that an answer feels immediate. Once confirmed: enough to learn of a cancellation. */
const WAITING_MS = 5_000;
const CONFIRMED_MS = 30_000;
/** After this long without an answer the page says "call us". */
const LONG_WAIT_SECONDS = 8 * 60;

const pollEvery = (status: ReservationStatus | null): number | null =>
  status === 'pending' ? WAITING_MS : status === 'confirmed' ? CONFIRMED_MS : status === null ? WAITING_MS : null;

type Found = { kind: 'loading' } | { kind: 'missing' } | { kind: 'found'; reservation: GuestReservation };

/** Each answer has its own colour and mark, and says it in words too: never colour alone. */
const LOOK: Record<ReservationStatus, { icon: typeof Clock; tone: string }> = {
  pending: { icon: Clock, tone: 'bg-primary text-primary-foreground' },
  confirmed: { icon: CalendarCheck, tone: 'bg-emerald-600 text-white' },
  declined: { icon: CalendarX, tone: 'bg-destructive text-destructive-foreground' },
  cancelled: { icon: CalendarX, tone: 'bg-muted-foreground text-background' },
  expired: { icon: CalendarX, tone: 'bg-muted-foreground text-background' },
};

const ACTION = 'inline-flex min-h-[52px] items-center justify-center gap-2 px-5 font-sans text-[15px] font-semibold transition-[background-color,border-color,opacity] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background';
const ACTION_FILLED = 'bg-primary text-primary-foreground shadow-[0_16px_32px_-16px_hsl(var(--primary)/0.85)] hover:opacity-90';
const ACTION_QUIET = 'border border-border bg-card text-foreground hover:border-primary/40';

/**
 * The guest's own reservation (/reservation/<id>?t=<token>): what they asked for
 * and the restaurant's answer, which appears by itself. The page asks again
 * every few seconds while the request waits, and when the phone comes back
 * to it; nobody has to reload.
 *
 * Drawn as the restaurant's ticket: its photograph across the top, the answer
 * under it, then the table asked for (src/components/reserve/ReserveShell.tsx).
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
  const ltr = (text: string) => (locale === 'ar' ? `⁦${text}⁩` : text);

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
  const photo = reserveLook(venue.slug).wide;

  return (
    <ReserveFrame venue={venue} locale={locale}>
      <main className="mx-auto flex min-h-[100dvh] w-full max-w-[30rem] flex-col justify-center px-5 pb-16 pt-24 sm:px-6 lg:pt-28">
        {offline && (
          <p role="status" className="mb-4 flex items-center gap-2.5 rounded-[calc(var(--radius)+2px)] bg-muted px-4 py-3 font-sans text-sm text-muted-foreground">
            <WifiOff className="h-4 w-4 shrink-0" aria-hidden />
            {rc('offline')}
          </p>
        )}

        {found.kind === 'loading' && !offline && (
          <ReserveCard className="overflow-hidden" aria-busy="true">
            <Skeleton className="h-32 w-full rounded-none" />
            <div className="space-y-4 p-7">
              <Skeleton className="mx-auto h-7 w-2/3" />
              <Skeleton className="mx-auto h-4 w-4/5" />
              <Skeleton className="h-24 w-full" />
            </div>
          </ReserveCard>
        )}

        {found.kind === 'missing' && (
          <ReserveRise>
            <ReserveCard className="p-7 text-center sm:p-10">
              <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-muted text-muted-foreground ring-8 ring-muted/50" aria-hidden>
                <SearchX className="h-6 w-6" />
              </span>
              <h1 className="mt-6 font-serif text-2xl font-semibold leading-tight text-foreground text-balance">{rc('not_found_title')}</h1>
              <p className="mx-auto mt-2 max-w-sm font-sans text-[15px] leading-relaxed text-muted-foreground">{rc('not_found_body')}</p>
              <Link to="/reserve" className={cn(ACTION, ACTION_FILLED, RESERVE_PILL, 'group mt-7')}>
                {rc('another')}
                <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-0.5 rtl:-scale-x-100 rtl:group-hover:-translate-x-0.5" aria-hidden />
              </Link>
            </ReserveCard>
          </ReserveRise>
        )}

        {reservation && (
          <ReserveRise className="space-y-4">
            <ReserveCard className="overflow-hidden">
              {/* The restaurant, across the top of its ticket. */}
              <div className="relative h-32 bg-secondary sm:h-36">
                <ReservePhotoImage photo={photo} alt="" sizes="(min-width: 640px) 480px, 100vw" />
                <div aria-hidden className="absolute inset-0 bg-gradient-to-t from-card via-card/10 via-[45%] to-transparent" />
              </div>

              <section className="relative -mt-10 px-6 pb-7 text-center sm:px-8" aria-live="polite">
                <span className="relative mx-auto grid h-[76px] w-[76px] place-items-center">
                  {/* Waiting breathes; an answer is still. */}
                  {status === 'pending' && <span aria-hidden className="absolute inset-0 animate-ping rounded-full bg-primary/25 [animation-duration:2.4s] motion-reduce:hidden" />}
                  <motion.span
                    key={status}
                    initial={{ scale: 0.6, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={springSuccess}
                    className={cn('relative grid h-[76px] w-[76px] place-items-center rounded-full ring-[6px] ring-card', look.tone)}
                  >
                    <Icon className="h-8 w-8" strokeWidth={1.75} aria-hidden />
                  </motion.span>
                </span>

                <ReserveEyebrow className="mt-5 justify-center [&>span:first-child]:hidden">{venue.name}</ReserveEyebrow>
                <h1 data-testid="reservation-status" data-status={reservation.status} className="mt-2 font-serif text-[1.75rem] font-semibold leading-tight text-foreground text-balance">
                  {statusTitle(reservation.status, reservation.cancelledBy, locale)}
                </h1>
                {body && <p className="mx-auto mt-2 max-w-sm font-sans text-[15px] leading-relaxed text-muted-foreground">{body}</p>}

                {/* Where the request stands: sent, then the restaurant's answer. */}
                {(status === 'pending' || status === 'confirmed') && (
                  <ol data-testid="reservation-steps" className="mx-auto mt-5 flex w-fit flex-col items-start justify-center gap-x-2.5 gap-y-1 font-sans text-[13px] min-[420px]:flex-row min-[420px]:items-center">
                    <li className="inline-flex items-center gap-1.5 font-medium text-foreground">
                      <span className="grid h-5 w-5 place-items-center rounded-full bg-primary text-primary-foreground"><Check className="h-3 w-3" aria-hidden /></span>
                      {rc('step_sent')}
                    </li>
                    {/* Side by side where the two fit on a line; one under the other on a narrow phone. */}
                    <li aria-hidden className={cn('ms-[9.5px] h-3 w-px min-[420px]:ms-0 min-[420px]:h-px min-[420px]:w-7', status === 'confirmed' ? 'bg-primary' : 'bg-border')} />
                    <li className={cn('inline-flex items-center gap-1.5 font-medium', status === 'confirmed' ? 'text-foreground' : 'text-muted-foreground')}>
                      <span className={cn('grid h-5 w-5 place-items-center rounded-full', status === 'confirmed' ? 'bg-primary text-primary-foreground' : 'border border-border')}>
                        {status === 'confirmed' ? <Check className="h-3 w-3" aria-hidden /> : <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500 motion-reduce:animate-none" />}
                      </span>
                      {rc(status === 'confirmed' ? 'step_confirmed' : 'step_answer')}
                    </li>
                  </ol>
                )}

                {reservation.reply && (
                  <div className="mt-5 rounded-[calc(var(--radius)+2px)] bg-secondary/70 px-4 py-3 text-start">
                    <p className="font-sans text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground rtl:tracking-normal">{rc('from_restaurant')}</p>
                    <p className="mt-1 font-sans text-[15px] leading-relaxed text-foreground" dir="auto">{reservation.reply}</p>
                  </div>
                )}
              </section>

              {/* The tear line of a ticket: a dashed rule between two notches cut from the card's edges. */}
              <div aria-hidden className="relative">
                <span className="absolute -start-3 top-1/2 h-6 w-6 -translate-y-1/2 rounded-full border border-border/70 bg-background" />
                <span className="absolute -end-3 top-1/2 h-6 w-6 -translate-y-1/2 rounded-full border border-border/70 bg-background" />
                <div className="mx-7 border-t border-dashed border-border" />
              </div>

              <section className={cn('px-6 pb-7 pt-6 text-center font-sans sm:px-8', over && 'opacity-60')}>
                <p className="font-serif text-xl font-semibold text-foreground">{formatReservationDay(reservation.day, locale)}</p>
                <p className="mt-1 font-serif text-[3.25rem] font-medium leading-none tracking-[-0.02em] text-foreground" dir="ltr">{reservation.time}</p>
                <p className="mt-5 flex items-center justify-center gap-2.5 text-[15px] text-foreground">
                  <Users className="h-[18px] w-[18px] shrink-0 text-primary" aria-hidden />
                  <span>{rc('for_guests', { count: reservation.partySize })} · <span dir="auto">{reservation.name}</span></span>
                </p>
                {reservation.note && (
                  <p className="mt-2.5 flex items-start justify-center gap-2.5 text-sm leading-relaxed text-muted-foreground">
                    <MessageSquareText className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
                    <span><span className="font-semibold">{rc('your_note')}:</span> <span dir="auto">{reservation.note}</span></span>
                  </p>
                )}
                <p className="mt-5 inline-flex rounded-full bg-muted px-3.5 py-1.5 text-xs font-medium tabular-nums text-muted-foreground">{rc('code', { code: ltr(reservation.code) })}</p>
              </section>
            </ReserveCard>

            <div className="flex flex-col gap-2.5">
              {/* A confirmed table: into the guest's calendar, and the way there. */}
              {status === 'confirmed' && (
                <div className="grid gap-2.5 min-[420px]:grid-cols-2">
                  <a
                    href={calendarLink({
                      id, day: reservation.day, time: reservation.time, title: rc('calendar_title', { venue: venue.name }),
                      where: [venue.name, venue.address, venue.city].filter(Boolean).join(', '),
                      details: `${rc('for_guests', { count: reservation.partySize })}. ${rc('code', { code: reservation.code })}`,
                    })}
                    download="reservation.ics"
                    className={cn(ACTION, ACTION_FILLED, RESERVE_PILL, !venue.mapsUrl && 'min-[420px]:col-span-2')}
                  >
                    <CalendarPlus className="h-4 w-4" aria-hidden />
                    {rc('add_calendar')}
                  </a>
                  {venue.mapsUrl && (
                    <a href={venue.mapsUrl} target="_blank" rel="noreferrer" className={cn(ACTION, ACTION_QUIET, RESERVE_PILL)}>
                      <MapPin className="h-4 w-4 text-primary" aria-hidden />
                      {rc('directions')}
                    </a>
                  )}
                </div>
              )}
              {over && (
                <Link to="/reserve" className={cn(ACTION, ACTION_FILLED, RESERVE_PILL, 'group')}>
                  {rc('another')}
                  <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-0.5 rtl:-scale-x-100 rtl:group-hover:-translate-x-0.5" aria-hidden />
                </Link>
              )}
              {phoneShown && (
                <a href={`tel:${phoneHref}`} className={cn(ACTION, ACTION_QUIET, RESERVE_PILL)}>
                  <Phone className="h-4 w-4 text-primary" aria-hidden />
                  <span>{rc('call', { phone: ltr(phoneShown) })}</span>
                </a>
              )}
              {(status === 'pending' || status === 'confirmed') && (
                <Button type="button" variant="ghost" onClick={() => setConfirmCancel(true)} className={cn('h-12 font-sans text-sm text-muted-foreground', RESERVE_PILL)}>
                  {rc('cancel')}
                </Button>
              )}
            </div>
          </ReserveRise>
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
    </ReserveFrame>
  );
};

export default ReservationPage;
