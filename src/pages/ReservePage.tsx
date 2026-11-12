import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, CalendarClock, Loader2, Phone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { useLanguageStore } from '@/lib/i18n';
import { HOME_VENUE } from '@/lib/home-venue';
import { VENUES } from '@/lib/venues';
import { sitePath } from '@/lib/seo/structured-data';
import { useNoIndex } from '@/lib/seo/noindex';
import { rcopy, refusalCopy } from '@/lib/reservation-copy';
import {
  formatReservationDay, looksLikePhone, readReservation, readReservationOptions, recallReservation, rememberReservation,
  requestReservation, reservationDays, reservationPath, reservationTimes, ReservationRefused,
  type Refusal, type ReservationKey, type ReservationOptions,
} from '@/lib/reservations';

const VENUE = VENUES[HOME_VENUE];

/** Dinner time, when the day still has it: the time most tables are asked for. */
const USUAL_TIME = '19:00';

const selectClass = 'w-full h-12 rounded-xl border border-input bg-background px-3 text-base font-sans text-foreground focus:outline-none focus:ring-2 focus:ring-ring';

/**
 * "Reserve a table" on the restaurant's own website (/reserve).
 *
 * The guest picks a day, a time and how many, and leaves a name and a phone
 * number. That is a request: the restaurant's admin answers it, and the
 * guest's own page (/reserve/<id>) shows the answer. Days and times are the
 * restaurant's (its date, its clock, its notice), read from the database, so
 * a phone in another time zone is offered what the restaurant still has.
 */
const ReservePage = () => {
  const locale = useLanguageStore((s) => s.locale);
  const navigate = useNavigate();
  // Not named t: src/lib/i18n.test.ts reads every rc('…') in the app as a key of the menu's own dictionary.
  const rc = (key: Parameters<typeof rcopy>[0], vars?: Record<string, string | number>) => rcopy(key, locale, vars);
  useNoIndex();

  const [options, setOptions] = useState<ReservationOptions | null>(null);
  const [existing, setExisting] = useState<ReservationKey | null>(null);
  const [day, setDay] = useState('');
  const [time, setTime] = useState('');
  const [party, setParty] = useState(2);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [note, setNote] = useState('');
  const [trap, setTrap] = useState('');
  const [sending, setSending] = useState(false);
  const [refusal, setRefusal] = useState<Refusal | null>(null);

  useEffect(() => { document.title = `${rcopy('title', locale)} · ${VENUE.name}`; }, [locale]);

  useEffect(() => {
    let cancelled = false;
    void readReservationOptions(VENUE.slug).then((o) => { if (!cancelled) setOptions(o); });
    // A request made on this phone that is still open: offer the way back to it.
    const kept = recallReservation(VENUE.slug);
    if (kept) {
      void readReservation(kept)
        .then((r) => { if (!cancelled && r && (r.status === 'pending' || r.status === 'confirmed')) setExisting(kept); })
        .catch(() => undefined);
    }
    return () => { cancelled = true; };
  }, []);

  const days = useMemo(() => (options?.enabled ? reservationDays(options) : []), [options]);
  const times = useMemo(() => (options?.enabled && day ? reservationTimes(options, day) : []), [options, day]);

  // The first day that still has a time; then, on any day, dinner time if it has it.
  useEffect(() => {
    if (!options?.enabled || day) return;
    setDay(days.find((d) => reservationTimes(options, d).length > 0) ?? days[0] ?? '');
  }, [options, days, day]);
  useEffect(() => {
    if (times.includes(time)) return;
    setTime(times.includes(USUAL_TIME) ? USUAL_TIME : times[0] ?? '');
  }, [times, time]);

  const phoneShown = options?.phone ?? (VENUE.phone || null);
  const phoneHref = (phoneShown ?? '').replace(/[^\d+]/g, '');

  /*
   * A phone number inside an Arabic sentence: kept in its own left-to-right
   * run, or its groups are laid out last-first ("779 877 33 387+").
   */
  const ltr = (text: string) => (locale === 'ar' ? `\u2066${text}\u2069` : text);
  const dayLabel = (d: string, i: number) => {
    const named = formatReservationDay(d, locale);
    return i === 0 ? `${rc('today')} · ${named}` : i === 1 ? `${rc('tomorrow')} · ${named}` : named;
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (sending || !options?.enabled) return;
    if (name.trim().length < 2) { setRefusal('name'); return; }
    if (!looksLikePhone(phone)) { setRefusal('phone'); return; }
    if (!day || !time) { setRefusal('hours'); return; }
    setSending(true);
    setRefusal(null);
    try {
      const key = await requestReservation({ venueSlug: VENUE.slug, name, phone, party, day, time, note, locale, trap });
      rememberReservation(VENUE.slug, key);
      navigate(reservationPath(key));
    } catch (error) {
      setRefusal(error instanceof ReservationRefused ? error.reason : 'unknown');
      // What the restaurant still has may have changed while the form was open.
      if (error instanceof ReservationRefused && ['soon', 'hours', 'time', 'far', 'disabled'].includes(error.reason)) {
        void readReservationOptions(VENUE.slug).then(setOptions);
      }
    } finally {
      setSending(false);
    }
  };

  const callLink = phoneShown ? (
    <a href={`tel:${phoneHref}`} className="inline-flex items-center justify-center gap-2 min-h-[48px] px-5 rounded-xl border border-border bg-background font-sans font-semibold text-foreground">
      <Phone className="w-4 h-4" aria-hidden />
      <span>{rc('call', { phone: ltr(phoneShown) })}</span>
    </a>
  ) : null;

  return (
    <div className="min-h-screen bg-background pb-16" dir={locale === 'ar' ? 'rtl' : 'ltr'}>
      <div className="sticky top-0 z-30 glass">
        <div className="flex items-center gap-3 px-4 py-4 max-w-xl mx-auto">
          <Link to={sitePath(locale)} aria-label={rc('back', { venue: VENUE.name })} className="p-2.5 -ms-2 rounded-full hover:bg-muted transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center">
            <ArrowLeft className={`w-5 h-5 text-foreground ${locale === 'ar' ? 'rotate-180' : ''}`} />
          </Link>
          <div className="flex items-center gap-2 min-w-0">
            <CalendarClock className="w-5 h-5 text-primary shrink-0" aria-hidden />
            <h1 className="font-serif text-xl font-semibold text-foreground truncate">{rc('title')}</h1>
          </div>
          <span className="ms-auto text-sm font-sans text-muted-foreground truncate">{VENUE.name}</span>
        </div>
        <div className="h-px bg-gradient-to-r from-transparent via-primary/20 to-transparent" />
      </div>

      <main className="px-4 pt-5 space-y-4 max-w-xl mx-auto">
        {existing && (
          <Link to={reservationPath(existing)} className="block rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 text-sm font-sans font-semibold text-foreground underline underline-offset-4">
            {rc('existing')}
          </Link>
        )}

        {!options ? (
          <div className="card-lux p-5 space-y-4" aria-busy="true">
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : !options.enabled ? (
          <div className="card-lux p-6 text-center space-y-3">
            <h2 className="font-serif text-xl font-semibold text-foreground">{rc('closed_title')}</h2>
            <p className="text-sm text-muted-foreground font-sans">{rc(phoneShown ? 'closed_body' : 'closed_body_no_phone')}</p>
            {callLink}
          </div>
        ) : (
          <>
            <p className="text-sm text-muted-foreground font-sans px-1 leading-relaxed">{rc('intro')}</p>
            {/* The restaurant's own line, in whatever language it was written. */}
            {options.note && <p dir="auto" className="text-sm font-sans text-foreground px-1 leading-relaxed">{options.note}</p>}

            <form onSubmit={submit} noValidate className="card-lux p-5 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="reserve-day" className="font-sans text-sm">{rc('day')}</Label>
                  <select id="reserve-day" value={day} onChange={(e) => setDay(e.target.value)} className={`${selectClass} mt-1.5`}>
                    {days.map((d, i) => <option key={d} value={d}>{dayLabel(d, i)}</option>)}
                  </select>
                </div>
                <div>
                  <Label htmlFor="reserve-time" className="font-sans text-sm">{rc('time')}</Label>
                  <select id="reserve-time" value={time} onChange={(e) => setTime(e.target.value)} disabled={times.length === 0} className={`${selectClass} mt-1.5`} dir="ltr">
                    {times.map((x) => <option key={x} value={x}>{x}</option>)}
                  </select>
                </div>
              </div>
              {times.length === 0 && <p role="status" className="text-sm font-sans text-destructive">{rc('no_times')}</p>}

              <div>
                <Label htmlFor="reserve-party" className="font-sans text-sm">{rc('guests')}</Label>
                <select id="reserve-party" value={party} onChange={(e) => setParty(Number(e.target.value))} className={`${selectClass} mt-1.5`} dir="ltr">
                  {Array.from({ length: options.maxParty }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>

              <div>
                <Label htmlFor="reserve-name" className="font-sans text-sm">{rc('name')}</Label>
                <Input id="reserve-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={80}
                  aria-invalid={refusal === 'name'} className="mt-1.5 h-12 text-base" />
              </div>

              <div>
                <Label htmlFor="reserve-phone" className="font-sans text-sm">{rc('phone')}</Label>
                <Input id="reserve-phone" type="tel" inputMode="tel" dir="ltr" value={phone} onChange={(e) => setPhone(e.target.value)}
                  autoComplete="tel" maxLength={30} aria-invalid={refusal === 'phone'} aria-describedby="reserve-phone-hint" className="mt-1.5 h-12 text-base" />
                <p id="reserve-phone-hint" className="text-xs text-muted-foreground font-sans mt-1">{rc('phone_hint')}</p>
              </div>

              <div>
                <Label htmlFor="reserve-note" className="font-sans text-sm">{rc('note')}</Label>
                <Textarea id="reserve-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} rows={2}
                  placeholder={rc('note_placeholder')} className="mt-1.5 text-base" />
              </div>

              {/* For robots only: a person never sees or reaches this field. Clipped in place, not
                  parked off-screen: far to the left is somewhere an Arabic page can scroll to. */}
              <div aria-hidden="true" className="sr-only">
                <label htmlFor="reserve-website">Website</label>
                <input id="reserve-website" name="website" type="text" tabIndex={-1} autoComplete="off" value={trap} onChange={(e) => setTrap(e.target.value)} />
              </div>

              {refusal && (
                <div role="alert" className="rounded-xl bg-destructive/10 px-4 py-3 text-sm font-sans text-destructive space-y-2">
                  <p>{refusalCopy(refusal, locale)}</p>
                  {phoneShown && ['party', 'soon', 'repeat', 'busy', 'disabled'].includes(refusal) && (
                    <a href={`tel:${phoneHref}`} className="inline-block font-semibold underline underline-offset-4">{rc('call', { phone: ltr(phoneShown) })}</a>
                  )}
                </div>
              )}

              <Button type="submit" disabled={sending || times.length === 0} className="w-full h-12 rounded-xl font-sans font-semibold text-base gap-2">
                {sending ? <><Loader2 className="w-4 h-4 animate-spin" /> {rc('sending')}</> : rc('send')}
              </Button>
              <p className="text-xs text-muted-foreground font-sans text-center">{rc('privacy')}</p>
            </form>

            {callLink && <div className="flex justify-center pt-1">{callLink}</div>}
          </>
        )}
      </main>
    </div>
  );
};

export default ReservePage;
