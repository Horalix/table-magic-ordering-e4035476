/**
 * Start a Monri card payment for an existing awaiting_payment order.
 *
 * This function never decides that money arrived — it only opens an attempt.
 * All state changes go through SECURITY DEFINER RPCs, which are the only
 * things allowed to touch financial columns (see 20260731090100_payment_safety).
 *
 * Idempotency: monri_register_attempt returns the existing live attempt for
 * the same order and amount, so a double-tapped Pay button, a refresh, or a
 * retried request all reuse one Monri order number instead of creating a
 * second chargeable payment.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders, json } from "../_shared/http.ts";
import { authorizationHeader, monriBaseUrl, monriEnvironment } from "../_shared/monri.ts";

interface Body {
  order_id?: string;
  session_id?: string;
  session_token?: string;
  currency?: string;
  transaction_type?: "purchase" | "authorize";
}

const CREATE_PATH = "/v2/payment/new";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders(req) });
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const MONRI_MERCHANT_KEY = Deno.env.get("MONRI_MERCHANT_KEY");
    const MONRI_AUTHENTICITY_TOKEN = Deno.env.get("MONRI_AUTHENTICITY_TOKEN");

    if (!MONRI_MERCHANT_KEY || !MONRI_AUTHENTICITY_TOKEN) {
      return json(req, { error: "card_unavailable", reason: "not_configured" }, 503);
    }

    const body: Body = await req.json().catch(() => ({}));
    if (!body.order_id || !body.session_id || !body.session_token) {
      return json(req, { error: "order_id, session_id and session_token are required" }, 400);
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Session validation, order eligibility, amount calculation and attempt
    // de-duplication all happen server-side inside this one call.
    const { data: attempt, error: attemptError } = await admin.rpc("monri_register_attempt", {
      _order_id: body.order_id,
      _session_id: body.session_id,
      _session_token: body.session_token,
      _currency: (body.currency || Deno.env.get("MONRI_CURRENCY") || "BAM").toUpperCase(),
      _transaction_type: body.transaction_type === "authorize" ? "authorize" : "purchase",
    });

    if (attemptError) throw attemptError;

    switch (attempt?.status) {
      case "ok":
        break;
      case "card_disabled":
        return json(req, { error: "card_unavailable", reason: "disabled" }, 503);
      case "invalid_session":
        return json(req, { error: "invalid_session" }, 403);
      case "order_not_found":
        return json(req, { error: "order_not_found" }, 404);
      case "already_paid":
        return json(req, { error: "already_paid" }, 409);
      case "not_payable":
        return json(req, { error: "not_payable", order_status: attempt.order_status }, 409);
      default:
        return json(req, { error: "attempt_failed", detail: attempt?.status ?? "unknown" }, 500);
    }

    // Reusing a live attempt: hand back the client secret we already have
    // rather than opening a second payment at the provider.
    if (attempt.reuse && attempt.provider_payload?.client_secret) {
      return json(req, {
        ok: true,
        reused: true,
        payment_transaction_id: attempt.payment_transaction_id,
        monri_order_number: attempt.monri_order_number,
        client_secret: attempt.provider_payload.client_secret,
        authenticity_token: MONRI_AUTHENTICITY_TOKEN,
        environment: monriEnvironment(),
        amount_minor: attempt.amount_minor,
        currency: attempt.currency,
      });
    }

    const payload: Record<string, unknown> = {
      amount: attempt.amount_minor,
      order_number: attempt.monri_order_number,
      currency: attempt.currency,
      transaction_type: body.transaction_type === "authorize" ? "authorize" : "purchase",
      order_info: `La Soul order ${attempt.monri_order_number}`,
    };
    const callbackUrl = Deno.env.get("MONRI_CALLBACK_URL");
    if (callbackUrl) payload.callback_url_override = callbackUrl;

    const requestBody = JSON.stringify(payload);
    const authorization = await authorizationHeader(
      MONRI_MERCHANT_KEY,
      MONRI_AUTHENTICITY_TOKEN,
      CREATE_PATH,
      requestBody,
    );

    const monriResponse = await fetch(`${monriBaseUrl()}${CREATE_PATH}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: authorization },
      body: requestBody,
    });

    const responseBody = await monriResponse.json().catch(() => ({}));
    const ok = monriResponse.ok && responseBody?.status !== "error" && !!responseBody?.client_secret;

    await admin.rpc("monri_record_attempt_response", {
      _payment_transaction_id: attempt.payment_transaction_id,
      _ok: ok,
      _monri_payment_id: typeof responseBody?.id === "string" ? responseBody.id : null,
      _payload: responseBody ?? {},
    });

    if (!ok) {
      // Deliberately do not forward the provider body to the browser; it can
      // contain merchant-side detail the guest has no business seeing.
      console.error("monri create-payment failed", {
        http: monriResponse.status,
        status: responseBody?.status,
        order_number: attempt.monri_order_number,
      });
      return json(req, { error: "payment_start_failed" }, 502);
    }

    return json(req, {
      ok: true,
      reused: false,
      payment_transaction_id: attempt.payment_transaction_id,
      monri_payment_id: responseBody.id ?? null,
      monri_order_number: attempt.monri_order_number,
      client_secret: responseBody.client_secret,
      authenticity_token: MONRI_AUTHENTICITY_TOKEN,
      environment: monriEnvironment(),
      amount_minor: attempt.amount_minor,
      currency: attempt.currency,
    });
  } catch (error) {
    console.error("monri-create-payment error", error);
    return json(req, { error: "server_error" }, 500);
  }
});
