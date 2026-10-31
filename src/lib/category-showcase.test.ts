import { describe, expect, it } from 'vitest';
import { pickShowcase, type ShowcaseItem } from './category-showcase';

const item = (id: string, section: string, extra: Partial<ShowcaseItem> = {}): ShowcaseItem =>
  ({ id, subcategory_id: section, image_url: `https://cdn/${id}.jpg`, is_available: true, ...extra });

const MENU = [
  item('burger', 'burgers'), item('slider', 'burgers'),
  item('benedict', 'breakfast'), item('shakshuka', 'breakfast'),
  item('pasta', 'pasta'),
  item('latte', 'coffee'),
];
const FOOD = ['breakfast', 'burgers', 'pasta'];
const ids = (photos: { id: string }[]) => photos.map((p) => p.id);

describe('a category’s photographs on the menu home', () => {
  it('are the dishes the restaurant chose, the large one first', () => {
    expect(ids(pickShowcase(['burger', 'benedict', 'pasta'], FOOD, MENU))).toEqual(['burger', 'benedict', 'pasta']);
  });

  it('leave out a chosen dish that is sold out, unphotographed or gone, and fill from the sections in turn', () => {
    const menu = MENU.map((i) => (i.id === 'benedict' ? { ...i, is_available: false } : i.id === 'pasta' ? { ...i, image_url: null } : i));
    expect(ids(pickShowcase(['burger', 'benedict', 'pasta', 'gone'], FOOD, menu))).toEqual(['burger', 'shakshuka', 'slider']);
  });

  it('show a category nobody chose for: one dish from each section, never another category’s', () => {
    expect(ids(pickShowcase([], FOOD, MENU))).toEqual(['benedict', 'burger', 'pasta']);
    expect(ids(pickShowcase([], ['coffee'], MENU))).toEqual(['latte']);
  });

  it('show the chosen dishes while the menu is still loading, from their local photographs', () => {
    expect(pickShowcase(['burger', 'pasta'], FOOD, [])).toEqual([
      { id: 'burger', src: '/menu/burger/768.webp' }, { id: 'pasta', src: '/menu/pasta/768.webp' },
    ]);
  });

  it('show at most three, and none for a category with no photographs', () => {
    expect(pickShowcase(['a', 'b', 'c', 'd'], FOOD, [])).toHaveLength(3);
    expect(pickShowcase([], ['empty'], MENU)).toEqual([]);
  });
});
