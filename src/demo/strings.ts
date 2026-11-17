/**
 * What the app says differently for the demo's fictional restaurant
 * (demo mode only): the few guest-facing strings in src/lib/i18n.ts that are
 * facts about one real restaurant — its address, its promise, who takes its
 * card payments. Same keys, same three languages.
 *
 * No imports from the app: src/lib/i18n.ts reads this.
 */
import { RESTAURANT } from './brand';

type Strings = Record<string, { en: string; bs: string; ar: string }>;

export const DEMO_STRINGS: Strings = {
  halal_promise: { en: 'Fresh · local · made to order', bs: 'Svježe · domaće · po narudžbi', ar: 'طازج · محلي · يُحضَّر عند الطلب' },
  address: {
    en: `${RESTAURANT.address}, ${RESTAURANT.city}`,
    bs: `${RESTAURANT.address}, ${RESTAURANT.city}`,
    ar: `${RESTAURANT.address}، سراييفو`,
  },
  secure_payment_monri: { en: 'Demo payment · no card is charged', bs: 'Demo plaćanje · kartica se ne tereti', ar: 'دفع تجريبي · لا يُخصم أي مبلغ' },
};
