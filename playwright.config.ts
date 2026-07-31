import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end config.
 *
 * Runs against the production build (`vite preview`) so the service worker,
 * code splitting and PWA behaviour are the ones a guest actually gets.
 *
 * Payment specs never talk to Monri: the online card path is exercised with a
 * stubbed Edge Function response, and the confirmation always comes from our
 * own server state. Nothing here can reach a real payment endpoint.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 45_000,
  expect: { timeout: 8_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',

  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:4173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    // The PWA service worker would serve menu requests itself, bypassing
    // page.route() and letting a test reach the real project. Block it.
    serviceWorkers: 'block',
  },

  projects: [
    {
      // The guest app is mobile-first; this is the viewport that matters.
      name: 'mobile-chrome',
      use: { ...devices['Pixel 7'] },
    },
    {
      name: 'mobile-safari',
      use: { ...devices['iPhone 13'] },
    },
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'] },
      testIgnore: /.*\.mobile\.spec\.ts/,
    },
  ],

  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        // `--mode e2e` loads .env.e2e, which points at a non-existent Supabase
        // host so a missed interception fails loudly instead of hitting live data.
        command: 'npx vite build --mode e2e && npx vite preview --port 4173 --strictPort',
        url: 'http://localhost:4173',
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
      },
});
