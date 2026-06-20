export interface KitchenTicketOrder {
  id: string;
  status: string;
  total: number;
  notes: string | null;
  created_at: string;
  table_number: number;
  guest_name: string | null;
  section_name: string | null;
  items: {
    quantity: number;
    notes: string | null;
    menu_item_name: string;
  }[];
}

const fileStamp = (date = new Date()) =>
  date.toISOString().replace(/[:.]/g, '-');

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

export const buildKitchenTicketText = (order: KitchenTicketOrder) => {
  const lines = [
    'LA SOUL KITCHEN',
    `Table: ${order.table_number}`,
    order.section_name ? `Section: ${order.section_name}` : null,
    order.guest_name ? `Guest: ${order.guest_name}` : null,
    `Order: ${order.id}`,
    `Time: ${new Date(order.created_at).toLocaleString()}`,
    '',
    ...order.items.flatMap((item) => [
      `${item.quantity} x ${item.menu_item_name}`,
      item.notes ? `  Note: ${item.notes}` : null,
    ]),
    '',
    order.notes ? `Order note: ${order.notes}` : null,
    `Total: ${Number(order.total).toFixed(2)} KM`,
  ];

  return lines.filter(Boolean).join('\n');
};

export const buildKitchenTicketCsv = (order: KitchenTicketOrder) => {
  const rows = [
    ['order_id', 'table_number', 'created_at', 'item_name', 'quantity', 'item_notes', 'order_notes'],
    ...order.items.map((item) => [
      order.id,
      order.table_number,
      order.created_at,
      item.menu_item_name,
      item.quantity,
      item.notes || '',
      order.notes || '',
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

export const printKitchenTicket = (order: KitchenTicketOrder) => {
  const text = buildKitchenTicketText(order);
  const popup = window.open('', '_blank', 'width=420,height=640');
  if (!popup) {
    download(ticketName(order, 'txt'), text, 'text/plain');
    return;
  }

  popup.document.write(`
    <!doctype html>
    <html>
      <head>
        <title>Kitchen Ticket</title>
        <style>
          body { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; padding: 16px; }
          pre { white-space: pre-wrap; font-size: 13px; line-height: 1.35; }
          @media print { body { padding: 0; } }
        </style>
      </head>
      <body><pre>${text.replace(/[&<>]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[char] || char)}</pre></body>
    </html>
  `);
  popup.document.close();
  popup.focus();
  popup.print();
};

