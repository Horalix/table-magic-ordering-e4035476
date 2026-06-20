import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface Body {
  order_id?: string;
  session_id?: string;
  session_token?: string;
  currency?: string;
  transaction_type?: "purchase" | "authorize";
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const sha512Hex = async (value: string) => {
  const data = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-512", data);
  return Array.from(new Uint8Array(hash))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};

const monriBaseUrl = () => {
  const configured = Deno.env.get("MONRI_API_BASE_URL");
  if (configured) return configured.replace(/\/$/, "");
  return Deno.env.get("MONRI_ENVIRONMENT") === "production"
    ? "https://ipg.monri.com"
    : "https://ipgtest.monri.com";
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const MONRI_MERCHANT_KEY = Deno.env.get("MONRI_MERCHANT_KEY");
    const MONRI_AUTHENTICITY_TOKEN = Deno.env.get("MONRI_AUTHENTICITY_TOKEN");

    if (!MONRI_MERCHANT_KEY || !MONRI_AUTHENTICITY_TOKEN) {
      return json({ error: "Monri is not configured" }, 501);
    }

    const body: Body = await req.json().catch(() => ({}));
    if (!body.order_id || !body.session_id || !body.session_token) {
      return json({ error: "order_id, session_id and session_token are required" }, 400);
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: order, error: orderError } = await admin
      .from("orders")
      .select("id,total,payment_status,table_session_id,table_sessions!inner(id,token,is_active,tables(table_number))")
      .eq("id", body.order_id)
      .eq("table_session_id", body.session_id)
      .maybeSingle();

    if (orderError) throw orderError;
    if (!order || !order.table_sessions?.is_active || order.table_sessions.token !== body.session_token) {
      return json({ error: "Invalid or expired table session" }, 403);
    }
    if (order.payment_status === "paid") {
      return json({ error: "Order is already paid" }, 409);
    }

    const amountMinor = Math.round(Number(order.total) * 100);
    if (!Number.isFinite(amountMinor) || amountMinor <= 0) {
      return json({ error: "Invalid order total" }, 400);
    }

    const currency = (body.currency || Deno.env.get("MONRI_CURRENCY") || "BAM").toUpperCase();
    const transactionType = body.transaction_type || "purchase";
    const monriOrderNumber = `LS-${order.id.slice(0, 8)}-${Date.now().toString(36)}`;

    const { data: paymentAttempt, error: txError } = await admin
      .from("payment_transactions")
      .insert({
        order_id: order.id,
        monri_order_number: monriOrderNumber,
        amount_minor: amountMinor,
        currency,
        transaction_type: transactionType,
        status: "created",
      })
      .select("id")
      .single();

    if (txError) throw txError;

    const fullPath = "/v2/payment/new";
    const callbackUrl = Deno.env.get("MONRI_CALLBACK_URL");
    const payload: Record<string, unknown> = {
      amount: amountMinor,
      order_number: monriOrderNumber,
      currency,
      transaction_type: transactionType,
      order_info: `La Soul order ${order.id}`,
    };
    if (callbackUrl) payload.callback_url_override = callbackUrl;

    const requestBody = JSON.stringify(payload);
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const digest = await sha512Hex(
      MONRI_MERCHANT_KEY + timestamp + MONRI_AUTHENTICITY_TOKEN + fullPath + requestBody,
    );

    const monriResponse = await fetch(`${monriBaseUrl()}${fullPath}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `WP3-v2.1 ${MONRI_AUTHENTICITY_TOKEN} ${timestamp} ${digest}`,
      },
      body: requestBody,
    });

    const responseBody = await monriResponse.json().catch(() => ({}));

    if (!monriResponse.ok || responseBody.status === "error") {
      await admin
        .from("payment_transactions")
        .update({ status: "error", provider_payload: responseBody, updated_at: new Date().toISOString() })
        .eq("id", paymentAttempt.id);
      return json({ error: "Monri payment creation failed", details: responseBody }, 502);
    }

    await admin
      .from("payment_transactions")
      .update({
        monri_payment_id: responseBody.id ?? null,
        status: "pending",
        provider_payload: responseBody,
        updated_at: new Date().toISOString(),
      })
      .eq("id", paymentAttempt.id);

    await admin
      .from("orders")
      .update({ payment_method: "card", payment_status: "pending" })
      .eq("id", order.id);

    return json({
      ok: true,
      payment_transaction_id: paymentAttempt.id,
      monri_payment_id: responseBody.id,
      monri_order_number: monriOrderNumber,
      client_secret: responseBody.client_secret,
      authenticity_token: MONRI_AUTHENTICITY_TOKEN,
      environment: Deno.env.get("MONRI_ENVIRONMENT") === "production" ? "production" : "test",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Server error";
    return json({ error: message }, 500);
  }
});

