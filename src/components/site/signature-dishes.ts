import { useQuery } from '@tanstack/react-query';
import type { Locale } from '@/lib/i18n';
import { isNew } from '@/lib/promotions';
import type { MenuItemRow } from '@/lib/promotions-api';
import { sectionSlug } from '@/lib/menu-sections';
import { menuBase } from '@/lib/venues';

export type SiteCategory = 'Drinks' | 'Food' | 'Desserts';

export interface SignatureDish {
  id: string;
  name: Record<Locale, string>;
  category: SiteCategory;
  /** The menu section it sits in, for a link that opens right at it. */
  section: string | null;
  /** The dish's photo as stored; the local WebP ladder is used when it has one. */
  imageUrl?: string | null;
  badge?: 'featured' | 'new';
}

const CATEGORY_SLUG: Record<SiteCategory, string> = { Drinks: 'drinks', Food: 'food', Desserts: 'desserts' };

export function categoryHref(category: SiteCategory, venueSlug: string, section?: string | null): string {
  const base = `${menuBase(venueSlug)}/${CATEGORY_SLUG[category]}`;
  return section ? `${base}?section=${sectionSlug(section)}` : base;
}

/**
 * Shown when the restaurant has not highlighted anything in the admin (no
 * featured or new dishes), and used to fill the row up when it has only a few.
 * Real dishes from the live menu, names as the menu spells them, each with a
 * photograph in public/menu/<id>.
 */
export const CURATED_SIGNATURES: SignatureDish[] = [
  { id: '1dd974a0-8e3a-4a86-b0d3-d2cff08b06e1', category: 'Food', section: 'Burgers', name: { en: 'La Soul Burger', bs: 'La Soul Burger', ar: 'برجر La Soul' } },
  { id: '09af75d1-cdfc-49b4-bdd8-85fafc5fc656', category: 'Desserts', section: 'Desserts', name: { en: 'San Sebastian Cheesecake', bs: 'San Sebastian Cheesecake', ar: 'سان سيباستيان تشيز كيك' } },
  { id: 'df6a0352-89e5-4be6-8694-79fe8a6ac5bf', category: 'Drinks', section: 'Coffee', name: { en: 'Spanish Latte', bs: 'Španski Latte', ar: 'لاتيه إسباني' } },
  { id: 'e4ffaa6d-83b9-4eb8-a89c-e07ca01616c7', category: 'Food', section: 'Burgers', name: { en: 'Solar Gravity', bs: 'Solar Gravity', ar: 'سولار جرافيتي' } },
  { id: 'b6b9bc9d-820d-4f81-be70-9805797e2e57', category: 'Desserts', section: 'Desserts', name: { en: 'Saffron Milk Cake', bs: 'Mliječni kolač sa šafranom', ar: 'كيكة الحليب بالزعفران' } },
  { id: 'f90e4414-312d-4e3e-bae4-524d3e716296', category: 'Food', section: 'Breakfast', name: { en: 'Shakshuka Platter', bs: 'Šakšuka plata', ar: 'طبق الشكشوكة' } },
  { id: '8ecbbf48-1572-4f8f-afc8-81bbc0c43643', category: 'Desserts', section: 'Desserts', name: { en: 'Lava Cake', bs: 'Lava kolač', ar: 'لافا كيك' } },
  { id: '05fbb7cb-31d7-4384-8e55-b3a198e0fd22', category: 'Drinks', section: 'Iced Coffee', name: { en: 'Iced Rose Latte', bs: 'Ledeni Latte s ružom', ar: 'لاتيه الورد المثلج' } },
];

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
