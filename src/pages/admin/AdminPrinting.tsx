import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Printer, Loader2, Tablet } from 'lucide-react';
import { toast } from 'sonner';
import { buildKitchenTicketLines, printKitchenTicket, type KitchenTicketOrder } from '@/lib/ticket-export';
import PrinterSetupGuide from '@/components/admin/PrinterSetupGuide';
import CloudPrinters from '@/components/admin/CloudPrinters';
import PrintQueue from '@/components/admin/PrintQueue';
import TicketPreview from '@/components/admin/TicketPreview';

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

/** Every kind of line a real ticket has, so the preview shows them all. */
const SAMPLE: KitchenTicketOrder = {
  id: 'test-0000-0000', order_code: '047', status: 'pending', total: 45, tip_amount: 0,
  payment_method: 'cash', payment_status: 'unpaid',
  notes: 'Bring the mains together', created_at: new Date().toISOString(), table_number: 7,
  guest_name: 'Amina', section_name: 'Terasa', waiter_name: 'Marko',
  items: [
    {
      quantity: 2, notes: 'no onions, well done', menu_item_name: 'La Soul Burger', unit_price: 18,
      station: 'kitchen', allergens: ['gluten', 'sesame'],
      components: [{ slot_label: 'Side', name: 'Pomfrit', station: 'kitchen' }, { slot_label: 'Drink', name: 'Coca-Cola', station: 'bar' }],
    },
    { quantity: 1, notes: null, menu_item_name: 'Ćevapi (10 kom)', unit_price: 6, station: 'kitchen', allergens: ['gluten'] },
    { quantity: 2, notes: 'extra hot', menu_item_name: 'Espresso', unit_price: 1.5, station: 'bar' },
  ],
};

type PreviewStation = 'kitchen' | 'bar';

/** A small row of pills — one tap to pick, and the choice is always visible. */
const Segmented = ({ value, options, onChange, label }: {
  value: string | number; options: { value: string | number; label: string }[];
  onChange: (v: string | number) => void; label: string;
}) => (
  <div className="inline-flex rounded-full border border-border overflow-hidden" role="group" aria-label={label}>
    {options.map((o) => (
      <button
        key={String(o.value)} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)}
        className={`px-3 min-h-[40px] text-sm font-sans tabular-nums ${value === o.value ? 'bg-foreground text-background' : 'bg-card text-muted-foreground'}`}
      >
        {o.label}
      </button>
    ))}
  </div>
);


const AdminPrinting = () => {
  const [cfg, setCfg] = useState<PrintConfig>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [previewStation, setPreviewStation] = useState<PreviewStation>('kitchen');
  /** This restaurant's settings row (La Soul's is 1). */
  const [rowId, setRowId] = useState<number | null>(null);

  const load = useCallback(async () => {
    // One row: the access rules show this restaurant's settings only.
    const { data } = await supabase
      .from('restaurant_settings')
      .select(['id', ...PRINT_FIELDS].join(','))
      .maybeSingle();
    if (data) {
      setRowId((data as unknown as { id: number }).id);
      setCfg(pickPrintFields(data as unknown as Record<string, unknown>));
    }
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const save = async () => {
    if (rowId === null) return;
    setSaving(true);
    const { error } = await supabase.from('restaurant_settings')
      .update({ ...pickPrintFields(cfg as unknown as Record<string, unknown>), updated_at: new Date().toISOString() })
      .eq('id', rowId);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success('Printing settings saved');
  };

  const settings = useMemo(() => ({
    paperWidth: cfg.print_paper_width, header: cfg.print_header, footer: cfg.print_footer,
    showPrices: cfg.print_show_prices, copies: cfg.print_copies,
  }), [cfg]);

  const previewLines = useMemo(
    () => buildKitchenTicketLines({ ...SAMPLE, created_at: new Date().toISOString() }, { ...settings, station: previewStation }),
    [settings, previewStation],
  );

  /** Browser print of the sample — for a printer attached to this device. */
  const testPrint = async () => {
    const outcome = await printKitchenTicket(SAMPLE, { ...settings, station: 'kitchen', test: true });
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
    <div className="max-w-5xl mx-auto space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-serif text-3xl font-bold text-foreground flex items-center gap-2"><Printer className="w-7 h-7 text-primary" /> Printing</h1>
          <p className="text-sm text-muted-foreground font-sans mt-1">Kitchen and bar tickets. The fiscal receipt printer (Tring) is separate.</p>
        </div>
        <Button onClick={save} disabled={saving || loading} className="min-h-[44px] min-w-[96px]">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save settings'}
        </Button>
      </div>

      <CloudPrinters />
      <PrintQueue />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)] items-start">
        {loading ? (
          <Skeleton className="h-80 w-full rounded-xl" />
        ) : (
          <div className="space-y-4">
            <Card>
              <CardContent className="p-4 sm:p-5">
                <Row label="Printing on" hint="Master switch for every kitchen and bar ticket">
                  <Switch checked={cfg.print_enabled} onCheckedChange={(v) => setCfg({ ...cfg, print_enabled: v })} aria-label="Printing on" />
                </Row>
                <Row label="Print new orders by themselves" hint="On the tablet set as printer. Network printers always print. Held orders print only once a waiter confirms them.">
                  <Switch checked={cfg.print_auto} onCheckedChange={(v) => setCfg({ ...cfg, print_auto: v })} aria-label="Print new orders by themselves" />
                </Row>
                <Row label="Prices on full tickets" hint="Kitchen and bar tickets never show money">
                  <Switch checked={cfg.print_show_prices} onCheckedChange={(v) => setCfg({ ...cfg, print_show_prices: v })} aria-label="Prices on full tickets" />
                </Row>
                <Row label="Paper width" hint="Tablet printing. Each network printer has its own.">
                  <Segmented label="Paper width" value={cfg.print_paper_width} onChange={(v) => setCfg({ ...cfg, print_paper_width: Number(v) })}
                    options={[{ value: 80, label: '80 mm' }, { value: 58, label: '58 mm' }]} />
                </Row>
                <Row label="Copies per ticket">
                  <Segmented label="Copies per ticket" value={cfg.print_copies} onChange={(v) => setCfg({ ...cfg, print_copies: Number(v) })}
                    options={[1, 2, 3].map((n) => ({ value: n, label: String(n) }))} />
                </Row>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2"><CardTitle className="font-serif text-lg">Top and bottom of the ticket</CardTitle></CardHeader>
              <CardContent className="p-4 sm:p-5 pt-0 space-y-3">
                <div>
                  <Label htmlFor="print-header" className="text-xs text-muted-foreground">Top line</Label>
                  <Input id="print-header" value={cfg.print_header} onChange={(e) => setCfg({ ...cfg, print_header: e.target.value })} className="mt-1 h-11" placeholder="La Soul" />
                </div>
                <div>
                  <Label htmlFor="print-footer" className="text-xs text-muted-foreground">Bottom line</Label>
                  <Input id="print-footer" value={cfg.print_footer} onChange={(e) => setCfg({ ...cfg, print_footer: e.target.value })} className="mt-1 h-11" placeholder="Hvala / Thank you" />
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        <Card className="lg:sticky lg:top-4">
          <CardContent className="p-4 sm:p-5 space-y-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <h2 className="font-serif text-lg font-semibold text-foreground">What prints</h2>
              <Segmented label="Preview station" value={previewStation} onChange={(v) => setPreviewStation(v as PreviewStation)}
                options={[{ value: 'kitchen', label: 'Kitchen' }, { value: 'bar', label: 'Bar' }]} />
            </div>
            <TicketPreview lines={previewLines} paperWidth={cfg.print_paper_width} />
            <p className="text-[11px] text-muted-foreground font-sans">
              Notes and allergens print white on black. Bosnian letters print as c, z, s, dj — thermal printers do not have č, ć, ž, š, đ.
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="pt-2">
        <h2 className="font-serif text-xl font-semibold text-foreground flex items-center gap-2 mb-2">
          <Tablet className="w-5 h-5 text-primary" /> Or print from a tablet
        </h2>
        <p className="text-sm text-muted-foreground font-sans mb-3">
          For a USB or Bluetooth printer next to the kitchen tablet. The tablet has to stay on with the Kitchen screen open.
          If a network printer above is online for a station, the tablet leaves that station to it.
        </p>
        <PrinterSetupGuide settings={settings} onTestPrint={testPrint} />
      </div>
    </div>
  );
};

export default AdminPrinting;
