/**
 * The privacy notice and ordering terms at /privacy/, in the app's three
 * languages, for the restaurant whose site this is (src/lib/home-venue.ts):
 * La Soul's on lasoul.net, Vera Italia's on veraitalia.net — its name and
 * how to reach it, never the other's. The app shows it (src/pages/Trust.tsx);
 * the build writes the same words as plain HTML for crawlers that run no
 * JavaScript (scripts/seo-prerender.ts).
 *
 * Only the privacy page imports this, so only it downloads the words: the
 * pages every guest opens share src/lib/seo/static-pages.ts, and it does not.
 *
 * Relative imports only: the build imports this module outside the app.
 */
import type { Locale } from './i18n';
import { siteT } from './site-copy';
import { menuPath, type Venue } from './venues';
import { absoluteUrl } from './seo/site-url';
import { escapeHtml } from './seo/static-pages';
import { PRIVACY_PATH } from './seo/structured-data';

export { PRIVACY_PATH };

type L = Record<Locale, string>;

export interface PrivacySection {
  /** Which icon the app shows beside it. */
  key: 'protected' | 'collect' | 'card' | 'sharing' | 'rights' | 'terms' | 'contact';
  title: L;
  body: L[];
}

export interface PrivacyCopy {
  heading: L;
  /** "Trust, Privacy & Terms — La Soul": the page's title. */
  title: L;
  intro: L;
  sections: PrivacySection[];
  footnote: L;
}

export function privacyCopy(venue: Venue): PrivacyCopy {
  const name = venue.name;
  // Where to reach it, once the owner has given it (Vera Italia's has not
  // arrived). In Arabic the number is marked left-to-right, or it reads backwards.
  const reach = (phone: string) => [venue.address, venue.phone ? phone : ''].filter(Boolean).join(' · ');
  const en = reach(venue.phone);
  const ar = reach(`‎${venue.phone}`);
  const heading: L = { en: 'Trust, Privacy & Terms', bs: 'Povjerenje, privatnost i uslovi', ar: 'الثقة والخصوصية والشروط' };
  return {
    heading,
    title: { en: `${heading.en} — ${name}`, bs: `${heading.bs} — ${name}`, ar: `${heading.ar} — ${name}` },
    intro: {
      en: `${name} respects your privacy and the security of your order. This summary explains what we collect, how card payments work, your rights, and the terms of using this ordering service.`,
      bs: `${name} poštuje vašu privatnost i sigurnost vaše narudžbe. Ovaj sažetak objašnjava šta prikupljamo, kako funkcioniše plaćanje karticom, vaša prava i uslove korištenja ove usluge naručivanja.`,
      ar: `تحترم ${name} خصوصيتك وأمان طلبك. يوضّح هذا الملخّص ما نجمعه، وكيف تعمل مدفوعات البطاقة، وحقوقك، وشروط استخدام خدمة الطلب هذه.`,
    },
    sections: [
      {
        key: 'protected',
        title: { en: 'Your data is protected', bs: 'Vaši podaci su zaštićeni', ar: 'بياناتك محمية' },
        body: [{
          en: 'Ordering happens through a secure session tied to your table’s QR code. Each session is locked to your table, so only the people at your table and our staff can see your order.',
          bs: 'Naručivanje se odvija kroz sigurnu sesiju vezanu za QR kod vašeg stola. Svaka sesija je vezana samo za vaš sto, tako da vašu narudžbu vidite samo vi za stolom i naše osoblje.',
          ar: 'يتم الطلب عبر جلسة آمنة مرتبطة برمز QR الخاص بطاولتك. كل جلسة مقفلة على طاولتك، فلا يرى طلبك إلا من يجلس معك وطاقمنا.',
        }],
      },
      {
        key: 'collect',
        title: { en: 'What we collect', bs: 'Šta prikupljamo', ar: 'ما الذي نجمعه' },
        body: [{
          en: 'Only what’s needed to serve you: the items you order, an optional first name you choose, your table, and timing. We do not require an account, email address or phone number to order.',
          bs: 'Samo ono što je potrebno da vas uslužimo: stavke koje naručite, ime koje sami odaberete (nije obavezno), vaš sto i vrijeme. Za naručivanje nije potreban korisnički račun, e-mail ni broj telefona.',
          ar: 'فقط ما يلزم لخدمتك: الأصناف التي تطلبها، واسمٌ أول اختياري تختاره، وطاولتك، والوقت. لا نطلب حسابًا أو بريدًا إلكترونيًا أو رقم هاتف للطلب.',
        }],
      },
      {
        key: 'card',
        title: { en: 'Card payments are PCI-safe', bs: 'Plaćanje karticom je PCI-sigurno', ar: 'مدفوعات البطاقة آمنة وفق PCI' },
        body: [{
          en: 'When you pay by card, payment is processed by Monri, a certified payment provider. Your card details are entered in Monri’s secure hosted fields and are never stored on our servers or seen by the restaurant.',
          bs: 'Kada plaćate karticom, plaćanje obrađuje Monri, certificirani pružatelj platnih usluga. Podaci vaše kartice unose se u Monrijeva sigurna polja i nikada se ne pohranjuju na našim serverima niti ih vidi restoran.',
          ar: 'عند الدفع بالبطاقة، تتم معالجة الدفع عبر Monri، مزوّد دفع معتمد. تُدخل بيانات بطاقتك في حقول Monri الآمنة ولا تُخزَّن أبدًا على خوادمنا ولا يراها المطعم.',
        }],
      },
      {
        key: 'sharing',
        title: { en: 'Who we share with', bs: 'S kim dijelimo', ar: 'مع من نشارك' },
        body: [{
          en: 'We share data only with the providers that run the service: Supabase (secure hosting/database) and Monri (card payments). We never sell your data or use it for advertising.',
          bs: 'Podatke dijelimo samo s pružateljima koji pokreću uslugu: Supabase (sigurno hosting/baza) i Monri (plaćanje karticom). Nikada ne prodajemo vaše podatke niti ih koristimo za oglašavanje.',
          ar: 'نشارك البيانات فقط مع مزوّدي الخدمة: Supabase (استضافة/قاعدة بيانات آمنة) وMonri (مدفوعات البطاقة). لا نبيع بياناتك أبدًا ولا نستخدمها للإعلانات.',
        }],
      },
      {
        key: 'rights',
        title: { en: 'Your rights & retention', bs: 'Vaša prava i čuvanje', ar: 'حقوقك والاحتفاظ بالبيانات' },
        body: [{
          en: 'Order records are kept only as long as needed for service and legal/accounting obligations. You may ask the restaurant to access or delete your data; we’ll help promptly.',
          bs: 'Zapisi narudžbi čuvaju se samo onoliko koliko je potrebno za uslugu i zakonske/računovodstvene obaveze. Možete zatražiti od restorana pristup ili brisanje vaših podataka; rado ćemo pomoći.',
          ar: 'تُحفظ سجلات الطلبات فقط بالقدر اللازم للخدمة والالتزامات القانونية/المحاسبية. يمكنك أن تطلب من المطعم الوصول إلى بياناتك أو حذفها؛ وسنساعدك فورًا.',
        }],
      },
      {
        key: 'terms',
        title: { en: 'Ordering terms', bs: 'Uslovi naručivanja', ar: 'شروط الطلب' },
        body: [{
          en: 'Prices are shown in KM (BAM) and confirmed before you order. Orders are sent to the kitchen immediately and, once placed, cannot be cancelled or refunded through the app. Tips are optional. Any required fiscal receipt is issued by the restaurant.',
          bs: 'Cijene su prikazane u KM (BAM) i potvrđuju se prije narudžbe. Narudžbe se odmah šalju u kuhinju i, nakon slanja, ne mogu se otkazati niti refundirati putem aplikacije. Napojnica je opcionalna. Eventualni fiskalni račun izdaje restoran.',
          ar: 'تُعرض الأسعار بالـ KM (BAM) وتُؤكَّد قبل الطلب. تُرسل الطلبات إلى المطبخ فورًا، وبعد تقديمها لا يمكن إلغاؤها أو استردادها عبر التطبيق. البقشيش اختياري. يصدر المطعم أي إيصال ضريبي مطلوب.',
        }],
      },
      {
        key: 'contact',
        title: { en: 'Contact', bs: 'Kontakt', ar: 'اتصل بنا' },
        body: [{
          en: `For any privacy question or request, speak with the restaurant or contact ${name} directly${en ? ` (${en})` : ''}.`,
          bs: `Za svako pitanje ili zahtjev o privatnosti, obratite se restoranu ili kontaktirajte ${name}${en ? ` (${en})` : ''}.`,
          ar: `لأي سؤال أو طلب يخص الخصوصية، تحدّث مع المطعم أو تواصل مع ${name} مباشرة${ar ? ` (${ar})` : ''}.`,
        }],
      },
    ],
    footnote: {
      en: 'This summary may be updated. Ask staff for the full policy.',
      bs: 'Ovaj sažetak može se ažurirati. Pitajte osoblje za potpunu politiku.',
      ar: 'قد يُحدَّث هذا الملخّص. اطلب من الطاقم السياسة الكاملة.',
    },
  };
}

/** Its structured data: a page of the website this build is (/#website, La Soul's or Vera Italia's). */
export function privacyGraph(venue: Venue, locale: Locale) {
  const url = absoluteUrl(PRIVACY_PATH);
  return {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    '@id': `${url}#webpage`,
    url,
    name: privacyCopy(venue).title[locale],
    inLanguage: locale,
    isPartOf: { '@id': absoluteUrl('/#website') },
  };
}

/** The page as plain HTML, in English: the language its address is read in without the app. */
export function privacyBody(venue: Venue): string {
  const copy = privacyCopy(venue);
  const h = escapeHtml;
  return [
    `<header><nav><a href="/">${h(venue.name)}</a> · <a href="${menuPath(venue.slug)}">${h(siteT('nav_menu', 'en'))}</a></nav></header>`,
    `<main><h1>${h(copy.heading.en)}</h1>`,
    `<p>${h(copy.intro.en)}</p>`,
    ...copy.sections.map((s) => `<section><h2>${h(s.title.en)}</h2>${s.body.map((p) => `<p>${h(p.en)}</p>`).join('')}</section>`),
    `<p>${h(copy.footnote.en)}</p>`,
    `</main>`,
  ].join('\n');
}
