import React from 'react';
import { ArrowUpRight, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { NavLauncher } from './admin-nav';
import { searchShortcut } from './manager-app';
import type { AdminShell } from './shell';

/** The small count on an area or a tab: guests waiting for an answer. */
export const WaitingBadge = ({ count, label, className, ...rest }: React.HTMLAttributes<HTMLSpanElement> & { count: number; label: string }) => (
  <span
    aria-label={label}
    className={cn(
      'grid h-5 min-w-5 place-items-center rounded-full bg-primary px-1.5 text-[11px] font-semibold leading-none text-primary-foreground tabular-nums',
      className,
    )}
    {...rest}
  >
    {count}
  </span>
);

/**
 * "Search or jump to…": looks like a field, opens the search (⌘K / Ctrl K).
 * A button, so a tap on a phone opens the search with the keyboard instead of
 * zooming into a field that then moves.
 */
export const SearchField = ({ onOpen, tone, className }: { onOpen: () => void; tone: 'sidebar' | 'page'; className?: string }) => (
  <button
    type="button"
    onClick={onOpen}
    aria-label="Search or jump to a page"
    aria-keyshortcuts="Meta+K Control+K"
    className={cn(
      'flex w-full items-center gap-2.5 rounded-lg px-3 text-left font-sans transition-colors focus-visible:outline-none focus-visible:ring-2',
      tone === 'sidebar'
        ? 'h-11 bg-sidebar-accent/60 text-[13px] text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground/80 focus-visible:ring-sidebar-ring'
        : 'h-12 border border-border bg-card text-base text-muted-foreground hover:bg-muted/60 focus-visible:ring-ring',
      className,
    )}
  >
    <Search className="h-4 w-4 shrink-0" aria-hidden />
    <span className="min-w-0 flex-1 truncate">Search or jump to…</span>
    {tone === 'sidebar' && (
      <kbd aria-hidden className="rounded border border-sidebar-border bg-sidebar px-1.5 py-0.5 font-sans text-[11px] font-medium text-sidebar-foreground/55">
        {searchShortcut()}
      </kbd>
    )}
  </button>
);

/**
 * The kitchen display or the floor monitor: a screen of its own, not an
 * admin page. In a browser it opens in a new tab, so the admin stays where
 * it was. The Home Screen app has no tabs and no back button, so there the
 * layout opens it in a frame with "Admin" above it (ScreenFrame.tsx).
 */
export const LauncherLink = ({ launcher, shell, className, children, onOpened }: {
  launcher: NavLauncher;
  shell: Pick<AdminShell, 'standalone' | 'launch'>;
  className?: string;
  children: React.ReactNode;
  onOpened?: () => void;
}) => (shell.standalone ? (
  <button type="button" onClick={() => { shell.launch(launcher); onOpened?.(); }} className={className}>
    {children}
  </button>
) : (
  <a href={launcher.path} target="_blank" rel="noopener" onClick={onOpened} className={className}>
    {children}
    <span className="sr-only"> (opens in a new tab)</span>
  </a>
));

export const OpensElsewhere = ({ className }: { className?: string }) => (
  <ArrowUpRight className={cn('h-3.5 w-3.5 shrink-0 opacity-60', className)} aria-hidden />
);

/** The owner, or an admin of both, looks at one restaurant at a time; everyone else only ever has theirs. */
export const RestaurantSwitch = ({ shell, tone }: { shell: Pick<AdminShell, 'choices' | 'venueSlug' | 'switchVenue'>; tone: 'sidebar' | 'page' }) => {
  if (shell.choices.length < 2) return null;
  return (
    <div
      role="group"
      aria-label="Restaurant"
      className={cn('grid grid-cols-2 gap-1 rounded-lg p-1', tone === 'sidebar' ? 'bg-sidebar-accent/50' : 'bg-muted')}
    >
      {shell.choices.map((v) => {
        const current = v.slug === shell.venueSlug;
        return (
          <button
            key={v.slug}
            type="button"
            aria-pressed={current}
            onClick={() => { if (!current) shell.switchVenue(v.slug); }}
            className={cn(
              'rounded-md px-2 font-sans transition-colors focus-visible:outline-none focus-visible:ring-2',
              tone === 'sidebar' ? 'min-h-11 text-xs focus-visible:ring-sidebar-ring' : 'min-h-11 text-sm focus-visible:ring-ring',
              current
                ? tone === 'sidebar'
                  ? 'bg-sidebar font-semibold text-sidebar-foreground shadow-sm'
                  : 'bg-card font-semibold text-foreground shadow-sm'
                : tone === 'sidebar'
                  ? 'text-sidebar-foreground/65 hover:text-sidebar-foreground'
                  : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {v.name}
          </button>
        );
      })}
    </div>
  );
};
