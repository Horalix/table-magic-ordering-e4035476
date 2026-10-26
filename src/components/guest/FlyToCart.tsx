import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useReducedMotion } from 'framer-motion';
import { toast } from 'sonner';
import { useCartFx, type Flight } from '@/lib/cart-fx';
import { t } from '@/lib/i18n';
import { duration, easeExit, easeStandard } from '@/lib/motion';
import imageManifest from '@/lib/image-manifest.json';
import { localImageFile } from '@/lib/menu-image';

/**
 * The add-to-order flight.
 *
 * A 40px round copy of the dish photo travels from the tap to the bag icon in
 * the CartBar: x on the standard curve, y on the exit curve, which together
 * draw a short arc that drops into the bag. 450 ms, then the bag pulses.
 *
 * Runs on the Web Animations API, off React's render path, so a flight costs
 * the menu list nothing. With reduced motion there is no flight at all — the
 * CartBar's label swap carries the message. When no CartBar is on screen the
 * guest gets a short toast instead, since there is nowhere to fly to.
 */

type ManifestEntry = { widths?: number[]; squares?: number[]; v?: string };
const manifest = imageManifest as Record<string, ManifestEntry>;

const SIZE = 40;
const cssEase = (e: readonly number[]) => `cubic-bezier(${e.join(', ')})`;

/** The smallest local photo for an item, else its remote image, else nothing. */
function photoFor(flight: Flight): string | null {
  const local = flight.id ? manifest[flight.id] : undefined;
  if (local && flight.id) {
    const file = localImageFile(flight.id, local);
    if (local.squares?.length) return file(`sq-${local.squares[0]}`);
    if (local.widths?.length) return file(String(local.widths[0]));
  }
  return flight.imageUrl || null;
}

/**
 * Centre of the bag icon, where it will be once its bar has settled. On the
 * very first add the CartBar is still sliding up, so its current transform is
 * taken out of the measurement.
 */
function findTarget(): { x: number; y: number } | null {
  if (typeof document === 'undefined') return null;
  const el = document.querySelector<HTMLElement>('[data-cart-target]');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  let x = r.left + r.width / 2;
  let y = r.top + r.height / 2;
  const bar = el.closest<HTMLElement>('[data-cart-bar]');
  if (bar && typeof DOMMatrixReadOnly !== 'undefined') {
    const tf = getComputedStyle(bar).transform;
    if (tf && tf !== 'none') {
      try {
        const m = new DOMMatrixReadOnly(tf);
        x -= m.m41;
        y -= m.m42;
      } catch { /* unparseable: aim at where it is now */ }
    }
  }
  const vh = window.innerHeight || document.documentElement.clientHeight;
  const vw = window.innerWidth || document.documentElement.clientWidth;
  if (y < 0 || y > vh || x < 0 || x > vw) return null;
  return { x, y };
}

interface ActiveFlight extends Flight {
  to: { x: number; y: number };
}

const FlightDot = ({ flight, onDone }: { flight: ActiveFlight; onDone: () => void }) => {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const done = useRef(onDone);
  done.current = onDone;
  const from = flight.from!;
  const fromX = from.left + from.width / 2;
  const fromY = from.top + from.height / 2;
  const src = photoFor(flight);

  useLayoutEffect(() => {
    const o = outer.current;
    const i = inner.current;
    if (!o || !i || typeof o.animate !== 'function') { done.current(); return; }
    const ms = duration.emphasis * 1000;
    const dx = flight.to.x - fromX;
    const dy = flight.to.y - fromY;
    const ax = o.animate(
      [{ transform: 'translateX(0px)' }, { transform: `translateX(${dx}px)` }],
      { duration: ms, easing: cssEase(easeStandard), fill: 'forwards' },
    );
    const ay = i.animate(
      [
        { transform: 'translateY(0px) scale(1)', opacity: 1 },
        { transform: `translateY(${dy}px) scale(0.35)`, opacity: 0.6 },
      ],
      { duration: ms, easing: cssEase(easeExit), fill: 'forwards' },
    );
    ay.onfinish = () => done.current();
    return () => { ax.cancel(); ay.cancel(); };
    // One flight, one animation: the inputs never change for a mounted dot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={outer}
      aria-hidden
      className="fixed pointer-events-none z-[70]"
      style={{ left: fromX - SIZE / 2, top: fromY - SIZE / 2, width: SIZE, height: SIZE, willChange: 'transform' }}
    >
      <div
        ref={inner}
        className="w-full h-full rounded-full overflow-hidden bg-primary shadow-lg ring-2 ring-white"
        style={{ willChange: 'transform, opacity' }}
      >
        {src && <img src={src} alt="" className="w-full h-full object-cover" draggable={false} />}
      </div>
    </div>
  );
};

const FlyToCart = () => {
  const queue = useCartFx((s) => s.queue);
  const take = useCartFx((s) => s.take);
  const land = useCartFx((s) => s.land);
  const reduced = useReducedMotion();
  const [active, setActive] = useState<ActiveFlight[]>([]);
  const reducedRef = useRef(reduced);
  reducedRef.current = reduced;

  useEffect(() => {
    if (queue.length === 0) return;
    for (const flight of queue) {
      take(flight.key);
      const start = () => {
        const to = findTarget();
        if (!to) {
          // Nowhere to fly to (no CartBar on this screen): say it in words.
          toast.success(t('added_to_order'), { description: flight.name, duration: 1200 });
          return;
        }
        // Reduced motion, or no tap origin: the CartBar label swap is enough.
        if (reducedRef.current || !flight.from) return;
        setActive((list) => [...list, { ...flight, to }]);
      };
      // Two frames: a CartBar mounting for the first item does so in the same
      // commit as this add, and needs a frame to be measurable.
      const run = () => requestAnimationFrame(() => requestAnimationFrame(start));
      if (flight.delayMs) setTimeout(run, flight.delayMs);
      else run();
    }
  }, [queue, take]);

  if (typeof document === 'undefined' || active.length === 0) return null;

  return createPortal(
    <>
      {active.map((f) => (
        <FlightDot
          key={f.key}
          flight={f}
          onDone={() => {
            setActive((list) => list.filter((x) => x.key !== f.key));
            land();
          }}
        />
      ))}
    </>,
    document.body,
  );
};

export default FlyToCart;
