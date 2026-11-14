import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, ChevronDown, ChevronLeft, ChevronRight, Loader2, Phone, Plus } from 'lucide-react';
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
import { usePageMeta } from '@/lib/seo/page-meta';
import { RESERVE_PATH, reserveFaq, reserveMeta, reserveSteps } from '@/lib/seo/reservations';
import { rcopy, refusalCopy } from '@/lib/reservation-copy';
import {
  DAY_PARTS, formatReservationDay, intlTag, looksLikePhone, partOfDay, readReservation, readReservationOptions,
  recallReservation, rememberReservation, requestReservation, reservationDayParts, reservationDays, reservationPath,
  reservationTimes, ReservationRefused,
  type DayPart, type Refusal, type ReservationKey, type ReservationOptions,
} from '@/lib/reservations';

const VENUE = VENUES[HOME_VENUE];

/** The three steps, one screen each: when, how many, who. */
const STEPS = ['when', 'party', 'details'] as const;
type Step = 0 | 1 | 2;

/** Days shown at a time in the day strip; the arrows (or a swipe) show the next few. */
const DAYS_PER_PAGE = 5;

/** How long a tapped time or party size stays on screen, chosen, before the next step slides in. */
const ADVANCE_MS = 220;

/** A choice among a few: a day, a time, how many. Filled when it is the one chosen. */
const choice = (chosen: boolean) =>
  `border font-sans transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
    chosen ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background text-foreground hover:border-primary/50'}`;

const monthName = (day: string, locale: Parameters<typeof intlTag>[0]) => {
  const [y, m, d] = day.split('-').map(Number);
  return new Intl.DateTimeFormat(intlTag(locale), { timeZone: 'UTC', month: 'long' }).format(new Date(Date.UTC(y, m - 1, d)));
};

/**
 * "Reserve a table" on the restaurant's own website (/reserve/).
 *
 * Three short steps, each one screen, so nothing has to be scrolled for:
 *  1. when: a day from a strip of five (the arrows or a swipe show more) and
 *     a time from the part of the day the guest wants. Tapping a time moves
 *     on by itself;
 *  2. how many: one tap, and it moves on;
 *  3. who: a name and a phone number, and the request is sent.
 * What has been chosen so far stays at the top of the card, each part a tap
 * back to where it was chosen.
 *
 * That is a request: the restaurant's admin answers it, and the guest's own
 * page (/reservation/<id>) shows the answer. Days and times are the
 * restaurant's (its date, its clock, its notice), read from the database, so a
 * phone in another time zone is offered what the restaurant still has.
 *
 * While the restaurant takes requests online this page is what search and
 * answer engines list for "reserve a table at …": its title, description and
 * address match the page the build wrote (scripts/seo-prerender.ts), and how
 * it works and its questions are on the page, word for word what its
 * structured data says (src/lib/seo/reservations.ts). While it does not, the
 * page asks to be left out of search results.
 */
const ReservePage = () => {
  const locale = useLanguageStore((s) => s.locale);
  const rtl = locale === 'ar';
  const navigate = useNavigate();
  // Not named t: src/lib/i18n.test.ts reads every t('…') in the app as a key of the menu's own dictionary.
  const rc = (key: Parameters<typeof rcopy>[0], vars?: Record<string, string | number>) => rcopy(key, locale, vars);

  const [options, setOptions] = useState<ReservationOptions | null>(null);
  const [existing, setExisting] = useState<ReservationKey | null>(null);
  const [step, setStep] = useState<Step>(0);
  // Which way the last step change went, for the way the next screen slides in.
  const [forward, setForward] = useState(true);
  const [day, setDay] = useState('');
  const [dayPage, setDayPage] = useState(0);
  const [partWanted, setPartWanted] = useState<DayPart | null>(null);
  const [time, setTime] = useState('');
  const [party, setParty] = useState(0);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [note, setNote] = useState('');
  const [noteOpen, setNoteOpen] = useState(false);
  const [trap, setTrap] = useState('');
  const [sending, setSending] = useState(false);
  const [refusal, setRefusal] = useState<Refusal | null>(null);

  const headingRef = useRef<HTMLHeadingElement>(null);
  const cardRef = useRef<HTMLFormElement>(null);
  const advanceTimer = useRef<number>();
  const moved = useRef(false);
  const swipeFrom = useRef<number | null>(null);

  // Until the database has answered the page says nothing either way about
  // search results: what the build wrote stands.
  const open = options?.enabled === true;
  const closed = options !== null && !open;
  // No structured data of its own: the page the build wrote carries it.
  usePageMeta({ ...reserveMeta(VENUE, locale), path: RESERVE_PATH, locale }, !closed);
  useNoIndex(closed);
  useEffect(() => {
    if (closed) document.title = `${rcopy('title', locale)} · ${VENUE.name}`;
  }, [closed, locale]);
  // Built while reservations were off, the page's own HTML says "noindex"; open now, it no longer does.
  useEffect(() => {
    if (open) document.head.querySelector('meta[name="robots"]')?.setAttribute('content', 'index, follow, max-image-preview:large');
  }, [open]);

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
    return () => { cancelled = true; window.clearTimeout(advanceTimer.current); };
  }, []);

  const days = useMemo(() => (options?.enabled ? reservationDays(options) : []), [options]);
  const times = useMemo(() => (options?.enabled && day ? reservationTimes(options, day) : []), [options, day]);
  const pages = Math.max(1, Math.ceil(days.length / DAYS_PER_PAGE));
  const shownDays = days.slice(dayPage * DAYS_PER_PAGE, (dayPage + 1) * DAYS_PER_PAGE);

  // The first day that still has a time, with the strip open on it.
  useEffect(() => {
    if (!options?.enabled || day) return;
    const first = days.find((d) => reservationTimes(options, d).length > 0) ?? days[0] ?? '';
    setDay(first);
    setDayPage(Math.max(0, Math.floor(days.indexOf(first) / DAYS_PER_PAGE)));
  }, [options, days, day]);
  // The same time on another day, where that day has it; otherwise none yet.
  useEffect(() => {
    if (time && !times.includes(time)) setTime('');
  }, [times, time]);

  // The parts of this day that still have times, and the one shown: the
  // chosen time's, the one asked for, or the evening, where dinner is.
  const partsOffered = DAY_PARTS.filter((p) => times.some((x) => partOfDay(x) === p));
  const part: DayPart | undefined = time ? partOfDay(time)
    : partWanted && partsOffered.includes(partWanted) ? partWanted
    : partsOffered.includes('evening') ? 'evening' : partsOffered[0];

  const phoneShown = options?.phone ?? (VENUE.phone || null);
  const phoneHref = (phoneShown ?? '').replace(/[^\d+]/g, '');

  /*
   * A phone number inside an Arabic sentence: kept in its own left-to-right
   * run, or its groups are laid out last-first ("779 877 33 387+").
   */
  const ltr = (text: string) => (rtl ? `⁦${text}⁩` : text);
  const dayLabel = (d: string) => {
    const i = days.indexOf(d);
    const named = formatReservationDay(d, locale);
    return i === 0 ? `${rc('today')} · ${named}` : i === 1 ? `${rc('tomorrow')} · ${named}` : named;
  };

  const goTo = (next: Step) => {
    window.clearTimeout(advanceTimer.current);
    setForward(next > step);
    moved.current = true;
    setStep(next);
  };
  /** A tap that finishes a step: shown chosen for a moment, then on to the next. */
  const chooseThenGo = (next: Step) => {
    window.clearTimeout(advanceTimer.current);
    advanceTimer.current = window.setTimeout(() => goTo(next), ADVANCE_MS);
  };

  // A new step: its title is read out and the card is in view (not on first load).
  useEffect(() => {
    if (!moved.current) return;
    headingRef.current?.focus({ preventScroll: true });
    const top = cardRef.current?.getBoundingClientRect().top ?? 0;
    if (top < 72) cardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [step]);

  const pageDays = (by: number) => setDayPage((p) => Math.min(pages - 1, Math.max(0, p + by)));
  const onSwipeEnd = (x: number) => {
    if (swipeFrom.current === null) return;
    const dx = x - swipeFrom.current;
    swipeFrom.current = null;
    if (Math.abs(dx) < 40) return;
    // A swipe towards the start of the line shows later days: leftwards here, rightwards in Arabic.
    pageDays((dx < 0) !== rtl ? 1 : -1);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (sending || !options?.enabled) return;
    if (!day || !time) { goTo(0); return; }
    if (!party) { goTo(1); return; }
    if (name.trim().length < 2) { setRefusal('name'); return; }
    if (!looksLikePhone(phone)) { setRefusal('phone'); return; }
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

  /** What has been chosen so far, each part a tap back to where it was chosen. */
  const trail = (
    <p data-testid="reserve-summary" className="text-sm font-sans text-muted-foreground">
      <span className="sr-only">{rc('summary')}: </span>
      <button type="button" onClick={() => goTo(0)} className="font-medium text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground">
        {formatReservationDay(day, locale)}
      </button>
      {' · '}
      <button type="button" onClick={() => goTo(0)} dir="ltr" className="font-medium text-foreground tabular-nums underline decoration-border underline-offset-4 hover:decoration-foreground">
        {time}
      </button>
      {step === 2 && party > 0 && (
        <>
          {' · '}
          <button type="button" onClick={() => goTo(1)} className="font-medium text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground">
            {rc('for_guests', { count: party })}
          </button>
        </>
      )}
    </p>
  );

  const next = (to: Step) => (
    <Button type="button" onClick={() => goTo(to)} className="w-full h-12 rounded-xl font-sans font-semibold text-base">
      {rc('step_next')}
    </Button>
  );

  const slide = forward !== rtl ? 'slide-in-from-right-6' : 'slide-in-from-left-6';
  const Prev = rtl ? ChevronRight : ChevronLeft;
  const Next = rtl ? ChevronLeft : ChevronRight;
  const stripMonths = shownDays.length
    ? [...new Set([shownDays[0], shownDays[shownDays.length - 1]].map((d) => monthName(d, locale)))].join(' – ')
    : '';

  return (
    <div className="min-h-screen bg-background pb-16" dir={rtl ? 'rtl' : 'ltr'}>
      <div className="sticky top-0 z-30 glass">
        <div className="flex items-center gap-3 px-4 py-3.5 max-w-xl mx-auto">
          <Link to={sitePath(locale)} aria-label={rc('back', { venue: VENUE.name })} className="p-2.5 -ms-2 rounded-full hover:bg-muted transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center">
            <ArrowLeft className={`w-5 h-5 text-foreground ${rtl ? 'rotate-180' : ''}`} />
          </Link>
          <h1 className="font-serif text-xl font-semibold text-foreground truncate">{rc('title')}</h1>
          <span className="ms-auto text-sm font-sans text-muted-foreground truncate">{VENUE.name}</span>
        </div>
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
            <Skeleton className="h-16 w-full" />
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
            <div className="px-1 space-y-1.5">
              <p className="text-sm text-muted-foreground font-sans leading-relaxed">{rc('intro')}</p>
              {/* The restaurant's rules, in one quiet line. */}
              <ul className="flex flex-wrap gap-x-2 text-xs font-sans text-muted-foreground" aria-label={VENUE.name}>
                <li>{rc('fact_hours', { open: ltr(options.open), close: ltr(options.close) })}</li>
                <li aria-hidden>·</li>
                <li>{rc('fact_party', { count: options.maxParty })}</li>
                <li aria-hidden>·</li>
                <li>{rc('fact_free')}</li>
              </ul>
              {/* The restaurant's own line, in whatever language it was written. */}
              {options.note && <p dir="auto" className="text-sm font-sans text-foreground leading-relaxed pt-1">{options.note}</p>}
            </div>

            <form ref={cardRef} onSubmit={submit} noValidate className="card-lux p-5 scroll-mt-20" aria-labelledby="reserve-step-title">
              {/* Where the guest is: back, three bars, and the step's own question. */}
              <div className="flex items-center gap-3 min-h-[40px]">
                {step > 0 && (
                  <button type="button" onClick={() => goTo((step - 1) as Step)}
                    className="-ms-2 inline-flex items-center gap-0.5 min-h-[40px] pe-2 ps-1 rounded-lg text-sm font-sans font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <Prev className="w-4 h-4" aria-hidden />{rc('step_back')}
                  </button>
                )}
                <div className="flex-1 flex gap-1.5" aria-hidden>
                  {STEPS.map((s, i) => (
                    <span key={s} className={`h-1 flex-1 rounded-full transition-colors duration-300 ${i <= step ? 'bg-primary' : 'bg-muted'}`} />
                  ))}
                </div>
                <span className="text-xs font-sans text-muted-foreground tabular-nums">{rc('step_of', { n: step + 1, total: STEPS.length })}</span>
              </div>

              <div key={step} className={`pt-3 animate-in fade-in-0 ${slide} duration-300 motion-reduce:animate-none`}>
                <h2 id="reserve-step-title" ref={headingRef} tabIndex={-1} className="font-serif text-[1.35rem] leading-snug font-semibold text-foreground outline-none">
                  {rc(step === 0 ? 'step_when' : step === 1 ? 'step_party' : 'step_details')}
                </h2>

                {step === 0 && (
                  <div className="mt-4 space-y-5">
                    {/* Five days at a time; the arrows, or a swipe, show the next five. */}
                    <div>
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-sans text-sm font-medium text-foreground capitalize">{stripMonths}</p>
                        <div className="flex gap-1">
                          <button type="button" aria-label={rc('days_earlier')} onClick={() => pageDays(-1)} disabled={dayPage === 0}
                            className="w-10 h-10 rounded-full flex items-center justify-center text-foreground hover:bg-muted disabled:opacity-30 disabled:hover:bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                            <Prev className="w-5 h-5" aria-hidden />
                          </button>
                          <button type="button" aria-label={rc('days_later')} onClick={() => pageDays(1)} disabled={dayPage >= pages - 1}
                            className="w-10 h-10 rounded-full flex items-center justify-center text-foreground hover:bg-muted disabled:opacity-30 disabled:hover:bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                            <Next className="w-5 h-5" aria-hidden />
                          </button>
                        </div>
                      </div>
                      <div role="radiogroup" aria-label={rc('day')} className="mt-2 grid grid-cols-5 gap-2 touch-pan-y"
                        onTouchStart={(e) => { swipeFrom.current = e.touches[0].clientX; }}
                        onTouchEnd={(e) => onSwipeEnd(e.changedTouches[0].clientX)}>
                        {shownDays.map((d) => {
                          const i = days.indexOf(d);
                          const parts = reservationDayParts(d, locale);
                          const none = reservationTimes(options, d).length === 0;
                          return (
                            <button key={d} type="button" role="radio" aria-checked={day === d} aria-label={dayLabel(d)} data-value={d}
                              onClick={() => { setDay(d); setRefusal(null); }}
                              className={`${choice(day === d)} rounded-xl h-[68px] flex flex-col items-center justify-center gap-1 leading-none ${none && day !== d ? 'opacity-40' : ''}`}>
                              {/* "Today" where it fits; every other day by its weekday (the full name is its label). */}
                              <span className="text-[11px] font-medium opacity-80 truncate max-w-full px-1">
                                {i === 0 ? rc('today') : parts.weekday}
                              </span>
                              <span className="font-serif text-xl font-semibold tabular-nums" dir="ltr">{parts.number}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div>
                      <p id="reserve-time-label" className="font-sans text-sm font-medium text-foreground">{rc('time')}</p>
                      {times.length === 0 ? (
                        <p role="status" className="mt-2 text-sm font-sans text-destructive">{rc('no_times')}</p>
                      ) : (
                        <>
                          {partsOffered.length > 1 && (
                            <div className="mt-2 grid gap-1 rounded-xl bg-muted p-1" style={{ gridTemplateColumns: `repeat(${partsOffered.length}, minmax(0, 1fr))` }}>
                              {partsOffered.map((p) => (
                                <button key={p} type="button" aria-pressed={part === p} data-part={p}
                                  onClick={() => { setPartWanted(p); if (time && partOfDay(time) !== p) setTime(''); }}
                                  className={`min-h-[40px] rounded-lg text-sm font-sans font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                                    part === p ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
                                  {rc(`part_${p}`)}
                                </button>
                              ))}
                            </div>
                          )}
                          <div role="radiogroup" aria-labelledby="reserve-time-label" className="mt-2 grid grid-cols-4 gap-2" dir="ltr">
                            {times.filter((x) => partOfDay(x) === part).map((x) => (
                              <button key={x} type="button" role="radio" aria-checked={time === x} data-value={x}
                                onClick={() => { setTime(x); setRefusal(null); chooseThenGo(1); }}
                                className={`${choice(time === x)} rounded-xl min-h-[44px] text-sm font-semibold tabular-nums`}>
                                {x}
                              </button>
                            ))}
                          </div>
                          {!time && <p className="mt-2 text-xs font-sans text-muted-foreground">{rc('pick_time')}</p>}
                        </>
                      )}
                    </div>

                    {time && next(1)}
                  </div>
                )}

                {step === 1 && (
                  <div className="mt-1.5 space-y-5">
                    {trail}
                    <div role="radiogroup" aria-label={rc('guests')} className="grid grid-cols-5 gap-2.5" dir="ltr">
                      {Array.from({ length: options.maxParty }, (_, i) => i + 1).map((n) => (
                        <button key={n} type="button" role="radio" aria-checked={party === n} data-value={n}
                          onClick={() => { setParty(n); setRefusal(null); chooseThenGo(2); }}
                          className={`${choice(party === n)} rounded-full aspect-square text-lg font-semibold tabular-nums`}>
                          {n}
                        </button>
                      ))}
                    </div>
                    {phoneShown && (
                      <a href={`tel:${phoneHref}`} className="inline-block text-sm font-sans text-muted-foreground underline underline-offset-4 decoration-border hover:text-foreground">
                        {rc('more_guests', { count: options.maxParty })}
                      </a>
                    )}
                    {party > 0 && next(2)}
                  </div>
                )}

                {step === 2 && (
                  <div className="mt-1.5 space-y-4">
                    {trail}
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
                      {/* Said before the request is sent: that is what the guest agrees to. */}
                      {options.whatsapp && <p data-testid="whatsapp-notice" className="text-xs text-foreground font-sans mt-1">{rc('whatsapp_notice')}</p>}
                    </div>

                    {noteOpen || note ? (
                      <div>
                        <Label htmlFor="reserve-note" className="font-sans text-sm">{rc('note')}</Label>
                        <Textarea id="reserve-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} rows={2} autoFocus={noteOpen && !note}
                          placeholder={rc('note_placeholder')} className="mt-1.5 text-base" />
                      </div>
                    ) : (
                      <button type="button" onClick={() => setNoteOpen(true)}
                        className="inline-flex items-center gap-1.5 min-h-[40px] text-sm font-sans font-medium text-primary hover:underline underline-offset-4">
                        <Plus className="w-4 h-4" aria-hidden />{rc('add_note')}
                      </button>
                    )}

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

                    <Button type="submit" disabled={sending} className="w-full h-12 rounded-xl font-sans font-semibold text-base gap-2">
                      {sending ? <><Loader2 className="w-4 h-4 animate-spin" /> {rc('sending')}</> : rc('send')}
                    </Button>
                    <p className="text-xs text-muted-foreground font-sans text-center">{rc('privacy')}</p>
                  </div>
                )}
              </div>
            </form>

            {callLink && <div className="flex justify-center pt-1">{callLink}</div>}

            {/* What happens next and what guests ask, on the page for people and, word for word,
                in its structured data for search and answer engines (src/lib/seo/reservations.ts). */}
            <section aria-labelledby="reserve-how" className="px-1 pt-6 space-y-3">
              <h2 id="reserve-how" className="font-serif text-lg font-semibold text-foreground">{rc('how_title')}</h2>
              <ol className="space-y-2.5">
                {reserveSteps(locale).map((s, i) => (
                  <li key={s} className="flex gap-3 text-sm font-sans text-muted-foreground leading-relaxed">
                    <span aria-hidden className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-foreground tabular-nums">{i + 1}</span>
                    <span>{s}</span>
                  </li>
                ))}
              </ol>
            </section>

            <section aria-labelledby="reserve-faq" className="px-1 pt-4">
              <h2 id="reserve-faq" className="font-serif text-lg font-semibold text-foreground">{rc('faq_title')}</h2>
              <div className="mt-1 divide-y divide-border border-b border-border">
                {reserveFaq(locale).map(({ q, a }) => (
                  <details key={q} className="group">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-3 text-start text-sm font-sans font-medium text-foreground min-h-[48px] [&::-webkit-details-marker]:hidden">
                      {q}
                      <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden />
                    </summary>
                    <p className="pb-3 text-sm font-sans text-muted-foreground leading-relaxed">{a}</p>
                  </details>
                ))}
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
};

export default ReservePage;
