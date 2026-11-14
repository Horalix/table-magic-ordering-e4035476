/**
 * The presenter's remote (demo mode only): a small tab on the edge of every
 * screen that keeps a live presentation moving. It sends in new guests, makes
 * a table call the waiter, or puts the data back to its starting point.
 *
 * Hidden inside the side-by-side stage's frames, on the demo's own pages,
 * and whenever `tableflow-demo.control` is "off" in localStorage — which is
 * how the screenshot and recording scripts keep it out of the picture.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { BellRing, Home, Play, RotateCcw, ShieldAlert, Square, UserPlus, Users, X } from 'lucide-react';
import { toast } from 'sonner';
import { ACCOUNTS, PRODUCT, RESTAURANT, areaForPath } from '../brand';
import { demoRuntime } from '../runtime';
import { simulateArrival, simulateCall, simulateLargeOrder } from '../seed/live';

const HIDE_KEY = 'tableflow-demo.control';
const AUTO_EVERY_MS = 40_000;

const hidden = () => {
  try {
    return window.self !== window.top || localStorage.getItem(HIDE_KEY) === 'off';
  } catch {
    return true;
  }
};

const DemoControl = () => {
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [auto, setAuto] = useState(false);
  const timer = useRef<number>();

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

  if (hidden() || pathname === '/' || pathname.startsWith('/demo')) return null;

  const area = areaForPath(pathname);
  const action = 'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-start font-sans text-sm font-medium text-foreground transition hover:bg-muted disabled:opacity-50';

  return (
    <div className="fixed start-0 top-1/2 z-[70] -translate-y-1/2 print:hidden" data-demo-control>
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open the demo controls"
          className="rounded-e-xl bg-foreground/85 px-1.5 py-3 font-sans text-[10px] font-bold uppercase tracking-[0.2em] text-background shadow-lg backdrop-blur transition hover:bg-foreground [writing-mode:vertical-rl]"
        >
          Demo
        </button>
      )}
      {open && (
        <div role="dialog" aria-label="Demo controls" className="ms-2 w-72 rounded-2xl border border-border bg-card p-3 shadow-2xl">
          <div className="flex items-center justify-between px-1 pb-2">
            <div>
              <p className="font-serif text-base font-semibold leading-tight">{PRODUCT.name} demo</p>
              <p className="font-sans text-[11px] text-muted-foreground">
                {area ? `Signed in as ${ACCOUNTS[area].label}` : `${RESTAURANT.name} · guest view`}
                {area === 'monitor' && ` · Floor PIN ${RESTAURANT.floorPin}`}
              </p>
            </div>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="space-y-0.5 border-t border-border pt-2">
            <button type="button" disabled={busy} className={action} onClick={() => run(() => arrive())}>
              <UserPlus className="h-4 w-4 text-primary" aria-hidden /> New guests sit down and order
            </button>
            <button
              type="button" disabled={busy} className={action}
              onClick={() => run(async () => {
                for (let i = 0; i < 3; i += 1) { await arrive(true); await new Promise((r) => setTimeout(r, 900)); }
                toast.success('Three tables ordered');
              })}
            >
              <Users className="h-4 w-4 text-primary" aria-hidden /> A busy moment: three tables
            </button>
            <button
              type="button" disabled={busy} className={action}
              onClick={() => run(async () => {
                const { backend } = await demoRuntime();
                const call = await simulateCall(backend);
                if (call) toast.success(`Table ${call.table} ${call.kind === 'bill' ? 'asked for the bill' : 'called the waiter'}`);
                else toast.message('No seated table to call from.');
              })}
            >
              <BellRing className="h-4 w-4 text-primary" aria-hidden /> A table calls the waiter
            </button>
            <button
              type="button" disabled={busy} className={action}
              onClick={() => run(async () => {
                const { backend } = await demoRuntime();
                const party = await simulateLargeOrder(backend);
                if (party) toast.success(`Table ${party.table}: a large first order is waiting to be confirmed`);
                else toast.message('Every table is taken. Close one from the waiter screen first.');
              })}
            >
              <ShieldAlert className="h-4 w-4 text-primary" aria-hidden /> A large first order (held to confirm)
            </button>
            <button type="button" className={action} onClick={() => setAuto((on) => !on)} aria-pressed={auto}>
              {auto ? <Square className="h-4 w-4 text-accent" aria-hidden /> : <Play className="h-4 w-4 text-primary" aria-hidden />}
              {auto ? 'Stop sending guests' : 'Keep sending guests (every 40 s)'}
            </button>
          </div>
          <div className="mt-2 space-y-0.5 border-t border-border pt-2">
            <a href="/" className={action}><Home className="h-4 w-4 text-muted-foreground" aria-hidden /> All demo screens</a>
            <button
              type="button" className={`${action} hover:text-destructive`}
              onClick={() => {
                if (!window.confirm('Reset the demo? Every order, change and sign-in made here goes back to the starting point, in all open tabs.')) return;
                void demoRuntime().then((runtime) => runtime.reset());
              }}
            >
              <RotateCcw className="h-4 w-4 text-muted-foreground" aria-hidden /> Reset the demo data
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default DemoControl;
