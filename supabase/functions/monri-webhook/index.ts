/**
 * Monri payment callback — the only thing in the system that may declare a
 * card payment successful.
 *
 * Responsibilities, in order:
 *   1. Verify the WP3-callback digest against the merchant key.
 *   2. Parse the payload defensively into our own vocabulary.
 *   3. Hand it to monri_apply_callback(), which owns replay protection,
 *      amount/currency verification, the monotonic status lattice, and the
 *      exactly-once kitchen release.
 *
 * This function makes no decisions about money on its own, and it never
 * updates orders or payment_transactions directly — the integrity trigger
 * would reject it if it tried.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { safeEqual } from "../_shared/http.ts";
import { callbackDigest, callbackEventHash, parseCallback } from "../_shared/monri.ts";

/** Provider-to-server: no browser origin involved, so no CORS is granted. */
const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const MONRI_MERCHANT_KEY = Deno.env.get("MONRI_MERCHANT_KEY");

    if (!MONRI_MERCHANT_KEY) return jsonResponse({ error: "not_configured" }, 503);

    const rawBody = await req.text();
    const authorization = (req.headers.get("authorization") || "").trim();
    const providedDigest = authorization.split(/\s+/).pop() || "";
    const expectedDigest = await callbackDigest(MONRI_MERCHANT_KEY, rawBody);

    if (!authorization.startsWith("WP3-callback") || !safeEqual(providedDigest, expectedDigest)) {
      console.warn("monri-webhook rejected: bad signature");
      return jsonResponse({ error: "invalid_signature" }, 401);
    }

    const parsed = parseCallback(rawBody);
    if (!parsed) return jsonResponse({ error: "unparseable_body" }, 400);
    if (!parsed.orderNumber) return jsonResponse({ error: "missing_order_number" }, 400);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data, error } = await admin.rpc("monri_apply_callback", {
      _event_hash: await callbackEventHash(rawBody),
      _monri_order_number: parsed.orderNumber,
      _monri_payment_id: parsed.paymentId,
      _normalized_status: parsed.status,
      _amount_minor: parsed.amountMinor,
      _currency: parsed.currency,
      _raw: parsed.raw,
    });

    if (error) throw error;

    // Always 200 for an authenticated, well-formed callback we have recorded.
    // A rejection (amount mismatch, replay) is an application outcome, not a
    // transport failure — returning 5xx would make Monri retry forever.
    console.log("monri-webhook applied", {
      order_number: parsed.orderNumber,
      status: parsed.status,
      outcome: data?.outcome,
      released: data?.released,
    });

    return jsonResponse({ ok: true, outcome: data?.outcome ?? "unknown" });
  } catch (error) {
    // A genuine server error: let Monri retry. Replay protection makes the
    // retry safe.
    console.error("monri-webhook error", error);
    return jsonResponse({ error: "server_error" }, 500);
  }
});
