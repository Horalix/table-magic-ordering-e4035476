import { useLayoutEffect, useRef, useState } from 'react';

/**
 * A button label that never ends in "…". It shows `full` while it fits and
 * `short` when it does not: "Add to order" on a wide phone, "Add" on a 360 px
 * one, and "Dodaj" in Bosnian wherever "Dodaj u narudžbu" would be cut off.
 * The check reruns when the button changes width (rotation, a longer price).
 */
const FitLabel = ({ full, short, className = '' }: { full: string; short: string; className?: string }) => {
  const box = useRef<HTMLSpanElement>(null);
  const probe = useRef<HTMLSpanElement>(null);
  const [fits, setFits] = useState(true);

  useLayoutEffect(() => {
    const el = box.current;
    const p = probe.current;
    if (!el || !p) return;
    const measure = () => setFits(p.scrollWidth <= el.clientWidth + 0.5);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [full, short]);

  return (
    <span ref={box} className={`relative block min-w-0 flex-1 overflow-hidden text-start ${className}`}>
      {/* The full label, laid out but invisible, to know whether it fits. */}
      <span ref={probe} aria-hidden className="invisible absolute whitespace-nowrap">{full}</span>
      <span className="block truncate">{fits ? full : short}</span>
    </span>
  );
};

export default FitLabel;
