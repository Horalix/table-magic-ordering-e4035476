import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chooseStaffVenue, rememberGuestVenue, venueFetch, venueForPath } from './current-venue';
import { activeVenue, menuHome, menuPath } from './venues';

describe('which restaurant a request is about', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => window.history.pushState({}, '', '/'));

  it('a menu page is its own restaurant’s', () => {
    expect(venueForPath('/menu/veraitalia/')).toBe('veraitalia');
    expect(venueForPath('/menu/lasoul/food/')).toBe('lasoul');
  });

  it('the rest of a guest’s visit is the restaurant of their table', () => {
    expect(venueForPath('/cart')).toBeNull();
    rememberGuestVenue('veraitalia');
    expect(venueForPath('/cart')).toBe('veraitalia');
    expect(venueForPath('/tab')).toBe('veraitalia');
    expect(venueForPath('/table/7')).toBe('veraitalia');
    // The website is La Soul's, whatever table the phone last sat at.
    expect(venueForPath('/')).toBeNull();
  });

  it('staff screens follow the owner’s pick, and nothing else', () => {
    rememberGuestVenue('veraitalia');
    expect(venueForPath('/kitchen')).toBeNull();
    chooseStaffVenue('veraitalia');
    expect(venueForPath('/admin/orders')).toBe('veraitalia');
    expect(venueForPath('/waiter')).toBe('veraitalia');
    chooseStaffVenue(null);
    expect(venueForPath('/admin')).toBeNull();
  });

  it('database requests carry it; edge functions and sign-in do not', async () => {
    const seen: (string | null)[] = [];
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      seen.push(new Headers(init?.headers).get('x-venue'));
      return new Response('[]');
    });
    window.history.pushState({}, '', '/menu/veraitalia/');
    try {
      await venueFetch('https://x.supabase.co/rest/v1/menu_items?select=*', { headers: { apikey: 'k' } });
      await venueFetch('https://x.supabase.co/rest/v1/rpc/guest_search_menu', { method: 'POST' });
      await venueFetch('https://x.supabase.co/functions/v1/create-waiter', { method: 'POST' });
      await venueFetch('https://x.supabase.co/auth/v1/token', { method: 'POST' });
    } finally {
      spy.mockRestore();
    }
    expect(seen).toEqual(['veraitalia', 'veraitalia', null, null]);
  });

  it('keeps the headers the request already had', async () => {
    let headers: Headers | null = null;
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      headers = new Headers(init?.headers);
      return new Response('[]');
    });
    window.history.pushState({}, '', '/menu/lasoul/');
    try {
      await venueFetch('https://x.supabase.co/rest/v1/orders', { headers: { apikey: 'k', Authorization: 'Bearer t' } });
    } finally {
      spy.mockRestore();
    }
    expect(headers!.get('apikey')).toBe('k');
    expect(headers!.get('authorization')).toBe('Bearer t');
    expect(headers!.get('x-venue')).toBe('lasoul');
  });

  it('“back to the menu” returns a guest to their own restaurant', () => {
    expect(menuPath()).toBe('/menu/lasoul/');
    rememberGuestVenue('veraitalia');
    expect(activeVenue()).toBe('veraitalia');
    expect(menuPath()).toBe('/menu/veraitalia/');
    expect(menuHome('table=7')).toBe('/menu/veraitalia/?table=7');
    // Browsing a menu wins over the table they sat at.
    window.history.pushState({}, '', '/menu/lasoul/');
    expect(menuPath()).toBe('/menu/lasoul/');
  });

  it('a slug that is not a restaurant’s is never stored', () => {
    rememberGuestVenue('../evil');
    expect(venueForPath('/cart')).toBeNull();
    rememberGuestVenue('nowhere');
    expect(activeVenue()).toBe('lasoul');
  });
});
