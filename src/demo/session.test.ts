import { beforeEach, describe, expect, it } from 'vitest';
import { ACCOUNTS, areaForPath, guestTablePath, tableQrToken } from './brand';
import { identityFromHeaders } from './backend/auth';
import { demoAuthStorage, isSignedOut } from './session';

const KEY = 'sb-demo-auth-token';
const at = (path: string) => window.history.replaceState({}, '', path);

beforeEach(() => {
  localStorage.clear();
  at('/');
});

describe('which demo account a page belongs to', () => {
  it('gives each staff area its own, and guest pages none', () => {
    expect(areaForPath('/admin')).toBe('admin');
    expect(areaForPath('/admin/menu-intelligence')).toBe('admin');
    expect(areaForPath('/kitchen')).toBe('kitchen');
    expect(areaForPath('/waiter')).toBe('waiter');
    expect(areaForPath('/waiter/login')).toBe('waiter');
    expect(areaForPath('/waiter/monitor')).toBe('monitor');
    for (const path of ['/', '/menu/casademo/', '/cart', '/tab', '/table/5', '/tv', '/reserve', '/demo/stage']) {
      expect(areaForPath(path)).toBeNull();
    }
  });
});

describe('the demo’s sign-in storage', () => {
  it('signs the area’s account in the first time a staff page asks', () => {
    at('/kitchen');
    const session = JSON.parse(demoAuthStorage.getItem(KEY)!);
    expect(session.user.id).toBe(ACCOUNTS.kitchen.id);
    // The token is what the backend reads the caller from.
    expect(identityFromHeaders({ authorization: `Bearer ${session.access_token}` })).toEqual({
      role: 'authenticated', sub: ACCOUNTS.kitchen.id, email: ACCOUNTS.kitchen.email,
    });
    // Far enough ahead that the client never tries to refresh it against a server that is not there.
    expect(session.expires_at - Date.now() / 1000).toBeGreaterThan(365 * 24 * 3600);
  });

  it('keeps the areas apart, so the kitchen, a waiter and the owner can be open side by side', () => {
    at('/kitchen');
    const kitchen = JSON.parse(demoAuthStorage.getItem(KEY)!).user.id;
    at('/waiter');
    const waiter = JSON.parse(demoAuthStorage.getItem(KEY)!).user.id;
    at('/admin/orders');
    const owner = JSON.parse(demoAuthStorage.getItem(KEY)!).user.id;
    expect([kitchen, waiter, owner]).toEqual([ACCOUNTS.kitchen.id, ACCOUNTS.waiter.id, ACCOUNTS.admin.id]);
    at('/kitchen');
    expect(JSON.parse(demoAuthStorage.getItem(KEY)!).user.id).toBe(ACCOUNTS.kitchen.id);
  });

  it('signs nobody in on a guest page', () => {
    at('/menu/casademo/');
    expect(demoAuthStorage.getItem(KEY)).toBeNull();
  });

  it('remembers a sign-out for that area only, until someone signs in again', () => {
    at('/waiter');
    demoAuthStorage.getItem(KEY);
    demoAuthStorage.removeItem(KEY);
    expect(isSignedOut('waiter')).toBe(true);
    expect(demoAuthStorage.getItem(KEY)).toBeNull();
    at('/kitchen');
    expect(demoAuthStorage.getItem(KEY)).not.toBeNull();
    at('/waiter');
    demoAuthStorage.setItem(KEY, '{"user":{"id":"someone"}}');
    expect(isSignedOut('waiter')).toBe(false);
    expect(demoAuthStorage.getItem(KEY)).toBe('{"user":{"id":"someone"}}');
  });
});

describe('links to a table', () => {
  it('carry a token long enough for the schema and the same every time', () => {
    expect(tableQrToken(5)).toHaveLength(64);
    expect(tableQrToken(5)).toBe(tableQrToken(5));
    expect(tableQrToken(5)).not.toBe(tableQrToken(6));
    expect(guestTablePath()).toBe(`/table/5?token=${tableQrToken(5)}`);
  });
});
