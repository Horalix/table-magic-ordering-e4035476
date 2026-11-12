/**
 * @vitest-environment node
 *
 * WhatsApp messages about a reservation, end to end with an in-memory
 * database and a stand-in for Meta (supabase/functions/_shared/whatsapp.ts,
 * reservation-messages.ts): what each message says in each language, who is
 * sent what and when, that each goes once, that nothing is sent until a
 * restaurant has switched it on and connected its number, and that only that
 * restaurant's admins can set it up.
 */
import { describe, expect, it } from 'vitest';
import {
  GRAPH, MESSAGE_KINDS, REQUIRED_TEMPLATES, TEMPLATES, cleanParam, languageFor, languageOf, renderTemplate, templateParams, templateReport,
  templateRequest, whatsappNumber, type MessageKind,
} from '../../supabase/functions/_shared/whatsapp.ts';
import {
  FRESH_MS, handleReservationMessages, messagesDue, whenFor, type MessageReservation, type MessageSettings, type MessagesBackend,
  type MessagesDeps,
} from '../../supabase/functions/_shared/reservation-messages.ts';

const L = 'a5000000-0000-4000-8000-000000000001';
const V = 'a5000000-0000-4000-8000-000000000002';
const NOW = Date.parse('2026-11-13T09:00:00Z');
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const reservation = (over: Partial<MessageReservation> = {}): MessageReservation => ({
  id: id(1), venue_id: L, status: 'pending', code: 'R48213', guest_name: 'Amina Hadžić', guest_phone: '061 123-456', party_size: 4,
  reserved_for: '2026-11-14T18:30:00Z', locale: 'bs', reply: null, cancelled_by: null, decided_at: null, created_at: ago(0), updated_at: ago(0),
  ...over,
});
const settings = (over: Partial<MessageSettings> = {}): MessageSettings =>
  ({ venueSlug: 'lasoul', venueName: 'La Soul', guest: true, received: true, adminPhone: '+387 62 555 000', ...over });

const facts = { venue: 'La Soul', day: 'Saturday 14 November', time: '19:30', party: 4, code: 'R48213', name: 'Amina', phone: '+387 61 123 456' };

describe('the messages', () => {
  it('are six, each with its words in the languages it is sent in', () => {
    expect(MESSAGE_KINDS).toHaveLength(6);
    // Four for the guest in English, Bosnian (registered as Croatian) and Arabic; two for the restaurant in English.
    expect(REQUIRED_TEMPLATES).toHaveLength(4 * 3 + 2);
    for (const kind of MESSAGE_KINDS.filter((k) => k.startsWith('guest_'))) expect(Object.keys(TEMPLATES[kind].words).sort()).toEqual(['ar', 'en', 'hr']);
    expect(Object.keys(TEMPLATES.admin_new.words)).toEqual(['en']);
  });

  it('are words Meta accepts: no gap first or last, every gap numbered in order and given an example', () => {
    for (const { kind, language } of REQUIRED_TEMPLATES) {
      const { text } = TEMPLATES[kind].words[language]!;
      const gaps = [...text.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
      expect(gaps).toEqual(TEMPLATES[kind].params.map((_, i) => i + 1));
      expect(TEMPLATES[kind].example).toHaveLength(gaps.length);
      expect(text).not.toMatch(/^\{\{|\}\}$/);
      expect(text).not.toMatch(/[\n\t]| {2}/);
      expect(text.length).toBeLessThanOrEqual(1024);
      expect(TEMPLATES[kind].name).toMatch(/^[a-z0-9_]+$/);
    }
  });

  it('say the same thing a guest would be told by hand', () => {
    expect(renderTemplate('guest_received', 'en', facts)).toBe(
      'Thank you for asking for a table at La Soul. Your request is for Saturday 14 November at 19:30, for 4 guests, reservation R48213. It is not confirmed yet: we will message you here as soon as the restaurant answers.');
    expect(renderTemplate('guest_confirmed', 'en', { ...facts, reply: 'By the window' })).toBe(
      'Good news: your table at La Soul is confirmed for Saturday 14 November at 19:30, for 4 guests, reservation R48213. By the window. We look forward to seeing you.');
    expect(renderTemplate('admin_new', 'en', facts)).toBe(
      'New table request at La Soul: Saturday 14 November at 19:30, 4 guests, name Amina, phone +387 61 123 456. Open the admin to confirm or decline it.');
  });

  it('a gap is never empty: without the restaurant’s own line a declined guest is still told why', () => {
    expect(templateParams('guest_declined', 'en', facts)).toEqual(['La Soul', 'Saturday 14 November', '19:30', 'That time is no longer free.']);
    expect(templateParams('guest_declined', 'hr', { ...facts, reply: '  ' })[3]).toBe('Taj termin više nije slobodan.');
    expect(templateParams('guest_confirmed', 'ar', facts)[5]).toBe('طاولتك ستكون جاهزة.');
    // What Meta refuses in a gap: a new line, a tab, a run of spaces.
    expect(cleanParam('Full  at 19:30,\n21:00\tis free')).toBe('Full at 19:30, 21:00 is free');
    expect(cleanParam('', 'x')).toBe('x');
  });

  it('are in the guest’s language: Bosnian as Croatian, which Meta has, and the restaurant’s in English', () => {
    expect(languageFor('bs')).toBe('hr');
    expect(languageFor('ar')).toBe('ar');
    expect(languageFor('en')).toBe('en');
    expect(languageFor(null)).toBe('en');
    expect(languageOf('admin_new', 'bs')).toBe('en');
    expect(renderTemplate('guest_confirmed', 'hr', facts)).toContain('vaš sto u La Soul je potvrđen');
  });

  it('are created at Meta exactly as they are sent', () => {
    expect(templateRequest('guest_declined', 'hr')).toEqual({
      name: 'reservation_declined', language: 'hr', category: 'utility', parameter_format: 'positional',
      components: [{ type: 'body', text: TEMPLATES.guest_declined.words.hr!.text, example: { body_text: [[...TEMPLATES.guest_declined.example]] } }],
    });
    const report = templateReport([{ name: 'reservation_received', language: 'en', status: 'APPROVED' }, { name: 'other', language: 'en', status: 'APPROVED' }]);
    expect(report).toHaveLength(14);
    expect(report.filter((t) => t.status === 'APPROVED')).toEqual([{ kind: 'guest_received', name: 'reservation_received', language: 'en', status: 'APPROVED' }]);
    expect(report.filter((t) => t.status === 'MISSING')).toHaveLength(13);
  });
});

describe('a number as WhatsApp wants it', () => {
  it('takes it however a guest typed it; a number typed the local way is Bosnian', () => {
    expect(whatsappNumber('+387 61 123-456')).toBe('38761123456');
    expect(whatsappNumber('00387 61 123 456')).toBe('38761123456');
    expect(whatsappNumber('061 123 456')).toBe('38761123456');
    expect(whatsappNumber('+965 5000 1234')).toBe('96550001234');
    expect(whatsappNumber('38761123456')).toBe('38761123456');
  });

  it('is nothing when it cannot be a number', () => {
    for (const bad of ['', null, '12345', '+1', '0'.repeat(20)]) expect(whatsappNumber(bad)).toBeNull();
  });
});

describe('who is due what', () => {
  it('a new request: the guest is told it arrived, and the restaurant that it did', () => {
    expect(messagesDue(reservation(), settings(), NOW)).toEqual([{ kind: 'guest_received', to: 'guest' }, { kind: 'admin_new', to: 'admin' }]);
  });

  it('each restaurant chooses: guests only, the restaurant’s number only, or neither', () => {
    expect(messagesDue(reservation(), settings({ adminPhone: null }), NOW)).toEqual([{ kind: 'guest_received', to: 'guest' }]);
    expect(messagesDue(reservation(), settings({ guest: false }), NOW)).toEqual([{ kind: 'admin_new', to: 'admin' }]);
    expect(messagesDue(reservation(), settings({ guest: false, adminPhone: null }), NOW)).toEqual([]);
  });

  it('a restaurant may send the answer only: then the guest is not told the request arrived, and the restaurant still is', () => {
    expect(messagesDue(reservation(), settings({ received: false }), NOW)).toEqual([{ kind: 'admin_new', to: 'admin' }]);
    const confirmed = reservation({ status: 'confirmed', created_at: ago(120), decided_at: ago(1), updated_at: ago(1) });
    expect(messagesDue(confirmed, settings({ received: false }), NOW)).toEqual([{ kind: 'guest_confirmed', to: 'guest' }]);
    // The choice means nothing while guests are not messaged at all.
    expect(messagesDue(reservation(), settings({ guest: false, received: true, adminPhone: null }), NOW)).toEqual([]);
  });

  it('an answer goes to the guest: confirmed, declined, or cancelled by the restaurant', () => {
    const answered = (status: string, over: Partial<MessageReservation> = {}) =>
      messagesDue(reservation({ status, created_at: ago(120), decided_at: ago(1), updated_at: ago(1), ...over }), settings(), NOW).map((d) => d.kind);
    expect(answered('confirmed')).toEqual(['guest_confirmed']);
    expect(answered('declined')).toEqual(['guest_declined']);
    expect(answered('cancelled', { cancelled_by: 'restaurant' })).toEqual(['guest_cancelled']);
  });

  it('a table the guest gives back is news to the restaurant only once it had been confirmed', () => {
    const givenBack = (decided_at: string | null) =>
      messagesDue(reservation({ status: 'cancelled', cancelled_by: 'guest', created_at: ago(300), decided_at, updated_at: ago(1) }), settings(), NOW);
    expect(givenBack(ago(200))).toEqual([{ kind: 'admin_cancelled', to: 'admin' }]);
    expect(givenBack(null)).toEqual([]);
  });

  it('old news is not sent, and a request nobody answered in time is not messaged', () => {
    const old = FRESH_MS / 60_000 + 5;
    expect(messagesDue(reservation({ created_at: ago(old) }), settings(), NOW)).toEqual([]);
    expect(messagesDue(reservation({ status: 'confirmed', decided_at: ago(old), updated_at: ago(old) }), settings(), NOW)).toEqual([]);
    expect(messagesDue(reservation({ status: 'expired', updated_at: ago(1) }), settings(), NOW)).toEqual([]);
  });

  it('the day and time are the restaurant’s own, in the language of the message', () => {
    expect(whenFor('2026-11-14T18:30:00Z', 'en')).toEqual({ day: 'Saturday 14 November', time: '19:30' });
    expect(whenFor('2026-07-04T17:00:00Z', 'en').time).toBe('19:00');
    expect(whenFor('2026-11-14T18:30:00Z', 'hr').day).not.toMatch(/M\d\d/);
    expect(whenFor('2026-11-14T18:30:00Z', 'ar').day).toMatch(/14/);
  });
});

// ---------------------------------------------------------------------
// The function, with an in-memory database and a stand-in for Meta
// ---------------------------------------------------------------------

interface Sent { url: string; token: string; body: Record<string, unknown> }

function world(over: { secrets?: Partial<MessagesDeps['whatsapp']>; settings?: Partial<MessageSettings>; refuse?: { code: number; message: string } } = {}) {
  const rows: Record<string, MessageReservation> = { [id(1)]: reservation() };
  const venues: Record<string, MessageSettings> = {
    [L]: settings(over.settings),
    [V]: settings({ venueSlug: 'veraitalia', venueName: 'Vera Italia', guest: false, adminPhone: null }),
  };
  const messages: { reservation: string; kind: MessageKind; status: string; detail: string | null }[] = [];
  const sent: Sent[] = [];
  const created: Record<string, unknown>[] = [];
  let atMeta: { name: string; language: string; status: string }[] = [];
  const backend: MessagesBackend = {
    loadReservation: async (rid) => rows[rid] ?? null,
    loadSettings: async (venueId) => venues[venueId] ?? null,
    claim: async (rid, _venue, kind) => {
      if (messages.some((m) => m.reservation === rid && m.kind === kind)) return false;
      messages.push({ reservation: rid, kind, status: 'sending', detail: null });
      return true;
    },
    record: async (rid, kind, status, detail) => {
      Object.assign(messages.find((m) => m.reservation === rid && m.kind === kind)!, { status, detail });
    },
    userOf: async (token) => ({ 'jwt-sanela': 'u-sanela', 'jwt-marco': 'u-marco', 'jwt-owner': 'u-owner' }[token] ?? null),
    // Sanela is La Soul's admin, Marco Vera Italia's, and the owner has both.
    venueFor: async (userId, slug) => {
      const allowed = { 'u-sanela': ['lasoul'], 'u-marco': ['veraitalia'], 'u-owner': ['lasoul', 'veraitalia'] }[userId] ?? [];
      return allowed.includes(slug) ? { id: slug === 'lasoul' ? L : V, slug, name: slug === 'lasoul' ? 'La Soul' : 'Vera Italia' } : null;
    },
  };
  const fetcher = (async (url: string, init: RequestInit = {}) => {
    const token = String((init.headers as Record<string, string>)?.Authorization ?? '').replace('Bearer ', '');
    const body = init.body ? JSON.parse(init.body as string) : {};
    const answer = (payload: unknown, status = 200) => ({ ok: status < 300, status, json: async () => payload }) as Response;
    if (url.endsWith('/messages')) {
      sent.push({ url, token, body });
      return over.refuse ? answer({ error: over.refuse }, 400) : answer({ messages: [{ id: `wamid.${sent.length}` }] });
    }
    if (init.method === 'POST') {
      created.push(body);
      atMeta = [...atMeta, { name: body.name, language: body.language, status: 'PENDING' }];
      return answer({ id: '1', status: 'PENDING' });
    }
    return answer({ data: atMeta });
  }) as unknown as typeof fetch;
  const deps: MessagesDeps = {
    backend, fetcher,
    whatsapp: { token: 'meta-token', businessId: 'waba-1', phoneIds: { lasoul: 'phone-l', veraitalia: '' }, ...over.secrets },
  };
  const call = (body: unknown, authorization?: string) => handleReservationMessages(new Request('https://x/functions/v1/reservation-messages', {
    method: 'POST', headers: authorization ? { Authorization: authorization } : {}, body: JSON.stringify(body),
  }), deps, NOW);
  return { rows, venues, messages, sent, created, deps, call, approveAll: () => { atMeta = atMeta.map((t) => ({ ...t, status: 'APPROVED' })); } };
}

const gaps = (s: Sent) => ((s.body.template as { components: { parameters: { text: string }[] }[] }).components[0].parameters).map((p) => p.text);
const template = (s: Sent) => s.body.template as { name: string; language: { code: string } };

describe('when a guest asks for a table', () => {
  it('the guest is told in their language and the restaurant in English, each from the restaurant’s own number', async () => {
    const w = world();
    const reply = await w.call({ id: id(1) });
    expect(reply).toEqual({ status: 200, body: { messages: [{ kind: 'guest_received', result: 'sent' }, { kind: 'admin_new', result: 'sent' }] } });

    const [guest, restaurant] = w.sent;
    expect(guest.url).toBe(`${GRAPH}/phone-l/messages`);
    expect(guest.token).toBe('meta-token');
    expect(guest.body).toMatchObject({ messaging_product: 'whatsapp', to: '38761123456', type: 'template' });
    expect(template(guest)).toMatchObject({ name: 'reservation_received', language: { code: 'hr' } });
    expect(gaps(guest).slice(0, 1)).toEqual(['La Soul']);
    expect(gaps(guest).slice(2)).toEqual(['19:30', '4', 'R48213']);

    expect(restaurant.body.to).toBe('38762555000');
    expect(template(restaurant)).toMatchObject({ name: 'reservation_new_request', language: { code: 'en' } });
    expect(gaps(restaurant)).toEqual(['La Soul', 'Saturday 14 November', '19:30', '4', 'Amina Hadžić', '061 123-456']);
    expect(w.messages.map((m) => [m.kind, m.status, m.detail])).toEqual([['guest_received', 'sent', 'wamid.1'], ['admin_new', 'sent', 'wamid.2']]);
  });

  it('each message goes once, however often the call is made', async () => {
    const w = world();
    await w.call({ id: id(1) });
    const again = await w.call({ id: id(1) });
    expect(again.body).toEqual({ messages: [{ kind: 'guest_received', result: 'already_sent' }, { kind: 'admin_new', result: 'already_sent' }] });
    expect(w.sent).toHaveLength(2);
  });

  it('then the answer: confirmed, with the restaurant’s own line', async () => {
    const w = world();
    await w.call({ id: id(1) });
    w.rows[id(1)] = reservation({ status: 'confirmed', reply: 'Uz prozor', decided_at: ago(0), updated_at: ago(0), created_at: ago(10) });
    expect((await w.call({ id: id(1) })).body).toEqual({ messages: [{ kind: 'guest_confirmed', result: 'sent' }] });
    expect(template(w.sent[2]).name).toBe('reservation_confirmed');
    expect(gaps(w.sent[2])[5]).toBe('Uz prozor.');
  });
});

describe('nothing is sent', () => {
  it('for a restaurant that has messages off', async () => {
    const w = world({ settings: { guest: false, adminPhone: null } });
    expect(await w.call({ id: id(1) })).toEqual({ status: 200, body: { skipped: 'off' } });
    expect(w.sent).toEqual([]);
    expect(w.messages).toEqual([]);
  });

  it('until the account is connected and the restaurant has a number of its own', async () => {
    for (const secrets of [{ token: '' }, { phoneIds: { lasoul: '', veraitalia: '' } }]) {
      const w = world({ secrets });
      expect(await w.call({ id: id(1) })).toEqual({ status: 200, body: { skipped: 'not_configured' } });
      expect(w.sent).toEqual([]);
    }
  });

  it('for a reservation that does not exist, or a call that names none', async () => {
    const w = world();
    expect(await w.call({ id: id(99) })).toEqual({ status: 404, body: { skipped: 'not_found' } });
    expect((await w.call({ id: 'x' })).status).toBe(400);
    expect((await w.call({})).status).toBe(400);
    expect(w.sent).toEqual([]);
  });

  it('to a number that cannot be one; the admin sees that it did not go', async () => {
    const w = world();
    w.rows[id(1)] = reservation({ guest_phone: '12345' });
    expect((await w.call({ id: id(1) })).body).toEqual({ messages: [{ kind: 'guest_received', result: 'no_number' }, { kind: 'admin_new', result: 'sent' }] });
    expect(w.messages[0]).toMatchObject({ kind: 'guest_received', status: 'failed', detail: 'Not a mobile number' });
  });

  it('and what Meta refuses is kept in words, not sent again', async () => {
    const w = world({ refuse: { code: 132001, message: 'Template name does not exist in the translation' } });
    expect((await w.call({ id: id(1) })).body).toEqual({ messages: [{ kind: 'guest_received', result: 'failed' }, { kind: 'admin_new', result: 'failed' }] });
    expect(w.messages[0]).toMatchObject({ status: 'failed', detail: '132001 Template name does not exist in the translation' });
    await w.call({ id: id(1) });
    expect(w.sent).toHaveLength(2);
  });
});

describe('an admin sets it up', () => {
  it('only signed in, and only for their own restaurant', async () => {
    const w = world();
    expect((await w.call({ action: 'status', venue: 'lasoul' })).status).toBe(401);
    expect((await w.call({ action: 'status', venue: 'lasoul' }, 'Bearer nobody')).status).toBe(401);
    expect((await w.call({ action: 'status', venue: 'lasoul' }, 'Bearer jwt-marco')).status).toBe(403);
    expect((await w.call({ action: 'setup', venue: 'veraitalia' }, 'Bearer jwt-sanela')).status).toBe(403);
    expect((await w.call({ action: 'status', venue: 'lasoul' }, 'Bearer jwt-owner')).status).toBe(200);
    expect(w.created).toEqual([]);
  });

  it('sees where it stands: connected or not, the number, and each message at Meta', async () => {
    const w = world();
    const status = (await w.call({ action: 'status', venue: 'lasoul' }, 'Bearer jwt-sanela')).body as { configured: boolean; number: boolean; ready: boolean; templates: unknown[] };
    expect(status).toMatchObject({ configured: true, number: true, ready: false });
    expect(status.templates).toHaveLength(14);
    // Vera Italia has no number of its own yet.
    expect((await w.call({ action: 'status', venue: 'veraitalia' }, 'Bearer jwt-marco')).body).toMatchObject({ configured: true, number: false, ready: false });
    expect((await world({ secrets: { token: '' } }).call({ action: 'status', venue: 'lasoul' }, 'Bearer jwt-sanela')).body)
      .toEqual({ configured: false, number: true, templates: [], ready: false });
  });

  it('"Set up the messages" creates every message at Meta once, and it is ready when Meta has approved them all', async () => {
    const w = world();
    const first = (await w.call({ action: 'setup', venue: 'lasoul' }, 'Bearer jwt-sanela')).body as { ready: boolean; refused: unknown[]; templates: { status: string }[] };
    expect(w.created).toHaveLength(14);
    expect(w.created[0]).toMatchObject({ name: 'reservation_received', category: 'utility' });
    expect(first.refused).toEqual([]);
    expect(first.templates.every((t) => t.status === 'PENDING')).toBe(true);
    expect(first.ready).toBe(false);
    // Asked again, nothing is created twice.
    await w.call({ action: 'setup', venue: 'lasoul' }, 'Bearer jwt-sanela');
    expect(w.created).toHaveLength(14);
    w.approveAll();
    expect((await w.call({ action: 'status', venue: 'lasoul' }, 'Bearer jwt-sanela')).body).toMatchObject({ ready: true });
  });

  it('a test is the message the restaurant gets for a new request, to a number the admin names', async () => {
    const w = world();
    expect(await w.call({ action: 'test', venue: 'lasoul', to: '062 555 000' }, 'Bearer jwt-sanela')).toEqual({ status: 200, body: { sent: true } });
    expect(w.sent[0].body.to).toBe('38762555000');
    expect(template(w.sent[0]).name).toBe('reservation_new_request');
    expect((await w.call({ action: 'test', venue: 'lasoul', to: 'x' }, 'Bearer jwt-sanela')).status).toBe(400);
    expect((await w.call({ action: 'test', venue: 'veraitalia', to: '062 555 000' }, 'Bearer jwt-marco')).status).toBe(409);
  });

  it('anyone may ask whether it is connected at all, and is told nothing of the secrets', async () => {
    const reply = await handleReservationMessages(new Request('https://x/', { method: 'GET' }), world().deps, NOW);
    expect(reply).toEqual({ status: 200, body: { configured: true, templates: 14 } });
    expect(JSON.stringify(reply)).not.toContain('meta-token');
  });
});
