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
  paperWidth: number;   // 58 | 80 (mm)
  header: string;
  footer: string;
  showPrices: boolean;
  copies?: number;
}

const DEFAULT_SETTINGS: KitchenPrintSettings = {
  paperWidth: 80,
  header: 'La Soul',
  footer: '',
  showPrices: true,
  copies: 1,
};

const fileStamp = (date = new Date()) => date.toISOString().replace(/[:.]/g, '-');
const ticketName = (order: KitchenTicketOrder, extension: string) =>
  `kitchen-ticket-table-${order.table_number}-${fileStamp(new Date(order.created_at))}.${extension}`;

const escapeCsv = (value: unknown) => {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
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
  URL.revokeObjectURL(url);
};

const money = (n: number | null | undefined) => `${Number(n ?? 0).toFixed(2)} KM`;

export const buildKitchenTicketText = (order: KitchenTicketOrder, settings: KitchenPrintSettings = DEFAULT_SETTINGS) => {
  const lines: (string | null)[] = [
    settings.header || 'La Soul',
    'KITCHEN',
    `Table: ${order.table_number}`,
    order.section_name ? `Section: ${order.section_name}` : null,
    order.guest_name ? `Guest: ${order.guest_name}` : null,
    `Time: ${new Date(order.created_at).toLocaleString()}`,
    `Ref: ${order.id.slice(0, 8).toUpperCase()}`,
    '--------------------------------',
    ...order.items.flatMap((item) => [
      settings.showPrices && item.unit_price != null
        ? `${item.quantity} x ${item.menu_item_name}  ${money(item.quantity * Number(item.unit_price))}`
        : `${item.quantity} x ${item.menu_item_name}`,
      item.notes ? `  >> ${item.notes}` : null,
    ]),
    '--------------------------------',
    order.notes ? `Order note: ${order.notes}` : null,
  ];

  if (settings.showPrices) {
    if (order.tip_amount && Number(order.tip_amount) > 0) lines.push(`Tip: ${money(order.tip_amount)}`);
    lines.push(`TOTAL: ${money(order.total)}`);
  }
  if (order.payment_method) lines.push(`Pay: ${order.payment_method === 'card' ? 'CARD' : 'CASH'}`);
  if (settings.footer) { lines.push('', settings.footer); }

  return lines.filter((l) => l !== null && l !== undefined).join('\n');
};

export const buildKitchenTicketCsv = (order: KitchenTicketOrder) => {
  const rows = [
    ['order_id', 'table_number', 'created_at', 'item_name', 'quantity', 'item_notes', 'order_notes'],
    ...order.items.map((item) => [
      order.id, order.table_number, order.created_at, item.menu_item_name, item.quantity, item.notes || '', order.notes || '',
    ]),
  ];
  return rows.map((row) => row.map(escapeCsv).join(',')).join('\n');
};

export const downloadKitchenTicketJson = (order: KitchenTicketOrder) => {
  download(ticketName(order, 'json'), JSON.stringify(order, null, 2), 'application/json');
};
export const downloadKitchenTicketCsv = (order: KitchenTicketOrder) => {
  download(ticketName(order, 'csv'), buildKitchenTicketCsv(order), 'text/csv');
};

const escapeHtml = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] || c));

/**
 * Print a thermal ticket via a hidden iframe (no popup blockers; works with
 * Chrome's `--kiosk-printing` flag for silent auto-printing). Widths target
 * 58mm / 80mm thermal rolls.
 */
export const printKitchenTicket = (order: KitchenTicketOrder, settings: KitchenPrintSettings = DEFAULT_SETTINGS) => {
  const text = buildKitchenTicketText(order, settings);
  const widthMm = settings.paperWidth === 58 ? 56 : 76; // printable area
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Ticket</title><style>
    @page { size: ${settings.paperWidth}mm auto; margin: 2mm; }
    html, body { margin: 0; padding: 0; }
    body { font-family: ui-monospace, "Courier New", monospace; width: ${widthMm}mm; }
    pre { white-space: pre-wrap; word-break: break-word; font-size: 12px; line-height: 1.35; margin: 0; font-weight: 700; }
  </style></head><body><pre>${escapeHtml(text)}</pre></body></html>`;

  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;';
  document.body.appendChild(iframe);

  const cleanup = () => { setTimeout(() => iframe.remove(), 1000); };
  iframe.onload = () => {
    try {
      const win = iframe.contentWindow;
      if (!win) { download(ticketName(order, 'txt'), text, 'text/plain'); cleanup(); return; }
      const copies = Math.max(1, Math.min(3, settings.copies ?? 1));
      for (let i = 0; i < copies; i++) { win.focus(); win.print(); }
      cleanup();
    } catch {
      download(ticketName(order, 'txt'), text, 'text/plain');
      cleanup();
    }
  };
  const doc = iframe.contentWindow?.document;
  if (doc) { doc.open(); doc.write(html); doc.close(); } else { iframe.srcdoc = html; }
};
