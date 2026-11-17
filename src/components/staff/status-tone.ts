/**
 * One colour per state, on every staff screen.
 *
 * The kitchen, the waiter's phone and the floor monitor each picked their own:
 * "new" was red on the board and grey on the phone, a waiter call was gold in
 * the kitchen and red on the floor, a bill was sage in one place and red in
 * another, and "preparing" shared its gold with "calling". A runner who learns
 * one screen should be able to read the others without a key.
 *
 *   new        blue    just in, nobody has touched it
 *   preparing  amber   on the stove
 *   ready      green   at the pass, run it
 *   served     grey    done
 *   late       red     past its time — the only red
 *   calling    violet  a guest wants someone
 *   bill       ink     a guest wants to pay
 *
 * Fixed values, not theme tokens: a venue theme (Vera Italia turns the accent
 * terracotta) must not move "preparing" next to "late". Every state also has
 * its own word and, where it stands alone, its own icon — never colour only.
 *
 * Class strings are written out in full so Tailwind's scanner sees them.
 */
import type { CSSProperties } from 'react';

export type StaffTone = 'new' | 'preparing' | 'ready' | 'served' | 'late' | 'calling' | 'bill';

export interface ToneClasses {
  /** HSL triplet ("214 62% 44%"), for glows and `--breathe-color`. */
  hsl: string;
  /** A small solid dot beside a label. */
  dot: string;
  /** The state as text on a light surface (AA on white and cream). */
  text: string;
  /** A tinted chip: soft fill, coloured text. */
  chip: string;
  /** A card or row in this state: soft fill and a matching border. */
  surface: string;
  /** Just the border, for a card that keeps its white surface. */
  border: string;
  /** Solid fill with light text: the loudest form, one word at a time. */
  solid: string;
  /** A thin rail or bar in the state's colour. */
  bar: string;
}

export const TONE: Record<StaffTone, ToneClasses> = {
  new: {
    hsl: '214 62% 46%',
    dot: 'bg-[hsl(214_66%_52%)]',
    text: 'text-[hsl(214_62%_38%)]',
    chip: 'bg-[hsl(214_62%_46%/0.1)] text-[hsl(214_62%_36%)]',
    surface: 'bg-[hsl(214_62%_46%/0.05)] border-[hsl(214_62%_46%/0.3)]',
    border: 'border-[hsl(214_62%_46%/0.55)]',
    solid: 'bg-[hsl(214_62%_44%)] text-white',
    bar: 'bg-[hsl(214_66%_52%)]',
  },
  preparing: {
    hsl: '36 86% 46%',
    dot: 'bg-[hsl(38_90%_50%)]',
    text: 'text-[hsl(32_80%_34%)]',
    chip: 'bg-[hsl(38_90%_50%/0.14)] text-[hsl(30_80%_30%)]',
    surface: 'bg-[hsl(38_90%_50%/0.07)] border-[hsl(38_90%_45%/0.3)]',
    border: 'border-[hsl(38_90%_45%/0.55)]',
    solid: 'bg-[hsl(40_92%_52%)] text-[hsl(28_70%_14%)]',
    bar: 'bg-[hsl(38_90%_50%)]',
  },
  ready: {
    hsl: '150 46% 36%',
    dot: 'bg-[hsl(150_50%_40%)]',
    text: 'text-[hsl(150_52%_27%)]',
    chip: 'bg-[hsl(150_46%_36%/0.11)] text-[hsl(150_52%_25%)]',
    surface: 'bg-[hsl(150_46%_36%/0.06)] border-[hsl(150_46%_36%/0.32)]',
    border: 'border-[hsl(150_46%_36%/0.55)]',
    solid: 'bg-[hsl(150_46%_32%)] text-white',
    bar: 'bg-[hsl(150_50%_40%)]',
  },
  served: {
    hsl: '150 5% 55%',
    dot: 'bg-[hsl(150_5%_62%)]',
    text: 'text-muted-foreground',
    chip: 'bg-muted text-muted-foreground',
    surface: 'bg-muted/40 border-border',
    border: 'border-border',
    solid: 'bg-[hsl(150_6%_40%)] text-white',
    bar: 'bg-[hsl(150_5%_70%)]',
  },
  late: {
    hsl: '0 72% 50%',
    dot: 'bg-[hsl(0_76%_54%)]',
    text: 'text-[hsl(0_72%_42%)]',
    chip: 'bg-[hsl(0_72%_50%/0.1)] text-[hsl(0_72%_40%)]',
    surface: 'bg-[hsl(0_72%_50%/0.05)] border-[hsl(0_72%_50%/0.35)]',
    border: 'border-[hsl(0_72%_50%/0.6)]',
    solid: 'bg-[hsl(0_72%_48%)] text-white',
    bar: 'bg-[hsl(0_76%_54%)]',
  },
  calling: {
    hsl: '266 46% 54%',
    dot: 'bg-[hsl(266_56%_60%)]',
    text: 'text-[hsl(266_44%_42%)]',
    chip: 'bg-[hsl(266_46%_54%/0.12)] text-[hsl(266_44%_38%)]',
    surface: 'bg-[hsl(266_46%_54%/0.06)] border-[hsl(266_46%_54%/0.32)]',
    border: 'border-[hsl(266_46%_54%/0.55)]',
    solid: 'bg-[hsl(266_44%_50%)] text-white',
    bar: 'bg-[hsl(266_56%_60%)]',
  },
  bill: {
    hsl: '210 16% 26%',
    dot: 'bg-[hsl(210_14%_34%)]',
    text: 'text-[hsl(210_18%_24%)]',
    chip: 'bg-[hsl(210_16%_26%/0.09)] text-[hsl(210_18%_22%)]',
    surface: 'bg-[hsl(210_16%_26%/0.04)] border-[hsl(210_16%_26%/0.28)]',
    border: 'border-[hsl(210_16%_26%/0.5)]',
    solid: 'bg-[hsl(210_18%_24%)] text-white',
    bar: 'bg-[hsl(210_14%_34%)]',
  },
};

/** The tone of an order's kitchen status; `null` for states the kitchen never sees. */
export function orderTone(status: string | null | undefined): StaffTone | null {
  switch (status) {
    case 'pending':
    case 'confirmed': return 'new';
    case 'preparing': return 'preparing';
    case 'ready': return 'ready';
    case 'served': return 'served';
    default: return null;
  }
}

/** A glow in a state's colour: sets `--breathe-color` for the shared `.breathe` ring. */
export const toneGlow = (tone: StaffTone): CSSProperties =>
  ({ '--breathe-color': TONE[tone].hsl } as CSSProperties);
