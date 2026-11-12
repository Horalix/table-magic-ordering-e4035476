// WhatsApp messages about a reservation, sent from the restaurant's own
// WhatsApp Business number through Meta's Cloud API (graph.facebook.com).
//
// A business may start a conversation only with a message Meta has approved
// beforehand (a "template": fixed words with numbered gaps). The six
// templates are defined here once, with their words in each language, and
// the same definitions are used to create them at Meta (the admin's "Set up
// the messages") and to send them, so the two can never disagree.
//
// Why WhatsApp and not a text: on 12 November 2026 a text to a Bosnian
// number through Twilio cost $0.51; a WhatsApp utility message costs a few
// cents at most, and guests answer it.
//
// Pure functions and two calls, both given `fetch`: unit-tested in
// src/lib/whatsapp.test.ts.

export const GRAPH = "https://graph.facebook.com/v23.0";

/** What is said, and to whom: four messages for the guest, two for the restaurant. */
export const MESSAGE_KINDS = [
  "guest_received", "guest_confirmed", "guest_declined", "guest_cancelled", "admin_new", "admin_cancelled",
] as const;
export type MessageKind = (typeof MESSAGE_KINDS)[number];

/** Meta has no Bosnian: its words are registered as Croatian, which a Bosnian reader reads as their own. */
export type TemplateLanguage = "en" | "hr" | "ar";
export const languageFor = (locale: string | null | undefined): TemplateLanguage =>
  locale === "bs" ? "hr" : locale === "ar" ? "ar" : "en";

interface TemplateWords {
  /** The approved words, with {{1}}, {{2}}… where the facts go. Never starts or ends with a gap. */
  text: string;
  /** What fills an optional gap when the restaurant wrote no line of its own: a gap is never empty. */
  fallback?: string;
}

export interface TemplateDef {
  name: string;
  /** What each gap holds, in order. */
  params: readonly string[];
  example: readonly string[];
  words: Partial<Record<TemplateLanguage, TemplateWords>>;
}

const EXAMPLE = { venue: "La Soul", day: "Saturday 14 November", time: "19:30", party: "4", code: "R48213", name: "Amina", phone: "+387 61 123 456" };

export const TEMPLATES: Record<MessageKind, TemplateDef> = {
  guest_received: {
    name: "reservation_received",
    params: ["venue", "day", "time", "party", "code"],
    example: [EXAMPLE.venue, EXAMPLE.day, EXAMPLE.time, EXAMPLE.party, EXAMPLE.code],
    words: {
      en: { text: "Thank you for asking for a table at {{1}}. Your request is for {{2}} at {{3}}, for {{4}} guests, reservation {{5}}. It is not confirmed yet: we will message you here as soon as the restaurant answers." },
      hr: { text: "Hvala što ste zatražili sto u {{1}}. Vaš zahtjev je za {{2}} u {{3}}, za {{4}} osoba, rezervacija {{5}}. Još nije potvrđen: javit ćemo vam se ovdje čim restoran odgovori." },
      ar: { text: "شكراً لطلبك طاولة في {{1}}. طلبك ليوم {{2}} الساعة {{3}}، لعدد {{4}} أشخاص، الحجز {{5}}. لم يتم تأكيده بعد: سنراسلك هنا فور رد المطعم." },
    },
  },
  guest_confirmed: {
    name: "reservation_confirmed",
    params: ["venue", "day", "time", "party", "code", "reply"],
    example: [EXAMPLE.venue, EXAMPLE.day, EXAMPLE.time, EXAMPLE.party, EXAMPLE.code, "By the window, as you asked."],
    words: {
      en: { text: "Good news: your table at {{1}} is confirmed for {{2}} at {{3}}, for {{4}} guests, reservation {{5}}. {{6}} We look forward to seeing you.", fallback: "Your table will be ready." },
      hr: { text: "Lijepa vijest: vaš sto u {{1}} je potvrđen za {{2}} u {{3}}, za {{4}} osoba, rezervacija {{5}}. {{6}} Radujemo se vašem dolasku.", fallback: "Vaš sto će biti spreman." },
      ar: { text: "خبر سار: تم تأكيد طاولتك في {{1}} ليوم {{2}} الساعة {{3}}، لعدد {{4}} أشخاص، الحجز {{5}}. {{6}} نتطلع إلى رؤيتك.", fallback: "طاولتك ستكون جاهزة." },
    },
  },
  guest_declined: {
    name: "reservation_declined",
    params: ["venue", "day", "time", "reply"],
    example: [EXAMPLE.venue, EXAMPLE.day, EXAMPLE.time, "We are full at 19:30, 21:00 is free."],
    words: {
      en: { text: "We are sorry: {{1}} cannot take your reservation for {{2}} at {{3}}. {{4}} You are welcome to ask for another time on our website or to call us.", fallback: "That time is no longer free." },
      hr: { text: "Žao nam je: {{1}} ne može primiti vašu rezervaciju za {{2}} u {{3}}. {{4}} Slobodno zatražite drugi termin na našoj stranici ili nas pozovite.", fallback: "Taj termin više nije slobodan." },
      ar: { text: "نعتذر: لا يستطيع {{1}} قبول حجزك ليوم {{2}} الساعة {{3}}. {{4}} يسعدنا أن تطلب موعداً آخر عبر موقعنا أو أن تتصل بنا.", fallback: "هذا الموعد لم يعد متاحاً." },
    },
  },
  guest_cancelled: {
    name: "reservation_cancelled",
    params: ["venue", "day", "time", "reply"],
    example: [EXAMPLE.venue, EXAMPLE.day, EXAMPLE.time, "A private event that evening."],
    words: {
      en: { text: "We are sorry: {{1}} had to cancel your reservation for {{2}} at {{3}}. {{4}} You are welcome to ask for another time on our website or to call us.", fallback: "We could not keep the table for that time." },
      hr: { text: "Žao nam je: {{1}} je morao otkazati vašu rezervaciju za {{2}} u {{3}}. {{4}} Slobodno zatražite drugi termin na našoj stranici ili nas pozovite.", fallback: "Nismo mogli zadržati sto za taj termin." },
      ar: { text: "نعتذر: اضطر {{1}} إلى إلغاء حجزك ليوم {{2}} الساعة {{3}}. {{4}} يسعدنا أن تطلب موعداً آخر عبر موقعنا أو أن تتصل بنا.", fallback: "لم نتمكن من الاحتفاظ بالطاولة في ذلك الموعد." },
    },
  },
  // The restaurant reads these in English, as it reads its admin.
  admin_new: {
    name: "reservation_new_request",
    params: ["venue", "day", "time", "party", "name", "phone"],
    example: [EXAMPLE.venue, EXAMPLE.day, EXAMPLE.time, EXAMPLE.party, EXAMPLE.name, EXAMPLE.phone],
    words: {
      en: { text: "New table request at {{1}}: {{2}} at {{3}}, {{4}} guests, name {{5}}, phone {{6}}. Open the admin to confirm or decline it." },
    },
  },
  admin_cancelled: {
    name: "reservation_given_back",
    params: ["venue", "day", "time", "party", "name"],
    example: [EXAMPLE.venue, EXAMPLE.day, EXAMPLE.time, EXAMPLE.party, EXAMPLE.name],
    words: {
      en: { text: "A guest gave back a confirmed table at {{1}}: {{2}} at {{3}}, {{4}} guests, name {{5}}. The table is free again." },
    },
  },
};

/** Every template Meta must have approved, one per kind and language. */
export const REQUIRED_TEMPLATES: { kind: MessageKind; name: string; language: TemplateLanguage }[] =
  MESSAGE_KINDS.flatMap((kind) => (Object.keys(TEMPLATES[kind].words) as TemplateLanguage[])
    .map((language) => ({ kind, name: TEMPLATES[kind].name, language })));

/** The language a kind is sent in: the guest's where it has their words, else English. */
export const languageOf = (kind: MessageKind, locale: string | null | undefined): TemplateLanguage => {
  const wanted = languageFor(locale);
  return TEMPLATES[kind].words[wanted] ? wanted : "en";
};

/**
 * A fact as Meta takes it in a gap: one line, no tabs, no runs of spaces, not
 * empty (it refuses all four), and no longer than a sentence or two.
 */
export function cleanParam(value: string | number | null | undefined, fallback = "-"): string {
  const text = String(value ?? "").replace(/[\r\n\t]+/g, " ").replace(/ {2,}/g, " ").trim().slice(0, 300);
  return text || fallback;
}

/** A sentence of the restaurant's own, ended as a sentence, so the words after it read on. */
const sentence = (line: string) => (/[.!?؟…]$/.test(line) ? line : `${line}.`);

export interface MessageFacts {
  venue: string; day: string; time: string; party: number; code: string;
  name?: string | null; phone?: string | null; reply?: string | null;
}

/** What fills a template's gaps, in order, in the language it is sent in. */
export function templateParams(kind: MessageKind, language: TemplateLanguage, facts: MessageFacts): string[] {
  const def = TEMPLATES[kind];
  const fallback = def.words[language]?.fallback ?? def.words.en?.fallback ?? "-";
  const reply = cleanParam(facts.reply, "");
  const value: Record<string, string> = {
    venue: cleanParam(facts.venue), day: cleanParam(facts.day), time: cleanParam(facts.time), party: cleanParam(facts.party),
    code: cleanParam(facts.code), name: cleanParam(facts.name), phone: cleanParam(facts.phone),
    reply: reply ? sentence(reply) : fallback,
  };
  return def.params.map((p) => value[p]);
}

/** The message as the guest will read it: for the admin's preview and the tests. */
export function renderTemplate(kind: MessageKind, language: TemplateLanguage, facts: MessageFacts): string {
  const params = templateParams(kind, language, facts);
  return (TEMPLATES[kind].words[language] ?? TEMPLATES[kind].words.en!).text.replace(/\{\{(\d+)\}\}/g, (_, n) => params[Number(n) - 1] ?? "");
}

/**
 * A number as WhatsApp wants it: digits only, with the country. A number
 * typed the local way ("061 123 456") is Bosnian: that is where the
 * restaurants are. Null when it cannot be a mobile number at all.
 */
export function whatsappNumber(phone: string | null | undefined, country = "387"): string | null {
  const raw = String(phone ?? "").trim();
  let digits = raw.replace(/\D/g, "");
  if (raw.startsWith("+")) { /* already with its country */ }
  else if (digits.startsWith("00")) digits = digits.slice(2);
  else if (digits.startsWith("0")) digits = country + digits.slice(1);
  return digits.length >= 8 && digits.length <= 15 ? digits : null;
}

export interface WhatsAppSender { token: string; phoneId: string }
export interface WhatsAppAccount { token: string; businessId: string }

/** Whether Meta took the message: its id there when it did, Meta's code and words when it did not. */
export interface SendResult { ok: boolean; id?: string; code?: number | null; error?: string }

const errorOf = (body: unknown, status: number): { code: number | null; error: string } => {
  const e = (body as { error?: { code?: number; message?: string; error_data?: { details?: string } } } | null)?.error;
  return { code: typeof e?.code === "number" ? e.code : null, error: e?.error_data?.details || e?.message || `Meta answered ${status}` };
};

/** Send one approved message. Never throws: the answer says whether Meta took it. */
export async function sendTemplate(
  sender: WhatsAppSender, to: string, kind: MessageKind, language: TemplateLanguage, params: string[], fetcher: typeof fetch = fetch,
): Promise<SendResult> {
  try {
    const res = await fetcher(`${GRAPH}/${sender.phoneId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${sender.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp", recipient_type: "individual", to, type: "template",
        template: {
          name: TEMPLATES[kind].name, language: { code: language },
          components: [{ type: "body", parameters: params.map((text) => ({ type: "text", text })) }],
        },
      }),
    });
    const body = await res.json().catch(() => null);
    const id = (body as { messages?: { id?: string }[] } | null)?.messages?.[0]?.id;
    return res.ok && id ? { ok: true, id } : { ok: false, ...errorOf(body, res.status) };
  } catch (error) {
    return { ok: false, code: null, error: error instanceof Error ? error.message : "Could not reach Meta" };
  }
}

export interface TemplateStatus { name: string; language: string; status: string }

/** The templates Meta has for this account, with where each stands (APPROVED, PENDING, REJECTED…). */
export async function listTemplates(account: WhatsAppAccount, fetcher: typeof fetch = fetch): Promise<TemplateStatus[]> {
  const res = await fetcher(`${GRAPH}/${account.businessId}/message_templates?fields=name,language,status&limit=250`, {
    headers: { Authorization: `Bearer ${account.token}` },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(errorOf(body, res.status).error);
  return (((body as { data?: unknown[] } | null)?.data ?? []) as Record<string, unknown>[])
    .map((t) => ({ name: String(t.name), language: String(t.language), status: String(t.status) }));
}

/** Where each required template stands at Meta: its status, or "MISSING". */
export function templateReport(existing: TemplateStatus[]): (TemplateStatus & { kind: MessageKind })[] {
  return REQUIRED_TEMPLATES.map(({ kind, name, language }) => ({
    kind, name, language,
    status: existing.find((t) => t.name === name && t.language === language)?.status ?? "MISSING",
  }));
}

/** What Meta is sent to create one template: its words, and an example for each gap (it asks for both). */
export function templateRequest(kind: MessageKind, language: TemplateLanguage) {
  const def = TEMPLATES[kind];
  return {
    // Letter for letter as Meta's own example writes them.
    name: def.name, language, category: "utility", parameter_format: "positional",
    components: [{ type: "body", text: def.words[language]!.text, example: { body_text: [[...def.example]] } }],
  };
}

/** Ask Meta to create one template. It reviews it, usually within minutes. */
export async function createTemplate(
  account: WhatsAppAccount, kind: MessageKind, language: TemplateLanguage, fetcher: typeof fetch = fetch,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetcher(`${GRAPH}/${account.businessId}/message_templates`, {
      method: "POST",
      headers: { Authorization: `Bearer ${account.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(templateRequest(kind, language)),
    });
    const body = await res.json().catch(() => null);
    return res.ok ? { ok: true } : { ok: false, error: errorOf(body, res.status).error };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not reach Meta" };
  }
}
