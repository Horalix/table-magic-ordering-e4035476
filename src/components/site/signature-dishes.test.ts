import { describe, expect, it } from 'vitest';
import imageManifest from '@/lib/image-manifest.json';
import { CURATED_SIGNATURES, SIGNATURE_COUNT, categoryHref, mergeSignatures, pickHighlighted } from './signature-dishes';

const row = (over: Record<string, unknown>) => ({
  id: 'x', name: 'Dish', name_bs: null, name_ar: null, image_url: null, is_available: true,
  merchandising_tags: [], featured_rank: null, new_until: null,
  subcategories: { name: 'Burgers', categories: { name: 'Food' } },
  ...over,
}) as never;

describe('signature dishes', () => {
  it('has a local photograph for every curated dish', () => {
    const manifest = imageManifest as Record<string, unknown>;
    for (const d of CURATED_SIGNATURES) expect(manifest[d.id], d.name.en).toBeTruthy();
  });

  it('shows the curated dishes when nothing is highlighted', () => {
    expect(mergeSignatures([])).toEqual(CURATED_SIGNATURES.slice(0, SIGNATURE_COUNT));
  });

  it('puts featured dishes first, in their order, then new ones, then tops up', () => {
    const picked = pickHighlighted([
      row({ id: 'new', merchandising_tags: ['new'], new_until: '2999-01-01' }),
      row({ id: 'second', featured_rank: 2 }),
      row({ id: 'first', featured_rank: 1 }),
      row({ id: 'sold-out', featured_rank: 0, is_available: false }),
      row({ id: 'expired', merchandising_tags: ['new'], new_until: '2000-01-01' }),
    ]);
    expect(picked.map((d) => [d.id, d.badge])).toEqual([['first', 'featured'], ['second', 'featured'], ['new', 'new']]);
    const merged = mergeSignatures(picked);
    expect(merged).toHaveLength(SIGNATURE_COUNT);
    expect(merged.slice(0, 3).map((d) => d.id)).toEqual(['first', 'second', 'new']);
  });

  it('skips a dish it cannot place in the menu', () => {
    expect(pickHighlighted([row({ featured_rank: 1, subcategories: null })])).toEqual([]);
  });

  it('links into the venue’s menu at the dish’s section', () => {
    expect(categoryHref('Food', 'lasoul', 'Iced Coffee')).toBe('/menu/lasoul/food/?section=iced-coffee');
    expect(categoryHref('Desserts', 'italiaverde')).toBe('/menu/italiaverde/desserts/');
  });
});

