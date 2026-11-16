import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRight, CalendarX, Check, ChevronDown, Clock, Info, Loader2, MapPin, Phone, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { ReserveCard, ReserveFrame, ReserveRise, ReserveSplit, RESERVE_PILL } from '@/components/reserve/ReserveShell';
import { cn } from '@/lib/utils';
import { springPill } from '@/lib/motion';
import { useLanguageStore } from '@/lib/i18n';
import { HOME_VENUE } from '@/lib/home-venue';
import { VENUES, menuPath } from '@/lib/venues';
import { useNoIndex } from '@/lib/seo/noindex';
import { usePageMeta } from '@/lib/seo/page-meta';
import { RESERVE_PATH, reserveFaq, reserveMeta, reserveSteps } from '@/lib/seo/reservations';
import { rcopy, refusalCopy } from '@/lib/reservation-copy';
import {
  DAY_PARTS, formatReservationDay, looksLikePhone, partOfDay, readReservation, readReservationOptions, recallReservation,
  rememberReservation, requestReservation, reservationDayParts, reservationDays, reservationPath, reservationTimes,
  ReservationRefused, usualTime,
  type Refusal, type ReservationKey, type ReservationOptions,
} from '@/lib/reservations';

const VENUE = VENUES[HOME_VENUE];

/** Dinner time, when the day still has it: the time most tables are asked for. */
const USUAL_TIME = '19:00';

/*
 * A choice among a few: a day, a time, how many. Filled when it is the one
 * chosen. Its corners are the restaurant's (--radius): soft at La Soul,
 * nearly square at Vera Italia.
 */
const CHIP = 'border font-sans transition-[background-color,border-color,color,box-shadow,transform] duration-200 rounded-[calc(var(--radius)+2px)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card active:scale-[0.97] motion-reduce:active:scale-100';
const chip = (chosen: boolean) => cn(CHIP, chosen
  ? 'border-primary bg-primary text-primary-foreground shadow-[0_10px_22px_-12px_hsl(var(--primary)/0.9)]'
  : 'border-border bg-background text-foreground hover:border-primary/50 hover:bg-card');
/** The small capitals over each part of the form. */
const LABEL = 'text-[11px] font-sans font-semibold uppercase tracking-[0.18em] text-muted-foreground rtl:tracking-normal';
const FIELD = 'mt-2 h-12 rounded-[calc(var(--radius)+2px)] bg-background text-base';

/**
 * How many numbers to a row, so the last row is never one orphan: ten is two
 * rows of five on a phone and one row on a wide screen, twelve is two sixes.
 */
function partyColumns(max: number): React.CSSProperties {
  const narrow = max <= 6 ? max : max % 5 === 0 ? 5 : max % 6 === 0 ? 6 : max % 4 === 0 ? 4 : 5;
  const wide = max <= 10 ? max : max % 2 === 0 && max <= 20 ? max / 2 : 10;
  return { '--party-cols': narrow, '--party-cols-wide': wide } as React.CSSProperties;
}

/** One of the three choices: its name, what is chosen now, and the choices. */
const Choice = ({ labelId, label, value, children }: { labelId: string; label: string; value?: React.ReactNode; children: React.ReactNode }) => (
  <div>
    <div className="flex items-baseline justify-between gap-4">
      <p id={labelId} className={LABEL}>{label}</p>
      {value && <p aria-hidden className="truncate font-serif text-[15px] font-semibold text-foreground">{value}</p>}
    </div>
    {children}
  </div>
);

/**
 * "Reserve a table" on the restaurant's own website (/reserve/).
 *
 * The guest picks a day, a time and how many, and leaves a name and a phone
 * number. That is a request: the restaurant's admin answers it, and the
 * guest's own page (/reservation/<id>) shows the answer. Days and times are
 * the restaurant's (its date, its clock, its notice), read from the database,
 * so a phone in another time zone is offered what the restaurant still has.
 *
 * The page looks like the restaurant's website, not like a form: its
 * photograph, its name, its colours (src/components/reserve/ReserveShell.tsx).
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
  const navigate = useNavigate();
  // Not named t: src/lib/i18n.test.ts reads every rc('…') in the app as a key of the menu's own dictionary.
  const rc = (key: Parameters<typeof rcopy>[0], vars?: Record<string, string | number>) => rcopy(key, locale, vars);

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

  // The part of the day the chosen time is in, and the parts this day still has.
  const part = partOfDay(time || USUAL_TIME);
  const partsOffered = DAY_PARTS.filter((p) => times.some((x) => partOfDay(x) === p));

  const phoneShown = options?.phone ?? (VENUE.phone || null);
  const phoneHref = (phoneShown ?? '').replace(/[^\d+]/g, '');

  /*
   * A phone number inside an Arabic sentence: kept in its own left-to-right
   * run, or its groups are laid out last-first ("779 877 33 387+").
   */
  const ltr = (text: string) => (locale === 'ar' ? `⁦${text}⁩` : text);
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
    <a href={`tel:${phoneHref}`} className={cn('inline-flex min-h-[48px] items-center justify-center gap-2 border border-border bg-card px-5 font-sans text-[15px] font-semibold text-foreground transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background', RESERVE_PILL)}>
      <Phone className="h-4 w-4 text-primary" aria-hidden />
      <span>{rc('call', { phone: ltr(phoneShown) })}</span>
    </a>
  ) : null;

  /* What the restaurant takes, under the title: its hours for tables, the largest party, that it costs nothing; and where it is. */
  const facts = open && options ? (
    <div className="space-y-4">
      <ul className="flex flex-wrap gap-x-5 gap-y-2 font-sans text-[13.5px] font-medium text-foreground" aria-label={VENUE.name}>
        <li className="inline-flex items-center gap-2"><Clock className="h-4 w-4 text-primary" aria-hidden />{rc('fact_hours', { open: ltr(options.open), close: ltr(options.close) })}</li>
        <li className="inline-flex items-center gap-2"><Users className="h-4 w-4 text-primary" aria-hidden />{rc('fact_party', { count: options.maxParty })}</li>
        <li className="inline-flex items-center gap-2"><Check className="h-4 w-4 text-primary" aria-hidden />{rc('fact_free')}</li>
      </ul>
      {VENUE.address && (
        <p className="hidden items-center gap-2 font-sans text-[13.5px] text-muted-foreground lg:flex">
          <MapPin className="h-4 w-4 shrink-0 text-primary" aria-hidden />
          {VENUE.mapsUrl
            ? <a href={VENUE.mapsUrl} target="_blank" rel="noreferrer" className="underline-offset-4 hover:text-foreground hover:underline focus-visible:underline focus-visible:outline-none">{VENUE.address}, {VENUE.city}</a>
            : <span>{VENUE.address}, {VENUE.city}</span>}
        </p>
      )}
    </div>
  ) : null;

  const intro = !options
    ? <span className="block space-y-2" aria-hidden><Skeleton className="h-4 w-full max-w-[26rem]" /><Skeleton className="h-4 w-2/3 max-w-[18rem]" /></span>
    : open ? <p>{rc('intro')}</p> : null;

  return (
    <ReserveFrame venue={VENUE} locale={locale}>
      <ReserveSplit venue={VENUE} locale={locale} title={rc('title')} intro={intro} facts={facts}>
        <div className="space-y-5">
          {existing && (
            <Link to={reservationPath(existing)} className="flex items-center justify-between gap-3 rounded-[calc(var(--radius)+4px)] border border-primary/30 bg-primary/[0.06] px-5 py-3.5 font-sans text-sm font-semibold text-foreground transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <span className="underline underline-offset-4">{rc('existing')}</span>
              <ArrowRight className="h-4 w-4 shrink-0 text-primary rtl:-scale-x-100" aria-hidden />
            </Link>
          )}

          {!options ? (
            <ReserveCard className="space-y-7 p-5 sm:p-8" aria-busy="true">
              <div className="space-y-3">
                <Skeleton className="h-3 w-16" />
                <div className="flex gap-2 overflow-hidden">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-[88px] w-[72px] shrink-0 rounded-[calc(var(--radius)+2px)]" />)}</div>
              </div>
              <div className="space-y-3">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-12 w-full rounded-[calc(var(--radius)+2px)]" />
                <div className="grid grid-cols-4 gap-2">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-12 rounded-[calc(var(--radius)+2px)]" />)}</div>
              </div>
              <Skeleton className="h-14 w-full rounded-full" />
            </ReserveCard>
          ) : !options.enabled ? (
            <ReserveRise>
              <ReserveCard className="p-7 text-center sm:p-10">
                <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-primary/10 text-primary ring-8 ring-primary/5" aria-hidden>
                  <CalendarX className="h-6 w-6" />
                </span>
                <h2 className="mt-6 font-serif text-2xl font-semibold leading-tight text-foreground text-balance">{rc('closed_title')}</h2>
                <p className="mx-auto mt-2 max-w-sm font-sans text-[15px] leading-relaxed text-muted-foreground">{rc(phoneShown ? 'closed_body' : 'closed_body_no_phone')}</p>
                <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
                  {callLink}
                  <Link to={menuPath(VENUE.slug)} className={cn('group inline-flex min-h-[48px] items-center justify-center gap-2 bg-primary px-6 font-sans text-[15px] font-semibold text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card', RESERVE_PILL)}>
                    {rc('see_menu')}
                    <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-0.5 rtl:-scale-x-100 rtl:group-hover:-translate-x-0.5" aria-hidden />
                  </Link>
                </div>
              </ReserveCard>
            </ReserveRise>
          ) : (
            <>
              <ReserveRise delay={0.06}>
                <form onSubmit={submit} noValidate>
                  <ReserveCard className="overflow-hidden">
                    <div className="space-y-7 p-5 sm:p-8">
                      {/* The restaurant's own line, in whatever language it was written. */}
                      {options.note && (
                        <p dir="auto" className="flex gap-3 rounded-[calc(var(--radius)+2px)] bg-secondary/70 px-4 py-3 font-sans text-sm leading-relaxed text-foreground">
                          <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
                          <span>{options.note}</span>
                        </p>
                      )}

                      {/* A day, a time and how many: each a tap. The groups read to a screen reader as the choices they are. */}
                      <Choice labelId="reserve-day-label" label={rc('day')} value={day ? formatReservationDay(day, locale) : undefined}>
                        <div role="radiogroup" aria-labelledby="reserve-day-label"
                          className="-mx-5 mt-3 flex snap-x scroll-px-5 gap-2 overflow-x-auto px-5 pb-3 pt-0.5 [mask-image:linear-gradient(to_right,transparent,black_16px,black_calc(100%-32px),transparent)] [scrollbar-width:none] sm:-mx-8 sm:scroll-px-8 sm:px-8 sm:[mask-image:linear-gradient(to_right,transparent,black_28px,black_calc(100%-40px),transparent)] [&::-webkit-scrollbar]:hidden">
                          {days.map((d, i) => {
                            const parts = reservationDayParts(d, locale);
                            const none = reservationTimes(options, d).length === 0;
                            return (
                              <button key={d} type="button" role="radio" aria-checked={day === d} aria-label={dayLabel(d, i)} data-value={d}
                                onClick={() => setDay(d)}
                                className={cn(chip(day === d), 'flex h-[88px] w-[72px] shrink-0 snap-start flex-col items-center justify-center gap-1 leading-none', none && day !== d && 'opacity-45')}>
                                <span className="max-w-full truncate px-0.5 text-[10px] font-semibold uppercase tracking-[0.04em] opacity-75 rtl:text-[11px] rtl:tracking-normal">{i === 0 ? rc('today') : i === 1 ? rc('tomorrow') : parts.weekday}</span>
                                <span className="font-serif text-[23px] font-semibold" dir="ltr">{parts.number}</span>
                                <span className="text-[11px] opacity-75">{parts.month}</span>
                              </button>
                            );
                          })}
                        </div>
                      </Choice>

                      <Choice labelId="reserve-time-label" label={rc('time')} value={time ? <span dir="ltr">{time}</span> : undefined}>
                        {times.length === 0 ? (
                          <p role="status" className="mt-3 rounded-[calc(var(--radius)+2px)] bg-destructive/10 px-4 py-3 font-sans text-sm text-destructive">{rc('no_times')}</p>
                        ) : (
                          <>
                            {partsOffered.length > 1 && (
                              <div className="mt-3 grid gap-1 rounded-[calc(var(--radius)+4px)] bg-muted p-1" style={{ gridTemplateColumns: `repeat(${partsOffered.length}, minmax(0, 1fr))` }}>
                                {partsOffered.map((p) => (
                                  <button key={p} type="button" aria-pressed={part === p} data-part={p} onClick={() => setTime(usualTime(times, p))}
                                    className={cn('relative min-h-[42px] rounded-[var(--radius)] font-sans text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                                      part === p ? 'text-foreground' : 'text-muted-foreground hover:text-foreground')}>
                                    {part === p && <motion.span layoutId="reserve-part" transition={springPill} aria-hidden className="absolute inset-0 rounded-[var(--radius)] bg-card shadow-sm" />}
                                    <span className="relative">{rc(`part_${p}`)}</span>
                                  </button>
                                ))}
                              </div>
                            )}
                            <div role="radiogroup" aria-labelledby="reserve-time-label" className="mt-2.5 grid grid-cols-4 gap-2 sm:grid-cols-5" dir="ltr">
                              {times.filter((x) => partOfDay(x) === part).map((x) => (
                                <button key={x} type="button" role="radio" aria-checked={time === x} data-value={x} onClick={() => setTime(x)}
                                  className={cn(chip(time === x), 'min-h-[48px] text-[15px] font-semibold tabular-nums')}>
                                  {x}
                                </button>
                              ))}
                            </div>
                          </>
                        )}
                      </Choice>

                      <Choice labelId="reserve-party-label" label={rc('guests')} value={<span dir="ltr">{party}</span>}>
                        <div role="radiogroup" aria-labelledby="reserve-party-label" dir="ltr" style={partyColumns(options.maxParty)}
                          className="mt-3 grid grid-cols-[repeat(var(--party-cols),minmax(0,1fr))] gap-2 sm:grid-cols-[repeat(var(--party-cols-wide),minmax(0,1fr))]">
                          {Array.from({ length: options.maxParty }, (_, i) => i + 1).map((n) => (
                            <button key={n} type="button" role="radio" aria-checked={party === n} data-value={n} onClick={() => setParty(n)}
                              className={cn(chip(party === n), 'min-h-[48px] text-[15px] font-semibold tabular-nums')}>
                              {n}
                            </button>
                          ))}
                        </div>
                      </Choice>
                    </div>

                    <div className="space-y-5 border-t border-border/70 bg-secondary/35 p-5 sm:p-8">
                      <p className={LABEL}>{rc('details')}</p>
                      <div className="grid gap-5 sm:grid-cols-2">
                        <div>
                          <Label htmlFor="reserve-name" className="font-sans text-sm font-medium">{rc('name')}</Label>
                          <Input id="reserve-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={80}
                            aria-invalid={refusal === 'name'} className={FIELD} />
                        </div>
                        <div>
                          <Label htmlFor="reserve-phone" className="font-sans text-sm font-medium">{rc('phone')}</Label>
                          <Input id="reserve-phone" type="tel" inputMode="tel" dir="ltr" value={phone} onChange={(e) => setPhone(e.target.value)}
                            autoComplete="tel" maxLength={30} aria-invalid={refusal === 'phone'} aria-describedby="reserve-phone-hint" className={FIELD} />
                        </div>
                      </div>
                      <div className="!mt-2 space-y-1">
                        <p id="reserve-phone-hint" className="font-sans text-xs leading-relaxed text-muted-foreground">{rc('phone_hint')}</p>
                        {/* Said before the request is sent: that is what the guest agrees to. */}
                        {options.whatsapp && <p data-testid="whatsapp-notice" className="font-sans text-xs leading-relaxed text-foreground">{rc('whatsapp_notice')}</p>}
                      </div>

                      <div>
                        <Label htmlFor="reserve-note" className="font-sans text-sm font-medium">{rc('note')}</Label>
                        <Textarea id="reserve-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} rows={2}
                          placeholder={rc('note_placeholder')} className="mt-2 rounded-[calc(var(--radius)+2px)] bg-background text-base" />
                      </div>

                      {/* For robots only: a person never sees or reaches this field. Clipped in place, not
                          parked off-screen: far to the left is somewhere an Arabic page can scroll to. */}
                      <div aria-hidden="true" className="sr-only">
                        <label htmlFor="reserve-website">Website</label>
                        <input id="reserve-website" name="website" type="text" tabIndex={-1} autoComplete="off" value={trap} onChange={(e) => setTrap(e.target.value)} />
                      </div>

                      {refusal && (
                        <div role="alert" className="space-y-2 rounded-[calc(var(--radius)+2px)] bg-destructive/10 px-4 py-3 font-sans text-sm text-destructive">
                          <p>{refusalCopy(refusal, locale)}</p>
                          {phoneShown && ['party', 'soon', 'repeat', 'busy', 'disabled'].includes(refusal) && (
                            <a href={`tel:${phoneHref}`} className="inline-block font-semibold underline underline-offset-4">{rc('call', { phone: ltr(phoneShown) })}</a>
                          )}
                        </div>
                      )}

                      {/* What is being asked for, in one line, before it is sent. */}
                      {day && time && (
                        <div data-testid="reserve-summary" className="rounded-[calc(var(--radius)+4px)] border border-primary/15 bg-card px-5 py-4">
                          <p className={LABEL}>{rc('summary')}</p>
                          <p className="mt-1.5 font-serif text-[1.3rem] font-semibold leading-snug text-foreground">
                            {formatReservationDay(day, locale)} · <span dir="ltr">{time}</span> · {rc('for_guests', { count: party })}
                          </p>
                        </div>
                      )}

                      <Button type="submit" disabled={sending || times.length === 0}
                        className={cn('group h-14 w-full gap-2.5 font-sans text-base font-semibold shadow-[0_16px_32px_-16px_hsl(var(--primary)/0.85)]', RESERVE_PILL)}>
                        {sending
                          ? <><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> {rc('sending')}</>
                          : <>{rc('send')}<ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-0.5 rtl:-scale-x-100 rtl:group-hover:-translate-x-0.5" aria-hidden /></>}
                      </Button>
                      <p className="text-center font-sans text-xs text-muted-foreground">{rc('privacy')}</p>
                    </div>
                  </ReserveCard>
                </form>
              </ReserveRise>

              {callLink && <div className="flex justify-center pt-1">{callLink}</div>}

              {/* What happens next and what guests ask, on the page for people and, word for word,
                  in its structured data for search and answer engines (src/lib/seo/reservations.ts). */}
              <section aria-labelledby="reserve-how" className="pt-8">
                <h2 id="reserve-how" className="font-serif text-[1.6rem] font-medium leading-tight text-foreground rtl:font-semibold">{rc('how_title')}</h2>
                <ol className="mt-5 space-y-4">
                  {reserveSteps(locale).map((step, i) => (
                    <li key={step} className="flex gap-4 font-sans text-[15px] leading-relaxed text-muted-foreground">
                      <span aria-hidden className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-primary/25 font-serif text-[15px] font-semibold text-primary" dir="ltr">{i + 1}</span>
                      <span className="pt-1">{step}</span>
                    </li>
                  ))}
                </ol>
              </section>

              <section aria-labelledby="reserve-faq" className="pt-8">
                <h2 id="reserve-faq" className="font-serif text-[1.6rem] font-medium leading-tight text-foreground rtl:font-semibold">{rc('faq_title')}</h2>
                <div className="mt-3 divide-y divide-border border-y border-border">
                  {reserveFaq(locale).map(({ q, a }) => (
                    <details key={q} className="group">
                      <summary className="flex min-h-[56px] cursor-pointer list-none items-center justify-between gap-4 py-4 text-start font-sans text-[15px] font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                        {q}
                        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-300 group-open:rotate-180" aria-hidden />
                      </summary>
                      <p className="pb-5 pe-8 font-sans text-[15px] leading-relaxed text-muted-foreground">{a}</p>
                    </details>
                  ))}
                </div>
              </section>
            </>
          )}
        </div>
      </ReserveSplit>
    </ReserveFrame>
  );
};

export default ReservePage;
