import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchOpenTables, type OpenTables } from '@/lib/end-of-day';
import { useCoalesced, useStaffTables } from '@/lib/realtime';

export const OPEN_TABLES_KEY = ['staff', 'open-tables'] as const;
const WATCHED = ['table_sessions', 'orders'] as const;

/**
 * The open tables of the restaurant this screen shows, with what each owes
 * (src/lib/end-of-day.ts), kept current: on every change to a table or an
 * order, and each minute. Null on a database from before
 * 20261110120000_close_all_tables.sql, and while loading.
 */
export function useOpenTables(): OpenTables | null {
  const client = useQueryClient();
  const { data } = useQuery({
    queryKey: OPEN_TABLES_KEY,
    queryFn: fetchOpenTables,
    // The clock passing the end of the work day changes the answer with no table changing.
    refetchInterval: 60_000,
    staleTime: 10_000,
    retry: false,
  });
  const refresh = useCoalesced(useCallback(() => { void client.invalidateQueries({ queryKey: OPEN_TABLES_KEY }); }, [client]));
  useStaffTables(WATCHED, refresh);
  return data ?? null;
}
