/**
 * The admin side of promotions: what the item editor's Sale, Combo and
 * Highlight sections hold, how they are checked, and what is written.
 *
 * Staff screens are English. Times are Sarajevo wall-clock time whatever the
 * device's own zone; see sarajevoToInstant in promotions.ts.
 */
import {
  addDays, formatSarajevoWhen, instantToSarajevoInputs, NEW_DEFAULT_DAYS, salePrice, sarajevoBusinessDay,
  sarajevoClock, sarajevoToInstant, SALE_LABELS, type SaleLabel,
} from '@/lib/promotions';

/* ---- Sale --------------------------------------------------------------- */

export interface SaleDraft {
  on: boolean;
  kind: 'percent' | 'price';
  /** As typed: "20" or "14,40". */
  value: string;
  /** '' for the plain "Sale" badge, else a SALE_LABELS key. */
  label: '' | SaleLabel;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
}

export const emptySale = (): SaleDraft => ({
  on: false, kind: 'percent', value: '', label: '', startDate: '', startTime: '', endDate: '', endTime: '',
});

export interface SaleRow {
  sale_kind?: string | null;
  sale_value?: number | string | null;
  sale_starts_at?: string | null;
  sale_ends_at?: string | null;
  sale_label?: string | null;
}

/** The form for a dish as it is saved. */
export function saleDraftFromRow(row: SaleRow | null | undefined): SaleDraft {
  if (!row?.sale_kind || row.sale_value == null) return emptySale();
  const start = row.sale_starts_at ? instantToSarajevoInputs(Date.parse(row.sale_starts_at)) : null;
  const end = row.sale_ends_at ? instantToSarajevoInputs(Date.parse(row.sale_ends_at)) : null;
  const value = Number(row.sale_value);
  return {
    on: true,
    kind: row.sale_kind === 'price' ? 'price' : 'percent',
    value: row.sale_kind === 'price' ? value.toFixed(2) : String(Math.round(value)),
    label: SALE_LABELS.includes(row.sale_label as SaleLabel) ? (row.sale_label as SaleLabel) : '',
    startDate: start?.date ?? '', startTime: start?.time ?? '',
    endDate: end?.date ?? '', endTime: end?.time ?? '',
  };
}

const parseAmount = (raw: string): number | null => {
  const cleaned = raw.trim().replace(/\s|KM|%/gi, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  return Number(cleaned);
};

export interface SaleColumns {
  sale_kind: string | null;
  sale_value: number | null;
  sale_starts_at: string | null;
  sale_ends_at: string | null;
  sale_label: string | null;
}

export const NO_SALE: SaleColumns = { sale_kind: null, sale_value: null, sale_starts_at: null, sale_ends_at: null, sale_label: null };

/**
 * What to write for this form, or why it cannot be saved.
 *
 * A date without a time means the start of that day (00:00) for a start and
 * the end of it (23:59) for an end — "until Sunday" means all of Sunday.
 */
export function saleColumns(draft: SaleDraft, regularPrice: number | null):
  { ok: true; columns: SaleColumns } | { ok: false; error: string } {
  if (!draft.on) return { ok: true, columns: NO_SALE };
  const value = parseAmount(draft.value);
  if (draft.kind === 'percent') {
    if (value === null || !Number.isInteger(value) || value < 1 || value > 90) {
      return { ok: false, error: 'Enter a whole percentage between 1 and 90, e.g. 20' };
    }
  } else {
    if (value === null || value <= 0) return { ok: false, error: 'Enter a sale price, e.g. 14,40' };
    if (regularPrice !== null && value >= regularPrice) {
      return { ok: false, error: `The sale price must be below the menu price (${regularPrice.toFixed(2)} KM)` };
    }
  }
  const starts = draft.startDate ? sarajevoToInstant(draft.startDate, draft.startTime || '00:00') : null;
  const ends = draft.endDate ? sarajevoToInstant(draft.endDate, draft.endTime || '23:59') : null;
  if ((draft.startTime && !draft.startDate) || (draft.endTime && !draft.endDate)) {
    return { ok: false, error: 'Pick a date as well as a time' };
  }
  if (starts !== null && ends !== null && ends <= starts) {
    return { ok: false, error: 'The sale must end after it starts' };
  }
  return {
    ok: true,
    columns: {
      sale_kind: draft.kind,
      sale_value: value,
      sale_starts_at: starts === null ? null : new Date(starts).toISOString(),
      sale_ends_at: ends === null ? null : new Date(ends).toISOString(),
      sale_label: draft.label || null,
    },
  };
}

/**
 * The live line under the sale form: "18.00 → 14.40 KM · −20% · ends Sun 20:00".
 * `tone` says whether it is a plain statement or a warning.
 */
export function salePreview(draft: SaleDraft, regularPrice: number | null, now: number = Date.now()):
  { text: string; tone: 'ok' | 'warn' } | null {
  if (!draft.on) return null;
  const result = saleColumns(draft, regularPrice);
  if ('error' in result) return { text: result.error, tone: 'warn' };
  if (regularPrice === null) return { text: 'Enter the menu price above to see the sale price', tone: 'warn' };
  const c = result.columns;
  const row = { price: regularPrice, ...c, sale_starts_at: null, sale_ends_at: null };
  const price = salePrice(row, now);
  if (price === null) return { text: 'That is not cheaper than the menu price', tone: 'warn' };
  const pct = Math.round((1 - price / regularPrice) * 100);
  const parts = [`${regularPrice.toFixed(2)} → ${price.toFixed(2)} KM`, `−${pct}%`];
  const starts = c.sale_starts_at ? Date.parse(c.sale_starts_at) : null;
  const ends = c.sale_ends_at ? Date.parse(c.sale_ends_at) : null;
  if (ends !== null && ends <= now) return { text: `${parts.join(' · ')} · already ended ${formatSarajevoWhen(ends, now)}`, tone: 'warn' };
  if (starts !== null && starts > now) parts.push(`starts ${formatSarajevoWhen(starts, now)}`);
  parts.push(ends !== null ? `ends ${formatSarajevoWhen(ends, now)}` : 'until you end it');
  return { text: parts.join(' · '), tone: 'ok' };
}

/** One-tap end dates for the sale form, in Sarajevo time. */
export function saleEndPresets(now: number = Date.now()): { label: string; date: string; time: string }[] {
  const today = sarajevoClock(now);
  const pad = (n: number) => String(n).padStart(2, '0');
  const todayIso = `${today.y}-${pad(today.m)}-${pad(today.d)}`;
  const toSunday = (7 - today.weekday) % 7;
  return [
    { label: 'Tonight', date: today.hh >= 23 ? addDays(todayIso, 1) : todayIso, time: '23:00' },
    { label: 'Sunday night', date: addDays(todayIso, toSunday === 0 && today.hh >= 23 ? 7 : toSunday), time: '23:00' },
    { label: 'In a week', date: addDays(todayIso, 7), time: '23:00' },
  ];
}

/* ---- New ---------------------------------------------------------------- */

/** The default last day of a fresh "Mark as new": thirty trading days from today. */
export const defaultNewUntil = (now: number = Date.now()) => addDays(sarajevoBusinessDay(now), NEW_DEFAULT_DAYS);

/* ---- Combo builder -------------------------------------------------------- */

export interface BuilderOption { item_id: string; surcharge: string }

/** One part of the combo as the form holds it. */
export interface BuilderSlot {
  key: string;
  label: string;
  label_bs: string;
  label_ar: string;
  options: BuilderOption[];
}

let keySeq = 0;
export const newSlot = (label = ''): BuilderSlot => ({ key: `slot-${++keySeq}`, label, label_bs: '', label_ar: '', options: [] });

/** "1,50" or "1.50" → 1.5; empty → 0; anything else → null. */
export const parseSurcharge = (raw: string): number | null => {
  const cleaned = raw.trim().replace(/\s|KM|\+/gi, '').replace(',', '.');
  if (cleaned === '') return 0;
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return n >= 0 && n <= 100 ? n : null;
};

/** What admin_save_combo takes. */
export const slotsPayload = (slots: BuilderSlot[]) => slots.map((s) => ({
  label: s.label.trim(),
  label_bs: s.label_bs.trim() || null,
  label_ar: s.label_ar.trim() || null,
  options: s.options.map((o) => ({ item_id: o.item_id, surcharge: parseSurcharge(o.surcharge) ?? 0 })),
}));

/** Why these parts cannot be saved, or null. */
export function slotsProblem(slots: BuilderSlot[]): string | null {
  if (slots.length === 0) return 'Add at least one part, e.g. “Burger”, “Side”, “Drink”.';
  if (slots.length > 6) return 'A combo can have at most 6 parts.';
  for (const [i, s] of slots.entries()) {
    if (!s.label.trim()) return `Part ${i + 1} needs a name, e.g. “Drink”.`;
    if (s.options.length === 0) return `“${s.label.trim()}” needs at least one dish to choose from.`;
    if (s.options.some((o) => parseSurcharge(o.surcharge) === null)) return `Check the extra charges in “${s.label.trim()}” (e.g. 1,50).`;
  }
  return null;
}

/** The builder's parts for a combo as guest_get_combos returns it. */
export const slotsFromCombo = (combo: { slots: { label: string; label_bs?: string | null; label_ar?: string | null; options: { item_id: string; surcharge: number | string }[] }[] } | undefined): BuilderSlot[] =>
  (combo?.slots ?? []).map((s) => ({
    ...newSlot(s.label),
    label_bs: s.label_bs ?? '',
    label_ar: s.label_ar ?? '',
    options: s.options.map((o) => ({ item_id: o.item_id, surcharge: Number(o.surcharge) > 0 ? Number(o.surcharge).toFixed(2) : '' })),
  }));
