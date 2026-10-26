import { describe, expect, it } from 'vitest';
import { legacyRedirect, parseRedirects } from './legacy-redirects';

describe('old addresses, followed by the app', () => {
  // A phone that had opened the site before showed "Page not found" for every
  // one of these: its service worker answered, not Netlify's redirects.
  it('sends the old static menu and the old lasoul.net pages to their new homes', () => {
    expect(legacyRedirect('/menu.html')).toBe('/menu/lasoul/');
    expect(legacyRedirect('/food/burgers.html')).toBe('/menu/lasoul/food/?section=burgers');
    expect(legacyRedirect('/drinks/mojito.html')).toBe('/menu/lasoul/drinks/?section=mojito');
    expect(legacyRedirect('/en/home')).toBe('/');
    expect(legacyRedirect('/bs/home')).toBe('/bs/');
    expect(legacyRedirect('/ar/home')).toBe('/ar/');
  });

  it('knows nothing else', () => {
    expect(legacyRedirect('/menu/lasoul/')).toBeNull();
    expect(legacyRedirect('/this-page-does-not-exist')).toBeNull();
  });

  it('reads only exact permanent redirects, never the app fallback or comments', () => {
    const map = parseRedirects('# note\n/old.html   /new/   301\n/*   /index.html   200\n\n/gone   /x   404\n');
    expect([...map]).toEqual([['/old.html', '/new/']]);
  });
});
