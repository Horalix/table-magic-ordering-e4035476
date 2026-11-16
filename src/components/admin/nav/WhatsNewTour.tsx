import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { motion, useReducedMotion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { easeStandard } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { searchShortcut } from './manager-app';
import { placeCallout, tourSteps, type Box } from './whats-new';

/**
 * The walkthrough itself (whats-new.ts says what it is and when it shows).
 *
 * One card and one light. The page dims, the thing the step is about stays
 * lit, and the card sits beside it with a sentence or two and Next. Where a
 * step has nothing to point at on this screen, the card is in the middle.
 *
 * It is a dialog: the page behind cannot be tapped by mistake, the keyboard
 * stays inside it, Escape puts it away (as Skip does), and focus goes back to
 * where it was. Left and right arrows step through. A tap on the dimmed page
 * does nothing, so a stray thumb does not lose the tour.
 *
 * It never moves the page: everything it points at is in the bars that stay
 * put, and it keeps clear of the notch and the home indicator.
 */

const PAD = 6;
const wideQuery = '(min-width: 1024px)';

const isWide = () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(wideQuery).matches : true);

/** The first thing with one of these names that is on screen now. */
function findTarget(anchors: string[] | undefined): HTMLElement | null {
  for (const name of anchors ?? []) {
    for (const el of document.querySelectorAll<HTMLElement>(`[data-tour~="${name}"]`)) {
      const box = el.getBoundingClientRect();
      if (box.width > 0 && box.height > 0 && box.bottom > 0 && box.top < window.innerHeight) return el;
    }
  }
  return null;
}

const sameBox = (a: Box | null, b: Box | null) => a === b || (!!a && !!b && a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height);

interface Props {
  open: boolean;
  /** Skip, Done and Escape all end here; the layout remembers that it was seen. */
  onClose: () => void;
  owner: boolean;
  demo: boolean;
  standalone: boolean;
  /** What the keyboard was on when it was asked for (the "What's new" button), to go back to. */
  returnTo?: React.RefObject<HTMLElement | null>;
}

const WhatsNewTour = ({ open, onClose, owner, demo, standalone, returnTo }: Props) => {
  const reduced = useReducedMotion();
  const [wide, setWide] = useState(isWide);
  const [index, setIndex] = useState(0);
  const [target, setTarget] = useState<Box | null>(null);
  const [spot, setSpot] = useState<{ top: number; left: number } | null>(null);
  // Kept as state, not refs: the dialog is drawn a beat after it opens, and the measuring must wait for it.
  const [card, setCard] = useState<HTMLDivElement | null>(null);
  const [frame, setFrame] = useState<HTMLDivElement | null>(null);
  const next = useRef<HTMLButtonElement>(null);
  // The card glides from one step's place to the next, but appears where it belongs the first time.
  const placed = useRef(false);

  const steps = useMemo(
    () => tourSteps({ owner, wide, demo, standalone, shortcut: searchShortcut() }),
    [owner, wide, demo, standalone],
  );
  const last = steps.length - 1;
  const step = steps[Math.min(index, last)];

  // From its first step every time it opens.
  useEffect(() => { if (open) setIndex(0); }, [open]);

  useEffect(() => {
    const query = window.matchMedia?.(wideQuery);
    if (!query) return;
    const onChange = () => setWide(query.matches);
    query.addEventListener?.('change', onChange);
    return () => query.removeEventListener?.('change', onChange);
  }, []);

  /*
   * Where the thing is, and where the card goes beside it. Measured after
   * every render that could move either, and again when the window changes
   * (a phone turned on its side, a laptop window resized).
   */
  const measure = useCallback(() => {
    const el = findTarget(step.anchors);
    const box = el?.getBoundingClientRect();
    const found: Box | null = box
      ? { top: Math.round(box.top) - PAD, left: Math.round(box.left) - PAD, width: Math.round(box.width) + PAD * 2, height: Math.round(box.height) + PAD * 2 }
      : null;
    setTarget((before) => (sameBox(before, found) ? before : found));
    const safe = frame?.getBoundingClientRect();
    const size = card?.getBoundingClientRect();
    if (!safe || !size) return;
    const at = placeCallout(found, { width: size.width, height: size.height }, { top: safe.top, left: safe.left, width: safe.width, height: safe.height });
    setSpot((before) => (before && Math.abs(before.top - at.top) < 1 && Math.abs(before.left - at.left) < 1 ? before : at));
  }, [step.anchors, card, frame]);

  useLayoutEffect(() => {
    if (!open) { setSpot(null); placed.current = false; return; }
    measure();
  }, [open, index, wide, measure]);

  useEffect(() => { if (open && spot) placed.current = true; }, [open, spot]);

  // Back, on the second step, takes itself away: the keyboard stays on the card, on Next.
  // (Safari gives a clicked button's focus to the card itself; from there too.)
  useEffect(() => {
    const active = document.activeElement;
    if (open && card && (active === card || !card.contains(active))) next.current?.focus();
  }, [open, index, card]);

  useEffect(() => {
    if (!open) return;
    let frameId = 0;
    const again = () => { cancelAnimationFrame(frameId); frameId = requestAnimationFrame(measure); };
    window.addEventListener('resize', again);
    window.addEventListener('orientationchange', again);
    // The card's own height changes with its words; the bars settle a moment after the page loads.
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(again);
    if (card) observer?.observe(card);
    const settle = window.setTimeout(again, 350);
    return () => {
      cancelAnimationFrame(frameId);
      window.clearTimeout(settle);
      window.removeEventListener('resize', again);
      window.removeEventListener('orientationchange', again);
      observer?.disconnect();
    };
  }, [open, measure, card]);

  const go = (to: number) => setIndex(Math.max(0, Math.min(to, last)));
  const forward = () => (index >= last ? onClose() : go(index + 1));

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') { event.preventDefault(); onClose(); }
    if (event.key === 'ArrowRight') { event.preventDefault(); forward(); }
    if (event.key === 'ArrowLeft') { event.preventDefault(); go(index - 1); }
  };

  const move = reduced ? { duration: 0 } : { duration: 0.28, ease: easeStandard };
  // Nothing to point at: the light closes to a point in the middle, and the whole page is dim.
  const light = target ?? { top: window.innerHeight / 2, left: window.innerWidth / 2, width: 0, height: 0 };

  return (
    <Dialog.Root open={open} onOpenChange={(to) => { if (!to) onClose(); }}>
      <Dialog.Portal>
        {/* The screen less the notch and the home indicator: what the card must stay inside. */}
        <div
          ref={setFrame}
          aria-hidden
          className="pointer-events-none fixed bottom-[env(safe-area-inset-bottom)] left-[env(safe-area-inset-left)] right-[env(safe-area-inset-right)] top-[env(safe-area-inset-top)] z-[70]"
        />
        <Dialog.Overlay className="fixed inset-0 z-[70] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0">
          <motion.div
            data-testid="tour-light"
            initial={false}
            animate={{ top: light.top, left: light.left, width: light.width, height: light.height, opacity: 1 }}
            transition={move}
            className={cn('pointer-events-none absolute rounded-2xl shadow-[0_0_0_200vmax_hsl(var(--charcoal)/0.5)]', target && 'ring-2 ring-white/80')}
          />
        </Dialog.Overlay>
        <Dialog.Content
          ref={setCard}
          data-testid="whats-new-tour"
          data-step={step.id}
          aria-describedby="whats-new-words"
          onKeyDown={onKeyDown}
          onOpenAutoFocus={(event) => { event.preventDefault(); next.current?.focus(); }}
          // Back to the button that opened it, where there was one and it is still there.
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (returnTo?.current?.isConnected) returnTo.current.focus();
          }}
          // A stray tap on the dimmed page must not lose the tour.
          onInteractOutside={(event) => event.preventDefault()}
          // Unseen, not hidden, for the instant before it is placed: a hidden card cannot take the keyboard.
          // (No pointer-events here: the dialog sets its own, and a key of ours would undo it.)
          style={spot ? { top: spot.top, left: spot.left } : { top: 0, left: 0, opacity: 0 }}
          className={cn(
            'fixed z-[71] flex max-h-[calc(100dvh-env(safe-area-inset-top)-env(safe-area-inset-bottom)-1.5rem)] w-[min(23rem,calc(100vw-1.5rem))] flex-col overflow-y-auto overscroll-contain rounded-2xl border border-border bg-card p-5 font-sans text-foreground shadow-2xl outline-none',
            'data-[state=open]:animate-in data-[state=open]:fade-in-0',
            !reduced && placed.current && 'transition-[top,left] duration-300 ease-out',
          )}
        >
          <p className="text-base text-muted-foreground lg:text-xs lg:font-semibold lg:uppercase lg:tracking-[0.14em]">
            Step {index + 1} of {steps.length}
          </p>
          <Dialog.Title className="mt-1 font-serif text-[1.375rem] font-semibold leading-snug text-foreground">{step.title}</Dialog.Title>
          <div id="whats-new-words" aria-live="polite" className="mt-2 space-y-2.5 text-base leading-relaxed text-foreground/90 lg:text-[15px]">
            <p>{step.body}</p>
            {step.points && (
              <ul className="space-y-1.5">
                {step.points.map((point) => (
                  <li key={point} className="flex gap-2.5">
                    <span aria-hidden className="mt-[0.6em] h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                    <span>{point}</span>
                  </li>
                ))}
              </ul>
            )}
            {step.note && <p className="text-muted-foreground">{step.note}</p>}
          </div>

          <div aria-hidden className="mt-4 flex items-center gap-1.5">
            {steps.map((s, i) => (
              <span key={s.id} className={cn('h-1.5 rounded-full transition-all duration-300 motion-reduce:transition-none', i === index ? 'w-5 bg-primary' : 'w-1.5 bg-foreground/20')} />
            ))}
          </div>

          <div className="mt-3 flex items-center gap-2">
            {index < last && (
              <Button type="button" variant="ghost" onClick={onClose} className="-ml-3 min-h-[44px] px-3 text-base text-muted-foreground lg:text-sm">
                Skip
              </Button>
            )}
            <span className="flex-1" />
            {index > 0 && (
              <Button type="button" variant="outline" onClick={() => go(index - 1)} className="min-h-[44px] px-4 text-base lg:text-sm">
                Back
              </Button>
            )}
            <Button ref={next} type="button" onClick={forward} className="min-h-[44px] min-w-[5.5rem] px-5 text-base font-semibold lg:text-sm">
              {index >= last ? 'Done' : 'Next'}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};

export default WhatsNewTour;
