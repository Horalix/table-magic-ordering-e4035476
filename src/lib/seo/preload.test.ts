/**
 * @vitest-environment node
 *
 * Each prerendered page names the code its screen needs, so a phone fetches
 * it alongside the app instead of a round trip later (scripts/seo-prerender.ts).
 */
import { describe, expect, it } from 'vitest';
import type { Rollup } from 'vite';
import { moduleFiles, pageModules, preloadTags, rootPreloadScript } from '../../../scripts/seo-prerender';

const chunk = (fileName: string, facade: string | null, imports: string[] = [], css: string[] = []) => ({
  type: 'chunk', fileName, facadeModuleId: facade, imports, viteMetadata: { importedCss: new Set(css), importedAssets: new Set() },
}) as unknown as Rollup.OutputChunk;

const bundle = Object.fromEntries([
  chunk('assets/index-A.js', 'C:/repo/index.html', ['assets/react-vendor-B.js']),
  chunk('assets/react-vendor-B.js', null),
  chunk('assets/GuestMenu-C.js', 'C:/repo/src/pages/GuestMenu.tsx', ['assets/index-A.js', 'assets/SmartImage-D.js'], ['assets/GuestMenu-C.css']),
  chunk('assets/SmartImage-D.js', 'C:/repo/src/components/guest/SmartImage.tsx', ['assets/react-vendor-B.js']),
  chunk('assets/PageTransition-E.js', 'C:\\repo\\src\\components\\PageTransition.tsx'),
  chunk('assets/SiteHome-F.js', 'C:/repo/src/pages/site/SiteHome.tsx'),
].map((c) => [c.fileName, c])) as Rollup.OutputBundle;

const template = '<script type="module" crossorigin src="/assets/index-A.js"></script><link rel="modulepreload" crossorigin href="/assets/react-vendor-B.js">';

describe('which screen a prerendered address draws', () => {
  it('names the menu, a category, a dish, the privacy page and the website', () => {
    expect(pageModules('/menu/lasoul/', false)).toEqual(['src/components/PageTransition.tsx', 'src/pages/GuestMenu.tsx']);
    expect(pageModules('/menu/lasoul/food/', false)).toEqual(['src/components/PageTransition.tsx', 'src/pages/CategoryPage.tsx']);
    expect(pageModules('/menu/lasoul/dish/la-soul-burger/', false)[0]).toBe('src/pages/DishLink.tsx');
    expect(pageModules('/privacy/', false)).toEqual(['src/components/PageTransition.tsx', 'src/pages/Trust.tsx']);
    expect(pageModules('/bs/', false)).toEqual(['src/pages/site/SiteHome.tsx']);
    expect(pageModules('/', true)).toEqual(['src/pages/vera/VeraSite.tsx']);
  });
});

describe('the files behind a screen', () => {
  it('are its chunk, what that imports and its CSS — less what every page already loads', () => {
    const files = moduleFiles(bundle, template, ['src/components/PageTransition.tsx', 'src/pages/GuestMenu.tsx']);
    expect(files).toEqual(['/assets/PageTransition-E.js', '/assets/GuestMenu-C.js', '/assets/GuestMenu-C.css', '/assets/SmartImage-D.js']);
  });

  it('are fetched with crossorigin, as Vite asks for them, so nothing comes down twice', () => {
    expect(preloadTags(['/assets/GuestMenu-C.js', '/assets/GuestMenu-C.css'])).toBe(
      '<link rel="modulepreload" crossorigin href="/assets/GuestMenu-C.js">'
      + '<link rel="preload" as="style" crossorigin href="/assets/GuestMenu-C.css">',
    );
  });
});

describe('the home page, which every other address is served too', () => {
  const run = (pathname: string) => {
    const added: { rel: string; as?: string; href: string; crossOrigin: string }[] = [];
    const script = rootPreloadScript({ home: ['/assets/SiteHome-F.js'], table: ['/assets/GuestMenu-C.js', '/assets/GuestMenu-C.css'], start: ['/assets/Start.js'] })
      .replace(/^<script>/, '').replace(/<\/script>$/, '');
    const document = {
      createElement: () => ({} as { rel: string; as?: string; href: string; crossOrigin: string }),
      head: { appendChild: (l: (typeof added)[number]) => added.push(l) },
    };
    new Function('location', 'document', script)({ pathname }, document);
    return added;
  };

  it('fetches the website only at /', () => {
    expect(run('/').map((l) => l.href)).toEqual(['/assets/SiteHome-F.js']);
  });

  it('fetches the menu for a table code and the room code', () => {
    expect(run('/table/7').map((l) => [l.rel, l.href])).toEqual([['modulepreload', '/assets/GuestMenu-C.js'], ['preload', '/assets/GuestMenu-C.css']]);
    expect(run('/start').map((l) => l.href)).toEqual(['/assets/Start.js']);
  });

  it('fetches nothing for a staff screen', () => {
    expect(run('/waiter')).toEqual([]);
    expect(run('/admin/menu')).toEqual([]);
    expect(run('/kitchen')).toEqual([]);
  });
});
