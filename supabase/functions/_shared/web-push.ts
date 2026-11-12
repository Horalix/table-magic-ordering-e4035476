/**
 * Web Push from an Edge Function, with nothing but WebCrypto.
 *
 * A push message is encrypted for one browser (RFC 8291, `aes128gcm`) and
 * signed by the server's VAPID key (RFC 8292), then POSTed to the address the
 * browser's push service gave it. No library: the npm ones lean on Node's
 * crypto, and this is about a hundred lines that the same WebCrypto runs in
 * the edge runtime and in the unit tests (src/lib/web-push.test.ts, which
 * reproduces RFC 8291's own worked example byte for byte).
 *
 * The VAPID private key lives in the function's secrets and nowhere else —
 * never in the repository (scripts/scan-secrets.mjs refuses it).
 */

export interface PushKeys {
  /** The browser's P-256 public key, base64url (65 bytes, uncompressed). */
  p256dh: string;
  /** The browser's 16-byte authentication secret, base64url. */
  auth: string;
}

export interface PushTarget {
  endpoint: string;
  keys: PushKeys;
}

export interface Vapid {
  /** base64url P-256 public key, 65 bytes uncompressed — what the browser subscribes with. */
  publicKey: string;
  /** base64url 32-byte private scalar. */
  privateKey: string;
  /** Who the push services can contact: `mailto:` or `https:`. */
  subject: string;
}

export interface PushOptions {
  /** Seconds the push service keeps the message for a phone that is offline. */
  ttl: number;
  /** `high` makes Android and iOS deliver at once, even in battery saving. */
  urgency?: "very-low" | "low" | "normal" | "high";
}

export interface PushResult {
  endpoint: string;
  /** The push service's answer; 0 when it was never reached. */
  status: number;
  ok: boolean;
  /** The subscription no longer exists (404/410) or never could: remove it. */
  gone: boolean;
  error?: string;
}

/** One record; the push services accept 4 KB bodies, the payload is far smaller. */
const RECORD_SIZE = 4096;
const MAX_PLAINTEXT = 3000;
const enc = new TextEncoder();

/**
 * The push services browsers actually use: Chrome and Android (FCM), Firefox
 * (Mozilla), Safari and iOS (Apple), Edge (Windows). A waiter's phone can
 * only ever hand over one of these; anything else is not posted to, so a
 * stored "subscription" cannot point the function at some other server.
 */
const PUSH_HOSTS = ["googleapis.com", "mozilla.com", "push.apple.com", "notify.windows.com"];

export function isPushService(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    if (url.protocol !== "https:" || (url.port && url.port !== "443")) return false;
    const host = url.hostname.toLowerCase();
    return PUSH_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

export function toB64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Tolerates padding, whitespace and plain base64: keys get pasted. */
export function fromB64url(value: string) {
  const clean = value.replace(/[\s=]+/g, "").replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(clean + "=".repeat((4 - (clean.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

/** A copy in its own ArrayBuffer: what WebCrypto and fetch accept in every runtime's types. */
const owned = (bytes: Uint8Array): ArrayBuffer => bytes.slice().buffer as ArrayBuffer;

function concat(...parts: Uint8Array[]) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

const isPoint = (raw: Uint8Array) => raw.length === 65 && raw[0] === 4;

/** An uncompressed P-256 point as the x/y of a JWK. */
function pointJwk(raw: Uint8Array): JsonWebKey {
  if (!isPoint(raw)) throw new Error("not an uncompressed P-256 public key");
  return { kty: "EC", crv: "P-256", x: toB64url(raw.slice(1, 33)), y: toB64url(raw.slice(33, 65)), ext: true };
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, bytes: number) {
  const key = await crypto.subtle.importKey("raw", owned(ikm), "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: owned(salt), info: owned(info) }, key, bytes * 8);
  return new Uint8Array(bits);
}

/** The keys a browser handed over are the right shape to encrypt for. */
export function validKeys(keys: Partial<PushKeys> | null | undefined): keys is PushKeys {
  try {
    return !!keys && typeof keys.p256dh === "string" && typeof keys.auth === "string"
      && isPoint(fromB64url(keys.p256dh)) && fromB64url(keys.auth).length === 16;
  } catch {
    return false;
  }
}

/** Fixed inputs, for reproducing RFC 8291's example; a real message draws both at random. */
export interface FixedEncryption {
  salt: string;
  serverPublicKey: string;
  serverPrivateKey: string;
}

/** RFC 8291: the body of one push message, readable only by the browser with these keys. */
export async function encryptPayload(plaintext: Uint8Array, keys: PushKeys, fixed?: FixedEncryption) {
  if (plaintext.length > MAX_PLAINTEXT) throw new Error(`push payload is ${plaintext.length} bytes; at most ${MAX_PLAINTEXT}`);
  if (!validKeys(keys)) throw new Error("subscription keys are not a P-256 key and a 16-byte secret");
  const uaPublic = fromB64url(keys.p256dh);
  const authSecret = fromB64url(keys.auth);
  const salt = fixed ? fromB64url(fixed.salt) : crypto.getRandomValues(new Uint8Array(16));

  // A fresh key pair for every message, so no two messages share a key.
  let serverPrivate: CryptoKey;
  let serverPublic: Uint8Array;
  if (fixed) {
    serverPublic = fromB64url(fixed.serverPublicKey);
    serverPrivate = await crypto.subtle.importKey(
      "jwk", { ...pointJwk(serverPublic), d: fixed.serverPrivateKey.replace(/=+$/, "") },
      { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
  } else {
    const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]) as CryptoKeyPair;
    serverPrivate = pair.privateKey;
    serverPublic = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  }

  const browserKey = await crypto.subtle.importKey("raw", owned(uaPublic), { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: browserKey }, serverPrivate, 256));
  const ikm = await hkdf(authSecret, ecdhSecret, concat(enc.encode("WebPush: info\0"), uaPublic, serverPublic), 32);
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);

  const aes = await crypto.subtle.importKey("raw", owned(cek), "AES-GCM", false, ["encrypt"]);
  // 0x02: the last (and only) record, no padding.
  const sealed = await crypto.subtle.encrypt({ name: "AES-GCM", iv: owned(nonce) }, aes, owned(concat(plaintext, new Uint8Array([2]))));

  // salt (16) | record size (4) | key id length (1) | key id: the server's public key (65)
  const header = new Uint8Array(21 + serverPublic.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, RECORD_SIZE);
  header[20] = serverPublic.length;
  header.set(serverPublic, 21);
  return concat(header, new Uint8Array(sealed));
}

async function signingKey(vapid: Vapid) {
  return crypto.subtle.importKey(
    "jwk", { ...pointJwk(fromB64url(vapid.publicKey)), d: vapid.privateKey.trim().replace(/=+$/, "") },
    { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
}

/** RFC 8292: the Authorization header that proves this server may push to `endpoint`. */
export async function vapidAuthorization(endpoint: string, vapid: Vapid, now = Date.now()): Promise<string> {
  const part = (value: unknown) => toB64url(enc.encode(JSON.stringify(value)));
  // Twelve hours: the services refuse more than a day.
  const unsigned = `${part({ typ: "JWT", alg: "ES256" })}.${part({
    aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: vapid.subject,
  })}`;
  // WebCrypto's ECDSA signature is already JWS's r‖s form.
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, await signingKey(vapid), owned(enc.encode(unsigned)));
  return `vapid t=${unsigned}.${toB64url(new Uint8Array(signature))}, k=${vapid.publicKey.trim().replace(/=+$/, "")}`;
}

/**
 * The two VAPID secrets belong together and the subject is usable. A pasted
 * key from another pair signs happily and is refused by every push service,
 * so this signs once and checks the signature with the public key.
 */
export async function vapidReady(vapid: Partial<Vapid>): Promise<boolean> {
  if (!vapid.publicKey || !vapid.privateKey || !vapid.subject || !/^(mailto:|https:)/.test(vapid.subject)) return false;
  try {
    const sample = owned(enc.encode("vapid"));
    const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, await signingKey(vapid as Vapid), sample);
    const verify = await crypto.subtle.importKey(
      "raw", owned(fromB64url(vapid.publicKey)), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    return await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, verify, signature, sample);
  } catch {
    return false;
  }
}

/** The request one push message is, for a fetch of the caller's choosing. */
export async function pushRequest(target: PushTarget, payload: unknown, vapid: Vapid, options: PushOptions, now = Date.now()) {
  const body = await encryptPayload(enc.encode(JSON.stringify(payload)), target.keys);
  const init: RequestInit = {
    method: "POST",
    headers: {
      Authorization: await vapidAuthorization(target.endpoint, vapid, now),
      TTL: String(Math.max(0, Math.round(options.ttl))),
      Urgency: options.urgency ?? "high",
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
    },
    body: owned(body),
  };
  return { url: target.endpoint, init };
}

/** Send one message. Never throws: the answer says what happened and whether to forget the subscription. */
export async function sendPush(
  target: PushTarget, payload: unknown, vapid: Vapid, options: PushOptions, fetcher: typeof fetch = fetch,
): Promise<PushResult> {
  const result = (status: number, error?: string, gone = status === 404 || status === 410): PushResult =>
    ({ endpoint: target.endpoint, status, ok: status >= 200 && status < 300, gone, error });
  if (!isPushService(target.endpoint)) return result(0, "not a push service address", true);
  if (!validKeys(target.keys)) return result(0, "unusable subscription keys", true);
  try {
    const { url, init } = await pushRequest(target, payload, vapid, options);
    const response = await fetcher(url, init);
    const text = await response.text().catch(() => "");
    return response.ok ? result(response.status) : result(response.status, text.slice(0, 200) || response.statusText);
  } catch (error) {
    return result(0, error instanceof Error ? error.message : String(error), false);
  }
}
