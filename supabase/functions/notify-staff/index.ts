// Lock-screen alerts for waiters, and reservation alerts for admins (Web Push).
//
// A locked phone runs no JavaScript, so the waiter screen cannot chime for an
// order nobody is looking at. The database calls this function the moment a
// guest orders, calls a waiter or asks for the bill
// (20261112090000_staff_push.sql), and it pushes a notification to the phones
// of the waiters concerned: the table's waiter, or the waiters on shift at
// that restaurant when the table has nobody. A guest's request for a table
// (20261113090000_reservations.sql) goes to the restaurant's admins instead.
//
// What each call does lives in ../_shared/notify-staff.ts, who is chosen in
// ../_shared/staff-push.ts and the encryption in ../_shared/web-push.ts — all
// unit-tested. This file only connects them to the database with the service
// role, every read limited to the one restaurant it names.
//
// Deploy with verify_jwt = false (supabase/config.toml): pg_net sends no
// sign-in. The test alert checks the waiter's sign-in itself.
//
// Secrets: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT (mailto:…),
// made with `npm run vapid:keys`. The private key is set here and nowhere else.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { json } from "../_shared/http.ts";
import { handleNotifyStaff, type NotifyBackend } from "../_shared/notify-staff.ts";
import type { PushEventRow, PushSubscriptionRow, PushWaiterRow, ReservationRow, StaffPushSource } from "../_shared/staff-push.ts";
import type { Vapid } from "../_shared/web-push.ts";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const vapid: Vapid = {
  publicKey: (Deno.env.get("VAPID_PUBLIC_KEY") ?? "").trim(),
  privateKey: (Deno.env.get("VAPID_PRIVATE_KEY") ?? "").trim(),
  subject: (Deno.env.get("VAPID_SUBJECT") ?? "").trim(),
};

const PHONE_COLUMNS = "id, user_id, venue_id, endpoint, keys, last_seen_at";
const EVENT_COLUMNS: Record<StaffPushSource, string> = {
  orders: "id, venue_id, table_session_id, created_at, status, held_reason, released_to_kitchen_at, total, paid_at",
  waiter_calls: "id, venue_id, table_session_id, created_at, status, reason",
  bill_requests: "id, venue_id, table_session_id, created_at, status",
};

const rec = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};

function must<T>(what: string, result: { data: T; error: { message: string } | null }): T {
  if (result.error) throw new Error(`${what}: ${result.error.message}`);
  return result.data;
}

const backend: NotifyBackend = {
  loadEvent: async (source, id) =>
    must("event", await admin.from(source).select(EVENT_COLUMNS[source]).eq("id", id).maybeSingle()) as PushEventRow | null,

  claim: async (source, id) =>
    must("claim", await admin.rpc("staff_push_claim", { _source: source, _id: id })) === true,

  loadReservation: async (id) =>
    must("reservation", await admin.from("reservations")
      .select("id, venue_id, status, guest_name, party_size, reserved_for, created_at, updated_at, cancelled_by").eq("id", id).maybeSingle()) as ReservationRow | null,

  // The restaurant's own admins and the owner (an admin of no one restaurant), and its phones only.
  loadReservationAudience: async (venueId) => {
    const [venue, admins, phones] = await Promise.all([
      admin.from("venues").select("name").eq("id", venueId).maybeSingle(),
      admin.from("user_roles").select("user_id").eq("role", "admin").or(`venue_id.eq.${venueId},venue_id.is.null`),
      admin.from("reservation_alert_phones").select(PHONE_COLUMNS).eq("venue_id", venueId),
    ]);
    return {
      venueName: String(rec(must("venue", venue)).name ?? ""),
      adminUserIds: ((must("admins", admins) ?? []) as unknown[]).map((row) => String(rec(row).user_id)),
      phones: (must("admin phones", phones) ?? []) as unknown as PushSubscriptionRow[],
    };
  },

  forgetAdminPhones: async (ids) => {
    must("forget admin phones", await admin.from("reservation_alert_phones").delete().in("id", ids));
  },

  adminPhoneOf: async (userId, endpoint) => {
    const rows = (must("admin phone", await admin.from("reservation_alert_phones")
      .select(`${PHONE_COLUMNS}, venues(name)`).eq("user_id", userId).eq("endpoint", endpoint).limit(1)) ?? []) as unknown[];
    if (!rows.length) return null;
    const row = rec(rows[0]);
    return { ...(row as unknown as PushSubscriptionRow), venueName: String(rec(row.venues).name ?? "") };
  },

  loadContext: async (venueId, sessionId) => {
    const [session, venue, waiters, shift] = await Promise.all([
      admin.from("table_sessions").select("id, venue_id, assigned_waiter_id, tables(table_number)")
        .eq("id", sessionId).eq("venue_id", venueId).maybeSingle(),
      admin.from("venues").select("name").eq("id", venueId).maybeSingle(),
      admin.from("waiters").select("id, user_id, venue_id, is_active").eq("venue_id", venueId),
      admin.rpc("staff_push_shift", { _venue: venueId }),
    ]);
    const s = rec(must("session", session));
    const table = rec(s.tables).table_number;
    const sh = rec(must("shift", shift));
    return {
      session: s.id ? {
        id: String(s.id), venue_id: String(s.venue_id),
        assigned_waiter_id: typeof s.assigned_waiter_id === "string" ? s.assigned_waiter_id : null,
        table_number: typeof table === "number" ? table : null,
      } : null,
      venueName: String(rec(must("venue", venue)).name ?? ""),
      waiters: (must("waiters", waiters) ?? []) as PushWaiterRow[],
      rota: (Array.isArray(sh.rota) ? sh.rota : []).map(String),
      dayStart: String(sh.day_start ?? ""),
    };
  },

  loadPhones: async (venueId) =>
    (must("phones", await admin.from("staff_push_subscriptions").select(PHONE_COLUMNS).eq("venue_id", venueId)) ?? []) as unknown as PushSubscriptionRow[],

  loadLines: async (orderId) =>
    ((must("items", await admin.from("order_items").select("quantity, created_at, menu_items(name)")
      .eq("order_id", orderId).order("created_at")) ?? []) as unknown[]).map((line) => ({
      quantity: Number(rec(line).quantity) || 1,
      name: String(rec(rec(line).menu_items).name ?? "Item"),
    })),

  forgetPhones: async (ids) => {
    must("forget phones", await admin.from("staff_push_subscriptions").delete().in("id", ids));
  },

  userOf: async (token) => {
    const { data } = await admin.auth.getUser(token);
    return data.user?.id ?? null;
  },

  phoneOf: async (userId, endpoint) => {
    const rows = (must("phone", await admin.from("staff_push_subscriptions")
      .select(`${PHONE_COLUMNS}, venues(name)`).eq("user_id", userId).eq("endpoint", endpoint).limit(1)) ?? []) as unknown[];
    if (!rows.length) return null;
    const row = rec(rows[0]);
    return { ...(row as unknown as PushSubscriptionRow), venueName: String(rec(row.venues).name ?? "") };
  },
};

const runtime = (globalThis as { EdgeRuntime?: { waitUntil(work: Promise<unknown>): void } }).EdgeRuntime;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return json(req, null);
  try {
    const reply = await handleNotifyStaff(req, {
      backend, vapid,
      waitUntil: runtime ? (work) => runtime.waitUntil(work) : undefined,
      log: (line) => console.log(line),
    });
    return json(req, reply.body, reply.status);
  } catch (error) {
    console.error("notify-staff:", error);
    return json(req, { error: error instanceof Error ? error.message : "Server error" }, 500);
  }
});
