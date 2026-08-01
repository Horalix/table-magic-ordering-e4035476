import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Delete, X, CornerDownLeft } from 'lucide-react';

interface PinPadProps {
  open: boolean;
  title: string;
  subtitle?: string;
  length?: number;
  error?: string | null;
  onCancel: () => void;
  onComplete: (pin: string) => void;
}

/**
 * Floor PIN entry.
 *
 * Built for someone who has typed the same four digits two hundred times and
 * does it fast, one-handed, mid-service. Three things follow from that:
 *
 *  - Digits are appended with a functional update. Building the next value from
 *    the render closure lost a digit whenever two taps landed in the same
 *    React batch, so a fast entry became a 3-digit PIN, a "Wrong PIN", and a
 *    burnt attempt against a three-strike lockout.
 *  - There is a Clear key where every physical PIN pad puts one. Cancel used to
 *    sit bottom-left, so reaching for clear-and-retry dismissed the dialog and
 *    sent the waiter back to re-pick their name from the rail.
 *  - It submits on the last digit — but only after a beat, and Backspace during
 *    that beat cancels the submission, so a mis-tap on the fourth key is
 *    recoverable rather than instantly spent.
 *
 * A hardware keyboard works too, which it previously did not at all: on a
 * tablet with a keyboard case, or a manager's laptop, the PIN was untypeable.
 */
const PinPad: React.FC<PinPadProps> = ({
  open, title, subtitle, length = 4, error, onCancel, onComplete,
}) => {
  const [pin, setPin] = useState('');
  const [shake, setShake] = useState(false);
  const submitTimer = useRef<ReturnType<typeof setTimeout>>();

  const cancelPendingSubmit = () => {
    clearTimeout(submitTimer.current);
    submitTimer.current = undefined;
  };

  useEffect(() => {
    if (open) { setPin(''); cancelPendingSubmit(); }
  }, [open]);

  // The timer must not outlive the dialog, or onComplete fires into a closed one.
  useEffect(() => () => cancelPendingSubmit(), []);

  useEffect(() => {
    if (!error) return;
    setShake(true);
    setPin('');
    cancelPendingSubmit();
    const t = setTimeout(() => setShake(false), 400);
    return () => clearTimeout(t);
  }, [error]);

  const press = useCallback((d: string) => {
    setPin((current) => {
      if (current.length >= length) return current;
      const next = current + d;
      if (next.length === length) {
        cancelPendingSubmit();
        // A short beat so the last dot renders and Backspace can still catch it.
        submitTimer.current = setTimeout(() => onComplete(next), 250);
      }
      return next;
    });
  }, [length, onComplete]);

  const back = useCallback(() => {
    cancelPendingSubmit();
    setPin((p) => p.slice(0, -1));
  }, []);

  const clear = useCallback(() => {
    cancelPendingSubmit();
    setPin('');
  }, []);

  // Physical keyboard: digits, Backspace, Escape, and Enter to submit early.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key >= '0' && e.key <= '9') { e.preventDefault(); press(e.key); return; }
      if (e.key === 'Backspace') { e.preventDefault(); back(); return; }
      if (e.key === 'Escape') { e.preventDefault(); onCancel(); return; }
      if (e.key === 'Enter' && pin.length === length) {
        e.preventDefault();
        cancelPendingSubmit();
        onComplete(pin);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, press, back, onCancel, onComplete, pin, length]);

  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent className="max-w-sm p-6 rounded-2xl">
        <DialogTitle className="font-serif text-2xl text-center">{title}</DialogTitle>
        {subtitle && (
          <p className="text-center text-sm font-sans text-muted-foreground -mt-2">{subtitle}</p>
        )}

        <div
          className={`flex justify-center gap-3 my-5 ${shake ? 'animate-shake' : ''}`}
          role="status"
          aria-label={`${pin.length} of ${length} digits entered`}
        >
          {Array.from({ length }).map((_, i) => (
            <div
              key={i}
              className={`w-4 h-4 rounded-full border-2 transition-colors ${
                i < pin.length
                  ? error ? 'bg-destructive border-destructive' : 'bg-primary border-primary'
                  : 'border-muted-foreground/40'
              }`}
            />
          ))}
        </div>

        {/* Announced, not just shaken — the shake is invisible to a screen reader. */}
        <p className="text-center text-sm font-sans text-destructive -mt-2 mb-2 min-h-[1.25rem]" role="alert" aria-live="assertive">
          {error ?? ''}
        </p>

        <div className="grid grid-cols-3 gap-3">
          {keys.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => press(k)}
              className="h-16 rounded-xl bg-card border-2 border-border hover:bg-accent/10 active:scale-95 transition-all text-2xl font-sans font-semibold"
            >
              {k}
            </button>
          ))}
          <button
            type="button"
            onClick={clear}
            className="h-16 rounded-xl bg-muted hover:bg-muted/80 active:scale-95 transition-all flex items-center justify-center text-muted-foreground text-sm font-sans font-semibold"
            aria-label="Clear"
          >
            Clear
          </button>
          <button
            type="button"
            onClick={() => press('0')}
            className="h-16 rounded-xl bg-card border-2 border-border hover:bg-accent/10 active:scale-95 transition-all text-2xl font-sans font-semibold"
          >
            0
          </button>
          <button
            type="button"
            onClick={back}
            className="h-16 rounded-xl bg-muted hover:bg-muted/80 active:scale-95 transition-all flex items-center justify-center text-muted-foreground"
            aria-label="Backspace"
          >
            <Delete className="w-5 h-5" aria-hidden />
          </button>
        </div>

        <div className="flex items-center justify-between mt-4">
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex items-center gap-1.5 text-sm font-sans text-muted-foreground hover:text-foreground min-h-[44px] px-2"
          >
            <X className="w-4 h-4" aria-hidden /> Cancel
          </button>
          <span className="inline-flex items-center gap-1.5 text-[11px] font-sans text-muted-foreground/70">
            <CornerDownLeft className="w-3 h-3" aria-hidden /> keyboard works too
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default PinPad;
