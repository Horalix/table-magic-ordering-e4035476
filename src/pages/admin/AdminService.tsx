import React, { useCallback, useEffect, useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { AlertTriangle, ArrowRight, ChevronDown, ChevronRight, Plus, Trash2, Sparkles, RefreshCw, ShieldAlert, CheckCircle2, CircleDashed, Copy } from 'lucide-react';
import { toast } from 'sonner';
import { cardPaymentStatus, type CardPaymentStatus } from '@/lib/payments';
import type { AdminOutletContext } from '@/components/admin/AdminLayout';
import ReservationWhatsApp from '@/components/admin/ReservationWhatsApp';
import { AdminPageHeader, AdminSection } from '@/components/admin/AdminPage';
import { AdminCard, EmptyState } from '@/components/admin/AdminCard';
import { cn } from '@/lib/utils';

interface Settings {
  /** This restaurant's row (La Soul's is 1). */
  id: number;
  ordering_enabled: boolean;
  reco_weight_curated: number;
  reco_weight_observed: number;
  reco_weight_learned: number;
  reco_weight_margin: number;
  reco_exploration: number;
  reco_holdout_pct: number;
  session_idle_timeout_minutes: number;
  online_card_enabled: boolean;
  pay_at_table_enabled: boolean;
  recommendations_enabled: boolean;
  ordering_paused_message: string | null;
  kitchen_delay_minutes: number;
  last_order_time: string | null;
  /** Absent on a database from before 20261110120000_close_all_tables.sql. */
  day_ends_at?: string | null;
  // Fake-order protection. NULL switches a rule off.
  hold_first_order_km: number | null;
  hold_first_order_items: number | null;
  hold_unpaid_km: number | null;
  hold_burst_sessions: number | null;
  hold_auto_admitted: boolean | null;
  hold_second_session: boolean | null;
  service_open: string | null;
  service_close: string | null;
  /** The menu and nothing else for guests. Absent before 20261103120000_menu_only.sql. */
  menu_only?: boolean;
  /** Guests can ask for a table on the website. Absent before 20261113090000_reservations.sql. */
  reservations_enabled?: boolean;
}

/**
 * A threshold box: empty means "rule off", anything else is at least 1.
 * Portions and table counts are whole numbers in the database.
 */
const thresholdFrom = (raw: string, whole = false): number | null => {
  const n = Number(raw.replace(',', '.'));
  if (raw.trim() === '' || !Number.isFinite(n)) return null;
  return Math.max(1, whole ? Math.round(n) : n);
};

/** `time` columns come back as "18:00:00"; the time input wants "18:00". */
const hhmm = (t: string | null) => (t ? t.slice(0, 5) : '');

interface Reco {
  id: string;
  source_item_id: string | null;
  /** A section rule: any dish of this section on the table. */
  source_subcategory_id: string | null;
  recommended_item_id: string;
  recommendation_type: string;
  priority: number;
  enabled: boolean;
}

interface MenuOption { id: string; name: string }

const RECOMMENDATION_TYPES = [
  { value: 'pair_with', label: 'Goes well with', hint: 'A natural companion — fries with a burger.' },
  { value: 'add_on', label: 'Add-on', hint: 'An extra for the same item — an extra shot, a sauce.' },
  { value: 'upgrade_to', label: 'Upgrade to', hint: 'A larger or better version. Allowed to be from the same category.' },
  { value: 'frequently_bought_together', label: 'Often ordered together', hint: 'Observed pairing.' },
  { value: 'after_meal', label: 'After the meal', hint: 'Coffee, dessert, digestif. Only shown once food has been served.' },
  { value: 'alternative', label: 'Alternative', hint: 'A similar option.' },
];

/**
 * Service controls and merchandising.
 *
 * The switches at the top are the emergency brakes: they take effect
 * server-side (guest_place_order refuses, guest_get_service_status tells the
 * app what to render), so pausing ordering here actually pauses ordering
 * rather than only hiding a button.
 */
const AdminService = () => {
  const { venueSlug } = useOutletContext<AdminOutletContext>();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [recos, setRecos] = useState<Reco[]>([]);
  const [items, setItems] = useState<MenuOption[]>([]);
  const [sections, setSections] = useState<MenuOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** Turning ordering OFF stops every table ordering; it gets a confirmation. */
  const [confirmPause, setConfirmPause] = useState(false);
  /** "Menu only", either way, is asked first: on stops every table, off starts them. */
  const [confirmMenuOnly, setConfirmMenuOnly] = useState<boolean | null>(null);
  /** Ranking weights, the holdout and idle sessions: rarely touched, so folded away. */
  const [advancedOpen, setAdvancedOpen] = useState(false);
  /** A long list of pairings shows its first few until asked. */
  const [showAllRecos, setShowAllRecos] = useState(false);
  /** `source` is a dish id, or `section:<id>` for any dish of a section. */
  const [draft, setDraft] = useState({ source: '', target: '', type: 'pair_with', priority: 60 });

  const load = useCallback(async () => {
    setLoadError(null);
    const [
      { data: s, error: sErr }, { data: r, error: rErr }, { data: m, error: mErr }, { data: subs, error: subErr },
    ] = await Promise.all([
      // One row: the access rules show this restaurant's settings only.
      supabase.from('restaurant_settings').select('*').maybeSingle(),
      supabase.from('menu_item_recommendations').select('*').order('priority', { ascending: false }).limit(500),
      // The menu, sections and dishes, of the restaurant being shown.
      supabase.from('menu_items').select('id, name').order('name').limit(500),
      supabase.from('subcategories').select('id, name').order('name').limit(200),
    ]);
    // A failed load used to leave the skeleton up forever, which on the page
    // holding the "stop orders" switch is the worst place to be stuck.
    const error = sErr ?? rErr ?? mErr ?? subErr;
    if (error || !s) {
      setLoadError(error?.message ?? 'The service settings row is missing');
      setLoading(false);
      return;
    }
    setSettings(s as unknown as Settings);
    /*
     * Only this restaurant's rules: those that suggest one of its dishes. The
     * database keeps to one restaurant's rules too (20261031090000); a
     * database from before that still holds both, and they must not mix here.
     */
    const ours = new Set((m ?? []).map((i) => i.id));
    setRecos(((r ?? []) as unknown as Reco[]).filter((x) => ours.has(x.recommended_item_id)));
    setItems((m ?? []) as MenuOption[]);
    setSections((subs ?? []) as MenuOption[]);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  /** Whether Monri is connected; undefined while asking, null if the function cannot be reached. */
  const [monri, setMonri] = useState<CardPaymentStatus | null | undefined>(undefined);
  useEffect(() => { void cardPaymentStatus().then(setMonri); }, []);

  /** Card payments can only be switched on once Monri can actually take them. */
  const setOnlineCard = (on: boolean) => {
    if (on && !monri?.configured) {
      toast.error('Monri is not connected yet. Add Monri’s merchant key and authenticity token as Edge Function secrets first (docs/monri-go-live.md).');
      return;
    }
    void patch({ online_card_enabled: on });
  };

  const patch = async (changes: Partial<Settings>) => {
    setSettings((prev) => (prev ? { ...prev, ...changes } : prev));
    if (!settings) return;
    const { error } = await supabase.from('restaurant_settings').update(changes as never).eq('id', settings.id);
    if (error) { toast.error(error.message); void load(); return; }
    toast.success('Saved');
  };

  /**
   * Start a measured comparison at the holdout set above.
   *
   * The percentage box alone does not start one: assignment is recorded per
   * table when it opens, under a running experiment. Starting closes any
   * experiment already running.
   */
  const startMeasurement = async (pct: number) => {
    const { data: version } = await supabase.rpc('reco_policy_version' as never);
    const { error } = await supabase.rpc('start_experiment' as never, {
      _name: `Suggestions ${pct}% holdout ${new Date().toISOString().slice(0, 10)}`,
      _policy_version: (version as unknown as string) ?? 'unknown',
      _holdout_pct: pct,
    } as never);
    if (error) { toast.error(error.message); return; }
    toast.success(`Measuring: ${pct}% of new tables will see no suggestions`);
    void load();
  };

  const nameOf = (id: string | null) => (id ? items.find((i) => i.id === id)?.name ?? 'Unknown item' : 'Any order');
  /** What a rule goes with: one dish, any dish of a section, or (after the meal) the whole order. */
  const sourceOf = (r: Reco) => (!r.source_item_id && r.source_subcategory_id
    ? `Anything from ${sections.find((s) => s.id === r.source_subcategory_id)?.name ?? 'a section'}`
    : nameOf(r.source_item_id));

  const addReco = async () => {
    if (!draft.target) { toast.error('Choose the item to recommend'); return; }
    if (draft.type !== 'after_meal' && !draft.source) {
      toast.error('Choose what it should be recommended with, or use "After the meal"');
      return;
    }
    const section = draft.type !== 'after_meal' && draft.source.startsWith('section:')
      ? draft.source.slice('section:'.length) : null;
    const { error } = await supabase.from('menu_item_recommendations').insert({
      source_item_id: draft.type === 'after_meal' || section ? null : draft.source,
      source_subcategory_id: section,
      recommended_item_id: draft.target,
      recommendation_type: draft.type,
      priority: draft.priority,
    } as never);
    if (error) { toast.error(error.message); return; }
    setDraft({ source: '', target: '', type: 'pair_with', priority: 60 });
    toast.success('Suggestion added');
    void load();
  };

  const removeReco = async (id: string) => {
    const { error } = await supabase.from('menu_item_recommendations').delete().eq('id', id);
    if (error) { toast.error(error.message); return; }
    void load();
  };

  const toggleReco = async (reco: Reco) => {
    const { error } = await supabase.from('menu_item_recommendations').update({ enabled: !reco.enabled } as never).eq('id', reco.id);
    if (error) { toast.error(error.message); return; }
    void load();
  };

  const header = (
    <AdminPageHeader
      title="Ordering & service"
      description="What guests can do from their phones right now, and the rules behind it. Every change takes effect at once."
      loading={loading && !!settings}
    >
      {settings && (
        <>
        {/* A phone: one compact "jump to" box instead of three rows of chips. */}
        <label className="relative block sm:hidden">
          <span className="sr-only">Jump to a part of this page</span>
          <select
            value=""
            onChange={(e) => { if (e.target.value) jumpTo(e.target.value); }}
            className="h-11 w-full appearance-none rounded-xl border border-border bg-card ps-3.5 pe-10 text-base font-sans text-foreground shadow-lux"
          >
            <option value="">Jump to…</option>
            {SECTIONS.map((sec) => <option key={sec.id} value={sec.id}>{sec.label}</option>)}
          </select>
          <ChevronDown className="pointer-events-none absolute end-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        </label>
        <nav aria-label="On this page" className="hidden flex-wrap gap-1.5 sm:flex lg:hidden">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => jumpTo(s.id)}
              className="min-h-[44px] rounded-full border border-border bg-card px-3.5 text-[13px] font-sans font-medium text-muted-foreground hover:text-foreground sm:min-h-[34px] sm:px-3"
            >
              {s.label}
            </button>
          ))}
        </nav>
        </>
      )}
    </AdminPageHeader>
  );

  if (!loading && (loadError || !settings)) {
    return (
      <div>
        {header}
        <AdminCard role="alert" className="border-destructive/30">
          <EmptyState icon={AlertTriangle} tone="destructive" title="Could not load the service settings" hint={loadError} className="pb-4" />
          <div className="flex justify-center pb-8">
            <Button
              variant="outline"
              className="min-h-[44px] gap-1.5"
              onClick={() => { setLoading(true); void load(); }}
            >
              <RefreshCw className="h-4 w-4" /> Try again
            </Button>
          </div>
        </AdminCard>
      </div>
    );
  }

  if (loading || !settings) {
    return (
      <div aria-busy="true">
        {header}
        <div className="max-w-3xl space-y-4">
          <AdminCard className="space-y-3 p-6">
            <Skeleton className="h-6 w-64" />
            <Skeleton className="h-4 w-80 max-w-full" />
            <div className="flex gap-2 pt-1">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-6 w-24 rounded-full" />)}</div>
          </AdminCard>
          {[1, 2, 3].map((i) => (
            <AdminCard key={i} className="space-y-4 p-6">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-2/3" />
            </AdminCard>
          ))}
        </div>
      </div>
    );
  }

  /** The one sentence the manager came for: can guests order right now? */
  const now = settings.menu_only
    ? { tone: 'muted' as const, title: 'Guests see the menu only', line: 'No ordering, waiter calls or bills from their phones. The staff screens say so too.' }
    : !settings.ordering_enabled
      ? { tone: 'stopped' as const, title: 'Guests cannot order right now', line: 'They are asked to speak to a waiter, and the server refuses new orders. Orders already placed carry on.' }
      : settings.kitchen_delay_minutes > 0
        ? { tone: 'slow' as const, title: `Guests are ordering, with a ${settings.kitchen_delay_minutes}-minute delay notice`, line: 'They are warned that dishes may take longer, and still order.' }
        : { tone: 'ok' as const, title: 'Guests can order from their phones', line: 'Ordering, waiter calls and bills all work from the table.' };
  const NOW_TONE = {
    ok: { dot: 'bg-emerald-500', wash: 'bg-emerald-500/[0.06]' },
    slow: { dot: 'bg-amber-500', wash: 'bg-amber-500/[0.07]' },
    stopped: { dot: 'bg-destructive', wash: 'bg-destructive/[0.06]' },
    muted: { dot: 'bg-muted-foreground', wash: 'bg-muted/60' },
  }[now.tone];
  const facts: { label: string; on: boolean; to: string }[] = [
    { label: 'Pay at the table', on: settings.pay_at_table_enabled, to: 'now' },
    { label: 'Card online', on: settings.online_card_enabled === true, to: 'payments' },
    ...(settings.reservations_enabled !== undefined ? [{ label: 'Reservations', on: settings.reservations_enabled === true, to: 'reservations' }] : []),
    { label: 'Suggestions', on: settings.recommendations_enabled, to: 'suggestions' },
  ];

  return (
    <div>
      {header}

      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_11rem] lg:gap-10 xl:gap-14">
        <div className="min-w-0 max-w-3xl">
          {/* ---- Right now: the emergency brakes ---------------------------- */}
          <AdminSection id="now" titleId="now-title" title="Right now" description="The switches to reach for during service." className="scroll-mt-24">
            <AdminCard className="overflow-hidden">
              <div className={cn('flex items-start gap-3.5 px-5 py-5 sm:px-6', NOW_TONE.wash)} role="status">
                <span className="relative mt-2 flex h-2.5 w-2.5 shrink-0" aria-hidden>
                  {now.tone === 'ok' && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500/60 motion-reduce:hidden" />}
                  <span className={cn('relative inline-flex h-2.5 w-2.5 rounded-full', NOW_TONE.dot)} />
                </span>
                <div className="min-w-0">
                  <p className="font-serif text-xl font-semibold leading-snug text-foreground text-balance">{now.title}</p>
                  <p className="mt-1 text-[13px] font-sans leading-relaxed text-muted-foreground">{now.line}</p>
                  <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Also">
                    {facts.map((f) => (
                      <li key={f.label}>
                        <button
                          type="button"
                          onClick={() => jumpTo(f.to)}
                          className="inline-flex min-h-[32px] items-center gap-1.5 rounded-full border border-border/80 bg-card px-2.5 text-xs font-sans text-muted-foreground hover:text-foreground"
                        >
                          <span className={cn('h-1.5 w-1.5 rounded-full', f.on ? 'bg-emerald-500' : 'bg-muted-foreground/40')} aria-hidden />
                          <span>{f.label}: <span className="font-semibold text-foreground">{f.on ? 'on' : 'off'}</span></span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              <div className="divide-y divide-border/70 border-t border-border/70">
                {settings.menu_only && (
                  <p className="bg-muted/40 px-5 py-2.5 text-xs font-sans text-muted-foreground sm:px-6">
                    Menu only is on, so guests cannot order. The switches below take effect once it is off.
                  </p>
                )}
                <SettingRow
                  id="ordering"
                  label="Accept orders from guests"
                  state={settings.ordering_enabled ? 'On' : 'Stopped'}
                  stateTone={settings.ordering_enabled ? 'on' : 'alert'}
                  description="Turn this off during a rush or a closure. Guests see a message asking them to speak to a waiter; the server refuses new orders, so nothing slips through."
                  control={(
                    <Switch
                      id="ordering"
                      checked={settings.ordering_enabled}
                      // Switching on needs no ceremony; switching off stops every table.
                      onCheckedChange={(v) => { if (v) void patch({ ordering_enabled: true }); else setConfirmPause(true); }}
                    />
                  )}
                >
                  {!settings.ordering_enabled && (
                    <div className="mt-3 rounded-xl border border-destructive/25 bg-destructive/[0.04] p-3">
                      <Label htmlFor="pause-msg" className="text-xs font-sans font-semibold">Message shown to guests</Label>
                      <Input
                        id="pause-msg"
                        className="mt-1.5 h-11 bg-card md:h-10"
                        defaultValue={settings.ordering_paused_message ?? ''}
                        placeholder="Kitchen is closed until 18:00 — your waiter will take your order."
                        onBlur={(e) => patch({ ordering_paused_message: e.target.value || null })}
                      />
                    </div>
                  )}
                </SettingRow>

                <SettingRow
                  id="delay"
                  label="Kitchen delay notice (minutes)"
                  state={settings.kitchen_delay_minutes > 0 ? `${settings.kitchen_delay_minutes} min` : 'None'}
                  stateTone={settings.kitchen_delay_minutes > 0 ? 'warn' : 'off'}
                  description="Above 0, guests are warned that dishes may take longer. Use it before stopping orders."
                >
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <Input
                      // A new key when the figure changes, so a quick choice shows in the box.
                      key={`delay-${settings.kitchen_delay_minutes}`}
                      id="delay"
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={120}
                      className="h-11 w-24 tabular-nums md:h-10"
                      defaultValue={settings.kitchen_delay_minutes}
                      onBlur={(e) => {
                        const next = Math.max(0, Number(e.target.value) || 0);
                        if (next !== settings.kitchen_delay_minutes) void patch({ kitchen_delay_minutes: next });
                      }}
                    />
                    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Quick delay">
                      {[0, 10, 20, 30].map((m) => (
                        <button
                          key={m}
                          type="button"
                          aria-pressed={settings.kitchen_delay_minutes === m}
                          onClick={() => { if (settings.kitchen_delay_minutes !== m) void patch({ kitchen_delay_minutes: m }); }}
                          className={cn(
                            'min-h-[44px] min-w-[52px] rounded-full border px-3 text-[13px] font-sans font-medium tabular-nums transition-colors md:min-h-[36px]',
                            settings.kitchen_delay_minutes === m ? 'border-foreground bg-foreground text-background' : 'border-border bg-card text-muted-foreground hover:text-foreground',
                          )}
                        >
                          {m === 0 ? 'None' : `${m} min`}
                        </button>
                      ))}
                    </div>
                  </div>
                </SettingRow>

                <SettingRow
                  id="pay-table"
                  label="Pay at the table"
                  state={settings.pay_at_table_enabled ? 'On' : 'Off'}
                  stateTone={settings.pay_at_table_enabled ? 'on' : 'off'}
                  description={settings.pay_at_table_enabled
                    ? 'Guests can pay by cash or the physical POS terminal at the table.'
                    : 'Off: guests cannot choose cash or the POS terminal from their phones.'}
                  control={<Switch id="pay-table" checked={settings.pay_at_table_enabled} onCheckedChange={(v) => patch({ pay_at_table_enabled: v })} />}
                />

                {/*
                  A restaurant goes live on its own address with its menu before the
                  owner has decided to take orders through the app. Enforced in the
                  database too (20261103120000_menu_only.sql), so this switch is the
                  whole of it.
                */}
                <SettingRow
                  id="menu-only"
                  label="Show guests the menu and nothing else"
                  state={settings.menu_only ? 'On' : 'Off'}
                  stateTone={settings.menu_only ? 'warn' : 'off'}
                  description="Menu only. No ordering, no calling the waiter, no asking for the bill; a table’s QR code opens the menu. The waiters’ phones, the floor screen and the kitchen board say that Menu only is on."
                  control={(
                    <Switch
                      id="menu-only"
                      checked={settings.menu_only === true}
                      disabled={settings.menu_only === undefined}
                      onCheckedChange={(v) => setConfirmMenuOnly(v)}
                    />
                  )}
                >
                  {settings.menu_only === undefined && <NeedsUpdate>Not available yet: the database needs an update first. Ask your developer.</NeedsUpdate>}
                </SettingRow>
              </div>
            </AdminCard>
          </AdminSection>

          {/* ---- Payments ---------------------------------------------------- */}
          <AdminSection id="payments" titleId="payments-title" title="Card payments" description="Paying online by card, through Monri." className="scroll-mt-24">
            <AdminCard className="overflow-hidden">
              <SettingRow
                id="card-online"
                label="Online card payment (Monri)"
                state={settings.online_card_enabled ? 'Live' : 'Off'}
                stateTone={settings.online_card_enabled ? 'warn' : 'off'}
                description="Leave off until Monri sandbox testing is complete — see docs/monri-go-live.md. This is the server-side switch: with it off, the database refuses card orders even if an old app build still shows the button."
                control={<Switch id="card-online" checked={settings.online_card_enabled === true} onCheckedChange={setOnlineCard} />}
              >
                <div className="mt-3 space-y-2">
                  <MonriReadiness status={monri} />
                  {settings.online_card_enabled && (
                    <NeedsUpdate>Online card payments are live. Guests will be charged for real.</NeedsUpdate>
                  )}
                </div>
              </SettingRow>
            </AdminCard>
          </AdminSection>

          {/* ---- Reservations -------------------------------------------------- */}
          {/*
            The same switch as on Admin → Reservations, here among the other
            things a restaurant turns on and off, where an admin looks for it.
          */}
          <AdminSection id="reservations" titleId="reservations-title" title="Reservations" description="Table requests from your website." className="scroll-mt-24">
            <AdminCard className="overflow-hidden" data-testid="service-reservations">
              <SettingRow
                id="service-reservations"
                label="Take reservation requests on the website"
                state={settings.reservations_enabled ? 'On' : 'Off'}
                stateTone={settings.reservations_enabled ? 'on' : 'off'}
                description={(
                  <>
                    {settings.reservations_enabled
                      ? 'On: guests ask for a table on your website and you confirm or decline each request.'
                      : 'Off: the booking page tells guests to call instead.'}
                    {' '}Your website shows &ldquo;Reserve a table&rdquo; the moment this is on. Search engines and AI assistants are told by
                    themselves, usually within the hour.
                  </>
                )}
                control={(
                  <Switch
                    id="service-reservations"
                    checked={settings.reservations_enabled === true}
                    disabled={settings.reservations_enabled === undefined}
                    onCheckedChange={(v) => void patch({ reservations_enabled: v })}
                  />
                )}
              >
                {settings.reservations_enabled === undefined ? (
                  <NeedsUpdate>Reservations are not available yet: the database needs an update first. Ask your developer.</NeedsUpdate>
                ) : (
                  <Button asChild variant="outline" size="sm" className="mt-3 min-h-[44px] gap-1.5 md:min-h-[36px]">
                    <Link to="/admin/reservations">Requests, times and alerts <ArrowRight className="h-3.5 w-3.5" /></Link>
                  </Button>
                )}
              </SettingRow>
              {/* WhatsApp confirmations: the same choices as on Admin → Reservations. */}
              {settings.reservations_enabled !== undefined && venueSlug && (
                <div className="border-t border-border/70 px-5 py-4 sm:px-6">
                  <ReservationWhatsApp venueSlug={venueSlug} />
                </div>
              )}
            </AdminCard>
          </AdminSection>

          {/* ---- Hours -------------------------------------------------------- */}
          <AdminSection id="hours" titleId="hours-title" title="Hours" description="When orders are taken and when the work day ends." className="scroll-mt-24">
            <AdminCard className="space-y-5 p-5 sm:p-6">
              <div>
                <p className="text-sm font-sans font-semibold text-foreground">Service hours</p>
                <p className="mt-0.5 text-[13px] font-sans leading-relaxed text-muted-foreground">
                  Orders placed outside these hours (Sarajevo time) wait for a member of staff. Hours may run past
                  midnight — 08:00 to 01:00 works. Leave either empty for no limit.
                </p>
                <div className="mt-3 grid max-w-sm grid-cols-2 gap-3">
                  <NumberField id="service-open" label="Opens">
                    <Input
                      id="service-open" type="time" className="h-11 md:h-10"
                      defaultValue={hhmm(settings.service_open)}
                      onBlur={(e) => patch({ service_open: e.target.value || null })}
                    />
                  </NumberField>
                  <NumberField id="service-close" label="Closes">
                    <Input
                      id="service-close" type="time" className="h-11 md:h-10"
                      defaultValue={hhmm(settings.service_close)}
                      onBlur={(e) => patch({ service_close: e.target.value || null })}
                    />
                  </NumberField>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-5 border-t border-border/70 pt-5 sm:grid-cols-2">
                <NumberField id="last-order" label="Last order time" help="Informational; leave blank if you do not use one.">
                  <Input
                    id="last-order"
                    type="time"
                    className="h-11 md:h-10"
                    defaultValue={settings.last_order_time ?? ''}
                    onBlur={(e) => patch({ last_order_time: e.target.value || null })}
                  />
                </NumberField>
                {'day_ends_at' in settings && (
                  <NumberField id="day-ends" label="Work day ends at" help="From then on, staff screens say which tables are still open and offer Close all tables. Blank: half an hour after closing time.">
                    <Input
                      id="day-ends"
                      type="time"
                      className="h-11 md:h-10"
                      defaultValue={settings.day_ends_at?.slice(0, 5) ?? ''}
                      onBlur={(e) => patch({ day_ends_at: e.target.value || null })}
                    />
                  </NumberField>
                )}
              </div>
            </AdminCard>
          </AdminSection>

          {/* ---- Fake-order protection ----------------------------------------- */}
          {/*
            The venue QR is one printed code; anyone with a photo of it can order
            from outside. These rules decide which pay-at-table orders wait for a
            member of staff instead of printing. Each is enforced in the database
            (order_hold_reason), so this page only edits the numbers.
          */}
          <AdminSection
            id="protection"
            titleId="protection-title"
            title="Fake-order protection"
            description="Which orders wait for a member of staff instead of printing."
            className="scroll-mt-24"
          >
            <AdminCard className="overflow-hidden">
              <div className="space-y-5 p-5 sm:p-6">
                <p className="flex gap-2.5 text-[13px] font-sans leading-relaxed text-muted-foreground">
                  <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden />
                  <span>
                    An order that matches one of these rules does not print. It appears as{' '}
                    <strong className="text-foreground">Needs confirming</strong> on the kitchen screen and the waiter phones, with a chime, until
                    someone confirms or rejects it. The guest just sees that their waiter will confirm it. Once any
                    member of staff has done something for a table — covers, a call, a bump, a payment, a confirm — nothing
                    from that table is held again. Leave a box empty to switch that rule off.
                  </span>
                </p>

                <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                  <NumberField id="hold-first-km" label="Large first order (KM)" help="A table’s first order above this amount waits. Default 60.">
                    <Input
                      id="hold-first-km" type="number" inputMode="decimal" min={1} step="1" className="h-11 tabular-nums md:h-10"
                      defaultValue={settings.hold_first_order_km ?? ''}
                      placeholder="Off"
                      onBlur={(e) => patch({ hold_first_order_km: thresholdFrom(e.target.value) })}
                    />
                  </NumberField>
                  <NumberField id="hold-first-items" label="Large first order (portions)" help="…or with more portions than this. Default 10.">
                    <Input
                      id="hold-first-items" type="number" inputMode="numeric" min={1} step="1" className="h-11 tabular-nums md:h-10"
                      defaultValue={settings.hold_first_order_items ?? ''}
                      placeholder="Off"
                      onBlur={(e) => patch({ hold_first_order_items: thresholdFrom(e.target.value, true) })}
                    />
                  </NumberField>
                  <NumberField id="hold-unpaid" label="Unpaid limit per table (KM)" help="An order that would take a table’s unpaid total past this waits. Default 150.">
                    <Input
                      id="hold-unpaid" type="number" inputMode="decimal" min={1} step="1" className="h-11 tabular-nums md:h-10"
                      defaultValue={settings.hold_unpaid_km ?? ''}
                      placeholder="Off"
                      onBlur={(e) => patch({ hold_unpaid_km: thresholdFrom(e.target.value) })}
                    />
                  </NumberField>
                  <NumberField
                    id="hold-burst"
                    label="New tables at once"
                    help="More than this many tables opening within five minutes of each other, with no staff contact yet, looks like a shared photo of the QR. Default 8. Raise it if you seat big groups at once."
                  >
                    <Input
                      id="hold-burst" type="number" inputMode="numeric" min={1} step="1" className="h-11 tabular-nums md:h-10"
                      defaultValue={settings.hold_burst_sessions ?? ''}
                      placeholder="Off"
                      onBlur={(e) => patch({ hold_burst_sessions: thresholdFrom(e.target.value, true) })}
                    />
                  </NumberField>
                </div>
              </div>

              <div className="divide-y divide-border/70 border-t border-border/70">
                <SettingRow
                  id="hold-auto"
                  label="Hold after an unanswered join"
                  description="If someone joins a table because nobody there answered for two minutes, the table’s next order waits."
                  control={<Switch id="hold-auto" checked={settings.hold_auto_admitted ?? false} onCheckedChange={(v) => patch({ hold_auto_admitted: v })} />}
                />
                <SettingRow
                  id="hold-second"
                  label="Hold a second session on one table"
                  description="Two separate groups ordering on the same table number usually means one of them is not there."
                  control={<Switch id="hold-second" checked={settings.hold_second_session ?? false} onCheckedChange={(v) => patch({ hold_second_session: v })} />}
                />
              </div>
            </AdminCard>
          </AdminSection>

          {/* ---- Suggestions -------------------------------------------------- */}
          <AdminSection
            id="suggestions"
            titleId="suggestions-title"
            title="Suggestions"
            description="The dish a guest is offered with their order: one at a time, always dismissible."
            className="scroll-mt-24"
          >
            <AdminCard className="overflow-hidden">
              <SettingRow
                id="recos"
                label="Show suggestions to guests"
                state={settings.recommendations_enabled ? 'On' : 'Off'}
                stateTone={settings.recommendations_enabled ? 'on' : 'off'}
                description="One at a time, always dismissible. Sold-out items are never suggested."
                control={<Switch id="recos" checked={settings.recommendations_enabled} onCheckedChange={(v) => patch({ recommendations_enabled: v })} />}
              />

              <div className="border-t border-border/70 px-5 py-5 sm:px-6">
                <p className="text-sm font-sans font-semibold text-foreground">Your pairings</p>
                <p className="mt-0.5 text-[13px] font-sans text-muted-foreground">
                  {recos.length === 0
                    ? 'None yet.'
                    : `${recos.length} ${recos.length === 1 ? 'pairing' : 'pairings'}, ${recos.filter((r) => r.enabled).length} switched on.`}
                </p>

                {recos.length === 0 ? (
                  <EmptyState
                    icon={Sparkles}
                    tone="primary"
                    title="No suggestions of your own yet"
                    hint="Guests are offered only what the built-in rules say goes with their order (a drink with food, a salad with pasta) — and nothing when nothing does. Add a pairing below to choose yourself."
                    className="py-8"
                  />
                ) : (
                  <ul className="mt-3 divide-y divide-border/70 rounded-xl border border-border/80">
                    {(showAllRecos ? recos : recos.slice(0, RECOS_SHOWN)).map((r) => (
                      <li key={r.id} className="flex items-center gap-2 py-2 ps-3.5 pe-1.5">
                        <div className="min-w-0 flex-1 py-1">
                          <p className={cn('text-sm font-sans', r.enabled ? 'text-foreground' : 'text-muted-foreground')}>
                            <span className="text-muted-foreground">{sourceOf(r)}</span>
                            {' → '}
                            <strong className="font-semibold">{nameOf(r.recommended_item_id)}</strong>
                          </p>
                          <p className="text-xs font-sans text-muted-foreground">
                            {RECOMMENDATION_TYPES.find((rt) => rt.value === r.recommendation_type)?.label ?? r.recommendation_type}
                            {' · priority '}<span className="tabular-nums">{r.priority}</span>
                            {!r.enabled && ' · off'}
                          </p>
                        </div>
                        <span className="grid h-11 w-12 shrink-0 place-items-center">
                          <Switch checked={r.enabled} onCheckedChange={() => toggleReco(r)} aria-label="Enabled" />
                        </span>
                        <Button variant="ghost" size="icon" className="h-11 w-11 shrink-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive" onClick={() => removeReco(r.id)} aria-label="Remove suggestion">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </li>
                    ))}
                    {recos.length > RECOS_SHOWN && (
                      <li>
                        <button
                          type="button"
                          className="flex min-h-[44px] w-full items-center justify-center text-[13px] font-sans font-medium text-primary hover:bg-primary/5"
                          onClick={() => setShowAllRecos((v) => !v)}
                        >
                          {showAllRecos ? 'Show fewer' : `Show all ${recos.length}`}
                        </button>
                      </li>
                    )}
                  </ul>
                )}

                <div className="mt-5 space-y-3 rounded-xl bg-muted/40 p-4">
                  <p className="text-sm font-sans font-semibold text-foreground">Add a suggestion</p>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <Label className="text-xs font-sans">When the guest orders…</Label>
                      <Select value={draft.source} onValueChange={(v) => setDraft((d) => ({ ...d, source: v }))}>
                        <SelectTrigger className="mt-1 h-11 bg-card text-base md:h-10 md:text-sm"><SelectValue placeholder={draft.type === 'after_meal' ? 'Any order' : 'Choose an item'} /></SelectTrigger>
                        <SelectContent className="max-h-72">
                          {sections.length > 0 && (
                            <>
                              <SelectGroup>
                                <SelectLabel>Any dish of a section</SelectLabel>
                                {sections.map((s) => <SelectItem key={s.id} value={`section:${s.id}`}>Anything from {s.name}</SelectItem>)}
                              </SelectGroup>
                              <SelectSeparator />
                            </>
                          )}
                          <SelectGroup>
                            <SelectLabel>One dish</SelectLabel>
                            {items.map((i) => <SelectItem key={i.id} value={i.id}>{i.name}</SelectItem>)}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-xs font-sans">…suggest</Label>
                      <Select value={draft.target} onValueChange={(v) => setDraft((d) => ({ ...d, target: v }))}>
                        <SelectTrigger className="mt-1 h-11 bg-card text-base md:h-10 md:text-sm"><SelectValue placeholder="Choose an item" /></SelectTrigger>
                        <SelectContent className="max-h-72">
                          {items.map((i) => <SelectItem key={i.id} value={i.id}>{i.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-xs font-sans">Kind</Label>
                      <Select value={draft.type} onValueChange={(v) => setDraft((d) => ({ ...d, type: v }))}>
                        <SelectTrigger className="mt-1 h-11 bg-card text-base md:h-10 md:text-sm"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {RECOMMENDATION_TYPES.map((rt) => <SelectItem key={rt.value} value={rt.value}>{rt.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <p className="mt-1 text-xs font-sans text-muted-foreground">
                        {RECOMMENDATION_TYPES.find((rt) => rt.value === draft.type)?.hint}
                      </p>
                    </div>
                    <div>
                      <Label htmlFor="reco-priority" className="text-xs font-sans">Priority (0–100)</Label>
                      <Input
                        id="reco-priority"
                        type="number" min={0} max={100} inputMode="numeric" className="mt-1 h-11 bg-card tabular-nums md:h-10"
                        value={draft.priority}
                        onChange={(e) => setDraft((d) => ({ ...d, priority: Math.min(100, Math.max(0, Number(e.target.value) || 0)) }))}
                      />
                    </div>
                  </div>
                  <Button onClick={addReco} className="min-h-[44px] gap-1.5 md:min-h-[38px]"><Plus className="h-4 w-4" /> Add suggestion</Button>
                </div>
              </div>
            </AdminCard>
          </AdminSection>

          {/* ---- Advanced: how suggestions are chosen, measurement, sessions -- */}
          <AdminSection
            id="advanced"
            titleId="advanced-title"
            title="Advanced"
            description="How suggestions are ranked, measuring what they earn, and idle tables. Rarely changed."
            className="scroll-mt-24"
          >
            <AdminCard className="overflow-hidden">
              <button
                type="button"
                className="flex min-h-[56px] w-full items-center gap-3 px-5 text-start sm:px-6"
                aria-expanded={advancedOpen}
                aria-controls="advanced-body"
                onClick={() => setAdvancedOpen((o) => !o)}
              >
                <ChevronRight className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none', advancedOpen && 'rotate-90')} />
                <span className="text-sm font-sans font-semibold text-foreground">{advancedOpen ? 'Hide advanced settings' : 'Show advanced settings'}</span>
                <span className="ms-auto hidden text-xs text-muted-foreground tabular-nums sm:inline">
                  Holdout {settings.reco_holdout_pct}% · idle {settings.session_idle_timeout_minutes} min
                </span>
              </button>
              {advancedOpen && (
                <div id="advanced-body" className="space-y-6 border-t border-border/70 p-5 sm:p-6">
                  <div>
                    <p className="text-sm font-sans font-semibold text-foreground">How suggestions are chosen</p>
                    <p className="mt-1 text-[13px] font-sans leading-relaxed text-muted-foreground">
                      First, a suggestion has to belong: one of your pairings, or something that goes with what
                      is on the table (a drink with food, fries with a burger, a salad with pasta, coffee or
                      dessert after the meal). Nothing else is ever shown — an empty card is better than a
                      wrong one. Among what belongs, each candidate is scored from four signals and the
                      highest wins. Raise a number to lean on that signal more. The safety rules always apply
                      on top: never a sold-out dish, never something already in the cart, never a second main
                      or a second side.
                      See <Link to="/admin/menu-intelligence" className="font-medium text-foreground underline underline-offset-2">Menu intelligence</Link> for what it is currently learning.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                    {([
                      ['reco_weight_curated', 'Your own rules', 'Pairings you added by hand.'],
                      ['reco_weight_observed', 'What sells together', 'Measured from real orders.'],
                      ['reco_weight_learned', 'What guests accept', 'How often it is ordered when shown — paid orders only.'],
                      ['reco_weight_margin', 'Profitability', 'Added to the line above: suggestions are ranked by acceptance × margin. Internal only.'],
                      ['reco_exploration', 'Try new items', 'How much room a new dish gets to prove itself.'],
                    ] as const).map(([key, label, hint]) => (
                      <NumberField key={key} id={key} label={label} help={hint}>
                        <Input
                          id={key}
                          type="number"
                          inputMode="numeric"
                          min={0}
                          max={key === 'reco_exploration' ? 50 : 100}
                          className="h-11 tabular-nums md:h-10"
                          defaultValue={settings[key]}
                          onBlur={(e) => patch({ [key]: Math.max(0, Number(e.target.value) || 0) } as Partial<Settings>)}
                        />
                      </NumberField>
                    ))}
                  </div>

                  <div className="border-t border-border/70 pt-6">
                    <NumberField
                      id="holdout"
                      label="Measurement holdout (% of tables that see no suggestions)"
                      help={(
                        <>
                          Leave at 0 normally. Set it to 10 for a couple of weeks when you want to know what the
                          suggestions are <em>really</em> worth: comparing those tables against the rest is the
                          only honest way to separate &ldquo;the guest took our suggestion&rdquo; from &ldquo;the guest was going
                          to order a coffee anyway&rdquo;. The comparison appears under Menu intelligence.
                        </>
                      )}
                    >
                      <Input
                        id="holdout"
                        type="number"
                        inputMode="numeric"
                        min={0}
                        max={50}
                        className="h-11 max-w-[8rem] tabular-nums md:h-10"
                        defaultValue={settings.reco_holdout_pct}
                        onBlur={(e) => patch({ reco_holdout_pct: Math.min(50, Math.max(0, Number(e.target.value) || 0)) })}
                      />
                    </NumberField>
                    <p className="mt-2 text-xs font-sans leading-relaxed text-muted-foreground">
                      The fastest honest answer is 50 for three to four weeks: a 10% holdout needs almost three
                      times as many tables to say the same thing. Setting the number does not start a measurement
                      on its own.
                    </p>
                    <Button
                      variant="outline"
                      className="mt-3 min-h-[44px]"
                      disabled={settings.reco_holdout_pct < 1}
                      onClick={() => void startMeasurement(settings.reco_holdout_pct)}
                    >
                      Start measuring at {settings.reco_holdout_pct}%
                    </Button>
                  </div>

                  <div className="border-t border-border/70 pt-6">
                    <NumberField
                      id="idle"
                      label="Close an idle table session after (minutes)"
                      help="The guest app checks in every minute while it is open, so this only ends sessions nobody has touched for hours. It is what makes a returning guest type their table number again instead of resuming a session from a previous visit."
                    >
                      <Input
                        id="idle"
                        type="number"
                        inputMode="numeric"
                        min={15}
                        max={1440}
                        className="h-11 max-w-[8rem] tabular-nums md:h-10"
                        defaultValue={settings.session_idle_timeout_minutes}
                        onBlur={(e) => patch({ session_idle_timeout_minutes: Math.min(1440, Math.max(15, Number(e.target.value) || 180)) })}
                      />
                    </NumberField>
                  </div>
                </div>
              )}
            </AdminCard>
          </AdminSection>
        </div>

        {/* An index of the page beside it, on a wide screen. */}
        <nav aria-label="On this page" className="hidden lg:block">
          <div className="sticky top-24">
            <p className="mb-2 text-[11px] font-sans font-semibold uppercase tracking-[0.14em] text-muted-foreground">On this page</p>
            <ul className="space-y-0.5 border-s border-border">
              {SECTIONS.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => jumpTo(s.id)}
                    className="-ms-px block w-full border-s border-transparent py-1.5 ps-3 text-start text-[13px] font-sans text-muted-foreground hover:border-foreground/40 hover:text-foreground"
                  >
                    {s.label}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </nav>
      </div>

      <AlertDialog open={confirmMenuOnly !== null} onOpenChange={(open) => { if (!open) setConfirmMenuOnly(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmMenuOnly ? 'Show the menu only?' : 'Turn on ordering, waiter calls and bills?'}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmMenuOnly
                ? 'Guests will see the menu and nothing else. Tables seated now can no longer order, call a waiter or ask for the bill from their phones. Orders already placed are not affected.'
                : 'Guests at the tables can order, call a waiter and ask for the bill from their phones again. Make sure the kitchen screen and the waiters’ phones are on first.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-[44px]">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="min-h-[44px]"
              onClick={() => { if (confirmMenuOnly !== null) void patch({ menu_only: confirmMenuOnly }); }}
            >
              {confirmMenuOnly ? 'Show the menu only' : 'Turn them on'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmPause} onOpenChange={setConfirmPause}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Stop accepting orders?</AlertDialogTitle>
            <AlertDialogDescription>
              Every guest at every table will be told to ask a waiter instead, and the server will refuse
              new orders until you switch this back on. Orders already placed are not affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-[44px]">Keep taking orders</AlertDialogCancel>
            <AlertDialogAction
              className="min-h-[44px] bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { void patch({ ordering_enabled: false }); }}
            >
              Stop orders
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

/** Pairings listed before "Show all". */
const RECOS_SHOWN = 6;

/** The page's parts, for the index at the top (phone) or beside it (wide screen). */
const SECTIONS = [
  { id: 'now', label: 'Right now' },
  { id: 'payments', label: 'Card payments' },
  { id: 'reservations', label: 'Reservations' },
  { id: 'hours', label: 'Hours' },
  { id: 'protection', label: 'Fake-order protection' },
  { id: 'suggestions', label: 'Suggestions' },
  { id: 'advanced', label: 'Advanced' },
];

const jumpTo = (id: string) => {
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  document.getElementById(id)?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
};

type StateTone = 'on' | 'off' | 'warn' | 'alert';
const STATE_TONE: Record<StateTone, string> = {
  on: 'bg-emerald-600/10 text-emerald-700 dark:text-emerald-400',
  off: 'bg-muted text-muted-foreground',
  warn: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  alert: 'bg-destructive/10 text-destructive',
};

/**
 * One setting: its name, its state in a word, what it does, and the switch on
 * the right. The label is the switch's accessible name and a large target.
 */
const SettingRow = ({
  id, label, description, control, state, stateTone = 'off', children,
}: {
  id: string;
  label: string;
  description?: React.ReactNode;
  control?: React.ReactNode;
  state?: string;
  stateTone?: StateTone;
  children?: React.ReactNode;
}) => (
  <div className="px-5 py-4 sm:px-6">
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Label htmlFor={id} className="text-sm font-sans font-semibold leading-snug text-foreground">{label}</Label>
          {state && <span className={cn('rounded-full px-2 py-px text-[11px] font-sans font-semibold', STATE_TONE[stateTone])}>{state}</span>}
        </div>
        {description && <p className="mt-1 text-[13px] font-sans leading-relaxed text-muted-foreground">{description}</p>}
      </div>
      {control && <div className="flex min-h-[44px] shrink-0 items-start pt-0.5">{control}</div>}
    </div>
    {children}
  </div>
);

/** A labelled box with one line of help under the label. */
const NumberField = ({ id, label, help, children }: { id: string; label: string; help?: React.ReactNode; children: React.ReactNode }) => (
  <div>
    <Label htmlFor={id} className="text-sm font-sans font-semibold text-foreground">{label}</Label>
    {help && <p className="mt-0.5 text-xs font-sans leading-relaxed text-muted-foreground">{help}</p>}
    <div className="mt-2">{children}</div>
  </div>
);

const NeedsUpdate = ({ children }: { children: React.ReactNode }) => (
  <div className="mt-3 flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs font-sans text-amber-700 dark:text-amber-400">
    <AlertTriangle className="h-4 w-4 shrink-0" />
    {children}
  </div>
);

/**
 * Where online card payment stands, so going live with Monri is a checklist
 * here rather than a code change: the secrets, the environment, and the
 * callback URL to register in the Monri dashboard.
 */
const MonriReadiness = ({ status }: { status: CardPaymentStatus | null | undefined }) => {
  if (status === undefined) return <Skeleton className="h-16 w-full" />;
  if (status === null) {
    return (
      <p className="text-xs text-muted-foreground font-sans">
        Could not reach the payment function to check Monri. It may not be deployed yet.
      </p>
    );
  }
  const copy = () => {
    void navigator.clipboard?.writeText(status.webhookUrl).then(() => toast.success('Callback URL copied'));
  };
  return (
    <div className="min-w-0 space-y-2 rounded-xl border border-border bg-muted/30 px-3 py-2.5 text-xs font-sans">
      <div className="flex items-center gap-2">
        {status.configured
          ? <CheckCircle2 className="w-4 h-4 text-primary shrink-0" />
          : <CircleDashed className="w-4 h-4 text-muted-foreground shrink-0" />}
        <span className="font-semibold text-foreground">
          {status.configured
            ? `Monri connected · ${status.environment === 'production' ? 'live payments' : 'test (sandbox)'} · ${status.currency}`
            : 'Monri not connected yet'}
        </span>
      </div>
      {!status.configured && (
        <p className="text-muted-foreground">
          When Monri issues the online merchant account, add its merchant key, authenticity token and
          environment as Edge Function secrets (docs/monri-go-live.md) — no rebuild needed. Then this switch can be
          turned on.
        </p>
      )}
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-muted-foreground shrink-0">Callback URL for Monri</span>
        <code className="truncate rounded bg-background px-1.5 py-0.5 border border-border">{status.webhookUrl}</code>
        <Button type="button" variant="ghost" size="sm" className="h-11 w-11 shrink-0 px-0 md:h-8 md:w-8" onClick={copy} aria-label="Copy callback URL">
          <Copy className="w-3.5 h-3.5" />
        </Button>
      </div>
    </div>
  );
};

export default AdminService;
