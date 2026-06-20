import React from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ShieldCheck, Lock, CreditCard, Database, Share2, UserCheck, FileText, Mail } from 'lucide-react';
import { staggerContainer, fadeUp } from '@/lib/motion';
import { useLanguageStore, type Locale } from '@/lib/i18n';

type L = Record<Locale, string>;
const pick = (o: L, l: Locale) => o[l] ?? o.en;

const T: L = { en: 'Trust, Privacy & Terms', bs: 'Povjerenje, privatnost i uslovi', ar: 'الثقة والخصوصية والشروط' };
const INTRO: L = {
  en: 'La Soul respects your privacy and the security of your order. This summary explains what we collect, how card payments work, your rights, and the terms of using this ordering service.',
  bs: 'La Soul poštuje vašu privatnost i sigurnost vaše narudžbe. Ovaj sažetak objašnjava šta prikupljamo, kako funkcioniše plaćanje karticom, vaša prava i uslove korištenja ove usluge naručivanja.',
  ar: 'تحترم La Soul خصوصيتك وأمان طلبك. يوضّح هذا الملخّص ما نجمعه، وكيف تعمل مدفوعات البطاقة، وحقوقك، وشروط استخدام خدمة الطلب هذه.',
};

const SECTIONS: { icon: React.ElementType; title: L; body: L[] }[] = [
  {
    icon: Lock,
    title: { en: 'Your data is protected', bs: 'Vaši podaci su zaštićeni', ar: 'بياناتك محمية' },
    body: [{
      en: 'Ordering happens through a secure session tied to your table’s QR code. Each session is access-controlled and protected by row-level security, so only you and the restaurant’s staff can see your order.',
      bs: 'Naručivanje se odvija kroz sigurnu sesiju vezanu za QR kod vašeg stola. Svaka sesija je kontrolisanog pristupa i zaštićena sigurnošću na nivou reda, tako da samo vi i osoblje restorana vidite vašu narudžbu.',
      ar: 'يتم الطلب عبر جلسة آمنة مرتبطة برمز QR الخاص بطاولتك. كل جلسة محمية بالتحكم في الوصول وبأمان على مستوى الصفوف، بحيث لا يرى طلبك سواك وطاقم المطعم.',
    }],
  },
  {
    icon: Database,
    title: { en: 'What we collect', bs: 'Šta prikupljamo', ar: 'ما الذي نجمعه' },
    body: [{
      en: 'Only what’s needed to serve you: the items you order, an optional first name you choose, your table, and timing. We do not require an account, email address or phone number to order.',
      bs: 'Samo ono što je potrebno da vas uslužimo: stavke koje naručite, opcionalno ime koje odaberete, vaš sto i vrijeme. Za naručivanje nisu potrebni nalog, e-mail ni broj telefona.',
      ar: 'فقط ما يلزم لخدمتك: العناصر التي تطلبها، واسمٌ أول اختياري تختاره، وطاولتك، والوقت. لا نطلب حسابًا أو بريدًا إلكترونيًا أو رقم هاتف للطلب.',
    }],
  },
  {
    icon: CreditCard,
    title: { en: 'Card payments are PCI-safe', bs: 'Plaćanje karticom je PCI-sigurno', ar: 'مدفوعات البطاقة آمنة وفق PCI' },
    body: [{
      en: 'When you pay by card, payment is processed by Monri, a certified payment provider. Your card details are entered in Monri’s secure hosted fields and are never stored on our servers or seen by the restaurant.',
      bs: 'Kada plaćate karticom, plaćanje obrađuje Monri, certificirani pružatelj platnih usluga. Podaci vaše kartice unose se u Monrijeva sigurna polja i nikada se ne pohranjuju na našim serverima niti ih vidi restoran.',
      ar: 'عند الدفع بالبطاقة، تتم معالجة الدفع عبر Monri، مزوّد دفع معتمد. تُدخل بيانات بطاقتك في حقول Monri الآمنة ولا تُخزَّن أبدًا على خوادمنا ولا يراها المطعم.',
    }],
  },
  {
    icon: Share2,
    title: { en: 'Who we share with', bs: 'S kim dijelimo', ar: 'مع من نشارك' },
    body: [{
      en: 'We share data only with the providers that run the service: Supabase (secure hosting/database) and Monri (card payments). We never sell your data or use it for advertising.',
      bs: 'Podatke dijelimo samo s pružateljima koji pokreću uslugu: Supabase (sigurno hosting/baza) i Monri (plaćanje karticom). Nikada ne prodajemo vaše podatke niti ih koristimo za oglašavanje.',
      ar: 'نشارك البيانات فقط مع مزوّدي الخدمة: Supabase (استضافة/قاعدة بيانات آمنة) وMonri (مدفوعات البطاقة). لا نبيع بياناتك أبدًا ولا نستخدمها للإعلانات.',
    }],
  },
  {
    icon: UserCheck,
    title: { en: 'Your rights & retention', bs: 'Vaša prava i čuvanje', ar: 'حقوقك والاحتفاظ بالبيانات' },
    body: [{
      en: 'Order records are kept only as long as needed for service and legal/accounting obligations. You may ask the restaurant to access or delete your data; we’ll help promptly.',
      bs: 'Zapisi narudžbi čuvaju se samo onoliko koliko je potrebno za uslugu i zakonske/računovodstvene obaveze. Možete zatražiti od restorana pristup ili brisanje vaših podataka; rado ćemo pomoći.',
      ar: 'تُحفظ سجلات الطلبات فقط بالقدر اللازم للخدمة والالتزامات القانونية/المحاسبية. يمكنك أن تطلب من المطعم الوصول إلى بياناتك أو حذفها؛ وسنساعدك فورًا.',
    }],
  },
  {
    icon: FileText,
    title: { en: 'Ordering terms', bs: 'Uslovi naručivanja', ar: 'شروط الطلب' },
    body: [{
      en: 'Prices are shown in KM (BAM) and confirmed before you order. Orders are sent to the kitchen immediately and, once placed, cannot be cancelled or refunded through the app. Tips are optional. Any required fiscal receipt is issued by the restaurant.',
      bs: 'Cijene su prikazane u KM (BAM) i potvrđuju se prije narudžbe. Narudžbe se odmah šalju u kuhinju i, nakon slanja, ne mogu se otkazati niti refundirati putem aplikacije. Napojnica je opcionalna. Eventualni fiskalni račun izdaje restoran.',
      ar: 'تُعرض الأسعار بالـ KM (BAM) وتُؤكَّد قبل الطلب. تُرسل الطلبات إلى المطبخ فورًا، وبعد تقديمها لا يمكن إلغاؤها أو استردادها عبر التطبيق. البقشيش اختياري. يصدر المطعم أي إيصال ضريبي مطلوب.',
    }],
  },
  {
    icon: Mail,
    title: { en: 'Contact', bs: 'Kontakt', ar: 'اتصل بنا' },
    body: [{
      en: 'For any privacy question or request, speak with the restaurant or contact La Soul directly (Butmirska cesta 16A/16B · +387 33 877 779).',
      bs: 'Za svako pitanje ili zahtjev o privatnosti, obratite se restoranu ili kontaktirajte La Soul (Butmirska cesta 16A/16B · +387 33 877 779).',
      ar: 'لأي سؤال أو طلب يخص الخصوصية، تحدّث مع المطعم أو تواصل مع La Soul مباشرة (Butmirska cesta 16A/16B · ‎+387 33 877 779).',
    }],
  },
];

const Trust = () => {
  const navigate = useNavigate();
  const locale = useLanguageStore((s) => s.locale);

  return (
    <div className="min-h-screen bg-background pb-16" dir={locale === 'ar' ? 'rtl' : 'ltr'}>
      <div className="sticky top-0 z-30 glass">
        <div className="flex items-center gap-3 px-4 py-4">
          <button onClick={() => navigate(-1)} aria-label="Back" className="p-2.5 -ml-2 rounded-full hover:bg-muted transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center">
            <ArrowLeft className={`w-5 h-5 text-foreground ${locale === 'ar' ? 'rotate-180' : ''}`} />
          </button>
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-primary" />
            <h1 className="font-serif text-xl font-semibold text-foreground">{pick(T, locale)}</h1>
          </div>
        </div>
        <div className="h-px bg-gradient-to-r from-transparent via-primary/20 to-transparent" />
      </div>

      <motion.div variants={staggerContainer(0.05)} initial="hidden" animate="show" className="px-4 pt-5 space-y-3 max-w-xl mx-auto">
        <motion.p variants={fadeUp} className="text-sm text-muted-foreground font-sans px-1 leading-relaxed">{pick(INTRO, locale)}</motion.p>

        {SECTIONS.map((sec, i) => (
          <motion.div key={i} variants={fadeUp} className="card-lux p-5">
            <div className="flex items-center gap-2.5 mb-2">
              <span className="w-9 h-9 rounded-xl bg-primary/10 grid place-items-center shrink-0"><sec.icon className="w-4 h-4 text-primary" /></span>
              <h2 className="font-serif text-lg font-semibold text-foreground">{pick(sec.title, locale)}</h2>
            </div>
            <div className="text-sm text-muted-foreground font-sans leading-relaxed space-y-2">
              {sec.body.map((p, j) => <p key={j}>{pick(p, locale)}</p>)}
            </div>
          </motion.div>
        ))}

        <motion.p variants={fadeUp} className="text-[11px] text-muted-foreground/70 font-sans text-center pt-2">
          {locale === 'bs' ? 'Ovaj sažetak može se ažurirati. Pitajte osoblje za potpunu politiku.'
            : locale === 'ar' ? 'قد يُحدَّث هذا الملخّص. اطلب من الطاقم السياسة الكاملة.'
            : 'This summary may be updated. Ask staff for the full policy.'}
        </motion.p>
      </motion.div>
    </div>
  );
};

export default Trust;
