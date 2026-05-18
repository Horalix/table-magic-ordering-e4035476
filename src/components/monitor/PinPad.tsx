import React, { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Delete, X } from 'lucide-react';

interface PinPadProps {
  open: boolean;
  title: string;
  subtitle?: string;
  length?: number;
  error?: string | null;
  onCancel: () => void;
  onComplete: (pin: string) => void;
}

const PinPad: React.FC<PinPadProps> = ({
  open, title, subtitle, length = 4, error, onCancel, onComplete,
}) => {
  const [pin, setPin] = useState('');
  const [shake, setShake] = useState(false);

  useEffect(() => {
    if (open) setPin('');
  }, [open]);

  useEffect(() => {
    if (error) {
      setShake(true);
      setPin('');
      const t = setTimeout(() => setShake(false), 400);
      return () => clearTimeout(t);
    }
  }, [error]);

  const press = (d: string) => {
    if (pin.length >= length) return;
    const next = pin + d;
    setPin(next);
    if (next.length === length) {
      setTimeout(() => onComplete(next), 80);
    }
  };

  const back = () => setPin((p) => p.slice(0, -1));

  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent className="max-w-sm p-6 rounded-2xl">
        <DialogTitle className="font-serif text-2xl text-center">{title}</DialogTitle>
        {subtitle && (
          <p className="text-center text-sm font-sans text-muted-foreground -mt-2">{subtitle}</p>
        )}

        <div className={`flex justify-center gap-3 my-5 ${shake ? 'animate-shake' : ''}`}>
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

        {error && (
          <p className="text-center text-sm font-sans text-destructive -mt-2 mb-2">{error}</p>
        )}

        <div className="grid grid-cols-3 gap-3">
          {keys.map((k) => (
            <button
              key={k}
              onClick={() => press(k)}
              className="h-16 rounded-xl bg-card border-2 border-border hover:bg-accent/10 active:scale-95 transition-all text-2xl font-sans font-semibold"
            >
              {k}
            </button>
          ))}
          <button
            onClick={onCancel}
            className="h-16 rounded-xl bg-muted hover:bg-muted/80 active:scale-95 transition-all flex items-center justify-center text-muted-foreground"
            aria-label="Cancel"
          >
            <X className="w-5 h-5" />
          </button>
          <button
            onClick={() => press('0')}
            className="h-16 rounded-xl bg-card border-2 border-border hover:bg-accent/10 active:scale-95 transition-all text-2xl font-sans font-semibold"
          >
            0
          </button>
          <button
            onClick={back}
            className="h-16 rounded-xl bg-muted hover:bg-muted/80 active:scale-95 transition-all flex items-center justify-center text-muted-foreground"
            aria-label="Backspace"
          >
            <Delete className="w-5 h-5" />
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default PinPad;
