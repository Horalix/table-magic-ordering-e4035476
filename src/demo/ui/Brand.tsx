/**
 * The fictional restaurant's marks (demo mode only), drawn rather than
 * photographed: a monogram and its name set in the app's serif. Used wherever
 * the real restaurants show their logo files.
 */
import { RESTAURANT } from '../brand';

/** The monogram: a "C" with a terracotta dot. `tone` is the colour it sits on. */
export const DemoMonogram = ({ className, tone = 'light' }: { className?: string; tone?: 'light' | 'dark' }) => (
  <svg viewBox="0 0 64 64" className={className} role="img" aria-label={RESTAURANT.name}>
    <rect width="64" height="64" rx="15" fill={tone === 'light' ? '#33473B' : '#F4ECDD'} />
    <path d="M42 21.5a14 14 0 1 0 0 21" fill="none" stroke={tone === 'light' ? '#F4ECDD' : '#33473B'} strokeWidth="6" strokeLinecap="round" />
    <circle cx="45" cy="32" r="3.4" fill="#D98A5F" />
  </svg>
);

/** The name as a wordmark, for coloured bands (the menu's header, the TV board). */
export const DemoWordmark = ({ className }: { className?: string }) => (
  <span dir="ltr" className={`font-serif font-semibold tracking-[0.02em] text-white leading-none ${className ?? ''}`}>
    {RESTAURANT.name}
  </span>
);

/** Monogram over name and tagline, for the dark sign-in and table-entry screens. */
export const DemoLockup = ({ className }: { className?: string }) => (
  <div className={`flex flex-col items-center text-center ${className ?? ''}`}>
    <DemoMonogram tone="dark" className="h-20 w-20" />
    <span className="mt-5 font-serif text-4xl font-semibold text-white leading-none">{RESTAURANT.name}</span>
    <span className="mt-3 font-sans text-[11px] font-semibold uppercase tracking-[0.3em] text-white/80">{RESTAURANT.tagline}</span>
  </div>
);
