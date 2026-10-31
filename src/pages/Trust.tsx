import React from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ShieldCheck, Lock, CreditCard, Database, Share2, UserCheck, FileText, Mail } from 'lucide-react';
import { staggerContainer, fadeUp } from '@/lib/motion';
import { useLanguageStore, useT, type Locale } from '@/lib/i18n';
import { usePageMeta } from '@/lib/seo/page-meta';
import { PRIVACY_PATH, privacyCopy, privacyGraph, type PrivacySection } from '@/lib/privacy';
import { HOME_VENUE } from '@/lib/home-venue';
import { VENUES } from '@/lib/venues';

const pick = (o: Record<Locale, string>, l: Locale) => o[l] ?? o.en;

/**
 * The privacy notice and ordering terms of the restaurant whose site this is
 * (src/lib/privacy.ts), in the guest's language. The build writes the
 * same words at the same address for crawlers that run no JavaScript.
 */
const VENUE = VENUES[HOME_VENUE];
const COPY = privacyCopy(VENUE);
const ICONS: Record<PrivacySection['key'], React.ElementType> = {
  protected: Lock, collect: Database, card: CreditCard, sharing: Share2, rights: UserCheck, terms: FileText, contact: Mail,
};

const Trust = () => {
  const t = useT();
  const navigate = useNavigate();
  const locale = useLanguageStore((s) => s.locale);
  usePageMeta({
    title: pick(COPY.title, locale), description: pick(COPY.intro, locale), path: PRIVACY_PATH, locale,
    jsonLd: privacyGraph(VENUE, locale),
  });

  return (
    <div className="min-h-screen bg-background pb-16" dir={locale === 'ar' ? 'rtl' : 'ltr'}>
      <div className="sticky top-0 z-30 glass">
        <div className="flex items-center gap-3 px-4 py-4">
          <button onClick={() => navigate(-1)} aria-label={t('back')} className="p-2.5 -ms-2 rounded-full hover:bg-muted transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center">
            <ArrowLeft className={`w-5 h-5 text-foreground ${locale === 'ar' ? 'rotate-180' : ''}`} />
          </button>
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-primary" />
            <h1 className="font-serif text-xl font-semibold text-foreground">{pick(COPY.heading, locale)}</h1>
          </div>
        </div>
        <div className="h-px bg-gradient-to-r from-transparent via-primary/20 to-transparent" />
      </div>

      <motion.div variants={staggerContainer()} initial="hidden" animate="show" className="px-4 pt-5 space-y-3 max-w-xl mx-auto">
        <motion.p variants={fadeUp} className="text-sm text-muted-foreground font-sans px-1 leading-relaxed">{pick(COPY.intro, locale)}</motion.p>

        {COPY.sections.map((sec) => {
          const Icon = ICONS[sec.key];
          return (
            <motion.div key={sec.key} variants={fadeUp} className="card-lux p-5">
              <div className="flex items-center gap-2.5 mb-2">
                <span className="w-9 h-9 rounded-xl bg-primary/10 grid place-items-center shrink-0"><Icon className="w-4 h-4 text-primary" /></span>
                <h2 className="font-serif text-lg font-semibold text-foreground">{pick(sec.title, locale)}</h2>
              </div>
              <div className="text-sm text-muted-foreground font-sans leading-relaxed space-y-2">
                {sec.body.map((p, j) => <p key={j}>{pick(p, locale)}</p>)}
              </div>
            </motion.div>
          );
        })}

        <motion.p variants={fadeUp} className="text-[11px] text-muted-foreground/70 font-sans text-center pt-2">
          {pick(COPY.footnote, locale)}
        </motion.p>
      </motion.div>
    </div>
  );
};

export default Trust;
