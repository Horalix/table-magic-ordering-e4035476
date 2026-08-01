import { useCallback, useEffect, useRef } from 'react';

/**
 * The four things a modal has to do, for the sheets that are hand-rolled.
 *
 * `ReviewPrompt` uses Radix and gets all of this for free. The three guest
 * sheets built on raw framer-motion — the cart, the product detail, and split
 * bill — had none of it:
 *
 *   - no `role="dialog"`, so a screen reader announced nothing and the user
 *     stayed in the page behind;
 *   - no focus trap, so Tab walked straight out of the sheet into the menu
 *     underneath while the overlay was still up;
 *   - no Escape, so a keyboard user could open a sheet and not close it;
 *   - no scroll lock, so the page scrolled under the sheet on iOS and the
 *     guest lost their place in a long menu.
 *
 * Deliberately a hook rather than a rewrite onto Radix: these sheets have
 * drag-to-dismiss, spring physics and a specific feel that is part of the
 * product. Adding the accessibility contract to them costs one line each and
 * changes nothing a sighted mouse user sees.
 */

const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled])',
  'select:not([disabled])', 'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])',
].join(',');

export interface DialogOptions {
  open?: boolean;
  onClose: () => void;
  /** The accessible name. Use `labelledBy` instead when a visible title exists. */
  label?: string;
  labelledBy?: string;
}

export function useDialog({ open = true, onClose, label, labelledBy }: DialogOptions) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const restoreTo = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  useEffect(() => {
    if (!open) return;

    restoreTo.current = (document.activeElement as HTMLElement) ?? null;

    // Scroll lock. Without it iOS scrolls the page behind the sheet and the
    // guest loses their position in a long menu.
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';

    // Move focus in, so the first Tab lands inside rather than in the page.
    const focusFirst = () => {
      const panel = panelRef.current;
      if (!panel) return;
      const first = panel.querySelector<HTMLElement>(FOCUSABLE);
      (first ?? panel).focus({ preventScroll: true });
    };
    const raf = requestAnimationFrame(focusFirst);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;

      const panel = panelRef.current;
      if (!panel) return;
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE))
        .filter((el) => el.offsetParent !== null || el === document.activeElement);
      if (focusable.length === 0) {
        event.preventDefault();
        panel.focus({ preventScroll: true });
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement | null;

      // Wrap at both ends. Also catches focus that has somehow escaped the
      // panel entirely, which is what a drag-dismissed sheet can leave behind.
      if (event.shiftKey && (active === first || !panel.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !panel.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('keydown', onKeyDown, true);
      document.body.style.overflow = overflow;
      // Put focus back where it came from, so closing a sheet does not dump
      // the user at the top of the page.
      restoreTo.current?.focus?.({ preventScroll: true });
    };
  }, [open]);

  /** Spread onto the sheet panel itself, not the overlay. */
  const dialogProps = {
    ref: panelRef,
    role: 'dialog' as const,
    'aria-modal': true,
    tabIndex: -1,
    ...(labelledBy ? { 'aria-labelledby': labelledBy } : {}),
    ...(label && !labelledBy ? { 'aria-label': label } : {}),
  };

  const close = useCallback(() => onCloseRef.current(), []);

  return { dialogProps, panelRef, close };
}
