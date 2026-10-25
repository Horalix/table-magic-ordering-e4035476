import { supabase } from '@/integrations/supabase/client';

/**
 * Network printers and the print queue (20261026120000_cloud_printers.sql).
 *
 * `printers` and the new ticket columns are not in the generated Supabase
 * types until Lovable regenerates them after the migration is applied, so
 * this module is the one place that talks to them untyped — and gives the
 * rest of the app proper types.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const untyped = supabase as unknown as { from: (table: string) => any; rpc: (fn: string, args?: Record<string, unknown>) => any };

export type PrinterStation = 'kitchen' | 'bar' | 'all';
export type PrinterProtocol = 'star_cloudprnt' | 'epson_sdp';

export interface PrinterRow {
  id: string;
  name: string;
  station: PrinterStation;
  paper_width: 58 | 80;
  plain_text: boolean;
  enabled: boolean;
  poll_token: string;
  protocol: PrinterProtocol | null;
  device_mac: string | null;
  last_seen_at: string | null;
  last_status: string | null;
  last_error: string | null;
  test_requested_at: string | null;
  last_test_printed_at: string | null;
  created_at: string;
}

/** What every staff screen may know about a printer — never its secret. */
export interface PrinterHealth {
  id: string;
  name: string;
  station: PrinterStation;
  protocol: PrinterProtocol | null;
  enabled: boolean;
  online: boolean;
  last_seen_at: string | null;
  last_status: string | null;
  last_error: string | null;
  waiting: number;
}

export interface QueueTicket {
  id: string;
  order_id: string;
  ticket_type: string;
  status: 'queued' | 'claimed' | 'exported' | 'printed' | 'failed' | 'cancelled';
  attempts: number;
  last_error: string | null;
  printed_at: string | null;
  print_verified: boolean | null;
  claimed_by_device: string | null;
  original_printed_at?: string | null;
  created_at: string;
  updated_at: string;
  orders?: {
    order_code: string | null;
    status: string;
    table_sessions?: { tables?: { table_number: number | null } | null } | null;
  } | null;
}

const throwing = <T>({ data, error }: { data: T; error: { message: string } | null }): T => {
  if (error) throw new Error(error.message);
  return data;
};

/** The URL a printer is given. The poll token is the last path segment. */
export const pollUrl = (token: string) => {
  const base = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? 'https://YOUR-PROJECT.supabase.co';
  return `${base.replace(/\/$/, '')}/functions/v1/cloudprnt/${token}`;
};

/** A fresh 64-character poll secret. */
export const newPollToken = () => {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
};

export const listPrinters = async (): Promise<PrinterRow[]> =>
  (throwing(await untyped.from('printers').select('*').order('created_at')) as PrinterRow[] | null) ?? [];

export const addPrinter = async (fields: Pick<PrinterRow, 'name' | 'station' | 'paper_width'>): Promise<PrinterRow> =>
  throwing(await untyped.from('printers').insert({ ...fields, poll_token: newPollToken() }).select('*').single()) as PrinterRow;

export const updatePrinter = async (id: string, patch: Partial<Omit<PrinterRow, 'id'>>) => {
  throwing(await untyped.from('printers').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id));
};

export const deletePrinter = async (id: string) => {
  throwing(await untyped.from('printers').delete().eq('id', id));
};

/** The printer prints a test page on its next poll — within a few seconds. */
export const requestTestPrint = (id: string) => updatePrinter(id, { test_requested_at: new Date().toISOString() });

/** A new secret; the old URL stops working at once. */
export const rotatePollToken = (id: string) => updatePrinter(id, { poll_token: newPollToken() });

export const printerHealth = async (): Promise<PrinterHealth[]> => {
  const rows = throwing(await untyped.rpc('printer_health')) as PrinterHealth[] | null;
  return Array.isArray(rows) ? rows : [];
};

/** Recent tickets with their order, newest first. */
export const printQueue = async (sinceIso: string, limit = 200): Promise<QueueTicket[]> => {
  const rows = throwing(await untyped
    .from('order_ticket_events')
    .select('id, order_id, ticket_type, status, attempts, last_error, printed_at, print_verified, claimed_by_device, created_at, updated_at, orders(order_code, status, table_sessions(tables(table_number)))')
    .gte('created_at', sinceIso)
    .order('created_at', { ascending: false })
    .limit(limit)) as QueueTicket[] | null;
  return Array.isArray(rows) ? rows : [];
};
