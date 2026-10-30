import React from 'react';
import { motion } from 'framer-motion';
import SmartImage from '@/components/ui/SmartImage';
import { PriceTag, SaleBadge, NewBadge, ComboBadge } from '@/components/guest/PriceTag';
import { useI18n, getLocalizedName } from '@/lib/i18n';
import { useVenue } from '@/hooks/useVenue';
import { fadeUp, PRESS_SCALE } from '@/lib/motion';
import { useComboMap, usePromotedItems, type MenuItemRow } from '@/lib/promotions-api';
import { comboUnitPrice, fixedChoices, isNew, saleView, type ComboDef } from '@/lib/promotions';
import { VERA, pick } from '@/components/vera/copy';

/**
 * The home screen's promotions: up to three featured dishes, what is on sale,
 * what is new, and the combos. Each row appears only when it has something in
 * it, and every card opens the dish sheet in one tap.
 *
 * They sit between search and the category covers. A guest who came for the
 * menu scrolls past four short rows; a guest who has not decided yet gets
 * the dishes the owner most wants them to see first.
 */
const HomePromotions = ({ onOpen }: { onOpen: (item: MenuItemRow) => void }) => {
  const { featured, offers, fresh, combos, now } = usePromotedItems();
  const venue = useVenue();
  const comboMap = useComboMap();
  const { t, locale } = useI18n();
  // Vera Italia: the same rows, set like its printed menu (see src/components/vera).
  const vera = venue.slug === 'veraitalia';

  return (
    <>
      {featured.length > 0 && (
        <PromoRow id="featured" title={vera ? pick(VERA.specialita, locale) : t('featured_title')} vera={vera}>
          {featured.map((item) => <FeaturedCard key={item.id} item={item} combo={comboMap.get(item.id)} now={now} onOpen={onOpen} vera={vera} />)}
        </PromoRow>
      )}
      {offers.length > 0 && (
        <PromoRow id="offers" title={t('offers_title')} vera={vera}>
          {offers.map((item) => <PromoCard key={item.id} item={item} combo={comboMap.get(item.id)} now={now} onOpen={onOpen} vera={vera} />)}
        </PromoRow>
      )}
      {fresh.length > 0 && (
        <PromoRow id="new" title={t('new_at_venue', { name: venue.name })} vera={vera}>
          {fresh.map((item) => <PromoCard key={item.id} item={item} combo={comboMap.get(item.id)} now={now} onOpen={onOpen} vera={vera} />)}
        </PromoRow>
      )}
      {combos.length > 0 && (
        <PromoRow id="combos" title={t('combos_title')} vera={vera}>
          {combos.map((item) => <PromoCard key={item.id} item={item} combo={comboMap.get(item.id)} now={now} onOpen={onOpen} vera={vera} />)}
        </PromoRow>
      )}
    </>
  );
};

/** A titled, horizontally scrolling row that bleeds to the screen edges. */
const PromoRow = ({ id, title, children, vera = false }: { id: string; title: string; children: React.ReactNode; vera?: boolean }) => (
  <motion.section variants={fadeUp} aria-labelledby={`promo-${id}`} data-promo-row={id} className={vera ? 'pt-8' : undefined}>
    {vera ? (
      <div className="mb-5 flex items-center gap-4">
        <span aria-hidden className="vi-hairline flex-1" />
        <h2 id={`promo-${id}`} className="font-serif italic text-[26px] font-normal leading-none text-foreground text-center">{title}</h2>
        <span aria-hidden className="vi-hairline flex-1" />
      </div>
    ) : (
      <h2 id={`promo-${id}`} className="font-serif text-lg font-semibold text-foreground mb-2">{title}</h2>
    )}
    <ul className={`-mx-5 px-5 flex overflow-x-auto scrollbar-hide snap-x snap-mandatory scroll-px-5 pb-1 ${vera ? 'gap-4' : 'gap-3'}`}>
      {children}
    </ul>
  </motion.section>
);

/** Price for a card: the sale with its strikethrough, or "from" for a combo whose choices can cost extra. */
const CardPrice = ({ item, combo, now }: { item: MenuItemRow; combo?: ComboDef; now: number }) => {
  const { t, priceBare } = useI18n();
  const sale = saleView(item, now);
  if (combo) {
    const lowest = comboUnitPrice(item, combo, fixedChoices(combo), now);
    const varies = combo.slots.some((slot) => slot.options.some((o) => Number(o.surcharge) > 0));
    if (varies) return <span className="tabular-nums">{t('combo_from', { price: priceBare(lowest) })}</span>;
    return <PriceTag price={lowest} regular={sale ? lowest + Number(item.price) - sale.price : null} />;
  }
  return <PriceTag price={sale ? sale.price : Number(item.price)} regular={sale?.regular} />;
};

const Badges = ({ item, combo, now }: { item: MenuItemRow; combo?: ComboDef; now: number }) => {
  const sale = saleView(item, now);
  const fresh = isNew(item, now);
  if (!sale && !fresh && !combo) return null;
  return (
    <span className="flex flex-wrap gap-1">
      {sale && <SaleBadge label={item.sale_label} percentOff={sale.percentOff} />}
      {combo && <ComboBadge className="bg-card" />}
      {fresh && <NewBadge />}
    </span>
  );
};

const PromoCard = ({ item, combo, now, onOpen, vera = false }: { item: MenuItemRow; combo?: ComboDef; now: number; onOpen: (item: MenuItemRow) => void; vera?: boolean }) => {
  const { locale } = useI18n();
  const name = getLocalizedName(item, locale);
  return (
    <li className="shrink-0 snap-start w-[148px]">
      <motion.button
        type="button"
        whileTap={{ scale: PRESS_SCALE }}
        onClick={() => onOpen(item)}
        className="w-full text-start rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="relative block">
          <SmartImage
            src={item.image_url || undefined}
            id={item.id}
            alt=""
            width={148}
            height={148}
            square
            sizes="148px"
            fallbackText={name}
            wrapperClassName={`w-[148px] h-[148px] ${vera ? 'rounded-[3px]' : 'rounded-2xl'}`}
          />
          <span className="absolute top-2 start-2 end-2"><Badges item={item} combo={combo} now={now} /></span>
        </span>
        {vera ? (
          <>
            <span className="block pt-2.5 font-serif text-[18px] font-medium text-foreground leading-snug line-clamp-2">{name}</span>
            <span className="block font-serif text-[17px] text-muted-foreground mt-0.5"><CardPrice item={item} combo={combo} now={now} /></span>
          </>
        ) : (
          <>
            <span className="block pt-2 pe-1 font-serif text-[15px] font-semibold text-foreground leading-snug line-clamp-2">{name}</span>
            <span className="block text-sm font-sans font-semibold text-foreground mt-0.5"><CardPrice item={item} combo={combo} now={now} /></span>
          </>
        )}
      </motion.button>
    </li>
  );
};

/** A wide card with the owner's short line on it. At most three. */
const FeaturedCard = ({ item, combo, now, onOpen, vera = false }: { item: MenuItemRow; combo?: ComboDef; now: number; onOpen: (item: MenuItemRow) => void; vera?: boolean }) => {
  const { locale } = useI18n();
  const name = getLocalizedName(item, locale);
  const note = (locale === 'bs' && item.featured_note_bs) || (locale === 'ar' && item.featured_note_ar) || item.featured_note;
  if (vera) {
    // The whole photograph, square, with the words under it: a cover-cropped
    // 4:3 card would cut the plate, and white text over a dish hides it.
    return (
      <li className="shrink-0 snap-start w-[76%] max-w-[320px]">
        <motion.button
          type="button"
          whileTap={{ scale: PRESS_SCALE }}
          onClick={() => onOpen(item)}
          className="block w-full text-center rounded-[3px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="relative block aspect-square overflow-hidden rounded-[3px] bg-muted">
            <SmartImage
              src={item.image_url || undefined}
              id={item.id}
              alt=""
              width={320}
              height={320}
              sizes="(max-width: 420px) 76vw, 320px"
              fallbackText={name}
              wrapperClassName="absolute inset-0 w-full h-full"
            />
            <span className="absolute top-3 start-3 end-3"><Badges item={item} combo={combo} now={now} /></span>
          </span>
          <span className="block pt-4 font-serif italic text-[24px] leading-tight text-foreground">{name}</span>
          {note && <span className="block px-3 mt-1.5 text-[13px] leading-snug font-sans text-muted-foreground line-clamp-2">{note}</span>}
          <span className="block mt-1.5 font-serif text-[19px] font-medium text-foreground"><CardPrice item={item} combo={combo} now={now} /></span>
        </motion.button>
      </li>
    );
  }
  return (
    <li className="shrink-0 snap-start w-[82%] max-w-[340px]">
      <motion.button
        type="button"
        whileTap={{ scale: PRESS_SCALE }}
        onClick={() => onOpen(item)}
        className="relative block w-full aspect-[4/3] overflow-hidden rounded-2xl bg-muted text-start shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <SmartImage
          src={item.image_url || undefined}
          id={item.id}
          alt=""
          width={340}
          height={255}
          sizes="(max-width: 420px) 82vw, 340px"
          fallbackText={name}
          wrapperClassName="absolute inset-0 w-full h-full"
        />
        <span className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/20 to-transparent" aria-hidden />
        <span className="absolute top-3 start-3 end-3"><Badges item={item} combo={combo} now={now} /></span>
        <span className="absolute inset-x-0 bottom-0 p-4 block">
          <span className="block font-serif text-xl font-semibold text-white leading-snug drop-shadow-sm">{name}</span>
          {note && <span className="block text-[13px] font-sans text-white/90 mt-0.5 line-clamp-2">{note}</span>}
          <span className="mt-1.5 inline-flex rounded-full bg-white/95 px-2.5 py-0.5 text-sm font-sans font-semibold text-foreground">
            <CardPrice item={item} combo={combo} now={now} />
          </span>
        </span>
      </motion.button>
    </li>
  );
};

export default HomePromotions;
