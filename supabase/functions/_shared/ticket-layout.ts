/**
 * The kitchen/bar ticket, laid out once and rendered for every kind of printer.
 *
 * One layout, four outputs:
 *
 *   ticketToText     plain text — previews, the .txt rescue file, and printers
 *                    that only take text (Star CloudPRNT `text/plain`)
 *   ticketToEscPos   ESC/POS bytes — Epson/Xprinter/Bixolon over Bluetooth, USB
 *                    or serial
 *   ticketToStarPrnt StarPRNT bytes — Star TSP143IV / mC-Print3 over CloudPRNT
 *   ticketToEposXml  Epson ePOS-Print XML — TM-m30III & co. over Server Direct Print
 *
 * This file is shared by the web app (src/lib/ticket-export.ts) and the
 * `cloudprnt` Edge Function, which is why it lives under supabase/functions and
 * imports nothing: Deno and Vite both have to be able to load it as is. Two
 * copies of "what a ticket looks like" would drift, and the drift would show up
 * as a network printer and a tablet printing different tickets for the same
 * order — which is how a dish gets cooked twice.
 *
 * What a ticket has to do, in the order a cook reads it:
 *   1. say which station and whether it is a REPRINT (inverse band — a reprint
 *      that looks like an original gets cooked again);
 *   2. give the TABLE in letters you can read from two metres;
 *   3. give the order code the board shows (#047) and the time it came in, in
 *      Sarajevo time, 24h, whatever timezone the server runs in;
 *   4. list what to make, quantity first and big;
 *   5. make notes and allergens impossible to miss (inverse, bold);
 *   6. never carry money on a station ticket.
 */

export type TicketAlign = 'left' | 'center' | 'right';

/** What a line is, so a preview or the HTML page can style it. */
export type TicketLineKind =
  | 'header' | 'station' | 'reprint' | 'table' | 'code' | 'who' | 'rule' | 'item' | 'part-of'
  | 'component' | 'note' | 'allergen' | 'gap' | 'order-note' | 'money' | 'payment' | 'footer';

export interface TicketLine {
  text: string;
  align?: TicketAlign;
  bold?: boolean;
  /** White on black. Notes, allergens, the station band and the reprint band. */
  invert?: boolean;
  /** 2 = double width AND height, so half as many columns fit. */
  size?: 1 | 2;
  /** Double height at normal width — big, but still a full line of text. */
  tall?: boolean;
  kind?: TicketLineKind;
}

/** One part of a combo/menu deal, e.g. { slot_label: 'Side', name: 'Fries' }. */
export interface TicketComponent {
  slot_label?: string | null;
  item_id?: string | null;
  name: string;
  station?: string | null;
}

export interface TicketItem {
  quantity: number;
  menu_item_name: string;
  notes?: string | null;
  unit_price?: number | null;
  station?: string | null;
  allergens?: string[] | null;
  /** Combo parts (order_items.components). Optional: older rows have none. */
  components?: TicketComponent[] | null;
}

export interface TicketOrder {
  id: string;
  order_code?: string | null;
  table_number: number | string;
  created_at: string;
  /** When the kitchen actually got it (card orders: when payment cleared). */
  released_to_kitchen_at?: string | null;
  guest_name?: string | null;
  section_name?: string | null;
  waiter_name?: string | null;
  notes?: string | null;
  payment_method?: string | null;
  payment_status?: string | null;
  total?: number | null;
  tip_amount?: number | null;
  items: TicketItem[];
}

export interface TicketOptions {
  paperWidth?: number;
  header?: string | null;
  footer?: string | null;
  showPrices?: boolean;
  /** Which station this ticket is for. Station tickets never carry money. */
  station?: 'kitchen' | 'bar' | null;
  /** When the ORIGINAL printed, if this is a reprint. */
  reprintOf?: string | null;
  /** "Now", for the reprint stamp. Injected so tests are deterministic. */
  now?: Date;
  /** A test page from Admin → Printing rather than a real order. */
  test?: boolean;
}

/** Characters per line in the printer's normal font. */
export const PAPER_COLUMNS: Record<58 | 80, number> = { 58: 32, 80: 48 };

export const paperColumns = (paperWidth?: number) =>
  PAPER_COLUMNS[paperWidth === 58 ? 58 : 80];

/* ------------------------------------------------------------------------ */
/* Time                                                                       */
/* ------------------------------------------------------------------------ */

const CLOCK = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Europe/Sarajevo',
});
const DAY = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit', month: '2-digit', timeZone: 'Europe/Sarajevo',
});

/**
 * "20:14" in Sarajevo, whatever the device or the Edge Function runs in.
 *
 * The old ticket formatted in the device's own zone. A tablet in Sarajevo got
 * it right by accident; a server in UTC would print every ticket an hour or two
 * early, which on a kitchen ticket reads as "this has been waiting forever".
 */
export function ticketClock(at: string | Date | null | undefined): string {
  if (!at) return '--:--';
  const d = typeof at === 'string' ? new Date(at) : at;
  if (Number.isNaN(d.getTime())) return '--:--';
  return CLOCK.format(d);
}

/** "25.10. 20:14" — for reprints, which can cross midnight. */
export function ticketStamp(at: string | Date | null | undefined): string {
  if (!at) return '--';
  const d = typeof at === 'string' ? new Date(at) : at;
  if (Number.isNaN(d.getTime())) return '--';
  return `${DAY.format(d).replace('/', '.')}. ${CLOCK.format(d)}`;
}

/* ------------------------------------------------------------------------ */
/* Text helpers                                                               */
/* ------------------------------------------------------------------------ */

const BCS: Record<string, string> = {
  č: 'c', ć: 'c', ž: 'z', š: 's', đ: 'dj', Č: 'C', Ć: 'C', Ž: 'Z', Š: 'S', Đ: 'Dj',
  '—': '-', '–': '-', '‘': "'", '’': "'", '“': '"', '”': '"', '„': '"', '…': '...',
  '×': 'x', '·': '-', '•': '*', '€': 'EUR', '\u00a0': ' ',
};

/**
 * Plain ASCII, for printers addressed byte by byte.
 *
 * A thermal printer's default code page (CP437) has no č, ć, ž, š or đ, and
 * which code page number means Latin-2 differs between Epson, Xprinter and
 * Star. Writing UTF-8 at one — which the Bluetooth path used to do — prints
 * "Ä†evapi". "Cevapi" is what every cook in Sarajevo writes on a pad anyway.
 */
export function foldToAscii(value: string): string {
  return value
    .replace(/[čćžšđČĆŽŠĐ—–‘’“”„…×·•€\u00a0]/g, (ch) => BCS[ch] ?? ch)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7e\n]/g, '?');
}

/** Word-wrap to `width`, breaking words that are longer than a line. */
export function wrapText(value: string, width: number): string[] {
  const w = Math.max(1, width);
  const words = String(value ?? '').trim().replace(/\s+/g, ' ').split(' ').filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const chunks = word.match(new RegExp(`.{1,${w}}`, 'g')) ?? [];
    for (const chunk of chunks) {
      const candidate = current ? `${current} ${chunk}` : chunk;
      if (candidate.length <= w) current = candidate;
      else {
        if (current) lines.push(current);
        current = chunk;
      }
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [''];
}

const center = (value: string, width: number) => {
  const pad = Math.max(0, Math.floor((width - value.length) / 2));
  return `${' '.repeat(pad)}${value}`;
};

/** A full-width band: padded so the black background runs edge to edge. */
const band = (value: string, width: number, align: TicketAlign = 'left') => {
  const body = align === 'center' ? center(value, width) : value;
  return body.padEnd(width).slice(0, Math.max(width, body.length));
};

const money = (amount: number | null | undefined) => `${Number(amount ?? 0).toFixed(2)} KM`;

const PAYMENT_WORD: Record<string, string> = {
  cash: 'CASH', card: 'CARD', card_online: 'PAID ONLINE', pos_terminal: 'TERMINAL',
};
const PAID_WORD: Record<string, string> = {
  paid: 'PAID', unpaid: 'NOT PAID', pending: 'PAYING', failed: 'PAYMENT FAILED',
  refunded: 'REFUNDED', partially_refunded: 'PART REFUNDED',
};

/* ------------------------------------------------------------------------ */
/* The layout                                                                 */
/* ------------------------------------------------------------------------ */

/** The station a line belongs to; unknown is kitchen, like the database default. */
const stationOf = (station?: string | null) => (station ?? 'kitchen');

interface PlannedLine {
  item: TicketItem;
  /** Components to print under it (already station-filtered). */
  components: TicketComponent[];
  /** Set when the line is only here because one of its parts is for this station. */
  partOf?: string;
}

/**
 * Which lines a station makes.
 *
 * A combo is ordered as one line ("Burger menu") but made at two stations: the
 * burger in the kitchen, the cola at the bar. A bar ticket that dropped the
 * line because the PARENT is a kitchen item would lose the drink, so a part
 * made at this station brings its line along, labelled with what it is part of.
 */
function planLines(order: TicketOrder, station: 'kitchen' | 'bar' | null | undefined): PlannedLine[] {
  const out: PlannedLine[] = [];
  for (const item of order.items ?? []) {
    const parts = Array.isArray(item.components) ? item.components.filter((c) => c && c.name) : [];
    if (!station || stationOf(item.station) === station) {
      out.push({ item, components: parts });
      continue;
    }
    const mine = parts.filter((c) => c.station && c.station === station);
    for (const part of mine) {
      out.push({
        item: { ...item, menu_item_name: part.name, notes: null, components: null, allergens: null },
        components: [],
        partOf: item.menu_item_name,
      });
    }
  }
  return out;
}

/** True when a station ticket would have nothing on it. Print nothing then. */
export function ticketIsEmpty(order: TicketOrder, station?: 'kitchen' | 'bar' | null): boolean {
  return planLines(order, station).length === 0;
}

export function buildTicket(order: TicketOrder, options: TicketOptions = {}): TicketLine[] {
  const cols = paperColumns(options.paperWidth);
  const bigCols = Math.floor(cols / 2);
  const station = options.station ?? null;
  const money$ = !!options.showPrices && !station;
  const lines: TicketLine[] = [];
  const push = (line: TicketLine) => lines.push(line);
  const rule = (ch = '-') => push({ text: ch.repeat(cols), kind: 'rule' });

  // 1. Who this is for. The band is the first thing on the paper because the
  //    first question at a printer is "is this mine?".
  const header = (options.header ?? '').trim() || 'La Soul';
  for (const l of wrapText(header, cols)) push({ text: center(l, cols), bold: true, kind: 'header' });
  const heading = options.test ? 'TEST TICKET' : station === 'bar' ? 'BAR ORDER' : 'KITCHEN ORDER';
  push({ text: band(heading, cols, 'center'), bold: true, invert: true, kind: 'station' });

  if (options.reprintOf) {
    const now = options.now ?? new Date();
    push({ text: band('*** REPRINT ***', cols, 'center'), bold: true, invert: true, kind: 'reprint' });
    push({ text: center(`ORIGINAL ${ticketStamp(options.reprintOf)}`, cols), bold: true, kind: 'reprint' });
    push({ text: center(`THIS COPY ${ticketStamp(now)}`, cols), kind: 'reprint' });
    push({ text: band('Check the pass before cooking', cols, 'center'), invert: true, kind: 'reprint' });
  }

  // 2 + 3. Table, code, time.
  for (const l of wrapText(`TABLE ${order.table_number}`, bigCols)) push({ text: center(l, bigCols), size: 2, bold: true, kind: 'table' });
  const code = order.order_code ? `#${order.order_code}` : `#${String(order.id).slice(0, 6).toUpperCase()}`;
  const at = order.released_to_kitchen_at ?? order.created_at;
  push({ text: center(`${code}   ${ticketClock(at)}`, cols), bold: true, tall: true, kind: 'code' });

  const who = [
    order.section_name ? `${order.section_name}` : null,
    order.waiter_name ? `Waiter: ${order.waiter_name}` : null,
    order.guest_name ? `Guest: ${order.guest_name}` : null,
  ].filter(Boolean).join(' | ');
  if (who) for (const l of wrapText(who, cols)) push({ text: center(l, cols), kind: 'who' });
  rule('=');

  // 4 + 5. What to make.
  const planned = planLines(order, station);
  planned.forEach((p, index) => {
    const { item } = p;
    const qty = `${item.quantity} x `;
    const price = money$ && item.unit_price != null ? money(item.quantity * Number(item.unit_price)) : '';
    const nameWidth = cols - qty.length - (price ? price.length + 1 : 0);
    const nameLines = wrapText(item.menu_item_name, Math.max(8, nameWidth));
    nameLines.forEach((name, i) => {
      const left = i === 0 ? `${qty}${name}` : `${' '.repeat(qty.length)}${name}`;
      const text = i === 0 && price ? `${left.padEnd(cols - price.length)}${price}` : left;
      push({ text, bold: true, tall: true, kind: 'item' });
    });
    if (p.partOf) {
      for (const l of wrapText(`(part of ${p.partOf})`, cols - 4)) push({ text: `    ${l}`, kind: 'part-of' });
    }
    // Parts made elsewhere stay on the ticket for context ("the cola is coming
    // from the bar"), marked so nobody here starts making them.
    const home = station ?? stationOf(item.station);
    for (const part of p.components) {
      const label = part.slot_label ? `${part.slot_label}: ` : '';
      const away = part.station && part.station !== home ? ` [${String(part.station).toUpperCase()}]` : '';
      for (const [i, l] of wrapText(`${label}${part.name}${away}`, cols - 6).entries()) {
        push({ text: `${i === 0 ? '    + ' : '      '}${l}`, bold: true, kind: 'component' });
      }
    }
    if (item.notes && item.notes.trim()) {
      for (const l of wrapText(`! ${item.notes.trim()}`, cols - 4)) {
        push({ text: band(`  ${l}`, cols), bold: true, invert: true, kind: 'note' });
      }
    }
    if (item.allergens && item.allergens.length > 0) {
      const text = `ALLERGENS: ${item.allergens.join(', ').toUpperCase()}`;
      for (const l of wrapText(text, cols - 4)) push({ text: band(`  ${l}`, cols), bold: true, invert: true, kind: 'allergen' });
    }
    if (index < planned.length - 1) push({ text: '', kind: 'gap' });
  });
  if (planned.length === 0) push({ text: center('(nothing for this station)', cols), kind: 'item' });
  rule('=');

  // Order-level note: a band, because it is usually an allergy or a timing
  // instruction ("bring the mains together") that applies to every plate.
  if (order.notes && order.notes.trim()) {
    for (const l of wrapText(`ORDER NOTE: ${order.notes.trim()}`, cols - 2)) {
      push({ text: band(` ${l}`, cols), bold: true, invert: true, kind: 'order-note' });
    }
  }

  // 6. Money only on a full (non-station) ticket. The payment WORD stays on a
  //    station ticket: a cook does need to know an order is unpaid.
  if (money$ && order.total != null) {
    const tip = Number(order.tip_amount ?? 0);
    if (tip > 0) {
      push({ text: `Subtotal: ${money(Number(order.total) - tip)}`, kind: 'money' });
      push({ text: `Tip: ${money(tip)}`, kind: 'money' });
    }
    push({ text: `TOTAL: ${money(order.total)}`, bold: true, tall: true, kind: 'money' });
  }
  if (order.payment_method) {
    const method = PAYMENT_WORD[order.payment_method] ?? order.payment_method.toUpperCase();
    const paid = order.payment_status ? PAID_WORD[order.payment_status] : null;
    push({ text: `PAYMENT: ${method}${paid ? ` - ${paid}` : ''}`, bold: true, kind: 'payment' });
  }

  const footer = (options.footer ?? '').trim();
  if (footer) {
    push({ text: '', kind: 'gap' });
    for (const l of wrapText(footer, cols)) push({ text: center(l, cols), kind: 'footer' });
  }
  return lines;
}

/* ------------------------------------------------------------------------ */
/* Renderers                                                                  */
/* ------------------------------------------------------------------------ */

/** Plain text. Keeps Unicode; byte renderers fold to ASCII themselves. */
export function ticketToText(lines: TicketLine[]): string {
  return lines.map((l) => l.text.replace(/\s+$/, '')).join('\n');
}

const enc = (s: string): number[] => Array.from(foldToAscii(s), (c) => c.charCodeAt(0));

const ALIGN_N: Record<TicketAlign, number> = { left: 0, center: 1, right: 2 };

/**
 * ESC/POS (Epson TM-T20/TM-m30, Xprinter, Bixolon, most Bluetooth printers).
 *
 *   ESC @        initialise
 *   ESC a n      alignment
 *   ESC E n      emphasis (bold)
 *   GS B n       white/black reverse
 *   GS ! n       character size (0x11 double, 0x01 double height)
 *   ESC d n      feed n lines
 *   GS V 0       cut
 *
 * Every style is switched off again at the end of its line so a stray reverse
 * band can never run on to the end of the ticket.
 */
export function ticketToEscPos(lines: TicketLine[], options: { copies?: number; cut?: boolean } = {}): Uint8Array {
  const out: number[] = [];
  const copies = Math.max(1, Math.min(3, Math.floor(options.copies ?? 1)));
  for (let c = 0; c < copies; c += 1) {
    out.push(0x1b, 0x40);
    for (const line of lines) {
      out.push(0x1b, 0x61, ALIGN_N[line.align ?? 'left']);
      if (line.bold) out.push(0x1b, 0x45, 0x01);
      if (line.invert) out.push(0x1d, 0x42, 0x01);
      const size = line.size === 2 ? 0x11 : line.tall ? 0x01 : 0x00;
      if (size) out.push(0x1d, 0x21, size);
      out.push(...enc(line.text), 0x0a);
      if (size) out.push(0x1d, 0x21, 0x00);
      if (line.invert) out.push(0x1d, 0x42, 0x00);
      if (line.bold) out.push(0x1b, 0x45, 0x00);
    }
    out.push(0x1b, 0x64, 0x04);
    if (options.cut !== false) out.push(0x1d, 0x56, 0x00);
  }
  return Uint8Array.from(out);
}

/**
 * StarPRNT / Star Line Mode (TSP143IV, mC-Print3) — CloudPRNT media type
 * `application/vnd.star.starprnt`.
 *
 *   ESC @          initialise
 *   ESC GS a n     alignment
 *   ESC E / ESC F  emphasis on / off
 *   ESC 4 / ESC 5  white/black reverse on / off
 *   ESC i h w      character expansion (0 = normal, 1 = double)
 *   ESC d 3        feed to the cutter and partial cut
 */
export function ticketToStarPrnt(lines: TicketLine[]): Uint8Array {
  const out: number[] = [0x1b, 0x40];
  for (const line of lines) {
    out.push(0x1b, 0x1d, 0x61, ALIGN_N[line.align ?? 'left']);
    if (line.bold) out.push(0x1b, 0x45);
    if (line.invert) out.push(0x1b, 0x34);
    const h = line.size === 2 || line.tall ? 1 : 0;
    const w = line.size === 2 ? 1 : 0;
    if (h || w) out.push(0x1b, 0x69, h, w);
    out.push(...enc(line.text), 0x0a);
    if (h || w) out.push(0x1b, 0x69, 0x00, 0x00);
    if (line.invert) out.push(0x1b, 0x35);
    if (line.bold) out.push(0x1b, 0x46);
  }
  out.push(0x0a, 0x0a, 0x1b, 0x64, 0x03);
  return Uint8Array.from(out);
}

const xml = (s: string) => s.replace(/[&<>"']/g, (ch) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
}[ch] ?? ch));

export const EPOS_PRINT_NS = 'http://www.epson-pos.com/schemas/2011/03/epos-print';

/**
 * Epson ePOS-Print XML (Server Direct Print, ePOS SDK).
 *
 * Every attribute is set on every <text> element: in ePOS-Print the settings
 * are modal, and relying on an earlier element having switched reverse off is
 * how a whole ticket comes out black.
 */
export function ticketToEposXml(lines: TicketLine[]): string {
  const body = lines.map((line) => {
    const big = line.size === 2 ? 2 : 1;
    const high = line.size === 2 || line.tall ? 2 : 1;
    return `<text align="${line.align ?? 'left'}" em="${line.bold ? 'true' : 'false'}" reverse="${line.invert ? 'true' : 'false'}" width="${big}" height="${high}">${xml(foldToAscii(line.text))}&#10;</text>`;
  }).join('');
  return `<epos-print xmlns="${EPOS_PRINT_NS}"><text lang="en" smooth="true"/>${body}<feed line="3"/><cut type="feed"/></epos-print>`;
}
