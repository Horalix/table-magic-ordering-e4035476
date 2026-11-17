import { DEMO_BUILD, HOME_VENUE } from '@/lib/home-venue';
import { VENUES } from '@/lib/venues';
import { DEMO_MARK_ON_DARK } from '@/demo/brand';

/*
 * The staff sign-in pages wear the restaurant whose site this is
 * (src/lib/home-venue.ts): La Soul's on lasoul.net, Vera Italia's on
 * veraitalia.net. Anyone signs in at either; what they then see is decided
 * by their account.
 */
export const HOME = VENUES[HOME_VENUE];

export const STAFF_BRAND = DEMO_BUILD
  // The offline demo's fictional restaurant (docs/demo-mode.md): a drawn mark and an address that is nobody's.
  ? { mark: DEMO_MARK_ON_DARK, width: 480, height: 480, background: 'hsl(150, 16%, 24%)', adminEmail: 'owner@casademo.example' }
  : HOME.slug === 'veraitalia'
  ? { mark: '/brand/vera/monogram-cream.webp', width: 501, height: 664, background: 'hsl(24, 24%, 11%)', adminEmail: 'admin@veraitalia.net' }
  : { mark: '/brand/emblem-white.webp', width: 480, height: 480, background: 'hsl(140, 12%, 53%)', adminEmail: 'admin@lasoul.net' };
