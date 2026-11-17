/**
 * demo-footage.mjs — short, smooth clips of the demo being used, for a launch film.
 *
 *   npm run build:demo
 *   node scripts/demo-footage.mjs                       # every clip
 *   node scripts/demo-footage.mjs --only guest-open,kitchen-new-order
 *   node scripts/demo-footage.mjs --out D:\clips --fps 60 --at 19:20 --url http://localhost:4173
 *   node scripts/demo-footage.mjs --readme             # rewrite README.md only
 *
 * Writes one MP4 per clip (H.264, yuv420p, no audio) and README.md into --out
 * (default C:\Users\kerim\demo-pitch\footage). Needs ffmpeg on PATH (or FFMPEG).
 *
 * How it stays smooth: nothing is recorded in real time. Each clip is filmed
 * frame by frame. Before every frame the page's clock (Playwright's fake
 * timers: Date, timers, requestAnimationFrame) and every CSS / Web animation
 * are moved on by exactly one frame, the script waits until the demo's
 * database has answered every request the page made, and only then takes the
 * screenshot. A slow query or a busy machine makes the capture slower, never
 * the film: loading is invisible, and every frame is exactly 1/fps apart.
 *
 * The demo is filmed in the evening (--at, Sarajevo time, default 19:20), when
 * a restaurant is busy: the page's clock and the database worker's clock are
 * both moved there, so tickets, "today" and the live floor read like dinner
 * service whatever time it is when the script runs.
 *
 * FOOTAGE_DEBUG=1 also saves every 60th frame (and a Playwright screenshot of
 * it) next to the clips, with the page's text, to see what a failing step saw.
 *
 * The pointer is drawn by the script: a soft touch on phone clips, an arrow on
 * desktop clips. The demo's own control tab, scrollbars and the text caret are
 * hidden.
 */
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { chromium } from 'playwright';
import { CONTEXT, demoServer, ensureDir, guestTablePath, options, sleep } from './demo-lib.mjs';

const opts = options({ out: 'C:\\Users\\kerim\\demo-pitch\\footage', fps: '60', at: '19:20', only: '' });
const OUT = ensureDir(path.resolve(String(opts.out)));
const FPS = Number(opts.fps) || 60;
const ONLY = String(opts.only || '').split(',').map((s) => s.trim()).filter(Boolean);

// ------------------------------------------------------------------ ffmpeg
function findFfmpeg() {
  if (process.env.FFMPEG && existsSync(process.env.FFMPEG)) return process.env.FFMPEG;
  if (spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0) return 'ffmpeg';
  for (const base of [os.homedir(), path.join(os.homedir(), 'Downloads')]) {
    try {
      for (const dir of readdirSync(base).filter((d) => /^ffmpeg/i.test(d))) {
        const exe = path.join(base, dir, 'bin', 'ffmpeg.exe');
        if (existsSync(exe)) return exe;
      }
    } catch { /* not there */ }
  }
  throw new Error('ffmpeg not found: put it on PATH or set FFMPEG.');
}
const FFMPEG = findFfmpeg();

/**
 * Collects a clip's frames as numbered JPEG files, then encodes them to an
 * H.264 MP4. (Piping the JPEGs straight into ffmpeg is not safe: its stream
 * parser can cut a frame at a marker inside the data and splice two frames
 * together, which showed as tearing on the desktop clips.)
 */
function encoder(file) {
  const dir = ensureDir(path.join(path.dirname(file), '.tmp', `${path.basename(file, '.mp4')}-${process.pid}`));
  let n = 0;
  return {
    async write(buf) { writeFileSync(path.join(dir, `${String(n).padStart(6, '0')}.jpg`), buf); n += 1; },
    async end() {
      const r = spawnSync(FFMPEG, [
        '-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(dir, '%06d.jpg'),
        // JPEG frames are full range: convert to the ordinary (TV) range every editor expects
        '-vf', 'scale=in_range=pc:out_range=tv,format=yuv420p', '-color_range', 'tv',
        '-c:v', 'libx264', '-preset', 'slow', '-crf', '15', '-pix_fmt', 'yuv420p', '-r', String(FPS),
        '-movflags', '+faststart', '-an', file,
      ], { encoding: 'utf8' });
      rmSync(dir, { recursive: true, force: true });
      if (r.status !== 0) throw new Error(`ffmpeg: ${r.stderr}`);
    },
  };
}

function probe(file) {
  const r = spawnSync(FFMPEG.replace(/ffmpeg(\.exe)?$/i, (m) => m.replace('ffmpeg', 'ffprobe')), ['-v', 'error', '-select_streams', 'v:0', '-count_frames',
    '-show_entries', 'stream=width,height,nb_read_frames,r_frame_rate', '-of', 'csv=p=0', file], { encoding: 'utf8' });
  const [width, height, rate, frames] = (r.stdout || '').trim().split(',');
  return { width: Number(width), height: Number(height), frames: Number(frames), seconds: Number(frames) / FPS, rate };
}

// ------------------------------------------------------------------ time
const [atH, atM] = String(opts.at).split(':').map(Number);
/** The film's evening: today at --at in Sarajevo (CET in November), or tomorrow's if that has passed. */
const filmNow = (() => {
  const d = new Date();
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Sarajevo' }).format(d);
  const offset = /GMT([+-]\d+)/.exec(new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Sarajevo', timeZoneName: 'shortOffset' }).format(d))?.[1] ?? '+1';
  const t = new Date(`${ymd}T${String(atH).padStart(2, '0')}:${String(atM || 0).padStart(2, '0')}:00${offset.length === 2 ? offset[0] + '0' + offset[1] : offset}:00`);
  return t.getTime() < d.getTime() ? t.getTime() + 86_400_000 : t.getTime();
})();
/** Film time minus real time, the same for the page and the database worker. */
const OFFSET = filmNow - Date.now();

const workerShim = `(()=>{const O=${OFFSET};const R=Date;const now=()=>R.now()+O;`
  + 'class D extends R{constructor(...a){if(a.length===0){super(now())}else{super(...a)}}static now(){return now()}};'
  + 'globalThis.Date=D;})();\n';

// ------------------------------------------------------------------ browser contexts
const KINDS = {
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  desktop: { viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1.6 },
  tv: { viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1.6 },
  tvPortrait: { viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 4 / 3 },
};

/** Hidden in every clip: the demo's control, scrollbars, the text caret, focus rings left by a tap. */
const CLEAN_CSS = `
  ::-webkit-scrollbar { display: none !important; width: 0 !important; height: 0 !important; }
  * { scrollbar-width: none !important; caret-color: transparent !important; }
  *:focus-visible { outline: none !important; box-shadow: none !important; }
  * { -webkit-tap-highlight-color: transparent !important; }
`;

async function newContext(browser, kind) {
  const context = await browser.newContext({ ...CONTEXT, ...KINDS[kind] });
  await context.route(/db\.worker-[^/]+\.js$/, async (route) => {
    const res = await route.fetch();
    await route.fulfill({ response: res, body: workerShim + await res.text() });
  });
  await context.addInitScript((css) => {
    try { localStorage.setItem('tableflow-demo.control', 'off'); } catch { /* storage off */ }
    /*
     * framer-motion hands opacity and transform to the browser (Web Animations)
     * whenever Element.prototype has its own animate(), and pins their start to
     * performance.now() — which the fake clock moves out of step with the
     * browser's animation timeline, leaving entrances stuck at their first
     * frame. Moving animate() down to HTMLElement keeps it for the app's own
     * use (the add-to-order flight) and makes framer-motion animate in
     * JavaScript, on the fake clock, frame by frame.
     */
    const animate = Element.prototype.animate;
    if (animate && Object.prototype.hasOwnProperty.call(Element.prototype, 'animate')) {
      Object.defineProperty(HTMLElement.prototype, 'animate', { value: animate, configurable: true, writable: true });
      delete Element.prototype.animate;
    }
    const add = () => {
      if (document.getElementById('footage-clean')) return;
      const style = document.createElement('style');
      style.id = 'footage-clean';
      style.textContent = css;
      (document.head || document.documentElement).appendChild(style);
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', add); else add();
  }, CLEAN_CSS);
  await context.clock.install({ time: new Date(Date.now() + OFFSET) });
  return context;
}

/** Opens a path and waits, in real time, until the demo has started and its data has arrived. */
async function open(page, url, { text, settle = 1200 } = {}) {
  await page.goto(server.url + url);
  await page.waitForFunction(() => !document.querySelector('[data-demo-splash]') && (document.getElementById('root')?.children.length ?? 0) > 0, null, { timeout: 240_000 });
  if (text) await page.getByText(text).first().waitFor({ timeout: 60_000 });
  await page.waitForFunction(() => !document.querySelector('.animate-pulse'), null, { timeout: 20_000 }).catch(() => undefined);
  await loadImages(page);
  await page.waitForTimeout(settle);
}

/** Scrolls the whole page once off camera so every lazy photo is loaded before filming. */
async function preloadPage(page, selector) {
  await page.evaluate(async (sel) => {
    const el = sel ? document.querySelector(sel) : document.scrollingElement;
    const step = window.innerHeight * 0.8;
    for (let y = 0; y < el.scrollHeight; y += step) {
      el.scrollTop = y;
      await new Promise((r) => setTimeout(r, 120));
    }
    el.scrollTop = 0;
  }, selector);
  await loadImages(page, true);
}

async function loadImages(page, all = false) {
  await page.evaluate((everything) => Promise.all([...document.images]
    .filter((img) => !img.complete && (everything || img.getBoundingClientRect().top < window.innerHeight * 2))
    .map((img) => { img.loading = 'eager'; return new Promise((resolve) => { img.addEventListener('load', resolve, { once: true }); img.addEventListener('error', resolve, { once: true }); setTimeout(resolve, 6000); }); })), all).catch(() => undefined);
}

/** Staff screens ask for one tap before they may play sounds. Given off camera. */
async function allowSound(page) {
  await page.getByRole('button', { name: /Alerts are silent|Sound blocked|tap to enable/i }).first().click({ timeout: 2500 }).catch(() => undefined);
  await page.getByText(/Sound blocked|tap to enable/i).first().click({ timeout: 1500 }).catch(() => undefined);
}

// ------------------------------------------------------------------ easing
const ease = {
  inOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
  out: (t) => 1 - (1 - t) ** 3,
  outQuint: (t) => 1 - (1 - t) ** 5,
  inOutSine: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
};
const lerp = (a, b, t) => a + (b - a) * t;

// ------------------------------------------------------------------ in-page helpers (run every frame)
/** Installed into the filmed page: counts the demo's requests in flight and draws the pointer. */
function pageHelpers() {
  if (window.__footage) return;
  const state = { inflight: 0 };
  const wrap = () => {
    if (window.fetch.__footage) return;
    const inner = window.fetch;
    const counted = function (...args) {
      state.inflight += 1;
      let p;
      try { p = inner.apply(this, args); } catch (e) { state.inflight -= 1; throw e; }
      return Promise.resolve(p).finally(() => { state.inflight -= 1; });
    };
    counted.__footage = true;
    window.fetch = counted;
  };
  const layer = () => {
    let el = document.getElementById('footage-pointer');
    if (!el) {
      el = document.createElement('div');
      el.id = 'footage-pointer';
      el.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647;overflow:hidden;';
      document.documentElement.appendChild(el);
    }
    return el;
  };
  const CURSOR = 'data:image/svg+xml,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28">'
    + '<path d="M5 3.5v18.2l4.6-4.4 2.9 6.6 3.3-1.4-2.9-6.5h6.4z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>');
  window.__footage = {
    state,
    wrap,
    /** Moves every animation of this document and its same-origin frames on by dt ms. */
    advance(dt) {
      const docs = [document];
      for (const f of document.querySelectorAll('iframe')) { try { if (f.contentDocument) docs.push(f.contentDocument); } catch { /* cross-origin */ } }
      for (const doc of docs) {
        for (const a of doc.getAnimations()) {
          try {
            if (a.playState === 'idle') continue;
            const t = Number(a.currentTime) || 0;
            a.currentTime = t + dt * (a.playbackRate || 1);
          } catch { /* not seekable */ }
        }
      }
    },
    inflight() {
      let n = state.inflight;
      for (const f of document.querySelectorAll('iframe')) { try { n += f.contentWindow.__footage?.state.inflight ?? 0; } catch { /* cross-origin */ } }
      return n;
    },
    /** p: { kind, x, y, visible (0-1), press (0-1), ripples: [{x, y, t (0-1)}] } */
    draw(p) {
      const root = layer();
      if (p.kind === 'desktop') {
        let c = root.querySelector('.cur');
        if (!c) {
          c = document.createElement('div');
          c.className = 'cur';
          c.style.cssText = `position:absolute;left:0;top:0;width:28px;height:28px;background:url("${CURSOR}") no-repeat;filter:drop-shadow(0 1.5px 2.5px rgba(0,0,0,.35));transform-origin:5px 3.5px;`;
          root.appendChild(c);
        }
        c.style.opacity = String(p.visible);
        c.style.transform = `translate(${p.x - 5}px, ${p.y - 3.5}px) scale(${1 - 0.12 * p.press})`;
      } else {
        let dot = root.querySelector('.dot');
        if (!dot) {
          dot = document.createElement('div');
          dot.className = 'dot';
          dot.style.cssText = 'position:absolute;left:0;top:0;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;'
            + 'background:radial-gradient(circle, rgba(255,255,255,.55) 0%, rgba(255,255,255,.28) 60%, rgba(255,255,255,0) 72%);'
            + 'box-shadow:0 0 0 1.5px rgba(20,28,24,.28), 0 4px 14px rgba(0,0,0,.18);';
          root.appendChild(dot);
        }
        dot.style.opacity = String(p.visible);
        dot.style.transform = `translate(${p.x}px, ${p.y}px) scale(${1 - 0.18 * p.press})`;
      }
      const ripples = root.querySelectorAll('.rip');
      ripples.forEach((r, i) => { if (i >= p.ripples.length) r.remove(); });
      p.ripples.forEach((r, i) => {
        let el = root.querySelectorAll('.rip')[i];
        if (!el) {
          el = document.createElement('div');
          el.className = 'rip';
          el.style.cssText = 'position:absolute;left:0;top:0;width:64px;height:64px;margin:-32px 0 0 -32px;border-radius:50%;border:2px solid rgba(255,255,255,.9);box-shadow:0 0 0 1px rgba(20,28,24,.18);';
          root.appendChild(el);
        }
        el.style.transform = `translate(${r.x}px, ${r.y}px) scale(${0.35 + 0.9 * r.t})`;
        el.style.opacity = String((1 - r.t) * 0.85);
      });
    },
  };
}

/** Puts the helpers into a page and its frames (again after a reload). */
async function installHelpers(page) {
  for (const f of page.frames()) await f.evaluate(pageHelpers).catch(() => undefined);
  for (const f of page.frames()) await f.evaluate(() => window.__footage?.wrap()).catch(() => undefined);
}

// ------------------------------------------------------------------ the recorder
let server;

class Take {
  /**
   * @param name   clip name (file name without .mp4)
   * @param pages  pages filmed in this take: [{ page, kind, file? }]; the first is the clip itself
   * @param extra  pages that act but are not filmed (they share the clock)
   */
  constructor(name, pages, extra = []) {
    this.name = name;
    this.pages = pages;
    this.extra = extra;
    this.context = pages[0].page.context();
    this.frameNo = 0;
    this.pointer = { kind: pages[0].kind, x: KINDS[pages[0].kind].viewport.width * 0.62, y: KINDS[pages[0].kind].viewport.height * 0.7, visible: 0, press: 0, ripples: [] };
  }

  async start() {
    for (const page of [...this.pages.map((p) => p.page), ...this.extra]) await installHelpers(page);
    for (const p of this.pages) {
      p.cdp = await this.context.newCDPSession(p.page);
      await p.cdp.send('Animation.enable');
      await p.cdp.send('Animation.setPlaybackRate', { playbackRate: 0 });
      p.file = p.file ?? path.join(OUT, `${this.name}.mp4`);
      p.enc = encoder(p.file);
    }
    // filming runs slower than real time, so the page's clock falls behind the database worker's: catch it up
    const t = await this.pages[0].page.evaluate(() => Date.now());
    const worker = Date.now() + OFFSET;
    if (worker > t + 50) await this.context.clock.fastForward(worker - t);
    // the clock is still running here: pause a little ahead of where it has got to
    const now = await this.pages[0].page.evaluate(() => Date.now());
    await this.context.clock.pauseAt(new Date(now + 250));
    this.started = Date.now();
    console.log(`  ● ${this.name}`);
  }

  /** One frame: time moves on 1/fps, the page settles, the pointer is drawn, the screenshot is taken. */
  async frame() {
    const dt = Math.round(((this.frameNo + 1) * 1000) / FPS) - Math.round((this.frameNo * 1000) / FPS);
    for (const p of this.pages) await p.page.evaluate((d) => window.__footage?.advance(d), dt).catch(() => undefined);
    await this.context.clock.runFor(dt);
    await this.settle();
    this.tickPointer(dt);
    const pp = this.pages[0];
    await pp.page.evaluate((ptr) => window.__footage?.draw(ptr), this.pointer).catch(() => undefined);
    for (const p of this.pages) {
      const buf = await this.capture(p);
      if (process.env.FOOTAGE_DEBUG && this.frameNo % 60 === 0) {
        writeFileSync(path.join(OUT, `${this.name}-dbg-${this.frameNo}.jpg`), buf);
        await p.page.screenshot({ path: path.join(OUT, `${this.name}-dbg-${this.frameNo}-pw.png`) }).catch((e) => console.log('pw shot', e.message));
        console.log('dbg', this.frameNo, JSON.stringify(await p.page.evaluate(() => document.body.innerText.slice(0, 80))));
      }
      await p.enc.write(buf);
    }
    this.frameNo += 1;
  }

  /**
   * One frame of one filmed page, at the page's pixel density. Playwright's
   * own screenshot, which takes care of the scroll offset (a raw CDP clip is
   * in document coordinates and has to follow the scroll by hand, as below).
   */
  async capture(p) {
    if (p.scale && Math.abs(p.scale - (await p.page.evaluate(() => devicePixelRatio))) > 0.01) {
      // a page filmed sharper than its context's density (the phone in a desktop context)
      const vp = p.page.viewportSize();
      const at = await p.page.evaluate(() => ({ x: window.visualViewport?.pageLeft ?? window.scrollX, y: window.visualViewport?.pageTop ?? window.scrollY }));
      const shot = await p.cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 94, captureBeyondViewport: false, clip: { x: at.x, y: at.y, width: vp.width, height: vp.height, scale: p.scale } });
      return Buffer.from(shot.data, 'base64');
    }
    return p.page.screenshot({ type: 'jpeg', quality: 94, scale: 'device', animations: 'allow', caret: 'initial', timeout: 30_000 });
  }

  /** Waits (in real time, invisible in the film) for the demo to answer every request, and for photos on screen. */
  async settle() {
    for (const page of [...this.pages.map((p) => p.page), ...this.extra]) {
      const t0 = Date.now();
      for (;;) {
        const busy = await page.evaluate(() => {
          if (!window.__footage) return 0;
          window.__footage.wrap();
          const imgs = [...document.images].filter((img) => !img.complete && img.getBoundingClientRect().bottom > 0 && img.getBoundingClientRect().top < innerHeight).length;
          return window.__footage.inflight() + imgs;
        }).catch(() => 0);
        if (!busy || Date.now() - t0 > 8000) break;
        await sleep(4);
      }
      // let the answers render (React schedules with MessageChannel, which the fake clock does not hold back)
      await page.evaluate(async () => { for (let i = 0; i < 3; i += 1) await new Promise((r) => { const c = new MessageChannel(); c.port1.onmessage = () => r(); c.port2.postMessage(0); }); }).catch(() => undefined);
    }
  }

  tickPointer(dt) {
    const p = this.pointer;
    if (this.fade) {
      this.fade.t += dt;
      const k = Math.min(1, this.fade.t / this.fade.ms);
      p.visible = lerp(this.fade.from, this.fade.to, ease.inOutSine(k));
      if (k >= 1) this.fade = null;
    }
    p.ripples = p.ripples.map((r) => ({ ...r, t: r.t + dt / 520 })).filter((r) => r.t < 1);
  }

  async frames(n) { for (let i = 0; i < n; i += 1) await this.frame(); }
  async hold(ms) { await this.frames(Math.max(1, Math.round((ms * FPS) / 1000))); }

  /** Steps frames until fn() (run in Node) is true; at most maxMs of film. */
  async until(fn, maxMs = 4000) {
    const max = Math.round((maxMs * FPS) / 1000);
    for (let i = 0; i < max; i += 1) {
      if (await fn().catch(() => false)) return true;
      await this.frame();
    }
    return false;
  }

  showPointer(ms = 220) { this.fade = { from: this.pointer.visible, to: 1, t: 0, ms }; }
  hidePointer(ms = 260) { this.fade = { from: this.pointer.visible, to: 0, t: 0, ms }; }

  async box(target, page = this.pages[0].page) {
    if (typeof target === 'object' && 'x' in target && 'y' in target && !('locator' in target)) return { x: target.x, y: target.y, width: 0, height: 0 };
    let box = null;
    for (let i = 0; i < 6 && !box; i += 1) {
      box = await target.boundingBox({ timeout: 3000 }).catch(() => null);
      if (!box) await this.frame();
    }
    if (!box) throw new Error(`${this.name}: nothing to tap (${target})`);
    return box;
  }

  /** Glides the pointer to (x, y) over ms with an ease and a slight arc (desktop). */
  async moveTo(x, y, ms) {
    const p = this.pointer;
    const sx = p.x;
    const sy = p.y;
    const dist = Math.hypot(x - sx, y - sy);
    const dur = ms ?? Math.min(820, Math.max(380, 260 + dist * 0.55));
    const n = Math.max(1, Math.round((dur * FPS) / 1000));
    const bow = Math.min(40, dist * 0.08);
    for (let i = 1; i <= n; i += 1) {
      const t = ease.inOut(i / n);
      p.x = lerp(sx, x, t) + Math.sin(Math.PI * t) * bow * 0.35;
      p.y = lerp(sy, y, t) - Math.sin(Math.PI * t) * bow;
      if (p.kind === 'desktop' && i % 3 === 0) await this.pages[0].page.mouse.move(p.x, p.y);
      await this.frame();
    }
    if (p.kind === 'desktop') await this.pages[0].page.mouse.move(x, y);
  }

  /**
   * A tap (phone) or click (desktop) on a locator or {x, y}: the pointer comes,
   * presses, the real input event fires, the pointer lets go.
   */
  async tap(target, { after = 380, dx = 0, dy = 0, page } = {}) {
    const pg = page ?? this.pages[0].page;
    let b = await this.box(target, pg);
    // out of view: scroll it in first, the way a person would
    const vh = pg.viewportSize().height;
    if (pg === this.pages[0].page && b.height && (b.y < 0 || b.y + b.height > vh)) {
      const sy = await pg.evaluate(() => window.scrollY);
      const max = await pg.evaluate(() => document.scrollingElement.scrollHeight - innerHeight);
      const to = Math.max(0, Math.min(max, sy + b.y - vh * 0.4));
      if (Math.abs(to - sy) > 4) {
        await this.scrollTo(to, Math.min(1100, 450 + Math.abs(to - sy) * 0.5), { curve: 'inOut' });
        await this.hold(150);
        b = await this.box(target, pg);
      }
    }
    const x = b.x + b.width / 2 + dx;
    const y = b.y + b.height / 2 + dy;
    const p = this.pointer;
    if (p.kind === 'desktop') {
      if (p.visible < 1) this.showPointer(200);
      await this.moveTo(x, y);
      await this.hold(90);
    } else {
      p.x = x; p.y = y;
      this.showPointer(110);
      await this.hold(150);
    }
    for (const k of [0.5, 1]) { p.press = k; await this.frame(); }
    if (p.kind === 'desktop' || this.pages[0].touch === false) await pg.mouse.click(x, y);
    else await pg.touchscreen.tap(x, y);
    p.ripples.push({ x, y, t: 0 });
    for (const k of [0.6, 0.25, 0]) { p.press = k; await this.frame(); }
    if (p.kind !== 'desktop') this.hidePointer(240);
    await this.hold(after);
  }

  /** Types like a person: one character every ~90 ms with a little rhythm. */
  async type(text, page = this.pages[0].page) {
    const rhythm = [85, 110, 70, 95, 120, 80];
    for (let i = 0; i < text.length; i += 1) {
      await page.keyboard.type(text[i]);
      await this.hold(rhythm[i % rhythm.length]);
    }
  }

  /**
   * Scrolls the page (or an element) to y with an ease. On a phone the finger
   * is shown dragging for the first part of the move, like a real swipe.
   */
  async scrollTo(y, ms = 900, { selector, curve = 'inOut', finger = true } = {}) {
    const page = this.pages[0].page;
    const from = await page.evaluate((sel) => (sel ? document.querySelector(sel).scrollTop : window.scrollY), selector);
    const n = Math.max(1, Math.round((ms * FPS) / 1000));
    const p = this.pointer;
    const vp = KINDS[p.kind].viewport;
    const showFinger = finger && p.kind === 'phone';
    const fx = vp.width * 0.58;
    const fy0 = vp.height * 0.72;
    if (showFinger) { p.x = fx; p.y = fy0; this.showPointer(90); }
    for (let i = 1; i <= n; i += 1) {
      const t = ease[curve](i / n);
      const top = lerp(from, y, t);
      await page.evaluate(([sel, v]) => { if (sel) document.querySelector(sel).scrollTop = v; else window.scrollTo(0, v); }, [selector, top]);
      if (showFinger) {
        const k = Math.min(1, (i / n) / 0.42);
        p.y = fy0 - Math.min(vp.height * 0.45, Math.abs(y - from) * 0.55) * Math.sign(y - from) * ease.out(k);
        if (i === Math.round(n * 0.4)) this.hidePointer(200);
      }
      await this.frame();
    }
  }

  async end() {
    for (const p of this.pages) await p.enc.end();
    await this.context.clock.resume();
    for (const p of this.pages) {
      await p.cdp.send('Animation.setPlaybackRate', { playbackRate: 1 }).catch(() => undefined);
      await p.cdp.detach().catch(() => undefined);
      await p.page.evaluate(() => document.getElementById('footage-pointer')?.remove()).catch(() => undefined);
    }
    const info = this.pages.map((p) => ({ file: p.file, ...probe(p.file) }));
    for (const i of info) console.log(`    ${path.basename(i.file)}  ${i.width}x${i.height}  ${i.seconds.toFixed(2)} s  (${Math.round((Date.now() - this.started) / 1000)} s to film)`);
    return info;
  }
}

// ------------------------------------------------------------------ the clips
/*
 * Each clip: name (file name), viewport (for the README), what (one line),
 * and film(env), which prepares off camera, then films a Take and returns its info.
 * Guest clips share one phone (one guest at table 5) and run in order:
 * open → scroll → add → send → languages.
 */
const GUEST = { page: null };

/** The guest's phone, at the menu or a step before it. Menu photos are loaded once, off camera. */
async function guestPhone({ ctx }) {
  if (GUEST.page) return GUEST.page;
  const context = await ctx('phone');
  const page = await context.newPage();
  await open(page, '/menu/casademo/', { text: 'Our picks' });
  await preloadPage(page);
  GUEST.page = page;
  return page;
}

const menuTop = async (page) => { await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(300); };

// ------------------------------------------------------------------ shared stage-setting (off camera)
const ADMIN = { page: null };
const KITCHEN = { page: null };

/** Every admin page a clip visits: opened once in one document, so each page's code is loaded before filming. */
const ADMIN_ROUTES = ['/admin', '/admin/analytics', '/admin/menu-intelligence', '/admin/reports', '/admin/reservations', '/admin/audit', '/admin/qr-codes', '/admin/tonight'];

/** Client-side navigation, as a click on a link would do: no reload. */
async function goSpa(page, to) {
  await page.evaluate((path) => { window.history.pushState({}, '', path); window.dispatchEvent(new PopStateEvent('popstate')); }, to);
  await page.waitForTimeout(400);
  await page.waitForFunction(() => !document.querySelector('.animate-pulse, .animate-spin'), null, { timeout: 30_000 }).catch(() => undefined);
}

async function adminPage({ ctx }, start) {
  if (!ADMIN.page) {
    const context = await ctx('desktop');
    ADMIN.page = await context.newPage();
    await open(ADMIN.page, '/admin', { text: "Today's Revenue" });
    for (const route of ADMIN_ROUTES) { await goSpa(ADMIN.page, route); await ADMIN.page.waitForTimeout(1500); }
  }
  const page = ADMIN.page;
  await goSpa(page, start);
  await page.waitForTimeout(1500);
  await loadImages(page);
  const sel = await scroller(page);
  await page.evaluate((s) => { if (s) document.querySelector(s).scrollTop = 0; else window.scrollTo(0, 0); }, sel);
  await page.mouse.move(980, 520);
  await page.waitForTimeout(600);
  if (process.env.FOOTAGE_DEBUG) await page.screenshot({ path: path.join(OUT, `admin-pre-${start.replace(/[^a-z]/gi, '_')}.png`) });
  return page;
}

/** The element the page scrolls in (marked for the recorder), or null when it is the window. */
async function scroller(page) {
  return page.evaluate(() => {
    const doc = document.scrollingElement;
    if (doc.scrollHeight > window.innerHeight + 20) return null;
    let best = null;
    for (const el of document.querySelectorAll('main, div, section')) {
      const cs = getComputedStyle(el);
      if (!/(auto|scroll)/.test(cs.overflowY) || el.scrollHeight <= el.clientHeight + 20) continue;
      if (!best || el.clientHeight * el.clientWidth > best.clientHeight * best.clientWidth) best = el;
    }
    if (!best) return null;
    document.querySelectorAll('[data-footage-scroll]').forEach((e) => e.removeAttribute('data-footage-scroll'));
    best.setAttribute('data-footage-scroll', '');
    return '[data-footage-scroll]';
  });
}

/** The TV's "Full screen" offer shows only until the board fills the screen, which it does on a real TV. */
async function hideFullScreenOffer(page) {
  await page.addStyleTag({ content: 'button:has(svg.lucide-maximize) { display: none !important; }' });
  await page.waitForTimeout(300);
}

async function kitchenPage({ ctx }) {
  if (!KITCHEN.page) {
    const context = await ctx('desktop');
    KITCHEN.page = await context.newPage();
    await open(KITCHEN.page, '/kitchen', { text: 'Kitchen & Bar' });
    await allowSound(KITCHEN.page);
  }
  // the last clip's taps leave a 90-second "Undo" in the header: let it run out
  await KITCHEN.page.context().clock.fastForward(95_000);
  await KITCHEN.page.mouse.move(1100, 600);
  await KITCHEN.page.waitForTimeout(500);
  return KITCHEN.page;
}

/**
 * Makes room on the kitchen board so a new ticket stays in view as it moves
 * across (every column is oldest first): NEW and PREPARING are cleared, one
 * ticket stays in READY. Then the page's clock runs on 95 s off camera, so the
 * "served · Undo" toasts these taps leave behind are gone before filming.
 */
async function quietBoard(kitchen) {
  const cards = () => kitchen.locator('div.rounded-xl.border.bg-card');
  for (let round = 0; round < 30; round += 1) {
    const kinds = await cards().evaluateAll((els) => els.map((el) => {
      const text = [...el.querySelectorAll('button')].map((b) => b.textContent.trim());
      return text.some((t) => /^Start all/.test(t)) ? 'new' : text.some((t) => /^All ready/.test(t)) ? 'prep' : text.some((t) => /Mark served/.test(t)) ? 'ready' : 'other';
    }));
    const act = (() => {
      const firstNew = kinds.indexOf('new');
      if (firstNew >= 0) return { i: firstNew, button: /^All ready/ };
      const prep = kinds.map((k, i) => (k === 'prep' ? i : -1)).filter((i) => i >= 0);
      if (prep.length) return { i: prep[0], button: /^All ready/ };
      const ready = kinds.map((k, i) => (k === 'ready' ? i : -1)).filter((i) => i >= 0);
      if (ready.length > 1) return { i: ready[1], button: /Mark served/ };
      return null;
    })();
    if (!act) break;
    await cards().nth(act.i).getByRole('button', { name: act.button }).first().click({ timeout: 5000 }).catch(() => undefined);
    await kitchen.waitForTimeout(900);
  }
  await kitchen.evaluate(() => window.scrollTo(0, 0));
  await kitchen.context().clock.fastForward(95_000);
  await kitchen.waitForTimeout(1500);
}

/** A second tab in the same restaurant: a guest at a table with two dishes in the order, the payment choice open. */
async function guestOrderReady(context, table, name, { stopAt = 'checkout' } = {}) {
  const page = await context.newPage();
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, '/menu/casademo/', { text: 'Our picks' });
  await preloadPage(page);
  await open(page, guestTablePath(table));
  await page.getByPlaceholder(/name/i).fill(name);
  await page.getByRole('button', { name: /continue/i }).click();
  await page.getByText('Our picks').first().waitFor({ timeout: 60_000 });
  await page.getByRole('heading', { name: 'Mains' }).first().click();
  await page.getByRole('button', { name: 'Add Truffle Risotto to order' }).first().click();
  await page.waitForTimeout(700);
  await page.getByRole('button', { name: 'Add Casa Burger to order' }).first().click();
  await page.waitForTimeout(900);
  await page.getByRole('button', { name: /View Order/ }).click();
  await page.getByRole('button', { name: /Send order/ }).waitFor({ timeout: 30_000 });
  await loadImages(page, true);
  if (stopAt === 'checkout') {
    await page.getByRole('button', { name: /Send order/ }).click();
    await page.getByRole('button', { name: /^Cash/ }).waitFor({ timeout: 30_000 });
  }
  await page.waitForTimeout(800);
  return page;
}

/** Rounded masks, a phone bezel and a soft-shadowed background for the side-by-side shot, drawn with sharp. */
async function compositeAssets(dir, L) {
  const sharp = (await import('sharp')).default;
  const svg = (w, h, body) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${body}</svg>`);
  const files = {
    bg: path.join(dir, 'bg.png'), kmask: path.join(dir, 'kmask.png'), pmask: path.join(dir, 'pmask.png'), bezel: path.join(dir, 'bezel.png'),
  };
  await sharp(svg(2560, 1440, `
    <defs><radialGradient id="g" cx="35%" cy="30%" r="90%"><stop offset="0" stop-color="#3a5244"/><stop offset="1" stop-color="#1c2620"/></radialGradient>
    <filter id="s" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="28"/></filter></defs>
    <rect width="2560" height="1440" fill="url(#g)"/>
    <rect x="${L.kx}" y="${L.ky + 24}" width="${L.kw}" height="${L.kh}" rx="26" fill="#000" opacity=".45" filter="url(#s)"/>
    <rect x="${L.px - L.b}" y="${L.py - L.b + 30}" width="${L.pw + 2 * L.b}" height="${L.ph + 2 * L.b}" rx="${L.pr + L.b}" fill="#000" opacity=".55" filter="url(#s)"/>`)).png().toFile(files.bg);
  await sharp(svg(L.kw, L.kh, `<rect width="${L.kw}" height="${L.kh}" fill="#000"/><rect width="${L.kw}" height="${L.kh}" rx="22" fill="#fff"/>`)).png().toFile(files.kmask);
  await sharp(svg(L.pw, L.ph, `<rect width="${L.pw}" height="${L.ph}" fill="#000"/><rect width="${L.pw}" height="${L.ph}" rx="${L.pr}" fill="#fff"/>`)).png().toFile(files.pmask);
  const W = L.pw + 2 * L.b;
  const H = L.ph + 2 * L.b;
  await sharp(svg(W, H, `
    <defs><mask id="m"><rect width="${W}" height="${H}" fill="#fff"/><rect x="${L.b}" y="${L.b}" width="${L.pw}" height="${L.ph}" rx="${L.pr}" fill="#000"/></mask></defs>
    <rect width="${W}" height="${H}" rx="${L.pr + L.b}" fill="#121614" mask="url(#m)"/>
    <rect x="2" y="2" width="${W - 4}" height="${H - 4}" rx="${L.pr + L.b - 2}" fill="none" stroke="#4b524e" stroke-width="3"/>
    <rect x="${W / 2 - 62}" y="${L.b + 16}" width="124" height="34" rx="17" fill="#060606"/>`)).png().toFile(files.bezel);
  return files;
}

const CLIPS = [
  {
    name: 'guest-open',
    viewport: 'phone 390×844 @3x',
    what: 'The guest scans table 5: the welcome screen asks only their name; they type it and the menu opens.',
    async film(env) {
      const page = await guestPhone(env);
      await open(page, guestTablePath(5));
      const nameBox = page.getByPlaceholder(/name/i);
      await nameBox.waitFor({ timeout: 60_000 });
      await page.waitForTimeout(800);
      const take = new Take('guest-open', [{ page, kind: 'phone' }]);
      await take.start();
      await take.hold(700);
      await take.tap(nameBox, { after: 250 });
      await take.type('Lejla');
      await take.hold(300);
      await take.tap(page.getByRole('button', { name: /continue/i }), { after: 200 });
      await take.until(() => page.getByText('Our picks').first().isVisible(), 3000);
      await take.hold(2200);
      return take.end();
    },
  },
  {
    name: 'guest-scroll',
    viewport: 'phone 390×844 @3x',
    what: 'A smooth scroll down the menu: featured dishes, offers, new arrivals, then each category shown by its own photographs.',
    async film(env) {
      const page = await guestPhone(env);
      if (!/\/menu\/casademo\/?$/.test(new URL(page.url()).pathname)) await open(page, '/menu/casademo/', { text: 'Our picks' });
      await menuTop(page);
      const take = new Take('guest-scroll', [{ page, kind: 'phone' }]);
      await take.start();
      await take.hold(450);
      await take.scrollTo(560, 1050, { curve: 'out' });
      await take.hold(350);
      await take.scrollTo(1350, 1150, { curve: 'out' });
      await take.hold(350);
      await take.scrollTo(2250, 1200, { curve: 'out' });
      await take.hold(700);
      return take.end();
    },
  },
  {
    name: 'guest-add',
    viewport: 'phone 390×844 @3x',
    what: 'In Mains the guest taps Truffle Risotto: the dish opens with its photo, allergens and price; "Add to order" — the order bar springs up with the total.',
    async film(env) {
      const page = await guestPhone(env);
      await open(page, '/menu/casademo/', { text: 'Our picks' });
      await page.getByRole('heading', { name: 'Mains' }).first().click();
      await page.getByRole('button', { name: 'Truffle Risotto', exact: true }).first().waitFor({ timeout: 30_000 });
      await loadImages(page, true);
      await page.waitForTimeout(800);
      const take = new Take('guest-add', [{ page, kind: 'phone' }]);
      await take.start();
      await take.hold(600);
      await take.tap(page.getByRole('button', { name: 'Truffle Risotto', exact: true }).first(), { after: 900 });
      await take.tap(page.getByRole('button', { name: /Add to order/ }).last(), { after: 1500 });
      return take.end();
    },
  },
  {
    name: 'guest-send',
    viewport: 'phone 390×844 @3x',
    what: 'The order bar → the order with a suggestion → "Send order" → pay at the table in cash → "Order sent to the kitchen" with its number and ready time.',
    async film(env) {
      const page = await guestPhone(env);
      // a second dish, off camera, so the order is a real dinner
      const burger = page.getByRole('button', { name: 'Add Casa Burger to order' });
      if (await burger.count()) await burger.first().click();
      await page.waitForTimeout(900);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(400);
      const take = new Take('guest-send', [{ page, kind: 'phone' }]);
      await take.start();
      await take.hold(500);
      await take.until(() => page.getByRole('button', { name: /View Order/ }).isVisible(), 3000);
      await take.tap(page.getByRole('button', { name: /View Order/ }), { after: 1100 });
      await take.tap(page.getByRole('button', { name: /Send order/ }), { after: 900 });
      await take.tap(page.getByRole('button', { name: /^Cash/ }), { after: 300 });
      await take.until(() => page.getByText(/Order sent/i).first().isVisible(), 4000);
      await take.hold(2000);
      return take.end();
    },
  },
  {
    name: 'guest-languages',
    viewport: 'phone 390×844 @3x',
    what: 'The same menu in three languages: Bosnian → English → Arabic (the page turns right to left).',
    async film(env) {
      const page = await guestPhone(env);
      await page.evaluate(() => { const k = Object.keys(localStorage).find((x) => /lang|locale/i.test(x)); if (k) localStorage.setItem(k, localStorage.getItem(k).replace(/"(en|ar)"/, '"bs"')); });
      await open(page, '/menu/casademo/', { text: /Naš izbor|Our picks/ });
      const lang = () => page.getByRole('button', { name: /Change language|Promijeni jezik|تغيير اللغة/ }).first();
      if (!(await lang().getAttribute('aria-label')).includes('Bosanski')) {
        await lang().click(); await page.getByRole('menuitem', { name: 'Bosanski' }).click(); await page.waitForTimeout(800);
      }
      await loadImages(page, true);
      await page.waitForTimeout(600);
      const take = new Take('guest-languages', [{ page, kind: 'phone' }]);
      await take.start();
      await take.hold(1300);
      await take.tap(lang(), { after: 450 });
      await take.tap(page.getByRole('menuitem', { name: 'English' }), { after: 1500 });
      await take.tap(lang(), { after: 450 });
      await take.tap(page.getByRole('menuitem', { name: 'العربية' }), { after: 1900 });
      const info = await take.end();
      // back to English for the next clips
      await lang().click(); await page.getByRole('menuitem', { name: 'English' }).click(); await page.waitForTimeout(500);
      return info;
    },
  },
  // ---------------------------------------------------------------- kitchen
  {
    name: 'kitchen-new-order',
    viewport: 'desktop 1600×900 @1.6 → 2560×1440',
    what: 'The kitchen display during service: a guest at table 5 sends an order from their phone (another tab, same restaurant) and the ticket drops into NEW; the cook taps "Start all", then "All ready".',
    async film(env) {
      const context = await env.ctx('desktop');
      const kitchen = await kitchenPage(env);
      const guest = await guestOrderReady(context, 5, 'Mia');
      await quietBoard(kitchen);
      const ticket = () => kitchen.locator('div.rounded-xl.border.bg-card').filter({ hasText: /Table 5(?!\d)/ }).first();
      const take = new Take('kitchen-new-order', [{ page: kitchen, kind: 'desktop' }], [guest]);
      await take.start();
      await take.hold(900);
      const cash = await guest.getByRole('button', { name: /^Cash/ }).boundingBox();
      await guest.mouse.click(cash.x + cash.width / 2, cash.y + cash.height / 2);
      await take.until(() => ticket().isVisible(), 5000);
      await take.hold(1300);
      await take.tap(ticket().getByRole('button', { name: /Start all/ }), { after: 1100 });
      await take.tap(ticket().getByRole('button', { name: /All ready/ }), { after: 1500 });
      take.hidePointer(300);
      await take.hold(400);
      await guest.close();
      return take.end();
    },
  },
  {
    name: 'kitchen-bar-split',
    viewport: 'desktop 1600×900 @1.6 → 2560×1440',
    what: 'One board, two stations: the cook switches from All to Bar (only drinks) to Kitchen (only food) and back.',
    async film(env) {
      const kitchen = await kitchenPage(env);
      const station = (label) => kitchen.locator('button').filter({ hasText: new RegExp(`^\\s*${label}\\s*$`) }).first();
      const take = new Take('kitchen-bar-split', [{ page: kitchen, kind: 'desktop' }]);
      await take.start();
      await take.hold(700);
      await take.tap(station('Bar'), { after: 1500 });
      await take.tap(station('Kitchen'), { after: 1500 });
      await take.tap(station('All'), { after: 900 });
      take.hidePointer(300);
      await take.hold(400);
      return take.end();
    },
  },
  // ---------------------------------------------------------------- waiter
  {
    name: 'waiter-attention',
    viewport: 'phone 390×844 @3x',
    what: 'The waiter’s phone: a table’s food is ready to run — "Mark served"; then the table that asked for the bill pays in cash, one tap and a confirmation.',
    async film(env) {
      const context = await env.ctx('phone');
      const page = await context.newPage();
      await open(page, '/waiter', { text: /Attention needed|My tables/ });
      await allowSound(page);
      await page.waitForTimeout(800);
      const serve = page.getByRole('button', { name: /Mark served/ }).first();
      if (!(await serve.count())) throw new Error('no table is ready to run right now');
      const take = new Take('waiter-attention', [{ page, kind: 'phone' }]);
      await take.start();
      await take.hold(900);
      await take.tap(serve, { after: 1100 });
      // a table that owes: its Cash button, then the confirmation ("Yes, 58.00 KM received")
      const billCash = page.locator('xpath=//*[contains(normalize-space(.),"Wants the bill") and not(.//*[contains(normalize-space(.),"Wants the bill")])]/following::button[normalize-space(.)="Cash"][1]');
      await take.tap((await billCash.count()) ? billCash.first() : page.getByRole('button', { name: /^Cash$/ }).first(), { after: 600 });
      await take.tap(page.getByRole('button', { name: /^Yes,|received$/ }).first(), { after: 1600 });
      const info = await take.end();
      await page.close();
      return info;
    },
  },
  // ---------------------------------------------------------------- admin
  {
    name: 'admin-dashboard',
    viewport: 'desktop 1600×900 @1.6 → 2560×1440',
    what: 'The owner opens the dashboard: today’s revenue, orders, tables and calls, the three things most worth doing next, then down to "Is today normal?" and service times.',
    async film(env) {
      const page = await adminPage(env, '/admin/tonight');
      const take = new Take('admin-dashboard', [{ page, kind: 'desktop' }]);
      await take.start();
      await take.hold(500);
      await take.tap(page.getByRole('link', { name: 'Dashboard', exact: true }), { after: 1600 });
      await take.moveTo(980, 520, 700);
      await take.scrollTo(820, 1600, { selector: await scroller(page) });
      await take.hold(900);
      await take.scrollTo(1450, 1400, { selector: await scroller(page) });
      await take.hold(800);
      return take.end();
    },
  },
  {
    name: 'admin-analytics',
    viewport: 'desktop 1600×900 @1.6 → 2560×1440',
    what: 'Analytics: why sales moved against last week; the charts draw in and the pointer hovers a day to read its sales.',
    async film(env) {
      const page = await adminPage(env, '/admin');
      const take = new Take('admin-analytics', [{ page, kind: 'desktop' }]);
      await take.start();
      await take.hold(400);
      await take.tap(page.getByRole('link', { name: 'Analytics', exact: true }), { after: 700 });
      await take.scrollTo(560, 1300, { selector: await scroller(page) });
      await take.hold(600);
      const bars = page.locator('.recharts-bar-rectangle');
      const n = await bars.count();
      for (const i of n ? [Math.max(0, n - 3), n - 1] : []) {
        const b = await bars.nth(i).boundingBox();
        if (b) { await take.moveTo(b.x + b.width / 2, b.y + Math.min(40, b.height / 2)); await take.hold(1000); }
      }
      await take.hold(400);
      return take.end();
    },
  },
  {
    name: 'admin-intelligence',
    viewport: 'desktop 1600×900 @1.6 → 2560×1440',
    what: 'Menu intelligence: what is worth acting on (KM a week) and what the suggestions earn; then the menu-engineering matrix, every dish a star, plowhorse, puzzle or dog.',
    async film(env) {
      const page = await adminPage(env, '/admin/menu-intelligence');
      const take = new Take('admin-intelligence', [{ page, kind: 'desktop' }]);
      await take.start();
      await take.hold(1200);
      await take.tap(page.getByRole('tab', { name: 'Menu' }).or(page.getByRole('button', { name: 'Menu', exact: true })).first(), { after: 900 });
      await take.scrollTo(330, 1200, { selector: await scroller(page) });
      await take.hold(500);
      const dots = page.locator('.recharts-scatter-symbol');
      const n = await dots.count();
      if (n) {
        const b = await dots.nth(Math.floor(n * 0.8)).boundingBox();
        if (b) { await take.moveTo(b.x + b.width / 2, b.y + b.height / 2); await take.hold(1300); }
      }
      await take.hold(400);
      return take.end();
    },
  },
  {
    name: 'admin-forecast-report',
    viewport: 'desktop 1600×900 @1.6 → 2560×1440',
    what: 'The daily report: gross sales by payment method and what is still owed, then down to tomorrow’s prep list per dish (forecast from the same weekdays).',
    async film(env) {
      const page = await adminPage(env, '/admin/reports');
      const sel = await scroller(page);
      const take = new Take('admin-forecast-report', [{ page, kind: 'desktop' }]);
      await take.start();
      await take.hold(900);
      const target = await page.evaluate((s) => {
        const el = [...document.querySelectorAll('h2,h3,p,span')].find((e) => /^Prep for /.test(e.textContent.trim()));
        const box = s ? document.querySelector(s) : document.scrollingElement;
        return el ? el.getBoundingClientRect().top + box.scrollTop - 90 : box.scrollHeight;
      }, sel);
      await take.moveTo(1000, 560, 600);
      await take.scrollTo(target, 2600, { selector: sel });
      await take.hold(700);
      await take.scrollTo(target + 330, 1200, { selector: sel });
      await take.hold(900);
      return take.end();
    },
  },
  // ---------------------------------------------------------------- reservations
  {
    name: 'reservations-guest',
    viewport: 'phone 390×844 @3x',
    what: 'A guest books a table on the restaurant’s site: tomorrow, 20:00, four people, name and phone, "Send" — the request page answers.',
    async film(env) {
      const context = await env.ctx('phone');
      const page = await context.newPage();
      await open(page, '/reserve', { text: /Reserve a table/ });
      const take = new Take('reservations-guest', [{ page, kind: 'phone' }]);
      await take.start();
      await take.hold(600);
      await take.tap(page.locator('[role=radiogroup][aria-labelledby=reserve-day-label] [role=radio]').nth(1), { after: 400 });
      await take.tap(page.locator('[role=radiogroup][aria-labelledby=reserve-time-label] [role=radio][data-value="20:00"]'), { after: 350 });
      await take.tap(page.locator('[role=radiogroup][aria-labelledby=reserve-party-label] [role=radio][data-value="4"]'), { after: 300 });
      const nameBox = page.locator('#reserve-name');
      const box = await nameBox.boundingBox();
      await take.scrollTo((await page.evaluate(() => window.scrollY)) + box.y - 300, 900, { curve: 'out' });
      await take.tap(nameBox, { after: 150 });
      await take.type('Selma Hadžić');
      await take.tap(page.locator('#reserve-phone'), { after: 150 });
      await take.type('061 234 567');
      const send = page.locator('button[type=submit]');
      const sb = await send.boundingBox();
      if (sb.y > 760) await take.scrollTo((await page.evaluate(() => window.scrollY)) + sb.y - 520, 800, { curve: 'out' });
      await take.tap(send, { after: 300 });
      await take.until(() => Promise.resolve(page.url().includes('/reservation/')), 4000);
      await take.hold(2000);
      const info = await take.end();
      await page.close();
      return info;
    },
  },
  {
    name: 'reservations-admin',
    viewport: 'desktop 1600×900 @1.6 → 2560×1440',
    what: 'The manager’s Reservations page: requests waiting for an answer; one tap on "Confirm" and the request moves to Confirmed (the guest’s page updates on its own).',
    async film(env) {
      const page = await adminPage(env, '/admin/reservations');
      const confirm = page.getByRole('button', { name: /^Confirm$/ }).first();
      if (!(await confirm.count())) throw new Error('no reservation is waiting');
      const take = new Take('reservations-admin', [{ page, kind: 'desktop' }]);
      await take.start();
      await take.hold(1100);
      await take.tap(confirm, { after: 1800 });
      take.hidePointer(300);
      await take.hold(500);
      return take.end();
    },
  },
  // ---------------------------------------------------------------- tv, audit, qr
  {
    name: 'tv-menu',
    viewport: 'TV 1600×900 @1.6 → 2560×1440',
    what: 'The TV menu board at the entrance (landscape): a section with photos and prices and the QR code, then the board turns to the next section.',
    async film(env) {
      const context = await env.ctx('tv');
      const page = await context.newPage();
      await open(page, '/tv?every=4', { settle: 2500 });
      await hideFullScreenOffer(page);
      const take = new Take('tv-menu', [{ page, kind: 'tv' }]);
      await take.start();
      await take.hold(8500);
      const info = await take.end();
      await page.close();
      return info;
    },
  },
  {
    name: 'tv-menu-portrait',
    viewport: 'TV portrait 1080×1920 @4/3 → 1440×2560',
    what: 'The same TV board on a portrait screen, the way it is meant to hang: two sections with photos and prices, crossfading.',
    async film(env) {
      const context = await env.ctx('tvPortrait');
      const page = await context.newPage();
      await open(page, '/tv?every=4', { settle: 2500 });
      await hideFullScreenOffer(page);
      const take = new Take('tv-menu-portrait', [{ page, kind: 'tvPortrait' }]);
      await take.start();
      await take.hold(8500);
      const info = await take.end();
      await page.close();
      return info;
    },
  },
  {
    name: 'audit-log',
    viewport: 'desktop 1600×900 @1.6 → 2560×1440',
    what: 'The audit log: every action that touched money or an order, who and when, append-only — scrolling, then "Money" to see payments and refunds, and one entry opened.',
    async film(env) {
      const page = await adminPage(env, '/admin/audit');
      const sel = await scroller(page);
      const take = new Take('audit-log', [{ page, kind: 'desktop' }]);
      await take.start();
      await take.hold(700);
      await take.moveTo(1000, 560, 600);
      await take.scrollTo(520, 2200, { selector: sel, curve: 'inOutSine' });
      await take.hold(300);
      await take.scrollTo(0, 1000, { selector: sel });
      await take.tap(page.getByRole('button', { name: 'Money', exact: true }), { after: 900 });
      const rows = page.locator('button[aria-expanded="false"]');
      const n = await rows.count();
      for (let i = 0; i < n; i += 1) {
        const b = await rows.nth(i).boundingBox();
        if (b && b.y > 300 && b.y < 700) { await take.tap(rows.nth(i), { after: 1500 }); break; }
      }
      take.hidePointer(300);
      await take.hold(300);
      return take.end();
    },
  },
  {
    name: 'qr-card',
    files: ['qr-card.mp4', 'qr-card-table5.mp4', 'qr-card-table5.png'],
    viewport: 'desktop 1600×900 @1.6 → 2560×1440',
    describe: {
      'qr-card.mp4': 'QR codes: the one code for the whole room, then "Per table" — a printable card for every table.',
      'qr-card-table5.mp4': 'A clean, full-bleed hold on table 5’s printable QR card (3 s).',
      'qr-card-table5.png': 'Table 5’s printable QR card as a still, rendered at 4×.',
    },
    what: 'QR codes.',
    async film(env) {
      const page = await adminPage(env, '/admin/qr-codes');
      const take = new Take('qr-card', [{ page, kind: 'desktop' }]);
      await take.start();
      await take.hold(1300);
      await take.tap(page.getByRole('button', { name: /Per table/ }), { after: 1200 });
      const card = page.locator('[id^="qr-card-"]').filter({ hasText: /Table 5(?!\d)/ }).first();
      const cb = await card.boundingBox();
      if (cb && cb.y + cb.height < 800) { await take.moveTo(cb.x + cb.width * 0.7, cb.y + cb.height * 0.75); await take.hold(1200); }
      take.hidePointer(300);
      await take.hold(500);
      const info = await take.end();
      // the card alone, full bleed: a still at 4×, and a 3-second hold of it
      await card.scrollIntoViewIfNeeded();
      // as printed: the page's on-screen-only buttons ("Print this one") hidden
      const printLook = await page.addStyleTag({ content: '.no-print { display: none !important; }' });
      await page.mouse.move(5, 5);
      await page.waitForTimeout(600);
      const box = await card.boundingBox();
      const scroll = await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }));
      const cdp = await page.context().newCDPSession(page);
      // CDP clips are in document coordinates, boundingBox() in the viewport's
      const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, clip: { x: box.x + scroll.x, y: box.y + scroll.y, width: box.width, height: box.height, scale: 4 } });
      await cdp.detach();
      const png = path.join(OUT, 'qr-card-table5.png');
      writeFileSync(png, Buffer.from(shot.data, 'base64'));
      await printLook.evaluate((el) => el.remove());
      const hold = spawnSync(FFMPEG, ['-y', '-loglevel', 'error', '-loop', '1', '-framerate', String(FPS), '-t', '3', '-i', png,
        '-vf', 'scale=-2:1240:flags=lanczos,pad=2560:1440:(ow-iw)/2:(oh-ih)/2:color=0xF7F5F0', '-c:v', 'libx264', '-preset', 'slow', '-crf', '15',
        '-pix_fmt', 'yuv420p', '-r', String(FPS), '-movflags', '+faststart', '-an', path.join(OUT, 'qr-card-table5.mp4')], { encoding: 'utf8' });
      if (hold.status !== 0) console.log('    ! qr hold:', hold.stderr);
      return info;
    },
  },
  // ---------------------------------------------------------------- heroes
  {
    name: 'guest-hero',
    viewport: 'phone 390×844 @3x',
    what: 'One continuous take on the phone: the guest at table 5 types their name, the menu opens, a glance down the menu, into Mains, two dishes added with a tap each, the order, "Send order", pay at the table — "Order sent to the kitchen".',
    async film({ browser, newContext: makeContext }) {
      const context = await makeContext(browser, 'phone');
      try {
        const page = await context.newPage();
        await open(page, '/menu/casademo/', { text: 'Our picks' });
        await preloadPage(page);
        await open(page, guestTablePath(5));
        const nameBox = page.getByPlaceholder(/name/i);
        await nameBox.waitFor({ timeout: 60_000 });
        await page.waitForTimeout(800);
        const take = new Take('guest-hero', [{ page, kind: 'phone' }]);
        await take.start();
        await take.hold(400);
        await take.tap(nameBox, { after: 150 });
        await take.type('Amar');
        await take.tap(page.getByRole('button', { name: /continue/i }), { after: 150 });
        await take.until(() => page.getByText('Our picks').first().isVisible(), 3000);
        await take.hold(700);
        const mains = page.getByRole('heading', { name: 'Mains' }).first();
        const mb = await mains.boundingBox();
        await take.scrollTo(Math.max(0, mb.y - 260), 1100, { curve: 'out' });
        await take.hold(200);
        await take.tap(mains, { after: 600 });
        await take.tap(page.getByRole('button', { name: 'Add Truffle Risotto to order' }).first(), { after: 450 });
        await take.tap(page.getByRole('button', { name: 'Add Penne Arrabbiata to order' }).first(), { after: 500 });
        // the bar first says what was just added, then turns into "View Order"
        const viewOrder = page.getByRole('button', { name: /View Order/ });
        await take.until(() => viewOrder.isVisible(), 3000);
        await take.hold(250);
        await take.tap(viewOrder, { after: 900 });
        await take.tap(page.getByRole('button', { name: /Send order/ }), { after: 650 });
        await take.tap(page.getByRole('button', { name: /^Cash/ }), { after: 200 });
        await take.until(() => page.getByText(/Order sent/i).first().isVisible(), 4000);
        await take.hold(2200);
        return await take.end();
      } finally {
        await context.close();
      }
    },
  },
  {
    name: 'split-hero',
    files: ['split-hero.mp4', 'split-hero-phone.mp4', 'split-hero-kitchen.mp4'],
    viewport: 'phone 390×844 @3x + desktop 1600×900 @1.6, composed on 2560×1440',
    describe: {
      'split-hero.mp4': 'Side by side, one take: the guest sends the order and pays at the table on the phone (right); the ticket pops onto the kitchen display (left) the same moment.',
      'split-hero-phone.mp4': 'The phone half of split-hero on its own (1170×2532), to lay out differently.',
      'split-hero-kitchen.mp4': 'The kitchen half of split-hero on its own (2560×1440).',
    },
    what: 'Side by side.',
    async film({ browser, newContext: makeContext }) {
      const context = await makeContext(browser, 'desktop');
      try {
        const kitchen = await context.newPage();
        await open(kitchen, '/kitchen', { text: 'Kitchen & Bar' });
        await allowSound(kitchen);
        const guest = await guestOrderReady(context, 5, 'Lejla', { stopAt: 'cart' });
        await quietBoard(kitchen);
        await kitchen.mouse.move(1500, 900);
        const phoneFile = path.join(OUT, 'split-hero-phone.mp4');
        const kitchenFile = path.join(OUT, 'split-hero-kitchen.mp4');
        const take = new Take('split-hero', [
          { page: guest, kind: 'phone', scale: 3, touch: false, file: phoneFile },
          { page: kitchen, kind: 'desktop', file: kitchenFile },
        ]);
        await take.start();
        await take.hold(1600);
        await take.tap(guest.getByRole('button', { name: /Send order/ }), { after: 1000 });
        await take.tap(guest.getByRole('button', { name: /^Cash/ }), { after: 200 });
        const ticket = kitchen.locator('div.rounded-xl.border.bg-card').filter({ hasText: /Table 5(?!\d)/ }).first();
        await take.until(() => ticket.isVisible(), 5000);
        await take.hold(5200);
        const info = await take.end();
        // compose: kitchen on the left, the phone in a bezel overlapping on the right
        const L = { kx: 90, ky: 200, kw: 1856, kh: 1044, pw: 548, ph: 1186, pr: 64, b: 16 };
        L.px = 2560 - 150 - L.pw; L.py = (1440 - L.ph) / 2;
        const dir = ensureDir(path.join(OUT, '.tmp'));
        const a = await compositeAssets(dir, L);
        const secs = String(probe(kitchenFile).seconds);
        const still = (file) => ['-loop', '1', '-framerate', String(FPS), '-t', secs, '-i', file];
        const r = spawnSync(FFMPEG, ['-y', '-loglevel', 'error',
          ...still(a.bg), '-i', kitchenFile, '-i', phoneFile, ...still(a.kmask), ...still(a.pmask), ...still(a.bezel),
          '-filter_complex',
          `[1:v]scale=${L.kw}:${L.kh}:flags=lanczos,format=rgba[k0];[3:v]format=gray[km];[k0][km]alphamerge[k];`
          + `[2:v]scale=${L.pw}:${L.ph}:flags=lanczos,format=rgba[p0];[4:v]format=gray[pm];[p0][pm]alphamerge[p];`
          + `[0:v][k]overlay=${L.kx}:${L.ky}:shortest=1[v1];[v1][p]overlay=${L.px}:${L.py}:shortest=1[v2];[v2][5:v]overlay=${L.px - L.b}:${L.py - L.b}:shortest=1,format=yuv420p[out]`,
          '-map', '[out]', '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-r', String(FPS), '-movflags', '+faststart', '-an',
          path.join(OUT, 'split-hero.mp4')], { encoding: 'utf8' });
        if (r.status !== 0) console.log('    ! compose:', r.stderr);
        else console.log(`    split-hero.mp4  2560x1440  ${probe(path.join(OUT, 'split-hero.mp4')).seconds.toFixed(2)} s`);
        return info;
      } finally {
        await context.close();
      }
    },
  },
];


// --readme: only rewrite README.md from the clips already in --out
const selected = opts.readme ? [] : ONLY.length ? CLIPS.filter((c) => ONLY.includes(c.name)) : CLIPS;
if (!selected.length && !opts.readme) throw new Error(`No clip named ${ONLY.join(', ')}. Clips: ${CLIPS.map((c) => c.name).join(', ')}`);

server = opts.readme ? { url: '', stop: async () => undefined } : await demoServer(opts.url);
const browser = opts.readme ? { close: async () => undefined } : await chromium.launch({ args: ['--hide-scrollbars', '--disable-gpu-vsync', '--font-render-hinting=none'] });
console.log(`Demo: ${server.url}   film time: ${new Date(filmNow).toLocaleString('en-GB', { timeZone: 'Europe/Sarajevo' })}   ${FPS} fps\nFilming ${selected.length} clip(s) into ${OUT}`);

const results = [];
const contexts = {};
const ctx = async (kind) => {
  if (!contexts[kind]) contexts[kind] = await newContext(browser, kind);
  return contexts[kind];
};
for (const clip of selected) {
  try {
    const info = await clip.film({ ctx, server, Take, open, preloadPage, loadImages, allowSound, guestTablePath, OUT, FPS, KINDS, browser, newContext });
    results.push({ clip, info });
  } catch (error) {
    console.log(`  ! ${clip.name}: ${String(error?.stack ?? error).split('\n').slice(0, 3).join(' | ')}`);
  }
}
for (const c of Object.values(contexts)) await c.close().catch(() => undefined);
await browser.close();
await server.stop();

// ------------------------------------------------------------------ README
const all = CLIPS.map((clip) => {
  const files = clip.files ?? [`${clip.name}.mp4`];
  return files.map((f) => {
    const file = path.join(OUT, f);
    if (!existsSync(file)) return null;
    const pr = probe(file);
    return { f, clip, pr, size: statSync(file).size };
  }).filter(Boolean);
}).flat();
const rows = all.map(({ f, clip, pr }) => `| ${f} | ${f.endsWith('.png') ? 'still' : `${pr.seconds.toFixed(1)} s`} | ${pr.width}×${pr.height} | ${f.endsWith('.png') ? 'rendered at 4×' : clip.viewport} | ${(clip.describe?.[f] ?? clip.what).replace(/\|/g, '/')} |`);
writeFileSync(path.join(OUT, 'README.md'), `# Demo app footage

Real footage of the TableFlow demo (fictional restaurant **Casa Demo**) being used, for the launch film.
Filmed ${new Date().toISOString().slice(0, 10)} by \`node scripts/demo-footage.mjs\` (repo table-magic-ordering, branch feat/demo-mode) from the built offline demo.

- H.264 MP4, yuv420p, ${FPS} fps, no audio. Every frame is rendered deterministically (time is stepped exactly 1/${FPS} s per frame), so there are no dropped frames and no loading spinners.
- Each clip starts and ends on a still, clean frame, so it can be cut hard.
- Phone clips: a 390×844 phone viewport at 3× (1170×2532). Desktop: 1600×900 at 1.6× (2560×1440). TV: 1600×900 → 2560×1440 landscape, 1080×1920 → 1440×2560 portrait.
- The app's clock is set to an evening service (${String(opts.at)} Sarajevo time) so tickets and today's numbers read like dinner.
- Pointer: a soft touch circle with a ripple on phone clips, an arrow cursor on desktop clips; both drawn by the script.
- To re-film one clip: \`node scripts/demo-footage.mjs --only <name>\` (names are the file names without .mp4).

| File | Length | Pixels | Viewport | What happens |
|---|---|---|---|---|
${rows.join('\n')}
`);
console.log(`\nREADME: ${path.join(OUT, 'README.md')}`);
rmSync(path.join(OUT, '.tmp'), { recursive: true, force: true });
