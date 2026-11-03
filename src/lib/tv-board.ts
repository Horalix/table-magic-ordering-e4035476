/**
 * The menu board on the TV at the entrance (/tv, src/pages/TvMenu.tsx).
 *
 * Nobody touches that screen, so it cannot be a menu people scroll: it shows
 * one section of the menu at a time and moves on by itself. This file decides
 * what those slides are, from the same three tables the guest menu reads.
 *
 * - One slide per section that has something on it today. A dish the kitchen
 *   has taken off (`is_available` false) is left out: the guest menu greys it
 *   out for someone looking for it, but a board read in passing should only
 *   offer what can be ordered. A section with nothing left is skipped.
 * - A long section is shared out over several slides, as evenly as it goes
 *   (eleven coffees are six and five, not seven and four), so no slide is a
 *   crowded list followed by a near-empty one.
 * - Each slide's photograph is the first photographed dish on it, else the
 *   section's first: a guest who sees the picture finds that dish in the list
 *   beside it, and the second page of the coffees does not repeat the first's
 *   photograph.
 *
 * No imports beyond types: src/lib/current-venue.ts and src/lib/analytics.ts
 * read TV_PATH, and the build reads current-venue.ts (vite.config.ts).
 */
import type { Locale } from './i18n';

/** The board's address, /tv or /tv/. */
export const TV_PATH = /^\/tv(\/|$)/;

/** At most this many dishes on one slide: what fits at a size readable from the door. */
export const TV_PAGE_SIZE = 7;

/** Seconds on each slide, unless the address says otherwise (?every=). */
export const TV_SLIDE_SECONDS = 12;

export interface TvCategory {
  id: string;
  name: string;
  name_bs?: string | null;
  name_ar?: string | null;
  sort_order: number | null;
}

export interface TvSection {
  id: string;
  category_id: string;
  name: string;
  name_bs?: string | null;
  name_ar?: string | null;
  sort_order: number | null;
}

export interface TvItem {
  id: string;
  subcategory_id: string;
  image_url: string | null;
  is_available: boolean | null;
  sort_order: number | null;
}

export interface TvSlide<T extends TvItem = TvItem> {
  /** Stable across refetches while the menu stays the same: section id and page. */
  key: string;
  category: TvCategory;
  section: TvSection;
  /** Which of the section's slides this is, from 0, and how many it has. */
  page: number;
  pages: number;
  items: T[];
  /** The dish whose photograph the slide shows; null when nothing in the section has one. */
  photo: T | null;
}

/** By sort_order; equal ones keep the order the database gave them. */
const byOrder = <T extends { sort_order: number | null }>(rows: readonly T[]): T[] =>
  rows.map((row, i) => ({ row, i }))
    .sort((a, b) => (a.row.sort_order ?? 0) - (b.row.sort_order ?? 0) || a.i - b.i)
    .map(({ row }) => row);

/** `list` in as few pages of at most `max` as it takes, the longer pages first, none more than one longer than another. */
export function splitEvenly<T>(list: readonly T[], max: number): T[][] {
  if (list.length === 0) return [];
  const pages = Math.ceil(list.length / Math.max(1, max));
  const base = Math.floor(list.length / pages);
  const longer = list.length % pages;
  const out: T[][] = [];
  let at = 0;
  for (let p = 0; p < pages; p++) {
    const size = base + (p < longer ? 1 : 0);
    out.push(list.slice(at, at + size));
    at += size;
  }
  return out;
}

/** The board's slides, in the menu's order: categories, then their sections, then their dishes. */
export function buildSlides<T extends TvItem>(
  categories: readonly TvCategory[],
  sections: readonly TvSection[],
  items: readonly T[],
  pageSize: number = TV_PAGE_SIZE,
): TvSlide<T>[] {
  const onOffer = new Map<string, T[]>();
  for (const item of byOrder(items)) {
    if (item.is_available === false) continue;
    const list = onOffer.get(item.subcategory_id) ?? [];
    list.push(item);
    onOffer.set(item.subcategory_id, list);
  }

  const slides: TvSlide<T>[] = [];
  for (const category of byOrder(categories)) {
    for (const section of byOrder(sections.filter((s) => s.category_id === category.id))) {
      const dishes = onOffer.get(section.id) ?? [];
      const first = dishes.find((d) => d.image_url) ?? null;
      const pages = splitEvenly(dishes, pageSize);
      pages.forEach((page, i) => slides.push({
        key: `${section.id}:${i}`,
        category,
        section,
        page: i,
        pages: pages.length,
        items: page,
        photo: page.find((d) => d.image_url) ?? first,
      }));
    }
  }
  return slides;
}

/** Where a phrase may end: a comma, semicolon or dash, Arabic's comma among them. */
const CLAUSE_END = /[,;،]\s|\s[–—]\s/g;

/**
 * A dish's description as the one line the board has room for: its first
 * sentence, or as much of it as fits in `max` characters — up to the last
 * comma if that keeps a fair part of it ("Fragrant and soothing chamomile
 * tea"), else up to the last whole word, with "…". Left to the browser, the
 * line ended in the middle of a word.
 */
export function oneLine(text: string | null | undefined, max = 62): string | null {
  const clean = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!clean) return null;
  const sentence = (/^(.+?)[.!?؟](\s|$)/.exec(clean)?.[1] ?? clean).trim();
  if (sentence.length <= max) return sentence;
  let clause = -1;
  for (const m of sentence.matchAll(CLAUSE_END)) if (m.index! <= max) clause = m.index!;
  if (clause >= max * 0.4) return sentence.slice(0, clause).trim();
  const space = sentence.lastIndexOf(' ', max);
  const cut = sentence.slice(0, space > 0 ? space : max).replace(/[,;:،\s]+$/, '');
  // Not "…tomato and…": a line that stops on a joining word reads as broken off.
  return `${cut.replace(DANGLING, '').replace(/[,;:،\s]+$/, '')}…`;
}

/** Joining words a cut line should not end on, in the three languages. */
const DANGLING = /\s+(and|or|with|of|in|on|the|a|an|for|to|i|ili|s|sa|u|na|od|za|و|مع|في|من)$/i;

/** ?every=<seconds>: how long each slide stays. Between 2 seconds and 10 minutes; 12 otherwise. */
export function slideSeconds(search: string): number {
  const raw = new URLSearchParams(search).get('every');
  const n = raw === null || raw.trim() === '' ? NaN : Number(raw);
  if (!Number.isFinite(n)) return TV_SLIDE_SECONDS;
  return Math.min(600, Math.max(2, n));
}

/** ?lang=en|bs|ar: the board's language, or null to keep the app's. */
export function boardLocale(search: string): Locale | null {
  const lang = new URLSearchParams(search).get('lang');
  return lang === 'en' || lang === 'bs' || lang === 'ar' ? lang : null;
}
