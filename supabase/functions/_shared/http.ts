/**
 * Shared HTTP helpers for La Soul Edge Functions.
 *
 * CORS is allow-listed rather than `*`: these functions move money, and a
 * wildcard invites any origin to drive them with a guest's session token.
 * Set ALLOWED_ORIGINS (comma separated) as an Edge Function secret; it falls
 * back to the production domain plus localhost for development.
 */

/**
 * Where the app is actually served: Netlify (lasoulapp.netlify.app) now, the
 * La Soul domains later, and Lovable's own preview. With only
 * order.lasoul.net here, a browser on any of these was refused by every
 * function behind this list (card payment, Translate menu) unless
 * ALLOWED_ORIGINS had been set by hand.
 */
const DEFAULT_ORIGINS = [
  "https://lasoul.net",
  "https://www.lasoul.net",
  "https://menu.lasoul.net",
  "https://order.lasoul.net",
  "https://lasoulapp.netlify.app",
  // Vera Italia's own site (src/lib/home-venue.ts): its admin adds waiters there.
  "https://veraitalia.net",
  "https://www.veraitalia.net",
  "https://table-magic-ordering.lovable.app",
  "http://localhost:8080",
  "http://localhost:5173",
];

export function allowedOrigins(): string[] {
  const configured = Deno.env.get("ALLOWED_ORIGINS");
  if (!configured) return DEFAULT_ORIGINS;
  return configured.split(",").map((o) => o.trim()).filter(Boolean);
}

export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  const list = allowedOrigins();
  const allow = list.includes(origin) ? origin : list[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    // GET: the Monri readiness check on Admin → Service.
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Vary": "Origin",
  };
}

export function json(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), "Content-Type": "application/json" },
  });
}

export async function sha512Hex(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-512", data);
  return Array.from(new Uint8Array(hash))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** Constant-time-ish comparison for digests. */
export function safeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return diff === 0;
}
