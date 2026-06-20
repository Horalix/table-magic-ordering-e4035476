import React, { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Monitor, Wifi, Bluetooth, Copy, Check, Printer, ChevronDown, Loader2, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { buildKitchenTicketText, type KitchenPrintSettings } from '@/lib/ticket-export';
import { bluetoothSupported, connectBluetoothPrinter, connectedPrinterName, disconnectBluetoothPrinter, printTextBluetooth } from '@/lib/printer-connect';

/**
 * Self-serve printer setup. Three real, actionable paths:
 *  - This device (browser) — designate + test, the universal path.
 *  - Bluetooth — pair an ESC/POS printer directly from this page (Chrome/Android).
 *  - Network — a Star/Epson CloudPRNT printer pulls tickets itself.
 */

const origin = typeof window !== 'undefined' ? window.location.origin : 'https://menu.lasoul.net';
const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? 'https://YOUR-PROJECT.supabase.co';
const cloudPrntUrl = `${supabaseUrl}/functions/v1/cloudprnt?token=YOUR_TOKEN`;
const winShortcut = `"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --kiosk-printing ${origin}/kitchen`;
const macShortcut = `open -a "Google Chrome" --args --kiosk-printing ${origin}/kitchen`;
const PRINTER_KEY = 'kitchen:isPrinter';

const sampleOrder = {
  id: 'test-0000-0000', status: 'pending', total: 27.5, tip_amount: 2.5, payment_method: 'card' as const,
  notes: 'Allergy: nuts', created_at: new Date().toISOString(), table_number: 5, guest_name: 'Test', section_name: 'Terrace',
  items: [
    { quantity: 1, notes: 'no onions', menu_item_name: 'La Soul Burger', unit_price: 18 },
    { quantity: 2, notes: null, menu_item_name: 'Espresso', unit_price: 3.5 },
  ],
};

const CopyField = ({ value, label }: { value: string; label?: string }) => {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(value); setCopied(true); toast.success('Copied'); setTimeout(() => setCopied(false), 1500); }
    catch { toast.error('Could not copy — select and copy manually'); }
  };
  return (
    <div className="mt-1">
      {label && <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-sans mb-1">{label}</p>}
      <div className="flex items-stretch gap-2">
        <code className="flex-1 min-w-0 text-xs bg-muted/60 border border-border rounded-lg px-3 py-2 font-mono break-all">{value}</code>
        <Button type="button" variant="outline" size="sm" onClick={copy} className="shrink-0 gap-1.5">
          {copied ? <Check className="w-3.5 h-3.5 text-primary" /> : <Copy className="w-3.5 h-3.5" />}{copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
    </div>
  );
};

const Step = ({ n, children }: { n: number; children: React.ReactNode }) => (
  <div className="flex gap-3">
    <span className="shrink-0 w-6 h-6 rounded-full bg-primary/15 text-primary text-xs font-bold font-sans flex items-center justify-center">{n}</span>
    <div className="min-w-0 flex-1 text-sm font-sans text-muted-foreground leading-relaxed pt-0.5">{children}</div>
  </div>
);

const MethodButton = ({ active, onClick, icon: Icon, title, sub }: { active: boolean; onClick: () => void; icon: typeof Monitor; title: string; sub: string }) => (
  <button type="button" onClick={onClick}
    className={`text-left rounded-xl border p-3 transition-colors ${active ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/40'}`}>
    <Icon className={`w-5 h-5 mb-1.5 ${active ? 'text-primary' : 'text-muted-foreground'}`} />
    <p className="font-sans text-sm font-medium text-foreground">{title}</p>
    <p className="text-[11px] text-muted-foreground font-sans mt-0.5">{sub}</p>
  </button>
);

const PrinterSetupGuide = ({ settings, onTestPrint }: { settings: KitchenPrintSettings; onTestPrint: () => void }) => {
  const btOk = bluetoothSupported();
  const [method, setMethod] = useState<'device' | 'bluetooth' | 'network'>('device');
  const [showSilent, setShowSilent] = useState(false);
  const [isPrinter, setIsPrinter] = useState(() => typeof localStorage !== 'undefined' && localStorage.getItem(PRINTER_KEY) === 'true');
  const [btName, setBtName] = useState<string | null>(() => connectedPrinterName());
  const [btBusy, setBtBusy] = useState(false);

  const toggleDevice = () => {
    const next = !isPrinter;
    setIsPrinter(next);
    localStorage.setItem(PRINTER_KEY, String(next));
    toast.success(next ? 'This device is now the kitchen printer' : 'This device is no longer the printer');
  };

  const connectBt = async () => {
    setBtBusy(true);
    try { const name = await connectBluetoothPrinter(); setBtName(name); toast.success(`Connected to ${name}`); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Could not connect'); }
    finally { setBtBusy(false); }
  };
  const testBt = async () => {
    setBtBusy(true);
    try { await printTextBluetooth(buildKitchenTicketText(sampleOrder, settings)); toast.success('Test ticket sent'); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Print failed'); }
    finally { setBtBusy(false); }
  };
  const disconnectBt = () => { disconnectBluetoothPrinter(); setBtName(null); toast.success('Disconnected'); };

  return (
    <Card>
      <CardContent className="p-5 space-y-4">
        <div>
          <h2 className="font-serif text-lg font-semibold text-foreground flex items-center gap-2">
            <Printer className="w-5 h-5 text-primary" /> Connect your printer
          </h2>
          <p className="text-xs text-muted-foreground font-sans mt-1">Choose how the kitchen prints, then connect and send a test ticket.</p>
        </div>

        <div className={`grid gap-2 ${btOk ? 'grid-cols-3' : 'grid-cols-2'}`}>
          <MethodButton active={method === 'device'} onClick={() => setMethod('device')} icon={Monitor} title="This device" sub="Easiest — uses this device's printer" />
          {btOk && <MethodButton active={method === 'bluetooth'} onClick={() => setMethod('bluetooth')} icon={Bluetooth} title="Bluetooth" sub="Pair an ESC/POS printer directly" />}
          <MethodButton active={method === 'network'} onClick={() => setMethod('network')} icon={Wifi} title="Network" sub="Star/Epson CloudPRNT — no computer" />
        </div>

        {/* THIS DEVICE */}
        {method === 'device' && (
          <div className="space-y-3 pt-1">
            <div className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-sans ${isPrinter ? 'bg-primary/10 text-primary' : 'bg-muted/50 text-muted-foreground'}`}>
              {isPrinter ? <CheckCircle2 className="w-4 h-4" /> : <Printer className="w-4 h-4" />}
              {isPrinter ? 'This device is set as the kitchen printer' : 'This device is not set as the printer yet'}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={toggleDevice} variant={isPrinter ? 'outline' : 'default'}>
                {isPrinter ? 'Stop using this device' : 'Use this device as the printer'}
              </Button>
              <Button variant="outline" onClick={onTestPrint} className="gap-1.5"><Printer className="w-4 h-4" /> Send a test ticket</Button>
            </div>
            <div className="space-y-3 pt-1">
              <Step n={1}>Open this page (or the <span className="font-medium text-foreground">Kitchen Display</span>, <code className="text-xs bg-muted px-1 rounded">{origin}/kitchen</code>) on the tablet or computer connected to your printer.</Step>
              <Step n={2}>Tap <span className="font-medium text-foreground">"Use this device as the printer"</span> above, then <span className="font-medium text-foreground">Send a test ticket</span> to confirm it prints.</Step>
              <Step n={3}>Keep the Kitchen Display open on that device — new orders then print automatically.</Step>
              <Step n={4}>
                <button type="button" onClick={() => setShowSilent((s) => !s)} className="inline-flex items-center gap-1 text-primary font-medium hover:underline">
                  Print without the popup each time <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showSilent ? 'rotate-180' : ''}`} />
                </button>
                {showSilent && (
                  <div className="mt-2 space-y-3 rounded-lg bg-muted/40 border border-border p-3">
                    <p className="text-xs">Launch Chrome in <span className="font-medium text-foreground">kiosk-printing</span> mode so tickets print silently. Make a desktop shortcut with this target (set your printer as the Windows default first):</p>
                    <CopyField label="Windows shortcut target" value={winShortcut} />
                    <CopyField label="Mac (Terminal)" value={macShortcut} />
                    <p className="text-[11px] text-muted-foreground">On iPad / Android the print sheet appears each time — use Bluetooth or a Network printer for fully silent printing.</p>
                  </div>
                )}
              </Step>
            </div>
          </div>
        )}

        {/* BLUETOOTH */}
        {method === 'bluetooth' && btOk && (
          <div className="space-y-3 pt-1">
            <div className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-sans ${btName ? 'bg-primary/10 text-primary' : 'bg-muted/50 text-muted-foreground'}`}>
              {btName ? <CheckCircle2 className="w-4 h-4" /> : <Bluetooth className="w-4 h-4" />}
              {btName ? `Connected: ${btName}` : 'No Bluetooth printer connected'}
            </div>
            <div className="flex flex-wrap gap-2">
              {!btName ? (
                <Button onClick={connectBt} disabled={btBusy} className="gap-1.5">
                  {btBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Bluetooth className="w-4 h-4" />} Connect Bluetooth printer
                </Button>
              ) : (
                <>
                  <Button variant="outline" onClick={testBt} disabled={btBusy} className="gap-1.5">
                    {btBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Printer className="w-4 h-4" />} Send a test ticket
                  </Button>
                  <Button variant="ghost" onClick={disconnectBt}>Disconnect</Button>
                </>
              )}
            </div>
            <div className="space-y-3 pt-1">
              <Step n={1}>Turn the printer on and make sure its <span className="font-medium text-foreground">Bluetooth is on</span> (and not already paired to another device).</Step>
              <Step n={2}>Tap <span className="font-medium text-foreground">Connect Bluetooth printer</span> and pick your printer from the list.</Step>
              <Step n={3}>Tap <span className="font-medium text-foreground">Send a test ticket</span> — a sample ticket should print.</Step>
              <p className="text-[11px] text-muted-foreground font-sans rounded-lg bg-muted/40 border border-border p-2.5">
                Works with most 58/80 mm Bluetooth ESC/POS printers on Chrome (Android, Windows, Mac). Not supported on iPhone/iPad — use This device or Network there.
              </p>
            </div>
          </div>
        )}

        {/* NETWORK */}
        {method === 'network' && (
          <div className="space-y-3 pt-1">
            <Step n={1}>Set a secret password: in <span className="font-medium text-foreground">Supabase → Edge Functions → Secrets</span>, add <code className="text-xs bg-muted px-1 rounded">CLOUDPRNT_TOKEN</code> with any strong value.</Step>
            <Step n={2}>
              Open your Star/Epson printer's setup page and paste this as the <span className="font-medium text-foreground">Server / Poll URL</span> (replace <code className="text-xs bg-muted px-1 rounded">YOUR_TOKEN</code> with the secret from step 1):
              <CopyField value={cloudPrntUrl} />
            </Step>
            <Step n={3}>Save on the printer. It checks for new orders every few seconds and <span className="font-medium text-foreground">prints them automatically — no tablet or computer needed.</span></Step>
            <p className="text-[11px] text-muted-foreground font-sans flex items-start gap-1.5 rounded-lg bg-muted/40 border border-border p-2.5">
              <Wifi className="w-3.5 h-3.5 mt-0.5 shrink-0" /> Uses the Star CloudPRNT standard. The endpoint is ready — confirm the exact field name on your printer model with your installer the first time.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default PrinterSetupGuide;
