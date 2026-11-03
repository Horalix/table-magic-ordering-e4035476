import { describe, expect, it } from 'vitest';
import { boardLocale, buildSlides, oneLine, slideSeconds, splitEvenly, TV_PAGE_SIZE, type TvItem } from './tv-board';

const category = (id: string, sort_order: number) => ({ id, name: id, sort_order });
const section = (id: string, category_id: string, sort_order: number) => ({ id, category_id, name: id, sort_order });
const dish = (id: string, subcategory_id: string, sort_order: number, extra: Partial<TvItem> = {}): TvItem =>
  ({ id, subcategory_id, sort_order, image_url: `/menu/${id}/1152.webp`, is_available: true, ...extra });

const ids = (rows: { id: string }[]) => rows.map((r) => r.id);

describe('the TV board’s slides', () => {
  it('are one per section, in the menu’s order: categories, then sections, then dishes, by sort_order', () => {
    const slides = buildSlides(
      [category('food', 2), category('drinks', 1)],
      [section('burgers', 'food', 2), section('pasta', 'food', 1), section('coffee', 'drinks', 1)],
      [dish('classic', 'burgers', 2), dish('soul', 'burgers', 1), dish('latte', 'coffee', 1), dish('penne', 'pasta', 1)],
    );
    expect(slides.map((s) => s.section.id)).toEqual(['coffee', 'pasta', 'burgers']);
    expect(slides.map((s) => s.category.id)).toEqual(['drinks', 'food', 'food']);
    expect(ids(slides[2].items)).toEqual(['soul', 'classic']);
  });

  it('keep the database’s order where sort_order is equal', () => {
    const slides = buildSlides([category('food', 1)], [section('a', 'food', 0)],
      [dish('x', 'a', 1), dish('y', 'a', 1), dish('z', 'a', 0)]);
    expect(ids(slides[0].items)).toEqual(['z', 'x', 'y']);
  });

  it('leave out what the kitchen has taken off, and skip a section with nothing left', () => {
    const slides = buildSlides(
      [category('food', 1)],
      [section('burgers', 'food', 1), section('soups', 'food', 2), section('empty', 'food', 3)],
      [dish('soul', 'burgers', 1), dish('classic', 'burgers', 2, { is_available: false }), dish('lentil', 'soups', 1, { is_available: false })],
    );
    expect(slides.map((s) => s.section.id)).toEqual(['burgers']);
    expect(ids(slides[0].items)).toEqual(['soul']);
  });

  it('skip a section whose category is not on the menu', () => {
    expect(buildSlides([category('food', 1)], [section('stray', 'gone', 1)], [dish('x', 'stray', 1)])).toEqual([]);
  });

  it('share a long section out over several slides, evenly, at most seven to a slide', () => {
    const coffees = Array.from({ length: 11 }, (_, i) => dish(`c${i}`, 'coffee', i));
    const slides = buildSlides([category('drinks', 1)], [section('coffee', 'drinks', 1)], coffees);
    expect(slides.map((s) => s.items.length)).toEqual([6, 5]);
    expect(slides.map((s) => [s.page, s.pages])).toEqual([[0, 2], [1, 2]]);
    expect(slides.map((s) => s.key)).toEqual(['coffee:0', 'coffee:1']);
    expect(slides.flatMap((s) => ids(s.items))).toEqual(ids(coffees));
  });

  it('do not split a section that fits on one', () => {
    const seven = Array.from({ length: TV_PAGE_SIZE }, (_, i) => dish(`m${i}`, 'mojito', i));
    const slides = buildSlides([category('drinks', 1)], [section('mojito', 'drinks', 1)], seven);
    expect(slides).toHaveLength(1);
    expect(slides[0].pages).toBe(1);
  });

  it('show the first photographed dish on the slide, else the section’s first', () => {
    const slides = buildSlides([category('food', 1)], [section('burgers', 'food', 1), section('fries', 'food', 2)], [
      dish('plain', 'burgers', 1, { image_url: null }),
      dish('soul', 'burgers', 2),
      dish('gravity', 'burgers', 3),
      ...Array.from({ length: 8 }, (_, i) => dish(`f${i}`, 'fries', i, { image_url: i === 0 ? '/menu/f0/1152.webp' : null })),
      dish('sold-out', 'fries', 99, { is_available: false }),
    ]);
    expect(slides[0].photo?.id).toBe('soul');
    // The fries' second slide has no photograph of its own: the section's first stands in.
    expect(slides.filter((s) => s.section.id === 'fries').map((s) => s.photo?.id)).toEqual(['f0', 'f0']);
  });

  it('have no photograph when nothing in the section has one', () => {
    const slides = buildSlides([category('drinks', 1)], [section('water', 'drinks', 1)], [dish('still', 'water', 1, { image_url: null })]);
    expect(slides[0].photo).toBeNull();
  });

  it('are none for an empty menu', () => {
    expect(buildSlides([], [], [])).toEqual([]);
  });
});

describe('sharing a list out evenly', () => {
  it('uses as few pages as it takes, the longer ones first', () => {
    const n = (count: number, max = 7) => splitEvenly(Array.from({ length: count }, (_, i) => i), max).map((p) => p.length);
    expect(n(0)).toEqual([]);
    expect(n(3)).toEqual([3]);
    expect(n(8)).toEqual([4, 4]);
    expect(n(9)).toEqual([5, 4]);
    expect(n(16)).toEqual([6, 5, 5]);
    expect(n(22)).toEqual([6, 6, 5, 5]);
  });
});

describe('a dish’s line on the board', () => {
  it('is its first sentence when that fits', () => {
    expect(oneLine('Premium beef, aged cheddar, truffle mayo')).toBe('Premium beef, aged cheddar, truffle mayo');
    expect(oneLine('Brewed with 100% Arabica beans. Lighter, with a cleaner taste.')).toBe('Brewed with 100% Arabica beans');
  });

  it('ends at a comma rather than mid-word when the sentence is long', () => {
    expect(oneLine('Fragrant and soothing chamomile tea, perfect for relaxation and calming the nerves after a long day.'))
      .toBe('Fragrant and soothing chamomile tea');
    expect(oneLine('Creamy mushroom soup with garlic, onion, celery, leeks, dry thyme and a splash of cream on top.'))
      .toBe('Creamy mushroom soup with garlic, onion, celery, leeks');
  });

  it('ends after a whole word, with an ellipsis, when no comma keeps enough of it', () => {
    const line = oneLine('Refreshing tea, full of antioxidants and gentle stimulation and ideal for relaxation and vitality.')!;
    expect(line).toBe('Refreshing tea, full of antioxidants and gentle stimulation…');
    expect(line.length).toBeLessThanOrEqual(63);
    // Never on a joining word.
    expect(oneLine('Spaghetti with creamy pink sauce and truffle paste topped with eggplant and parmesan cheese'))
      .toBe('Spaghetti with creamy pink sauce and truffle paste topped…');
  });

  it('is nothing for no description', () => {
    expect(oneLine(null)).toBeNull();
    expect(oneLine('   ')).toBeNull();
  });
});

describe('the board’s address', () => {
  it('?every= sets the seconds per slide, within reason', () => {
    expect(slideSeconds('')).toBe(12);
    expect(slideSeconds('?every=2')).toBe(2);
    expect(slideSeconds('?every=7.5')).toBe(7.5);
    expect(slideSeconds('?every=0')).toBe(2);
    expect(slideSeconds('?every=99999')).toBe(600);
    expect(slideSeconds('?every=soon')).toBe(12);
    expect(slideSeconds('?every=')).toBe(12);
  });

  it('?lang= picks one of the three languages, or none', () => {
    expect(boardLocale('?lang=ar')).toBe('ar');
    expect(boardLocale('?lang=bs&every=5')).toBe('bs');
    expect(boardLocale('?lang=de')).toBeNull();
    expect(boardLocale('')).toBeNull();
  });
});
