import { describe, expect, it } from 'vitest';
import { DEFAULT_VENUE, menuBase, menuHome, venueBySlug } from './venues';

describe('venues', () => {
  it('puts each restaurant’s menu under its own address', () => {
    expect(DEFAULT_VENUE).toBe('lasoul');
    expect(menuBase()).toBe('/menu/lasoul');
    expect(menuBase('italiaverde')).toBe('/menu/italiaverde');
  });

  it('keeps the table and token on the menu home, and drops an empty query', () => {
    expect(menuHome(new URLSearchParams({ table: '7', token: 'abc' }))).toBe('/menu/lasoul?table=7&token=abc');
    expect(menuHome('?table=7')).toBe('/menu/lasoul?table=7');
    expect(menuHome('')).toBe('/menu/lasoul');
    expect(menuHome(null)).toBe('/menu/lasoul');
  });

  it('only answers for restaurants that are live', () => {
    expect(venueBySlug('lasoul')?.name).toBe('La Soul');
    // Italia Verde is next; until its entry exists its address is "not found".
    expect(venueBySlug('italiaverde')).toBeNull();
    expect(venueBySlug('drinks')).toBeNull();
    expect(venueBySlug(undefined)).toBeNull();
  });
});
