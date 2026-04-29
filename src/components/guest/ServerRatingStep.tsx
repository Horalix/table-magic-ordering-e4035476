import React, { useState } from 'react';
import { Star } from 'lucide-react';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useT } from '@/lib/i18n';

interface ServerRatingStepProps {
  waiterName?: string | null;
  onSubmit: (rating: number, comment: string) => Promise<void> | void;
  onSkip: () => void;
}

const ServerRatingStep = ({ waiterName, onSubmit, onSkip }: ServerRatingStepProps) => {
  const t = useT();
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (rating === 0) return;
    setSubmitting(true);
    await onSubmit(rating, comment.trim());
    setSubmitting(false);
  };

  return (
    <div className="flex flex-col items-center gap-4 py-2">
      <div className="text-center">
        <p className="font-serif text-base text-foreground">{t('rate_your_server')}</p>
        {waiterName && (
          <p className="font-sans text-sm text-muted-foreground mt-1">
            {t('served_by')} <span className="font-medium text-foreground">{waiterName}</span>
          </p>
        )}
      </div>

      <div className="flex justify-center gap-1.5">
        {[1, 2, 3, 4, 5].map((star) => (
          <motion.button
            key={star}
            whileTap={{ scale: 0.9 }}
            whileHover={{ scale: 1.1 }}
            onMouseEnter={() => setHover(star)}
            onMouseLeave={() => setHover(0)}
            onClick={() => setRating(star)}
            className="p-1 min-w-[40px] min-h-[40px] flex items-center justify-center"
          >
            <Star
              className={`w-8 h-8 transition-colors ${
                star <= (hover || rating) ? 'fill-accent text-accent' : 'text-muted-foreground/30'
              }`}
            />
          </motion.button>
        ))}
      </div>

      {rating > 0 && (
        <Textarea
          placeholder={t('optional_comment')}
          value={comment}
          onChange={(e) => setComment(e.target.value.slice(0, 280))}
          className="rounded-xl text-sm font-sans min-h-[72px]"
        />
      )}

      <div className="flex gap-2 w-full">
        <Button variant="ghost" onClick={onSkip} className="flex-1 font-sans">
          {t('skip')}
        </Button>
        <Button
          onClick={handleSubmit}
          disabled={rating === 0 || submitting}
          className="flex-1 rounded-xl min-h-[44px] font-sans"
        >
          {t('submit')}
        </Button>
      </div>
    </div>
  );
};

export default ServerRatingStep;
