import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { AlertTriangle, Plus, Trash2, Sparkles, PauseCircle, RefreshCw, ShieldAlert, CheckCircle2, CircleDashed, Copy } from 'lucide-react';
import { toast } from 'sonner';
import { cardPaymentStatus, type CardPaymentStatus } from '@/lib/payments';

interface Settings {
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
  // Fake-order protection. NULL switches a rule off.
  hold_first_order_km: number | null;
  hold_first_order_items: number | null;
  hold_unpaid_km: number | null;
  hold_burst_sessions: number | null;
  hold_auto_admitted: boolean | null;
  hold_second_session: boolean | null;
  service_open: string | null;
  service_close: string | null;
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
  const [settings, setSettings] = useState<Settings | null>(null);
  const [recos, setRecos] = useState<Reco[]>([]);
  const [items, setItems] = useState<MenuOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** Turning ordering OFF stops every table ordering; it gets a confirmation. */
  const [confirmPause, setConfirmPause] = useState(false);
  const [draft, setDraft] = useState({ source: '', target: '', type: 'pair_with', priority: 60 });

  const load = useCallback(async () => {
    setLoadError(null);
    const [{ data: s, error: sErr }, { data: r, error: rErr }, { data: m, error: mErr }] = await Promise.all([
      supabase.from('restaurant_settings').select('*').eq('id', 1).maybeSingle(),
      supabase.from('menu_item_recommendations').select('*').order('priority', { ascending: false }).limit(200),
      supabase.from('menu_items').select('id, name').order('name').limit(500),
    ]);
    // A failed load used to leave the skeleton up forever, which on the page
    // holding the "stop orders" switch is the worst place to be stuck.
    const error = sErr ?? rErr ?? mErr;
    if (error || !s) {
      setLoadError(error?.message ?? 'The service settings row is missing');
      setLoading(false);
      return;
    }
    setSettings(s as unknown as Settings);
    setRecos((r ?? []) as unknown as Reco[]);
    setItems((m ?? []) as MenuOption[]);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  /** Whether Monri is connected; undefined while asking, null if the function cannot be reached. */
  const [monri, setMonri] = useState<CardPaymentStatus | null | undefined>(undefined);
  useEffect(() => { void cardPaymentStatus().then(setMonri); }, []);

  /** Card payments can only be switched on once Monri can actually take them. */
  const setOnlineCard = (on: boolean) => {
    if (on && !monri?.configured) {
      toast.error('Monri is not connected yet. Add MONRI_MERCHANT_KEY and MONRI_AUTHENTICITY_TOKEN as Edge Function secrets first (docs/monri-go-live.md).');
      return;
    }
    void patch({ online_card_enabled: on });
  };

  const patch = async (changes: Partial<Settings>) => {
    setSettings((prev) => (prev ? { ...prev, ...changes } : prev));
    const { error } = await supabase.from('restaurant_settings').update(changes as never).eq('id', 1);
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

  const addReco = async () => {
    if (!draft.target) { toast.error('Choose the item to recommend'); return; }
    if (draft.type !== 'after_meal' && !draft.source) {
      toast.error('Choose what it should be recommended with, or use "After the meal"');
      return;
    }
    const { error } = await supabase.from('menu_item_recommendations').insert({
      source_item_id: draft.type === 'after_meal' ? null : draft.source,
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

  if (!loading && (loadError || !settings)) {
    return (
      <div className="space-y-6">
        <h1 className="font-serif text-3xl font-bold text-foreground">Service &amp; merchandising</h1>
        <Card className="border-destructive/30">
          <CardContent className="py-10 text-center space-y-3">
            <AlertTriangle className="w-8 h-8 mx-auto text-destructive/60" />
            <p className="font-serif text-lg font-semibold text-foreground">Could not load the service settings</p>
            <p className="text-sm font-sans text-muted-foreground">{loadError}</p>
            <Button
              variant="outline"
              className="min-h-[44px] gap-1.5"
              onClick={() => { setLoading(true); void load(); }}
            >
              <RefreshCw className="w-4 h-4" /> Try again
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (loading || !settings) {
    return <div className="space-y-4">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-40 rounded-xl" />)}</div>;
  }

  return (
    <div className="space-y-6">
      <h1 className="font-serif text-3xl font-bold text-foreground">Service &amp; merchandising</h1>

      <Card className="border-border">
        <CardHeader>
          <CardTitle className="font-serif text-lg flex items-center gap-2">
            <PauseCircle className="w-5 h-5 text-accent" /> Service controls
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <Label htmlFor="ordering" className="font-sans font-semibold">Accept orders from guests</Label>
              <p className="text-xs text-muted-foreground font-sans mt-0.5">
                Turn this off during a rush or a closure. Guests see a message asking them to speak to a waiter;
                the server refuses new orders, so nothing slips through.
              </p>
            </div>
            <Switch
              id="ordering"
              checked={settings.ordering_enabled}
              // Switching on needs no ceremony; switching off stops every table.
              onCheckedChange={(v) => { if (v) void patch({ ordering_enabled: true }); else setConfirmPause(true); }}
            />
          </div>

          {!settings.ordering_enabled && (
            <div className="rounded-xl border border-accent/30 bg-accent/5 p-3">
              <Label htmlFor="pause-msg" className="text-xs font-sans font-semibold">Message shown to guests</Label>
              <Input
                id="pause-msg"
                className="mt-1.5"
                defaultValue={settings.ordering_paused_message ?? ''}
                placeholder="Kitchen is closed until 18:00 — your waiter will take your order."
                onBlur={(e) => patch({ ordering_paused_message: e.target.value || null })}
              />
            </div>
          )}

          <div className="flex items-start justify-between gap-4">
            <div>
              <Label htmlFor="pay-table" className="font-sans font-semibold">Pay at the table</Label>
              <p className="text-xs text-muted-foreground font-sans mt-0.5">Cash and the physical POS terminal.</p>
            </div>
            <Switch id="pay-table" checked={settings.pay_at_table_enabled} onCheckedChange={(v) => patch({ pay_at_table_enabled: v })} />
          </div>

          <div className="flex items-start justify-between gap-4">
            <div>
              <Label htmlFor="card-online" className="font-sans font-semibold">Online card payment (Monri)</Label>
              <p className="text-xs text-muted-foreground font-sans mt-0.5">
                Leave off until Monri sandbox testing is complete — see docs/monri-go-live.md. This is the
                server-side switch: with it off, the database refuses card orders even if an old app build still
                shows the button.
              </p>
            </div>
            <Switch id="card-online" checked={settings.online_card_enabled === true} onCheckedChange={setOnlineCard} />
          </div>

          <MonriReadiness status={monri} />

          {settings.online_card_enabled && (
            <div className="flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs font-sans text-amber-700 dark:text-amber-400">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              Online card payments are live. Guests will be charged for real.
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-border">
            <div>
              <Label htmlFor="delay" className="font-sans font-semibold text-sm">Kitchen delay notice (minutes)</Label>
              <p className="text-xs text-muted-foreground font-sans mb-1.5">Above 0, guests are warned that dishes may take longer.</p>
              <Input
                id="delay"
                type="number"
                min={0}
                max={120}
                defaultValue={settings.kitchen_delay_minutes}
                onBlur={(e) => patch({ kitchen_delay_minutes: Math.max(0, Number(e.target.value) || 0) })}
              />
            </div>
            <div>
              <Label htmlFor="last-order" className="font-sans font-semibold text-sm">Last order time</Label>
              <p className="text-xs text-muted-foreground font-sans mb-1.5">Informational; leave blank if you do not use one.</p>
              <Input
                id="last-order"
                type="time"
                defaultValue={settings.last_order_time ?? ''}
                onBlur={(e) => patch({ last_order_time: e.target.value || null })}
              />
            </div>
          </div>
        </CardContent>
      </Card>

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

      {/*
        The venue QR is one printed code; anyone with a photo of it can order
        from outside. These rules decide which pay-at-table orders wait for a
        member of staff instead of printing. Each is enforced in the database
        (order_hold_reason), so this page only edits the numbers.
      */}
      <Card className="border-border">
        <CardHeader>
          <CardTitle className="font-serif text-lg flex items-center gap-2">
            <ShieldAlert className="w-5 h-5 text-accent" /> Fake-order protection
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <p className="text-sm font-sans text-muted-foreground leading-relaxed">
            An order that matches one of these rules does not print. It appears as{' '}
            <strong>Needs confirming</strong> on the kitchen screen and the waiter phones, with a chime, until
            someone confirms or rejects it. The guest just sees that their waiter will confirm it. Once any
            member of staff has done something for a table — covers, a call, a bump, a payment, a confirm — nothing
            from that table is held again. Leave a box empty to switch that rule off.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="hold-first-km" className="font-sans font-semibold text-sm">Large first order (KM)</Label>
              <p className="text-xs text-muted-foreground font-sans mb-1.5">
                A table&apos;s first order above this amount waits. Default 60.
              </p>
              <Input
                id="hold-first-km" type="number" inputMode="decimal" min={1} step="1"
                defaultValue={settings.hold_first_order_km ?? ''}
                placeholder="Off"
                onBlur={(e) => patch({ hold_first_order_km: thresholdFrom(e.target.value) })}
              />
            </div>
            <div>
              <Label htmlFor="hold-first-items" className="font-sans font-semibold text-sm">Large first order (portions)</Label>
              <p className="text-xs text-muted-foreground font-sans mb-1.5">
                …or with more portions than this. Default 10.
              </p>
              <Input
                id="hold-first-items" type="number" inputMode="numeric" min={1} step="1"
                defaultValue={settings.hold_first_order_items ?? ''}
                placeholder="Off"
                onBlur={(e) => patch({ hold_first_order_items: thresholdFrom(e.target.value, true) })}
              />
            </div>
            <div>
              <Label htmlFor="hold-unpaid" className="font-sans font-semibold text-sm">Unpaid limit per table (KM)</Label>
              <p className="text-xs text-muted-foreground font-sans mb-1.5">
                An order that would take a table&apos;s unpaid total past this waits. Default 150.
              </p>
              <Input
                id="hold-unpaid" type="number" inputMode="decimal" min={1} step="1"
                defaultValue={settings.hold_unpaid_km ?? ''}
                placeholder="Off"
                onBlur={(e) => patch({ hold_unpaid_km: thresholdFrom(e.target.value) })}
              />
            </div>
            <div>
              <Label htmlFor="hold-burst" className="font-sans font-semibold text-sm">New tables at once</Label>
              <p className="text-xs text-muted-foreground font-sans mb-1.5">
                More than this many tables opening within five minutes of each other, with no staff contact yet,
                looks like a shared photo of the QR. Default 3. Raise it if you seat big groups at once.
              </p>
              <Input
                id="hold-burst" type="number" inputMode="numeric" min={1} step="1"
                defaultValue={settings.hold_burst_sessions ?? ''}
                placeholder="Off"
                onBlur={(e) => patch({ hold_burst_sessions: thresholdFrom(e.target.value, true) })}
              />
            </div>
          </div>

          <div className="flex items-start justify-between gap-4 pt-2 border-t border-border">
            <div>
              <Label htmlFor="hold-auto" className="font-sans font-semibold">Hold after an unanswered join</Label>
              <p className="text-xs text-muted-foreground font-sans mt-0.5">
                If someone joins a table because nobody there answered for two minutes, the table&apos;s next order waits.
              </p>
            </div>
            <Switch
              id="hold-auto"
              checked={settings.hold_auto_admitted ?? false}
              onCheckedChange={(v) => patch({ hold_auto_admitted: v })}
            />
          </div>

          <div className="flex items-start justify-between gap-4">
            <div>
              <Label htmlFor="hold-second" className="font-sans font-semibold">Hold a second session on one table</Label>
              <p className="text-xs text-muted-foreground font-sans mt-0.5">
                Two separate groups ordering on the same table number usually means one of them is not there.
              </p>
            </div>
            <Switch
              id="hold-second"
              checked={settings.hold_second_session ?? false}
              onCheckedChange={(v) => patch({ hold_second_session: v })}
            />
          </div>

          <div className="pt-2 border-t border-border space-y-1.5">
            <p className="font-sans font-semibold text-sm">Service hours</p>
            <p className="text-xs text-muted-foreground font-sans leading-relaxed">
              Orders placed outside these hours (Sarajevo time) wait. Hours may run past midnight — 08:00 to
              01:00 works. Leave either empty for no limit.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="service-open" className="text-xs font-sans">Opens</Label>
                <Input
                  id="service-open" type="time" className="mt-1"
                  defaultValue={hhmm(settings.service_open)}
                  onBlur={(e) => patch({ service_open: e.target.value || null })}
                />
              </div>
              <div>
                <Label htmlFor="service-close" className="text-xs font-sans">Closes</Label>
                <Input
                  id="service-close" type="time" className="mt-1"
                  defaultValue={hhmm(settings.service_close)}
                  onBlur={(e) => patch({ service_close: e.target.value || null })}
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border">
        <CardHeader>
          <CardTitle className="font-serif text-lg flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary" /> Suggestions
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <Label htmlFor="recos" className="font-sans font-semibold">Show suggestions to guests</Label>
              <p className="text-xs text-muted-foreground font-sans mt-0.5">
                One at a time, always dismissible. Sold-out items are never suggested.
              </p>
            </div>
            <Switch id="recos" checked={settings.recommendations_enabled} onCheckedChange={(v) => patch({ recommendations_enabled: v })} />
          </div>

          <div className="rounded-xl border border-border p-4 space-y-3">
            <p className="font-sans font-semibold text-sm">Add a suggestion</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label className="text-xs font-sans">When the guest orders…</Label>
                <Select value={draft.source} onValueChange={(v) => setDraft((d) => ({ ...d, source: v }))}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder={draft.type === 'after_meal' ? 'Any order' : 'Choose an item'} /></SelectTrigger>
                  <SelectContent className="max-h-72">
                    {items.map((i) => <SelectItem key={i.id} value={i.id}>{i.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs font-sans">…suggest</Label>
                <Select value={draft.target} onValueChange={(v) => setDraft((d) => ({ ...d, target: v }))}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Choose an item" /></SelectTrigger>
                  <SelectContent className="max-h-72">
                    {items.map((i) => <SelectItem key={i.id} value={i.id}>{i.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs font-sans">Kind</Label>
                <Select value={draft.type} onValueChange={(v) => setDraft((d) => ({ ...d, type: v }))}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {RECOMMENDATION_TYPES.map((rt) => <SelectItem key={rt.value} value={rt.value}>{rt.label}</SelectItem>)}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground font-sans mt-1">
                  {RECOMMENDATION_TYPES.find((rt) => rt.value === draft.type)?.hint}
                </p>
              </div>
              <div>
                <Label className="text-xs font-sans">Priority (0–100)</Label>
                <Input
                  type="number" min={0} max={100} className="mt-1"
                  value={draft.priority}
                  onChange={(e) => setDraft((d) => ({ ...d, priority: Math.min(100, Math.max(0, Number(e.target.value) || 0)) }))}
                />
              </div>
            </div>
            <Button onClick={addReco} className="gap-1.5"><Plus className="w-4 h-4" /> Add suggestion</Button>
          </div>

          {recos.length === 0 ? (
            <p className="text-sm text-muted-foreground font-sans py-4 text-center">
              No curated suggestions yet — guests are shown popular items instead.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {recos.map((r) => (
                <li key={r.id} className="flex items-center gap-3 py-3">
                  <div className="flex-1 min-w-0">
                    <p className="font-sans text-sm text-foreground">
                      <span className="text-muted-foreground">{nameOf(r.source_item_id)}</span>
                      {' → '}
                      <strong>{nameOf(r.recommended_item_id)}</strong>
                    </p>
                    <p className="text-[11px] text-muted-foreground font-sans">
                      {RECOMMENDATION_TYPES.find((rt) => rt.value === r.recommendation_type)?.label ?? r.recommendation_type}
                      {' · priority '}{r.priority}
                    </p>
                  </div>
                  <Switch checked={r.enabled} onCheckedChange={() => toggleReco(r)} aria-label="Enabled" />
                  <Button variant="ghost" size="icon" onClick={() => removeReco(r.id)} aria-label="Remove suggestion">
                    <Trash2 className="w-4 h-4 text-destructive" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card className="border-border">
        <CardHeader>
          <CardTitle className="font-serif text-lg flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-accent" /> How suggestions are chosen
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <p className="text-sm font-sans text-muted-foreground leading-relaxed">
            First, a suggestion has to belong: one of your pairings, or something that goes with what
            is on the table (a drink with food, fries with a burger, a salad with pasta, coffee or
            dessert after the meal). Nothing else is ever shown — an empty card is better than a
            wrong one. Among what belongs, each candidate is scored from four signals and the
            highest wins. Raise a number to lean on that signal more. The safety rules always apply
            on top: never a sold-out dish, never something already in the cart, never a second main
            or a second side.
            See <strong>Menu intelligence</strong> for what it is currently learning.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {([
              ['reco_weight_curated',  'Your own rules',        'Pairings you added by hand.'],
              ['reco_weight_observed', 'What sells together',   'Measured from real orders.'],
              ['reco_weight_learned',  'What guests accept',    'How often it is ordered when shown — paid orders only.'],
              ['reco_weight_margin',   'Profitability',         'Added to the line above: suggestions are ranked by acceptance × margin. Internal only.'],
              ['reco_exploration',     'Try new items',         'How much room a new dish gets to prove itself.'],
            ] as const).map(([key, label, hint]) => (
              <div key={key}>
                <Label htmlFor={key} className="font-sans font-semibold text-sm">{label}</Label>
                <p className="text-xs text-muted-foreground font-sans mb-1.5">{hint}</p>
                <Input
                  id={key}
                  type="number"
                  min={0}
                  max={key === 'reco_exploration' ? 50 : 100}
                  defaultValue={settings[key]}
                  onBlur={(e) => patch({ [key]: Math.max(0, Number(e.target.value) || 0) } as Partial<Settings>)}
                />
              </div>
            ))}
          </div>

          <div className="pt-4 border-t border-border">
            <Label htmlFor="holdout" className="font-sans font-semibold text-sm">
              Measurement holdout (% of tables that see no suggestions)
            </Label>
            <p className="text-xs text-muted-foreground font-sans mb-1.5 leading-relaxed">
              Leave at 0 normally. Set it to 10 for a couple of weeks when you want to know what the
              suggestions are <em>really</em> worth: comparing those tables against the rest is the
              only honest way to separate "the guest took our suggestion" from "the guest was going
              to order a coffee anyway". The comparison appears under Menu intelligence.
            </p>
            <Input
              id="holdout"
              type="number"
              min={0}
              max={50}
              defaultValue={settings.reco_holdout_pct}
              onBlur={(e) => patch({ reco_holdout_pct: Math.min(50, Math.max(0, Number(e.target.value) || 0)) })}
            />
            <p className="text-xs text-muted-foreground font-sans mt-2 leading-relaxed">
              The fastest honest answer is 50 for three to four weeks: a 10% holdout needs almost three
              times as many tables to say the same thing. Setting the number does not start a measurement
              on its own.
            </p>
            <Button
              variant="outline"
              className="mt-2 min-h-[44px]"
              disabled={settings.reco_holdout_pct < 1}
              onClick={() => void startMeasurement(settings.reco_holdout_pct)}
            >
              Start measuring at {settings.reco_holdout_pct}%
            </Button>
          </div>

          <div className="pt-4 border-t border-border">
            <Label htmlFor="idle" className="font-sans font-semibold text-sm">
              Close an idle table session after (minutes)
            </Label>
            <p className="text-xs text-muted-foreground font-sans mb-1.5 leading-relaxed">
              The guest app checks in every minute while it is open, so this only ends sessions
              nobody has touched for hours. It is what makes a returning guest type their table
              number again instead of resuming a session from a previous visit.
            </p>
            <Input
              id="idle"
              type="number"
              min={15}
              max={1440}
              defaultValue={settings.session_idle_timeout_minutes}
              onBlur={(e) => patch({ session_idle_timeout_minutes: Math.min(1440, Math.max(15, Number(e.target.value) || 180)) })}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

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
    <div className="rounded-xl border border-border bg-muted/30 px-3 py-2.5 space-y-2 text-xs font-sans">
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
          When Monri issues the online merchant account, add MONRI_MERCHANT_KEY, MONRI_AUTHENTICITY_TOKEN and
          MONRI_ENVIRONMENT as Edge Function secrets — no rebuild needed. Then this switch can be turned on.
        </p>
      )}
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-muted-foreground shrink-0">Callback URL for Monri</span>
        <code className="truncate rounded bg-background px-1.5 py-0.5 border border-border">{status.webhookUrl}</code>
        <Button type="button" variant="ghost" size="sm" className="h-7 px-2 shrink-0" onClick={copy} aria-label="Copy callback URL">
          <Copy className="w-3.5 h-3.5" />
        </Button>
      </div>
    </div>
  );
};

export default AdminService;
