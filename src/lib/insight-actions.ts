import { supabase } from '@/integrations/supabase/client';
import { deleteMenuEntry, restoreMenuEntry } from './menu-bin';
import { curatePairing, type Insight, type InsightKind } from './menu-intelligence';

/**
 * What an owner can do about a "What to do next" card, from the card.
 *
 * The cards said what to do and left the owner to find where: only a learned
 * pairing had a button. Each kind of card now offers the one thing its advice
 * comes down to, and every one of them can be taken back:
 *
 *   puzzle (profitable, not popular), a rising dish  → Feature it on the menu home
 *   dog (neither popular nor profitable)             → Take it off the menu (it goes to the bin)
 *   sold out for days                                → Put it back on
 *   looked at but not ordered, a falling dish        → Edit dish (photo, words, price)
 *   a pairing tables keep making                     → Suggest it
 *
 * Nothing here is new machinery: featuring, the bin, availability and curated
 * suggestions are the menu's own, and guests see the change at once.
 */

export type InsightActionKey = 'suggest' | 'feature' | 'take_off' | 'bring_back' | 'edit';

export interface InsightAction {
  key: InsightActionKey;
  label: string;
}

const ACTIONS: Partial<Record<InsightKind, InsightAction[]>> = {
  pairing: [{ key: 'suggest', label: 'Suggest it' }],
  puzzle: [{ key: 'feature', label: 'Feature it' }, { key: 'edit', label: 'Edit dish' }],
  trend_up: [{ key: 'feature', label: 'Feature it' }],
  dog: [{ key: 'take_off', label: 'Take it off the menu' }, { key: 'edit', label: 'Edit dish' }],
  sold_out: [{ key: 'bring_back', label: 'Put it back on' }],
  leak: [{ key: 'edit', label: 'Edit dish' }],
  trend_down: [{ key: 'edit', label: 'Edit dish' }],
};

/** The buttons a card gets, the first being what its advice comes down to. */
export function insightActions(i: Pick<Insight, 'kind' | 'item_id' | 'related_item_id'>): InsightAction[] {
  if (!i.item_id) return [];
  const actions = ACTIONS[i.kind] ?? [];
  return i.kind === 'pairing' && !i.related_item_id ? [] : actions;
}

/** One card, wherever it is listed. */
export const insightKey = (i: Insight) => `${i.kind}:${i.item_id ?? ''}:${i.related_item_id ?? ''}:${i.headline}`;

/** Where "Edit dish" goes: the menu page opens that dish's editor (src/pages/admin/AdminMenu.tsx). */
export const editDishLink = (itemId: string) => `/admin/menu?dish=${encodeURIComponent(itemId)}`;

/** The home screen leads with at most this many dishes (menu_items_featured_rank_range). */
export const MAX_FEATURED = 3;

export interface ActionDone {
  /** What to say. */
  message: string;
  /** Takes it back; absent when there is nothing to take back. */
  undo?: () => Promise<void>;
}

const fail = (error: { message: string } | null) => { if (error) throw new Error(error.message); };

/** Lead the menu home with this dish, in the first free place of three. */
export async function featureDish(itemId: string, name: string): Promise<ActionDone> {
  const { data, error } = await supabase.from('menu_items').select('id, name, featured_rank').not('featured_rank', 'is', null);
  fail(error);
  const featured = (data ?? []) as { id: string; name: string; featured_rank: number }[];
  if (featured.some((f) => f.id === itemId)) return { message: `${name} is already featured` };
  const rank = Array.from({ length: MAX_FEATURED }, (_, i) => i + 1).find((r) => !featured.some((f) => f.featured_rank === r));
  if (!rank) {
    throw new Error(`Three dishes are already featured (${featured.map((f) => f.name).join(', ')}). Take one off in Promotions first.`);
  }
  fail((await supabase.from('menu_items').update({ featured_rank: rank } as never).eq('id', itemId)).error);
  return {
    message: `${name} now leads the menu home`,
    undo: async () => fail((await supabase.from('menu_items').update({ featured_rank: null } as never).eq('id', itemId)).error),
  };
}

/** The dish goes to the bin: guests stop seeing it, and Restore (or Undo) puts it back as it was. */
export async function takeOffMenu(itemId: string, name: string): Promise<ActionDone> {
  fail((await deleteMenuEntry('item', itemId)).error);
  return {
    message: `${name} is off the menu. It is in Menu → Recently deleted.`,
    undo: async () => fail((await restoreMenuEntry('item', itemId)).error),
  };
}

/** A dish marked sold out goes back on sale. */
export async function bringBack(itemId: string, name: string): Promise<ActionDone> {
  fail((await supabase.from('menu_items').update({ is_available: true } as never).eq('id', itemId)).error);
  return {
    message: `${name} is back on the menu`,
    undo: async () => fail((await supabase.from('menu_items').update({ is_available: false } as never).eq('id', itemId)).error),
  };
}

/** The dish a card is about: its name on the menu, else the start of the card's headline. */
async function dishName(i: Insight): Promise<string> {
  const { data } = await supabase.from('menu_items').select('name').eq('id', i.item_id as string).maybeSingle();
  const name = (data as { name?: string } | null)?.name;
  return name || i.headline.replace(/ (is|has|sells|was) .*$/, '') || 'The dish';
}

/** Do what a card's button says. "Edit dish" is a link, not done here. */
export async function runInsightAction(key: InsightActionKey, i: Insight): Promise<ActionDone> {
  if (!i.item_id) throw new Error('This card names no dish');
  if (key === 'suggest') {
    if (!i.related_item_id) throw new Error('This card names no pairing');
    await curatePairing(i.item_id, i.related_item_id);
    return { message: 'Added to suggestions' };
  }
  const name = await dishName(i);
  switch (key) {
    case 'feature': return featureDish(i.item_id, name);
    case 'take_off': return takeOffMenu(i.item_id, name);
    case 'bring_back': return bringBack(i.item_id, name);
    default: throw new Error('Nothing to do');
  }
}
