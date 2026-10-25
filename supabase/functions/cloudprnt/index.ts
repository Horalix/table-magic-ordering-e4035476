// Cloud printing endpoint for network thermal printers.
//
// A Star CloudPRNT printer (TSP143IV, mC-Print3) or an Epson Server Direct
// Print printer (TM-m30III, TM-T88VII) polls this URL every few seconds and
// prints the kitchen/bar tickets waiting for its station. No tablet, no local
// software, nothing to pair.
//
// Each printer has its own URL, made in Admin → Printing:
//
//   https://<project>.supabase.co/functions/v1/cloudprnt/<poll_token>
//
// The protocol logic lives in ../_shared/cloud-print.ts (unit-tested); the
// ticket layout in ../_shared/ticket-layout.ts (shared with the web app). This
// file only connects them to the database, using the service role and the
// SECURITY DEFINER functions from 20261026120000_cloud_printers.sql — the same
// claim/report queue the tablets use, so a printer and a tablet can never both
// print one ticket.
//
// Deploy with verify_jwt = false (see supabase/config.toml): a printer cannot
// send a Supabase JWT. The poll token in the path is the credential.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { handleCloudPrint, type CloudPrintBackend, type ClaimedTicket, type CloudPrinter } from "../_shared/cloud-print.ts";
import type { TicketOrder } from "../_shared/ticket-layout.ts";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const rec = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};

const rpc = async <T>(fn: string, args: Record<string, unknown>): Promise<T | null> => {
  const { data, error } = await admin.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return (data ?? null) as T | null;
};

const backend: CloudPrintBackend = {
  checkin: (token, protocol, mac, status) =>
    rpc<CloudPrinter>("cloud_printer_checkin", { _token: token, _protocol: protocol, _mac: mac, _status: status }),

  claim: (token, ticketId) =>
    rpc<ClaimedTicket>("cloud_print_claim", { _token: token, _ticket_id: ticketId }),

  report: (token, ticketId, ok, error) =>
    rpc<string>("cloud_print_report", { _token: token, _ticket_id: ticketId, _ok: ok, _error: error }),

  testDone: async (token, ok, error) => {
    await rpc("cloud_printer_test_done", { _token: token, _ok: ok, _error: error });
  },

  // Read live at print time rather than from the payload queued with the
  // ticket: a reprint should show the order as it is now, and `*` picks up
  // newer columns (order_items.components) without this file changing.
  loadOrder: async (orderId): Promise<TicketOrder | null> => {
    const { data, error } = await admin
      .from("orders")
      .select("id, order_code, created_at, released_to_kitchen_at, guest_name, notes, payment_method, payment_status, total, tip_amount, table_sessions(assigned_waiter_id, tables(table_number, sections(name))), order_items(*, menu_items(name, allergens))")
      .eq("id", orderId)
      .maybeSingle();
    if (error || !data) return null;
    const order = rec(data);
    const session = rec(order.table_sessions);
    const table = rec(session.tables);
    const section = rec(table.sections);

    let waiter: string | null = null;
    if (typeof session.assigned_waiter_id === "string") {
      const { data: w } = await admin.from("waiters").select("display_name").eq("id", session.assigned_waiter_id).maybeSingle();
      waiter = typeof w?.display_name === "string" ? w.display_name : null;
    }

    const items = (Array.isArray(order.order_items) ? order.order_items : []).map(rec)
      .map((item) => {
        const menu = rec(item.menu_items);
        return {
          quantity: Number(item.quantity ?? 1),
          menu_item_name: String(menu.name ?? "Item"),
          notes: typeof item.notes === "string" ? item.notes : null,
          station: typeof item.station === "string" ? item.station : "kitchen",
          allergens: Array.isArray(menu.allergens) ? (menu.allergens as string[]) : null,
          components: Array.isArray(item.components) ? (item.components as TicketOrder["items"][number]["components"]) : null,
          unit_price: item.unit_price == null ? null : Number(item.unit_price),
        };
      });

    return {
      id: String(order.id),
      order_code: typeof order.order_code === "string" ? order.order_code : null,
      table_number: Number(table.table_number ?? 0) || "?",
      created_at: String(order.created_at),
      released_to_kitchen_at: typeof order.released_to_kitchen_at === "string" ? order.released_to_kitchen_at : null,
      guest_name: typeof order.guest_name === "string" ? order.guest_name : null,
      section_name: typeof section.name === "string" ? section.name : null,
      waiter_name: waiter,
      notes: typeof order.notes === "string" ? order.notes : null,
      payment_method: typeof order.payment_method === "string" ? order.payment_method : null,
      payment_status: typeof order.payment_status === "string" ? order.payment_status : null,
      total: order.total == null ? null : Number(order.total),
      tip_amount: order.tip_amount == null ? null : Number(order.tip_amount),
      items,
    };
  },

  settings: async () => {
    const { data } = await admin.from("restaurant_settings").select("print_header, print_footer").eq("id", 1).maybeSingle();
    const row = rec(data);
    return {
      header: typeof row.print_header === "string" ? row.print_header : null,
      footer: typeof row.print_footer === "string" ? row.print_footer : null,
    };
  },
};

Deno.serve((req) => handleCloudPrint(req, backend));
