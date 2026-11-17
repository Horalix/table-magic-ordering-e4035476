/**
 * Shared by the demo's screenshot and recording scripts
 * (scripts/demo-screens.mjs, scripts/demo-capture.mjs; docs/demo-mode.md).
 *
 * Both drive the built demo (npm run build:demo) in a real browser. They
 * serve dist-demo themselves unless given --url, and they keep the demo's
 * own floating control out of the picture.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** --name value pairs and bare --flags from the command line. */
export function options(defaults = {}) {
  const out = { ...defaults };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith('--')) continue;
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[key] = true;
    else { out[key] = next; i += 1; }
  }
  return out;
}

/** The QR token of a seeded table: the same rule as src/demo/brand.ts. */
export const tableQrToken = (table) => `demo${String(table).padStart(2, '0')}`.padEnd(64, 'c0ffee');
export const guestTablePath = (table = 5) => `/table/${table}?token=${tableQrToken(table)}`;

/**
 * The address of a running demo. With no --url, serves dist-demo with
 * `vite preview` and stops it again when the script ends.
 */
export async function demoServer(url) {
  if (url) return { url: String(url).replace(/\/$/, ''), stop: async () => undefined };
  if (!existsSync(path.join(ROOT, 'dist-demo', 'index.html'))) {
    throw new Error('dist-demo is missing. Run `npm run build:demo` first, or pass --url of a running demo (e.g. npm run dev:demo).');
  }
  const port = 4179;
  const child = spawn(process.execPath, [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), 'preview', '--mode', 'demo', '--port', String(port), '--strictPort'], {
    cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const address = `http://localhost:${port}`;
  const started = Date.now();
  for (;;) {
    try {
      const res = await fetch(address);
      if (res.ok) break;
    } catch { /* not up yet */ }
    if (child.exitCode !== null) throw new Error(`The demo server stopped (is port ${port} in use? pass --url to use a demo that is already running).`);
    if (Date.now() - started > 30_000) throw new Error('The demo server did not start within 30 seconds.');
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return { url: address, stop: async () => { child.kill(); } };
}

export function ensureDir(dir) {
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** What every browser context of these scripts starts with: no demo control, English, Sarajevo time. */
export const CONTEXT = { locale: 'en-GB', timezoneId: 'Europe/Sarajevo' };

export async function quietDemo(context) {
  await context.addInitScript(() => {
    try { localStorage.setItem('tableflow-demo.control', 'off'); } catch { /* storage off */ }
  });
}

/** Waits until the demo has started and the page has finished loading its data. */
export async function settled(page, extra = 600) {
  await page.waitForFunction(
    () => !document.querySelector('[data-demo-splash]') && (document.getElementById('root')?.children.length ?? 0) > 0,
    null, { timeout: 180_000 },
  );
  await page.waitForTimeout(700);
  await page.waitForFunction(() => !document.querySelector('.animate-pulse, .animate-spin'), null, { timeout: 20_000 }).catch(() => undefined);
  await page.evaluate(() => Promise.all([...document.images].filter((img) => !img.complete).map((img) => new Promise((resolve) => {
    img.addEventListener('load', resolve, { once: true });
    img.addEventListener('error', resolve, { once: true });
    setTimeout(resolve, 4000);
  })))).catch(() => undefined);
  await page.waitForTimeout(extra);
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
