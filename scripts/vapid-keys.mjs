#!/usr/bin/env node
/**
 * Make the VAPID key pair for lock-screen alerts (notify-staff).
 *
 *   npm run vapid:keys
 *
 * Prints both keys to this terminal and writes nothing. Paste them into the
 * Edge Function secrets VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY, with
 * VAPID_SUBJECT set to a mailto: address the push services can write to.
 * The private key goes there and nowhere else: not into the repository, a
 * chat or a document (scripts/scan-secrets.mjs refuses it in a commit).
 *
 * A new pair invalidates every phone that turned alerts on with the old one;
 * each waiter then turns them on again with one tap.
 */
import { webcrypto } from 'node:crypto';

const b64url = (bytes) => Buffer.from(bytes).toString('base64url');
const { publicKey, privateKey } = await webcrypto.subtle.generateKey(
  { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);

console.log(`VAPID_PUBLIC_KEY   ${b64url(new Uint8Array(await webcrypto.subtle.exportKey('raw', publicKey)))}`);
console.log(`VAPID_PRIVATE_KEY  ${(await webcrypto.subtle.exportKey('jwk', privateKey)).d}`);
console.log('VAPID_SUBJECT      mailto:<an address you read>');
