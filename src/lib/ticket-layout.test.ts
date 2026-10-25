import { describe, expect, it } from 'vitest';
import {
  buildTicket, foldToAscii, partItemIds, ticketClock, ticketIsEmpty, ticketToEposXml, ticketToEscPos, ticketToStarPrnt,
  ticketToText, withPartAllergens, type TicketOrder,
} from '../../supabase/functions/_shared/ticket-layout.ts';

/**
 * The one ticket layout every printer path uses — browser, Bluetooth, and the
 * cloud endpoint a network printer polls. Each assertion names a way a ticket
 * gets a dish cooked wrong, twice, or not at all.
 */

const order: TicketOrder = {
  id: '595a19ea-1111-2222-3333-444444444444',
  order_code: '047',
  table_number: 7,
  created_at: '2026-06-22T19:30:00.000Z',
  released_to_kitchen_at: '2026-06-22T19:34:00.000Z',
  guest_name: 'Amina',
  section_name: 'Terasa',
  waiter_name: 'Marko',
  notes: 'Bring mains together',
  payment_method: 'cash',
  payment_status: 'unpaid',
  total: 42,
  items: [
    {
      quantity: 2, menu_item_name: 'La Soul Burger', notes: 'no onions', station: 'kitchen',
      allergens: ['gluten', 'sesame'], unit_price: 18,
      components: [
        { slot_label: 'Side', name: 'Pomfrit', station: 'kitchen' },
        { slot_label: 'Drink', name: 'Coca-Cola', station: 'bar' },
      ],
    },
    { quantity: 1, menu_item_name: 'Ćevapi (10 kom)', notes: null, station: 'kitchen', unit_price: 6 },
    { quantity: 1, menu_item_name: 'Espresso', notes: 'extra hot', station: 'bar', unit_price: 3 },
  ],
};

const kitchen = buildTicket(order, { paperWidth: 80, station: 'kitchen', header: 'La Soul' });
const bar = buildTicket(order, { paperWidth: 80, station: 'bar', header: 'La Soul' });

describe('what the ticket says', () => {
  it('prints Sarajevo time, whatever zone the server runs in', () => {
    // 19:34 UTC in June is 21:34 in Sarajevo (CEST); 19:00 UTC in December is 20:00 (CET).
    expect(ticketClock('2026-06-22T19:34:00.000Z')).toBe('21:34');
    expect(ticketClock('2026-12-01T19:00:00.000Z')).toBe('20:00');
    expect(ticketToText(kitchen)).toContain('#047   21:34');
  });

  it('times the ticket from when the kitchen got it, not when it was placed', () => {
    // A card order placed at 21:30 and paid at 21:34 reached the kitchen at 21:34.
    expect(ticketToText(kitchen)).not.toContain('21:30');
  });

  it('gives the table in double size and the waiter and section under it', () => {
    const table = kitchen.find((l) => l.kind === 'table');
    expect(table?.text.trim()).toBe('TABLE 7');
    expect(table?.size).toBe(2);
    expect(ticketToText(kitchen)).toContain('Terasa | Waiter: Marko | Guest: Amina');
  });

  it('puts notes and allergens in full-width inverse bands', () => {
    const note = kitchen.find((l) => l.kind === 'note');
    const allergen = kitchen.find((l) => l.kind === 'allergen');
    expect(note).toMatchObject({ invert: true, bold: true });
    expect(note?.text.length).toBe(48);
    expect(allergen?.text).toContain('ALLERGENS: GLUTEN, SESAME');
    expect(kitchen.find((l) => l.kind === 'order-note')?.invert).toBe(true);
  });

  it('prints quantity first and big', () => {
    const items = kitchen.filter((l) => l.kind === 'item');
    expect(items[0]).toMatchObject({ text: '2 x La Soul Burger', tall: true, bold: true });
  });

  it('keeps money off a station ticket but says it is unpaid', () => {
    const text = ticketToText(kitchen);
    expect(text).not.toMatch(/\bKM\b/);
    expect(text).toContain('PAYMENT: CASH - NOT PAID');
  });

  it('says TEST TICKET on a test page', () => {
    expect(ticketToText(buildTicket(order, { test: true }))).toContain('TEST TICKET');
  });
});

describe('combos', () => {
  it('lists the parts under the dish, marking the ones made elsewhere', () => {
    const text = ticketToText(kitchen);
    expect(text).toContain('+ Side: Pomfrit');
    expect(text).toContain('+ Drink: Coca-Cola [BAR]');
  });

  it('sends the bar the drink that came with a kitchen dish', () => {
    // Dropping the line because its PARENT is a kitchen item loses the cola.
    const text = ticketToText(bar);
    expect(text).toContain('2 x Coca-Cola');
    expect(text).toContain('(part of La Soul Burger)');
    expect(text).toContain('1 x Espresso');
    expect(text).not.toContain('x La Soul Burger');
    expect(text).not.toContain('Pomfrit');
    // Not the burger's allergens: the cola's own (none here).
    expect(text).not.toContain('SESAME');
  });

  it('gives the combo drink its own line: quantity, part of, the line note, its own allergens', () => {
    const combo: TicketOrder = {
      ...order,
      notes: null,
      items: [{
        quantity: 2, menu_item_name: 'Chicken Burger Combo', notes: 'lemonade without ice', station: 'kitchen',
        allergens: ['gluten', 'egg'],
        components: [
          { slot_label: 'Burger', item_id: 'chicken', name: 'Chicken Burger', station: 'kitchen' },
          { slot_label: 'Drink', item_id: 'lemonade', name: 'Strawberry Lemonade', station: 'bar', allergens: ['sulphites'] },
        ],
      }],
    };
    const lines = buildTicket(combo, { paperWidth: 80, station: 'bar' });
    const at = (kind: string) => lines.filter((l) => l.kind === kind).map((l) => l.text.trim());
    expect(at('item')).toEqual(['2 x Strawberry Lemonade']);
    expect(at('part-of')).toEqual(['(part of Chicken Burger Combo)']);
    // A guest writes one note for the whole combo; the bar must see it.
    expect(at('note')).toEqual(['! lemonade without ice']);
    expect(at('allergen')).toEqual(['ALLERGENS: SULPHITES']);
    expect(at('component')).toEqual([]);
    // In that order, under the line.
    expect(lines.map((l) => l.kind).filter((k) => ['item', 'part-of', 'note', 'allergen'].includes(String(k))))
      .toEqual(['item', 'part-of', 'note', 'allergen']);

    // The kitchen keeps the combo whole, drink marked as the bar's, burger's allergens.
    const kitchenText = ticketToText(buildTicket(combo, { paperWidth: 80, station: 'kitchen' }));
    expect(kitchenText).toContain('2 x Chicken Burger Combo');
    expect(kitchenText).toContain('+ Drink: Strawberry Lemonade [BAR]');
    expect(kitchenText).toContain('ALLERGENS: GLUTEN, EGG');
    expect(kitchenText).not.toContain('SULPHITES');
    expect(kitchenText).not.toContain('part of');
  });

  it('a combo with nothing for the bar leaves the bar ticket empty', () => {
    const food: TicketOrder = {
      ...order,
      items: [{
        quantity: 1, menu_item_name: 'Kids menu', notes: null, station: 'kitchen',
        components: [{ slot_label: 'Side', name: 'Pomfrit', station: 'kitchen' }],
      }],
    };
    expect(ticketIsEmpty(food, 'bar')).toBe(true);
    expect(ticketIsEmpty(food, 'kitchen')).toBe(false);
  });

  it('a combo-only order still has a bar ticket', () => {
    const comboOnly: TicketOrder = { ...order, items: [order.items[0]] };
    expect(ticketIsEmpty(comboOnly, 'bar')).toBe(false);
    expect(ticketToText(buildTicket(comboOnly, { station: 'bar' }))).toContain('2 x Coca-Cola');
  });

  it('ignores rows without components', () => {
    const plain = { ...order, items: [{ quantity: 1, menu_item_name: 'Tea', notes: null, station: 'bar' }] };
    expect(() => buildTicket(plain, { station: 'bar' })).not.toThrow();
    expect(ticketIsEmpty(plain, 'kitchen')).toBe(true);
    expect(ticketIsEmpty(plain, 'bar')).toBe(false);
  });
});

describe('part allergens', () => {
  const items: TicketOrder['items'] = [
    {
      quantity: 1, menu_item_name: 'Combo', station: 'kitchen',
      components: [
        { name: 'Burger', item_id: 'b', station: 'kitchen' },
        { name: 'Lemonade', item_id: 'l', station: 'bar' },
        { name: 'Old row without an id', station: 'bar' },
      ],
    },
    { quantity: 1, menu_item_name: 'Espresso', station: 'bar' },
    { quantity: 1, menu_item_name: 'Combo again', station: 'kitchen', components: [{ name: 'Lemonade', item_id: 'l', station: 'bar' }] },
  ];

  it('knows which menu items to look up, once each', () => {
    expect(partItemIds(items)).toEqual(['b', 'l']);
    expect(partItemIds([{ components: null }, {}])).toEqual([]);
  });

  it('attaches what was found and leaves the rest alone', () => {
    const out = withPartAllergens(items, { l: ['sulphites'], b: null });
    expect(out[0].components?.map((c) => c.allergens)).toEqual([null, ['sulphites'], undefined]);
    expect(out[1]).toBe(items[1]);
    expect(out[2].components?.[0].allergens).toEqual(['sulphites']);
    // The input is not mutated.
    expect(items[0].components?.[1].allergens).toBeUndefined();
  });
});

describe('paper width', () => {
  it('never runs past 32 characters on 58 mm paper', () => {
    const narrow = buildTicket(order, { paperWidth: 58, station: null, showPrices: true, reprintOf: order.created_at });
    for (const line of narrow) {
      expect(line.text.length, line.text).toBeLessThanOrEqual(line.size === 2 ? 16 : 32);
    }
  });

  it('never runs past 48 characters on 80 mm paper', () => {
    for (const line of buildTicket(order, { paperWidth: 80, showPrices: true })) {
      expect(line.text.length, line.text).toBeLessThanOrEqual(line.size === 2 ? 24 : 48);
    }
  });
});

describe('printer languages', () => {
  const bytes = ticketToEscPos(kitchen);
  const has = (haystack: Uint8Array, needle: number[]) => {
    outer: for (let i = 0; i <= haystack.length - needle.length; i += 1) {
      for (let j = 0; j < needle.length; j += 1) if (haystack[i + j] !== needle[j]) continue outer;
      return true;
    }
    return false;
  };

  it('ESC/POS: initialises, bands notes in reverse and cuts', () => {
    expect([bytes[0], bytes[1]]).toEqual([0x1b, 0x40]);
    expect(has(bytes, [0x1d, 0x42, 0x01])).toBe(true);   // GS B 1 — reverse on
    expect(has(bytes, [0x1d, 0x42, 0x00])).toBe(true);   // and off again
    expect(has(bytes, [0x1d, 0x21, 0x11])).toBe(true);   // double size table
    expect(Array.from(bytes.slice(-3))).toEqual([0x1d, 0x56, 0x00]);
  });

  it('ESC/POS: sends no byte a CP437 printer would garble', () => {
    expect(Array.from(bytes).every((b) => b < 0x80)).toBe(true);
    expect(new TextDecoder().decode(bytes)).toContain('Cevapi (10 kom)');
  });

  it('ESC/POS: prints the copies it is asked for', () => {
    const two = ticketToEscPos(kitchen, { copies: 2 });
    expect(two.length).toBe(bytes.length * 2);
  });

  it('StarPRNT: reverse on/off and double size for the table', () => {
    const star = ticketToStarPrnt(kitchen);
    expect(has(star, [0x1b, 0x34])).toBe(true);
    expect(has(star, [0x1b, 0x35])).toBe(true);
    expect(has(star, [0x1b, 0x69, 0x01, 0x01])).toBe(true);
    expect(Array.from(star).every((b) => b < 0x80)).toBe(true);
  });

  it('every language carries the combo drink on the bar ticket, its allergens banded', () => {
    const [burger, ...rest] = order.items;
    const withIds = [{
      ...burger,
      components: burger.components?.map((c) => ({ ...c, item_id: c.name === 'Coca-Cola' ? 'coke-id' : 'fries-id' })),
    }, ...rest];
    const withAllergens: TicketOrder = { ...order, items: withPartAllergens(withIds, { 'coke-id': ['caffeine'] }) };
    const lines = buildTicket(withAllergens, { paperWidth: 58, station: 'bar' });
    const text = ticketToText(lines);
    expect(text).toContain('2 x Coca-Cola');
    expect(text).toContain('(part of La Soul');
    expect(text).toContain('ALLERGENS: CAFFEINE');

    const ascii = (s: string) => Array.from(s, (c) => c.charCodeAt(0));
    const esc = ticketToEscPos(lines);
    expect(new TextDecoder().decode(esc)).toContain('2 x Coca-Cola');
    expect(has(esc, [0x1d, 0x42, 0x01, ...ascii('  ALLERGENS: CAFFEINE')])).toBe(true); // GS B 1, then the band

    const star = ticketToStarPrnt(lines);
    expect(new TextDecoder().decode(star)).toContain('2 x Coca-Cola');
    expect(has(star, [0x1b, 0x34, ...ascii('  ALLERGENS: CAFFEINE')])).toBe(true); // ESC 4, then the band

    const xml = ticketToEposXml(lines);
    expect(new DOMParser().parseFromString(xml, 'application/xml').getElementsByTagName('parsererror')).toHaveLength(0);
    expect(xml).toMatch(/reverse="true"[^>]*>\s*ALLERGENS: CAFFEINE/);
    expect(xml).toContain('(part of La Soul');

    for (const line of lines) expect(line.text.length, line.text).toBeLessThanOrEqual(line.size === 2 ? 16 : 32);
  });

  it('ePOS-Print XML is well-formed, escaped, and bands the notes', () => {
    const risky = buildTicket({ ...order, items: [{ quantity: 1, menu_item_name: 'Fish & <Chips>', notes: 'no "salt"', station: 'kitchen' }] }, { station: 'kitchen' });
    const xml = ticketToEposXml(risky);
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    expect(doc.getElementsByTagName('parsererror')).toHaveLength(0);
    expect(xml).toContain('Fish &amp; &lt;Chips&gt;');
    expect(xml).toMatch(/reverse="true"[^>]*>[^<]*! no &quot;salt&quot;/);
    expect(xml).toContain('<cut type="feed"/>');
  });
});

describe('foldToAscii', () => {
  it('writes Bosnian the way a cook would on a pad', () => {
    expect(foldToAscii('Ćevapi, Đuveč, šnicla, žličnjaci')).toBe('Cevapi, Djuvec, snicla, zlicnjaci');
    expect(foldToAscii('Crème brûlée — 2×')).toBe('Creme brulee - 2x');
  });
});
