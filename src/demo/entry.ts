/**
 * Where a demo build starts (vite.config.ts points index.html here instead of
 * src/main.tsx when the mode is "demo").
 *
 * It puts the demo backend in place, shows a loading screen while the
 * in-browser database opens (a few seconds the very first time, when it is
 * built from the migrations and seeded), and only then loads the app itself —
 * the unchanged src/main.tsx — so the app's first request already has
 * something to answer it.
 */
import { PRODUCT, RESTAURANT } from './brand';
import { startDemoRuntime } from './runtime';
import type { DemoMessage } from './channel';

const STEPS: Record<string, string> = {
  open: 'Opening the demo restaurant…',
  schema: 'Building the database…',
  seed: `Seating guests and writing a week of orders at ${RESTAURANT.name}…`,
  ready: 'Ready',
};

function showSplash(): (message: DemoMessage) => void {
  const root = document.getElementById('root');
  if (!root) return () => undefined;
  root.innerHTML = `
    <div data-demo-splash style="min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;padding:24px;background:#F7F4EC;color:#2B2A26;font-family:Inter,system-ui,sans-serif;text-align:center">
      <div style="font-family:Lora,Georgia,serif;font-size:28px;font-weight:600;letter-spacing:-0.01em">${PRODUCT.name}</div>
      <div style="width:28px;height:28px;border:3px solid rgba(126,155,121,.25);border-top-color:#7E9B79;border-radius:50%;animation:demo-spin .8s linear infinite"></div>
      <div data-demo-step style="font-size:14px;color:#6B6A63;max-width:320px;line-height:1.5">${STEPS.open}</div>
    </div>
    <style>@keyframes demo-spin{to{transform:rotate(360deg)}}</style>`;
  const label = root.querySelector('[data-demo-step]');
  return (message) => {
    if (!label) return;
    if (message.type === 'progress') label.textContent = STEPS[message.step] ?? STEPS.open;
    if (message.type === 'failed') label.textContent = `The demo could not start: ${message.message}`;
  };
}

async function start() {
  document.title = `${PRODUCT.name} — ${PRODUCT.byline}`;
  // A service worker from a non-demo build on this address would answer for the app.
  if ('serviceWorker' in navigator) {
    void navigator.serviceWorker.getRegistrations().then((all) => all.forEach((r) => { void r.unregister(); })).catch(() => undefined);
  }
  const report = showSplash();
  try {
    await startDemoRuntime(report);
  } catch (error) {
    report({ type: 'failed', message: error instanceof Error ? error.message : String(error) });
    throw error;
  }
  await import('../main');
}

void start();
