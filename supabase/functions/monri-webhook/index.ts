import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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

const safeEqual = (left: string, right: string) => {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) {
    diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  }
  return diff === 0;
};

const pickString = (payload: Record<string, unknown>, keys: string[]) => {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return null;
};

const normalizeStatus = (payload: Record<string, unknown>) => {
  const raw = String(
    payload.status ?? payload.transaction_status ?? payload.event ?? payload.event_type ?? "",
  ).toLowerCase();
  const responseCode = String(payload.response_code ?? payload.responseCode ?? "");

  if (raw.includes("approved") || raw === "approve" || responseCode === "0000") return "approved";
  if (raw.includes("declined") || raw.includes("reject")) return "declined";
  if (raw.includes("cancel")) return "cancelled";
  if (raw.includes("refund")) return "refunded";
  if (raw.includes("error") || raw.includes("fail")) return "error";
  return "pending";
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const MONRI_MERCHANT_KEY = Deno.env.get("MONRI_MERCHANT_KEY");

    if (!MONRI_MERCHANT_KEY) return json({ error: "Monri is not configured" }, 501);

    const bodyText = await req.text();
    const authorization = req.headers.get("authorization") || "";
    const providedDigest = authorization.trim().split(/\s+/).pop() || "";
    const expectedDigest = await sha512Hex(MONRI_MERCHANT_KEY + bodyText);

    if (!authorization.startsWith("WP3-callback") || !safeEqual(providedDigest, expectedDigest)) {
      return json({ error: "Invalid callback signature" }, 401);
    }

    const parsed = JSON.parse(bodyText) as Record<string, unknown>;
    const payload = (parsed.payload && typeof parsed.payload === "object")
      ? parsed.payload as Record<string, unknown>
      : parsed;
    const monriOrderNumber = pickString(payload, ["order_number", "orderNumber", "order"]);
    const monriPaymentId = pickString(payload, ["id", "payment_id", "paymentId", "transaction_id"]);

    if (!monriOrderNumber) {
      return json({ error: "Missing order_number" }, 400);
    }

    const status = normalizeStatus(payload);
    const paymentStatus = status === "approved"
      ? "paid"
      : status === "pending"
        ? "pending"
        : status;

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: transaction, error: findError } = await admin
      .from("payment_transactions")
      .select("id,order_id")
      .eq("monri_order_number", monriOrderNumber)
      .maybeSingle();

    if (findError) throw findError;
    if (!transaction) return json({ error: "Payment transaction not found" }, 404);

    const { error: updateError } = await admin
      .from("payment_transactions")
      .update({
        monri_payment_id: monriPaymentId,
        status,
        provider_payload: parsed,
        updated_at: new Date().toISOString(),
      })
      .eq("id", transaction.id);

    if (updateError) throw updateError;

    const { error: orderError } = await admin
      .from("orders")
      .update({ payment_status: paymentStatus })
      .eq("id", transaction.order_id);

    if (orderError) throw orderError;

    return json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Server error";
    return json({ error: message }, 500);
  }
});

