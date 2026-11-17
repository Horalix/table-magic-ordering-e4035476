/**
 * The first screen's photograph, in the page before any of the app's code
 * has run.
 *
 * A prerendered home page carried its words for search engines and hid them
 * the moment a script ran, so a phone showed an empty cream screen until the
 * app had downloaded, started and drawn its first screen: two to three
 * seconds on a slow connection, and the page's largest paint with it. The
 * home pages now carry the hero's photograph as plain HTML, drawn exactly
 * where the app will draw it (the same files, sizes, crop and veil as
 * SiteHero.tsx, and VeraSite.tsx's hero), so the photograph is on screen as
 * soon as it has arrived and the app's own hero takes its place without
 * anything moving. The app removes it once its own photograph has loaded
 * (dropPoster below).
 *
 * Behind everything (z-index -1) and only where scripts run: a reader with
 * none sees the page's words instead, as before.
 *
 * Relative imports only: the build imports this module outside the app.
 */
import siteImages from '../../components/site/site-images.json';
import roomImages from '../../components/vera/room-images.json';

export const POSTER_ID = 'poster';

const srcset = (base: string, widths: number[]) => widths.map((w) => `${base}-${w}.webp ${w}w`).join(', ');

const CREAM = '#F7F4EC';
const cream = (alpha: number) => `rgba(247,244,236,${alpha})`;
const veilUp = (via: number, to: number) => `linear-gradient(to top,${CREAM} 18%,${cream(0.8)} ${via}%,${cream(0)} ${to}%)`;
const veilAcross = (side: 'right' | 'left') => `linear-gradient(to ${side},${cream(0.95)} 8%,${cream(0.6)} 34%,${cream(0)} 58%)`;

const BASE = `#${POSTER_ID}{display:none}`
  + `.js #${POSTER_ID}{display:block;position:absolute;top:0;left:0;right:0;z-index:-1;overflow:hidden;pointer-events:none}`
  + `.js #${POSTER_ID} img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}`
  + `.js #${POSTER_ID} i{position:absolute;inset:0}`;

/* SiteHero.tsx: a portrait photograph filling a phone's screen; a band on a tablet; full-bleed from 1024px. */
const LA_SOUL_STYLE = BASE
  + `.js #${POSTER_ID}{background:${CREAM};height:max(100svh,600px)}`
  + `.js #${POSTER_ID} img{object-position:50% 0}`
  + `[dir=rtl] #${POSTER_ID} img{transform:scaleX(-1)}`
  + `.js #${POSTER_ID} i{background:${veilUp(40, 62)}}`
  + `@media(max-width:389px){.js #${POSTER_ID} i{background:${veilUp(50, 74)}}}`
  + `@media(max-height:700px){.js #${POSTER_ID} i{background:${veilUp(52, 76)}}}`
  + `@media(min-width:640px){.js #${POSTER_ID}{height:auto;aspect-ratio:16/10}.js #${POSTER_ID} img{object-position:88% 50%}`
  + `.js #${POSTER_ID} i{background:linear-gradient(to top,${CREAM} 0,${cream(0)} 22%)}}`
  + `@media(min-width:1024px){.js #${POSTER_ID}{aspect-ratio:auto;height:clamp(640px,56.25vw,100svh)}.js #${POSTER_ID} img{object-position:100% 50%}`
  + `.js #${POSTER_ID} i{background:${veilAcross('right')}}[dir=rtl] #${POSTER_ID} i{background:${veilAcross('left')}}}`
  + `@media(min-width:1280px){.js #${POSTER_ID}{height:100svh;max-height:1100px;min-height:640px}}`;

/* VeraSite.tsx: the room, the height of the screen, under a dark veil. */
const VERA_STYLE = BASE
  + `.js #${POSTER_ID}{background:hsl(24 24% 11%);height:100svh;min-height:600px}`
  + `.js #${POSTER_ID} i{background:linear-gradient(to bottom,rgba(0,0,0,.6),rgba(0,0,0,.2),rgba(0,0,0,.7))}`;

/** The media query SiteHero.tsx and index.html switch photographs at. */
const WIDE = '(min-width: 640px)';

export interface Poster {
  /** Goes in the page's head. */
  style: string;
  /** Goes in the body, before the app's root. */
  markup: string;
  /**
   * Asks for the photograph while the head is still being read. For /bs/ and
   * /ar/: on "/" the page's own script does it (index.html), because that
   * file is also what every address without a page of its own is given.
   */
  preload: string;
}

/** The home page in each language: the only addresses the poster is drawn at (a regular expression, as text for a script). */
export const POSTER_PATHS = '/^\\/(?:(?:bs|ar)\\/?)?$/';

/**
 * The poster, put into the page by a line of script that first looks at the
 * address: the home page's file is also the answer to every address without a
 * page of its own (a table's QR code, the staff screens), and none of those
 * may be sent the website's photograph.
 */
export function posterScript(markup: string): string {
  return `<script>(function(){if(!${POSTER_PATHS}.test(location.pathname))return;`
    + `document.currentScript.insertAdjacentHTML('beforebegin',${JSON.stringify(markup).replace(/<\//g, '<\\/')})})()</script>`;
}

const ahead = (set: string, media?: string) =>
  `<link rel="preload" as="image" type="image/webp"${media ? ` media="${media}"` : ''} imagesrcset="${set}" imagesizes="100vw" fetchpriority="high">`;

/** The poster of a restaurant's home page; null for a restaurant whose home page has no photograph to show first. */
export function homePoster(venueSlug: string): Poster | null {
  const img = (src: string, set: string) => `<img src="${src}" srcset="${set}" sizes="100vw" alt="" decoding="async" fetchpriority="high">`;
  if (venueSlug === 'lasoul') {
    const wide = srcset('/site/hero-wide', siteImages['hero-wide'].widths);
    const tall = srcset('/site/hero-tall', siteImages['hero-tall'].widths);
    return {
      style: `<style>${LA_SOUL_STYLE}</style>`,
      markup: `<div id="${POSTER_ID}" aria-hidden="true"><picture><source media="${WIDE}" srcset="${wide}" sizes="100vw">${img('/site/hero-tall-720.webp', tall)}</picture><i></i></div>`,
      preload: ahead(wide, WIDE) + ahead(tall, '(max-width: 639.98px)'),
    };
  }
  if (venueSlug === 'veraitalia') {
    const { widths } = roomImages['room-2'];
    return {
      style: `<style>${VERA_STYLE}</style>`,
      markup: `<div id="${POSTER_ID}" aria-hidden="true">${img(`/site/vera/room-2-${widths[widths.length - 1]}.webp`, srcset('/site/vera/room-2', widths))}<i></i></div>`,
      preload: ahead(srcset('/site/vera/room-2', widths)),
    };
  }
  return null;
}

/** Whether the page still shows its poster: the app's "loading" screen stays clear over it. */
export function posterShown(): boolean {
  return typeof document !== 'undefined' && !!document.getElementById(POSTER_ID);
}

/** The app's own first screen is drawn: the poster under it has done its work. */
export function dropPoster(): void {
  if (typeof document !== 'undefined') document.getElementById(POSTER_ID)?.remove();
}
