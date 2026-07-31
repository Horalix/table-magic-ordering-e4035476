import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    // supabase/tests holds the SQL integration suite; those files opt into the
    // node environment with a `@vitest-environment node` docblock.
    include: ["src/**/*.{test,spec}.{ts,tsx}", "supabase/tests/**/*.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
