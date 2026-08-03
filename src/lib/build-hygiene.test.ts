/**
 * Things about the build that are easy to undo by accident.
 *
 * Both rules here were live regressions, not hypotheticals. Neither shows up
 * in a screenshot, in a type error, or in any other test — the app looks and
 * behaves identically, it just costs the guest an extra second on a phone at a
 * table. That is exactly the class of problem that needs a test, because
 * nothing else will ever notice it.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(__dirname, '..', '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

describe('nothing render-blocking from a third party', () => {
  const html = read('index.html');

  it('does not load fonts from a CDN', () => {
    /*
     * These were fonts.googleapis.com links. Two extra DNS + TLS handshakes
     * before a single word could paint, for a guest whose entire visit is one
     * page load — and every guest's IP sent to a third party while /privacy
     * promises the app is first-party. The faces are local now; see
     * scripts/build-fonts.py.
     */
    expect(html).not.toMatch(/fonts\.googleapis\.com|fonts\.gstatic\.com/);
    expect(html).not.toMatch(/<link[^>]+rel=["']stylesheet["'][^>]+https?:\/\//);
  });

  it('preloads the local faces', () => {
    // They are referenced from the CSS bundle, so without these the browser
    // discovers them a full round trip late and the first paint is unstyled.
    expect(html).toMatch(/rel="preload"[^>]+\/fonts\/inter\.woff2/);
    expect(html).toMatch(/rel="preload"[^>]+\/fonts\/lora\.woff2/);
  });

  it('has no script tag pointing at another origin', () => {
    const external = [...html.matchAll(/<script[^>]+src=["'](https?:\/\/[^"']+)/g)];
    expect(external.map((m) => m[1])).toEqual([]);
  });
});

describe('vendor chunking stays honest', () => {
  const config = read('vite.config.ts');

  it('does not force recharts into a named chunk', () => {
    /*
     * Naming it made Rollup hoist it to a static import of the entry, so
     * index.html carried a modulepreload and every guest fetched 389 KB of
     * charting library at high priority — to render a menu with no charts.
     * Removing the rule took the eager payload from 330 KB to 225 KB gzipped.
     *
     * The same trap had already been documented for Radix one comment above
     * and was left in place for charts, which is why this is a test and not a
     * comment.
     */
    const manualChunks = config.slice(config.indexOf('manualChunks'));
    expect(manualChunks).not.toMatch(/recharts.*return\s+["']/);
    expect(manualChunks).not.toMatch(/d3-.*return\s+["']/);
  });

  it('keeps Radix unchunked for the same reason', () => {
    const manualChunks = config.slice(config.indexOf('manualChunks'));
    expect(manualChunks).not.toMatch(/@radix-ui.*return\s+["']/);
  });
});

describe('the font stylesheet is generated, not hand-edited', () => {
  const css = read('src/fonts.css');

  it('carries both families as one variable file each', () => {
    // Eight static faces became two variable ones. If someone regenerates this
    // with static weights the file count quadruples silently.
    const faces = css.match(/@font-face/g) ?? [];
    expect(faces).toHaveLength(2);
    expect(css).toMatch(/font-weight:\s*400\s+700/);
  });

  it('serves them from this origin', () => {
    expect(css).toMatch(/url\('\/fonts\/inter\.woff2'\)/);
    expect(css).toMatch(/url\('\/fonts\/lora\.woff2'\)/);
    expect(css).not.toMatch(/https?:\/\//);
  });

  it('swaps rather than blocking on the font', () => {
    // font-display: swap is why a slow font never hides the menu text.
    expect(css.match(/font-display:\s*swap/g) ?? []).toHaveLength(2);
  });
});
