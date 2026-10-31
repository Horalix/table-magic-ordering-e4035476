import React, { useEffect, useRef, useState } from 'react';
import { Check, Loader2, X } from 'lucide-react';
import { parsePrice } from '@/lib/price-input';

/**
 * A price you change where you see it.
 *
 * Changing one price used to be: find the dish, open the editor, find the
 * price field among twenty, save, close. Now it is: tap the price, type,
 * Enter. Escape (or the ✕) leaves it as it was.
 *
 * Validated here so a stray keystroke cannot put a dish on the menu at 0 KM or
 * 1800 KM; the write itself, and undoing it on screen if refused, belongs to
 * the caller.
 */
const InlinePrice = ({ name, price, onSave }: {
  name: string;
  price: number;
  onSave: (next: number) => Promise<boolean>;
}) => {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(price.toFixed(2));
  const [saving, setSaving] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => { if (!editing) setValue(Number(price).toFixed(2)); }, [price, editing]);
  useEffect(() => { if (editing) input.current?.select(); }, [editing]);

  const parsed = parsePrice(value);

  const commit = async () => {
    if (saving) return;
    if (parsed === null) return;
    if (parsed === Number(price)) { setEditing(false); return; }
    setSaving(true);
    const ok = await onSave(parsed);
    setSaving(false);
    if (ok) setEditing(false);
  };

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="inline-flex items-center min-h-[36px] px-2 -mx-2 rounded-md text-xs tabular-nums text-muted-foreground hover:bg-muted hover:text-foreground underline decoration-dotted underline-offset-4"
        aria-label={`Price of ${name}: ${Number(price).toFixed(2)} KM. Change`}
      >
        {Number(price).toFixed(2)} KM
      </button>
    );
  }

  return (
    <span className="inline-flex items-center gap-1">
      <input
        ref={input}
        inputMode="decimal"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); void commit(); }
          if (e.key === 'Escape') { e.preventDefault(); setEditing(false); }
        }}
        aria-label={`New price for ${name}, in KM`}
        aria-invalid={parsed === null}
        className={`w-[4.5rem] md:w-20 h-11 md:h-9 rounded-md border px-2 text-base md:text-sm tabular-nums bg-background ${parsed === null ? 'border-destructive' : 'border-input'}`}
      />
      {/* 16px text (no zoom on focus) and 44px buttons fill a 360px row; the label says KM. */}
      <span className="hidden sm:inline text-xs text-muted-foreground">KM</span>
      <button
        type="button"
        onClick={() => { void commit(); }}
        disabled={parsed === null || saving}
        aria-label={`Save price for ${name}`}
        className="w-11 h-11 md:w-9 md:h-9 rounded-md flex items-center justify-center bg-primary text-primary-foreground disabled:opacity-40"
      >
        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
      </button>
      <button
        type="button"
        onClick={() => setEditing(false)}
        aria-label="Cancel price change"
        className="w-11 h-11 md:w-9 md:h-9 rounded-md flex items-center justify-center text-muted-foreground hover:bg-muted"
      >
        <X className="w-4 h-4" />
      </button>
    </span>
  );
};

export default InlinePrice;
