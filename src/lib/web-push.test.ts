/**
 * @vitest-environment node
 *
 * Web Push from the notify-staff function (supabase/functions/_shared/web-push.ts).
 *
 * The encryption is checked against RFC 8291's own worked example, byte for
 * byte, and then end to end the way a phone reads it: the browser's half of
 * the key exchange decrypts what the function sent. The VAPID signature is
 * checked with the public key, as a push service checks it.
 */
import { describe, expect, it } from 'vitest';
import {
  encryptPayload, fromB64url, isPushService, sendPush, toB64url, validKeys, vapidAuthorization, vapidReady,
  type Vapid,
} from '../../supabase/functions/_shared/web-push.ts';
import { p256, phoneReads } from '@/test/push-phone';

const subtle = globalThis.crypto.subtle;
const enc = new TextEncoder();
const dec = new TextDecoder();
const own = (b: Uint8Array) => b.slice().buffer as ArrayBuffer;

/** RFC 8291, Appendix A (whitespace from the RFC's line wrapping removed). */
const RFC = {
  plaintext: 'V2hlbiBJIGdyb3cgdXAsIEkgd2FudCB0byBiZSBhIHdhdGVybWVsb24',
  asPublic: 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  uaPublic: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  uaPrivate: 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  header: 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  ciphertext: '8pfeW0KbunFT06SuDKoJH9Ql87S1QUrdirN6GcG7sFz1y1sqLgVi1VhjVkHsUoEsbI_0LpXMuGvnzQ',
};

const newVapid = async (): Promise<Vapid> => ({ ...(await p256('ECDSA')), subject: 'mailto:ops@lasoul.test' });

describe('encryption (RFC 8291)', () => {
  it('reproduces the RFC\'s worked example exactly', async () => {
    const body = await encryptPayload(fromB64url(RFC.plaintext), { p256dh: RFC.uaPublic, auth: RFC.auth }, {
      salt: RFC.salt, serverPublicKey: RFC.asPublic, serverPrivateKey: RFC.asPrivate,
    });
    expect(toB64url(body.slice(0, 86))).toBe(RFC.header);
    expect(toB64url(body.slice(86))).toBe(RFC.ciphertext);
  });

  it('the RFC\'s browser reads the RFC\'s message', async () => {
    const body = new Uint8Array([...fromB64url(RFC.header), ...fromB64url(RFC.ciphertext)]);
    expect(await phoneReads(body, { publicKey: RFC.uaPublic, privateKey: RFC.uaPrivate, auth: RFC.auth })).toBe('When I grow up, I want to be a watermelon');
  });

  it('a phone decrypts a real message, with a fresh key and salt each time', async () => {
    const phone = { ...(await p256('ECDH')), auth: '' };
    phone.auth = toB64url(globalThis.crypto.getRandomValues(new Uint8Array(16)));
    const { auth } = phone;
    const message = JSON.stringify({ title: 'New order · Table 7', body: '2× Ćevapi, 1× Espresso · 38.00 KM' });
    const one = await encryptPayload(enc.encode(message), { p256dh: phone.publicKey, auth });
    const two = await encryptPayload(enc.encode(message), { p256dh: phone.publicKey, auth });
    expect(toB64url(one)).not.toBe(toB64url(two));
    expect(await phoneReads(one, phone)).toBe(message);
    expect(await phoneReads(two, phone)).toBe(message);
  });

  it('refuses keys that are not a browser\'s, and payloads too big for a push', async () => {
    expect(validKeys({ p256dh: RFC.uaPublic, auth: RFC.auth })).toBe(true);
    expect(validKeys({ p256dh: RFC.uaPublic.slice(0, 40), auth: RFC.auth })).toBe(false);
    expect(validKeys({ p256dh: RFC.uaPublic, auth: 'c2hvcnQ' })).toBe(false);
    expect(validKeys(null)).toBe(false);
    await expect(encryptPayload(new Uint8Array(3001), { p256dh: RFC.uaPublic, auth: RFC.auth })).rejects.toThrow(/at most/);
  });
});

describe('VAPID (RFC 8292)', () => {
  it('signs a token for the push service\'s origin that the public key verifies', async () => {
    const vapid = await newVapid();
    const now = Date.UTC(2026, 10, 3, 19, 0);
    const header = await vapidAuthorization('https://fcm.googleapis.com/fcm/send/abc:def', vapid, now);
    const [, token, k] = header.match(/^vapid t=([^,]+), k=(.+)$/) ?? [];
    expect(k).toBe(vapid.publicKey);
    const [h, c, s] = token.split('.');
    expect(JSON.parse(dec.decode(fromB64url(h)))).toEqual({ typ: 'JWT', alg: 'ES256' });
    const claims = JSON.parse(dec.decode(fromB64url(c)));
    expect(claims.aud).toBe('https://fcm.googleapis.com');
    expect(claims.sub).toBe('mailto:ops@lasoul.test');
    expect(claims.exp - now / 1000).toBeGreaterThan(3600);
    expect(claims.exp - now / 1000).toBeLessThanOrEqual(24 * 3600);
    const verify = await subtle.importKey('raw', own(fromB64url(vapid.publicKey)), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    expect(await subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, verify, own(fromB64url(s)), own(enc.encode(`${h}.${c}`)))).toBe(true);
  });

  it('knows when the two secrets are not one pair, or the subject is missing', async () => {
    const one = await newVapid();
    const other = await newVapid();
    expect(await vapidReady(one)).toBe(true);
    expect(await vapidReady({ ...one, privateKey: other.privateKey })).toBe(false);
    expect(await vapidReady({ ...one, subject: 'ops@lasoul.test' })).toBe(false);
    expect(await vapidReady({ publicKey: one.publicKey, subject: one.subject })).toBe(false);
  });
});

describe('sending', () => {
  const phone = async () => ({
    endpoint: 'https://fcm.googleapis.com/fcm/send/phone-1',
    keys: { p256dh: (await p256('ECDH')).publicKey, auth: toB64url(globalThis.crypto.getRandomValues(new Uint8Array(16))) },
  });

  it('posts an encrypted, urgent message with a lifetime', async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const fetcher = (async (url: string, init: RequestInit) => {
      seen.push({ url, init });
      return new Response(null, { status: 201 });
    }) as unknown as typeof fetch;
    const result = await sendPush(await phone(), { title: 'x' }, await newVapid(), { ttl: 600 }, fetcher);
    expect(result).toMatchObject({ status: 201, ok: true, gone: false });
    expect(seen).toHaveLength(1);
    const headers = seen[0].init.headers as Record<string, string>;
    expect(seen[0].url).toBe('https://fcm.googleapis.com/fcm/send/phone-1');
    expect(headers).toMatchObject({ TTL: '600', Urgency: 'high', 'Content-Encoding': 'aes128gcm' });
    expect(headers.Authorization).toMatch(/^vapid t=.+, k=.+$/);
    expect(seen[0].init.body).toBeInstanceOf(ArrayBuffer);
  });

  it('says a subscription is gone when the push service says so (404, 410), and not otherwise', async () => {
    const answer = (status: number) => (async () => new Response('nope', { status })) as unknown as typeof fetch;
    const vapid = await newVapid();
    for (const status of [404, 410]) {
      expect(await sendPush(await phone(), {}, vapid, { ttl: 60 }, answer(status))).toMatchObject({ ok: false, gone: true, status });
    }
    for (const status of [400, 403, 413, 429, 500]) {
      expect(await sendPush(await phone(), {}, vapid, { ttl: 60 }, answer(status))).toMatchObject({ ok: false, gone: false, status });
    }
    const offline = (async () => { throw new TypeError('network down'); }) as unknown as typeof fetch;
    expect(await sendPush(await phone(), {}, vapid, { ttl: 60 }, offline)).toMatchObject({ ok: false, gone: false, status: 0 });
  });

  it('never posts anywhere but a browser push service', async () => {
    let called = false;
    const fetcher = (async () => { called = true; return new Response(null, { status: 201 }); }) as unknown as typeof fetch;
    const target = { ...(await phone()), endpoint: 'https://jgxnvrrphxnmzongtmzs.supabase.co/rest/v1/orders' };
    expect(await sendPush(target, {}, await newVapid(), { ttl: 60 }, fetcher)).toMatchObject({ ok: false, gone: true });
    expect(called).toBe(false);

    for (const ok of [
      'https://fcm.googleapis.com/fcm/send/x', 'https://updates.push.services.mozilla.com/wpush/v2/x',
      'https://web.push.apple.com/QH8', 'https://wns2-par02p.notify.windows.com/w/?token=x',
    ]) expect(isPushService(ok), ok).toBe(true);
    for (const bad of [
      'http://fcm.googleapis.com/fcm/send/x', 'https://evilgoogleapis.com/x', 'https://fcm.googleapis.com.evil.test/x',
      'https://fcm.googleapis.com:8443/x', 'https://localhost/x', 'not a url',
    ]) expect(isPushService(bad), bad).toBe(false);
  });
});
