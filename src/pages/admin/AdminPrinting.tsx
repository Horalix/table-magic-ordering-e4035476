import { DEMO_MODE } from '@/lib/demo-mode';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertTriangle, Check, Eye, Loader2, Plus, SlidersHorizontal } from 'lucide-react';
import { toast } from 'sonner';
import { buildKitchenTicketLines, printKitchenTicket, type KitchenTicketOrder } from '@/lib/ticket-export';
import { AdminPageHeader } from '@/components/admin/AdminPage';
import { AdminCard, AdminCardContent, AdminCardHeader, Stagger } from '@/components/admin/AdminCard';
import PrinterSetupGuide from '@/components/admin/PrinterSetupGuide';
import CloudPrinters, { Segmented, type CloudPrintersState } from '@/components/admin/CloudPrinters';
import PrintQueue from '@/components/admin/PrintQueue';
import TicketPreview from '@/components/admin/TicketPreview';
import { TONE } from '@/components/staff/status-tone';
import { stationCovers } from '@/lib/print-routing';
import type { PrinterRow } from '@/lib/printers-api';
import { formatClock } from '@/lib/timing';
import { cn } from '@/lib/utils';
import type { AdminOutletContext } from '@/components/admin/AdminLayout';

interface PrintConfig {
  print_enabled: boolean;
  print_auto: boolean;
  print_paper_width: number;
  print_header: string;
  print_footer: string;
  print_show_prices: boolean;
  print_copies: number;
}

/** No header of its own: one restaurant's name must never default onto the other's tickets. */
const DEFAULTS: PrintConfig = {
  print_enabled: true, print_auto: true, print_paper_width: 80,
  print_header: '', print_footer: 'Hvala / Thank you', print_show_prices: true, print_copies: 1,
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

const sameConfig = (a: PrintConfig, b: PrintConfig) => PRINT_FIELDS.every((k) => a[k] === b[k]);

/** Every kind of line a real ticket has, so the preview shows them all. */
const SAMPLE: KitchenTicketOrder = {
  id: 'test-0000-0000', order_code: '047', status: 'pending', total: 45, tip_amount: 0,
  payment_method: 'cash', payment_status: 'unpaid',
  notes: 'Bring the mains together', created_at: new Date().toISOString(), table_number: 7,
  guest_name: 'Amina', section_name: 'Terasa', waiter_name: 'Marko',
  items: [
    {
      quantity: 2, notes: 'no onions, well done', menu_item_name: DEMO_MODE ? 'Casa Burger' : 'La Soul Burger', unit_price: 18,
      station: 'kitchen', allergens: ['gluten', 'sesame'],
      components: [{ slot_label: 'Side', name: 'Pomfrit', station: 'kitchen' }, { slot_label: 'Drink', name: 'Coca-Cola', station: 'bar' }],
    },
    { quantity: 1, notes: null, menu_item_name: 'Ćevapi (10 kom)', unit_price: 6, station: 'kitchen', allergens: ['gluten'] },
    { quantity: 2, notes: 'extra hot', menu_item_name: 'Espresso', unit_price: 1.5, station: 'bar' },
  ],
};

type PreviewStation = 'kitchen' | 'bar';

const scrollBehavior = (): ScrollBehavior =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';

const TABLET_GUIDE_ID = 'tablet-printing';
/** Ids inside the Network printers card (CloudPrinters.tsx). */
const NETWORK_PRINTERS_ID = 'network-printers';
const ADD_PRINTER_INPUT_ID = 'add-printer-name';

/** Take the manager to the add-printer form, with the name ready to type over. */
const goToAddPrinter = () => {
  document.getElementById(NETWORK_PRINTERS_ID)?.scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
  const input = document.getElementById(ADD_PRINTER_INPUT_ID) as HTMLInputElement | null;
  input?.focus({ preventScroll: true });
  input?.select();
};


/** Seen in the last minute: the test the Network printers card uses for Online. */
const isOnline = (p: Pick<PrinterRow, 'last_seen_at'>) =>
  !!p.last_seen_at && Date.now() - new Date(p.last_seen_at).getTime() < 60_000;

/* ---- The three setup steps -------------------------------------------- */

type StepState = 'done' | 'todo' | 'busy' | 'problem';
interface SetupStep { title: string; state: StepState; detail: string; action?: React.ReactNode }

const names = (list: { name: string }[]) =>
  list.length <= 2 ? list.map((p) => p.name).join(' and ') : `${list.length} printers`;

const whenPrinted = (iso: string) => {
  const d = new Date(iso);
  return d.toDateString() === new Date().toDateString()
    ? formatClock(iso)
    : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
};

/**
 * Where setup stands, read off the printer list the Network printers card
 * already loads: is one calling in, does each station have one, has a test
 * page come out. Nothing here is fetched twice or saved.
 */
function setupSteps(list: PrinterRow[]): SetupStep[] {
  const enabled = list.filter((p) => p.enabled);
  const online = enabled.filter(isOnline);
  const seen = enabled.filter((p) => p.last_seen_at);

  const connect: SetupStep = list.length === 0
    ? { title: 'Connect a printer', state: 'todo', detail: 'No printer added yet.', action: <StepLink onClick={goToAddPrinter}>Add a printer</StepLink> }
    : online.length > 0
      ? { title: 'Connect a printer', state: 'done', detail: `${names(online)} ${online.length === 1 ? 'is' : 'are'} online.` }
      : seen.length > 0
        ? { title: 'Connect a printer', state: 'problem', detail: `${names(seen)} ${seen.length === 1 ? 'is' : 'are'} offline. Check it is switched on and plugged into the router.` }
        : enabled.length === 0
          ? { title: 'Connect a printer', state: 'todo', detail: 'Every printer is switched off here. Turn one on from its ⋯ menu.' }
          : { title: 'Connect a printer', state: 'busy', detail: 'Added. Paste its address into the printer; it shows Online once it calls in.' };

  const kitchen = enabled.some((p) => stationCovers(p.station, 'kitchen'));
  const bar = enabled.some((p) => stationCovers(p.station, 'bar'));
  const stations: SetupStep = kitchen && bar
    ? { title: 'Give each station a printer', state: 'done', detail: 'Kitchen and bar tickets both have a printer.' }
    : kitchen
      ? { title: 'Give each station a printer', state: 'todo', detail: 'Kitchen is covered. Bar tickets have no printer yet.' }
      : bar
        ? { title: 'Give each station a printer', state: 'todo', detail: 'Bar is covered. Kitchen tickets have no printer yet.' }
        : { title: 'Give each station a printer', state: 'todo', detail: 'Choose what each printer prints: kitchen, bar, or both.' };

  const pending = list.some((p) => p.test_requested_at && (!p.last_test_printed_at || p.last_test_printed_at < p.test_requested_at));
  const lastTest = list
    .filter((p) => p.last_test_printed_at)
    .sort((a, b) => String(b.last_test_printed_at).localeCompare(String(a.last_test_printed_at)))[0];
  const test: SetupStep = pending
    ? { title: 'Print a test', state: 'busy', detail: 'Test sent. It prints on the printer’s next call.' }
    : lastTest?.last_test_printed_at
      ? { title: 'Print a test', state: 'done', detail: `Printed ${whenPrinted(lastTest.last_test_printed_at)} on ${lastTest.name}.` }
      : { title: 'Print a test', state: 'todo', detail: 'Press Test print next to a printer, then check the paper.' };

  return [connect, stations, test];
}

const StepLink = ({ onClick, children }: { onClick: () => void; children: React.ReactNode }) => (
  <button
    type="button" onClick={onClick}
    className="-my-2 inline-flex min-h-[44px] items-center text-sm font-sans font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:my-0 sm:min-h-0"
  >
    {children}
  </button>
);

const STEP_WORD: Record<StepState, string> = { done: 'Done', todo: 'To do', busy: 'Waiting', problem: 'Needs attention' };

const StepMark = ({ n, state, current }: { n: number; state: StepState; current: boolean }) => (
  <span
    className={cn(
      'grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-semibold font-sans tabular-nums',
      state === 'done' && TONE.ready.solid,
      state === 'problem' && TONE.late.solid,
      state === 'busy' && cn('border-2', TONE.preparing.border, TONE.preparing.text),
      state === 'todo' && (current ? 'border-2 border-primary text-primary' : 'border border-border text-muted-foreground'),
    )}
    aria-hidden
  >
    {state === 'done' ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : state === 'problem' ? <AlertTriangle className="h-3.5 w-3.5" /> : n}
  </span>
);

const SetupCard = ({ state }: { state: CloudPrintersState }) => {
  if (state.printers === null) {
    return (
      <AdminCard aria-hidden>
        <div className="grid gap-5 p-5 sm:grid-cols-3 sm:p-6">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex gap-3"><Skeleton className="h-7 w-7 rounded-full" /><div className="flex-1 space-y-2"><Skeleton className="h-4 w-32" /><Skeleton className="h-3 w-full" /></div></div>
          ))}
        </div>
      </AdminCard>
    );
  }
  const steps = setupSteps(state.printers);
  const allDone = steps.every((s) => s.state === 'done');
  const current = steps.findIndex((s) => s.state !== 'done');
  return (
    <AdminCard>
      <AdminCardHeader
        title={allDone ? 'Printing is set up' : 'Get printing working'}
        description={allDone
          ? 'Every station has a printer that is online, and a test page has come out. Each step below keeps checking.'
          : 'Three steps. Each one ticks itself off as the printers report in.'}
      />
      <AdminCardContent>
        <ol className="grid gap-x-6 gap-y-4 sm:grid-cols-3">
          {steps.map((s, i) => (
            <li key={s.title} className="flex min-w-0 gap-3">
              <StepMark n={i + 1} state={s.state} current={i === current} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-sans font-semibold leading-7 text-foreground">
                  <span className="sr-only">{STEP_WORD[s.state]}: </span>{s.title}
                </p>
                <p
                  className={cn(
                    'text-[13px] font-sans leading-relaxed',
                    s.state === 'problem' ? TONE.late.text : s.state === 'busy' ? TONE.preparing.text : 'text-muted-foreground',
                  )}
                >
                  {s.detail}
                </p>
                {s.action && <div className="mt-1">{s.action}</div>}
              </div>
            </li>
          ))}
        </ol>
        {state.printers.length === 0 && (
          <p className="mt-5 border-t border-border/70 pt-4 text-[13px] font-sans text-muted-foreground">
            Printing from a tablet instead?{' '}
            <StepLink onClick={() => document.getElementById(TABLET_GUIDE_ID)?.scrollIntoView({ behavior: scrollBehavior(), block: 'start' })}>
              Set it up at the bottom of this page
            </StepLink>
          </p>
        )}
      </AdminCardContent>
    </AdminCard>
  );
};

/* ---- Ticket settings --------------------------------------------------- */

const Row = ({ label, hint, children, stack = false }: { label: string; hint?: string; children: React.ReactNode; stack?: boolean }) => (
  <div className={cn('flex justify-between gap-x-4 gap-y-2.5 py-3.5', stack ? 'flex-col sm:flex-row sm:items-center' : 'items-center')}>
    <div className="min-w-0">
      <p className="text-sm font-sans font-medium text-foreground">{label}</p>
      {hint && <p className="mt-0.5 text-xs font-sans leading-relaxed text-muted-foreground">{hint}</p>}
    </div>
    <div className="shrink-0">{children}</div>
  </div>
);

const AdminPrinting = () => {
  const venueName = useOutletContext<AdminOutletContext | null>()?.venueName ?? null;
  const [cfg, setCfg] = useState<PrintConfig>(DEFAULTS);
  /** What the database holds, to say when there is something to save. */
  const [savedCfg, setSavedCfg] = useState<PrintConfig>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [previewStation, setPreviewStation] = useState<PreviewStation>('kitchen');
  /** This restaurant's settings row (La Soul's is 1). */
  const [rowId, setRowId] = useState<number | null>(null);
  const [printerState, setPrinterState] = useState<CloudPrintersState>({ printers: null, error: null });

  const load = useCallback(async () => {
    // One row: the access rules show this restaurant's settings only.
    const { data } = await supabase
      .from('restaurant_settings')
      .select(['id', ...PRINT_FIELDS].join(','))
      .maybeSingle();
    if (data) {
      setRowId((data as unknown as { id: number }).id);
      const picked = pickPrintFields(data as unknown as Record<string, unknown>);
      setCfg(picked);
      setSavedCfg(picked);
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
    setSavedCfg(cfg);
    toast.success('Printing settings saved');
  };

  const dirty = !loading && !sameConfig(cfg, savedCfg);

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

  return (
    <div className="mx-auto w-full max-w-5xl">
      <AdminPageHeader
        title="Printing"
        description="Which printer prints the kitchen and bar tickets, and what they look like. The fiscal receipt printer (Tring) is set up separately."
        actions={(
          <Button variant="outline" onClick={goToAddPrinter} className="h-11 gap-1.5 lg:h-10">
            <Plus className="h-4 w-4" /> Add a printer
          </Button>
        )}
      />

      <Stagger className="space-y-6">
        {/* A failed load is not "no printers": the card below says what went wrong. */}
        {!(printerState.error && printerState.printers?.length === 0) && <SetupCard state={printerState} />}
        <CloudPrinters onChange={setPrinterState} />
        <PrintQueue />

        {/* One column that may shrink: an auto track grew to the 80 mm preview
            and pushed a 360px phone 4px sideways. */}
        <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,400px)]">
          <AdminCard>
            <AdminCardHeader
              icon={SlidersHorizontal}
              title="Ticket settings"
              description="For every kitchen and bar ticket. The preview shows a change before you save it."
            />
            {loading ? (
              <AdminCardContent className="space-y-3" aria-hidden>
                {[0, 1, 2, 3, 4].map((i) => (
                  <div key={i} className="flex items-center justify-between gap-4 py-1.5">
                    <div className="flex-1 space-y-2"><Skeleton className="h-4 w-40" /><Skeleton className="h-3 w-64 max-w-full" /></div>
                    <Skeleton className="h-6 w-11 rounded-full" />
                  </div>
                ))}
              </AdminCardContent>
            ) : (
              <>
                <AdminCardContent>
                  <div className="divide-y divide-border/70">
                    <Row label="Printing on" hint="Master switch for every kitchen and bar ticket">
                      <Switch checked={cfg.print_enabled} onCheckedChange={(v) => setCfg({ ...cfg, print_enabled: v })} aria-label="Printing on" />
                    </Row>
                    <Row label="Print new orders by themselves" hint="On the tablet set as printer. Network printers always print. Held orders print only once a waiter confirms them.">
                      <Switch checked={cfg.print_auto} onCheckedChange={(v) => setCfg({ ...cfg, print_auto: v })} aria-label="Print new orders by themselves" />
                    </Row>
                    <Row label="Prices on full tickets" hint="Kitchen and bar tickets never show money">
                      <Switch checked={cfg.print_show_prices} onCheckedChange={(v) => setCfg({ ...cfg, print_show_prices: v })} aria-label="Prices on full tickets" />
                    </Row>
                    <Row label="Paper width" hint="Tablet printing. Each network printer has its own." stack>
                      <Segmented
                        label="Paper width" value={cfg.print_paper_width} onChange={(v) => setCfg({ ...cfg, print_paper_width: Number(v) })}
                        options={[{ value: 80, label: '80 mm' }, { value: 58, label: '58 mm' }]}
                      />
                    </Row>
                    <Row label="Copies per ticket" stack>
                      <Segmented
                        label="Copies per ticket" value={cfg.print_copies} onChange={(v) => setCfg({ ...cfg, print_copies: Number(v) })}
                        options={[1, 2, 3].map((n) => ({ value: n, label: String(n) }))} className="min-w-[132px]"
                      />
                    </Row>
                  </div>

                  <div className="mt-2 border-t border-border/70 pt-4">
                    <p className="text-sm font-sans font-medium text-foreground">Top and bottom of the ticket</p>
                    <div className="mt-3 grid gap-4 sm:grid-cols-2">
                      <div>
                        <Label htmlFor="print-header" className="text-xs font-medium text-muted-foreground">Top line</Label>
                        <Input id="print-header" value={cfg.print_header} onChange={(e) => setCfg({ ...cfg, print_header: e.target.value })} className="mt-1.5 h-11" placeholder={venueName ?? undefined} />
                      </div>
                      <div>
                        <Label htmlFor="print-footer" className="text-xs font-medium text-muted-foreground">Bottom line</Label>
                        <Input id="print-footer" value={cfg.print_footer} onChange={(e) => setCfg({ ...cfg, print_footer: e.target.value })} className="mt-1.5 h-11" placeholder="Hvala / Thank you" />
                      </div>
                    </div>
                  </div>
                </AdminCardContent>
                <div className="flex flex-col-reverse items-stretch gap-3 rounded-b-2xl border-t border-border/70 bg-muted/30 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
                  <p className="flex items-center justify-center gap-2 text-xs font-sans text-muted-foreground sm:justify-start" aria-live="polite">
                    {dirty && <span className={cn('h-1.5 w-1.5 rounded-full', TONE.preparing.dot)} aria-hidden />}
                    {dirty ? 'Changes not saved yet' : 'Saved. Applies from the next ticket.'}
                  </p>
                  <Button onClick={save} disabled={saving || loading} className="h-11 w-full lg:h-10 sm:w-auto sm:min-w-[132px]">
                    {saving ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-label="Saving" /> : 'Save settings'}
                  </Button>
                </div>
              </>
            )}
          </AdminCard>

          <AdminCard className="lg:sticky lg:top-[calc(var(--admin-top,0px)+1.5rem)]">
            <AdminCardHeader
              icon={Eye}
              title="What prints"
              action={(
                <Segmented
                  label="Preview station" value={previewStation} onChange={setPreviewStation}
                  options={[{ value: 'kitchen', label: 'Kitchen' }, { value: 'bar', label: 'Bar' }]}
                />
              )}
            />
            <AdminCardContent className="space-y-3 px-3 sm:px-6">
              <div className="rounded-xl bg-muted/50 px-2 py-5 sm:px-4">
                <TicketPreview lines={previewLines} paperWidth={cfg.print_paper_width} />
              </div>
              <p className="px-2 text-xs font-sans leading-relaxed text-muted-foreground sm:px-0">
                Notes and allergens print white on black. Bosnian letters print as c, z, s, dj — thermal printers do not have č, ć, ž, š, đ.
              </p>
            </AdminCardContent>
          </AdminCard>
        </div>

        <div id={TABLET_GUIDE_ID} className="scroll-mt-6">
          <PrinterSetupGuide settings={settings} onTestPrint={testPrint} />
        </div>
      </Stagger>
    </div>
  );
};

export default AdminPrinting;
