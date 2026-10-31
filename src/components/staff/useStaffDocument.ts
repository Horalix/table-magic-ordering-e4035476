import { useEffect } from 'react';

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
 */
export function useStaffDocument(title?: string) {
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
