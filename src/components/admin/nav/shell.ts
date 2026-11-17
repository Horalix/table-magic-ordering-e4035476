import type { Venue } from '@/lib/venues';
import type { AreaId, NavAudience, NavLauncher } from './admin-nav';

/**
 * What the layout hands every piece of the admin's navigation: the sidebar,
 * the tabs, the phone's bottom bar, the More sheet and the search. They draw
 * it; the layout (AdminLayout.tsx) decides it.
 */
export interface AdminShell {
  /** Whose navigation this is; `owner` is false until the roles have loaded. */
  audience: NavAudience;
  pathname: string;
  /** The area the open page belongs to; null on an address that is no admin page. */
  area: AreaId | null;
  /** Guests waiting for an answer about a table. */
  pending: number;
  /** Null while the account's roles load: a restaurant's admin never sees the other's name. */
  venueName: string | null;
  owner: boolean | null;
  /** The restaurants this account switches between; one or none shows no switch. */
  choices: Venue[];
  venueSlug: string | null;
  email: string | null;
  /** The Home Screen app, not a browser tab. */
  standalone: boolean;
  openSearch: () => void;
  changePassword: () => void;
  signOut: () => void;
  switchVenue: (slug: string) => void;
  /** Opens the kitchen display or the floor monitor so the admin stays one tap away. */
  launch: (launcher: NavLauncher) => void;
  /** Opens the walkthrough again (WhatsNewTour.tsx), whether or not it has been seen. `from`: the button to give the keyboard back to. */
  openTour: (from?: HTMLElement | null) => void;
}
