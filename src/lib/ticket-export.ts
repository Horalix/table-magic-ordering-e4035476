import type { PrintOutcome } from '@/lib/print-outcome';
import {
  buildTicket, foldToAscii, paperColumns, ticketIsEmpty, ticketToEscPos, ticketToText,
  type TicketComponent, type TicketLine, type TicketOrder,
} from '../../supabase/functions/_shared/ticket-layout.ts';

/**
 * Kitchen and bar tickets in the browser.
 *
 * The layout itself lives in supabase/functions/_shared/ticket-layout.ts and is
 * shared with the `cloudprnt` Edge Function, so a network printer polling the
 * server and a tablet printing over Bluetooth produce the same ticket for the
 * same order. This module adapts the board's order shape to it, and owns the
 * browser-only outputs: the HTML print page, the downloads and the print-dialog
 * queue.
 */

export type { TicketComponent, TicketLine };

export interface KitchenTicketOrder {
  id: string;
  /** The short code shown on the board. The only string a human can match. */
  order_code?: string | null;
  status: string;
  total: number;
  tip_amount?: number | null;
  payment_method?: string | null;
  payment_status?: string | null;
  notes: string | null;
  created_at: string;
  released_to_kitchen_at?: string | null;
  table_number: number;
  guest_name: string | null;
  section_name: string | null;
  /** Whoever has the table — the runner's first question after "which table". */
  waiter_name?: string | null;
  items: {
    quantity: number;
    notes: string | null;
    menu_item_name: string;
    unit_price?: number | null;
    station?: string | null;
    allergens?: string[] | null;
    /** Combo parts (order_items.components); absent on older rows. */
    components?: TicketComponent[] | null;
  }[];
}

export interface KitchenPrintSettings {
  paperWidth: number;
  header: string;
  footer: string;
  showPrices: boolean;
  copies?: number;
  /**
   * Which station this ticket is for.
   *
   * Also decides whether money appears on it. A price on a line-cook ticket
   * invites it being handed to a guest as a bill, and the kitchen has no use
   * for the number. The payment WORD stays — a cook does need to know an order
   * is unpaid — but never the amount.
   */
  station?: 'kitchen' | 'bar' | null;
  /**
   * When the original of this ticket printed, if this is a reprint.
   *
   * Load-bearing: a reprint that looks identical to the original gets cooked
   * twice, because the line has no way to know the plate is already on the
   * pass. Printing both times is what actually prevents that.
   */
  reprintOf?: string | null;
  /** A test page rather than an order. */
  test?: boolean;
}

interface BrowserPrintJob {
  order: KitchenTicketOrder;
  settings: KitchenPrintSettings;
  resolve: (outcome: PrintOutcome) => void;
}

/**
 * How long to wait for the print dialog to finish before calling it a failure.
 *
 * The old code resolved after 750 ms whether or not anything had happened,
 * racing `afterprint`, which is why the outcome was meaningless. There is no
 * way to shorten this honestly: a human may be standing at a dialog.
 *
 * When the wait does expire we report FAILURE, not success. The asymmetry is
 * deliberate — a wrong failure costs a duplicate ticket, which is visible and
 * recoverable; a wrong success costs a missing ticket, which is invisible and
 * terminal.
 */
const BROWSER_PRINT_TIMEOUT_MS = 60_000;

const DEFAULT_SETTINGS: KitchenPrintSettings = {
  paperWidth: 80,
  header: 'La Soul',
  footer: '',
  showPrices: true,
  copies: 1,
};

const ticketHeading = (settings: KitchenPrintSettings) =>
  settings.test ? 'TEST TICKET' : settings.station === 'bar' ? 'BAR ORDER' : 'KITCHEN ORDER';

/** The code a human matches against the board, with a fallback for old rows. */
const ticketCode = (order: KitchenTicketOrder) =>
  order.order_code ? `#${order.order_code}` : `#${order.id.slice(0, 6).toUpperCase()}`;

const PAPER = {
  58: { columns: 32, minimumHeightMm: 60 },
  80: { columns: 48, minimumHeightMm: 60 },
} as const;

const CSS_PIXELS_PER_MM = 96 / 25.4;
const FALLBACK_PAGE_HEIGHT_MM = 200;
const browserPrintQueue: BrowserPrintJob[] = [];
let isBrowserPrintActive = false;

const getPaperWidth = (width: number): keyof typeof PAPER => width === 58 ? 58 : 80;
const getCopies = (copies?: number) => Math.max(1, Math.min(3, Math.floor(copies ?? 1)));
const fileStamp = (date = new Date()) => date.toISOString().replace(/[:.]/g, '-');
const ticketName = (order: KitchenTicketOrder, extension: string) =>
  `kitchen-ticket-table-${order.table_number}-${fileStamp(new Date(order.created_at))}.${extension}`;

/** The board's order, in the shape the shared layout reads. */
export const toTicketOrder = (order: KitchenTicketOrder): TicketOrder => ({
  id: order.id,
  order_code: order.order_code ?? null,
  table_number: order.table_number,
  created_at: order.created_at,
  released_to_kitchen_at: order.released_to_kitchen_at ?? null,
  guest_name: order.guest_name,
  section_name: order.section_name,
  waiter_name: order.waiter_name ?? null,
  notes: order.notes,
  payment_method: order.payment_method ?? null,
  payment_status: order.payment_status ?? null,
  total: order.total,
  tip_amount: order.tip_amount ?? null,
  items: order.items.map((item) => ({
    quantity: item.quantity,
    menu_item_name: item.menu_item_name,
    notes: item.notes,
    unit_price: item.unit_price ?? null,
    station: item.station ?? null,
    allergens: item.allergens ?? null,
    components: Array.isArray(item.components) ? item.components : null,
  })),
});

/** The ticket as styled lines — for previews that want to show the bands. */
export const buildKitchenTicketLines = (
  order: KitchenTicketOrder,
  settings: KitchenPrintSettings = DEFAULT_SETTINGS,
): TicketLine[] => buildTicket(toTicketOrder(order), {
  paperWidth: settings.paperWidth,
  header: settings.header,
  footer: settings.footer,
  showPrices: settings.showPrices,
  station: settings.station ?? null,
  reprintOf: settings.reprintOf ?? null,
  test: settings.test,
});

export const buildKitchenTicketText = (
  order: KitchenTicketOrder,
  settings: KitchenPrintSettings = DEFAULT_SETTINGS,
) => ticketToText(buildKitchenTicketLines(order, settings));

/**
 * ESC/POS bytes — bold, inverse notes and a big table number on any thermal
 * printer addressed directly (Bluetooth, USB, serial).
 */
export const buildKitchenTicketBytes = (
  order: KitchenTicketOrder,
  settings: KitchenPrintSettings = DEFAULT_SETTINGS,
): Uint8Array => ticketToEscPos(buildKitchenTicketLines(order, settings), { copies: getCopies(settings.copies) });

/** Whether a station has anything on this order. Print nothing then. */
export const ticketHasLines = (order: KitchenTicketOrder, station?: 'kitchen' | 'bar' | null) =>
  !ticketIsEmpty(toTicketOrder(order), station ?? null);

export { foldToAscii, paperColumns };

const escapeCsv = (value: unknown) => {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export const buildKitchenTicketCsv = (order: KitchenTicketOrder) => {
  const rows = [
    ['order_id', 'table_number', 'created_at', 'item_name', 'quantity', 'item_notes', 'order_notes'],
    ...order.items.map((item) => [
      order.id, order.table_number, order.created_at, item.menu_item_name,
      item.quantity, item.notes || '', order.notes || '',
    ]),
  ];
  return rows.map((row) => row.map(escapeCsv).join(',')).join('\n');
};

const download = (filename: string, contents: string, mime: string) => {
  const blob = new Blob([contents], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
};

export const downloadKitchenTicketJson = (order: KitchenTicketOrder) => {
  download(ticketName(order, 'json'), JSON.stringify(order, null, 2), 'application/json');
};

export const downloadKitchenTicketCsv = (order: KitchenTicketOrder) => {
  download(ticketName(order, 'csv'), buildKitchenTicketCsv(order), 'text/csv');
};


const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[character] ?? character));

/**
 * The printed page is the thermal ticket, line for line.
 *
 * It used to be a separately designed HTML layout, so the browser-printed
 * ticket and the Bluetooth one disagreed about what was big and what was
 * banded. It now draws the same lines the thermal printer gets, in the same
 * monospace grid: what the owner sees in the preview is what comes out of
 * every printer.
 */
const lineMarkup = (line: TicketLine) => {
  const classes = ['l'];
  if (line.bold) classes.push('b');
  if (line.invert) classes.push('i');
  if (line.size === 2) classes.push('s2');
  else if (line.tall) classes.push('t');
  if (line.kind) classes.push(line.kind);
  const text = line.text ? escapeHtml(line.text) : '&nbsp;';
  return `<div class="${classes.join(' ')}"><span>${text}</span></div>`;
};

const buildTicketMarkup = (order: KitchenTicketOrder, settings: KitchenPrintSettings) =>
  `<article class="ticket">${
    buildKitchenTicketLines(order, settings).map(lineMarkup).join('')
  }</article>`;

/** Courier is 0.6em wide; this fits exactly `columns` characters in the printable width. */
const fontSizeMm = (paperWidth: keyof typeof PAPER) => {
  const printable = paperWidth === 58 ? 48 : 72;
  return (printable / PAPER[paperWidth].columns / 0.6).toFixed(2);
};

const buildTicketStyles = (paperWidth: number) => {
  const width = getPaperWidth(paperWidth);
  const fs = fontSizeMm(width);
  return `
  @page { size: ${width}mm ${FALLBACK_PAGE_HEIGHT_MM}mm; margin: 0; }
  * { box-sizing: border-box; }
  html, body { width: ${width}mm; margin: 0; padding: 0; background: #fff; color: #000; }
  body { font-family: "Courier New", Courier, monospace; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .ticket { width: ${width}mm; padding: 2mm ${(width - (width === 58 ? 48 : 72)) / 2}mm 6mm; break-after: page; page-break-after: always; }
  .ticket:last-child { break-after: auto; page-break-after: auto; }
  .l { font-size: ${fs}mm; line-height: 1.2; height: ${(Number(fs) * 1.2).toFixed(2)}mm; white-space: pre; overflow: hidden; }
  .l > span { display: inline-block; transform-origin: top left; }
  .b { font-weight: 900; }
  /* Inverted bands: notes, allergens, station and reprint. Identifiable from
     two metres, which is the distance at which someone decides to cook. */
  .i { background: #000; color: #fff; }
  .t { height: ${(Number(fs) * 2.4).toFixed(2)}mm; }
  .t > span { transform: scaleY(2); }
  .s2 { font-size: ${(Number(fs) * 2).toFixed(2)}mm; height: ${(Number(fs) * 2.4).toFixed(2)}mm; }
`;
};

export const buildKitchenTicketHtml = (
  order: KitchenTicketOrder,
  settings: KitchenPrintSettings = DEFAULT_SETTINGS,
) => {
  const paperWidth = getPaperWidth(settings.paperWidth);
  const copies = getCopies(settings.copies);
  const tickets = Array.from({ length: copies }, () => buildTicketMarkup(order, settings)).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>Kitchen ticket</title><style id="page-size">${buildTicketStyles(paperWidth)}</style></head><body>${tickets}</body></html>`;
};

const updatePrintedPageSize = (doc: Document, paperWidth: keyof typeof PAPER) => {
  const ticket = doc.querySelector<HTMLElement>('.ticket');
  const style = doc.getElementById('page-size');
  if (!ticket || !style) return;
  const measuredHeightMm = Math.ceil(ticket.getBoundingClientRect().height / CSS_PIXELS_PER_MM);
  const pageHeightMm = Math.max(PAPER[paperWidth].minimumHeightMm, measuredHeightMm);
  style.textContent = buildTicketStyles(paperWidth).replace(
    `${FALLBACK_PAGE_HEIGHT_MM}mm; margin: 0; }`,
    `${pageHeightMm}mm; margin: 0; }`,
  );
};

const runBrowserPrintJob = (
  { order, settings, resolve }: BrowserPrintJob,
  onComplete: () => void,
) => {
  const paperWidth = getPaperWidth(settings.paperWidth);
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.cssText = `position:fixed;left:-10000px;top:0;width:${paperWidth}mm;height:1px;border:0;`;
  let hasStarted = false;
  let hasCompleted = false;

  const complete = (outcome: PrintOutcome) => {
    if (hasCompleted) return;
    hasCompleted = true;
    window.clearTimeout(timer);
    iframe.remove();
    resolve(outcome);
    onComplete();
  };

  /**
   * A .txt download is a rescue, not a print.
   *
   * It used to be reported as success, so an environment where printing was
   * impossible looked, to every screen and to the database, exactly like a
   * kitchen with a working printer.
   */
  const rescue = (reason: string) => {
    download(ticketName(order, 'txt'), buildKitchenTicketText(order, settings), 'text/plain');
    complete({ ok: false, reason: `${reason} — the ticket was saved as a file instead` });
  };

  const timer = window.setTimeout(
    () => complete({ ok: false, reason: 'The print dialog never finished' }),
    BROWSER_PRINT_TIMEOUT_MS,
  );

  iframe.onload = () => {
    if (hasStarted) return;
    hasStarted = true;
    const win = iframe.contentWindow;
    const doc = iframe.contentDocument;
    if (!win || !doc) {
      rescue('This browser would not open a print frame');
      return;
    }

    // `afterprint` is the only signal the browser gives, and it means "the
    // dialog closed" — never "paper came out". Hence verified: false, always.
    win.addEventListener('afterprint', () => complete({ ok: true, verified: false }), { once: true });
    win.requestAnimationFrame(() => win.requestAnimationFrame(() => {
      updatePrintedPageSize(doc, paperWidth);
      try {
        win.focus();
        win.print();
      } catch {
        rescue('The browser refused to print');
      }
    }));
  };
  iframe.srcdoc = buildKitchenTicketHtml(order, settings);
  document.body.appendChild(iframe);
};

const processBrowserPrintQueue = () => {
  if (isBrowserPrintActive) return;
  const nextJob = browserPrintQueue.shift();
  if (!nextJob) return;
  isBrowserPrintActive = true;
  runBrowserPrintJob(nextJob, () => {
    isBrowserPrintActive = false;
    processBrowserPrintQueue();
  });
};

/**
 * Prints one thermal-sized browser job. Multiple copies are pages in the same
 * job, and concurrent orders are queued so browser print dialogs cannot race.
 */
export const printKitchenTicket = (
  order: KitchenTicketOrder,
  settings: KitchenPrintSettings = DEFAULT_SETTINGS,
): Promise<PrintOutcome> =>
  new Promise<PrintOutcome>((resolve) => {
    browserPrintQueue.push({ order, settings, resolve });
    processBrowserPrintQueue();
  });
