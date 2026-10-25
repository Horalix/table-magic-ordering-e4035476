import type { Locale } from '../../lib/i18n';

/*
 * The website’s signature dishes as plain data, so the build can prerender
 * them (scripts/seo-prerender.ts) without loading the app. The live picks
 * and the hook are in signature-dishes.ts.
 */

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

