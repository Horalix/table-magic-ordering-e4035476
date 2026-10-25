import React from 'react';
import MenuItemDetail from '@/components/guest/MenuItemDetail';
import { useT } from '@/lib/i18n';
import { unorderableReason, windowLabel } from '@/lib/availability';
import type { MenuItemRow } from '@/lib/promotions-api';

/**
 * The dish sheet for a full menu row, from anywhere that is not a category
 * page (the home screen's promotion rows, search).
 *
 * Every field the sheet shows travels with it — allergens above all, which
 * is why it takes the whole row rather than whatever a card happened to have.
 */
const DishSheet = ({ row, canOrder, onClose }: { row: MenuItemRow; canOrder: boolean; onClose: () => void }) => {
  const t = useT();
  const blocked = unorderableReason(row);
  const unavailableLabel = !blocked ? null : blocked === 'sold_out' ? t('sold_out') : windowLabel(row);
  return (
    <MenuItemDetail
      item={{
        id: row.id,
        name: row.name,
        name_ar: row.name_ar,
        name_bs: row.name_bs,
        description: row.description || undefined,
        description_ar: row.description_ar || undefined,
        description_bs: row.description_bs || undefined,
        price: Number(row.price),
        sale_kind: row.sale_kind ?? null,
        sale_value: row.sale_value ?? null,
        sale_starts_at: row.sale_starts_at ?? null,
        sale_ends_at: row.sale_ends_at ?? null,
        sale_label: row.sale_label ?? null,
        merchandising_tags: row.merchandising_tags ?? [],
        new_until: row.new_until ?? null,
        image_url: row.image_url || undefined,
        allergens: row.allergens ?? null,
        portion_note: row.portion_note ?? null,
        prep_minutes: row.prep_minutes ?? null,
      }}
      onClose={onClose}
      canOrder={canOrder}
      unavailableLabel={unavailableLabel}
    />
  );
};

export default DishSheet;
