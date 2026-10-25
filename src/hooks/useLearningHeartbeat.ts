import { useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

/** How often an open staff screen offers the engine a refresh. */
const EVERY_MS = 5 * 60 * 1000;
/** The first offer waits until the screen has loaded what it needs. */
const FIRST_MS = 20 * 1000;

/**
 * Keeps the suggestion engine learning all day, with or without pg_cron.
 *
 * Orders teach the engine by themselves: a database trigger counts what each
 * table ordered the moment the kitchen gets it. The heavier tables (what
 * guests accept, pair strength) are rebuilt by
 * `maybe_refresh_menu_intelligence()`, which returns at once unless a refresh
 * is due (30 minutes old and something happened since) and never runs twice
 * at once — so every open screen may ask, and the cost of asking is two
 * index probes. pg_cron asks every 15 minutes where it exists; the kitchen
 * display and the admin ask where it does not. Never asked from a guest's
 * phone: a guest must not wait for it.
 *
 * Failures are ignored; the next tick asks again.
 */
export function useLearningHeartbeat(): void {
  useEffect(() => {
    const ask = () => {
      void Promise.resolve(supabase.rpc('maybe_refresh_menu_intelligence' as never)).catch(() => undefined);
    };
    const first = setTimeout(ask, FIRST_MS);
    const every = setInterval(ask, EVERY_MS);
    return () => {
      clearTimeout(first);
      clearInterval(every);
    };
  }, []);
}
