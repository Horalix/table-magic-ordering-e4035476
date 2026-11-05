/**
 * The menu's bin (20261105120000_menu_undo.sql).
 *
 * Delete used to erase a dish for good, and refused outright for any dish
 * that had ever been on an order. It now puts a course, a section or a dish in
 * the restaurant's bin: guests stop seeing it at once, order history keeps its
 * name, and Restore puts back exactly what went.
 *
 * Until that migration is applied the rows carry no `deleted_at`, and the
 * admin page keeps the old delete (see `binReady`).
 */
import { supabase } from '@/integrations/supabase/client';

export type BinKind = 'category' | 'subcategory' | 'item';

/**
 * Ask for deleted menu rows too. The database shows them only to the
 * restaurant's own staff, and only on requests that carry this header: the
 * bin, and the order screens that still need a deleted dish's name.
 */
export const SHOW_DELETED = ['x-menu-deleted', 'show'] as const;

/** The fields the migration adds; optional, so the page works without them. */
export type Binnable = { deleted_at?: string | null };

type Named = Binnable & { id: string; name: string };
type BinItem = Named;
type BinSub = Named & { menu_items?: BinItem[] | null };
type BinCat = Named & { subcategories?: BinSub[] | null };

/** Has the bin migration been applied? Read off a loaded row; unknown with none. */
export const binReady = (rows: readonly object[]): boolean | null =>
  rows.length === 0 ? null : 'deleted_at' in rows[0];

export const isDeleted = (row: Binnable) => !!row.deleted_at;

/** The menu as guests see it: deleted courses, sections and dishes left out. */
export function liveMenu<C extends BinCat>(categories: C[]): C[] {
  return categories
    .filter((c) => !isDeleted(c))
    .map((c) => ({
      ...c,
      subcategories: (c.subcategories ?? [])
        .filter((s) => !isDeleted(s))
        .map((s) => ({ ...s, menu_items: (s.menu_items ?? []).filter((i) => !isDeleted(i)) })),
    }));
}

export interface BinEntry {
  kind: BinKind;
  id: string;
  name: string;
  /** Where it was: "Food › Burgers" for a dish, "Food" for a section. */
  where: string | null;
  deletedAt: string;
  /** What comes back with it: sections and dishes deleted at the same moment. */
  sections: number;
  dishes: number;
}

/**
 * What the bin lists, newest first.
 *
 * A course or section deleted as a whole is one entry with what went with it;
 * a dish or section is listed on its own only while what holds it is still on
 * the menu (restoring it brings its section and course back, so the ones
 * inside a deleted course come back with that course instead).
 */
export function binEntries(categories: BinCat[]): BinEntry[] {
  const out: BinEntry[] = [];
  for (const c of categories) {
    const subs = c.subcategories ?? [];
    if (isDeleted(c)) {
      const together = subs.filter((s) => s.deleted_at === c.deleted_at);
      out.push({
        kind: 'category', id: c.id, name: c.name, where: null, deletedAt: c.deleted_at!,
        sections: together.length,
        dishes: subs.reduce((n, s) => n + (s.menu_items ?? []).filter((i) => i.deleted_at === c.deleted_at).length, 0),
      });
      continue;
    }
    for (const s of subs) {
      const items = s.menu_items ?? [];
      if (isDeleted(s)) {
        out.push({
          kind: 'subcategory', id: s.id, name: s.name, where: c.name, deletedAt: s.deleted_at!,
          sections: 0, dishes: items.filter((i) => i.deleted_at === s.deleted_at).length,
        });
        continue;
      }
      for (const i of items) {
        if (isDeleted(i)) {
          out.push({ kind: 'item', id: i.id, name: i.name, where: `${c.name} › ${s.name}`, deletedAt: i.deleted_at!, sections: 0, dishes: 1 });
        }
      }
    }
  }
  return out.sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
}

/** "Burgers and its 4 dishes", for the toast and the bin. */
export function whatWent(e: Pick<BinEntry, 'kind' | 'name' | 'sections' | 'dishes'>): string {
  if (e.kind === 'item') return e.name;
  const parts = [
    e.sections > 0 ? `${e.sections} ${e.sections === 1 ? 'section' : 'sections'}` : null,
    e.dishes > 0 ? `${e.dishes} ${e.dishes === 1 ? 'dish' : 'dishes'}` : null,
  ].filter(Boolean);
  return parts.length ? `${e.name} and its ${parts.join(' and ')}` : e.name;
}

/** "just now", "12 min ago", "3 h ago", "yesterday", then the date. */
export function deletedWhen(iso: string, now: Date = new Date()): string {
  const at = new Date(iso);
  const mins = Math.floor((now.getTime() - at.getTime()) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24 && at.getDate() === now.getDate()) return `${hours} h ago`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (at.toDateString() === yesterday.toDateString()) return 'yesterday';
  return at.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export interface BinResult {
  name?: string;
  subcategories?: number;
  items?: number;
  already?: boolean;
}

const rpc = async (fn: string, kind: BinKind, id: string) => {
  const { data, error } = await supabase.rpc(fn as never, { _kind: kind, _id: id } as never);
  return { data: (data ?? null) as BinResult | null, error };
};

/** Put a course, section or dish in the bin. */
export const deleteMenuEntry = (kind: BinKind, id: string) => rpc('admin_delete_menu_entry', kind, id);

/** Take it out again, with what went with it. */
export const restoreMenuEntry = (kind: BinKind, id: string) => rpc('admin_restore_menu_entry', kind, id);
