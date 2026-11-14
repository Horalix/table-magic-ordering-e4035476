/**
 * The demo's two ticket printers (demo mode only).
 *
 * A real one is a box on the kitchen wall that asks the server every few
 * seconds whether there is a ticket for it (supabase/functions/cloudprnt).
 * These do the same through the same database functions — check in, claim
 * the next ticket for their station, report it printed — so Admin → Printing
 * shows them online and every order's ticket goes from "waiting" to
 * "printed" a moment after it is placed, as it would on paper.
 */
import type { SqlDb } from '../backend/types';
import { RESTAURANT } from '../brand';

interface Printer { poll_token: string; protocol: string | null; device_mac: string | null }

export async function runPrinters(db: SqlDb): Promise<void> {
  const { rows } = await db.query<Printer>(
    `SELECT poll_token, protocol, device_mac FROM public.printers WHERE venue_id = $1::text::uuid AND enabled`, [RESTAURANT.dbId]);
  for (const printer of rows) {
    const checkin = await db.query<{ r: { next_ticket_id?: string | null; test_pending?: boolean } | null }>(
      `SELECT public.cloud_printer_checkin($1::text, $2::text, $3::text, 'online') AS r`, [printer.poll_token, printer.protocol, printer.device_mac]);
    const state = checkin.rows[0]?.r;
    if (!state) continue;
    if (state.test_pending) await db.query(`SELECT public.cloud_printer_test_done($1::text, true)`, [printer.poll_token]);
    // A few tickets per round at most: a printer takes a second or two each.
    for (let i = 0; i < 3; i += 1) {
      const claim = await db.query<{ r: { ticket_id?: string } | null }>(`SELECT public.cloud_print_claim($1::text) AS r`, [printer.poll_token]);
      const ticket = claim.rows[0]?.r?.ticket_id;
      if (!ticket) break;
      await db.query(`SELECT public.cloud_print_report($1::text, $2::text::uuid, true)`, [printer.poll_token, ticket]);
    }
  }
}
