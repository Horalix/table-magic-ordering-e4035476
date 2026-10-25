import React from 'react';
import { useI18n } from '@/lib/i18n';
import { SALE_LABELS, type SaleLabel } from '@/lib/promotions';

const cents = (n: number) => Math.round(n * 100);

/**
 * A price, and when it is on sale, the menu price struck through after it.
 *
 * The price the guest pays comes first and carries the colour; the old one is
 * smaller and grey, so the eye lands on what will be charged. Screen readers
 * hear "Was 18.00 KM, now 14.40 KM" rather than two bare numbers.
 *
 * `bare` (the default) is for menu rows, where "Prices in KM" is said once in
 * the header; anything the guest is about to pay passes `bare={false}`.
 */
export const PriceTag = ({
  price, regular, bare = true, className = '', saleClassName = 'text-sale', regularClassName = '',
}: {
  price: number;
  regular?: number | null;
  bare?: boolean;
  className?: string;
  saleClassName?: string;
  regularClassName?: string;
}) => {
  const { t, price: full, priceBare } = useI18n();
  const fmt = bare ? priceBare : full;
  if (regular == null || cents(regular) <= cents(price)) {
    return <span className={`tabular-nums ${className}`}>{fmt(price)}</span>;
  }
  return (
    <span className={`inline-flex items-baseline gap-1.5 tabular-nums ${className}`}>
      <span className="sr-only">{t('price_was_now', { was: full(regular), now: full(price) })}</span>
      <span aria-hidden className={saleClassName}>{fmt(price)}</span>
      <s aria-hidden className={`text-[0.85em] font-normal text-muted-foreground ${regularClassName}`}>{fmt(regular)}</s>
    </span>
  );
};

/**
 * The small pill on a dish on sale: its label ("Happy hour") if it has one,
 * otherwise how much is off ("−20%").
 */
export const SaleBadge = ({ label, percentOff, className = '' }: { label?: string | null; percentOff?: number; className?: string }) => {
  const { t } = useI18n();
  const known = SALE_LABELS.includes(label as SaleLabel);
  const text = known
    ? t(`sale_label_${label}`)
    : percentOff && percentOff > 0 ? t('sale_badge_pct', { n: percentOff }) : t('sale_badge');
  return (
    <span
      data-sale-badge
      className={`inline-flex items-center rounded-full bg-sale text-sale-foreground px-2 py-0.5 text-[11px] font-sans font-semibold leading-tight whitespace-nowrap ${className}`}
    >
      {text}
    </span>
  );
};

/** The "New" pill. */
export const NewBadge = ({ className = '' }: { className?: string }) => {
  const { t } = useI18n();
  return (
    <span className={`inline-flex items-center rounded-full bg-primary text-primary-foreground px-2 py-0.5 text-[11px] font-sans font-semibold leading-tight whitespace-nowrap ${className}`}>
      {t('badge_new')}
    </span>
  );
};

/** The "Combo" pill. */
export const ComboBadge = ({ className = '' }: { className?: string }) => {
  const { t } = useI18n();
  return (
    <span className={`inline-flex items-center rounded-full border border-primary/40 text-primary px-2 py-0.5 text-[11px] font-sans font-semibold leading-tight whitespace-nowrap ${className}`}>
      {t('combo_badge')}
    </span>
  );
};

export default PriceTag;
