import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, Calculator, Check, Search } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { supabase } from '@/integrations/supabase/client';
import type { MenuEngineeringRow } from '@/lib/menu-intelligence';
import { costOrder, marginPct, parseCost, type CostDish as Dish } from '@/lib/menu-matrix';

/**
 * What each dish costs to make, entered where the margins are read.
 *
 * Every margin on this page — the matrix, what a card is worth — is price
 * minus ingredient cost. Until a dish has a recorded cost the database uses
 * a typical share for its kind of dish and marks the result "estimated"
 * (20261025090000_unit_margin.sql). There was no place in the app to record
 * one. Here the dishes that take the most money and have no cost yet come
 * first: a dozen entries make most of the menu's money exact.
 *
 * A cost saves when the field is left (or on Enter); emptying it goes back
 * to the estimate. Guests never see it.
 */

const FIRST = 8;

const Row = ({ dish, estimate, onSaved }: { dish: Dish; estimate: number | undefined; onSaved: (id: string, cost: number | null) => void }) => {
  const [text, setText] = useState(dish.food_cost !== null ? String(dish.food_cost) : '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const typed = text.trim() === '' ? null : parseCost(text);
  const invalid = text.trim() !== '' && typed === null;
  const tooDear = typed !== null && typed > dish.price;
  const cost = typed ?? dish.food_cost;

  const save = async () => {
    if (invalid || typed === dish.food_cost) return;
    setSaving(true);
    const { error } = await supabase.from('menu_items').update({ food_cost: typed } as never).eq('id', dish.id);
    setSaving(false);
    if (error) { toast.error(`Could not save the cost of ${dish.name}: ${error.message}`); return; }
    setSaved(true);
    onSaved(dish.id, typed);
  };

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2.5">
      <div className="min-w-0 flex-1 basis-40">
        <p className="text-sm font-sans font-medium text-foreground truncate">{dish.name}</p>
        <p className="text-xs font-sans text-muted-foreground tabular-nums">
          Sells for {dish.price.toFixed(2)} KM
          {dish.food_cost === null && estimate !== undefined && <> · estimated cost {estimate.toFixed(2)} KM</>}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Input
          aria-label={`Ingredient cost of ${dish.name}, in KM`}
          aria-invalid={invalid}
          inputMode="decimal"
          autoComplete="off"
          placeholder={estimate !== undefined ? estimate.toFixed(2) : '0,00'}
          value={text}
          disabled={saving}
          onChange={(e) => { setText(e.target.value); setSaved(false); }}
          onBlur={() => void save()}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
          className="h-11 w-24 text-right tabular-nums"
        />
        <span className="text-xs font-sans text-muted-foreground">KM</span>
      </div>
      <p className={`w-full sm:w-44 text-xs font-sans tabular-nums ${invalid || tooDear ? 'text-destructive' : 'text-muted-foreground'}`} aria-live="polite">
        {invalid ? 'A number like 3,20'
          : tooDear ? 'More than its price: it loses money on every portion'
            : cost !== null && cost !== undefined
              ? <>{saved && <Check className="inline w-3.5 h-3.5 text-primary mr-1" aria-hidden />}Keeps {(dish.price - cost).toFixed(2)} KM · {marginPct(dish.price, cost)}%</>
              : 'No cost yet: an estimate is used'}
      </p>
    </li>
  );
};

const DishCostEditor = ({ rows, onChanged }: {
  /** The matrix's rows, for what each dish takes a week and the estimate in use. */
  rows: MenuEngineeringRow[] | null;
  /** A cost was saved: the margins above want reading again. */
  onChanged?: () => void;
}) => {
  const [dishes, setDishes] = useState<Dish[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [all, setAll] = useState(false);

  const load = useCallback(async () => {
    const { data, error: failed } = await supabase.from('menu_items').select('id, name, price, food_cost').order('name');
    if (failed) { setError(failed.message); return; }
    setError(null);
    setDishes(((data ?? []) as unknown as Dish[]).map((d) => ({
      ...d, price: Number(d.price), food_cost: d.food_cost === null || d.food_cost === undefined ? null : Number(d.food_cost),
    })));
  }, []);
  useEffect(() => { void load(); }, [load]);

  const weekly = useMemo(() => new Map((rows ?? []).map((r) => [r.item_id, r.units_per_week * r.price])), [rows]);
  const estimates = useMemo(() => new Map((rows ?? []).filter((r) => r.cost_estimated).map((r) => [r.item_id, r.unit_cost])), [rows]);
  // The order is fixed when the list arrives: a row must not jump away from under the thumb that just filled it.
  const [order, setOrder] = useState<string[]>([]);
  useEffect(() => {
    if (dishes && order.length === 0) setOrder(costOrder(dishes, weekly).map((d) => d.id));
  }, [dishes, weekly, order.length]);

  const recorded = (dishes ?? []).filter((d) => d.food_cost !== null).length;
  const byId = useMemo(() => new Map((dishes ?? []).map((d) => [d.id, d])), [dishes]);
  const needle = query.trim().toLowerCase();
  const listed = order.map((id) => byId.get(id)).filter((d): d is Dish => !!d && (!needle || d.name.toLowerCase().includes(needle)));
  const shown = all || needle ? listed : listed.slice(0, FIRST);

  const saved = (id: string, cost: number | null) => {
    setDishes((prev) => prev?.map((d) => (d.id === id ? { ...d, food_cost: cost } : d)) ?? prev);
    onChanged?.();
  };

  return (
    <Card id="costs" className="rounded-2xl border-border">
      <CardHeader className="pb-3">
        <CardTitle className="font-serif text-lg flex items-center gap-2">
          <Calculator className="w-5 h-5 text-primary shrink-0" /> What each dish costs you
        </CardTitle>
        <p className="text-xs font-sans text-muted-foreground">
          Type what the ingredients of one portion cost. Every margin on this page becomes exact for that dish instead of
          an estimate. The dishes that take the most money come first. Guests never see these.
        </p>
      </CardHeader>
      <CardContent>
        {error ? (
          <div className="flex items-start gap-2 text-sm font-sans">
            <AlertTriangle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
            <p className="text-muted-foreground break-words">Could not load the dishes: {error}</p>
          </div>
        ) : !dishes ? (
          <Skeleton className="h-40 rounded-2xl" />
        ) : dishes.length === 0 ? (
          <p className="text-sm font-sans text-muted-foreground py-4 text-center">No dishes on the menu yet.</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3 mb-2">
              <div className="min-w-0 flex-1 basis-48">
                <p className="text-sm font-sans font-semibold text-foreground tabular-nums">{recorded} of {dishes.length} dishes have a cost</p>
                <div className="mt-1.5 h-2 rounded-full bg-muted overflow-hidden" aria-hidden>
                  <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${(recorded / dishes.length) * 100}%` }} />
                </div>
              </div>
              <div className="relative w-full sm:w-56">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden />
                <Input aria-label="Find a dish" placeholder="Find a dish" value={query} onChange={(e) => setQuery(e.target.value)} className="h-11 pl-9" />
              </div>
            </div>
            <ul className="divide-y divide-border/70" aria-label="Dish costs">
              {shown.map((d) => <Row key={d.id} dish={d} estimate={estimates.get(d.id)} onSaved={saved} />)}
            </ul>
            {shown.length === 0 && <p className="text-sm font-sans text-muted-foreground py-4 text-center">No dish by that name.</p>}
            {!needle && listed.length > FIRST && (
              <button type="button" onClick={() => setAll((v) => !v)} className="mt-2 text-xs font-sans font-semibold text-primary min-h-[40px]">
                {all ? 'Show fewer' : `Show all ${listed.length} dishes`}
              </button>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
};

export default DishCostEditor;
