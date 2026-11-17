/**
 * What makes a build the offline demo (docs/demo-mode.md). Used by
 * vite.config.ts only when the mode is "demo".
 *
 *  - index.html is replaced by a page that carries the demo's name instead of
 *    the restaurant's, and starts the app from src/demo/entry.ts — which puts
 *    the in-browser backend in place before the app loads.
 *  - Files in public/ that belong to the real restaurants (their websites'
 *    photographs, logos, home-screen apps, redirects) are left out of
 *    dist-demo: the demo is a white-label product, and they are never asked for.
 */
import { existsSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import type { Plugin } from "vite";
import { DEMO_ICON, PRODUCT, RESTAURANT_THEME_COLOR } from "../src/demo/brand";

const DEMO_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <meta name="theme-color" content="${RESTAURANT_THEME_COLOR}" />
    <meta name="robots" content="noindex, nofollow" />
    <!-- The TV menu board (/tv) is drawn for one look; see index.html. -->
    <script>
      (function () {
        if (!/^\\/tv(\\/|$)/.test(location.pathname)) return;
        var meta = document.createElement('meta');
        meta.name = 'color-scheme';
        meta.content = 'only light';
        document.head.appendChild(meta);
        document.documentElement.style.colorScheme = 'only light';
      })();
    </script>
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="default" />
    <meta name="apple-mobile-web-app-title" content="${PRODUCT.name}" />
    <link rel="apple-touch-icon" href="${DEMO_ICON}" />
    <link rel="icon" type="image/svg+xml" href="${DEMO_ICON}" />
    <link rel="preload" as="font" type="font/woff2" href="/fonts/inter.woff2" crossorigin />
    <link rel="preload" as="font" type="font/woff2" href="/fonts/lora.woff2" crossorigin />
    <title>${PRODUCT.name} — ${PRODUCT.byline}</title>
    <meta name="description" content="${PRODUCT.tagline}. A live, self-contained demo." />
  </head>

  <body>
    <div id="root"></div>
    <script type="module" src="/src/demo/entry.ts"></script>
  </body>
</html>
`;

/** In public/, but the real restaurants' own: not part of a demo build. */
const NOT_IN_DEMO = [
  "_redirects", "_headers", "brand", "site", "icons", "img", "kitchen-app", "waiter-app",
  "sw-push.js", "sw-rescue.js", "favicon.ico",
];
const NOT_IN_DEMO_PATTERNS = [/^manifest-.*\.webmanifest$/, /^[0-9a-f]{32}\.txt$/];

export function demoBuild(): Plugin {
  let outDir = "";
  return {
    name: "tableflow-demo-build",
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
    },
    transformIndexHtml: {
      order: "pre",
      handler: () => DEMO_HTML,
    },
    closeBundle() {
      if (!outDir || !existsSync(outDir)) return;
      for (const name of readdirSync(outDir)) {
        if (NOT_IN_DEMO.includes(name) || NOT_IN_DEMO_PATTERNS.some((p) => p.test(name))) {
          rmSync(path.join(outDir, name), { recursive: true, force: true });
        }
      }
      const covers = path.join(outDir, "covers");
      if (existsSync(covers)) {
        for (const name of readdirSync(covers)) {
          if (/^(lasoul|veraitalia)-/.test(name)) rmSync(path.join(covers, name), { force: true });
        }
      }
    },
  };
}
