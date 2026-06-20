import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { VitePWA } from "vite-plugin-pwa";

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
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: "auto",
      includeAssets: ["favicon.ico", "lasoul-logo.svg", "icons/apple-touch-icon.png"],
      manifest: {
        name: "La Soul",
        short_name: "La Soul",
        description: "La Soul — order from your table",
        theme_color: "#7E9B79",
        background_color: "#F7F4EC",
        display: "standalone",
        start_url: "/menu",
        scope: "/",
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,woff2}"],
        globIgnores: ["**/menu/**"], // huge optimized image set — runtime-cache instead
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
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
          {
            urlPattern: ({ url }) => url.origin === "https://fonts.googleapis.com" || url.origin === "https://fonts.gstatic.com",
            handler: "StaleWhileRevalidate",
            options: { cacheName: "google-fonts" },
          },
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
          if (normalized.includes("/node_modules/@radix-ui/")) return "radix-vendor";
          if (normalized.includes("/node_modules/framer-motion/")) return "motion-vendor";
          if (normalized.includes("/node_modules/recharts/") || normalized.includes("/node_modules/d3-")) return "charts-vendor";
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
