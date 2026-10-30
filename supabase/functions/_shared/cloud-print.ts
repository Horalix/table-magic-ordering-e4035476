/**
 * The cloud-print protocols, independent of Deno and of Supabase.
 *
 * One URL serves both families of "the printer polls the server" printers, so
 * the owner never has to know which one they bought:
 *
 *   Star CloudPRNT (TSP143IV, mC-Print3)
 *     POST  {JSON status}            → {jobReady, mediaTypes, jobToken}
 *     GET   ?type=…&token=<job>      → the job, in the media type asked for
 *     DELETE ?code=200%20OK&token=…  → printed (any code not starting "2" = failed)
 *     (or GET …&delete when the server asked for deleteMethod GET)
 *
 *   Epson Server Direct Print (TM-m30III, TM-T88VII, TM-m50)
 *     POST ConnectionType=GetRequest   → <PrintRequestInfo> with ePOS-Print XML, or empty
 *     POST ConnectionType=SetResponse  → <PrintResponseInfo> success / failure
 *     POST ConnectionType=SetStatus    → status only
 *
 * The printer is identified by the secret LAST PATH SEGMENT of its URL —
 * `/functions/v1/cloudprnt/<poll_token>` — not by a query parameter, because
 * CloudPRNT appends its own `token=` (the job token) to every request.
 *
 * Everything that touches the database is behind `CloudPrintBackend`, so this
 * file is unit-tested with plain Request/Response objects (see
 * src/lib/cloud-print.test.ts) and the Edge Function is a thin adapter.
 */
import {
  buildTicket, ticketToEposXml, ticketToStarPrnt, ticketToText, foldToAscii, partItemIds, withPartAllergens,
  type TicketOrder,
} from './ticket-layout.ts';

export interface CloudPrinter {
  id: string;
  name: string;
  station: 'kitchen' | 'bar' | 'all';
  paper_width: number;
  plain_text: boolean;
  next_ticket_id: string | null;
  test_pending: boolean;
}

export interface ClaimedTicket {
  ticket_id: string;
  order_id: string;
  ticket_type: string;
  original_printed_at: string | null;
  paper_width: number;
  plain_text: boolean;
}

export interface CloudPrintBackend {
  checkin(token: string, protocol: Protocol, mac: string | null, status: string | null): Promise<CloudPrinter | null>;
  claim(token: string, ticketId: string | null): Promise<ClaimedTicket | null>;
  report(token: string, ticketId: string | null, ok: boolean, error: string | null): Promise<string | null>;
  testDone(token: string, ok: boolean, error: string | null): Promise<void>;
  loadOrder(orderId: string): Promise<TicketOrder | null>;
  /** The ticket header and footer of the restaurant this printer (its poll token) belongs to. */
  settings(token: string): Promise<{ header: string | null; footer: string | null }>;
  /**
   * menu_items.allergens for these menu item ids: a combo part's OWN
   * allergens, which the order line does not store. Optional — without it a
   * part prints without an allergen band.
   */
  partAllergens?(itemIds: string[]): Promise<Record<string, string[] | null>>;
}

export type Protocol = 'star_cloudprnt' | 'epson_sdp';

export const STAR_STARPRNT = 'application/vnd.star.starprnt';
export const TEXT_PLAIN = 'text/plain';
export const TEST_JOB = 'test';

/** The secret poll token: the last path segment, if it looks like one. */
export function pollToken(url: URL): string | null {
  const last = url.pathname.split('/').filter(Boolean).pop() ?? '';
  return /^[A-Za-z0-9_-]{32,128}$/.test(last) ? last : null;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const text = (body: string, status = 200, type = 'text/plain; charset=utf-8') =>
  new Response(body, { status, headers: { 'Content-Type': type } });

/** A sample order for the test page: every kind of line a real ticket has. */
export function testOrder(now = new Date()): TicketOrder {
  return {
    id: 'test-page',
    order_code: 'TEST',
    table_number: 5,
    created_at: now.toISOString(),
    released_to_kitchen_at: now.toISOString(),
    section_name: 'Terasa',
    waiter_name: 'Marko',
    guest_name: null,
    notes: 'This is a test page from Admin > Printing',
    payment_method: 'cash',
    payment_status: 'unpaid',
    total: 0,
    items: [
      {
        quantity: 2, menu_item_name: 'La Soul Burger', notes: 'no onions', station: 'kitchen', allergens: ['gluten', 'sesame'],
        components: [{ slot_label: 'Side', name: 'Pomfrit', station: 'kitchen' }],
      },
      { quantity: 1, menu_item_name: 'Ćevapi (10 kom)', notes: null, station: 'kitchen' },
      { quantity: 2, menu_item_name: 'Espresso', notes: null, station: 'bar' },
    ],
  };
}

interface Rendered { lines: ReturnType<typeof buildTicket> }

async function render(
  backend: CloudPrintBackend,
  token: string,
  order: TicketOrder,
  options: { paperWidth: number; station: 'kitchen' | 'bar' | null; reprintOf: string | null; test?: boolean; now?: Date },
): Promise<Rendered> {
  const settings = await backend.settings(token).catch(() => ({ header: null, footer: null }));
  return {
    lines: buildTicket(order, {
      paperWidth: options.paperWidth,
      header: settings.header,
      footer: settings.footer,
      showPrices: false,
      station: options.station,
      reprintOf: options.reprintOf,
      test: options.test,
      now: options.now,
    }),
  };
}

const stationOfTicket = (type: string): 'kitchen' | 'bar' | null =>
  type === 'kitchen' || type === 'bar' ? type : null;

/**
 * The order as it will be printed: live from the database, with every combo
 * part's own allergens attached — a bar ticket lists the lemonade of a burger
 * combo as a line of its own, and its allergens are the lemonade's, not the
 * burger's.
 *
 * A failed allergen lookup still prints: the line keeps its name, quantity
 * and notes, and a ticket that never prints is the one failure nobody sees.
 */
async function loadTicketOrder(backend: CloudPrintBackend, orderId: string): Promise<TicketOrder | null> {
  const order = await backend.loadOrder(orderId);
  if (!order || !backend.partAllergens) return order;
  const ids = partItemIds(order.items);
  if (ids.length === 0) return order;
  const found = await backend.partAllergens(ids).catch(() => ({}));
  return { ...order, items: withPartAllergens(order.items, found) };
}

/* ------------------------------------------------------------------------ */
/* Star CloudPRNT                                                             */
/* ------------------------------------------------------------------------ */

async function starPoll(req: Request, token: string, backend: CloudPrintBackend): Promise<Response> {
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* an empty poll is still a poll */ }
  const mac = typeof body.printerMAC === 'string' ? body.printerMAC : null;
  const rawStatus = typeof body.statusCode === 'string' ? body.statusCode : null;
  let status = rawStatus;
  try { status = rawStatus ? decodeURIComponent(rawStatus) : null; } catch { /* keep raw */ }

  const printer = await backend.checkin(token, 'star_cloudprnt', mac, status);
  if (!printer) return text('Unknown printer', 404);

  // Never stack a second job on a printer that is still printing one.
  if (body.printingInProgress === true) return json({ jobReady: false });

  const jobToken = printer.test_pending ? TEST_JOB : printer.next_ticket_id;
  if (!jobToken) return json({ jobReady: false });
  return json({
    jobReady: true,
    mediaTypes: printer.plain_text ? [TEXT_PLAIN] : [STAR_STARPRNT, TEXT_PLAIN],
    jobToken,
    deleteMethod: 'DELETE',
  });
}

async function starJob(url: URL, token: string, backend: CloudPrintBackend, now: Date): Promise<Response> {
  const wanted = url.searchParams.get('type') ?? TEXT_PLAIN;
  const jobToken = url.searchParams.get('token');

  let rendered: Rendered;
  let plain = false;
  if (jobToken === TEST_JOB) {
    const printer = await backend.checkin(token, 'star_cloudprnt', url.searchParams.get('mac'), null);
    if (!printer) return text('Unknown printer', 404);
    plain = printer.plain_text;
    rendered = await render(backend, token, testOrder(now), { paperWidth: printer.paper_width, station: null, reprintOf: null, test: true, now });
  } else {
    const claimed = await backend.claim(token, jobToken);
    if (!claimed) return text('No job', 404);
    const order = await loadTicketOrder(backend, claimed.order_id);
    if (!order) {
      await backend.report(token, claimed.ticket_id, false, 'The order could not be loaded');
      return text('No job', 404);
    }
    plain = claimed.plain_text;
    rendered = await render(backend, token, order, {
      paperWidth: claimed.paper_width,
      station: stationOfTicket(claimed.ticket_type),
      reprintOf: claimed.original_printed_at,
      now,
    });
  }

  if (!plain && wanted.startsWith(STAR_STARPRNT)) {
    const bytes = new Uint8Array(ticketToStarPrnt(rendered.lines));
    return new Response(bytes.buffer, { headers: { 'Content-Type': STAR_STARPRNT } });
  }
  // Plain text, folded to ASCII: a CloudPRNT text job uses the printer's own
  // code page, which has no č/ć/ž/š/đ.
  return text(`${foldToAscii(ticketToText(rendered.lines))}\n\n\n`, 200, 'text/plain; charset=us-ascii');
}

async function starConfirm(url: URL, token: string, backend: CloudPrintBackend): Promise<Response> {
  const code = url.searchParams.get('code') ?? '';
  const jobToken = url.searchParams.get('token');
  const ok = code.trim().startsWith('2');
  const error = ok ? null : `The printer reported ${code || 'an error'}`;
  if (jobToken === TEST_JOB) await backend.testDone(token, ok, error);
  else await backend.report(token, jobToken, ok, error);
  return text('OK');
}

/* ------------------------------------------------------------------------ */
/* Epson Server Direct Print                                                  */
/* ------------------------------------------------------------------------ */

const EPSON_XML = 'text/xml; charset=utf-8';

/** Epson's printjobid is short; it only appears in the printer's own log. */
const epsonJobId = (id: string) => id.replace(/[^A-Za-z0-9]/g, '').slice(0, 30);

export function epsonPrintRequest(eposXml: string, jobId: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>\n<PrintRequestInfo Version="2.00"><ePOSPrint><Parameter><devid>local_printer</devid><timeout>10000</timeout><printjobid>${epsonJobId(jobId)}</printjobid></Parameter><PrintData>${eposXml}</PrintData></ePOSPrint></PrintRequestInfo>`;
}

/** success / code / printjobid out of a <PrintResponseInfo>. Tolerant: it is a printer. */
export function parseEpsonResponse(xml: string): { ok: boolean; code: string | null; jobId: string | null } {
  const success = /<response\b[^>]*\bsuccess="(true|false)"/i.exec(xml)?.[1];
  const code = /<response\b[^>]*\bcode="([^"]*)"/i.exec(xml)?.[1] ?? null;
  const jobId = /<printjobid>([^<]*)<\/printjobid>/i.exec(xml)?.[1] ?? null;
  return { ok: success === 'true', code: code || null, jobId };
}

async function epson(req: Request, token: string, backend: CloudPrintBackend, now: Date): Promise<Response> {
  const form = new URLSearchParams(await req.text());
  const kind = form.get('ConnectionType') ?? '';
  const deviceId = form.get('ID');

  if (kind === 'SetResponse') {
    const result = parseEpsonResponse(form.get('ResponseFile') ?? '');
    const error = result.ok ? null : `The printer reported ${result.code ?? 'an error'}`;
    if (result.jobId === TEST_JOB) await backend.testDone(token, result.ok, error);
    else await backend.report(token, null, result.ok, error);
    await backend.checkin(token, 'epson_sdp', deviceId, result.ok ? 'OK' : (result.code ?? 'error'));
    return text('', 200, EPSON_XML);
  }

  const printer = await backend.checkin(token, 'epson_sdp', deviceId, kind === 'SetStatus' ? (form.get('Status') ?? null) : null);
  if (!printer) return text('Unknown printer', 404);
  if (kind !== 'GetRequest') return text('', 200, EPSON_XML);

  if (printer.test_pending) {
    const rendered = await render(backend, token, testOrder(now), { paperWidth: printer.paper_width, station: null, reprintOf: null, test: true, now });
    return text(epsonPrintRequest(ticketToEposXml(rendered.lines), TEST_JOB), 200, EPSON_XML);
  }

  const claimed = await backend.claim(token, null);
  // "Nothing to print" is an empty answer, not an error.
  if (!claimed) return text('', 200, EPSON_XML);
  const order = await loadTicketOrder(backend, claimed.order_id);
  if (!order) {
    await backend.report(token, claimed.ticket_id, false, 'The order could not be loaded');
    return text('', 200, EPSON_XML);
  }
  const rendered = await render(backend, token, order, {
    paperWidth: claimed.paper_width,
    station: stationOfTicket(claimed.ticket_type),
    reprintOf: claimed.original_printed_at,
    now,
  });
  return text(epsonPrintRequest(ticketToEposXml(rendered.lines), claimed.ticket_id), 200, EPSON_XML);
}

/* ------------------------------------------------------------------------ */
/* Entry                                                                      */
/* ------------------------------------------------------------------------ */

export async function handleCloudPrint(
  req: Request,
  backend: CloudPrintBackend,
  options: { now?: Date } = {},
): Promise<Response> {
  const url = new URL(req.url);
  const now = options.now ?? new Date();
  const token = pollToken(url);
  if (!token) return text('Missing printer token in the URL', 401);

  try {
    const type = req.headers.get('content-type') ?? '';
    if (req.method === 'POST') {
      return type.includes('application/x-www-form-urlencoded')
        ? await epson(req, token, backend, now)
        : await starPoll(req, token, backend);
    }
    if (req.method === 'DELETE') return await starConfirm(url, token, backend);
    if (req.method === 'GET') {
      if (url.searchParams.has('delete')) return await starConfirm(url, token, backend);
      return await starJob(url, token, backend, now);
    }
    return text('Method not allowed', 405);
  } catch (error) {
    return text(error instanceof Error ? error.message : 'error', 500);
  }
}
