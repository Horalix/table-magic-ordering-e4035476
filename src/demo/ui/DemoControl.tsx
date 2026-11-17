/**
 * The presenter's remote (demo mode only): a small mark in the corner of
 * every screen that keeps a live presentation moving. It sends in new guests,
 * makes a table call the waiter, or puts the data back to its starting point.
 *
 * Closed, it is one translucent monogram, bottom left, out of the way of the
 * screen being shown. Open, it is a dark panel in the demo's own look (the
 * hub's), so it reads as the presenter's layer and not part of the product.
 * Shift+D opens and closes it; Escape or a click elsewhere closes it.
 *
 * Hidden inside the side-by-side stage's frames, on the demo's own pages,
 * and whenever `tableflow-demo.control` is "off" in localStorage — which is
 * how the screenshot and recording scripts keep it out of the picture.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { BellRing, Home, Play, RotateCcw, ShieldAlert, UserPlus, Users, X } from 'lucide-react';
import { toast } from 'sonner';
import { ACCOUNTS, PRODUCT, RESTAURANT, areaForPath } from '../brand';
import { demoRuntime } from '../runtime';
import { simulateArrival, simulateCall, simulateLargeOrder } from '../seed/live';
import { DemoMonogram } from './Brand';

const HIDE_KEY = 'tableflow-demo.control';
const AUTO_EVERY_MS = 40_000;
const EASE = [0.22, 0.8, 0.3, 1] as const;

const hidden = () => {
  try {
    return window.self !== window.top || localStorage.getItem(HIDE_KEY) === 'off';
  } catch {
    return true;
  }
};

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));

const ROW = 'group flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-start text-[13px] font-medium text-[#F4ECDD]/90 transition-colors hover:bg-white/[0.07] hover:text-[#F4ECDD] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F4ECDD]/40 disabled:opacity-50';
const TILE = 'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/[0.06] text-[#F4ECDD]/80 ring-1 ring-white/[0.08] transition-colors group-hover:text-[#F4ECDD]';

const DemoControl = () => {
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [auto, setAuto] = useState(false);
  const timer = useRef<number>();
  const root = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();

  const arrive = useCallback(async (quiet = false) => {
    const { backend } = await demoRuntime();
    const seated = await simulateArrival(backend);
    if (quiet) return;
    if (seated) toast.success(`Table ${seated.table}: ${seated.guest} just ordered`);
    else toast.message('Every table is taken. Close one from the waiter screen first.');
  }, []);

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    try { await work(); } catch (error) { toast.error(error instanceof Error ? error.message : 'That did not work'); } finally { setBusy(false); }
  };

  useEffect(() => {
    window.clearInterval(timer.current);
    if (auto) timer.current = window.setInterval(() => { void arrive(true).catch(() => undefined); }, AUTO_EVERY_MS);
    return () => window.clearInterval(timer.current);
  }, [auto, arrive]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setOpen(false); return; }
      if (isTyping(event.target)) return;
      if (event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey && event.code === 'KeyD') setOpen((on) => !on);
    };
    const onDown = (event: PointerEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    if (open) window.addEventListener('pointerdown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown);
    };
  }, [open]);

  if (hidden() || pathname === '/' || pathname.startsWith('/demo')) return null;

  const area = areaForPath(pathname);

  return (
    <div ref={root} className="fixed bottom-24 start-3 z-[70] font-sans antialiased print:hidden" data-demo-control>
      <AnimatePresence>
        {open && (
          <motion.div
            role="dialog"
            aria-label="Demo controls"
            initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.94, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.96, y: 6 }}
            transition={{ duration: 0.2, ease: EASE }}
            style={{ transformOrigin: 'bottom left' }}
            className="absolute bottom-12 start-0 w-[18.5rem] max-w-[calc(100vw-1.5rem)] rounded-2xl bg-[#111A15]/95 p-2 text-[#F4ECDD] shadow-[0_24px_60px_-20px_rgba(0,0,0,0.65)] ring-1 ring-white/10 backdrop-blur-xl"
          >
            <div className="flex items-center gap-3 px-2.5 pb-2.5 pt-1.5">
              <DemoMonogram tone="dark" className="h-7 w-7 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="font-serif text-[15px] font-semibold leading-tight">{PRODUCT.name} demo</p>
                <p className="truncate text-[11px] text-[#F4ECDD]/55">
                  {area ? `Signed in as ${ACCOUNTS[area].label}` : `${RESTAURANT.name} · guest view`}
                  {area === 'monitor' && ` · Floor PIN ${RESTAURANT.floorPin}`}
                </p>
              </div>
              <kbd className="hidden rounded-md px-1.5 py-0.5 font-sans text-[10px] font-semibold text-[#F4ECDD]/40 ring-1 ring-white/10 sm:inline">Shift D</kbd>
            </div>

            <p className="px-2.5 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-[#F4ECDD]/40">Make something happen</p>
            <button type="button" disabled={busy} className={ROW} onClick={() => run(() => arrive())}>
              <span className={TILE}><UserPlus className="h-4 w-4" aria-hidden /></span> New guests sit down and order
            </button>
            <button
              type="button" disabled={busy} className={ROW}
              onClick={() => run(async () => {
                for (let i = 0; i < 3; i += 1) { await arrive(true); await new Promise((r) => setTimeout(r, 900)); }
                toast.success('Three tables ordered');
              })}
            >
              <span className={TILE}><Users className="h-4 w-4" aria-hidden /></span> A busy moment: three tables
            </button>
            <button
              type="button" disabled={busy} className={ROW}
              onClick={() => run(async () => {
                const { backend } = await demoRuntime();
                const call = await simulateCall(backend);
                if (call) toast.success(`Table ${call.table} ${call.kind === 'bill' ? 'asked for the bill' : 'called the waiter'}`);
                else toast.message('No seated table to call from.');
              })}
            >
              <span className={TILE}><BellRing className="h-4 w-4" aria-hidden /></span> A table calls the waiter
            </button>
            <button
              type="button" disabled={busy} className={ROW}
              onClick={() => run(async () => {
                const { backend } = await demoRuntime();
                const party = await simulateLargeOrder(backend);
                if (party) toast.success(`Table ${party.table}: a large first order is waiting to be confirmed`);
                else toast.message('Every table is taken. Close one from the waiter screen first.');
              })}
            >
              <span className={TILE}><ShieldAlert className="h-4 w-4" aria-hidden /></span> A large first order, held to confirm
            </button>
            <button type="button" role="switch" aria-checked={auto} className={ROW} onClick={() => setAuto((on) => !on)}>
              <span className={TILE}><Play className="h-4 w-4" aria-hidden /></span>
              <span className="flex-1">
                Keep guests coming
                <span className="block text-[11px] font-normal text-[#F4ECDD]/45">A new table every 40 seconds</span>
              </span>
              <span aria-hidden className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${auto ? 'bg-[#8FB08A]' : 'bg-white/15'}`}>
                <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-[#F4ECDD] shadow transition-all duration-200 ${auto ? 'start-[1.125rem]' : 'start-0.5'}`} />
              </span>
            </button>

            <div className="mx-2.5 my-1.5 h-px bg-white/[0.08]" />
            <a href="/" className={ROW}><span className={TILE}><Home className="h-4 w-4" aria-hidden /></span> All demo screens</a>
            <button
              type="button" className={`${ROW} hover:text-[#F2A68A]`}
              onClick={() => {
                if (!window.confirm('Reset the demo? Every order, change and sign-in made here goes back to the starting point, in all open tabs.')) return;
                void demoRuntime().then((runtime) => runtime.reset());
              }}
            >
              <span className={TILE}><RotateCcw className="h-4 w-4" aria-hidden /></span> Reset the demo data
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Closed, one small mark: there for the presenter, quiet for everyone watching. */}
      <button
        type="button"
        onClick={() => setOpen((on) => !on)}
        aria-label={open ? 'Close the demo controls' : 'Open the demo controls'}
        aria-expanded={open}
        title="Demo controls (Shift+D)"
        className={`relative flex h-10 w-10 items-center justify-center rounded-full bg-[#111A15]/80 shadow-[0_10px_30px_-10px_rgba(0,0,0,0.6)] ring-1 ring-white/15 backdrop-blur-md transition duration-200 hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D98A5F] active:scale-95 ${open ? 'opacity-100' : 'opacity-55'}`}
      >
        {open ? <X className="h-4 w-4 text-[#F4ECDD]" aria-hidden /> : <DemoMonogram tone="dark" className="h-6 w-6" />}
        {auto && !open && <span aria-hidden className="absolute -end-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-[#8FD19E] ring-2 ring-[#111A15]" />}
      </button>
    </div>
  );
};

export default DemoControl;
