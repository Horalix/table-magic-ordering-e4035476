import * as React from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';
import CountUp from '@/components/admin/CountUp';
import { signedPct } from '@/lib/reporting';

/**
 * One card language for the owner's back office: dashboard, analytics, the
 * daily report and menu intelligence all build from these, so a card has the
 * same corners, padding, title and figure styles wherever it appears.
 *
 * - AdminCard: the surface. 16px corners, a hairline border, a soft shadow.
 * - AdminCardHeader: serif title, one line of muted subtitle, optional icon
 *   in a soft square and an action on the right.
 * - KpiCard: small label, big figure that counts up, optional delta chip and hint.
 * - DeltaChip: a change, green when it is good news and red when it is not.
 * - EmptyState: an icon in a soft circle, one line of title, one of hint.
 */

export type Tone = 'primary' | 'accent' | 'destructive' | 'muted';

const TONE: Record<Tone, string> = {
  primary: 'bg-primary/10 text-primary',
  accent: 'bg-accent/10 text-accent',
  destructive: 'bg-destructive/10 text-destructive',
  muted: 'bg-muted text-muted-foreground',
};

/** The faint halo around an empty state's icon. */
const HALO: Record<Tone, string> = {
  primary: 'ring-primary/5',
  accent: 'ring-accent/5',
  destructive: 'ring-destructive/5',
  muted: 'ring-muted/50',
};

/* ---- Surface ----------------------------------------------------------- */

export const AdminCard = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('rounded-2xl border border-border/80 bg-card text-card-foreground shadow-lux', className)}
      {...props}
    />
  ),
);
AdminCard.displayName = 'AdminCard';

export const AdminCardHeader = ({
  icon: Icon, tone = 'primary', title, description, action, className, titleId,
}: {
  icon?: React.ElementType;
  tone?: Tone;
  title: React.ReactNode;
  description?: React.ReactNode;
  /** A button or link at the top right. */
  action?: React.ReactNode;
  className?: string;
  titleId?: string;
}) => (
  <div className={cn('flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-5 pt-5 pb-4 sm:px-6 sm:pt-6', className)}>
    <div className="flex min-w-0 flex-1 items-start gap-3">
      {Icon && (
        <span className={cn('mt-px hidden h-8 w-8 shrink-0 place-items-center rounded-lg sm:grid', TONE[tone])} aria-hidden>
          <Icon className="h-4 w-4" />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <h2 id={titleId} className="font-serif text-lg font-semibold leading-snug text-foreground">{title}</h2>
        {description && (
          <p className="mt-1 text-[13px] font-sans leading-relaxed text-muted-foreground">{description}</p>
        )}
      </div>
    </div>
    {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
  </div>
);

export const AdminCardContent = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('px-5 pb-5 sm:px-6 sm:pb-6', className)} {...props} />
);

/* ---- Figures ----------------------------------------------------------- */

/**
 * A change as a chip. `change` is a fraction (0.13 = +13%). Whether up is good
 * is the caller's to say: more sales is good, a longer wait is not.
 */
export const DeltaChip = ({
  change, upIsGood = true, label, className,
}: {
  change: number;
  upIsGood?: boolean;
  /** Replaces the percentage, e.g. "113% of usual". */
  label?: React.ReactNode;
  className?: string;
}) => {
  const flat = Math.round(change * 100) === 0;
  const good = flat ? null : (change > 0) === upIsGood;
  const Icon = flat ? Minus : change > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-semibold leading-4 tabular-nums',
        good === null && 'bg-muted text-muted-foreground',
        good === true && 'bg-emerald-600/10 text-emerald-700 dark:text-emerald-400',
        good === false && 'bg-red-600/10 text-red-700 dark:text-red-400',
        className,
      )}
    >
      <Icon className="h-3 w-3" aria-hidden />
      {label ?? signedPct(change)}
    </span>
  );
};

/**
 * A key figure: label, number, then the line that explains it.
 *
 * Give `value` and `format` for a number that counts up, or `display` for a
 * figure that is not one ("—", "Not measured").
 */
export const KpiCard = ({
  label, value, format, display, unit, hint, icon: Icon, tone = 'primary', delta, className, size = 'md',
}: {
  label: React.ReactNode;
  value?: number;
  format?: (n: number) => string;
  display?: React.ReactNode;
  /** Shown smaller beside the figure: "KM", "min", "%". */
  unit?: string;
  hint?: React.ReactNode;
  icon?: React.ElementType;
  tone?: Tone;
  delta?: React.ReactNode;
  className?: string;
  size?: 'md' | 'sm';
}) => (
  <AdminCard className={cn('flex h-full flex-col p-4 sm:p-5', className)}>
    <div className="flex items-start justify-between gap-2">
      <p className="text-[13px] font-sans font-medium leading-snug text-muted-foreground">{label}</p>
      {Icon && (
        <span className={cn('hidden sm:grid h-8 w-8 shrink-0 place-items-center rounded-full', TONE[tone])} aria-hidden>
          <Icon className="h-4 w-4" />
        </span>
      )}
    </div>
    <p
      className={cn(
        'mt-2 font-sans font-semibold leading-none tracking-tight text-foreground',
        size === 'md' ? 'text-[22px] sm:text-[28px]' : 'text-xl sm:text-[22px]',
      )}
    >
      {display ?? <CountUp value={value ?? 0} format={format} />}
      {unit && <span className="ml-1 text-sm font-medium tracking-normal text-muted-foreground">{unit}</span>}
    </p>
    {(delta || hint) && (
      <div className="mt-auto flex flex-wrap items-center gap-x-2 gap-y-1 pt-2.5 text-xs font-sans leading-snug text-muted-foreground">
        {delta}
        {hint && <span className="min-w-0">{hint}</span>}
      </div>
    )}
  </AdminCard>
);

/* ---- Empty ------------------------------------------------------------- */

export const EmptyState = ({
  icon: Icon, title, hint, className, tone = 'muted',
}: {
  icon: React.ElementType;
  title: React.ReactNode;
  hint?: React.ReactNode;
  className?: string;
  tone?: Tone;
}) => (
  <div className={cn('flex flex-col items-center justify-center px-6 py-10 text-center', className)}>
    <span className={cn('grid h-11 w-11 place-items-center rounded-full ring-8', TONE[tone], HALO[tone])} aria-hidden>
      <Icon className="h-5 w-5" />
    </span>
    <p className="mt-4 text-sm font-sans font-medium text-foreground">{title}</p>
    {hint && <p className="mt-1 max-w-sm text-xs font-sans leading-relaxed text-muted-foreground">{hint}</p>}
  </div>
);

/* ---- Entrance ---------------------------------------------------------- */

/**
 * Children rise in one after another (40 ms apart) on first paint; with
 * reduced motion they are simply there.
 */
export const Stagger = ({ children, className, as = 'div', 'aria-label': label }: {
  children: React.ReactNode;
  className?: string;
  as?: 'div' | 'section';
  'aria-label'?: string;
}) => {
  const reduce = useReducedMotion();
  const Comp = as === 'section' ? motion.section : motion.div;
  return (
    <Comp
      className={className}
      aria-label={label}
      initial={reduce ? false : 'hidden'}
      animate="show"
      variants={{ hidden: {}, show: { transition: { staggerChildren: 0.04 } } }}
    >
      {React.Children.map(children, (child) => child && (
        <motion.div
          className="min-w-0"
          variants={{
            hidden: { opacity: 0, y: 8 },
            show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.16, 1, 0.3, 1] } },
          }}
        >
          {child}
        </motion.div>
      ))}
    </Comp>
  );
};
