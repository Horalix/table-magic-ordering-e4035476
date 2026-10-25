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
  /** Let the phone's Back button close the sheet (default true). */
  closeOnBack?: boolean;
}

/* ---- Back closes the sheet ----------------------------------------------
 *
 * On Android the system Back gesture is how people dismiss anything. Without
 * a history entry for the sheet, Back left the menu entirely — the guest lost
 * their category, their scroll position and the sheet in one swipe.
 *
 * Each open sheet pushes one entry (the current router state plus a `sheet`
 * marker, so React Router still recognises the entry). Back pops it and closes
 * the sheet. Closing any other way (X, scrim, Escape, Add) takes the entry back
 * out with history.back() — but only if it is still on top, so a sheet closed
 * by navigating somewhere else never drags the guest back with it.
 *
 * Those programmatic pops are counted, so the sheet underneath (or the next
 * sheet opened in the same tick) does not mistake them for the guest pressing
 * Back; a sheet opened while one is still in flight waits for it to land
 * before pushing its own entry.
 */
let sheetSeq = 0;
let programmaticPops = 0;
let popIsProgrammatic = false;
const afterPops: Array<() => void> = [];
let popSafety: ReturnType<typeof setTimeout> | undefined;

const flushAfterPops = () => {
  while (afterPops.length) afterPops.shift()!();
};

if (typeof window !== 'undefined') {
  // Registered at module load, so it runs before any sheet's own listener.
  window.addEventListener('popstate', () => {
    popIsProgrammatic = programmaticPops > 0;
    if (popIsProgrammatic) programmaticPops -= 1;
    if (programmaticPops === 0) {
      clearTimeout(popSafety);
      flushAfterPops();
    }
  });
}

const popOurEntry = () => {
  programmaticPops += 1;
  window.history.back();
  // A browser that never delivers the popstate must not leave the next sheet
  // waiting forever.
  clearTimeout(popSafety);
  popSafety = setTimeout(() => { programmaticPops = 0; flushAfterPops(); }, 600);
};

/**
 * Close on the phone's Back button. useDialog applies this itself; Radix
 * dialogs (ReviewPrompt) call it directly.
 */
export function useBackToClose(open: boolean, onClose: () => void, enabled = true) {
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  useEffect(() => {
    if (!open || !enabled || typeof window === 'undefined') return;
    const id = `sheet-${++sheetSeq}`;
    let pushed = false;
    let closedByBack = false;
    let disposed = false;

    const push = () => {
      if (disposed) return;
      const current = window.history.state;
      const base = current && typeof current === 'object' ? current : {};
      window.history.pushState({ ...base, sheet: id }, '');
      pushed = true;
    };
    if (programmaticPops > 0) afterPops.push(push);
    else push();

    const onPop = () => {
      if (!pushed || popIsProgrammatic) return;
      // Still on our entry (e.g. Forward back into it): nothing to close.
      if ((window.history.state as { sheet?: string } | null)?.sheet === id) return;
      closedByBack = true;
      onCloseRef.current();
    };
    window.addEventListener('popstate', onPop);

    return () => {
      disposed = true;
      window.removeEventListener('popstate', onPop);
      const idx = afterPops.indexOf(push);
      if (idx >= 0) afterPops.splice(idx, 1);
      if (pushed && !closedByBack && (window.history.state as { sheet?: string } | null)?.sheet === id) {
        popOurEntry();
      }
    };
  }, [open, enabled]);
}

export function useDialog({ open = true, onClose, label, labelledBy, closeOnBack = true }: DialogOptions) {
  useBackToClose(open, onClose, closeOnBack);
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
