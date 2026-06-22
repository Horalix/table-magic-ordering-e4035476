import { describe, expect, it } from 'vitest';
import {
  buildKitchenTicketHtml,
  buildKitchenTicketText,
  type KitchenPrintSettings,
  type KitchenTicketOrder,
} from '@/lib/ticket-export';

const order: KitchenTicketOrder = {
  id: '595a19ea-1111-2222-3333-444444444444',
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
    { quantity: 1, notes: 'no onions', menu_item_name: 'La Soul Burger', unit_price: 18 },
    { quantity: 2, notes: null, menu_item_name: 'Espresso', unit_price: 3.5 },
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
