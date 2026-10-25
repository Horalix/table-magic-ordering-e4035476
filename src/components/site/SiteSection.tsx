import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import Reveal from './Reveal';

/** The page's width and side margins, shared by every section. */
export const Container = ({ children, className }: { children: ReactNode; className?: string }) => (
  <div className={cn('mx-auto w-full max-w-[1240px] px-5 sm:px-8', className)}>{children}</div>
);

/** The small label above a section title: a short rule and spaced capitals. */
export const Eyebrow = ({ children, tone = 'light', className }: { children: ReactNode; tone?: 'light' | 'dark'; className?: string }) => (
  <p
    className={cn(
      'flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.26em] rtl:tracking-normal',
      tone === 'light' ? 'text-ls-sage-deep' : 'text-ls-sage',
      className,
    )}
  >
    <span className={cn('h-px w-7', tone === 'light' ? 'bg-ls-sage-deep/60' : 'bg-ls-sage/70')} aria-hidden />
    <span>{children}</span>
  </p>
);

/** Eyebrow, title and an optional lead paragraph, revealed together. */
export const SectionHeading = ({
  id, eyebrow, title, lead, tone = 'light', className, align = 'start',
}: {
  id: string;
  eyebrow: string;
  title: string;
  lead?: string;
  tone?: 'light' | 'dark';
  className?: string;
  align?: 'start' | 'center';
}) => (
  <Reveal className={cn(align === 'center' && 'mx-auto text-center [&>p:first-child]:justify-center', className)}>
    <Eyebrow tone={tone}>{eyebrow}</Eyebrow>
    <h2
      id={id}
      className={cn(
        'mt-4 font-serif text-[2.1rem] font-medium leading-[1.08] tracking-[-0.012em] text-balance sm:text-[2.75rem] lg:text-[3.25rem] rtl:font-semibold rtl:leading-[1.3] rtl:tracking-normal',
        tone === 'light' ? 'text-ls-forest' : 'text-ls-cream',
      )}
    >
      {title}
    </h2>
    {lead && (
      <p className={cn('mt-4 max-w-[36rem] text-[16px] leading-[1.7] sm:text-[17px]', align === 'center' && 'mx-auto', tone === 'light' ? 'text-ls-grey' : 'text-ls-cream/75')}>
        {lead}
      </p>
    )}
  </Reveal>
);
