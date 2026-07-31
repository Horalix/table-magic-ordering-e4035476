/**
 * Typed Monri provider adapter.
 *
 * Everything crossing the network from Monri is untrusted input: it is parsed
 * defensively here and normalised into our own vocabulary before any code in
 * the database sees it. Card data never passes through this file — the guest
 * enters it in Monri-hosted fields (Components SDK).
 *
 * Reference: Monri WP3 / Components documentation. Every field name we accept
 * is listed explicitly so a provider-side rename fails loudly instead of
 * silently approving a payment.
 */
import { sha512Hex } from "./http.ts";

export type MonriEnvironment = "test" | "production";

/** Our internal payment status vocabulary. Mirrors payment_status_rank() in SQL. */
export type NormalizedStatus =
  | "pending"
  | "approved"
  | "declined"
  | "cancelled"
  | "refunded"
  | "error";

export function monriEnvironment(): MonriEnvironment {
  return Deno.env.get("MONRI_ENVIRONMENT") === "production" ? "production" : "test";
}

export function monriBaseUrl(): string {
  const configured = Deno.env.get("MONRI_API_BASE_URL");
  if (configured) return configured.replace(/\/$/, "");
  return monriEnvironment() === "production" ? "https://ipg.monri.com" : "https://ipgtest.monri.com";
}

/**
 * WP3-v2.1 authorization digest:
 *   SHA512(merchant_key + timestamp + authenticity_token + full_path + body)
 */
export async function authorizationHeader(
  merchantKey: string,
  authenticityToken: string,
  fullPath: string,
  body: string,
): Promise<string> {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const digest = await sha512Hex(merchantKey + timestamp + authenticityToken + fullPath + body);
  return `WP3-v2.1 ${authenticityToken} ${timestamp} ${digest}`;
}

/** Callback digest: SHA512(merchant_key + raw_body). */
export async function callbackDigest(merchantKey: string, rawBody: string): Promise<string> {
  return await sha512Hex(merchantKey + rawBody);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function pickString(payload: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

function pickInt(payload: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "number" && Number.isInteger(value)) return value;
    if (typeof value === "string" && /^-?\d+$/.test(value.trim())) return Number.parseInt(value, 10);
  }
  return null;
}

/**
 * Map a provider payload onto our status vocabulary.
 *
 * Deliberately conservative: anything we do not positively recognise as a
 * terminal state stays `pending`, because "pending" never releases food and
 * never marks money as received.
 */
export function normalizeStatus(payload: Record<string, unknown>): NormalizedStatus {
  const raw = String(
    payload.status ?? payload.transaction_status ?? payload.event ?? payload.event_type ?? "",
  ).toLowerCase();
  const responseCode = String(payload.response_code ?? payload.responseCode ?? "").trim();

  if (raw.includes("refund")) return "refunded";
  if (raw.includes("approved") || raw === "approve") return "approved";
  // Monri signals success with response_code "0000".
  if (responseCode === "0000" && !raw.includes("declin") && !raw.includes("error")) return "approved";
  if (raw.includes("declin") || raw.includes("reject")) return "declined";
  if (raw.includes("cancel") || raw.includes("void")) return "cancelled";
  if (raw.includes("error") || raw.includes("fail") || raw.includes("invalid")) return "error";
  return "pending";
}

export interface ParsedCallback {
  /** Envelope as received, for the audit ledger. */
  raw: Record<string, unknown>;
  /** The transaction body, unwrapped from an optional { payload: ... } envelope. */
  payload: Record<string, unknown>;
  orderNumber: string | null;
  paymentId: string | null;
  status: NormalizedStatus;
  /** Minor units (fening). Null when the provider did not send an amount. */
  amountMinor: number | null;
  currency: string | null;
}

export function parseCallback(rawBody: string): ParsedCallback | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return null;
  }

  const envelope = asRecord(parsed);
  const payload = Object.keys(asRecord(envelope.payload)).length > 0
    ? asRecord(envelope.payload)
    : envelope;

  return {
    raw: envelope,
    payload,
    orderNumber: pickString(payload, ["order_number", "orderNumber", "order"]),
    paymentId: pickString(payload, ["id", "payment_id", "paymentId", "transaction_id"]),
    status: normalizeStatus(payload),
    amountMinor: pickInt(payload, ["amount", "amount_minor", "authorized_amount"]),
    currency: (pickString(payload, ["currency", "currency_code"]) ?? "").toUpperCase() || null,
  };
}

/**
 * Deterministic identity for a callback, used as the replay key.
 *
 * Hashing the raw body means a byte-identical provider retry collides, while a
 * genuinely new event (different amount, status or timestamp) does not.
 */
export async function callbackEventHash(rawBody: string): Promise<string> {
  return await sha512Hex("monri-callback:" + rawBody);
}
