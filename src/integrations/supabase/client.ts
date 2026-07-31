import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';

// Import the supabase client like this:
// import { supabase } from "@/integrations/supabase/client";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

/**
 * `createClient` throws at import time when the URL is missing, which takes the
 * whole module graph down with it — a blank screen in production if a deploy
 * forgets an environment variable, and a failing `npm test` on a fresh clone
 * that has no `.env` at all.
 *
 * Falling back to an unroutable placeholder keeps imports side-effect-safe:
 * modules load, unit tests that never touch the network pass, and any real
 * request fails as a normal network error the UI already handles — instead of
 * a white page.
 */
const MISSING_CONFIG_URL = 'https://supabase-not-configured.invalid';

const configured = Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY);

if (!configured && typeof window !== 'undefined') {
  console.error(
    'Supabase is not configured: set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY. ' +
    'The app will load but every request will fail.',
  );
}

/** False when the build has no Supabase configuration. Useful for health checks. */
export const supabaseConfigured = configured;

export const supabase = createClient<Database>(
  SUPABASE_URL || MISSING_CONFIG_URL,
  SUPABASE_PUBLISHABLE_KEY || 'not-configured',
  {
    auth: {
      // localStorage is unavailable in the node test environment.
      storage: typeof localStorage !== 'undefined' ? localStorage : undefined,
      persistSession: typeof localStorage !== 'undefined',
      autoRefreshToken: typeof localStorage !== 'undefined',
    },
  },
);
