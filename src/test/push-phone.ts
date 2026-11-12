/**
 * A phone's side of Web Push, for tests: its keys, and reading what a push
 * service hands it (RFC 8291, the receiving half of
 * supabase/functions/_shared/web-push.ts).
 */
import { fromB64url, toB64url } from '../../supabase/functions/_shared/web-push.ts';

const subtle = globalThis.crypto.subtle;
const enc = new TextEncoder();
const own = (b: Uint8Array) => b.slice().buffer as ArrayBuffer;

/** A P-256 key pair in the shape VAPID keys and browser keys are handed around (base64url). */
export async function p256(usage: 'ECDH' | 'ECDSA') {
  const pair = await subtle.generateKey({ name: usage, namedCurve: 'P-256' }, true,
    usage === 'ECDH' ? ['deriveBits'] : ['sign', 'verify']) as CryptoKeyPair;
  const publicKey = toB64url(new Uint8Array(await subtle.exportKey('raw', pair.publicKey)));
  const privateKey = (await subtle.exportKey('jwk', pair.privateKey)).d as string;
  return { publicKey, privateKey };
}

export interface TestPhone {
  publicKey: string;
  privateKey: string;
  auth: string;
}

export async function newPhone(): Promise<TestPhone> {
  return { ...(await p256('ECDH')), auth: toB64url(globalThis.crypto.getRandomValues(new Uint8Array(16))) };
}

/** What the phone reads from a push body, with its private key and secret and nothing else. */
export async function phoneReads(body: Uint8Array, phone: TestPhone): Promise<string> {
  const hkdf = async (salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, n: number) => new Uint8Array(await subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: own(salt), info: own(info) },
    await subtle.importKey('raw', own(ikm), 'HKDF', false, ['deriveBits']), n * 8));
  const salt = body.slice(0, 16);
  const idLength = body[20];
  const serverPublic = body.slice(21, 21 + idLength);
  const raw = fromB64url(phone.publicKey);
  const me = await subtle.importKey('jwk', {
    kty: 'EC', crv: 'P-256', x: toB64url(raw.slice(1, 33)), y: toB64url(raw.slice(33)), d: phone.privateKey,
  }, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
  const them = await subtle.importKey('raw', own(serverPublic), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const secret = new Uint8Array(await subtle.deriveBits({ name: 'ECDH', public: them }, me, 256));
  const info = new Uint8Array([...enc.encode('WebPush: info\0'), ...raw, ...serverPublic]);
  const ikm = await hkdf(fromB64url(phone.auth), secret, info, 32);
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const key = await subtle.importKey('raw', own(cek), 'AES-GCM', false, ['decrypt']);
  const padded = new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: own(nonce) }, key, own(body.slice(21 + idLength))));
  if (padded[padded.length - 1] !== 2) throw new Error('not the last record');
  return new TextDecoder().decode(padded.slice(0, -1));
}
