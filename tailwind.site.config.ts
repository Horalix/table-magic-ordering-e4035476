import type { Config } from "tailwindcss";
import base from "./tailwind.config";

/**
 * Utilities for the public website only (src/pages/site, src/components/site),
 * compiled into the website's lazily loaded stylesheet by the `@config` line in
 * src/pages/site/site.css. Same theme as the app.
 *
 * Scoped under `.site-root`: that stylesheet stays loaded after a visitor
 * moves on to the menu, and an unscoped `.px-5` arriving later in the cascade
 * would beat the menu's own `sm:px-6` on the same element.
 */
export default {
  ...base,
  content: ["./src/components/site/**/*.{ts,tsx}", "./src/pages/site/**/*.{ts,tsx}"],
  important: ".site-root",
  corePlugins: { preflight: false },
} satisfies Config;
