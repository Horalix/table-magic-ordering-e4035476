import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useT } from '@/lib/i18n';

interface Props {
  onSubmit: (name: string) => void;
}

const GuestNameModal = ({ onSubmit }: Props) => {
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const t = useT();

  const handleSubmit = () => {
    const trimmed = name.trim();
    if (!trimmed || trimmed.length < 1) {
      setError(t('name_required'));
      return;
    }
    if (trimmed.length > 50) {
      setError('Name too long');
      return;
    }
    onSubmit(trimmed);
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-6">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-sm text-center"
      >
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', damping: 12, stiffness: 200, delay: 0.2 }}
          className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-6"
        >
          <img src="/lasoul-logo.svg" alt="La Soul" className="w-12 h-12 object-contain" />
        </motion.div>

        <h2 className="font-serif text-2xl font-bold text-foreground">{t('welcome')}</h2>
        <p className="text-muted-foreground font-sans text-sm mt-2">{t('enter_your_name')}</p>

        <div className="mt-6 space-y-3">
          <Input
            placeholder={t('name_placeholder')}
            value={name}
            onChange={(e) => { setName(e.target.value); setError(''); }}
            onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
            className="text-center text-lg h-12 rounded-xl"
            maxLength={50}
            autoFocus
          />
          {error && <p className="text-xs text-destructive font-sans">{error}</p>}
          <Button
            onClick={handleSubmit}
            className="w-full h-12 rounded-xl bg-primary text-primary-foreground font-sans font-semibold text-base"
          >
            {t('continue')}
          </Button>
        </div>
      </motion.div>
    </div>
  );
};

export default GuestNameModal;
