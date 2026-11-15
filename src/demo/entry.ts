/**
 * Where a demo build starts (vite.config.ts points index.html here instead of
 * src/main.tsx when the mode is "demo").
 *
 * It puts the demo backend in place, shows a loading screen while the
 * in-browser database opens (a few seconds the very first time, when it is
 * built from the migrations and seeded), and only then loads the app itself —
 * the unchanged src/main.tsx — so the app's first request already has
 * something to answer it.
 *
 * The loading screen is the first thing a restaurant owner sees, so it is
 * drawn like the product: the mark, the name, and a progress line that says
 * what is being prepared. It sits over the page (not inside #root), so the
 * app renders underneath and the screen fades off it instead of blinking.
 */
import { PRODUCT, RESTAURANT } from './brand';
import { startDemoRuntime } from './runtime';
import type { DemoMessage } from './channel';

type Step = 'open' | 'schema' | 'seed' | 'ready';

/** What each step says, and how far along the line it ends. */
const STEPS: Record<Step, { label: string; until: number; seconds: number }> = {
  open: { label: 'Opening the restaurant', until: 14, seconds: 1.2 },
  schema: { label: 'Setting up the kitchen, the floor and the back office', until: 52, seconds: 4 },
  seed: { label: `Seating guests at ${RESTAURANT.name} and writing ten weeks of service`, until: 94, seconds: 6 },
  ready: { label: 'Ready', until: 100, seconds: 0.35 },
};

/** The demo's own pages are dark; the app's screens are light. The splash matches where it is going. */
const dark = () => /^\/($|demo(\/|$)|admin\/login|waiter\/login)/.test(location.pathname);

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

function showSplash(): { report: (message: DemoMessage) => void; dismiss: () => void } {
  const night = dark();
  const ink = night ? '#F4ECDD' : '#1F2622';
  const soft = night ? 'rgba(244,236,221,.62)' : 'rgba(31,38,34,.6)';
  const track = night ? 'rgba(244,236,221,.12)' : 'rgba(31,38,34,.1)';
  const splash = document.createElement('div');
  splash.setAttribute('data-demo-splash', '');
  splash.setAttribute('role', 'status');
  splash.setAttribute('aria-live', 'polite');
  splash.innerHTML = `
    <style>
      @font-face{font-family:'Lora';font-weight:400 700;font-display:swap;src:url('/fonts/lora.woff2') format('woff2')}
      @font-face{font-family:'Inter';font-weight:400 700;font-display:swap;src:url('/fonts/inter.woff2') format('woff2')}
      [data-demo-splash]{position:fixed;inset:0;z-index:2147483000;display:flex;flex-direction:column;align-items:center;justify-content:center;
        padding:32px;text-align:center;color:${ink};font-family:Inter,system-ui,sans-serif;
        background:${night
          ? 'radial-gradient(90% 70% at 50% 0%,#22352A 0%,#131C17 55%,#0C120F 100%)'
          : 'radial-gradient(90% 70% at 50% 0%,#FFFFFF 0%,#F8F6F0 60%,#F1EEE5 100%)'};
        transition:opacity .42s cubic-bezier(.22,.8,.3,1),transform .42s cubic-bezier(.22,.8,.3,1)}
      [data-demo-splash][data-leaving]{opacity:0;transform:scale(1.015);pointer-events:none}
      .ds-mark{width:76px;height:76px;filter:drop-shadow(0 18px 30px rgba(0,0,0,${night ? '.45' : '.14'}));animation:ds-rise .7s cubic-bezier(.22,.8,.3,1) both}
      .ds-ring{stroke-dasharray:66;stroke-dashoffset:66;animation:ds-draw 1.1s .15s cubic-bezier(.65,0,.35,1) forwards}
      .ds-dot{transform-origin:45px 32px;animation:ds-pop .5s 1s cubic-bezier(.34,1.56,.64,1) both, ds-breathe 2.4s 1.6s ease-in-out infinite}
      .ds-name{margin-top:22px;font-family:Lora,Georgia,serif;font-size:30px;font-weight:600;letter-spacing:-.015em;line-height:1;animation:ds-rise .7s .08s cubic-bezier(.22,.8,.3,1) both}
      .ds-by{margin-top:10px;font-size:11px;font-weight:600;letter-spacing:.3em;text-transform:uppercase;color:${soft};animation:ds-rise .7s .16s cubic-bezier(.22,.8,.3,1) both}
      .ds-progress{margin-top:34px;width:min(280px,70vw);opacity:0;transition:opacity .4s}
      .ds-progress[data-on]{opacity:1}
      .ds-track{height:3px;border-radius:99px;background:${track};overflow:hidden}
      .ds-bar{height:100%;width:0;border-radius:99px;background:linear-gradient(90deg,#7E9B79,#D98A5F);transition:width 1.2s cubic-bezier(.2,.7,.2,1)}
      .ds-step{margin-top:14px;min-height:36px;font-size:13px;line-height:1.45;color:${soft};transition:opacity .25s}
      @keyframes ds-rise{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
      @keyframes ds-draw{to{stroke-dashoffset:0}}
      @keyframes ds-pop{from{opacity:0;transform:scale(0)}to{opacity:1;transform:scale(1)}}
      @keyframes ds-breathe{0%,100%{transform:scale(1)}50%{transform:scale(1.25)}}
      @media (prefers-reduced-motion: reduce){[data-demo-splash] *{animation:none!important;transition:none!important}.ds-ring{stroke-dashoffset:0}}
    </style>
    <svg class="ds-mark" viewBox="0 0 64 64" aria-hidden="true">
      <rect width="64" height="64" rx="15" fill="${night ? '#F4ECDD' : '#33473B'}"/>
      <path class="ds-ring" d="M42 21.5a14 14 0 1 0 0 21" fill="none" stroke="${night ? '#33473B' : '#F4ECDD'}" stroke-width="6" stroke-linecap="round"/>
      <circle class="ds-dot" cx="45" cy="32" r="3.4" fill="#D98A5F"/>
    </svg>
    <div class="ds-name">${PRODUCT.name}</div>
    <div class="ds-by">${PRODUCT.byline}</div>
    <div class="ds-progress" data-demo-progress>
      <div class="ds-track"><div class="ds-bar" data-demo-bar></div></div>
      <div class="ds-step" data-demo-step>${STEPS.open.label}</div>
    </div>`;
  document.body.appendChild(splash);

  const progress = splash.querySelector<HTMLElement>('[data-demo-progress]');
  const bar = splash.querySelector<HTMLElement>('[data-demo-bar]');
  const label = splash.querySelector<HTMLElement>('[data-demo-step]');
  const go = (step: Step) => {
    if (!bar || !label) return;
    bar.style.transitionDuration = `${STEPS[step].seconds}s`;
    bar.style.width = `${STEPS[step].until}%`;
    label.textContent = step === 'ready' ? `${RESTAURANT.name} is open` : `${STEPS[step].label}…`;
  };
  // A database that is already there opens in well under a second: the line
  // only appears when there is something worth waiting for.
  const reveal = window.setTimeout(() => { progress?.setAttribute('data-on', ''); go('open'); }, 650);

  return {
    report(message) {
      if (message.type === 'progress') {
        if (message.step !== 'ready') progress?.setAttribute('data-on', '');
        go(message.step);
      }
      if (message.type === 'failed' && label) {
        progress?.setAttribute('data-on', '');
        label.textContent = `The demo could not start: ${message.message}`;
      }
    },
    dismiss() {
      window.clearTimeout(reveal);
      go('ready');
      const remove = () => splash.remove();
      if (reducedMotion()) { remove(); return; }
      // Two frames: the app underneath has painted before the cover starts to lift.
      requestAnimationFrame(() => requestAnimationFrame(() => {
        splash.setAttribute('data-leaving', '');
        splash.addEventListener('transitionend', remove, { once: true });
        window.setTimeout(remove, 600);
      }));
    },
  };
}

async function start() {
  document.title = `${PRODUCT.name} — ${PRODUCT.byline}`;
  // A service worker from a non-demo build on this address would answer for the app.
  if ('serviceWorker' in navigator) {
    void navigator.serviceWorker.getRegistrations().then((all) => all.forEach((r) => { void r.unregister(); })).catch(() => undefined);
  }
  const splash = showSplash();
  try {
    await startDemoRuntime(splash.report);
  } catch (error) {
    splash.report({ type: 'failed', message: error instanceof Error ? error.message : String(error) });
    throw error;
  }
  await import('../main');
  splash.dismiss();
}

void start();
