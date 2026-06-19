import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
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
