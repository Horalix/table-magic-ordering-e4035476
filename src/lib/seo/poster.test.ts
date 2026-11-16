// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { homePoster, POSTER_PATHS, posterScript } from './poster';
import { renderPage, withBrand } from '../../../scripts/seo-prerender';
import { siteSrc, siteSrcSet } from '../../components/site/site-image-data';
import { VENUES } from '../venues';

/**
 * The first screen's photograph, in a home page's HTML before the app runs
 * (src/lib/seo/poster.ts). It must be the very photograph the app then
 * draws, or a phone fetches two; and it must stay off every address that is
 * not a home page, because the home page's file answers those too.
 */
describe('the poster of a home page', () => {
  const template = '<!doctype html><html lang="en"><head><title>x</title></head><body><div id="root"></div></body></html>';
  const at = (pathname: string) => new RegExp(POSTER_PATHS.slice(1, -1)).test(pathname);

  it('is drawn on the home page in each language and nowhere else', () => {
    for (const p of ['/', '/bs', '/bs/', '/ar', '/ar/']) expect(at(p), p).toBe(true);
    for (const p of ['/table/5', '/menu/lasoul/', '/reserve/', '/admin', '/kitchen', '/start', '/bsx', '/ar/menu']) expect(at(p), p).toBe(false);
  });

  it('asks for the files the app’s own hero asks for', () => {
    const { markup } = homePoster('lasoul')!;
    expect(markup).toContain(`srcset="${siteSrcSet('hero-wide')}"`);
    expect(markup).toContain(`srcset="${siteSrcSet('hero-tall')}"`);
    expect(markup).toContain(`src="${siteSrc('hero-tall', 720)}"`);
    expect(markup).toContain('media="(min-width: 640px)"');
    // Nothing a screen reader or a search engine should take for content.
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain('alt=""');
  });

  it('is put in by a script that looks at the address first, and cannot end that script early', () => {
    const script = posterScript(homePoster('lasoul')!.markup);
    expect(script.startsWith('<script>')).toBe(true);
    expect(script).toContain(`${POSTER_PATHS}.test(location.pathname)`);
    expect(script.slice(8, -9)).not.toContain('</');
  });

  it('sits before the app’s root, hidden where no script runs; a page of its own asks for the photograph in its head', () => {
    const poster = homePoster('lasoul')!;
    const root = renderPage(template, '<title>T</title>', '<p>words</p>', 'en', poster);
    expect(root).toMatch(/<\/script><div id="root"><div data-prerender>/);
    expect(root).toContain('#poster{display:none}');
    expect(root).not.toContain('rel="preload" as="image"');
    const own = renderPage(template, '<title>T</title>', '<p>words</p>', 'bs', poster, true);
    expect(own).toContain('<link rel="preload" as="image" type="image/webp" media="(min-width: 640px)"');
    // A page that is not a home page carries none of it.
    expect(renderPage(template, '<title>T</title>', '<p>words</p>', 'en')).not.toContain('poster');
  });

  it('Vera Italia’s pages ask for its room, not for La Soul’s hero', () => {
    const index = readFileSync(path.resolve(__dirname, '../../../index.html'), 'utf8');
    expect(index).toContain("preload('hero-wide'");
    const vera = withBrand(index, VENUES.veraitalia);
    expect(vera).not.toContain('hero-wide');
    expect(vera).not.toContain('hero-tall');
    expect(vera).toContain("preload('vera/room-2', [640, 960, 1280, 1600, 2400], 'all');");
    expect(homePoster('veraitalia')!.markup).toContain('/site/vera/room-2-2400.webp');
    // La Soul's own pages keep theirs.
    expect(withBrand(index, VENUES.lasoul)).toContain("preload('hero-wide'");
    expect(homePoster('casademo')).toBeNull();
  });
});
