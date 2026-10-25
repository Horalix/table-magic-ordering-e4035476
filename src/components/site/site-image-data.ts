import siteImages from './site-images.json';

/** The website's photographs, as built by scripts/site-images.mjs. */
export type SiteImageName = keyof typeof siteImages;

export interface SiteImageEntry { width: number; height: number; widths: number[]; blur: string }
const images = siteImages as Record<SiteImageName, SiteImageEntry>;

export function siteImage(name: SiteImageName): SiteImageEntry {
  return images[name];
}

/** `/site/hero-wide-960.webp 960w, …` */
export function siteSrcSet(name: SiteImageName): string {
  return images[name].widths.map((w) => `/site/${name}-${w}.webp ${w}w`).join(', ');
}

/** The smallest file at least `at` pixels wide (the largest when none is). */
export function siteSrc(name: SiteImageName, at?: number): string {
  const { widths } = images[name];
  const w = at ? widths.find((x) => x >= at) ?? widths[widths.length - 1] : widths[widths.length - 1];
  return `/site/${name}-${w}.webp`;
}
