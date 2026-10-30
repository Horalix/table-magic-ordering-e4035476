import { describe, expect, it } from 'vitest';
import { DEFAULT_VENUE, VENUES, menuBase, menuCategoryPath, menuHome, menuPath, ownSiteElsewhere, qrOrigin, venueByDbId, venueBySlug } from './venues';

describe('venues', () => {
  it('puts each restaurant’s menu under its own address', () => {
    expect(DEFAULT_VENUE).toBe('lasoul');
    expect(menuBase()).toBe('/menu/lasoul');
    expect(menuBase('veraitalia')).toBe('/menu/veraitalia');
  });

  it('gives every page its address with the trailing slash the host serves it at', () => {
    expect(menuPath()).toBe('/menu/lasoul/');
    expect(menuPath('veraitalia')).toBe('/menu/veraitalia/');
    expect(menuCategoryPath('food')).toBe('/menu/lasoul/food/');
  });

  it('keeps the table and token on the menu home, and drops an empty query', () => {
    expect(menuHome(new URLSearchParams({ table: '7', token: 'abc' }))).toBe('/menu/lasoul/?table=7&token=abc');
    expect(menuHome('?table=7')).toBe('/menu/lasoul/?table=7');
    expect(menuHome('')).toBe('/menu/lasoul/');
    expect(menuHome(null)).toBe('/menu/lasoul/');
  });

  it('only answers for restaurants that are live', () => {
    expect(venueBySlug('lasoul')?.name).toBe('La Soul');
    // Vera Italia opened on 30 October 2026.
    expect(VENUES.veraitalia.live).toBe(true);
    expect(venueBySlug('veraitalia')?.name).toBe('Vera Italia');
    expect(venueBySlug('drinks')).toBeNull();
    expect(venueBySlug(undefined)).toBeNull();
  });

  it('matches the database’s fixed restaurant ids', () => {
    expect(venueByDbId('a5000000-0000-4000-8000-000000000001')?.slug).toBe('lasoul');
    expect(venueByDbId('a5000000-0000-4000-8000-000000000002')?.slug).toBe('veraitalia');
    expect(venueByDbId(null)).toBeNull();
  });
});

describe('a restaurant with a site of its own', () => {
  // This build is La Soul's (no VITE_HOME_VENUE), and shows no restaurant in place (no VITE_PREVIEW_VENUES).
  it('is shown on its own site: its pages are forwarded there, its QR codes carry its address', () => {
    expect(ownSiteElsewhere('veraitalia')).toBe('https://veraitalia.net');
    expect(qrOrigin('veraitalia')).toBe('https://veraitalia.net');
  });

  it('leaves La Soul, an unknown restaurant and an address naming none where they are', () => {
    expect(ownSiteElsewhere('lasoul')).toBeNull();
    expect(ownSiteElsewhere('drinks')).toBeNull();
    expect(ownSiteElsewhere(undefined)).toBeNull();
    expect(qrOrigin('lasoul')).toBe(location.origin);
  });
});
