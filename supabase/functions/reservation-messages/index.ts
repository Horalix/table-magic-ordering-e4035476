// WhatsApp messages about a reservation, from the restaurant's own WhatsApp
// Business number: to the guest when their request arrives and when it is
// answered, and to the restaurant when a request arrives.
//
// The database calls this function when a guest asks for a table and when a
// request is confirmed, declined or cancelled
// (20261114090000_reservation_messages.sql), and only for a restaurant that
// has messages switched on. What each call does lives in
// ../_shared/reservation-messages.ts and the messages themselves in
// ../_shared/whatsapp.ts, both unit-tested. This file only connects them to
// the database with the service role, every read limited to the one
// reservation or restaurant it names.
//
// Deploy with verify_jwt = false (supabase/config.toml): pg_net sends no
// sign-in. An admin's own calls (status, set up, test) are checked inside.
//
// Secrets (docs/whatsapp-messages.md says where each comes from):
//   WHATSAPP_TOKEN                 a permanent token of the Meta business
//   WHATSAPP_BUSINESS_ACCOUNT_ID   the WhatsApp Business Account's id
//   WHATSAPP_PHONE_ID_LASOUL       La Soul's number's id
//   WHATSAPP_PHONE_ID_VERAITALIA   Vera Italia's number's id
// Until they are set, nothing is sent and nothing fails.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { json } from "../_shared/http.ts";
import {
  handleReservationMessages, type MessageReservation, type MessagesBackend, type WhatsAppSecrets,
} from "../_shared/reservation-messages.ts";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const secret = (name: string) => (Deno.env.get(name) ?? "").trim();
const whatsapp: WhatsAppSecrets = {
  token: secret("WHATSAPP_TOKEN"),
  businessId: secret("WHATSAPP_BUSINESS_ACCOUNT_ID"),
  phoneIds: { lasoul: secret("WHATSAPP_PHONE_ID_LASOUL"), veraitalia: secret("WHATSAPP_PHONE_ID_VERAITALIA") },
};

const rec = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};

function must<T>(what: string, result: { data: T; error: { message: string } | null }): T {
  if (result.error) throw new Error(`${what}: ${result.error.message}`);
  return result.data;
}

const backend: MessagesBackend = {
  loadReservation: async (id) =>
    must("reservation", await admin.from("reservations")
      .select("id, venue_id, status, code, guest_name, guest_phone, party_size, reserved_for, locale, reply, cancelled_by, decided_at, created_at, updated_at")
      .eq("id", id).maybeSingle()) as MessageReservation | null,

  loadSettings: async (venueId) => {
    const [venue, settings] = await Promise.all([
      admin.from("venues").select("slug, name").eq("id", venueId).maybeSingle(),
      admin.from("restaurant_settings").select("reservations_whatsapp_guest, reservations_whatsapp_received, reservations_whatsapp_admin").eq("venue_id", venueId).maybeSingle(),
    ]);
    const v = rec(must("venue", venue));
    const s = rec(must("settings", settings));
    if (!v.slug) return null;
    const adminPhone = typeof s.reservations_whatsapp_admin === "string" ? s.reservations_whatsapp_admin.trim() : "";
    return { venueSlug: String(v.slug), venueName: String(v.name ?? ""), guest: s.reservations_whatsapp_guest === true, received: s.reservations_whatsapp_received !== false, adminPhone: adminPhone || null };
  },

  // One row per reservation and kind: the second insert of the same pair finds it taken.
  claim: async (reservationId, venueId, kind) => {
    const rows = must("claim", await admin.from("reservation_messages")
      .upsert({ reservation_id: reservationId, venue_id: venueId, kind }, { onConflict: "reservation_id,kind", ignoreDuplicates: true })
      .select("id")) as unknown[] | null;
    return (rows ?? []).length > 0;
  },

  record: async (reservationId, kind, status, detail) => {
    must("record", await admin.from("reservation_messages")
      .update({ status, detail, updated_at: new Date().toISOString() }).eq("reservation_id", reservationId).eq("kind", kind));
  },

  userOf: async (token) => {
    const { data } = await admin.auth.getUser(token);
    return data.user?.id ?? null;
  },

  // An admin of that restaurant, or the owner (an admin of no one restaurant).
  venueFor: async (userId, venueSlug) => {
    const v = rec(must("venue", await admin.from("venues").select("id, slug, name").eq("slug", venueSlug).maybeSingle()));
    if (!v.id) return null;
    const roles = (must("roles", await admin.from("user_roles").select("venue_id")
      .eq("user_id", userId).eq("role", "admin").or(`venue_id.eq.${v.id},venue_id.is.null`).limit(1)) ?? []) as unknown[];
    return roles.length ? { id: String(v.id), slug: String(v.slug), name: String(v.name ?? "") } : null;
  },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return json(req, null);
  try {
    const reply = await handleReservationMessages(req, { backend, whatsapp, log: (line) => console.log(line) });
    return json(req, reply.body, reply.status);
  } catch (error) {
    console.error("reservation-messages:", error);
    return json(req, { error: error instanceof Error ? error.message : "Server error" }, 500);
  }
});
