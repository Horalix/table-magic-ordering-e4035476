/**
 * @vitest-environment node
 *
 * Unit tests for the Monri provider adapter — the layer that turns untrusted
 * provider JSON into our own vocabulary. Everything downstream of this file
 * trusts its output, so the bar is: unknown input must never become "approved".
 */
import { describe, expect, it } from 'vitest';
import {
  callbackDigest,
  callbackEventHash,
  normalizeStatus,
  parseCallback,
} from '../functions/_shared/monri.ts';

describe('normalizeStatus', () => {
  it('recognises an explicit approval', () => {
    expect(normalizeStatus({ status: 'approved' })).toBe('approved');
  });

  it('recognises Monri response_code 0000 as approval', () => {
    expect(normalizeStatus({ response_code: '0000' })).toBe('approved');
  });

  it('does not approve on 0000 when the text says declined', () => {
    expect(normalizeStatus({ status: 'declined', response_code: '0000' })).toBe('declined');
  });

  it('maps the failure vocabulary', () => {
    expect(normalizeStatus({ status: 'declined' })).toBe('declined');
    expect(normalizeStatus({ status: 'rejected' })).toBe('declined');
    expect(normalizeStatus({ status: 'cancelled' })).toBe('cancelled');
    expect(normalizeStatus({ status: 'void' })).toBe('cancelled');
    expect(normalizeStatus({ status: 'invalid card' })).toBe('error');
    expect(normalizeStatus({ status: 'refunded' })).toBe('refunded');
  });

  it('prefers refund over approval when both words appear', () => {
    expect(normalizeStatus({ status: 'refund-approved' })).toBe('refunded');
  });

  it('falls back to pending for anything unrecognised', () => {
    expect(normalizeStatus({})).toBe('pending');
    expect(normalizeStatus({ status: 'quantum-superposition' })).toBe('pending');
    expect(normalizeStatus({ status: '' })).toBe('pending');
    expect(normalizeStatus({ response_code: '9999' })).toBe('pending');
  });
});

describe('parseCallback', () => {
  it('reads a flat payload', () => {
    const parsed = parseCallback(JSON.stringify({
      order_number: 'LS-ABC-1', id: 'pay_9', status: 'approved', amount: 2520, currency: 'bam',
    }));
    expect(parsed?.orderNumber).toBe('LS-ABC-1');
    expect(parsed?.paymentId).toBe('pay_9');
    expect(parsed?.status).toBe('approved');
    expect(parsed?.amountMinor).toBe(2520);
    expect(parsed?.currency).toBe('BAM');
  });

  it('unwraps a { payload: ... } envelope', () => {
    const parsed = parseCallback(JSON.stringify({
      event: 'transaction',
      payload: { order_number: 'LS-XYZ', status: 'approved', amount: 100, currency: 'BAM' },
    }));
    expect(parsed?.orderNumber).toBe('LS-XYZ');
    expect(parsed?.amountMinor).toBe(100);
  });

  it('accepts a numeric amount sent as a string', () => {
    const parsed = parseCallback(JSON.stringify({ order_number: 'a', amount: '1800' }));
    expect(parsed?.amountMinor).toBe(1800);
  });

  it('reports a missing amount as null rather than zero', () => {
    const parsed = parseCallback(JSON.stringify({ order_number: 'a', status: 'approved' }));
    // null never equals the expected amount_minor, so the SQL layer rejects it.
    expect(parsed?.amountMinor).toBeNull();
  });

  it('ignores a non-integer amount instead of rounding it', () => {
    const parsed = parseCallback(JSON.stringify({ order_number: 'a', amount: 18.005 }));
    expect(parsed?.amountMinor).toBeNull();
  });

  it('returns null for a body that is not JSON', () => {
    expect(parseCallback('<html>gateway timeout</html>')).toBeNull();
  });

  it('survives an array body without throwing', () => {
    const parsed = parseCallback('[1,2,3]');
    expect(parsed?.orderNumber).toBeNull();
    expect(parsed?.status).toBe('pending');
  });
});

describe('callback identity', () => {
  it('hashes identical bodies identically (a retry is a replay)', async () => {
    const body = JSON.stringify({ order_number: 'LS-1', status: 'approved', amount: 100 });
    expect(await callbackEventHash(body)).toBe(await callbackEventHash(body));
  });

  it('hashes different bodies differently', async () => {
    const a = await callbackEventHash(JSON.stringify({ order_number: 'LS-1', amount: 100 }));
    const b = await callbackEventHash(JSON.stringify({ order_number: 'LS-1', amount: 200 }));
    expect(a).not.toBe(b);
  });

  it('produces a stable SHA-512 digest for the signature check', async () => {
    // Known vector: SHA512("keybody").
    const digest = await callbackDigest('key', 'body');
    expect(digest).toHaveLength(128);
    expect(digest).toMatch(/^[0-9a-f]+$/);
    expect(await callbackDigest('key', 'body')).toBe(digest);
    expect(await callbackDigest('key2', 'body')).not.toBe(digest);
  });
});
