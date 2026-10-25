import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Layers, Pencil, Pin, Plus, Search, Sparkles, Tag, X } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import MenuItemDialog from '@/components/admin/MenuItemDialog';
import { fetchCombos, type MenuItemRow } from '@/lib/promotions-api';
import { NO_SALE } from '@/lib/admin-promotions';
import {
  comboSavingRange, formatSarajevoWhen, isNew, salePrice, saleScheduled, sarajevoBusinessDay,
  SALE_LABEL_NAMES, type ComboDef, type SaleLabel,
} from '@/lib/promotions';

type DialogState = { item?: MenuItemRow; subcategoryId?: string; startAsCombo?: boolean; focus?: 'sale' | 'combo' | 'highlight' } | null;

const km = (n: number) => `${n.toFixed(2)} KM`;
const shortDate = (day: string) => {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
};

/** Whole percent off, or the fixed price, as the owner set it. */
const saleTerms = (row: MenuItemRow) => {
  const regular = Number(row.price);
  // The price it will have while it runs, whatever the clock says now.
  const price = salePrice({ ...row, sale_starts_at: null, sale_ends_at: null });
  if (price === null) return 'not cheaper than the menu price';
  return `${km(regular).replace(' KM', '')} → ${km(price)} · −${Math.round((1 - price / regular) * 100)}%`;
};

/**
 * Promotions, in one place: what is on sale (and ending it in one tap), the
 * combos and what guests save on them, what is new, and the three dishes
 * the home screen leads with.
 *
 * Everything here is changed in the dish's own editor, opened at the right
 * section; this page is the overview the owner checks at the start of a shift.
 */
const AdminPromotions = () => {
  const [items, setItems] = useState<MenuItemRow[]>([]);
  const [sections, setSections] = useState<{ id: string; name: string }[]>([]);
  const [combos, setCombos] = useState<ComboDef[]>([]);
  const [loading, setLoading] = useState(true);
  const [missingColumns, setMissingColumns] = useState(false);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [query, setQuery] = useState('');
  const [newComboSection, setNewComboSection] = useState('');
  const [stats, setStats] = useState<{ lines: number; taken: number; given: number } | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    const [{ data: rows, error }, { data: subs }, comboDefs] = await Promise.all([
      supabase.from('menu_items').select('*').order('name'),
      supabase.from('subcategories').select('id, name').order('sort_order'),
      fetchCombos(),
    ]);
    if (error) { toast.error('Failed to load the menu'); setLoading(false); return; }
    setItems(rows ?? []);
    setSections(subs ?? []);
    setCombos(comboDefs ?? []);
    setMissingColumns(!!rows?.length && !('sale_kind' in rows[0]));
    setNow(Date.now());
    setLoading(false);

    // What sales actually did, from the order lines (unit_price is what was
    // charged; regular_unit_price what it would have been).
    const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const { data: lines } = await supabase
      .from('order_items')
      .select('*')
      .gte('created_at', since)
      .not('regular_unit_price', 'is', null);
    const promotionLines = (lines ?? []) as (NonNullable<typeof lines>[number] & { regular_unit_price?: number | null })[];
    const sold = promotionLines.filter((l) => Number(l.regular_unit_price) > Number(l.unit_price));
    if (sold.length === 0) { setStats({ lines: 0, taken: 0, given: 0 }); return; }
    const { data: orders } = await supabase.from('orders').select('id, status').in('id', [...new Set(sold.map((l) => l.order_id))]);
    const real = new Set((orders ?? []).filter((o) => !['cancelled', 'awaiting_payment', 'payment_failed'].includes(String(o.status))).map((o) => o.id));
    const counted = sold.filter((l) => real.has(l.order_id));
    setStats({
      lines: counted.reduce((n, l) => n + l.quantity, 0),
      taken: counted.reduce((n, l) => n + l.quantity * Number(l.unit_price), 0),
      given: counted.reduce((n, l) => n + l.quantity * (Number(l.regular_unit_price) - Number(l.unit_price)), 0),
    });
  }, []);

  useEffect(() => { void load(); }, [load]);

  const patchLocal = (id: string, changes: Partial<MenuItemRow>) =>
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...changes } : it)));

  /** Write a change, show it at once, put it back if the database says no. */
  const update = async (row: MenuItemRow, changes: Partial<MenuItemRow>, done: string, undo?: Partial<MenuItemRow>) => {
    patchLocal(row.id, changes);
    // The promotion columns are not in the generated types until the live
    // database has them (see AGENTS.md); the server validates them.
    const { error } = await supabase.from('menu_items').update(changes as never).eq('id', row.id);
    if (error) {
      patchLocal(row.id, undo ?? {});
      toast.error(`Could not update ${row.name}: ${error.message}`);
      return;
    }
    toast.success(done, undo ? {
      action: { label: 'Undo', onClick: () => { void update({ ...row, ...changes }, undo, `${row.name} restored`); } },
    } : undefined);
  };

  const endSale = (row: MenuItemRow) => update(row, NO_SALE, `Sale ended — ${row.name} is back to ${km(Number(row.price))}`, {
    sale_kind: row.sale_kind, sale_value: row.sale_value, sale_starts_at: row.sale_starts_at,
    sale_ends_at: row.sale_ends_at, sale_label: row.sale_label,
  });

  const comboIds = useMemo(() => new Set(combos.map((c) => c.combo_item_id)), [combos]);
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  const onSale = useMemo(() => items
    .filter((r) => saleScheduled(r, now) !== null)
    .map((r) => ({ row: r, state: saleScheduled(r, now)! }))
    .sort((a, b) => ['running', 'scheduled', 'ended'].indexOf(a.state) - ['running', 'scheduled', 'ended'].indexOf(b.state)), [items, now]);
  const fresh = useMemo(() => items.filter((r) => (r.merchandising_tags ?? []).includes('new')), [items]);
  const featured = useMemo(() => items.filter((r) => r.featured_rank != null).sort((a, b) => Number(a.featured_rank) - Number(b.featured_rank)), [items]);
  const namedCombos = useMemo(() => items.filter((r) => /\bcombo\b/i.test(r.name) && !comboIds.has(r.id)), [items, comboIds]);
  const today = sarajevoBusinessDay(now);

  const q = query.trim().toLowerCase();
  const hits = q.length < 2 ? [] : items.filter((r) => `${r.name} ${r.name_bs ?? ''}`.toLowerCase().includes(q)).slice(0, 6);

  if (loading) {
    return <div className="space-y-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-28 w-full rounded-xl" />)}</div>;
  }

  return (
    <div className="space-y-4 max-w-3xl">
      <div>
        <h1 className="font-serif text-3xl font-bold text-foreground">Promotions</h1>
        <p className="text-sm font-sans text-muted-foreground mt-1">
          What is on sale, the combos, what is new, and what the menu leads with. Change any of it in the dish’s editor.
        </p>
      </div>

      {missingColumns && (
        <Card className="border-accent/40 bg-accent/5">
          <CardContent className="p-3 text-sm font-sans">
            The database has not been given the promotions migration (20261026100000) yet. Nothing here can be saved until it has.
          </CardContent>
        </Card>
      )}

      {/* Straight to the dish, from the one box. */}
      <div className="relative">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a dish to promote…" aria-label="Find a dish" className="pl-9 pr-10 h-11" />
        {query && (
          <button type="button" onClick={() => setQuery('')} aria-label="Clear search" className="absolute right-1 top-1/2 -translate-y-1/2 w-9 h-9 flex items-center justify-center text-muted-foreground"><X className="w-4 h-4" /></button>
        )}
      </div>
      {hits.length > 0 && (
        <Card>
          <CardContent className="p-2 divide-y divide-border">
            {hits.map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-2 py-1.5 px-1">
                <span className="text-sm font-sans truncate">{r.name} <span className="text-xs text-muted-foreground tabular-nums">· {km(Number(r.price))}</span></span>
                <span className="flex gap-1 shrink-0">
                  <Button size="sm" variant="outline" className="h-9" onClick={() => setDialog({ item: r, focus: 'sale' })}>Sale</Button>
                  <Button size="sm" variant="ghost" className="h-9" onClick={() => setDialog({ item: r, focus: 'highlight' })}>New / feature</Button>
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* ---- On sale ---- */}
      <Card aria-labelledby="promo-sales">
        <CardContent className="p-4">
          <h2 id="promo-sales" className="font-serif text-lg font-semibold flex items-center gap-2"><Tag className="w-4 h-4 text-sale" /> On sale</h2>
          {stats && stats.lines > 0 && (
            <p className="text-xs font-sans text-muted-foreground mt-0.5" data-testid="sale-stats">
              Last 7 days: {stats.lines} sold on sale · {km(stats.taken)} taken · {km(stats.given)} off menu prices
            </p>
          )}
          {onSale.length === 0 ? (
            <p className="text-sm font-sans text-muted-foreground mt-2">Nothing is on sale. Find a dish above, or open any dish and switch on Sale.</p>
          ) : (
            <ul className="mt-2 divide-y divide-border">
              {onSale.map(({ row, state }) => {
                const ends = row.sale_ends_at ? Date.parse(row.sale_ends_at) : null;
                const starts = row.sale_starts_at ? Date.parse(row.sale_starts_at) : null;
                const when = state === 'ended'
                  ? `ended ${formatSarajevoWhen(ends!, now)}`
                  : state === 'scheduled'
                    ? `starts ${formatSarajevoWhen(starts!, now)}${ends ? `, ends ${formatSarajevoWhen(ends, now)}` : ''}`
                    : ends ? `ends ${formatSarajevoWhen(ends, now)}` : 'until you end it';
                return (
                  <li key={row.id} className="py-2.5 flex items-center gap-2" data-sale-row={row.name}>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-sans font-medium truncate ${state === 'ended' ? 'text-muted-foreground' : ''}`}>
                        {row.name}
                        {row.sale_label && <span className="ml-1.5 text-xs font-semibold text-sale">{SALE_LABEL_NAMES[row.sale_label as SaleLabel] ?? ''}</span>}
                      </p>
                      <p className="text-xs font-sans text-muted-foreground tabular-nums">
                        <span className={`mr-1.5 inline-block rounded-full px-1.5 py-px text-[10px] font-semibold uppercase ${
                          state === 'running' ? 'bg-sale text-sale-foreground' : state === 'scheduled' ? 'bg-muted text-foreground' : 'bg-muted text-muted-foreground'}`}>
                          {state === 'running' ? 'Now' : state === 'scheduled' ? 'Scheduled' : 'Ended'}
                        </span>
                        {saleTerms(row)} · {when}
                      </p>
                    </div>
                    <Button variant="ghost" size="icon" className="h-11 w-11 shrink-0" aria-label={`Edit the sale on ${row.name}`} onClick={() => setDialog({ item: row, focus: 'sale' })}>
                      <Pencil className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-11 shrink-0 border-destructive/40 text-destructive hover:bg-destructive/10"
                      onClick={() => { void endSale(row); }}
                    >
                      {state === 'ended' ? 'Clear' : state === 'scheduled' ? 'Cancel' : 'End now'}
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* ---- Combos ---- */}
      <Card aria-labelledby="promo-combos">
        <CardContent className="p-4">
          <h2 id="promo-combos" className="font-serif text-lg font-semibold flex items-center gap-2"><Layers className="w-4 h-4 text-primary" /> Combos</h2>
          {combos.length === 0 ? (
            <p className="text-sm font-sans text-muted-foreground mt-2">No combos yet. A combo is a dish where guests choose one item for each part — a burger, a side, a drink.</p>
          ) : (
            <ul className="mt-2 divide-y divide-border">
              {combos.map((c) => {
                const row = byId.get(c.combo_item_id);
                if (!row) return null;
                const range = comboSavingRange(Number(row.price), c.slots.map((s) => ({ options: s.options.map((o) => ({ price: o.price, surcharge: o.surcharge })) })));
                const save = range ? (Math.abs(range.min - range.max) < 0.005 ? km(range.min) : `${range.min.toFixed(2)}–${km(range.max)}`) : null;
                return (
                  <li key={c.combo_item_id} className="py-2.5 flex items-center gap-2" data-combo-row={row.name}>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-sans font-medium truncate ${row.is_available ? '' : 'text-muted-foreground line-through'}`}>{row.name}</p>
                      <p className="text-xs font-sans text-muted-foreground">
                        {km(Number(row.price))} · {c.slots.map((s) => s.label).join(' + ')}
                        {save && (range!.min > 0 ? ` · guests save ${save}` : ' · check the price: some choices cost more than ordering separately')}
                      </p>
                    </div>
                    <Button variant="ghost" size="icon" className="h-11 w-11 shrink-0" aria-label={`Edit the combo ${row.name}`} onClick={() => setDialog({ item: row, focus: 'combo' })}>
                      <Pencil className="w-4 h-4" />
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <label htmlFor="new-combo-section" className="text-xs font-sans text-muted-foreground">New combo in</label>
            <select
              id="new-combo-section"
              value={newComboSection}
              onChange={(e) => setNewComboSection(e.target.value)}
              className="h-10 rounded-md border border-input bg-background px-2 text-sm"
            >
              <option value="">choose a section…</option>
              {sections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <Button size="sm" className="h-10 gap-1" disabled={!newComboSection} onClick={() => setDialog({ subcategoryId: newComboSection, startAsCombo: true })}>
              <Plus className="w-4 h-4" /> New combo
            </Button>
          </div>
          {namedCombos.length > 0 && (
            <p className="mt-3 text-xs font-sans text-muted-foreground">
              Called combos, but guests cannot choose their parts yet:{' '}
              {namedCombos.map((r, i) => (
                <React.Fragment key={r.id}>
                  {i > 0 && ', '}
                  <button type="button" className="underline underline-offset-2 hover:text-foreground" onClick={() => setDialog({ item: r, focus: 'combo' })}>{r.name}</button>
                </React.Fragment>
              ))}
              . Open one and switch on Combo.
            </p>
          )}
        </CardContent>
      </Card>

      {/* ---- New ---- */}
      <Card aria-labelledby="promo-new">
        <CardContent className="p-4">
          <h2 id="promo-new" className="font-serif text-lg font-semibold flex items-center gap-2"><Sparkles className="w-4 h-4 text-primary" /> New at La Soul</h2>
          {fresh.length === 0 ? (
            <p className="text-sm font-sans text-muted-foreground mt-2">Nothing is marked new. Switch on “Mark as new” in a dish’s editor; the badge ends by itself.</p>
          ) : (
            <ul className="mt-2 divide-y divide-border">
              {fresh.map((r) => {
                const showing = isNew(r, now);
                return (
                  <li key={r.id} className="py-2 flex items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-sans font-medium truncate ${showing ? '' : 'text-muted-foreground'}`}>{r.name}</p>
                      <p className="text-xs font-sans text-muted-foreground">
                        {!r.new_until ? 'no end date' : showing ? `new until ${shortDate(r.new_until)}` : `ended ${shortDate(r.new_until)}`}
                        {r.new_until && showing && r.new_until === today && ' (last day)'}
                      </p>
                    </div>
                    <Button variant="ghost" size="icon" className="h-11 w-11 shrink-0" aria-label={`Edit ${r.name}`} onClick={() => setDialog({ item: r, focus: 'highlight' })}>
                      <Pencil className="w-4 h-4" />
                    </Button>
                    <Button variant="outline" size="sm" className="h-11 shrink-0" onClick={() => {
                      void update(r, { merchandising_tags: (r.merchandising_tags ?? []).filter((t) => t !== 'new'), new_until: null },
                        `${r.name} is no longer marked new`, { merchandising_tags: r.merchandising_tags, new_until: r.new_until });
                    }}>
                      Remove
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* ---- Featured ---- */}
      <Card aria-labelledby="promo-featured">
        <CardContent className="p-4">
          <h2 id="promo-featured" className="font-serif text-lg font-semibold flex items-center gap-2"><Pin className="w-4 h-4 text-primary" /> Featured on the home screen <span className="text-xs font-sans font-normal text-muted-foreground">{featured.length} of 3</span></h2>
          {featured.length === 0 ? (
            <p className="text-sm font-sans text-muted-foreground mt-2">No dish is featured. Up to three can lead the menu as large cards — switch on “Feature on the home screen” in a dish’s editor.</p>
          ) : (
            <ul className="mt-2 divide-y divide-border">
              {featured.map((r) => (
                <li key={r.id} className="py-2 flex items-center gap-2">
                  <span className="w-6 text-center text-sm font-semibold text-muted-foreground tabular-nums">{r.featured_rank}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-sans font-medium truncate">{r.name}</p>
                    {r.featured_note && <p className="text-xs font-sans text-muted-foreground truncate">“{r.featured_note}”</p>}
                  </div>
                  <Button variant="ghost" size="icon" className="h-11 w-11 shrink-0" aria-label={`Edit ${r.name}`} onClick={() => setDialog({ item: r, focus: 'highlight' })}>
                    <Pencil className="w-4 h-4" />
                  </Button>
                  <Button variant="outline" size="sm" className="h-11 shrink-0" onClick={() => {
                    void update(r, { featured_rank: null }, `${r.name} is no longer featured`, { featured_rank: r.featured_rank });
                  }}>
                    Unpin
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <p className="text-xs font-sans text-muted-foreground">
        Prices are checked again when an order is placed: a guest is only ever charged the price on their screen, and a sale stops being charged the moment it ends.{' '}
        <Link to="/admin/menu" className="underline underline-offset-2">Back to the menu</Link>
      </p>

      <MenuItemDialog
        open={!!dialog}
        onOpenChange={(o) => { if (!o) setDialog(null); }}
        item={dialog?.item}
        subcategoryId={dialog?.subcategoryId}
        startAsCombo={dialog?.startAsCombo}
        focus={dialog?.focus}
        onSaved={load}
      />
    </div>
  );
};

export default AdminPromotions;
