import React, { useState } from 'react';
import { Star, ExternalLink } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { useT } from '@/lib/i18n';
import { motion } from 'framer-motion';

interface ReviewPromptProps {
  open: boolean;
  onClose: () => void;
  sessionId: string;
}

const GOOGLE_REVIEW_URL = 'https://share.google/al1h37etpg3lpIXGn';

const ReviewPrompt = ({ open, onClose, sessionId }: ReviewPromptProps) => {
  const [rating, setRating] = useState(0);
  const [hoveredStar, setHoveredStar] = useState(0);
  const [submitted, setSubmitted] = useState(false);
  const t = useT();

  const submitRating = async (selectedRating: number) => {
    setRating(selectedRating);
    try {
      await supabase.from('ratings').insert({
        table_session_id: sessionId,
        rating: selectedRating,
      } as any);
    } catch {
      // Non-critical, proceed anyway
    }
    setSubmitted(true);
  };

  const labels = [
    { en: 'How was your experience?', bs: 'Kako je bilo vaše iskustvo?', ar: 'كيف كانت تجربتك؟' },
    { en: 'Thank you for your feedback!', bs: 'Hvala na povratnoj informaciji!', ar: 'شكراً لملاحظاتك!' },
    { en: 'Leave a Google Review', bs: 'Ostavite Google recenziju', ar: 'اترك تقييماً على Google' },
    { en: 'Close', bs: 'Zatvori', ar: 'إغلاق' },
    { en: 'Help others discover La Soul', bs: 'Pomozite drugima da otkriju La Soul', ar: 'ساعد الآخرين في اكتشاف La Soul' },
  ];

  const getText = (idx: number) => {
    const locale = useT.name; // fallback
    return labels[idx].en; // We'll use t() keys below
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md rounded-2xl">
        <DialogHeader>
          <DialogTitle className="font-serif text-center text-xl">
            {submitted ? t('thank_you_feedback') : t('how_was_experience')}
          </DialogTitle>
          <DialogDescription className="text-center font-sans">
            {submitted ? t('help_discover_lasoul') : t('rate_your_visit')}
          </DialogDescription>
        </DialogHeader>

        {!submitted ? (
          <div className="flex justify-center gap-2 py-6">
            {[1, 2, 3, 4, 5].map((star) => (
              <motion.button
                key={star}
                whileHover={{ scale: 1.15 }}
                whileTap={{ scale: 0.9 }}
                onMouseEnter={() => setHoveredStar(star)}
                onMouseLeave={() => setHoveredStar(0)}
                onClick={() => submitRating(star)}
                className="p-1 min-w-[44px] min-h-[44px] flex items-center justify-center"
              >
                <Star
                  className={`w-9 h-9 transition-colors ${
                    star <= (hoveredStar || rating)
                      ? 'fill-accent text-accent'
                      : 'text-muted-foreground/30'
                  }`}
                />
              </motion.button>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center gap-4 py-4">
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map((star) => (
                <Star
                  key={star}
                  className={`w-6 h-6 ${star <= rating ? 'fill-accent text-accent' : 'text-muted-foreground/30'}`}
                />
              ))}
            </div>

            <Button
              asChild
              className="w-full rounded-xl min-h-[48px] bg-primary text-primary-foreground font-sans gap-2"
            >
              <a href={GOOGLE_REVIEW_URL} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="w-4 h-4" />
                {t('leave_google_review')}
              </a>
            </Button>

            <Button variant="ghost" onClick={onClose} className="font-sans text-muted-foreground">
              {t('close')}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default ReviewPrompt;
