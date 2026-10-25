import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { PriceTag, SaleBadge } from '@/components/guest/PriceTag';
import { useLanguageStore } from '@/lib/i18n';
import { buildKitchenTicketHtml, buildKitchenTicketText } from '@/lib/ticket-export';

afterEach(() => { cleanup(); useLanguageStore.getState().setLocale('en'); });

/**
 * A strikethrough is a promise about money. These hold it to the same
 * formatting as every other price, and make sure the price that is paid is
 * the one that stands out — and the one a screen reader says is "now".
 */
describe('PriceTag', () => {
  it('shows the sale price first, the menu price struck through, both bare on a menu row', () => {
    useLanguageStore.getState().setLocale('bs');
    const { container } = render(<PriceTag price={14.4} regular={18} />);
    const struck = container.querySelector('s');
    expect(struck?.textContent).toBe('18');
    expect(container.textContent).toContain('14,40');
    expect(screen.getByText('Prije 18,00 KM, sada 14,40 KM')).toHaveClass('sr-only');
  });

  it('keeps the currency on anything the guest is about to pay', () => {
    const { container } = render(<PriceTag price={14.4} regular={18} bare={false} />);
    expect(container.querySelector('s')?.textContent).toBe('18.00 KM');
    expect(container.textContent).toContain('14.40 KM');
  });

  it('is a plain price when nothing is off', () => {
    const { container } = render(<PriceTag price={18} regular={18} />);
    expect(container.querySelector('s')).toBeNull();
    expect(container.textContent).toBe('18');
    expect(render(<PriceTag price={18} />).container.textContent).toBe('18');
  });
});

describe('SaleBadge', () => {
  it('says the label in the guest\'s language, or how much is off', () => {
    useLanguageStore.getState().setLocale('ar');
    const { unmount } = render(<SaleBadge label="weekend_offer" percentOff={20} />);
    expect(screen.getByText('عرض نهاية الأسبوع')).toBeInTheDocument();
    unmount();
    useLanguageStore.getState().setLocale('bs');
    render(<SaleBadge label={null} percentOff={20} />);
    expect(screen.getByText('−20 %')).toBeInTheDocument();
  });
});

describe('combo parts on the kitchen ticket', () => {
  const order = {
    id: 'o1', order_code: '052', status: 'pending', total: 26, notes: null, created_at: '2026-10-25T18:00:00Z',
    table_number: 4, guest_name: null, section_name: null,
    items: [{
      quantity: 1, notes: 'no pickles', menu_item_name: 'Burger Combo', unit_price: 26, station: 'kitchen',
      components: [
        { slot_label: 'Burger', item_id: 'a', name: 'Cheeseburger', station: 'kitchen' },
        { slot_label: 'Drink', item_id: 'b', name: 'Lemonade', station: 'bar' },
      ],
    }],
  };
  const settings = { paperWidth: 80, header: 'La Soul', footer: '', showPrices: true, copies: 1 };

  it('prints each part under the combo, before its note', () => {
    const text = buildKitchenTicketText(order, settings);
    const lines = text.split('\n');
    const at = lines.findIndex((l) => l.includes('1 x Burger Combo'));
    expect(lines.slice(at + 1, at + 4)).toEqual(['  - Burger: Cheeseburger', '  - Drink: Lemonade (BAR)', '  ! no pickles']);
    expect(buildKitchenTicketHtml(order, settings)).toContain('<div class="item__part">&ndash; Drink: Lemonade (BAR)</div>');
  });
});
