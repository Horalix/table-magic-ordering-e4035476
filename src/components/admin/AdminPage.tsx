import * as React from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * The top of every admin page, and the sections inside it, so a page starts
 * the same way wherever the manager is: what this page is, one line on what
 * it is for, and what can be done here.
 *
 * - AdminPageHeader: the page's one h1, a line of description, the actions
 *   on the right (under the title on a phone), and an optional row of facts
 *   or filters beneath.
 * - AdminSection: an h2 with an optional description and action, for the
 *   groups of cards on a page.
 * - AdminToolbar: one row of filters or search that wraps on a phone and
 *   scrolls nowhere.
 *
 * Cards, figures and empty states are in AdminCard.tsx.
 */

export const AdminPageHeader = ({
  title, description, actions, loading = false, eyebrow, children, className, titleId,
}: {
  title: React.ReactNode;
  /** One or two sentences, muted. What the page is for, in the manager's words. */
  description?: React.ReactNode;
  /** Buttons at the top right; they move under the title on a phone. The main one last. */
  actions?: React.ReactNode;
  /** A quiet spinner beside the title while the page's figures load again. */
  loading?: boolean;
  /** A small label above the title: the section the page belongs to, or a date. */
  eyebrow?: React.ReactNode;
  /** A row under the header: facts, tabs or filters. */
  children?: React.ReactNode;
  className?: string;
  titleId?: string;
}) => (
  <header className={cn('mb-6 sm:mb-8', className)}>
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
      <div className="min-w-0 max-w-3xl flex-1 basis-64">
        {eyebrow && (
          <p className="mb-1.5 text-[11px] font-sans font-semibold uppercase tracking-[0.14em] text-muted-foreground">{eyebrow}</p>
        )}
        <h1 id={titleId} className="flex items-center gap-2.5 font-serif text-[1.75rem] font-bold leading-tight tracking-[-0.01em] text-foreground sm:text-3xl">
          <span className="min-w-0 text-balance">{title}</span>
          {loading && <Loader2 className="h-5 w-5 shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none" aria-label="Loading" />}
        </h1>
        {description && (
          <p className="mt-1.5 text-sm font-sans leading-relaxed text-muted-foreground text-pretty">{description}</p>
        )}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
    {children && <div className="mt-4">{children}</div>}
  </header>
);

export const AdminSection = ({
  title, description, action, children, className, titleId, ...rest
}: Omit<React.HTMLAttributes<HTMLElement>, 'title'> & {
  title: React.ReactNode;
  description?: React.ReactNode;
  /** A button or link at the right of the section's title. */
  action?: React.ReactNode;
  titleId?: string;
}) => (
  <section aria-labelledby={titleId} className={cn('mt-8 first:mt-0', className)} {...rest}>
    <div className="mb-3 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
      <div className="min-w-0">
        <h2 id={titleId} className="font-serif text-xl font-semibold leading-snug text-foreground">{title}</h2>
        {description && <p className="mt-0.5 text-[13px] font-sans leading-relaxed text-muted-foreground">{description}</p>}
      </div>
      {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
    </div>
    {children}
  </section>
);

export const AdminToolbar = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('flex flex-wrap items-center gap-2', className)} {...props} />
);
