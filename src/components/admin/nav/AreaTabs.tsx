import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import { springPill } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { RESERVATIONS_PATH, areaOf, pageAt, pagesIn, type AreaId, type NavAudience } from './admin-nav';
import { WaitingBadge, WaitingWords } from './NavParts';

/**
 * The pages of the area you are in, across the top of the content.
 *
 * One list, two looks: on a laptop an underlined tab row; on a phone a row
 * of chips under the top bar that scrolls sideways and keeps the page you
 * are on in view. An area with one page for this account (Home, for a
 * restaurant's own admin) has no row at all.
 */
const AreaTabs = ({ area, audience, pathname, pending }: { area: AreaId; audience: NavAudience; pathname: string; pending: number }) => {
  const pages = pagesIn(area, audience);
  const current = pageAt(pathname)?.path ?? null;
  const reduced = useReducedMotion();
  const list = useRef<HTMLUListElement>(null);

  // Keep the page you are on in view: the chip row is wider than a phone.
  useEffect(() => {
    const row = list.current;
    const active = row?.querySelector<HTMLElement>('[aria-current="page"]')?.parentElement;
    if (!row || !active || row.scrollWidth <= row.clientWidth) return;
    const left = active.offsetLeft - (row.clientWidth - active.offsetWidth) / 2;
    row.scrollTo({ left: Math.max(0, left), behavior: reduced ? 'auto' : 'smooth' });
  }, [current, reduced, pages.length]);

  if (pages.length < 2) return null;
  const transition = reduced ? { duration: 0 } : springPill;

  return (
    <nav aria-label={`${areaOf(area).label} pages`} data-testid="admin-area-tabs" className="lg:border-b lg:border-border/70">
      <ul
        ref={list}
        className="scrollbar-hide mx-auto flex w-full max-w-7xl items-center gap-1.5 overflow-x-auto overscroll-x-contain px-3 pb-2 sm:px-5 lg:gap-7 lg:px-8 lg:pb-0"
      >
        {pages.map((page) => {
          const active = page.path === current;
          const waiting = page.path === RESERVATIONS_PATH ? pending : 0;
          return (
            <li key={page.path} className="shrink-0">
              <Link
                to={page.path}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'group relative flex min-h-[44px] items-center whitespace-nowrap font-sans text-sm transition-colors focus-visible:outline-none lg:min-h-[48px]',
                  active ? 'font-medium text-background lg:text-foreground' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <span
                  className={cn(
                    'relative flex h-9 items-center gap-1.5 rounded-full px-3.5 group-focus-visible:ring-2 group-focus-visible:ring-ring group-focus-visible:ring-offset-2 group-focus-visible:ring-offset-background lg:h-8 lg:rounded-md lg:px-1',
                    !active && 'border border-border bg-card lg:border-0 lg:bg-transparent',
                  )}
                >
                  {/* Phone: the filled chip slides to the page you tap. */}
                  {active && <motion.span layoutId="admin-tab-chip" transition={transition} className="absolute inset-0 rounded-full bg-foreground lg:hidden" />}
                  <span className="relative">{page.label}{waiting > 0 && <WaitingWords count={waiting} />}</span>
                  {waiting > 0 && (
                    <WaitingBadge
                      data-testid="reservations-waiting"
                      count={waiting}
                      className={cn('relative', active && 'bg-background text-foreground lg:bg-primary lg:text-primary-foreground')}
                    />
                  )}
                </span>
                {/* Laptop: the underline does. */}
                {active && <motion.span layoutId="admin-tab-line" transition={transition} className="absolute inset-x-0 bottom-[-1px] hidden h-0.5 rounded-full bg-primary lg:block" />}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
};

export default AreaTabs;
