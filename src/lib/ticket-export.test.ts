import { describe, expect, it } from 'vitest';
import {
  buildKitchenTicketHtml,
  buildKitchenTicketText,
  type KitchenPrintSettings,
  type KitchenTicketOrder,
} from '@/lib/ticket-export';

const order: KitchenTicketOrder = {
  id: '595a19ea-1111-2222-3333-444444444444',
  order_code: '047',
  status: 'pending',
  total: 27.5,
  tip_amount: 2.5,
  payment_method: 'card',
  notes: 'Allergy: nuts',
  created_at: '2026-06-22T19:34:04.000Z',
  table_number: 3,
  guest_name: 'Neuman',
  section_name: 'unutra',
  items: [
    {
      quantity: 1, notes: 'no onions', menu_item_name: 'La Soul Burger', unit_price: 18,
      station: 'kitchen', allergens: ['gluten', 'dairy'],
    },
    { quantity: 2, notes: null, menu_item_name: 'Espresso', unit_price: 3.5, station: 'bar', allergens: [] },
  ],
};

const settings: KitchenPrintSettings = {
  paperWidth: 80,
  header: 'La Soul',
  footer: 'Hvala / Thank you',
  showPrices: true,
  copies: 1,
};

describe('kitchen ticket rendering', () => {
  it('renders complete totals and operational details as plain text', () => {
    const ticket = buildKitchenTicketText(order, settings);

    expect(ticket).toContain('TABLE 3');
    expect(ticket).toContain('Subtotal: 25.00 KM');
    expect(ticket).toContain('Tip: 2.50 KM');
    expect(ticket).toContain('TOTAL: 27.50 KM');
    expect(ticket).toContain('PAYMENT: CARD');
    expect(ticket).toContain('ORDER NOTE: Allergy: nuts');
  });

  it('wraps every Bluetooth line to the selected 58 mm paper width', () => {
    const narrowTicket = buildKitchenTicketText({
      ...order,
      items: [{
        quantity: 2,
        notes: 'Keep this very long preparation instruction readable for the kitchen',
        menu_item_name: 'Extra long seasonal burger with roasted vegetables',
        unit_price: 12.25,
      }],
    }, { ...settings, paperWidth: 58 });

    expect(Math.max(...narrowTicket.split('\n').map((line) => line.length))).toBeLessThanOrEqual(32);
  });

  it('uses a valid fixed thermal page size and escapes customer content', () => {
    const html = buildKitchenTicketHtml({
      ...order,
      guest_name: '<script>alert("x")</script>',
      items: [{ ...order.items[0], menu_item_name: 'Fish & Chips' }],
    }, { ...settings, copies: 2 });

    expect(html).toContain('@page { size: 80mm 200mm; margin: 0; }');
    expect(html).not.toContain('80mm auto');
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
    expect(html).toContain('Fish &amp; Chips');
    expect(html.match(/<article class="ticket">/g)).toHaveLength(2);
  });
});

/**
 * What has to be true of a piece of paper in a kitchen.
 *
 * These are golden-text assertions rather than snapshots on purpose: each one
 * names a specific way a ticket gets a dish cooked twice, handed to a guest as
 * a bill, or made at the wrong station.
 */
describe('station tickets', () => {
  const kitchen: KitchenPrintSettings = { ...settings, station: 'kitchen' };
  const bar: KitchenPrintSettings = { ...settings, station: 'bar' };

  it('shows the code the board shows, so paper and screen can be matched', () => {
    // The old ticket printed an id prefix that appears on no screen anywhere,
    // which is why a reprint could not be told from a second order.
    expect(buildKitchenTicketText(order, kitchen)).toContain('#047');
  });

  it('keeps money off a kitchen ticket', () => {
    // A price on a line-cook ticket invites it being handed over as a bill,
    // and the kitchen has no use for the number.
    const ticket = buildKitchenTicketText(order, kitchen);
    expect(ticket).not.toContain('KM');
    expect(ticket).not.toContain('TOTAL');
  });

  it('still tells the kitchen how the order was paid', () => {
    // The word, never the amount: a cook does need to know it is unpaid.
    expect(buildKitchenTicketText(order, kitchen)).toContain('PAYMENT: CARD');
  });

  it('sends only the drinks to the bar', () => {
    const ticket = buildKitchenTicketText(order, bar);
    expect(ticket).toContain('BAR ORDER');
    expect(ticket).toContain('Espresso');
    expect(ticket).not.toContain('La Soul Burger');
  });

  it('sends only the food to the kitchen', () => {
    const ticket = buildKitchenTicketText(order, kitchen);
    expect(ticket).toContain('KITCHEN ORDER');
    expect(ticket).toContain('La Soul Burger');
    expect(ticket).not.toContain('Espresso');
  });

  it('prints allergens against the dish, not as a banner', () => {
    const ticket = buildKitchenTicketText(order, kitchen);
    expect(ticket).toContain('ALLERGENS: GLUTEN, DAIRY');
  });

  it('still prices a full ticket when no station is set', () => {
    expect(buildKitchenTicketText(order, settings)).toContain('TOTAL: 27.50 KM');
  });
});

describe('reprints', () => {
  const reprint: KitchenPrintSettings = {
    ...settings, station: 'kitchen', reprintOf: '2026-06-22T19:34:04.000Z',
  };

  it('is unmistakably a reprint', () => {
    expect(buildKitchenTicketText(order, reprint)).toContain('*** REPRINT ***');
  });

  it('shows when the original printed, which is what stops a second cook', () => {
    const ticket = buildKitchenTicketText(order, reprint);
    expect(ticket).toContain('ORIGINAL');
    expect(ticket).toContain('THIS COPY');
  });

  it('says nothing about reprinting on a first print', () => {
    expect(buildKitchenTicketText(order, { ...settings, station: 'kitchen' })).not.toContain('REPRINT');
  });

  it('bands the printed page as well as the text', () => {
    expect(buildKitchenTicketHtml(order, reprint)).toContain('class="reprint"');
  });
});
