// CloudPRNT endpoint (scaffold) for Star/Epson network thermal printers.
// The printer polls this URL; it returns queued kitchen tickets from
// `order_ticket_events` as plain text and marks them printed.
//
// Protect with a shared secret: set CLOUDPRNT_TOKEN as an Edge secret and
// configure the printer's poll URL as
//   https://<project>.functions.supabase.co/cloudprnt?token=<CLOUDPRNT_TOKEN>
//
// NOTE: this follows Star CloudPRNT's POST(status)/GET(job)/DELETE(ack) shape
// but has not been verified against a physical printer — confirm during setup.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
};

const money = (n: unknown) => `${Number(n ?? 0).toFixed(2)} KM`;

// deno-lint-ignore no-explicit-any
function renderTicket(payload: any): string {
  const items: any[] = Array.isArray(payload?.items) ? payload.items : [];
  const lines: (string | null)[] = [
    "LA SOUL — KITCHEN",
    `Table: ${payload?.table_number ?? "?"}`,
    payload?.guest_name ? `Guest: ${payload.guest_name}` : null,
    `Time: ${new Date(payload?.created_at ?? Date.now()).toLocaleString()}`,
    "--------------------------------",
    ...items.flatMap((it) => [
      `${it.quantity} x ${it.name}`,
      it.notes ? `  >> ${it.notes}` : null,
    ]),
    "--------------------------------",
    payload?.total != null ? `TOTAL: ${money(payload.total)}` : null,
    payload?.payment_method ? `Pay: ${String(payload.payment_method).toUpperCase()}` : null,
  ];
  return lines.filter((l) => l != null).join("\n") + "\n\n\n";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  const TOKEN = Deno.env.get("CLOUDPRNT_TOKEN");
  if (!TOKEN) return new Response("CloudPRNT not configured", { status: 501, headers: cors });

  const url = new URL(req.url);
  const provided = url.searchParams.get("token") || req.headers.get("x-cloudprnt-token") || "";
  if (provided !== TOKEN) return new Response("Unauthorized", { status: 401, headers: cors });

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const nextQueued = async () =>
    admin.from("order_ticket_events").select("id, payload")
      .eq("ticket_type", "kitchen").in("status", ["queued", "exported"])
      .order("created_at", { ascending: true }).limit(1).maybeSingle();

  try {
    // Printer asks "is there a job?" (Star sends POST with its status JSON).
    if (req.method === "POST") {
      const { data } = await nextQueued();
      return new Response(
        JSON.stringify({ jobReady: !!data, mediaTypes: ["text/plain"], jobToken: data?.id ?? "" }),
        { headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    // Printer fetches the job content.
    if (req.method === "GET") {
      const { data } = await nextQueued();
      if (!data) return new Response("", { status: 200, headers: { ...cors, "Content-Type": "text/plain" } });
      await admin.from("order_ticket_events").update({ status: "exported", exported_at: new Date().toISOString() }).eq("id", data.id);
      return new Response(renderTicket(data.payload), { status: 200, headers: { ...cors, "Content-Type": "text/plain; charset=utf-8" } });
    }

    // Printer confirms it printed → mark printed.
    if (req.method === "DELETE") {
      const target = url.searchParams.get("jobToken");
      if (target) {
        await admin.from("order_ticket_events").update({ status: "printed", printed_at: new Date().toISOString() }).eq("id", target);
      } else {
        const { data } = await admin.from("order_ticket_events").select("id").eq("status", "exported").order("exported_at", { ascending: true }).limit(1).maybeSingle();
        if (data) await admin.from("order_ticket_events").update({ status: "printed", printed_at: new Date().toISOString() }).eq("id", data.id);
      }
      return new Response("ok", { status: 200, headers: cors });
    }

    return new Response("Method not allowed", { status: 405, headers: cors });
  } catch (e) {
    return new Response(e instanceof Error ? e.message : "error", { status: 500, headers: cors });
  }
});
