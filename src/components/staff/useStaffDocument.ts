import { useEffect, useLayoutEffect } from 'react';
import { useNoIndex } from '@/lib/seo/noindex';

/**
 * Staff screens are English and left-to-right, whatever a guest last chose.
 *
 * The guest i18n module sets `dir` and `lang` on <html> for the whole tab and
 * remembers the choice in localStorage. On a shared device — the manager's
 * phone that was handed to a guest to show the Arabic menu, a tablet that was
 * used to demo it — the kitchen board, the waiter phone and the admin then
 * opened mirrored: columns in reverse, the void button where the bump button
 * usually is. On a screen people tap by muscle memory that is a mis-tap
 * generator, not a translation.
 *
 * Forced on mount and restored on unmount, so a guest page opened in the same
 * tab afterwards is exactly as the guest left it.
 *
 * `title` names the tab ("Kitchen · Vera Italia"). Staff screens used to keep
 * La Soul's website title, so a phone's tab list could not tell the board,
 * the floor and the admin apart, or say which restaurant they were.
 *
 * And none of them is a search result: they kept the home page's "index,
 * follow" and canonical too, sign-in screens included. Every staff screen
 * calls this, so every one says "noindex" (public/_headers says so before
 * any code runs).
 */
export function useStaffDocument(title?: string) {
  useNoIndex();

  useEffect(() => {
    const root = document.documentElement;
    const previous = { dir: root.getAttribute('dir'), lang: root.getAttribute('lang') };
    root.setAttribute('dir', 'ltr');
    root.setAttribute('lang', 'en');
    return () => {
      if (previous.dir === null) root.removeAttribute('dir'); else root.setAttribute('dir', previous.dir);
      if (previous.lang === null) root.removeAttribute('lang'); else root.setAttribute('lang', previous.lang);
    };
  }, []);

  useEffect(() => {
    if (!title) return;
    const previous = document.title;
    document.title = title;
    return () => { document.title = previous; };
  }, [title]);
}

/**
 * The floor screens wear the restaurant the account works at, not the site's.
 *
 * <VenueTheme> gives staff paths the look of whichever site the device opened
 * (src/hooks/useVenue.ts), so a Vera Italia waiter on lasoul.net worked the
 * evening on a sage-green phone headed "Vera Italia", and La Soul's on
 * veraitalia.net the reverse. The waiter phone and the floor monitor are
 * one restaurant's room; they say so in its colours once the account's
 * restaurant is known (`slug`, from useStaffVenue).
 *
 * A layout effect, so leaving restores the site's look before <VenueTheme>
 * sets the next page's.
 */
export function useStaffVenueLook(slug: string | null | undefined) {
  useLayoutEffect(() => {
    if (!slug) return;
    const root = document.documentElement;
    const previous = root.dataset.venue;
    root.dataset.venue = slug;
    return () => {
      if (previous === undefined) delete root.dataset.venue; else root.dataset.venue = previous;
    };
  }, [slug]);
}
