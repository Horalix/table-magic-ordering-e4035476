import { useQuery } from '@tanstack/react-query';
import type { Locale } from '@/lib/i18n';
import { isNew } from '@/lib/promotions';
import type { MenuItemRow } from '@/lib/promotions-api';
import { sectionSlug } from '@/lib/menu-sections';
import { menuBase } from '@/lib/venues';
import { CURATED_SIGNATURES, type SignatureDish, type SiteCategory } from './signature-list';

export { CURATED_SIGNATURES, type SignatureDish, type SiteCategory } from './signature-list';

const CATEGORY_SLUG: Record<SiteCategory, string> = { Drinks: 'drinks', Food: 'food', Desserts: 'desserts' };

export function categoryHref(category: SiteCategory, venueSlug: string, section?: string | null): string {
  const base = `${menuBase(venueSlug)}/${CATEGORY_SLUG[category]}`;
  return section ? `${base}?section=${sectionSlug(section)}` : base;
}

export const SIGNATURE_COUNT = 8;

type LiveRow = MenuItemRow & {
  subcategories?: { name: string; categories?: { name: string } | null } | null;
};

function toDish(row: LiveRow, at: number): SignatureDish | null {
  const category = row.subcategories?.categories?.name;
  if (category !== 'Drinks' && category !== 'Food' && category !== 'Desserts') return null;
  return {
    id: row.id,
    category,
    section: row.subcategories?.name ?? null,
    imageUrl: row.image_url,
    name: { en: row.name, bs: row.name_bs || row.name, ar: row.name_ar || row.name },
    badge: row.featured_rank != null ? 'featured' : isNew(row, at) ? 'new' : undefined,
  };
}

/**
 * What the restaurant has highlighted in the admin — featured dishes in their
 * order, then dishes marked new — topped up from the curated list.
 *
 * The curated list is the initial data, so the section paints at once and
 * never waits on the network; live picks replace it when they arrive. The
 * database client is imported on demand, after the page has painted.
 */
export function mergeSignatures(live: SignatureDish[]): SignatureDish[] {
  const seen = new Set(live.map((d) => d.id));
  return [...live, ...CURATED_SIGNATURES.filter((d) => !seen.has(d.id))].slice(0, SIGNATURE_COUNT);
}

export function pickHighlighted(rows: LiveRow[], at: number = Date.now()): SignatureDish[] {
  const usable = rows.filter((r) => r.is_available !== false);
  const featured = usable
    .filter((r) => r.featured_rank != null)
    .sort((a, b) => (a.featured_rank ?? 0) - (b.featured_rank ?? 0));
  const fresh = usable.filter((r) => r.featured_rank == null && isNew(r, at));
  return [...featured, ...fresh]
    .map((r) => toDish(r, at))
    .filter((d): d is SignatureDish => d !== null);
}

export function useSignatureDishes(): SignatureDish[] {
  const { data } = useQuery({
    queryKey: ['site-signatures'],
    queryFn: async (): Promise<SignatureDish[]> => {
      const { supabase } = await import('@/integrations/supabase/client');
      const { data: rows, error } = await supabase
        .from('menu_items')
        .select('*, subcategories(name, categories(name))')
        .or('featured_rank.not.is.null,merchandising_tags.cs.{new}')
        .order('sort_order');
      // A database without the promotion columns answers with an error:
      // the curated dishes simply stay.
      if (error || !Array.isArray(rows)) return CURATED_SIGNATURES;
      return mergeSignatures(pickHighlighted(rows as unknown as LiveRow[]));
    },
    initialData: CURATED_SIGNATURES,
    // Shown at once from the curated list, then checked against the live menu.
    initialDataUpdatedAt: 0,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
  return data;
}
