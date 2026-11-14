import type { Locale } from './i18n';
import type { Refusal, ReservationStatus } from './reservation-types';

/**
 * What the guest reads on /reserve and on their own reservation page, in
 * English, Bosnian and Arabic. `{name}` marks are filled by rcopy().
 *
 * Plain promises only: a request is a request until the restaurant answers
 * it, so nothing here says "booked" before then.
 */
const COPY = {
  title: { en: 'Reserve a table', bs: 'Rezervišite sto', ar: 'احجز طاولة' },
  intro: {
    en: 'Tell us when and for how many. We answer every request ourselves, usually within minutes.',
    bs: 'Recite nam kada i za koliko osoba. Na svaki zahtjev odgovaramo lično, obično za nekoliko minuta.',
    ar: 'أخبرنا بالموعد وعدد الأشخاص. نرد على كل طلب بأنفسنا، وغالباً خلال دقائق.',
  },
  day: { en: 'Day', bs: 'Dan', ar: 'اليوم' },
  today: { en: 'Today', bs: 'Danas', ar: 'اليوم' },
  tomorrow: { en: 'Tomorrow', bs: 'Sutra', ar: 'غداً' },
  time: { en: 'Time', bs: 'Vrijeme', ar: 'الوقت' },
  guests: { en: 'Guests', bs: 'Broj osoba', ar: 'عدد الأشخاص' },
  name: { en: 'Your name', bs: 'Vaše ime', ar: 'اسمك' },
  phone: { en: 'Phone number', bs: 'Broj telefona', ar: 'رقم الهاتف' },
  phone_hint: {
    en: 'With the country code if you are visiting, e.g. +965…',
    bs: 'S pozivnim brojem države ako ste u posjeti, npr. +965…',
    ar: 'مع رمز الدولة إن كنت زائراً، مثل ‎+965…',
  },
  note: { en: 'Anything we should know? (optional)', bs: 'Nešto što trebamo znati? (nije obavezno)', ar: 'هل هناك ما يجب أن نعرفه؟ (اختياري)' },
  note_placeholder: {
    en: 'A birthday, a high chair, by the window…',
    bs: 'Rođendan, stolica za bebu, pored prozora…',
    ar: 'عيد ميلاد، كرسي أطفال، بجانب النافذة…',
  },
  send: { en: 'Ask for this table', bs: 'Zatraži ovaj sto', ar: 'اطلب هذه الطاولة' },
  sending: { en: 'Sending…', bs: 'Šaljemo…', ar: 'جارٍ الإرسال…' },
  no_times: {
    en: 'No more times on this day. Pick another day.',
    bs: 'Za ovaj dan više nema termina. Izaberite drugi dan.',
    ar: 'لا توجد أوقات متاحة في هذا اليوم. اختر يوماً آخر.',
  },
  privacy: {
    en: 'We use your name and number only for this reservation.',
    bs: 'Vaše ime i broj koristimo samo za ovu rezervaciju.',
    ar: 'نستخدم اسمك ورقمك لهذا الحجز فقط.',
  },
  closed_title: { en: 'Online reservations are not open yet', bs: 'Online rezervacije još nisu otvorene', ar: 'الحجز عبر الإنترنت غير متاح بعد' },
  closed_body: { en: 'Call us and we will find you a table.', bs: 'Pozovite nas i naći ćemo vam sto.', ar: 'اتصل بنا وسنجد لك طاولة.' },
  closed_body_no_phone: { en: 'Please ask at the restaurant.', bs: 'Molimo pitajte u restoranu.', ar: 'يُرجى السؤال في المطعم.' },
  call: { en: 'Call {phone}', bs: 'Pozovite {phone}', ar: 'اتصل على {phone}' },
  existing: { en: 'You have a request with us. See it', bs: 'Imate zahtjev kod nas. Pogledajte ga', ar: 'لديك طلب عندنا. اعرضه' },
  back: { en: 'Back to {venue}', bs: 'Nazad na {venue}', ar: 'العودة إلى {venue}' },

  // Why a request was not taken.
  refused_name: { en: 'Please tell us your name.', bs: 'Molimo upišite svoje ime.', ar: 'من فضلك اكتب اسمك.' },
  refused_phone: {
    en: 'That does not look like a phone number. Add the country code if you are visiting.',
    bs: 'Ovo ne izgleda kao broj telefona. Ako ste u posjeti, dodajte pozivni broj države.',
    ar: 'هذا لا يبدو رقم هاتف. أضف رمز الدولة إن كنت زائراً.',
  },
  refused_party: { en: 'For a group this size, please call us.', bs: 'Za ovako veliku grupu, molimo pozovite nas.', ar: 'لمجموعة بهذا العدد، يُرجى الاتصال بنا.' },
  refused_hours: { en: 'We do not take reservations for that time.', bs: 'Za to vrijeme ne primamo rezervacije.', ar: 'لا نستقبل حجوزات في هذا الوقت.' },
  refused_soon: {
    en: 'That is too soon to reserve online. Please call us.',
    bs: 'To je prerano za online rezervaciju. Molimo pozovite nas.',
    ar: 'الموعد قريب جداً للحجز عبر الإنترنت. يُرجى الاتصال بنا.',
  },
  refused_far: {
    en: 'That is further ahead than we take reservations.',
    bs: 'To je dalje unaprijed nego što primamo rezervacije.',
    ar: 'هذا الموعد أبعد مما نستقبل له حجوزات.',
  },
  refused_repeat: {
    en: 'You already have requests with us. Wait for our answer, or call us.',
    bs: 'Već imate zahtjeve kod nas. Sačekajte naš odgovor ili nas pozovite.',
    ar: 'لديك طلبات سابقة عندنا. انتظر ردّنا أو اتصل بنا.',
  },
  refused_busy: {
    en: 'We are getting a lot of requests right now. Try again in a few minutes, or call us.',
    bs: 'Trenutno imamo mnogo zahtjeva. Pokušajte ponovo za nekoliko minuta ili nas pozovite.',
    ar: 'نستقبل طلبات كثيرة الآن. حاول بعد دقائق أو اتصل بنا.',
  },
  refused_unknown: {
    en: 'That did not go through. Check your connection and try again.',
    bs: 'Zahtjev nije poslan. Provjerite vezu i pokušajte ponovo.',
    ar: 'لم يُرسل الطلب. تحقق من الاتصال وحاول مرة أخرى.',
  },

  // The guest's own page.
  pending_title: { en: 'We have your request', bs: 'Primili smo vaš zahtjev', ar: 'استلمنا طلبك' },
  pending_body: {
    en: 'Keep this page open: our answer appears here the moment we give it.',
    bs: 'Ostavite ovu stranicu otvorenu: naš odgovor će se pojaviti ovdje čim ga damo.',
    ar: 'أبقِ هذه الصفحة مفتوحة: سيظهر ردّنا هنا فور إعطائه.',
  },
  pending_long: {
    en: 'Still waiting? Call us and mention {code}.',
    bs: 'Još čekate? Pozovite nas i recite {code}.',
    ar: 'ما زلت تنتظر؟ اتصل بنا واذكر {code}.',
  },
  confirmed_title: { en: 'Your table is confirmed', bs: 'Vaš sto je potvrđen', ar: 'تم تأكيد طاولتك' },
  confirmed_body: { en: 'We look forward to seeing you.', bs: 'Radujemo se vašem dolasku.', ar: 'ننتظر زيارتك.' },
  declined_title: { en: 'We cannot take this reservation', bs: 'Ovu rezervaciju ne možemo primiti', ar: 'لا نستطيع قبول هذا الحجز' },
  declined_body: {
    en: 'We are sorry. Try another time, or call us.',
    bs: 'Žao nam je. Pokušajte drugi termin ili nas pozovite.',
    ar: 'نعتذر. جرّب وقتاً آخر أو اتصل بنا.',
  },
  cancelled_guest_title: { en: 'You cancelled this reservation', bs: 'Otkazali ste ovu rezervaciju', ar: 'لقد ألغيت هذا الحجز' },
  cancelled_restaurant_title: { en: 'We had to cancel this reservation', bs: 'Morali smo otkazati ovu rezervaciju', ar: 'اضطررنا لإلغاء هذا الحجز' },
  cancelled_restaurant_body: { en: 'We are sorry. Please call us.', bs: 'Žao nam je. Molimo pozovite nas.', ar: 'نعتذر. يُرجى الاتصال بنا.' },
  expired_title: {
    en: 'This request was not answered in time',
    bs: 'Na ovaj zahtjev nije odgovoreno na vrijeme',
    ar: 'لم يُرد على هذا الطلب في الوقت المناسب',
  },
  expired_body: { en: 'We are sorry. Please call us.', bs: 'Žao nam je. Molimo pozovite nas.', ar: 'نعتذر. يُرجى الاتصال بنا.' },
  for_guests: { en: 'Guests: {count}', bs: 'Broj osoba: {count}', ar: 'عدد الأشخاص: {count}' },
  code: { en: 'Reservation {code}', bs: 'Rezervacija {code}', ar: 'الحجز {code}' },
  your_note: { en: 'Your note', bs: 'Vaša napomena', ar: 'ملاحظتك' },
  from_restaurant: { en: 'From the restaurant', bs: 'Poruka restorana', ar: 'رسالة من المطعم' },
  cancel: { en: 'Cancel my reservation', bs: 'Otkaži moju rezervaciju', ar: 'إلغاء حجزي' },
  cancel_confirm: { en: 'Cancel this reservation?', bs: 'Otkazati ovu rezervaciju?', ar: 'إلغاء هذا الحجز؟' },
  cancel_yes: { en: 'Yes, cancel it', bs: 'Da, otkaži', ar: 'نعم، ألغِه' },
  cancel_no: { en: 'Keep it', bs: 'Zadrži', ar: 'الإبقاء عليه' },
  another: { en: 'Ask for another table', bs: 'Zatraži drugi sto', ar: 'اطلب طاولة أخرى' },
  not_found_title: { en: 'We could not find this reservation', bs: 'Nismo pronašli ovu rezervaciju', ar: 'لم نجد هذا الحجز' },
  not_found_body: {
    en: 'The link may be incomplete. Ask again, or call us.',
    bs: 'Link je možda nepotpun. Pošaljite novi zahtjev ili nas pozovite.',
    ar: 'قد يكون الرابط ناقصاً. أرسل طلباً جديداً أو اتصل بنا.',
  },
  // What the page says below the form, and what search engines and answer
  // engines are told (src/lib/seo/reservations.ts): the same words.
  seo_title: { en: 'Reserve a table at {venue}, {city}', bs: 'Rezervišite sto u {venue}, {city}', ar: 'احجز طاولة في {venue}، {city}' },
  seo_description: {
    en: 'Ask for a table at {venue} online: pick a day, a time and the number of guests, and the restaurant confirms, usually within minutes.',
    bs: 'Zatražite sto u {venue} online: izaberite dan, vrijeme i broj osoba, a restoran potvrđuje, obično za nekoliko minuta.',
    ar: 'اطلب طاولة في {venue} عبر الإنترنت: اختر اليوم والوقت وعدد الأشخاص، والمطعم يؤكد، غالباً خلال دقائق.',
  },
  how_title: { en: 'How it works', bs: 'Kako funkcioniše', ar: 'كيف يتم الحجز' },
  how_1: {
    en: 'Pick a day and a time, and say how many of you are coming.',
    bs: 'Izaberite dan i vrijeme i recite koliko vas dolazi.',
    ar: 'اختر اليوم والوقت وعدد الأشخاص.',
  },
  how_2: {
    en: 'Leave your name and phone number, and send the request.',
    bs: 'Ostavite ime i broj telefona i pošaljite zahtjev.',
    ar: 'اترك اسمك ورقم هاتفك وأرسل الطلب.',
  },
  how_3: {
    en: 'The restaurant answers, usually within minutes. Your page shows the answer by itself.',
    bs: 'Restoran odgovara, obično za nekoliko minuta. Odgovor se sam pojavi na vašoj stranici.',
    ar: 'المطعم يرد، غالباً خلال دقائق. يظهر الرد على صفحتك تلقائياً.',
  },
  faq_title: { en: 'Questions', bs: 'Pitanja', ar: 'أسئلة' },
  faq_confirm_q: {
    en: 'Is my table reserved as soon as I send the request?',
    bs: 'Je li sto rezervisan čim pošaljem zahtjev?',
    ar: 'هل تُحجز الطاولة فور إرسال الطلب؟',
  },
  faq_confirm_a: {
    en: 'Not yet. It is a request until the restaurant confirms it. You see the answer on your page, usually within minutes.',
    bs: 'Još nije. To je zahtjev dok ga restoran ne potvrdi. Odgovor vidite na svojoj stranici, obično za nekoliko minuta.',
    ar: 'ليس بعد. يبقى طلباً حتى يؤكده المطعم. ترى الرد على صفحتك، غالباً خلال دقائق.',
  },
  faq_cancel_q: {
    en: 'Can I cancel or change my reservation?',
    bs: 'Mogu li otkazati ili promijeniti rezervaciju?',
    ar: 'هل يمكنني إلغاء الحجز أو تغييره؟',
  },
  faq_cancel_a: {
    en: 'Yes. Cancel from your reservation page at any time before the time you reserved. To change it, cancel and ask again, or contact the restaurant.',
    bs: 'Da. Otkažite na stranici svoje rezervacije bilo kada prije termina. Za promjenu otkažite i pošaljite novi zahtjev ili kontaktirajte restoran.',
    ar: 'نعم. ألغِ من صفحة حجزك في أي وقت قبل موعد الطاولة. وللتغيير، ألغِ وأرسل طلباً جديداً أو تواصل مع المطعم.',
  },
  faq_group_q: { en: 'Can I reserve for a large group?', bs: 'Mogu li rezervisati za veću grupu?', ar: 'هل يمكن الحجز لمجموعة كبيرة؟' },
  faq_group_a: {
    en: 'For a large group or a private event, contact the restaurant.',
    bs: 'Za veću grupu ili privatni događaj kontaktirajte restoran.',
    ar: 'لمجموعة كبيرة أو مناسبة خاصة، تواصل مع المطعم.',
  },
  faq_cost_q: { en: 'Does a reservation cost anything?', bs: 'Košta li rezervacija?', ar: 'هل الحجز بمقابل؟' },
  faq_cost_a: { en: 'No. Reserving a table is free.', bs: 'Ne. Rezervacija stola je besplatna.', ar: 'لا. حجز الطاولة مجاني.' },
  // Said under the phone number while the restaurant messages guests on WhatsApp (20261114090000_reservation_messages.sql).
  whatsapp_notice: {
    en: 'We will message you on WhatsApp when we have your request and when we answer.',
    bs: 'Javit ćemo vam se na WhatsApp kada primimo zahtjev i kada odgovorimo.',
    ar: 'سنراسلك على واتساب عند استلام طلبك وعند الرد عليه.',
  },
  // The booking page: the parts of the day, the facts under the title, what is being asked for.
  part_midday: { en: 'Midday', bs: 'Podne', ar: 'الظهيرة' },
  part_afternoon: { en: 'Afternoon', bs: 'Poslijepodne', ar: 'بعد الظهر' },
  part_evening: { en: 'Evening', bs: 'Večer', ar: 'المساء' },
  fact_hours: { en: 'Tables {open} to {close}', bs: 'Stolovi od {open} do {close}', ar: 'الطاولات من {open} إلى {close}' },
  fact_party: { en: 'Up to {count} guests', bs: 'Do {count} osoba', ar: 'حتى {count} أشخاص' },
  fact_free: { en: 'Free to reserve', bs: 'Rezervacija je besplatna', ar: 'الحجز مجاني' },
  summary: { en: 'You are asking for', bs: 'Tražite', ar: 'طلبك' },
  // The booking page is three short steps, one screen each: when, how many, who.
  step_when: { en: 'When would you like to come?', bs: 'Kada želite doći?', ar: 'متى تودّ المجيء؟' },
  step_party: { en: 'How many of you?', bs: 'Koliko vas dolazi?', ar: 'كم عددكم؟' },
  step_details: { en: 'Who is the table for?', bs: 'Na čije ime je sto?', ar: 'باسم من الطاولة؟' },
  step_of: { en: 'Step {n} of {total}', bs: 'Korak {n} od {total}', ar: 'الخطوة {n} من {total}' },
  step_back: { en: 'Back', bs: 'Nazad', ar: 'رجوع' },
  step_next: { en: 'Continue', bs: 'Nastavi', ar: 'متابعة' },
  days_earlier: { en: 'Earlier days', bs: 'Raniji dani', ar: 'أيام سابقة' },
  days_later: { en: 'Later days', bs: 'Kasniji dani', ar: 'أيام لاحقة' },
  pick_time: { en: 'Tap a time', bs: 'Izaberite vrijeme', ar: 'اختر الوقت' },
  more_guests: { en: 'More than {count} of you? Call us.', bs: 'Više od {count} osoba? Pozovite nas.', ar: 'أكثر من {count} أشخاص؟ اتصل بنا.' },
  add_note: { en: 'Add a note', bs: 'Dodaj napomenu', ar: 'أضف ملاحظة' },
  change: { en: 'Change', bs: 'Promijeni', ar: 'تغيير' },
  // The guest's own page: where the request stands, and what to keep once it is confirmed.
  step_sent: { en: 'Request sent', bs: 'Zahtjev poslan', ar: 'أُرسل الطلب' },
  step_answer: { en: 'The restaurant answers', bs: 'Restoran odgovara', ar: 'المطعم يرد' },
  step_confirmed: { en: 'Confirmed', bs: 'Potvrđeno', ar: 'تم التأكيد' },
  add_calendar: { en: 'Add to calendar', bs: 'Dodaj u kalendar', ar: 'أضف إلى التقويم' },
  directions: { en: 'Directions', bs: 'Kako do nas', ar: 'الاتجاهات' },
  calendar_title: { en: 'Table at {venue}', bs: 'Sto u {venue}', ar: 'طاولة في {venue}' },
  // What the restaurant sends a guest in a message of its own (src/lib/reservation-messages.ts).
  msg_confirmed: {
    en: '{venue}: your table is confirmed. {day} at {time}, guests: {party}. Reservation {code}.',
    bs: '{venue}: vaš sto je potvrđen. {day} u {time}, broj osoba: {party}. Rezervacija {code}.',
    ar: '{venue}: تم تأكيد طاولتك. {day} الساعة {time}، عدد الأشخاص: {party}. الحجز {code}.',
  },
  msg_declined: {
    en: '{venue}: we are sorry, we cannot take your reservation for {day} at {time}.',
    bs: '{venue}: žao nam je, ne možemo primiti vašu rezervaciju za {day} u {time}.',
    ar: '{venue}: نعتذر، لا يمكننا قبول حجزك يوم {day} الساعة {time}.',
  },
  msg_cancelled: {
    en: '{venue}: we are sorry, we had to cancel your reservation for {day} at {time}.',
    bs: '{venue}: žao nam je, morali smo otkazati vašu rezervaciju za {day} u {time}.',
    ar: '{venue}: نعتذر، اضطررنا لإلغاء حجزك يوم {day} الساعة {time}.',
  },
  msg_call: { en: 'Questions? Call {phone}.', bs: 'Pitanja? Pozovite {phone}.', ar: 'للاستفسار اتصل على {phone}.' },
  // The restaurant's own website, among its other questions.
  home_faq_q: { en: 'Can I reserve a table?', bs: 'Mogu li rezervisati sto?', ar: 'هل يمكنني حجز طاولة؟' },
  home_faq_a: {
    en: 'Yes. Ask for a table online at {url}: pick a day, a time and the number of guests, and we confirm, usually within minutes.',
    bs: 'Da. Zatražite sto online na {url}: izaberite dan, vrijeme i broj osoba, a mi potvrđujemo, obično za nekoliko minuta.',
    ar: 'نعم. اطلب طاولة عبر الإنترنت على {url}: اختر اليوم والوقت وعدد الأشخاص، ونحن نؤكد، غالباً خلال دقائق.',
  },
  offline: {
    en: 'No connection. This page updates by itself when it is back.',
    bs: 'Nema veze. Stranica će se sama osvježiti kad se vrati.',
    ar: 'لا يوجد اتصال. ستتحدّث الصفحة تلقائياً عند عودته.',
  },
} as const satisfies Record<string, Record<Locale, string>>;

export type ReservationCopyKey = keyof typeof COPY;

export const reservationCopyTable: Readonly<Record<ReservationCopyKey, Record<Locale, string>>> = COPY;

/** The words for `key` in `locale`, with `{marks}` filled in. */
export function rcopy(key: ReservationCopyKey, locale: Locale, vars: Record<string, string | number> = {}): string {
  const text = COPY[key][locale] ?? COPY[key].en;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole));
}

/** The message for a refusal. A time the page did not offer reads as "not at that time". */
export function refusalCopy(reason: Refusal, locale: Locale): string {
  const key: ReservationCopyKey = reason === 'time' ? 'refused_hours'
    : reason === 'disabled' ? 'closed_title'
    : (`refused_${reason}` as ReservationCopyKey);
  return rcopy(key in COPY ? key : 'refused_unknown', locale);
}

/** The heading of the guest's page for each state of their request. */
export function statusTitle(status: ReservationStatus, cancelledBy: 'guest' | 'restaurant' | null, locale: Locale): string {
  switch (status) {
    case 'confirmed': return rcopy('confirmed_title', locale);
    case 'declined': return rcopy('declined_title', locale);
    case 'cancelled': return rcopy(cancelledBy === 'restaurant' ? 'cancelled_restaurant_title' : 'cancelled_guest_title', locale);
    case 'expired': return rcopy('expired_title', locale);
    default: return rcopy('pending_title', locale);
  }
}
