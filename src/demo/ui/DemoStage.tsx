/**
 * Two screens side by side (demo mode only): a phone and a larger screen,
 * each a live frame of the app. They share the one in-browser restaurant, so
 * an order sent on the phone lands on the screen next to it — the whole
 * product in one picture, for presenting and for the recorded walkthrough
 * (scripts/demo-capture.mjs).
 *
 * /demo/stage?phone=<path>&screen=<path>&title=<text>&caption=<text>
 * Leave `phone` or `screen` out to show the other alone. `chrome=off` hides
 * the bar at the top. With a `title` the page is a scene of a film: the
 * presets and buttons are not shown.
 */
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowLeft, Send } from 'lucide-react';
import { DEMO_PATHS, PRODUCT, RESTAURANT, guestTablePath } from '../brand';
import { demoRuntime } from '../runtime';
import { simulateArrival, simulateCall } from '../seed/live';
import { DemoMonogram } from './Brand';
import { Device } from './DeviceFrames';
import './demo.css';

const PRESETS: { label: string; phone: string; screen: string }[] = [
  { label: 'Guest + Kitchen', phone: guestTablePath(), screen: '/kitchen' },
  { label: 'Waiter + Kitchen', phone: '/waiter', screen: '/kitchen' },
  { label: 'Guest + Owner', phone: guestTablePath(), screen: '/admin' },
  { label: 'Waiter + Floor', phone: '/waiter', screen: '/waiter/monitor' },
];

const EASE = [0.22, 0.8, 0.3, 1] as const;

const DemoStage = () => {
  const [params, setParams] = useSearchParams();
  const phone = params.get('phone');
  const screen = params.get('screen');
  const title = params.get('title');
  const caption = params.get('caption');
  const chrome = params.get('chrome') !== 'off';
  const both = !phone && !screen;
  const phoneSrc = both ? PRESETS[0].phone : phone;
  const screenSrc = both ? PRESETS[0].screen : screen;
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const noteTimer = useRef<number>();

  useEffect(() => {
    document.title = `${PRODUCT.name} — ${RESTAURANT.name}, side by side`;
    document.documentElement.setAttribute('dir', 'ltr');
    return () => window.clearTimeout(noteTimer.current);
  }, []);

  const sendOrder = async () => {
    setBusy(true);
    try {
      const { backend } = await demoRuntime();
      const seated = await simulateArrival(backend);
      const call = seated ? null : await simulateCall(backend);
      setNote(seated ? `Table ${seated.table}: ${seated.guest} just ordered`
        : call ? `Table ${call.table} ${call.kind === 'bill' ? 'asked for the bill' : 'is calling the waiter'}`
          : 'The room is full');
      window.clearTimeout(noteTimer.current);
      noteTimer.current = window.setTimeout(() => setNote(null), 5000);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="demo-surface flex h-screen w-screen flex-col overflow-hidden font-sans text-[#F4ECDD] antialiased">
      {chrome && (
        <header className="flex shrink-0 items-center justify-between gap-6 px-10 pt-7">
          <div className="flex min-w-0 items-center gap-4">
            {!title && (
              <a href={DEMO_PATHS.hub} aria-label="All demo screens" className="demo-press flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[#F4ECDD]/70 ring-1 ring-white/12 transition hover:bg-white/[0.06] hover:text-[#F4ECDD]">
                <ArrowLeft className="h-4 w-4" aria-hidden />
              </a>
            )}
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.3em] text-[#F4ECDD]/55">
                <DemoMonogram tone="dark" className="h-4 w-4" /> {PRODUCT.name} · {RESTAURANT.name}
              </p>
              <h1 className="mt-1.5 truncate font-serif text-3xl font-semibold tracking-tight">{title ?? 'One order, every screen'}</h1>
            </div>
          </div>
          {!title && (
            <div className="flex shrink-0 items-center gap-3">
              <nav className="flex rounded-full bg-white/[0.05] p-1 ring-1 ring-white/10" aria-label="What to show">
                {PRESETS.map((preset) => {
                  const active = preset.phone === phoneSrc && preset.screen === screenSrc;
                  return (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() => setParams({ phone: preset.phone, screen: preset.screen })}
                      aria-pressed={active}
                      className={`relative rounded-full px-4 py-2 text-sm font-semibold transition-colors ${active ? 'text-[#17201B]' : 'text-[#F4ECDD]/70 hover:text-[#F4ECDD]'}`}
                    >
                      {active && <motion.span layoutId="stage-preset" transition={{ duration: 0.35, ease: EASE }} className="absolute inset-0 rounded-full bg-[#F4ECDD]" />}
                      <span className="relative">{preset.label}</span>
                    </button>
                  );
                })}
              </nav>
              <button
                type="button"
                onClick={() => { void sendOrder(); }}
                disabled={busy}
                className="demo-press inline-flex h-11 items-center gap-2 rounded-full bg-[#D98A5F] px-5 text-sm font-semibold text-[#17201B] transition hover:bg-[#E59B72] disabled:opacity-60"
              >
                <Send className="h-4 w-4" aria-hidden /> {busy ? 'Sending…' : 'Send an order'}
              </button>
            </div>
          )}
        </header>
      )}
      <main className="relative flex min-h-0 flex-1 items-stretch gap-10 px-10 py-7">
        <div aria-hidden className="demo-halo pointer-events-none absolute inset-x-[12%] inset-y-[8%]" />
        {phoneSrc && <div className={`relative ${screenSrc ? 'w-[27%] min-w-0' : 'w-full'}`}><Device kind="phone" src={phoneSrc} name="Phone" stage="phone" /></div>}
        {screenSrc && <div className="relative min-w-0 flex-1"><Device kind="screen" src={screenSrc} name="Screen" stage="screen" /></div>}
        <AnimatePresence>
          {note && (
            <motion.p
              role="status"
              initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }} transition={{ duration: 0.3, ease: EASE }}
              className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full bg-black/55 px-4 py-2 text-sm font-medium ring-1 ring-white/15 backdrop-blur"
            >
              <span className="h-2 w-2 rounded-full bg-[#8FD19E]" /> {note}
            </motion.p>
          )}
        </AnimatePresence>
      </main>
      {caption && (
        <footer className="shrink-0 px-10 pb-8">
          <p className="mx-auto max-w-4xl rounded-2xl bg-black/40 px-6 py-3.5 text-center text-xl font-medium text-white ring-1 ring-white/10 backdrop-blur" data-stage-caption>{caption}</p>
        </footer>
      )}
    </div>
  );
};

export default DemoStage;
