import React, { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Search, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { comboSavingRange } from '@/lib/promotions';
import { newSlot, parseSurcharge, slotsProblem, type BuilderSlot } from '@/lib/admin-promotions';

/** A dish that can be chosen inside a combo. */
export interface PickableItem {
  id: string;
  name: string;
  price: number;
  subcategory_id: string;
  is_available?: boolean;
}

const SUGGESTED = ['Burger', 'Main', 'Side', 'Drink', 'Dessert'];

/**
 * Build a combo: name each part, pick the dishes a guest can choose from,
 * optionally charge extra for some. The saving the guest gets is worked out
 * live against the combo price above it, at menu prices.
 */
const ComboBuilder = ({
  slots, onChange, items, sections, comboPrice, selfId, comboIds,
}: {
  slots: BuilderSlot[];
  onChange: (slots: BuilderSlot[]) => void;
  items: PickableItem[];
  sections: { id: string; name: string }[];
  comboPrice: number | null;
  selfId?: string | null;
  /** Dishes that are themselves combos — never a choice inside another. */
  comboIds: Set<string>;
}) => {
  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const pickable = useMemo(() => items.filter((i) => i.id !== selfId && !comboIds.has(i.id)), [items, selfId, comboIds]);

  const update = (key: string, patch: Partial<BuilderSlot>) =>
    onChange(slots.map((s) => (s.key === key ? { ...s, ...patch } : s)));
  const move = (index: number, dir: -1 | 1) => {
    const next = [...slots];
    const j = index + dir;
    if (j < 0 || j >= next.length) return;
    [next[index], next[j]] = [next[j], next[index]];
    onChange(next);
  };

  const range = useMemo(() => {
    if (comboPrice === null || slotsProblem(slots)) return null;
    return comboSavingRange(comboPrice, slots.map((s) => ({
      options: s.options.map((o) => ({ price: itemById.get(o.item_id)?.price ?? 0, surcharge: parseSurcharge(o.surcharge) ?? 0 })),
    })));
  }, [comboPrice, slots, itemById]);

  const km = (n: number) => `${n.toFixed(2)} KM`;
  const kmRange = (a: number, b: number) => (Math.abs(a - b) < 0.005 ? km(a) : `${a.toFixed(2)}–${b.toFixed(2)} KM`);

  return (
    <div className="space-y-3">
      {slots.map((slot, index) => (
        <SlotEditor
          key={slot.key}
          slot={slot}
          index={index}
          count={slots.length}
          itemById={itemById}
          pickable={pickable}
          sections={sections}
          onChange={(patch) => update(slot.key, patch)}
          onMove={(dir) => move(index, dir)}
          onRemove={() => onChange(slots.filter((s) => s.key !== slot.key))}
        />
      ))}

      <div className="flex flex-wrap items-center gap-1.5">
        <Button type="button" variant="outline" size="sm" className="gap-1" onClick={() => onChange([...slots, newSlot()])}>
          <Plus className="w-3.5 h-3.5" /> Add a part
        </Button>
        {slots.length === 0 && SUGGESTED.slice(0, 4).map((label) => (
          <Button key={label} type="button" variant="ghost" size="sm" onClick={() => onChange([...slots, newSlot(label)])}>
            + {label}
          </Button>
        ))}
      </div>

      {/* The number the owner actually cares about. */}
      <div aria-live="polite" data-combo-summary className="rounded-lg bg-muted/60 px-3 py-2 text-xs font-sans">
        {range ? (
          <>
            <p className="text-muted-foreground">
              Ordered separately: {kmRange(range.separatelyMin, range.separatelyMax)} · Combo: {km(comboPrice ?? 0)} + any extra charges
            </p>
            {range.min > 0 ? (
              <p className="font-semibold text-primary mt-0.5">Guests save {kmRange(range.min, range.max)} vs ordering separately</p>
            ) : range.max > 0 ? (
              <p className="font-semibold text-accent mt-0.5">
                Some choices cost guests more than ordering separately (saving {kmRange(range.min, range.max)}). Lower the combo price or the extra charges.
              </p>
            ) : (
              <p className="font-semibold text-destructive mt-0.5">This combo costs more than its parts ordered separately.</p>
            )}
          </>
        ) : (
          <p className="text-muted-foreground">
            {comboPrice === null ? 'Set the combo price above to see what guests save.' : slotsProblem(slots)}
          </p>
        )}
      </div>
    </div>
  );
};

const SlotEditor = ({
  slot, index, count, itemById, pickable, sections, onChange, onMove, onRemove,
}: {
  slot: BuilderSlot;
  index: number;
  count: number;
  itemById: Map<string, PickableItem>;
  pickable: PickableItem[];
  sections: { id: string; name: string }[];
  onChange: (patch: Partial<BuilderSlot>) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
}) => {
  const [query, setQuery] = useState('');
  const [translations, setTranslations] = useState(!!(slot.label_bs || slot.label_ar));
  const chosen = new Set(slot.options.map((o) => o.item_id));
  const q = query.trim().toLowerCase();
  const hits = q.length < 1 ? [] : pickable.filter((i) => !chosen.has(i.id) && i.name.toLowerCase().includes(q)).slice(0, 8);
  const add = (ids: string[]) => {
    const fresh = ids.filter((id) => !chosen.has(id));
    if (fresh.length) onChange({ options: [...slot.options, ...fresh.map((id) => ({ item_id: id, surcharge: '' }))] });
  };
  const name = slot.label.trim() || `Part ${index + 1}`;

  return (
    <div className="rounded-lg border border-border p-3 space-y-2" data-combo-slot-editor>
      <div className="flex items-center gap-1.5">
        <Input
          value={slot.label}
          onChange={(e) => onChange({ label: e.target.value })}
          placeholder="Part name, e.g. Drink"
          aria-label={`Name of part ${index + 1}`}
          maxLength={40}
          className="h-9 flex-1 min-w-0"
        />
        <Button type="button" variant="ghost" size="icon" className="h-9 w-9" disabled={index === 0} aria-label={`Move ${name} up`} onClick={() => onMove(-1)}><ArrowUp className="w-4 h-4" /></Button>
        <Button type="button" variant="ghost" size="icon" className="h-9 w-9" disabled={index === count - 1} aria-label={`Move ${name} down`} onClick={() => onMove(1)}><ArrowDown className="w-4 h-4" /></Button>
        <Button type="button" variant="ghost" size="icon" className="h-9 w-9" aria-label={`Remove ${name}`} onClick={onRemove}><Trash2 className="w-4 h-4 text-destructive" /></Button>
      </div>
      {translations ? (
        <div className="grid grid-cols-2 gap-2">
          <Input value={slot.label_bs} onChange={(e) => onChange({ label_bs: e.target.value })} placeholder="Name (BS), e.g. Piće" maxLength={40} className="h-8 text-xs" />
          <Input value={slot.label_ar} onChange={(e) => onChange({ label_ar: e.target.value })} placeholder="Name (AR)" dir="rtl" maxLength={40} className="h-8 text-xs" />
        </div>
      ) : (
        <button type="button" className="text-[11px] font-sans text-primary underline-offset-2 hover:underline" onClick={() => setTranslations(true)}>
          + Bosnian and Arabic names
        </button>
      )}

      {slot.options.length > 0 && (
        <p className="flex justify-between text-[11px] font-sans text-muted-foreground pr-10" aria-hidden>
          <span>Guests choose one of</span><span>extra charge</span>
        </p>
      )}
      {slot.options.length > 0 && (
        <ul className="space-y-1" aria-label={`Choices for ${name}`}>
          {slot.options.map((o) => {
            const it = itemById.get(o.item_id);
            const bad = parseSurcharge(o.surcharge) === null;
            return (
              <li key={o.item_id} className="flex items-center gap-2 text-sm font-sans">
                <span className="flex-1 min-w-0">
                  <span className={`block truncate ${it?.is_available === false ? 'text-muted-foreground line-through' : ''}`}>{it?.name ?? 'Removed dish'}</span>
                  <span className="block text-[11px] text-muted-foreground tabular-nums">{it ? `${Number(it.price).toFixed(2)} KM on its own` : '—'}</span>
                </span>
                <span className="text-xs text-muted-foreground" aria-hidden>+</span>
                <Input
                  value={o.surcharge}
                  onChange={(e) => onChange({ options: slot.options.map((x) => (x.item_id === o.item_id ? { ...x, surcharge: e.target.value } : x)) })}
                  placeholder="0"
                  inputMode="decimal"
                  aria-label={`Extra charge for ${it?.name ?? 'this dish'} in ${name}`}
                  aria-invalid={bad}
                  className={`h-8 w-16 text-xs text-right ${bad ? 'border-destructive' : ''}`}
                />
                <Button type="button" variant="ghost" size="icon" className="h-8 w-8" aria-label={`Remove ${it?.name ?? 'dish'} from ${name}`}
                  onClick={() => onChange({ options: slot.options.filter((x) => x.item_id !== o.item_id) })}>
                  <X className="w-3.5 h-3.5" />
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      {slot.options.length === 1 && (
        <p className="text-[11px] text-muted-foreground font-sans">One dish: it is included and guests are not asked.</p>
      )}

      <div className="relative">
        <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`Add a dish to ${name}…`}
          aria-label={`Add a dish to ${name}`}
          className="h-9 pl-8 text-sm"
        />
      </div>
      {hits.length > 0 && (
        <ul className="rounded-md border border-border divide-y divide-border bg-card max-h-56 overflow-y-auto">
          {hits.map((i) => (
            <li key={i.id}>
              <button type="button" className="w-full flex items-center justify-between gap-2 px-2.5 py-2 text-sm text-left hover:bg-muted/50"
                onClick={() => { add([i.id]); setQuery(''); }}>
                <span className="truncate">{i.name}</span>
                <span className="text-xs text-muted-foreground tabular-nums shrink-0">{Number(i.price).toFixed(2)} KM</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-center gap-2">
        <label className="text-[11px] text-muted-foreground font-sans shrink-0" htmlFor={`${slot.key}-section`}>or every dish in</label>
        <select
          id={`${slot.key}-section`}
          className="h-8 flex-1 min-w-0 rounded-md border border-input bg-background px-2 text-xs"
          value=""
          onChange={(e) => {
            const id = e.target.value;
            if (id) add(pickable.filter((i) => i.subcategory_id === id).map((i) => i.id));
          }}
        >
          <option value="">a section…</option>
          {sections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>
    </div>
  );
};

export default ComboBuilder;
