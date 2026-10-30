import { readFileSync } from "fs";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { VitePWA } from "vite-plugin-pwa";
import { seoPrerender } from "./scripts/seo-prerender";

/**
 * The app a phone installs. Vera Italia's own site (veraitalia.net) is this
 * code built with VITE_HOME_VENUE=veraitalia (src/lib/home-venue.ts); there
 * the installed app is Vera Italia's, from its own manifest file.
 */
const LA_SOUL_MANIFEST = {
  name: "La Soul",
  short_name: "La Soul",
  description: "La Soul — order from your table",
  theme_color: "#7E9B79",
  background_color: "#F7F4EC",
  display: "standalone" as const,
  start_url: "/menu/lasoul/",
  scope: "/",
  icons: [
    { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
    { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
  ],
};
const homeVenue = (mode: string) => process.env.VITE_HOME_VENUE ?? loadEnv(mode, process.cwd(), "VITE_").VITE_HOME_VENUE;
const manifestFor = (mode: string) => (homeVenue(mode) === "veraitalia"
  ? JSON.parse(readFileSync(path.resolve(__dirname, "public/manifest-veraitalia.webmanifest"), "utf8"))
  : LA_SOUL_MANIFEST);

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [
    react(),
    mode === "development" && componentTagger(),
    // Real HTML for crawlers that run no JavaScript, robots.txt, sitemap.xml, llms.txt.
    seoPrerender(),
    VitePWA({
      // Registered and updated by src/lib/app-update.ts, which applies a new
      // version at a safe moment instead of leaving the old one on screen.
      registerType: "prompt",
      injectRegister: false,
      includeAssets: ["favicon.ico", "icons/apple-touch-icon.png", "brand/wordmark-white.webp", "brand/branch-white.webp"],
      manifest: manifestFor(mode),
      workbox: {
        globPatterns: ["**/*.{js,css,html,woff2}"],
        globIgnores: ["**/menu/**"], // huge optimized image set — runtime-cache instead
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        cleanupOutdatedCaches: true,
        navigateFallback: "index.html",
        navigateFallbackDenylist: [/^\/admin/, /^\/kitchen/, /^\/waiter/],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith("/menu/") && url.pathname.endsWith(".webp"),
            handler: "CacheFirst",
            options: { cacheName: "menu-images", expiration: { maxEntries: 400, maxAgeSeconds: 60 * 60 * 24 * 30 } },
          },
          {
            urlPattern: ({ url }) => /\/rest\/v1\/(categories|subcategories|menu_items)/.test(url.pathname),
            handler: "NetworkFirst",
            options: { cacheName: "menu-data", networkTimeoutSeconds: 3, expiration: { maxEntries: 60, maxAgeSeconds: 60 * 60 * 24 } },
          },
          /*
           * No font CDN rule any more. The faces are self-hosted under
           * /fonts and are picked up by globPatterns above, so they are
           * precached with the rest of the shell rather than fetched from a
           * third party and cached on the way past.
           */
        ],
      },
      devOptions: { enabled: false },
    }),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          const normalized = id.replace(/\\/g, "/");
          if (normalized.includes("/node_modules/@supabase/")) return "supabase-vendor";
          /*
           * Radix is deliberately NOT manually chunked.
           *
           * One "radix-vendor" blob made a guest browsing the menu download
           * every primitive the ADMIN uses. Splitting it per package went too
           * far the other way — forty sub-kilobyte chunks that compress badly
           * and cost round trips. Rollup's own splitting is usage-aware in a
           * way a path regex cannot be: it puts each primitive with the routes
           * that import it and hoists genuinely shared ones.
           */
          if (normalized.includes("/node_modules/framer-motion/")) return "motion-vendor";
          /*
           * Recharts is deliberately NOT manually chunked, for exactly the
           * reason Radix is not, one comment above.
           *
           * Naming it made Rollup hoist it to a static import of the entry, so
           * index.html carried a modulepreload for it and every guest fetched
           * 389 KB of charting library at high priority before the menu could
           * paint — to render a menu that has no charts. Removing this line
           * took the eager payload from 330 KB to 225 KB gzipped and put
           * recharts in the AdminAnalytics chunk, where it is actually used.
           */
          if (
            normalized.includes("/node_modules/react/") ||
            normalized.includes("/node_modules/react-dom/") ||
            normalized.includes("/node_modules/react-router/") ||
            normalized.includes("/node_modules/react-router-dom/") ||
            normalized.includes("/node_modules/@remix-run/router/") ||
            normalized.includes("/node_modules/@tanstack/react-query/") ||
            normalized.includes("/node_modules/scheduler/")
          ) return "react-vendor";
          return;
        },
      },
    },
  },
}));
