/**
 * @vitest-environment node
 *
 * The cloud-print endpoint, spoken to the way the printers speak to it.
 *
 * Star CloudPRNT and Epson Server Direct Print both poll; they differ in every
 * detail of how. These tests play each printer's side of the conversation
 * against a fake queue, so the protocol is pinned without a printer on the
 * desk — the SQL behind the fake is tested in supabase/tests/cloud-printers.
 */
import { describe, expect, it } from 'vitest';
import {
  handleCloudPrint, parseEpsonResponse, pollToken, STAR_STARPRNT,
  type CloudPrintBackend, type CloudPrinter, type ClaimedTicket,
} from '../../supabase/functions/_shared/cloud-print.ts';
import type { TicketOrder } from '../../supabase/functions/_shared/ticket-layout.ts';

const TOKEN = 'a'.repeat(40);
const BASE = `https://proj.supabase.co/functions/v1/cloudprnt/${TOKEN}`;
const NOW = new Date('2026-10-25T18:14:00.000Z');

const order: TicketOrder = {
  id: 'order-1', order_code: '047', table_number: 7,
  created_at: '2026-10-25T18:10:00.000Z', released_to_kitchen_at: '2026-10-25T18:12:00.000Z',
  notes: null, payment_method: 'cash', payment_status: 'unpaid', total: 36,
  items: [{ quantity: 2, menu_item_name: 'Ćevapi', notes: 'luk posebno', station: 'kitchen', allergens: ['gluten'] }],
};

function fakeQueue(over: Partial<CloudPrinter> = {}) {
  const calls: { fn: string; args: unknown[] }[] = [];
  let queued: string[] = ['ticket-1'];
  const printer: CloudPrinter = {
    id: 'p1', name: 'Kitchen printer', station: 'kitchen', paper_width: 80, plain_text: false,
    next_ticket_id: 'ticket-1', test_pending: false, ...over,
  };
  const backend: CloudPrintBackend = {
    async checkin(token, protocol, mac, status) {
      calls.push({ fn: 'checkin', args: [token, protocol, mac, status] });
      return token === TOKEN ? { ...printer, next_ticket_id: queued[0] ?? null } : null;
    },
    async claim(token, ticketId) {
      calls.push({ fn: 'claim', args: [token, ticketId] });
      const id = ticketId ?? queued[0];
      if (!id || !queued.includes(id)) return null;
      queued = queued.filter((q) => q !== id);
      const claimed: ClaimedTicket = {
        ticket_id: id, order_id: 'order-1', ticket_type: 'kitchen', original_printed_at: null,
        paper_width: printer.paper_width, plain_text: printer.plain_text,
      };
      return claimed;
    },
    async report(token, ticketId, ok, error) { calls.push({ fn: 'report', args: [token, ticketId, ok, error] }); return ticketId; },
    async testDone(token, ok, error) { calls.push({ fn: 'testDone', args: [token, ok, error] }); },
    async loadOrder() { return order; },
    async settings() { return { header: 'La Soul', footer: null }; },
  };
  return { backend, calls };
}

const star = {
  poll: (body: Record<string, unknown> = { statusCode: '200%20OK', printerMAC: '00:11:62:aa:bb:cc' }) =>
    new Request(BASE, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  get: (q: string) => new Request(`${BASE}?${q}`),
  del: (q: string) => new Request(`${BASE}?${q}`, { method: 'DELETE' }),
};

const epson = (fields: Record<string, string>) => new Request(BASE, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams(fields).toString(),
});

describe('who is asking', () => {
  it('reads the printer secret from the path, not the query', () => {
    // CloudPRNT appends its own `token=` (the JOB token) to every request.
    expect(pollToken(new URL(`${BASE}?token=job-1`))).toBe(TOKEN);
    expect(pollToken(new URL('https://x/functions/v1/cloudprnt?token=' + TOKEN))).toBeNull();
  });

  it('turns away a URL without a secret, and an unknown one', async () => {
    const { backend } = fakeQueue();
    expect((await handleCloudPrint(new Request('https://x/functions/v1/cloudprnt'), backend)).status).toBe(401);
    const wrong = new Request(`https://x/functions/v1/cloudprnt/${'z'.repeat(40)}`, { method: 'POST', body: '{}' });
    expect((await handleCloudPrint(wrong, backend)).status).toBe(404);
  });
});

describe('Star CloudPRNT', () => {
  it('poll: says a job is ready, in StarPRNT or text', async () => {
    const { backend, calls } = fakeQueue();
    const res = await handleCloudPrint(star.poll(), backend);
    expect(await res.json()).toEqual({
      jobReady: true, mediaTypes: [STAR_STARPRNT, 'text/plain'], jobToken: 'ticket-1', deleteMethod: 'DELETE',
    });
    // The status is stored decoded, so Admin shows "200 OK", not "200%20OK".
    expect(calls[0]).toEqual({ fn: 'checkin', args: [TOKEN, 'star_cloudprnt', '00:11:62:aa:bb:cc', '200 OK'] });
  });

  it('poll: nothing to do', async () => {
    const { backend } = fakeQueue();
    await handleCloudPrint(star.get('type=text/plain&token=ticket-1'), backend);
    expect(await (await handleCloudPrint(star.poll(), backend)).json()).toEqual({ jobReady: false });
  });

  it('poll: never stacks a job on a printer that is still printing', async () => {
    const { backend } = fakeQueue();
    const res = await handleCloudPrint(star.poll({ statusCode: '200%20OK', printingInProgress: true }), backend);
    expect(await res.json()).toEqual({ jobReady: false });
  });

  it('poll: plain-text mode offers only text', async () => {
    const { backend } = fakeQueue({ plain_text: true });
    expect((await (await handleCloudPrint(star.poll(), backend)).json()).mediaTypes).toEqual(['text/plain']);
  });

  it('job: StarPRNT bytes for the claimed ticket', async () => {
    const { backend, calls } = fakeQueue();
    const res = await handleCloudPrint(star.get(`type=${encodeURIComponent(STAR_STARPRNT)}&mac=x&token=ticket-1`), backend, { now: NOW });
    expect(res.headers.get('content-type')).toBe(STAR_STARPRNT);
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect([bytes[0], bytes[1]]).toEqual([0x1b, 0x40]);
    const ascii = new TextDecoder().decode(bytes);
    expect(ascii).toContain('TABLE 7');
    expect(ascii).toContain('Cevapi');
    expect(calls.find((c) => c.fn === 'claim')?.args).toEqual([TOKEN, 'ticket-1']);
  });

  it('job: text, folded to ASCII for the printer code page', async () => {
    const { backend } = fakeQueue();
    const res = await handleCloudPrint(star.get('type=text/plain&token=ticket-1'), backend, { now: NOW });
    const body = await res.text();
    // 18:12 UTC on 25 Oct 2026 — the night the clocks go back — is 19:12 in Sarajevo.
    expect(body).toContain('#047   19:12');
    expect(body).toContain('2 x Cevapi');
    expect(body).toContain('! luk posebno');
    expect(/[^\x20-\x7e\n]/.test(body)).toBe(false);
  });

  it('job: nothing left to claim is a 404, not an empty ticket', async () => {
    const { backend } = fakeQueue();
    await handleCloudPrint(star.get('type=text/plain&token=ticket-1'), backend);
    expect((await handleCloudPrint(star.get('type=text/plain&token=ticket-9'), backend)).status).toBe(404);
  });

  it('confirm: 200 OK is printed', async () => {
    const { backend, calls } = fakeQueue();
    await handleCloudPrint(star.del('code=200%20OK&token=ticket-1&mac=x'), backend);
    expect(calls.at(-1)).toEqual({ fn: 'report', args: [TOKEN, 'ticket-1', true, null] });
  });

  it('confirm: any code not starting with 2 is a failure, with the code', async () => {
    const { backend, calls } = fakeQueue();
    await handleCloudPrint(star.del('code=511%20Media%20Decoding%20Error&token=ticket-1'), backend);
    expect(calls.at(-1)).toEqual({
      fn: 'report', args: [TOKEN, 'ticket-1', false, 'The printer reported 511 Media Decoding Error'],
    });
  });

  it('confirm: also accepted as GET …&delete', async () => {
    const { backend, calls } = fakeQueue();
    await handleCloudPrint(star.get('delete&code=200%20OK&token=ticket-1'), backend);
    expect(calls.at(-1)?.fn).toBe('report');
  });

  it('test page: offered when a manager asked, printed, then reported as a test', async () => {
    const { backend, calls } = fakeQueue({ test_pending: true });
    expect((await (await handleCloudPrint(star.poll(), backend)).json()).jobToken).toBe('test');
    const page = await (await handleCloudPrint(star.get('type=text/plain&token=test'), backend, { now: NOW })).text();
    expect(page).toContain('TEST TICKET');
    await handleCloudPrint(star.del('code=200%20OK&token=test'), backend);
    expect(calls.at(-1)).toEqual({ fn: 'testDone', args: [TOKEN, true, null] });
  });
});

describe('Epson Server Direct Print', () => {
  it('GetRequest: an ePOS-Print job for the next ticket', async () => {
    const { backend, calls } = fakeQueue();
    const res = await handleCloudPrint(epson({ ConnectionType: 'GetRequest', ID: 'kitchen-1' }), backend, { now: NOW });
    expect(res.headers.get('content-type')).toContain('text/xml');
    const xml = await res.text();
    expect(xml).toContain('<PrintRequestInfo Version="2.00">');
    expect(xml).toContain('<devid>local_printer</devid>');
    expect(xml).toContain('<printjobid>ticket1</printjobid>');
    expect(xml).toContain('<epos-print xmlns="http://www.epson-pos.com/schemas/2011/03/epos-print">');
    expect(xml).toMatch(/reverse="true"[^>]*>[^<]*! luk posebno/);
    expect(calls[0]).toEqual({ fn: 'checkin', args: [TOKEN, 'epson_sdp', 'kitchen-1', null] });
  });

  it('GetRequest: nothing to print is an empty answer', async () => {
    const { backend } = fakeQueue();
    await handleCloudPrint(epson({ ConnectionType: 'GetRequest' }), backend);
    const res = await handleCloudPrint(epson({ ConnectionType: 'GetRequest' }), backend);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('');
  });

  it('SetResponse: success and failure reach the queue', async () => {
    const ok = '<PrintResponseInfo Version="2.00"><ePOSPrint><Parameter><devid>local_printer</devid><printjobid>ticket1</printjobid></Parameter><PrintResponse><response success="true" code="" status="251658262" battery="0"/></PrintResponse></ePOSPrint></PrintResponseInfo>';
    const { backend, calls } = fakeQueue();
    await handleCloudPrint(epson({ ConnectionType: 'SetResponse', ResponseFile: ok }), backend);
    expect(calls.find((c) => c.fn === 'report')?.args).toEqual([TOKEN, null, true, null]);

    const bad = ok.replace('success="true" code=""', 'success="false" code="EPTR_REC_EMPTY"');
    const second = fakeQueue();
    await handleCloudPrint(epson({ ConnectionType: 'SetResponse', ResponseFile: bad }), second.backend);
    expect(second.calls.find((c) => c.fn === 'report')?.args)
      .toEqual([TOKEN, null, false, 'The printer reported EPTR_REC_EMPTY']);
  });

  it('parses a response even with odd spacing and case', () => {
    expect(parseEpsonResponse('<response  code="EX_TIMEOUT" success="false"/>')).toEqual({ ok: false, code: 'EX_TIMEOUT', jobId: null });
  });
});
