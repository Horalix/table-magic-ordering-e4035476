/**
 * demo-capture.mjs — records the demo's walkthrough as a 1080p video.
 *
 * One order, followed through every screen: a guest scans the code on table 5
 * and orders on their phone, the ticket lands on the kitchen display, the
 * kitchen cooks it, the waiter serves it and takes the payment, and the owner
 * sees it in the day's numbers. It is filmed on the demo's side-by-side stage
 * (/demo/stage): a phone and a larger screen, both live, with a caption.
 *
 *   node scripts/demo-capture.mjs
 *   node scripts/demo-capture.mjs --out C:\somewhere --url http://localhost:8080 --captions off --pace 1.3
 *
 * Needs the built demo (npm run build:demo) unless --url is given. Saves
 * walkthrough-1080p.webm, and walkthrough-1080p.mp4 too when ffmpeg is found
 * (on PATH, in FFMPEG, or under C:\Users\<you>\ffmpeg-*). --pace slows every
 * pause down (1 is normal).
 */
import path from 'node:path';
import { existsSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import { chromium } from 'playwright';
import { CONTEXT, demoServer, ensureDir, guestTablePath, options, quietDemo, sleep } from './demo-lib.mjs';

const opts = options({ out: 'C:\\Users\\kerim\\demo-pitch\\recordings', captions: 'on', pace: '1', name: 'walkthrough-1080p' });
const OUT = ensureDir(path.resolve(String(opts.out)));
const PACE = Number(opts.pace) || 1;
const CAPTIONS = opts.captions !== 'off';
const SIZE = { width: 1920, height: 1080 };
const TMP = ensureDir(path.join(OUT, '.recording'));

const server = await demoServer(opts.url);
const browser = await chromium.launch();
const context = await browser.newContext({ ...CONTEXT, viewport: SIZE, recordVideo: { dir: TMP, size: SIZE } });
await quietDemo(context);

const pause = (ms) => sleep(ms * PACE);
const log = (text) => console.log(`  ${text}`);

// ---- warm up off camera: the first visit builds the database, which is not part of the film.
{
  const warm = await context.newPage();
  await warm.goto(`${server.url}/menu/casademo/`);
  await warm.waitForFunction(() => !document.querySelector('[data-demo-splash]') && (document.getElementById('root')?.children.length ?? 0) > 0, null, { timeout: 180_000 });
  await warm.waitForTimeout(1500);
  const video = warm.video();
  await warm.close();
  if (video) await video.delete().catch(() => undefined);
}

const page = await context.newPage();
const started = Date.now();
const chapters = [];

/** Shows the stage with these frames, title and caption. The first call loads the page; later ones change it in place. */
let staged = false;
async function stage({ phone, screen, title, caption }) {
  const params = new URLSearchParams();
  if (phone) params.set('phone', phone);
  if (screen) params.set('screen', screen);
  if (title) params.set('title', title);
  if (caption && CAPTIONS) params.set('caption', caption);
  const url = `/demo/stage?${params.toString()}`;
  if (!staged) {
    await page.goto(server.url + url);
    staged = true;
  } else {
    await page.evaluate((to) => { window.history.pushState({}, '', to); window.dispatchEvent(new PopStateEvent('popstate')); }, url);
  }
  if (title) chapters.push([Math.round((Date.now() - started) / 1000), title]);
  await page.waitForTimeout(600);
  for (const kind of ['phone', 'screen']) {
    if (!(kind === 'phone' ? phone : screen)) continue;
    const frame = page.frameLocator(`iframe[data-stage="${kind}"]`);
    await frame.locator('#root > *:not([data-demo-splash])').first().waitFor({ state: 'attached', timeout: 60_000 }).catch(() => undefined);
    // Staff screens ask for one tap before they may play sounds: given off camera, so the reminder is not in the film.
    await frame.getByRole('button', { name: /Alerts are silent|Sound blocked|Tap to enable sound/ }).first().click({ timeout: 2500 }).catch(() => undefined);
  }
  await page.waitForTimeout(900);
}

/** Changes only the caption, without reloading either frame. */
async function caption(text) {
  if (!CAPTIONS) return;
  await page.evaluate((value) => {
    const url = new URL(window.location.href);
    url.searchParams.set('caption', value);
    window.history.replaceState({}, '', url);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, text);
  await page.waitForTimeout(350);
}

// ---- a pointer that can be seen: the recording has no mouse cursor of its own.
async function installPointer() {
  await page.evaluate(() => {
    if (document.getElementById('demo-pointer')) return;
    const dot = document.createElement('div');
    dot.id = 'demo-pointer';
    dot.style.cssText = 'position:fixed;left:0;top:0;width:26px;height:26px;margin:-13px 0 0 -13px;border-radius:50%;background:rgba(255,255,255,.55);'
      + 'border:2px solid rgba(20,30,24,.75);box-shadow:0 2px 10px rgba(0,0,0,.35);z-index:99999;pointer-events:none;'
      + 'transform:translate(960px,560px);transition:transform .55s cubic-bezier(.22,.8,.3,1),width .12s,height .12s,margin .12s';
    document.body.appendChild(dot);
  });
}

async function pointAt(locator) {
  await locator.scrollIntoViewIfNeeded({ timeout: 15_000 }).catch(() => undefined);
  const box = await locator.boundingBox({ timeout: 15_000 });
  if (!box) throw new Error('nothing to point at');
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.evaluate(([px, py]) => {
    const dot = document.getElementById('demo-pointer');
    if (dot) dot.style.transform = `translate(${px}px,${py}px)`;
  }, [x, y]);
  await page.waitForTimeout(650);
}

async function tap(locator, after = 900) {
  await installPointer();
  await pointAt(locator);
  await page.evaluate(() => {
    const dot = document.getElementById('demo-pointer');
    if (!dot) return;
    dot.style.width = '18px'; dot.style.height = '18px'; dot.style.margin = '-9px 0 0 -9px';
    setTimeout(() => { dot.style.width = '26px'; dot.style.height = '26px'; dot.style.margin = '-13px 0 0 -13px'; }, 160);
  });
  await locator.click({ timeout: 15_000 });
  await pause(after);
}

const scrollTo = (frame, top) => frame.locator('html').evaluate((el, y) => { el.ownerDocument.defaultView.scrollTo({ top: y, behavior: 'smooth' }); }, top);

/** A scene that fails is reported; the film carries on with the next. */
async function scene(name, work) {
  log(name);
  try { await work(); } catch (error) { console.log(`    ! ${String(error?.message ?? error).split('\n')[0]}`); }
}

const phone = page.frameLocator('iframe[data-stage="phone"]');
const screen = page.frameLocator('iframe[data-stage="screen"]');
/** Table 5's ticket on the kitchen display. (A new ticket reads "Table 5NEW": no word boundary after the number.) */
const kitchenTicket = () => screen.locator('div.rounded-xl.border.bg-card').filter({ hasText: /Table 5(?!\d)/ }).first();

console.log(`Demo: ${server.url}\nRecording…`);

await scene('1. The guest sits down', async () => {
  await stage({ phone: guestTablePath(5), screen: '/kitchen', title: 'A guest orders from the table', caption: 'A guest scans the QR code on table 5. No app to install, no account.' });
  await installPointer();
  await pause(1800);
  const name = phone.getByPlaceholder(/name/i);
  await tap(name, 300);
  await name.pressSequentially('Lejla', { delay: 130 });
  await pause(500);
  await tap(phone.getByRole('button', { name: /continue/i }), 2200);
});

await scene('2. The menu', async () => {
  await caption('The menu: photographs, today’s offers, allergens — in Bosnian, English and Arabic.');
  await pause(1600);
  await scrollTo(phone, 520);
  await pause(2000);
  await scrollTo(phone, 1150);
  await pause(1800);
  await tap(phone.getByRole('heading', { name: 'Mains' }).first(), 2000);
  await tap(phone.getByRole('button', { name: 'Truffle Risotto', exact: true }), 2600);
  await page.keyboard.press('Escape');
  await phone.locator('html').press('Escape').catch(() => undefined);
  await pause(900);
});

await scene('3. The order', async () => {
  await caption('Two taps to add. The order and its total stay in view.');
  await tap(phone.getByRole('button', { name: 'Add Truffle Risotto to order' }), 900);
  await tap(phone.getByRole('button', { name: 'Add Casa Burger to order' }), 1200);
  await tap(phone.getByRole('button', { name: /View Order/ }), 2200);
  await caption('Before sending, one suggestion that fits what is in the order.');
  await tap(phone.locator('button:has-text("Add")').last(), 1500);
  await tap(phone.getByRole('button', { name: /Send order/ }), 1800);
  await caption('Pay by card on the phone, or at the table. The kitchen is on the right.');
  await pause(1500);
  await tap(phone.getByRole('button', { name: /^Cash/ }), 800);
});

await scene('4. The kitchen', async () => {
  await caption('The ticket is on the kitchen display the moment it is sent — and printed at the pass.');
  await kitchenTicket().waitFor({ timeout: 20_000 });
  await pointAt(kitchenTicket());
  await pause(2600);
  await tap(phone.getByRole('button', { name: /Track your order/ }), 1800);
  await caption('The kitchen starts the order. The guest’s phone follows along.');
  await tap(kitchenTicket().getByRole('button', { name: /Start all/ }), 3000);
  await caption('Ready. The guest sees it, and so does the waiter.');
  await tap(kitchenTicket().getByRole('button', { name: /All ready/ }), 3200);
});

await scene('5. The waiter', async () => {
  await stage({ phone: '/waiter', screen: '/waiter/monitor', title: 'The floor', caption: 'The waiter’s phone: table 5 is ready to carry. The screen at the pass shows the whole room.' });
  await installPointer();
  await pause(2200);
  // Table 5's own buttons: the first one after its "T5" label, whichever card or row that is in.
  const after = (label) => phone.locator(`xpath=//*[normalize-space(.)="T5"]/following::button[contains(normalize-space(.), "${label}")][1]`).first();
  await tap(after('Mark served'), 2400);
  await caption('Served. When the guests are done, payment is one tap: cash or terminal.');
  await tap(phone.locator('button:has-text("My tables")').first(), 1400);
  await tap(after('Cash'), 1500);
  await tap(phone.getByRole('button', { name: /^Yes,/ }), 2200);
  await caption('Paid, and the table is free for the next guests.');
  await tap(after('Free table'), 1200);
  await phone.getByRole('button', { name: /^(Yes|Free)/ }).last().click({ timeout: 2000 }).catch(() => undefined);
  await pause(2200);
});

await scene('6. The owner', async () => {
  await stage({ screen: '/admin', title: 'The owner', caption: 'The owner’s dashboard: today’s sales as they happen, and the three things most worth doing next.' });
  await installPointer();
  await pause(3400);
  await scrollTo(screen, 420);
  await pause(2400);
  await caption('Analytics: why sales moved against last week, by tables, spend and time of day.');
  await tap(screen.getByRole('link', { name: 'Analytics' }), 2600);
  await scrollTo(screen, 520);
  await pause(2800);
  await caption('Menu intelligence: every dish by what it sells and what it earns.');
  await tap(screen.getByRole('link', { name: 'Menu intelligence' }), 2400);
  await tap(screen.getByRole('tab', { name: 'Menu' }).or(screen.getByRole('button', { name: 'Menu', exact: true })).first(), 1200);
  await scrollTo(screen, 380);
  await pause(3000);
  await caption('And what the suggestions earned, measured against tables that were shown none.');
  await tap(screen.getByRole('link', { name: 'What the app earned' }), 4200);
});

await scene('7. Close', async () => {
  await stage({ phone: '/waiter', screen: '/kitchen', title: 'One order, every screen', caption: 'QR ordering, kitchen display, floor service and the back office — one system.' });
  await pause(3600);
});

const video = page.video();
await page.close();
await context.close();
await browser.close();
await server.stop();

const webm = path.join(OUT, `${opts.name}.webm`);
if (video) {
  const recorded = await video.path();
  rmSync(webm, { force: true });
  renameSync(recorded, webm);
}
rmSync(TMP, { recursive: true, force: true });
console.log(`\nSaved ${webm} (${Math.round((Date.now() - started) / 1000)} s)`);
writeFileSync(path.join(OUT, `${opts.name}.chapters.txt`), chapters.map(([at, title]) => `${String(Math.floor(at / 60)).padStart(2, '0')}:${String(at % 60).padStart(2, '0')}  ${title}`).join('\n') + '\n');

// ---- an .mp4 as well, when ffmpeg is around: most editors prefer it.
function findFfmpeg() {
  if (process.env.FFMPEG && existsSync(process.env.FFMPEG)) return process.env.FFMPEG;
  if (spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0) return 'ffmpeg';
  try {
    for (const dir of readdirSync(os.homedir()).filter((d) => /^ffmpeg/i.test(d))) {
      for (const candidate of [path.join(os.homedir(), dir, 'bin', 'ffmpeg.exe'), path.join(os.homedir(), dir, 'ffmpeg.exe')]) {
        if (existsSync(candidate)) return candidate;
      }
    }
  } catch { /* no home directory listing */ }
  return null;
}
const ffmpeg = findFfmpeg();
if (ffmpeg && existsSync(webm)) {
  const mp4 = path.join(OUT, `${opts.name}.mp4`);
  const done = spawnSync(ffmpeg, ['-y', '-i', webm, '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', '30', '-movflags', '+faststart', mp4], { stdio: 'ignore' });
  console.log(done.status === 0 ? `Saved ${mp4}` : 'ffmpeg could not convert the recording; the .webm is complete.');
} else if (!ffmpeg) {
  console.log('ffmpeg not found: only the .webm was saved.');
}
