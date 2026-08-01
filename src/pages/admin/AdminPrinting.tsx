import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Printer, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { printKitchenTicket } from '@/lib/ticket-export';
import PrinterSetupGuide from '@/components/admin/PrinterSetupGuide';

interface PrintConfig {
  print_enabled: boolean;
  print_auto: boolean;
  print_paper_width: number;
  print_header: string;
  print_footer: string;
  print_show_prices: boolean;
  print_copies: number;
}

const DEFAULTS: PrintConfig = {
  print_enabled: true, print_auto: true, print_paper_width: 80,
  print_header: 'La Soul', print_footer: 'Hvala / Thank you', print_show_prices: true, print_copies: 1,
};

/**
 * The only columns this page owns.
 *
 * `restaurant_settings` is a singleton row shared with ordering switches, the
 * recommendation weights and the venue QR token. Loading `select('*')` into
 * state and spreading it back on save meant this page silently rewrote all of
 * them with whatever was true when it was opened — un-pausing ordering, and
 * reverting the venue QR token, which kills every code printed since.
 * Read narrow, write narrow.
 */
const PRINT_FIELDS = Object.keys(DEFAULTS) as (keyof PrintConfig)[];

const pickPrintFields = (row: Record<string, unknown>): PrintConfig => {
  const picked = { ...DEFAULTS };
  for (const key of PRINT_FIELDS) {
    const value = row[key];
    if (value !== undefined && value !== null) {
      (picked as Record<string, unknown>)[key] = value;
    }
  }
  return picked;
};

const AdminPrinting = () => {
  const [cfg, setCfg] = useState<PrintConfig>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('restaurant_settings')
      .select(PRINT_FIELDS.join(','))
      .eq('id', 1)
      .maybeSingle();
    if (data) setCfg(pickPrintFields(data as unknown as Record<string, unknown>));
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const save = async () => {
    setSaving(true);
    const { error } = await supabase.from('restaurant_settings')
      .update({ ...pickPrintFields(cfg as unknown as Record<string, unknown>), updated_at: new Date().toISOString() })
      .eq('id', 1);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success('Printing settings saved');
  };

  const testPrint = async () => {
    const outcome = await printKitchenTicket({
      id: 'test-0000-0000', status: 'pending', total: 27.5, tip_amount: 2.5, payment_method: 'card',
      notes: 'Allergy: nuts', created_at: new Date().toISOString(), table_number: 5, guest_name: 'Test',
      section_name: 'Terrace',
      items: [
        { quantity: 1, notes: 'no onions', menu_item_name: 'La Soul Burger', unit_price: 18 },
        { quantity: 2, notes: null, menu_item_name: 'Espresso', unit_price: 3.5 },
      ],
    }, { paperWidth: cfg.print_paper_width, header: cfg.print_header, footer: cfg.print_footer, showPrices: cfg.print_show_prices, copies: cfg.print_copies });
    // A browser print dialog can only ever tell us it closed, never that paper
    // came out — so this says what it actually knows.
    if (!outcome.ok) toast.error(outcome.reason);
    else toast.success('Sent to the browser print dialog — check the paper came out.');
  };

  const Row = ({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) => (
    <div className="flex items-center justify-between gap-4 py-3 border-b border-border last:border-0">
      <div className="min-w-0">
        <p className="font-sans text-sm font-medium text-foreground">{label}</p>
        {hint && <p className="text-xs text-muted-foreground font-sans mt-0.5">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <h1 className="font-serif text-3xl font-bold text-foreground flex items-center gap-2"><Printer className="w-7 h-7 text-primary" /> Kitchen Printing</h1>
        <div className="flex gap-2">
          <Button variant="outline" onClick={testPrint} className="gap-1.5"><Printer className="w-4 h-4" /> Test print</Button>
          <Button onClick={save} disabled={saving || loading}>{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save'}</Button>
        </div>
      </div>

      {loading ? (
        <Skeleton className="h-80 w-full rounded-xl" />
      ) : (
        <>
          <Card className="mb-4">
            <CardContent className="p-5">
              <Row label="Printing enabled" hint="Master switch for all kitchen tickets">
                <Switch checked={cfg.print_enabled} onCheckedChange={(v) => setCfg({ ...cfg, print_enabled: v })} />
              </Row>
              <Row label="Auto-print new orders" hint="Print automatically the moment an order arrives (on the designated kitchen device)">
                <Switch checked={cfg.print_auto} onCheckedChange={(v) => setCfg({ ...cfg, print_auto: v })} />
              </Row>
              <Row label="Show prices on ticket">
                <Switch checked={cfg.print_show_prices} onCheckedChange={(v) => setCfg({ ...cfg, print_show_prices: v })} />
              </Row>
              <Row label="Paper width">
                <Select value={String(cfg.print_paper_width)} onValueChange={(v) => setCfg({ ...cfg, print_paper_width: Number(v) })}>
                  <SelectTrigger className="w-[120px] h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="58">58 mm</SelectItem>
                    <SelectItem value="80">80 mm</SelectItem>
                  </SelectContent>
                </Select>
              </Row>
              <Row label="Copies per ticket">
                <Select value={String(cfg.print_copies)} onValueChange={(v) => setCfg({ ...cfg, print_copies: Number(v) })}>
                  <SelectTrigger className="w-[100px] h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {[1, 2, 3].map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Row>
            </CardContent>
          </Card>

          <Card className="mb-4">
            <CardHeader><CardTitle className="font-serif text-lg">Ticket header & footer</CardTitle></CardHeader>
            <CardContent className="p-5 pt-0 space-y-3">
              <div>
                <Label className="text-xs text-muted-foreground">Header (top of ticket)</Label>
                <Input value={cfg.print_header} onChange={(e) => setCfg({ ...cfg, print_header: e.target.value })} className="mt-1" placeholder="La Soul" />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Footer (bottom of ticket)</Label>
                <Input value={cfg.print_footer} onChange={(e) => setCfg({ ...cfg, print_footer: e.target.value })} className="mt-1" placeholder="Hvala / Thank you" />
              </div>
            </CardContent>
          </Card>

          <PrinterSetupGuide
            settings={{ paperWidth: cfg.print_paper_width, header: cfg.print_header, footer: cfg.print_footer, showPrices: cfg.print_show_prices, copies: cfg.print_copies }}
            onTestPrint={testPrint}
          />
        </>
      )}
    </div>
  );
};

export default AdminPrinting;
