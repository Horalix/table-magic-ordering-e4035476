export interface KitchenTicketOrder {
  id: string;
  status: string;
  total: number;
  tip_amount?: number | null;
  payment_method?: string | null;
  notes: string | null;
  created_at: string;
  table_number: number;
  guest_name: string | null;
  section_name: string | null;
  items: {
    quantity: number;
    notes: string | null;
    menu_item_name: string;
    unit_price?: number | null;
  }[];
}

export interface KitchenPrintSettings {
  paperWidth: number;
  header: string;
  footer: string;
  showPrices: boolean;
  copies?: number;
}

interface BrowserPrintJob {
  order: KitchenTicketOrder;
  settings: KitchenPrintSettings;
}

const DEFAULT_SETTINGS: KitchenPrintSettings = {
  paperWidth: 80,
  header: 'La Soul',
  footer: '',
  showPrices: true,
  copies: 1,
};

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
const money = (amount: number | null | undefined) => `${Number(amount ?? 0).toFixed(2)} KM`;
const fileStamp = (date = new Date()) => date.toISOString().replace(/[:.]/g, '-');
const ticketName = (order: KitchenTicketOrder, extension: string) =>
  `kitchen-ticket-table-${order.table_number}-${fileStamp(new Date(order.created_at))}.${extension}`;

const formatTicketTime = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date).replace(',', ' ·');
};

const wrapText = (value: string, width: number): string[] => {
  const words = value.trim().replace(/\s+/g, ' ').split(' ').filter(Boolean);
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const chunks = word.match(new RegExp(`.{1,${width}}`, 'g')) ?? [];
    for (const chunk of chunks) {
      const candidate = current ? `${current} ${chunk}` : chunk;
      if (candidate.length <= width) current = candidate;
      else {
        if (current) lines.push(current);
        current = chunk;
      }
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [''];
};

const centeredLines = (value: string, columns: number) =>
  wrapText(value, columns).map((line) => line.padStart(line.length + Math.floor((columns - line.length) / 2)));

const itemTextLines = (
  item: KitchenTicketOrder['items'][number],
  settings: KitchenPrintSettings,
  columns: number,
) => {
  const description = `${item.quantity} x ${item.menu_item_name}`;
  const price = settings.showPrices && item.unit_price != null
    ? money(item.quantity * Number(item.unit_price))
    : '';
  const combined = price ? `${description}  ${price}` : description;
  const lines = combined.length <= columns
    ? [description.padEnd(columns - price.length) + price]
    : [...wrapText(description, columns), ...(price ? [price.padStart(columns)] : [])];

  if (item.notes) lines.push(...wrapText(`! ${item.notes}`, columns).map((line) => `  ${line}`.slice(0, columns)));
  return lines;
};

export const buildKitchenTicketText = (
  order: KitchenTicketOrder,
  settings: KitchenPrintSettings = DEFAULT_SETTINGS,
) => {
  const paperWidth = getPaperWidth(settings.paperWidth);
  const columns = PAPER[paperWidth].columns;
  const divider = '-'.repeat(columns);
  const lines = [
    ...centeredLines(settings.header.trim() || 'La Soul', columns),
    ...centeredLines('KITCHEN ORDER', columns),
    divider,
    `TABLE ${order.table_number}`,
    ...(order.section_name ? wrapText(`Section: ${order.section_name}`, columns) : []),
    ...(order.guest_name ? wrapText(`Guest: ${order.guest_name}`, columns) : []),
    ...wrapText(`Time: ${formatTicketTime(order.created_at)}`, columns),
    `Ref: ${order.id.slice(0, 8).toUpperCase()}`,
    divider,
    ...order.items.flatMap((item) => itemTextLines(item, settings, columns)),
    divider,
  ];

  if (order.notes) lines.push(...wrapText(`ORDER NOTE: ${order.notes}`, columns));
  if (settings.showPrices) {
    const tip = Number(order.tip_amount ?? 0);
    if (tip > 0) lines.push(`Subtotal: ${money(order.total - tip)}`, `Tip: ${money(tip)}`);
    lines.push(`TOTAL: ${money(order.total)}`);
  }
  if (order.payment_method) lines.push(`PAYMENT: ${order.payment_method.toUpperCase()}`);
  if (settings.footer.trim()) lines.push('', ...centeredLines(settings.footer.trim(), columns));
  return lines.join('\n');
};

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

const detailRow = (label: string, value: string) =>
  `<div class="detail"><dt>${label}</dt><dd>${escapeHtml(value)}</dd></div>`;

const buildItemsMarkup = (order: KitchenTicketOrder, settings: KitchenPrintSettings) => order.items.map((item) => {
  const amount = settings.showPrices && item.unit_price != null
    ? `<span class="item__amount">${money(item.quantity * Number(item.unit_price))}</span>`
    : '';
  const note = item.notes
    ? `<div class="item__note"><strong>NOTE</strong> ${escapeHtml(item.notes)}</div>`
    : '';
  return `<li class="item">
    <div class="item__main"><span class="item__quantity">${item.quantity}&times;</span><span class="item__name">${escapeHtml(item.menu_item_name)}</span>${amount}</div>
    ${note}
  </li>`;
}).join('');

const buildTotalsMarkup = (order: KitchenTicketOrder, settings: KitchenPrintSettings) => {
  const rows: string[] = [];
  const tip = Number(order.tip_amount ?? 0);
  if (settings.showPrices && tip > 0) {
    rows.push(detailRow('Subtotal', money(order.total - tip)), detailRow('Tip', money(tip)));
  }
  if (settings.showPrices) rows.push(detailRow('TOTAL', money(order.total)));
  if (order.payment_method) rows.push(detailRow('Payment', order.payment_method.toUpperCase()));
  return rows.length ? `<dl class="totals">${rows.join('')}</dl>` : '';
};

const buildTicketMarkup = (order: KitchenTicketOrder, settings: KitchenPrintSettings) => {
  const header = settings.header.trim() || 'La Soul';
  const details = [
    order.section_name ? detailRow('Section', order.section_name) : '',
    order.guest_name ? detailRow('Guest', order.guest_name) : '',
    detailRow('Time', formatTicketTime(order.created_at)),
    detailRow('Reference', order.id.slice(0, 8).toUpperCase()),
  ].join('');
  const orderNote = order.notes
    ? `<section class="order-note"><strong>ORDER NOTE</strong><p>${escapeHtml(order.notes)}</p></section>`
    : '';
  const footer = settings.footer.trim()
    ? `<footer>${escapeHtml(settings.footer.trim())}</footer>`
    : '';

  return `<article class="ticket">
    <header><div class="brand">${escapeHtml(header)}</div><div class="ticket-type">KITCHEN ORDER</div></header>
    <section class="table"><span>TABLE</span><strong>${order.table_number}</strong></section>
    <dl class="details">${details}</dl>
    <ol class="items">${buildItemsMarkup(order, settings)}</ol>
    ${orderNote}${buildTotalsMarkup(order, settings)}${footer}
  </article>`;
};

const buildTicketStyles = (paperWidth: number) => `
  @page { size: ${paperWidth}mm ${FALLBACK_PAGE_HEIGHT_MM}mm; margin: 0; }
  * { box-sizing: border-box; }
  html, body { width: ${paperWidth}mm; margin: 0; padding: 0; background: #fff; color: #000; }
  body { font-family: "Courier New", Courier, monospace; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .ticket { width: ${paperWidth}mm; padding: 3mm 3mm 6mm; break-after: page; page-break-after: always; }
  .ticket:last-child { break-after: auto; page-break-after: auto; }
  header { text-align: center; border-bottom: 0.55mm solid #000; padding-bottom: 2mm; }
  .brand { font-size: 15pt; line-height: 1.1; font-weight: 900; overflow-wrap: anywhere; }
  .ticket-type { margin-top: 0.8mm; font-size: 8.5pt; line-height: 1.2; font-weight: 700; letter-spacing: 0.12em; }
  .table { display: flex; align-items: baseline; justify-content: center; gap: 2.5mm; padding: 2.5mm 0 2mm; border-bottom: 0.35mm dashed #000; }
  .table span { font-size: 11pt; font-weight: 700; letter-spacing: 0.08em; }
  .table strong { font-size: 28pt; line-height: 0.95; font-weight: 900; }
  dl { margin: 0; }
  .details { padding: 1.8mm 0; border-bottom: 0.35mm dashed #000; }
  .detail { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 2mm; font-size: 8.5pt; line-height: 1.35; }
  .detail dt { font-weight: 700; }
  .detail dd { margin: 0; text-align: right; overflow-wrap: anywhere; }
  .items { margin: 0; padding: 0; list-style: none; }
  .item { padding: 2.3mm 0; border-bottom: 0.35mm dashed #000; break-inside: avoid; page-break-inside: avoid; }
  .item__main { display: grid; grid-template-columns: 8mm minmax(0, 1fr) max-content; align-items: baseline; column-gap: 1mm; }
  .item__quantity { font-size: 13pt; line-height: 1.15; font-weight: 900; }
  .item__name { font-size: 11pt; line-height: 1.22; font-weight: 900; overflow-wrap: anywhere; }
  .item__amount { font-size: 8.5pt; line-height: 1.2; font-weight: 700; padding-left: 1mm; white-space: nowrap; }
  .item__note { margin: 1.4mm 0 0 9mm; padding: 1.2mm 1.5mm; border: 0.35mm solid #000; font-size: 9pt; line-height: 1.25; overflow-wrap: anywhere; }
  .item__note strong { font-size: 7.5pt; letter-spacing: 0.08em; }
  .order-note { margin-top: 2.3mm; padding: 1.8mm; border: 0.55mm solid #000; break-inside: avoid; page-break-inside: avoid; }
  .order-note strong { font-size: 8pt; letter-spacing: 0.08em; }
  .order-note p { margin: 1mm 0 0; font-size: 10pt; line-height: 1.3; font-weight: 700; overflow-wrap: anywhere; }
  .totals { margin-top: 2.3mm; padding-top: 1.8mm; border-top: 0.55mm solid #000; }
  .totals .detail { font-size: 10pt; line-height: 1.45; }
  .totals .detail:last-child { margin-top: 0.8mm; font-size: 13pt; font-weight: 900; }
  footer { margin-top: 3mm; padding-top: 2mm; border-top: 0.35mm dashed #000; text-align: center; font-size: 8.5pt; line-height: 1.3; font-weight: 700; overflow-wrap: anywhere; }
`;

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

const runBrowserPrintJob = ({ order, settings }: BrowserPrintJob, onComplete: () => void) => {
  const paperWidth = getPaperWidth(settings.paperWidth);
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.cssText = `position:fixed;left:-10000px;top:0;width:${paperWidth}mm;height:1px;border:0;`;
  let hasStarted = false;
  let hasCompleted = false;

  const complete = () => {
    if (hasCompleted) return;
    hasCompleted = true;
    iframe.remove();
    onComplete();
  };

  iframe.onload = () => {
    if (hasStarted) return;
    hasStarted = true;
    const win = iframe.contentWindow;
    const doc = iframe.contentDocument;
    if (!win || !doc) {
      download(ticketName(order, 'txt'), buildKitchenTicketText(order, settings), 'text/plain');
      complete();
      return;
    }

    win.addEventListener('afterprint', complete, { once: true });
    win.requestAnimationFrame(() => win.requestAnimationFrame(() => {
      updatePrintedPageSize(doc, paperWidth);
      try {
        win.focus();
        win.print();
        window.setTimeout(complete, 750);
      } catch {
        download(ticketName(order, 'txt'), buildKitchenTicketText(order, settings), 'text/plain');
        complete();
      }
    }));
  };
  iframe.srcdoc = buildKitchenTicketHtml(order, settings);
  document.body.appendChild(iframe);
  window.setTimeout(complete, 60_000);
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
) => {
  browserPrintQueue.push({ order, settings });
  processBrowserPrintQueue();
};
