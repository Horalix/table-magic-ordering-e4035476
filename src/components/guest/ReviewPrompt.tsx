import React, { useEffect, useState } from 'react';
import { Star, ExternalLink } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useT } from '@/lib/i18n';
import { motion } from 'framer-motion';
import ServerRatingStep from './ServerRatingStep';
import { getWaiterForReview, submitServerRating, submitVisitRating } from '@/lib/guest-api';

interface ReviewPromptProps {
  open: boolean;
  onClose: () => void;
  sessionId: string;
  sessionToken: string;
}

const GOOGLE_REVIEW_URL = 'https://share.google/al1h37etpg3lpIXGn';

type Step = 'overall' | 'server' | 'final';

const ReviewPrompt = ({ open, onClose, sessionId, sessionToken }: ReviewPromptProps) => {
  const t = useT();
  const [step, setStep] = useState<Step>('overall');
  const [rating, setRating] = useState(0);
  const [hoveredStar, setHoveredStar] = useState(0);
  const [waiter, setWaiter] = useState<{ id: string; display_name: string } | null>(null);

  useEffect(() => {
    if (!open || !sessionId || !sessionToken) return;
    setStep('overall');
    setRating(0);
    (async () => {
      const w = await getWaiterForReview(sessionId, sessionToken).catch(() => null);
      setWaiter(w);
    })();
  }, [open, sessionId, sessionToken]);

  const submitOverall = async (selectedRating: number) => {
    setRating(selectedRating);
    try {
      await submitVisitRating(sessionId, sessionToken, selectedRating);
    } catch (error) {
      console.warn('Failed to submit visit rating', error);
    }
    setStep(waiter ? 'server' : 'final');
  };

  const submitServer = async (serverRating: number, comment: string) => {
    try {
      if (waiter?.id) {
        await submitServerRating(sessionId, sessionToken, waiter.id, serverRating, comment);
      }
    } catch (error) {
      console.warn('Failed to submit server rating', error);
    }
    setStep('final');
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md rounded-2xl">
        <DialogHeader>
          <DialogTitle className="font-serif text-center text-xl">
            {step === 'final' ? t('thank_you_feedback') : t('how_was_experience')}
          </DialogTitle>
          <DialogDescription className="text-center font-sans">
            {step === 'final' ? t('help_discover_lasoul') : t('rate_your_visit')}
          </DialogDescription>
        </DialogHeader>

        {step === 'overall' && (
          <div className="flex justify-center gap-2 py-6">
            {[1, 2, 3, 4, 5].map((star) => (
              <motion.button
                key={star}
                whileHover={{ scale: 1.15 }}
                whileTap={{ scale: 0.9 }}
                onMouseEnter={() => setHoveredStar(star)}
                onMouseLeave={() => setHoveredStar(0)}
                onClick={() => submitOverall(star)}
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
        )}

        {step === 'server' && (
          <ServerRatingStep
            waiterName={waiter?.display_name}
            onSubmit={submitServer}
            onSkip={() => setStep('final')}
          />
        )}

        {step === 'final' && (
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
