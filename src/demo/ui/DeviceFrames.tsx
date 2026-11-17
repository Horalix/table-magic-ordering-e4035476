/**
 * A phone and a larger screen, each a live frame of the app (demo mode only).
 * Used by the demo's front page and by the side-by-side stage: what is inside
 * is the real product running against the one in-browser restaurant, so an
 * order sent in one frame lands in the other.
 *
 * A frame is drawn at the device's real size and scaled to the space it is
 * given, so the app inside lays out exactly as it does on that device.
 */
import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

const PHONE = { width: 390, height: 844 };
const SCREEN = { width: 1280, height: 800 };

/** How much a box of this size has to shrink (or may grow, up to `max`) to fit its container. */
function useFit(width: number, height: number, max = 1.25) {
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => {
      if (!el.clientWidth || !el.clientHeight) return;
      setScale(Math.min(el.clientWidth / width, el.clientHeight / height, max));
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(el);
    return () => observer.disconnect();
  }, [width, height, max]);
  return { box, scale };
}

interface DeviceProps {
  kind: 'phone' | 'screen';
  src: string;
  /** The frame's accessible name. */
  name: string;
  /** Set on the <iframe> as data-stage, which the recording scripts look for. */
  stage?: string;
  max?: number;
  /** Where the device sits in its box when the box is larger. */
  align?: 'center' | 'start' | 'end';
  onFrame?: (frame: HTMLIFrameElement | null) => void;
  children?: ReactNode;
}

const BEZEL = { phone: 12, screen: 9 };

/** One device, scaled to fit the box it is put in. */
export const Device = ({ kind, src, name, stage, max, align = 'center', onFrame, children }: DeviceProps) => {
  const size = kind === 'phone' ? PHONE : SCREEN;
  const bezel = BEZEL[kind];
  const outer = { width: size.width + bezel * 2, height: size.height + bezel * 2 };
  const { box, scale } = useFit(outer.width, outer.height, max);
  const shell: CSSProperties = {
    width: outer.width, height: outer.height, padding: bezel, transform: `scale(${scale})`, transformOrigin: 'top left',
    background: 'linear-gradient(160deg,#2A332E 0%,#0B0F0D 38%,#141A17 100%)',
    boxShadow: '0 0 0 1px rgba(255,255,255,.07) inset, 0 1px 0 rgba(255,255,255,.14) inset, 0 50px 90px -30px rgba(0,0,0,.75), 0 18px 36px -18px rgba(0,0,0,.6)',
  };
  const justify = align === 'start' ? 'justify-start' : align === 'end' ? 'justify-end' : 'justify-center';
  return (
    <div ref={box} className={`relative flex h-full w-full items-center ${justify}`}>
      <div className="relative" style={{ width: outer.width * scale, height: outer.height * scale }}>
        <div className={kind === 'phone' ? 'rounded-[54px]' : 'rounded-[20px]'} style={shell}>
          <iframe
            ref={onFrame}
            title={name}
            data-stage={stage}
            src={src}
            loading="eager"
            className={`block bg-[#F8F6F0] ${kind === 'phone' ? 'rounded-[42px]' : 'rounded-[12px]'}`}
            style={{ width: size.width, height: size.height, border: 0 }}
          />
          {kind === 'phone' && (
            // The speaker slot: enough to read as a phone, small enough not to cover the app's header.
            <span aria-hidden className="pointer-events-none absolute left-1/2 top-[19px] h-[5px] w-[54px] -translate-x-1/2 rounded-full bg-black/35" />
          )}
        </div>
        {children}
      </div>
    </div>
  );
};
