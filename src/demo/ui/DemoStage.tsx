/**
 * Two screens side by side (demo mode only): a phone and a larger screen,
 * each a live frame of the app. They share the one in-browser restaurant, so
 * an order sent on the phone lands on the screen next to it — the whole
 * product in one picture, for presenting and for the recorded walkthrough
 * (scripts/demo-capture.mjs).
 *
 * /demo/stage?phone=<path>&screen=<path>&title=<text>&caption=<text>
 * Leave `phone` or `screen` out to show the other alone.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PRODUCT, RESTAURANT, guestTablePath } from '../brand';

const PHONE = { width: 390, height: 844 };
const SCREEN = { width: 1280, height: 800 };

const PRESETS: { label: string; phone: string; screen: string }[] = [
  { label: 'Guest + Kitchen', phone: guestTablePath(), screen: '/kitchen' },
  { label: 'Waiter + Kitchen', phone: '/waiter', screen: '/kitchen' },
  { label: 'Guest + Admin', phone: guestTablePath(), screen: '/admin' },
  { label: 'Waiter + Floor', phone: '/waiter', screen: '/waiter/monitor' },
];

/** Scales a fixed-size frame to the space it is given. */
function useFit(width: number, height: number) {
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => setScale(Math.min(el.clientWidth / width, el.clientHeight / height, 1.25));
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(el);
    return () => observer.disconnect();
  }, [width, height]);
  return { box, scale };
}

const Frame = ({ kind, src, name }: { kind: 'phone' | 'screen'; src: string; name: string }) => {
  const size = kind === 'phone' ? PHONE : SCREEN;
  const bezel = kind === 'phone' ? 14 : 10;
  const { box, scale } = useFit(size.width + bezel * 2, size.height + bezel * 2 + (kind === 'screen' ? 28 : 0));
  return (
    <div ref={box} className="relative flex h-full w-full items-center justify-center">
      <div style={{ width: (size.width + bezel * 2) * scale, height: (size.height + bezel * 2) * scale }}>
        <div
          className={kind === 'phone' ? 'rounded-[52px] bg-[#111512] shadow-[0_40px_80px_-20px_rgba(0,0,0,0.55)]' : 'rounded-[18px] bg-[#111512] shadow-[0_40px_80px_-24px_rgba(0,0,0,0.55)]'}
          style={{ width: size.width + bezel * 2, height: size.height + bezel * 2, padding: bezel, transform: `scale(${scale})`, transformOrigin: 'top left' }}
        >
          <iframe
            title={name}
            data-stage={kind}
            src={src}
            className={kind === 'phone' ? 'block rounded-[38px] bg-white' : 'block rounded-[10px] bg-white'}
            style={{ width: size.width, height: size.height, border: 0 }}
          />
        </div>
      </div>
    </div>
  );
};

const DemoStage = () => {
  const [params, setParams] = useSearchParams();
  const phone = params.get('phone');
  const screen = params.get('screen');
  const title = params.get('title');
  const caption = params.get('caption');
  const chrome = params.get('chrome') !== 'off';
  const both = !phone && !screen;
  const phoneSrc = both ? PRESETS[0].phone : phone;
  const screenSrc = both ? PRESETS[0].screen : screen;

  useEffect(() => {
    document.title = `${PRODUCT.name} — ${RESTAURANT.name}, side by side`;
    document.documentElement.setAttribute('dir', 'ltr');
  }, []);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden" style={{ background: 'radial-gradient(120% 90% at 50% 0%, hsl(150 14% 30%) 0%, hsl(150 16% 17%) 60%, hsl(150 18% 11%) 100%)' }}>
      {chrome && (
        <header className="flex shrink-0 items-center justify-between gap-6 px-10 pt-7">
          <div>
            <p className="font-sans text-[11px] font-semibold uppercase tracking-[0.32em] text-white/60">{PRODUCT.name} · {RESTAURANT.name}</p>
            <h1 className="mt-1 font-serif text-3xl font-semibold text-white">{title ?? 'One order, every screen'}</h1>
          </div>
          {!title && (
            <nav className="flex flex-wrap justify-end gap-2" aria-label="What to show">
              {PRESETS.map((preset) => {
                const active = preset.phone === phoneSrc && preset.screen === screenSrc;
                return (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => setParams({ phone: preset.phone, screen: preset.screen })}
                    className={`rounded-full px-4 py-2 font-sans text-sm font-semibold transition ${active ? 'bg-white text-foreground' : 'bg-white/10 text-white hover:bg-white/20'}`}
                  >
                    {preset.label}
                  </button>
                );
              })}
              <a href="/" className="rounded-full px-4 py-2 font-sans text-sm font-semibold text-white/70 hover:text-white">All screens</a>
            </nav>
          )}
        </header>
      )}
      <main className="flex min-h-0 flex-1 items-stretch gap-10 px-10 py-7">
        {phoneSrc && <div className={screenSrc ? 'w-[27%] min-w-0' : 'w-full'}><Frame kind="phone" src={phoneSrc} name="Phone" /></div>}
        {screenSrc && <div className="min-w-0 flex-1"><Frame kind="screen" src={screenSrc} name="Screen" /></div>}
      </main>
      {caption && (
        <footer className="shrink-0 px-10 pb-8">
          <p className="mx-auto max-w-4xl rounded-2xl bg-black/35 px-6 py-3.5 text-center font-sans text-xl font-medium text-white backdrop-blur" data-stage-caption>{caption}</p>
        </footer>
      )}
    </div>
  );
};

export default DemoStage;
