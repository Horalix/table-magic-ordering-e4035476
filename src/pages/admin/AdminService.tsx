import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertTriangle, Plus, Trash2, Sparkles, PauseCircle } from 'lucide-react';
import { toast } from 'sonner';

interface Settings {
  ordering_enabled: boolean;
  online_card_enabled: boolean;
  pay_at_table_enabled: boolean;
  recommendations_enabled: boolean;
  ordering_paused_message: string | null;
  kitchen_delay_minutes: number;
  last_order_time: string | null;
}

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
  const [draft, setDraft] = useState({ source: '', target: '', type: 'pair_with', priority: 60 });

  const load = useCallback(async () => {
    const [{ data: s }, { data: r }, { data: m }] = await Promise.all([
      supabase.from('restaurant_settings').select('*').eq('id', 1).maybeSingle(),
      supabase.from('menu_item_recommendations').select('*').order('priority', { ascending: false }).limit(200),
      supabase.from('menu_items').select('id, name').order('name').limit(500),
    ]);
    if (s) setSettings(s as unknown as Settings);
    setRecos((r ?? []) as unknown as Reco[]);
    setItems((m ?? []) as MenuOption[]);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const patch = async (changes: Partial<Settings>) => {
    setSettings((prev) => (prev ? { ...prev, ...changes } : prev));
    const { error } = await supabase.from('restaurant_settings').update(changes as never).eq('id', 1);
    if (error) { toast.error(error.message); void load(); return; }
    toast.success('Saved');
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
            <Switch id="ordering" checked={settings.ordering_enabled} onCheckedChange={(v) => patch({ ordering_enabled: v })} />
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
            <Switch id="card-online" checked={settings.online_card_enabled} onCheckedChange={(v) => patch({ online_card_enabled: v })} />
          </div>

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
    </div>
  );
};

export default AdminService;
