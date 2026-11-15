/**
 * The demo's front page (demo mode only): what a restaurant owner sees first.
 *
 * It is the product's own landing page. The hero shows the real thing, live:
 * a guest's phone and the kitchen display, both frames of the app running on
 * the one in-browser restaurant — "Send an order" seats a table and the
 * ticket lands on the display beside it. Below it every screen is one tap
 * away, each opening as the person who would use it; nobody types a password
 * (src/demo/session.ts).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import {
  ArrowRight, ArrowUpRight, CalendarCheck, ChefHat, Languages, LayoutDashboard, Mail, MonitorPlay, Phone, Presentation,
  RotateCcw, Send, Smartphone, Sparkles, Tv, UserRound, Wifi,
} from 'lucide-react';
import { ACCOUNTS, CONTACT, DEMO_PATHS, PRODUCT, RESTAURANT, guestTablePath } from '../brand';
import { demoRuntime } from '../runtime';
import { simulateArrival, simulateCall } from '../seed/live';
import { clearSignedOut } from '../session';
import { DemoMonogram } from './Brand';
import { Device } from './DeviceFrames';
import './demo.css';

interface Screen {
  title: string;
  who: string;
  what: string;
  href: string;
  icon: typeof Smartphone;
  device: 'Phone' | 'Tablet' | 'Desktop' | 'TV';
  area?: keyof typeof ACCOUNTS;
}

const SCREENS: Screen[] = [
  {
    title: 'Guest', who: `Table ${RESTAURANT.guestTable}, scanning the QR code`, device: 'Phone', icon: Smartphone,
    what: 'The menu in three languages, the order, card or pay-at-table, live tracking, calling the waiter.',
    href: guestTablePath(),
  },
  {
    title: 'Kitchen display', who: 'The kitchen tablet', device: 'Tablet', icon: ChefHat, area: 'kitchen',
    what: 'Tickets arrive with a chime. Start, bump dish by dish, mark ready. Kitchen and bar each see their own.',
    href: '/kitchen',
  },
  {
    title: 'Waiter', who: 'Amra, on the terrace', device: 'Phone', icon: UserRound, area: 'waiter',
    what: 'What is ready to carry, who is calling, who wants the bill. Take payment and free the table.',
    href: '/waiter',
  },
  {
    title: 'Owner', who: 'The back office', device: 'Desktop', icon: LayoutDashboard, area: 'admin',
    what: 'Today’s sales, analytics, menu engineering, prep forecast, promotions, reservations, team.',
    href: '/admin',
  },
  {
    title: 'TV menu board', who: 'The screen at the entrance', device: 'TV', icon: Tv,
    what: 'The menu as a rotating board: featured dishes, offers and prices, always current.',
    href: '/tv',
  },
  {
    title: 'Floor monitor', who: 'The shared screen at the pass', device: 'Tablet', icon: MonitorPlay, area: 'monitor',
    what: `The whole room at a glance. A waiter taps their name and PIN (${RESTAURANT.floorPin} here) to act.`,
    href: '/waiter/monitor',
  },
  {
    title: 'Reservations', who: 'A guest booking a table', device: 'Phone', icon: CalendarCheck,
    what: 'A table asked for online; the restaurant confirms or proposes another time.',
    href: '/reserve',
  },
  {
    title: 'Side by side', who: 'For presenting', device: 'Desktop', icon: Presentation,
    what: 'A phone next to a screen, both live: order on the left, watch it land on the right.',
    href: DEMO_PATHS.stage,
  },
];

const STEPS: [string, string][] = [
  ['The guest orders', 'Open Guest, add a Casa Burger and a drink, send the order and choose to pay at the table.'],
  ['The kitchen cooks', 'The ticket is already on the Kitchen display. Start it, then mark it ready.'],
  ['The waiter serves', 'On the Waiter’s phone table 5 is ready to run. Serve it, take the payment, free the table.'],
  ['The owner sees it', 'The sale is in today’s numbers. Analytics and Menu intelligence read ten weeks of trading.'],
];

const POINTS = [
  { icon: Wifi, text: 'No app to install' },
  { icon: Languages, text: 'Bosnian · English · Arabic' },
  { icon: Sparkles, text: 'Your menu, your brand' },
];

const EASE = [0.22, 0.8, 0.3, 1] as const;
const mailto = `mailto:${CONTACT.email}?subject=${encodeURIComponent(`${PRODUCT.name} demo`)}`;

/** A number that counts up to its value the first time it is seen. */
const Count = ({ value }: { value: number }) => {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(reduced ? value : 0);
  useEffect(() => {
    if (reduced) { setShown(value); return; }
    let frame = 0;
    const started = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - started) / 1100);
      setShown(Math.round(value * (1 - (1 - t) ** 3)));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, reduced]);
  return <span className="tabular-nums">{shown.toLocaleString('en')}</span>;
};

interface Facts { orders: number; days: number; dishes: number; open: number }

/** The hero's live preview: the guest's phone over the kitchen display. */
const LivePreview = ({ onOrder, busy, note }: { onOrder: () => void; busy: boolean; note: string | null }) => {
  const reduced = useReducedMotion();
  const phone = useRef<HTMLIFrameElement | null>(null);
  const hovering = useRef(false);

  // The phone browses by itself, slowly, until someone takes over.
  useEffect(() => {
    if (reduced) return;
    let down = true;
    const timer = window.setInterval(() => {
      const view = phone.current?.contentWindow;
      const doc = phone.current?.contentDocument?.scrollingElement;
      if (!view || !doc || hovering.current) return;
      const end = doc.scrollHeight - view.innerHeight;
      if (end < 200) return;
      let next = view.scrollY + (down ? 340 : -view.scrollY);
      if (next >= Math.min(end, 1700)) { next = Math.min(end, 1700); down = false; } else if (!down) down = true;
      view.scrollTo({ top: next, behavior: 'smooth' });
    }, 3600);
    return () => window.clearInterval(timer);
  }, [reduced]);

  return (
    <div className="relative mx-auto w-full max-w-[760px] lg:max-w-none lg:w-[122%]">
      <div aria-hidden className="demo-halo absolute -inset-x-10 -top-10 bottom-0" />
      <div className="relative lg:ps-[13%]">
        <div className="relative hidden aspect-[1298/818] lg:block">
          <Device kind="screen" src="/kitchen" name="The kitchen display, live" stage="hub-screen" align="end" />
        </div>
        <div
          className="relative mx-auto h-[540px] w-[262px] lg:absolute lg:-bottom-12 lg:left-0 lg:mx-0 lg:h-[82%] lg:w-[27%]"
          onPointerEnter={() => { hovering.current = true; }}
          onPointerLeave={() => { hovering.current = false; }}
        >
          <Device kind="phone" src={`/menu/${RESTAURANT.slug}/`} name="The guest menu, live" stage="hub-phone" onFrame={(el) => { phone.current = el; }} />
        </div>
      </div>

      <div className="relative z-10 mt-6 flex flex-wrap items-center justify-center gap-3 lg:mt-5 lg:justify-start lg:ps-[32%]">
        <motion.p
          key={note ?? 'idle'}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: EASE }}
          className="flex items-center gap-2 rounded-full bg-white/[0.06] px-3.5 py-2 font-sans text-[13px] text-[#F4ECDD]/80 ring-1 ring-white/10 backdrop-blur"
          role="status"
        >
          <span className="relative flex h-2 w-2">
            <span className="demo-ping absolute inline-flex h-full w-full rounded-full bg-[#8FD19E]" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-[#8FD19E]" />
          </span>
          {note ?? 'Live: the real product, running in your browser'}
        </motion.p>
        <button
          type="button"
          onClick={onOrder}
          disabled={busy}
          className="demo-press hidden items-center gap-2 rounded-full bg-[#F4ECDD] px-4 py-2 font-sans text-[13px] font-semibold text-[#17201B] shadow-lg shadow-black/30 transition hover:bg-white disabled:opacity-60 lg:inline-flex"
        >
          <Send className="h-3.5 w-3.5" aria-hidden /> {busy ? 'Sending…' : 'Send an order to the kitchen'}
        </button>
      </div>
    </div>
  );
};

const DemoHub = () => {
  const [facts, setFacts] = useState<Facts | null>(null);
  const [resetting, setResetting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const noteTimer = useRef<number>();

  useEffect(() => {
    document.title = `${PRODUCT.name} — ${PRODUCT.byline}`;
    document.documentElement.setAttribute('dir', 'ltr');
    document.documentElement.setAttribute('lang', 'en');
    let cancelled = false;
    void demoRuntime().then(async ({ db }) => {
      const { rows } = await db.query<Facts>(
        `SELECT (SELECT count(*) FROM public.orders)::int AS orders,
                (SELECT count(DISTINCT public.business_day(created_at)) FROM public.orders)::int AS days,
                (SELECT count(*) FROM public.menu_items WHERE deleted_at IS NULL)::int AS dishes,
                (SELECT count(*) FROM public.table_sessions WHERE is_active)::int AS open`);
      if (!cancelled && rows[0]) setFacts(rows[0]);
    }).catch(() => undefined);
    return () => { cancelled = true; window.clearTimeout(noteTimer.current); };
  }, []);

  const say = (text: string) => {
    setNote(text);
    window.clearTimeout(noteTimer.current);
    noteTimer.current = window.setTimeout(() => setNote(null), 6000);
  };

  const sendOrder = useCallback(async () => {
    setBusy(true);
    try {
      const { backend } = await demoRuntime();
      const seated = await simulateArrival(backend);
      if (seated) { say(`Table ${seated.table}: ${seated.guest} just ordered — watch the display`); return; }
      const call = await simulateCall(backend);
      say(call ? `Table ${call.table} ${call.kind === 'bill' ? 'asked for the bill' : 'is calling the waiter'}` : 'The room is full. Reset the demo to start the evening again.');
    } catch {
      say('That did not go through. Try again.');
    } finally {
      setBusy(false);
    }
  }, []);

  const reset = () => {
    if (!window.confirm('Reset the demo? Every order, change and sign-in made here goes back to the starting point, in all open tabs.')) return;
    setResetting(true);
    void demoRuntime().then((runtime) => runtime.reset());
  };

  const rise = (delay = 0) => ({
    initial: { opacity: 0, y: 18 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.7, delay, ease: EASE },
  });
  const inView = (delay = 0) => ({
    initial: { opacity: 0, y: 22 },
    whileInView: { opacity: 1, y: 0 },
    viewport: { once: true, margin: '-60px' },
    transition: { duration: 0.6, delay, ease: EASE },
  });

  return (
    <div className="demo-surface min-h-screen overflow-x-hidden font-sans text-[#F4ECDD] antialiased">
      {/* ------------------------------------------------------------ top bar */}
      <header className="sticky top-0 z-40 border-b border-white/[0.06] bg-[#0C120F]/75 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-[1240px] items-center justify-between gap-4 px-5 sm:px-8">
          <a href="/" className="flex items-center gap-3" aria-label={PRODUCT.name}>
            <DemoMonogram tone="dark" className="h-8 w-8" />
            <span className="font-serif text-xl font-semibold tracking-tight">{PRODUCT.name}</span>
            <span className="hidden rounded-full bg-white/[0.07] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-[#F4ECDD]/65 ring-1 ring-white/10 sm:inline">
              {PRODUCT.byline}
            </span>
          </a>
          <nav className="flex items-center gap-1 text-sm font-medium text-[#F4ECDD]/70" aria-label="On this page">
            <a href="#screens" className="hidden rounded-full px-3 py-2 transition hover:bg-white/[0.06] hover:text-[#F4ECDD] md:inline">Screens</a>
            <a href="#walkthrough" className="hidden rounded-full px-3 py-2 transition hover:bg-white/[0.06] hover:text-[#F4ECDD] md:inline">Walkthrough</a>
            <a href="#contact" className="hidden rounded-full px-3 py-2 transition hover:bg-white/[0.06] hover:text-[#F4ECDD] md:inline">Contact</a>
            <a href="#contact" className="demo-press ms-2 inline-flex items-center gap-2 rounded-full bg-[#F4ECDD] px-4 py-2 text-sm font-semibold text-[#17201B] transition hover:bg-white">
              Book a demo <ArrowRight className="h-4 w-4" aria-hidden />
            </a>
          </nav>
        </div>
      </header>

      {/* ------------------------------------------------------------ hero */}
      <section className="relative">
        <div aria-hidden className="demo-grid pointer-events-none absolute inset-0" />
        <div className="relative mx-auto grid max-w-[1240px] items-center gap-12 px-5 pb-20 pt-14 sm:px-8 lg:grid-cols-[minmax(0,0.78fr)_minmax(0,1fr)] lg:gap-8 lg:pb-24 lg:pt-16">
          <div>
            <motion.p {...rise(0)} className="inline-flex items-center gap-2 whitespace-nowrap rounded-full bg-[#D98A5F]/[0.14] px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#EBAE8C] ring-1 ring-[#D98A5F]/25 sm:text-[11px] sm:tracking-[0.2em]">
              QR ordering · Kitchen · Floor<span className="hidden sm:inline"> · Back office</span>
            </motion.p>
            <motion.h1 {...rise(0.06)} className="mt-6 font-serif text-[2.5rem] font-semibold leading-[1.05] tracking-[-0.02em] sm:text-[3.4rem] xl:text-[3.9rem]">
              {PRODUCT.headline} <span className="block italic text-[#EBAE8C]">{PRODUCT.headlineAccent}</span>
            </motion.h1>
            <motion.p {...rise(0.12)} className="mt-6 max-w-[34rem] text-base leading-relaxed text-[#F4ECDD]/70 sm:text-lg">
              {PRODUCT.pitch}
            </motion.p>
            <motion.div {...rise(0.18)} className="mt-9 flex flex-wrap items-center gap-3">
              <a
                href={guestTablePath()} target="_blank" rel="noopener"
                className="demo-press group inline-flex h-12 items-center gap-2.5 rounded-full bg-[#F4ECDD] px-6 text-[15px] font-semibold text-[#17201B] shadow-[0_14px_40px_-12px_rgba(244,236,221,.45)] transition hover:bg-white"
              >
                <Smartphone className="h-4 w-4" aria-hidden /> Order as a guest
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
              </a>
              <a
                href={DEMO_PATHS.stage}
                className="demo-press inline-flex h-12 items-center gap-2.5 rounded-full px-6 text-[15px] font-semibold text-[#F4ECDD] ring-1 ring-white/15 transition hover:bg-white/[0.06] hover:ring-white/30"
              >
                <Presentation className="h-4 w-4" aria-hidden /> See it side by side
              </a>
            </motion.div>
            <motion.ul {...rise(0.24)} className="mt-10 flex flex-wrap gap-x-6 gap-y-3 text-sm text-[#F4ECDD]/60">
              {POINTS.map(({ icon: Icon, text }) => (
                <li key={text} className="flex items-center gap-2"><Icon className="h-4 w-4 text-[#8FB08A]" aria-hidden /> {text}</li>
              ))}
            </motion.ul>
          </div>

          <motion.div initial={{ opacity: 0, y: 28, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: 0.9, delay: 0.2, ease: EASE }}>
            <LivePreview onOrder={sendOrder} busy={busy} note={note} />
          </motion.div>
        </div>
      </section>

      {/* ------------------------------------------------------------ the restaurant, in numbers */}
      <section aria-label={`${RESTAURANT.name} in numbers`} className="border-y border-white/[0.06] bg-white/[0.02]">
        <div className="mx-auto grid max-w-[1240px] grid-cols-2 gap-y-8 px-5 py-10 sm:px-8 lg:grid-cols-[1.3fr_repeat(4,1fr)] lg:items-center">
          <div className="col-span-2 flex items-center gap-4 lg:col-span-1">
            <DemoMonogram tone="dark" className="h-12 w-12 shrink-0" />
            <div>
              <p className="font-serif text-xl font-semibold leading-tight">{RESTAURANT.name}</p>
              <p className="text-sm text-[#F4ECDD]/55">{RESTAURANT.tagline} · a fictional restaurant, sample data</p>
            </div>
          </div>
          {[
            { value: facts?.orders, label: 'orders in its history' },
            { value: facts?.days, label: 'days of trading' },
            { value: facts?.dishes, label: 'dishes, in 3 languages' },
            { value: facts?.open, label: 'tables seated right now' },
          ].map((fact) => (
            <div key={fact.label} className="lg:border-s lg:border-white/[0.07] lg:ps-8">
              <p className="font-serif text-3xl font-semibold sm:text-4xl">{fact.value === undefined ? <span className="text-[#F4ECDD]/25">—</span> : <Count value={fact.value} />}</p>
              <p className="mt-1 text-[13px] text-[#F4ECDD]/55">{fact.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ------------------------------------------------------------ screens */}
      <section id="screens" className="mx-auto max-w-[1240px] scroll-mt-20 px-5 py-20 sm:px-8 lg:py-28">
        <motion.div {...inView()} className="max-w-2xl">
          <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#8FB08A]">Every screen, live</p>
          <h2 className="mt-3 font-serif text-3xl font-semibold tracking-tight sm:text-[2.6rem] sm:leading-[1.1]">Open it as the person who uses it</h2>
          <p className="mt-4 text-base leading-relaxed text-[#F4ECDD]/65">
            Each opens in a new tab, already signed in. They share one restaurant: what a guest orders, the kitchen cooks and the owner counts.
          </p>
        </motion.div>
        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {SCREENS.map((screen, i) => (
            <motion.a
              key={screen.title}
              {...inView(0.04 * i)}
              href={screen.href}
              target="_blank"
              rel="noopener"
              onClick={() => { if (screen.area) clearSignedOut(screen.area); }}
              className="demo-card group relative flex flex-col rounded-3xl p-6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F4ECDD]/60"
            >
              <div className="flex items-start justify-between gap-3">
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/[0.06] text-[#F4ECDD] ring-1 ring-white/10 transition duration-300 group-hover:bg-[#D98A5F] group-hover:text-[#17201B] group-hover:ring-[#D98A5F]">
                  <screen.icon className="h-5 w-5" aria-hidden />
                </span>
                <span className="rounded-full px-2.5 py-1 text-[11px] font-semibold text-[#F4ECDD]/50 ring-1 ring-white/10">{screen.device}</span>
              </div>
              <h3 className="mt-6 flex items-center gap-1.5 font-serif text-[1.35rem] font-semibold">
                {screen.title}
                <ArrowUpRight className="h-4 w-4 text-[#F4ECDD]/35 transition duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-[#EBAE8C]" aria-hidden />
              </h3>
              <p className="mt-1 text-xs font-medium text-[#8FB08A]">{screen.who}</p>
              <p className="mt-3 text-sm leading-relaxed text-[#F4ECDD]/60">{screen.what}</p>
            </motion.a>
          ))}
        </div>
      </section>

      {/* ------------------------------------------------------------ walkthrough */}
      <section id="walkthrough" className="scroll-mt-20 border-t border-white/[0.06] bg-white/[0.02]">
        <div className="mx-auto max-w-[1240px] px-5 py-20 sm:px-8 lg:py-28">
          <motion.div {...inView()} className="max-w-2xl">
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#8FB08A]">Five minutes</p>
            <h2 className="mt-3 font-serif text-3xl font-semibold tracking-tight sm:text-[2.6rem] sm:leading-[1.1]">Follow one order all the way through</h2>
          </motion.div>
          <ol className="relative mt-12 grid gap-10 sm:grid-cols-2 lg:grid-cols-4 lg:gap-6">
            <span aria-hidden className="absolute left-5 right-5 top-5 hidden h-px bg-gradient-to-r from-white/20 via-white/10 to-transparent lg:block" />
            {STEPS.map(([title, text], i) => (
              <motion.li key={title} {...inView(0.08 * i)} className="relative">
                <span className="relative flex h-10 w-10 items-center justify-center rounded-full bg-[#17201B] font-serif text-base font-semibold text-[#F4ECDD] ring-1 ring-white/20">{i + 1}</span>
                <h3 className="mt-5 font-serif text-xl font-semibold">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-[#F4ECDD]/60">{text}</p>
              </motion.li>
            ))}
          </ol>
          <motion.p {...inView(0.2)} className="mt-12 max-w-3xl text-sm leading-relaxed text-[#F4ECDD]/50">
            Everything here runs in this browser: no server, no internet needed, nothing charged. Keep the tabs in one browser window so they share the same restaurant. Close it and come back tomorrow, and the restaurant will have carried on trading.
          </motion.p>
        </div>
      </section>

      {/* ------------------------------------------------------------ contact */}
      <section id="contact" className="mx-auto max-w-[1240px] scroll-mt-20 px-5 py-20 sm:px-8 lg:py-28">
        <motion.div {...inView()} className="demo-contact relative overflow-hidden rounded-[2rem] px-6 py-12 sm:px-12 sm:py-16 lg:grid lg:grid-cols-[1.2fr_1fr] lg:items-center lg:gap-12">
          <div>
            <h2 className="font-serif text-3xl font-semibold tracking-tight text-[#17201B] sm:text-[2.7rem] sm:leading-[1.08]">See it with your own menu on it</h2>
            <p className="mt-4 max-w-xl text-base leading-relaxed text-[#17201B]/70">
              Send us your menu and we will show you this demo as your restaurant: your dishes, your tables, your name on the QR codes.
            </p>
            <a href={mailto} className="demo-press mt-8 inline-flex h-12 items-center gap-2.5 rounded-full bg-[#17201B] px-6 text-[15px] font-semibold text-[#F4ECDD] transition hover:bg-black">
              Book a demo <ArrowRight className="h-4 w-4" aria-hidden />
            </a>
          </div>
          <address className="mt-10 space-y-3 not-italic lg:mt-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#17201B]/50">Talk to {CONTACT.name} · {CONTACT.company}</p>
            <a href={`mailto:${CONTACT.email}`} className="group flex items-center gap-4 rounded-2xl bg-white/60 px-5 py-4 ring-1 ring-[#17201B]/10 transition hover:bg-white">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#17201B] text-[#F4ECDD]"><Mail className="h-5 w-5" aria-hidden /></span>
              <span className="min-w-0">
                <span className="block text-xs font-medium text-[#17201B]/55">Email</span>
                <span className="block truncate font-serif text-lg font-semibold text-[#17201B]">{CONTACT.email}</span>
              </span>
            </a>
            <a href={`tel:${CONTACT.phoneHref}`} className="group flex items-center gap-4 rounded-2xl bg-white/60 px-5 py-4 ring-1 ring-[#17201B]/10 transition hover:bg-white">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#17201B] text-[#F4ECDD]"><Phone className="h-5 w-5" aria-hidden /></span>
              <span className="min-w-0">
                <span className="block text-xs font-medium text-[#17201B]/55">Phone</span>
                <span className="block font-serif text-lg font-semibold text-[#17201B]" dir="ltr">{CONTACT.phone}</span>
              </span>
            </a>
          </address>
        </motion.div>
      </section>

      {/* ------------------------------------------------------------ footer */}
      <footer className="border-t border-white/[0.06]">
        <div className="mx-auto flex max-w-[1240px] flex-col items-start justify-between gap-4 px-5 py-8 text-[13px] text-[#F4ECDD]/45 sm:flex-row sm:items-center sm:px-8">
          <p>{PRODUCT.name} · {RESTAURANT.name} is a fictional restaurant with sample data.</p>
          <button
            type="button"
            onClick={reset}
            disabled={resetting}
            className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 font-medium text-[#F4ECDD]/55 ring-1 ring-white/10 transition hover:text-[#F4ECDD] hover:ring-white/25 disabled:opacity-60"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden /> {resetting ? 'Resetting…' : 'Reset the demo data'}
          </button>
        </div>
      </footer>
    </div>
  );
};

export default DemoHub;
