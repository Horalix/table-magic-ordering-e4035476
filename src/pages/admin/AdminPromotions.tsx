import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Layers, Pencil, Pin, Plus, Search, Sparkles, Tag, X } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { AdminPageHeader, AdminToolbar } from '@/components/admin/AdminPage';
import { AdminCard, AdminCardHeader, EmptyState } from '@/components/admin/AdminCard';
import { moneyKM, whole } from '@/components/admin/admin-format';
import MenuItemDialog from '@/components/admin/MenuItemDialog';
import { fetchCombos, type MenuItemRow } from '@/lib/promotions-api';
import { NO_SALE } from '@/lib/admin-promotions';
import {
  comboSavingRange, formatSarajevoWhen, isNew, salePrice, saleScheduled, sarajevoBusinessDay,
  SALE_LABEL_NAMES, type ComboDef, type SaleLabel,
} from '@/lib/promotions';

type DialogState = { item?: MenuItemRow; subcategoryId?: string; startAsCombo?: boolean; focus?: 'sale' | 'combo' | 'highlight' } | null;

const km = moneyKM;
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
  const findRef = useRef<HTMLInputElement>(null);

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

  const running = onSale.filter((o) => o.state === 'running').length;
  const scheduled = onSale.filter((o) => o.state === 'scheduled').length;
  const ended = onSale.length - running - scheduled;
  const startPromotion = () => {
    findRef.current?.focus();
    findRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  };

  const header = (
    <AdminPageHeader
      title="Promotions"
      description="What is on sale, the combos, what is new and what the menu leads with. Each is changed in the dish’s own editor."
      actions={(
        <Button onClick={startPromotion} disabled={loading} className="h-11 gap-1.5 sm:h-10">
          <Plus className="h-4 w-4" aria-hidden /> New promotion
        </Button>
      )}
    >
      {!loading && (
        <AdminToolbar aria-label="Promotions at a glance" className="text-xs font-sans text-muted-foreground">
          <Fact tone={running > 0 ? 'sale' : 'muted'}>{running} running</Fact>
          {scheduled > 0 && <Fact>{scheduled} scheduled</Fact>}
          {ended > 0 && <Fact>{ended} ended</Fact>}
          <Fact>{combos.length} combo{combos.length === 1 ? '' : 's'}</Fact>
          <Fact>{fresh.length} marked new</Fact>
          <Fact>{featured.length} of 3 featured</Fact>
        </AdminToolbar>
      )}
    </AdminPageHeader>
  );

  if (loading) {
    return (
      <div className="max-w-5xl">
        {header}
        <div className="space-y-6" aria-busy="true" aria-label="Loading promotions">
          <Skeleton className="h-12 w-full rounded-xl" />
          <Skeleton className="h-[220px] w-full rounded-2xl" />
          <Skeleton className="h-[180px] w-full rounded-2xl" />
          <div className="grid gap-6 lg:grid-cols-2">
            <Skeleton className="h-[200px] rounded-2xl" />
            <Skeleton className="h-[200px] rounded-2xl" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl">
      {header}

      {missingColumns && (
        <AdminCard className="mb-6 border-accent/40 bg-accent/5 px-5 py-4 text-sm font-sans">
          The database has not been given the promotions migration (20261026100000) yet. Nothing here can be saved until it has.
        </AdminCard>
      )}

      {/* Straight to the dish, from the one box. */}
      <section aria-label="Start a promotion" className="mb-8">
        <div className="relative">
          <Search className="pointer-events-none absolute start-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            ref={findRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a dish to promote…"
            aria-label="Find a dish"
            className="h-12 rounded-xl bg-card ps-10 pe-12 text-base shadow-sm md:text-sm"
          />
          {query && (
            <button type="button" onClick={() => setQuery('')} aria-label="Clear search" className="absolute end-1 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        {q.length >= 2 && (
          <AdminCard className="mt-2 overflow-hidden">
            {hits.length === 0 ? (
              <p className="px-5 py-4 text-sm font-sans text-muted-foreground">No dish matches “{query.trim()}”.</p>
            ) : (
              <ul className="divide-y divide-border/70">
                {hits.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-2.5 sm:px-5">
                    <span className="min-w-0 flex-1 basis-40 truncate text-sm font-sans font-medium">
                      {r.name} <span className="font-normal text-muted-foreground tabular-nums">· {km(Number(r.price))}</span>
                    </span>
                    <span className="flex shrink-0 gap-2">
                      <Button size="sm" variant="outline" className="h-11 gap-1.5 sm:h-9" onClick={() => setDialog({ item: r, focus: 'sale' })}>
                        <Tag className="h-3.5 w-3.5" aria-hidden /> Sale
                      </Button>
                      <Button size="sm" variant="outline" className="h-11 sm:h-9" onClick={() => setDialog({ item: r, focus: 'highlight' })}>New / feature</Button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </AdminCard>
        )}
      </section>

      <div className="space-y-6">
        {/* ---- On sale ---- */}
        <AdminCard aria-labelledby="promo-sales">
          <AdminCardHeader
            icon={Tag}
            titleId="promo-sales"
            title="On sale"
            description={stats && stats.lines > 0
              ? <span data-testid="sale-stats">Last 7 days: {whole(stats.lines)} sold on sale · {km(stats.taken)} taken · {km(stats.given)} off menu prices</span>
              : 'Running first, then scheduled, then ended.'}
          />
          {onSale.length === 0 ? (
            <EmptyState
              icon={Tag}
              title="Nothing is on sale."
              hint="Find a dish above and choose Sale, or switch on Sale in any dish’s editor."
              className="pt-2"
            />
          ) : (
            <ul className="border-t border-border/70">
              {onSale.map(({ row, state }) => {
                const ends = row.sale_ends_at ? Date.parse(row.sale_ends_at) : null;
                const starts = row.sale_starts_at ? Date.parse(row.sale_starts_at) : null;
                const when = state === 'ended'
                  ? `ended ${formatSarajevoWhen(ends!, now)}`
                  : state === 'scheduled'
                    ? `starts ${formatSarajevoWhen(starts!, now)}${ends ? `, ends ${formatSarajevoWhen(ends, now)}` : ''}`
                    : ends ? `ends ${formatSarajevoWhen(ends, now)}` : 'until you end it';
                return (
                  <Row key={row.id} data-sale-row={row.name}>
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <StatusPill state={state} />
                        <span className={cn('min-w-0 truncate text-sm font-sans font-medium', state === 'ended' && 'text-muted-foreground')}>{row.name}</span>
                        {row.sale_label && <span className="text-xs font-sans font-semibold text-sale">{SALE_LABEL_NAMES[row.sale_label as SaleLabel] ?? ''}</span>}
                      </p>
                      <p className="mt-1 text-xs font-sans text-muted-foreground tabular-nums">{saleTerms(row)} · {when}</p>
                    </div>
                    <EditButton label={`Edit the sale on ${row.name}`} onClick={() => setDialog({ item: row, focus: 'sale' })} />
                    {/* Reversible from the toast's Undo, so one tap is enough. */}
                    <Button variant="outline" size="sm" className="h-11 shrink-0 px-3 text-muted-foreground hover:border-destructive/40 hover:text-destructive sm:h-9" onClick={() => { void endSale(row); }}>
                      {state === 'ended' ? 'Clear' : state === 'scheduled' ? 'Cancel' : 'End now'}
                    </Button>
                  </Row>
                );
              })}
            </ul>
          )}
        </AdminCard>

        {/* ---- Combos ---- */}
        <AdminCard aria-labelledby="promo-combos">
          <AdminCardHeader
            icon={Layers}
            titleId="promo-combos"
            title="Combos"
            description="Dishes where guests choose one item for each part, and what they save on it."
          />
          {combos.length === 0 ? (
            <EmptyState
              icon={Layers}
              title="No combos yet."
              hint="A combo is a dish where guests choose one item for each part: a burger, a side, a drink. Start one below."
              className="pt-2"
            />
          ) : (
            <ul className="border-t border-border/70">
              {combos.map((c) => {
                const row = byId.get(c.combo_item_id);
                if (!row) return null;
                const range = comboSavingRange(Number(row.price), c.slots.map((s) => ({ options: s.options.map((o) => ({ price: o.price, surcharge: o.surcharge })) })));
                const save = range ? (Math.abs(range.min - range.max) < 0.005 ? km(range.min) : `${range.min.toFixed(2)}–${km(range.max)}`) : null;
                return (
                  <Row key={c.combo_item_id} data-combo-row={row.name}>
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className={cn('min-w-0 truncate text-sm font-sans font-medium', !row.is_available && 'text-muted-foreground line-through')}>{row.name}</span>
                        {!row.is_available && <span className="text-xs font-sans text-muted-foreground">off the menu</span>}
                      </p>
                      <p className="mt-1 text-xs font-sans text-muted-foreground tabular-nums">
                        {km(Number(row.price))} · {c.slots.map((s) => s.label).join(' + ')}
                        {save && (range!.min > 0
                          ? ` · guests save ${save}`
                          : <span className="text-amber-700 dark:text-amber-400"> · check the price: some choices cost more than ordering separately</span>)}
                      </p>
                    </div>
                    <EditButton label={`Edit the combo ${row.name}`} onClick={() => setDialog({ item: row, focus: 'combo' })} />
                  </Row>
                );
              })}
            </ul>
          )}
          <div className="flex flex-col gap-3 border-t border-border/70 px-5 py-4 sm:flex-row sm:flex-wrap sm:items-center sm:px-6">
            <label htmlFor="new-combo-section" className="text-sm font-sans text-muted-foreground">New combo in</label>
            <div className="flex gap-2">
              <select
                id="new-combo-section"
                value={newComboSection}
                onChange={(e) => setNewComboSection(e.target.value)}
                className="h-11 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-base sm:h-10 sm:w-56 sm:flex-none md:text-sm"
              >
                <option value="">choose a section…</option>
                {sections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <Button variant="outline" className="h-11 shrink-0 gap-1.5 sm:h-10" disabled={!newComboSection} onClick={() => setDialog({ subcategoryId: newComboSection, startAsCombo: true })}>
                <Plus className="h-4 w-4" aria-hidden /> New combo
              </Button>
            </div>
          </div>
          {namedCombos.length > 0 && (
            <p className="border-t border-border/70 px-5 py-3.5 text-xs font-sans leading-relaxed text-muted-foreground sm:px-6">
              Called combos, but guests cannot choose their parts yet:{' '}
              {namedCombos.map((r, i) => (
                <React.Fragment key={r.id}>
                  {i > 0 && ', '}
                  <button type="button" className="font-medium text-foreground underline underline-offset-2 hover:text-primary" onClick={() => setDialog({ item: r, focus: 'combo' })}>{r.name}</button>
                </React.Fragment>
              ))}
              . Open one and switch on Combo.
            </p>
          )}
        </AdminCard>

        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2 [&>*]:min-w-0">
          {/* ---- Featured ---- */}
          <AdminCard aria-labelledby="promo-featured">
            <AdminCardHeader
              icon={Pin}
              titleId="promo-featured"
              title="Featured on the home screen"
              description="Up to three dishes lead the guest menu as large cards."
              action={<span className="rounded-full bg-muted px-2 py-0.5 text-xs font-sans font-semibold text-muted-foreground tabular-nums">{featured.length} of 3</span>}
            />
            {featured.length === 0 ? (
              <EmptyState
                icon={Pin}
                title="No dish is featured."
                hint="Find a dish above and choose New / feature, or switch on “Feature on the home screen” in its editor."
                className="pt-2"
              />
            ) : (
              <ul className="border-t border-border/70">
                {featured.map((r) => (
                  <Row key={r.id}>
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary/10 text-xs font-semibold text-primary tabular-nums" aria-label={`Place ${r.featured_rank}`}>{r.featured_rank}</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-sans font-medium">{r.name}</p>
                      {r.featured_note && <p className="mt-0.5 truncate text-xs font-sans text-muted-foreground">“{r.featured_note}”</p>}
                    </div>
                    <EditButton label={`Edit ${r.name}`} onClick={() => setDialog({ item: r, focus: 'highlight' })} />
                    <Button variant="outline" size="sm" className="h-11 shrink-0 px-3 sm:h-9" onClick={() => {
                      void update(r, { featured_rank: null }, `${r.name} is no longer featured`, { featured_rank: r.featured_rank });
                    }}>
                      Unpin
                    </Button>
                  </Row>
                ))}
                {featured.length < 3 && (
                  <li className="px-5 py-3.5 text-xs font-sans text-muted-foreground sm:px-6">
                    {3 - featured.length} place{3 - featured.length === 1 ? '' : 's'} free.
                  </li>
                )}
              </ul>
            )}
          </AdminCard>

          {/* ---- New ---- */}
          <AdminCard aria-labelledby="promo-new">
            <AdminCardHeader
              icon={Sparkles}
              titleId="promo-new"
              title="New on the menu"
              description="Dishes showing the New badge; it ends by itself on its date."
            />
            {fresh.length === 0 ? (
              <EmptyState
                icon={Sparkles}
                title="Nothing is marked new."
                hint="Switch on “Mark as new” in a dish’s editor; the badge ends by itself."
                className="pt-2"
              />
            ) : (
              <ul className="border-t border-border/70">
                {fresh.map((r) => {
                  const showing = isNew(r, now);
                  return (
                    <Row key={r.id}>
                      <div className="min-w-0 flex-1">
                        <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <StatusPill state={showing ? 'running' : 'ended'} runningLabel="Showing" tone="primary" />
                          <span className={cn('min-w-0 truncate text-sm font-sans font-medium', !showing && 'text-muted-foreground')}>{r.name}</span>
                        </p>
                        <p className="mt-1 text-xs font-sans text-muted-foreground">
                          {!r.new_until ? 'no end date' : showing ? `new until ${shortDate(r.new_until)}` : `ended ${shortDate(r.new_until)}`}
                          {r.new_until && showing && r.new_until === today && ' (last day)'}
                        </p>
                      </div>
                      <EditButton label={`Edit ${r.name}`} onClick={() => setDialog({ item: r, focus: 'highlight' })} />
                      <Button variant="outline" size="sm" className="h-11 shrink-0 px-3 sm:h-9" onClick={() => {
                        void update(r, { merchandising_tags: (r.merchandising_tags ?? []).filter((t) => t !== 'new'), new_until: null },
                          `${r.name} is no longer marked new`, { merchandising_tags: r.merchandising_tags, new_until: r.new_until });
                      }}>
                        Remove
                      </Button>
                    </Row>
                  );
                })}
              </ul>
            )}
          </AdminCard>
        </div>

        <p className="max-w-3xl text-xs font-sans leading-relaxed text-muted-foreground">
          Prices are checked again when an order is placed: a guest is only ever charged the price on their screen, and a sale stops being charged the moment it ends.{' '}
          <Link to="/admin/menu" className="font-medium text-foreground underline underline-offset-2">Back to the menu</Link>
        </p>
      </div>

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

/** One line of a promotions list: what it is on the left, its buttons on the right. */
const Row = ({ children, ...rest }: React.LiHTMLAttributes<HTMLLIElement> & { 'data-sale-row'?: string; 'data-combo-row'?: string }) => (
  <li className="flex items-center gap-2 border-b border-border/70 px-5 py-3 last:border-b-0 sm:gap-3 sm:px-6" {...rest}>{children}</li>
);

const EditButton = ({ label, onClick }: { label: string; onClick: () => void }) => (
  <Button variant="ghost" size="icon" className="h-11 w-11 shrink-0 text-muted-foreground hover:text-foreground sm:h-9 sm:w-9" aria-label={label} onClick={onClick}>
    <Pencil className="h-4 w-4" />
  </Button>
);

/** Where a promotion stands, in a word. */
const StatusPill = ({ state, runningLabel = 'Running', tone = 'sale' }: {
  state: 'running' | 'scheduled' | 'ended'; runningLabel?: string; tone?: 'sale' | 'primary';
}) => (
  <span
    className={cn(
      'inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-px text-[11px] font-sans font-semibold leading-[18px]',
      state === 'running' && (tone === 'sale' ? 'bg-sale/10 text-sale' : 'bg-primary/10 text-primary'),
      state === 'scheduled' && 'border border-border text-foreground',
      state === 'ended' && 'bg-muted text-muted-foreground',
    )}
  >
    {state === 'running' && <span className={cn('h-1.5 w-1.5 rounded-full', tone === 'sale' ? 'bg-sale' : 'bg-primary')} aria-hidden />}
    {state === 'running' ? runningLabel : state === 'scheduled' ? 'Scheduled' : 'Ended'}
  </span>
);

const Fact = ({ children, tone = 'muted' }: { children: React.ReactNode; tone?: 'muted' | 'sale' }) => (
  <span className={cn('rounded-full px-2.5 py-1 font-medium tabular-nums', tone === 'sale' ? 'bg-sale/10 text-sale' : 'bg-muted text-muted-foreground')}>{children}</span>
);

export default AdminPromotions;
