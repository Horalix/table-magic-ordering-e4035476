import React from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ShieldCheck, Lock, CreditCard, Database, Mail } from 'lucide-react';
import { staggerContainer, fadeUp } from '@/lib/motion';
import { useLanguageStore } from '@/lib/i18n';

const Section = ({ icon: Icon, title, children }: { icon: React.ElementType; title: string; children: React.ReactNode }) => (
  <motion.div variants={fadeUp} className="card-lux p-5">
    <div className="flex items-center gap-2.5 mb-2">
      <span className="w-9 h-9 rounded-xl bg-primary/10 grid place-items-center shrink-0">
        <Icon className="w-4 h-4 text-primary" />
      </span>
      <h2 className="font-serif text-lg font-semibold text-foreground">{title}</h2>
    </div>
    <div className="text-sm text-muted-foreground font-sans leading-relaxed space-y-2">{children}</div>
  </motion.div>
);

/** Customer-facing trust / privacy & security statement. */
const Trust = () => {
  const navigate = useNavigate();
  const locale = useLanguageStore((s) => s.locale);

  return (
    <div className="min-h-screen bg-background pb-16">
      <div className="sticky top-0 z-30 glass">
        <div className="flex items-center gap-3 px-4 py-4">
          <button onClick={() => navigate(-1)} aria-label="Back" className="p-2.5 -ml-2 rounded-full hover:bg-muted transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center">
            <ArrowLeft className={`w-5 h-5 text-foreground ${locale === 'ar' ? 'rotate-180' : ''}`} />
          </button>
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-primary" />
            <h1 className="font-serif text-xl font-semibold text-foreground">Trust & Privacy</h1>
          </div>
        </div>
        <div className="h-px bg-gradient-to-r from-transparent via-primary/20 to-transparent" />
      </div>

      <motion.div variants={staggerContainer(0.06)} initial="hidden" animate="show" className="px-4 pt-5 space-y-3 max-w-xl mx-auto">
        <motion.p variants={fadeUp} className="text-sm text-muted-foreground font-sans px-1">
          La Soul takes your privacy and the security of your order seriously. Here's how we handle your information.
        </motion.p>

        <Section icon={Lock} title="Your data is protected">
          <p>Ordering happens through a secure session tied to your table's QR code. Each session is access-controlled, and order data is protected by row-level security so only you and the restaurant's staff can see your order.</p>
        </Section>

        <Section icon={CreditCard} title="Card payments are PCI-safe">
          <p>When you pay by card, payment is processed by <span className="font-medium text-foreground">Monri</span>, a certified payment provider. Your card details are entered in Monri's secure, hosted fields and are <span className="font-medium text-foreground">never stored on our servers</span> or seen by the restaurant.</p>
        </Section>

        <Section icon={Database} title="What we collect">
          <p>Only what's needed to serve you: the items you order, an optional first name you choose, and your table. We don't require an account, email, or phone number to order.</p>
        </Section>

        <Section icon={Mail} title="Questions or requests">
          <p>To ask about your data or request its deletion, speak with the restaurant or contact La Soul directly. We'll help promptly.</p>
        </Section>

        <motion.p variants={fadeUp} className="text-[11px] text-muted-foreground/70 font-sans text-center pt-2">
          This summary is provided for transparency and may be updated. Ask staff for the full policy.
        </motion.p>
      </motion.div>
    </div>
  );
};

export default Trust;
