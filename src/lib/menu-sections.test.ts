import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { categoryPath, menuHref, sectionSlug } from './menu-sections';

describe('menu sections', () => {
  it('slugs the subcategory names the restaurant uses', () => {
    expect(sectionSlug('Kids Menu')).toBe('kids-menu');
    expect(sectionSlug('Filter Coffee')).toBe('filter-coffee');
    expect(sectionSlug('Café & Tea')).toBe('cafe-tea');
    expect(sectionSlug('  Burgers ')).toBe('burgers');
  });

  it('routes the three categories to their pages', () => {
    expect(categoryPath('Drinks')).toBe('/menu/lasoul/drinks');
    expect(categoryPath('Desserts')).toBe('/menu/lasoul/desserts');
    expect(categoryPath('Brunch Specials')).toBe('/menu/lasoul/brunch-specials');
  });

  it('keeps the table and token on the link, and drops them when absent', () => {
    expect(menuHref('Food', { section: 'Burgers', table: '7', token: 'abc' }))
      .toBe('/menu/lasoul/food?section=burgers&table=7&token=abc');
    expect(menuHref('Food')).toBe('/menu/lasoul/food');
  });

  // The old menu.lasoul.net pages redirect here. A slug that drifted from the
  // name in the database would land a printed QR code on the top of the page
  // instead of the section it promised.
  it('agrees with every section the old-site redirects point at', () => {
    const redirects = readFileSync(path.join(__dirname, '..', '..', 'public', '_redirects'), 'utf8');
    const targets = [...redirects.matchAll(/section=([a-z0-9-]+)/g)].map((m) => m[1]);
    const live = ['Coffee', 'Filter Coffee', 'Iced Coffee', 'Hot Drinks', 'Special Drinks', 'Tea', 'Iced Tea',
      'Fresh Juice', 'Mojito', 'Frappe', 'Lemonade', 'Other', 'Breakfast', 'Appetizer', 'Pasta', 'Soups',
      'Salads', 'Burgers', 'Sliders', 'Risotto', 'Fries', 'Kids Menu'].map(sectionSlug);
    expect(targets.length).toBe(22);
    for (const t of targets) expect(live).toContain(t);
  });
});
