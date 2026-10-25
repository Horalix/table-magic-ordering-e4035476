import React, { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Monitor, Wifi, Bluetooth, Copy, Check, Printer, ChevronDown, Loader2, CheckCircle2, AlertTriangle, Sparkles, HelpCircle, Usb } from 'lucide-react';
import { toast } from 'sonner';
import { buildKitchenTicketBytes, type KitchenPrintSettings } from '@/lib/ticket-export';
import {
  bluetoothSupported, connectBluetoothPrinter, connectedPrinterName, disconnectBluetoothPrinter,
  printBytesBluetooth, inEmbeddedFrame, friendlyBluetoothError, tryReconnectBluetoothPrinter,
  forgetBluetoothPrinter, rememberedPrinterName,
} from '@/lib/printer-connect';
import {
  connectSerialPrinter, connectUsbPrinter, directPrinterName, forgetDirectPrinters, printBytesDirect,
  serialSupported, tryReconnectSerialPrinter, tryReconnectUsbPrinter, usbSupported,
} from '@/lib/printer-direct';

/**
 * Self-serve kitchen-ticket printer setup. Leads with the easiest method for the
 * device, and a paired Bluetooth printer is remembered + auto-reconnects.
 */

const origin = typeof window !== 'undefined' ? window.location.origin : 'https://menu.lasoul.net';
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

const MethodButton = ({ active, onClick, icon: Icon, title, sub, recommended }: { active: boolean; onClick: () => void; icon: typeof Monitor; title: string; sub: string; recommended?: boolean }) => (
  <button type="button" onClick={onClick}
    className={`flex flex-col h-full text-left rounded-xl border p-3 transition-colors ${active ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/40'}`}>
    <div className="flex items-center justify-between gap-2 mb-1.5 min-h-[20px]">
      <Icon className={`w-5 h-5 ${active ? 'text-primary' : 'text-muted-foreground'}`} />
      {recommended && (
        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-primary text-primary-foreground text-[9px] font-sans font-bold uppercase tracking-wide">
          <Sparkles className="w-2.5 h-2.5" /> Easiest
        </span>
      )}
    </div>
    <p className="font-sans text-sm font-medium text-foreground">{title}</p>
    <p className="text-[11px] text-muted-foreground font-sans mt-0.5 leading-snug">{sub}</p>
  </button>
);

const Troubleshoot = ({ tips }: { tips: React.ReactNode[] }) => {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-border bg-muted/30">
      <button type="button" onClick={() => setOpen((o) => !o)} className="w-full flex items-center justify-between px-3 py-2 text-xs font-sans font-medium text-foreground">
        <span className="flex items-center gap-1.5"><HelpCircle className="w-3.5 h-3.5 text-muted-foreground" /> Nothing printed?</span>
        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <ul className="px-3 pb-3 pt-0 space-y-1.5 text-[11px] text-muted-foreground font-sans list-disc list-inside">
          {tips.map((tip, i) => <li key={i}>{tip}</li>)}
        </ul>
      )}
    </div>
  );
};

const PrinterSetupGuide = ({ settings, onTestPrint }: { settings: KitchenPrintSettings; onTestPrint: () => void }) => {
  const btOk = bluetoothSupported();
  const btBlocked = inEmbeddedFrame();
  const recommend: 'device' | 'bluetooth' = btOk && !btBlocked ? 'bluetooth' : 'device';

  const [method, setMethod] = useState<'device' | 'bluetooth' | 'usb' | 'network'>(recommend);
  const directOk = usbSupported() || serialSupported();
  const [directName, setDirectName] = useState<string | null>(() => directPrinterName());
  const [directBusy, setDirectBusy] = useState(false);

  useEffect(() => {
    if (!directOk) return;
    void tryReconnectUsbPrinter().then((n) => { if (n) setDirectName(n); });
    void tryReconnectSerialPrinter().then((n) => { if (n) setDirectName((prev) => prev ?? n); });
  }, [directOk]);

  const connectDirect = async (kind: 'usb' | 'serial') => {
    setDirectBusy(true);
    try {
      const name = kind === 'usb' ? await connectUsbPrinter() : await connectSerialPrinter();
      setDirectName(name);
      toast.success(`Connected to ${name}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!/No device selected|cancel/i.test(msg)) toast.error(msg);
    } finally { setDirectBusy(false); }
  };
  const testDirect = async () => {
    setDirectBusy(true);
    try {
      const outcome = await printBytesDirect(buildKitchenTicketBytes(sampleOrder, { ...settings, test: true }));
      if (!outcome.ok) toast.error(outcome.reason);
      else toast.success('Test ticket sent. This printer cannot confirm — check the paper came out.');
    } finally { setDirectBusy(false); }
  };
  const [showSilent, setShowSilent] = useState(false);
  const [isPrinter, setIsPrinter] = useState(() => typeof localStorage !== 'undefined' && localStorage.getItem(PRINTER_KEY) === 'true');
  const [btName, setBtName] = useState<string | null>(() => connectedPrinterName());
  const [btBusy, setBtBusy] = useState(false);
  const remembered = rememberedPrinterName();

  // Silently reconnect a previously-paired printer when the page opens.
  useEffect(() => {
    if (btOk && !btBlocked) tryReconnectBluetoothPrinter().then((n) => { if (n) setBtName(n); });
  }, [btOk, btBlocked]);

  const toggleDevice = () => {
    const next = !isPrinter;
    setIsPrinter(next);
    localStorage.setItem(PRINTER_KEY, String(next));
    toast.success(next ? 'This device is now the kitchen printer' : 'This device is no longer the printer');
  };

  const connectBt = async () => {
    setBtBusy(true);
    try { const name = await connectBluetoothPrinter(); setBtName(name); toast.success(`Connected to ${name}`); }
    catch (e) { toast.error(friendlyBluetoothError(e)); }
    finally { setBtBusy(false); }
  };
  const reconnectBt = async () => {
    setBtBusy(true);
    try {
      const n = await tryReconnectBluetoothPrinter();
      if (n) { setBtName(n); toast.success(`Reconnected to ${n}`); }
      else toast.error('Could not reconnect — make sure the printer is on and nearby.');
    } finally { setBtBusy(false); }
  };
  /**
   * The whole point of a test print is to find out. Reporting "sent" for a
   * printer with its cover open is the failure this button exists to catch.
   */
  const testBt = async () => {
    setBtBusy(true);
    try {
      const outcome = await printBytesBluetooth(buildKitchenTicketBytes(sampleOrder, { ...settings, test: true }));
      if (!outcome.ok) toast.error(outcome.reason);
      else if (outcome.verified) toast.success('Test ticket printed — the printer confirmed it');
      else toast.success('Test ticket sent. This printer cannot confirm — check the paper came out.');
    }
    catch (e) { toast.error(friendlyBluetoothError(e)); }
    finally { setBtBusy(false); }
  };
  const forgetBt = () => { forgetBluetoothPrinter(); setBtName(null); toast.success('Printer forgotten'); };

  return (
    <Card>
      <CardContent className="p-5 space-y-4">
        <div>
          <h2 className="font-serif text-lg font-semibold text-foreground flex items-center gap-2">
            <Printer className="w-5 h-5 text-primary" /> Tablet printing
          </h2>
          <p className="text-xs text-muted-foreground font-sans mt-1">Set up on the tablet that runs the Kitchen screen. The <span className="text-foreground/80">fiscal receipt</span> printer (Tring) is set up separately via fiscalization.</p>
        </div>

        {recommend === 'bluetooth' && (
          <div className="flex items-start gap-2 rounded-xl bg-primary/5 border border-primary/20 px-3.5 py-2.5">
            <Sparkles className="w-4 h-4 text-primary mt-0.5 shrink-0" />
            <p className="text-xs font-sans text-foreground/80"><span className="font-semibold text-foreground">Easiest setup:</span> pair a Bluetooth printer once below — this tablet then reconnects and prints every new order automatically.</p>
          </div>
        )}

        <div className={`grid gap-2 grid-cols-1 sm:grid-cols-2 ${btOk && directOk ? 'lg:grid-cols-4' : btOk || directOk ? 'lg:grid-cols-3' : ''}`}>
          {btOk && <MethodButton active={method === 'bluetooth'} onClick={() => setMethod('bluetooth')} icon={Bluetooth} title="Bluetooth" sub="Pair once, prints automatically" recommended={recommend === 'bluetooth'} />}
          {directOk && <MethodButton active={method === 'usb'} onClick={() => setMethod('usb')} icon={Usb} title="USB or classic Bluetooth" sub="Android tablet + USB cable; Bluetooth printers missing above" />}
          <MethodButton active={method === 'device'} onClick={() => setMethod('device')} icon={Monitor} title="This device" sub="Print dialog — Windows/Mac printer" recommended={recommend === 'device'} />
          <MethodButton active={method === 'network'} onClick={() => setMethod('network')} icon={Wifi} title="Network" sub="LAN printer — no tablet needed" />
        </div>

        {/* BLUETOOTH */}
        {method === 'bluetooth' && btOk && (
          <div className="space-y-3 pt-1">
            {btBlocked && (
              <p className="flex items-start gap-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-700 dark:text-amber-400 px-3 py-2 text-xs font-sans">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                You’re in an embedded preview, where browsers block Bluetooth. Open the <span className="font-medium">published site directly in Chrome</span> on the kitchen tablet (<code className="bg-card px-1 rounded">{origin}/kitchen</code>) to pair.
              </p>
            )}

            <div className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-sans ${btName ? 'bg-primary/10 text-primary' : remembered ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400' : 'bg-muted/50 text-muted-foreground'}`}>
              {btName ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <Bluetooth className="w-4 h-4 shrink-0" />}
              {btName
                ? <span>Connected: <span className="font-semibold">{btName}</span> · reconnects automatically</span>
                : remembered
                  ? <span>Saved: <span className="font-semibold">{remembered}</span> — turn the printer on, then Reconnect</span>
                  : 'No Bluetooth printer connected'}
            </div>

            <div className="flex flex-wrap gap-2">
              {btName ? (
                <>
                  <Button variant="outline" onClick={testBt} disabled={btBusy} className="gap-1.5">
                    {btBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Printer className="w-4 h-4" />} Send a test ticket
                  </Button>
                  <Button variant="ghost" onClick={forgetBt} className="text-muted-foreground">Forget</Button>
                </>
              ) : (
                <>
                  <Button onClick={connectBt} disabled={btBusy || btBlocked} className="gap-1.5">
                    {btBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Bluetooth className="w-4 h-4" />} {remembered ? 'Pair a different printer' : 'Connect Bluetooth printer'}
                  </Button>
                  {remembered && (
                    <Button variant="outline" onClick={reconnectBt} disabled={btBusy || btBlocked} className="gap-1.5">
                      {btBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Bluetooth className="w-4 h-4" />} Reconnect
                    </Button>
                  )}
                </>
              )}
            </div>

            <div className="space-y-3 pt-1">
              <Step n={1}>On the <span className="font-medium text-foreground">kitchen tablet</span>, turn the printer on and make sure its <span className="font-medium text-foreground">Bluetooth is on</span> (not already paired to a phone).</Step>
              <Step n={2}>Tap <span className="font-medium text-foreground">Connect Bluetooth printer</span> and choose it from the list.</Step>
              <Step n={3}>Tap <span className="font-medium text-foreground">Send a test ticket</span> — a sample should print. That's it.</Step>
              <Step n={4}>Open the <span className="font-medium text-foreground">Kitchen Display</span> (<code className="text-xs bg-muted px-1 rounded">{origin}/kitchen</code>) on that tablet — it reconnects on its own and prints every new order automatically.</Step>
            </div>

            <Troubleshoot tips={[
              <>Make sure you opened the <span className="font-medium">real site in Chrome</span> (Android/Windows/Mac), not inside an app preview — Bluetooth is blocked there.</>,
              <>The printer must be a <span className="font-medium">Bluetooth ESC/POS</span> model and not already connected to another phone/tablet.</>,
              <>If it stopped after a while, tap <span className="font-medium">Reconnect</span> (or just reopen the Kitchen Display) — it pairs again without the popup.</>,
              <>iPhone/iPad don't support Bluetooth printing — use an Android/Windows tablet, or the Network option.</>,
            ]} />
          </div>
        )}

        {/* USB / SERIAL — straight to the printer, no dialog */}
        {method === 'usb' && directOk && (
          <div className="space-y-3 pt-1">
            <div className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-sans ${directName ? 'bg-primary/10 text-primary' : 'bg-muted/50 text-muted-foreground'}`}>
              {directName ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <Usb className="w-4 h-4 shrink-0" />}
              {directName ? <span>Connected: <span className="font-semibold">{directName}</span> · reconnects automatically</span> : 'No USB or serial printer connected'}
            </div>
            <div className="flex flex-wrap gap-2">
              {usbSupported() && (
                <Button onClick={() => connectDirect('usb')} disabled={directBusy} variant={directName ? 'outline' : 'default'} className="gap-1.5">
                  {directBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Usb className="w-4 h-4" />} Connect USB printer
                </Button>
              )}
              {serialSupported() && (
                <Button onClick={() => connectDirect('serial')} disabled={directBusy} variant="outline" className="gap-1.5">
                  <Bluetooth className="w-4 h-4" /> Classic Bluetooth / serial
                </Button>
              )}
              {directName && (
                <>
                  <Button variant="outline" onClick={testDirect} disabled={directBusy} className="gap-1.5"><Printer className="w-4 h-4" /> Send a test ticket</Button>
                  <Button variant="ghost" onClick={() => { void forgetDirectPrinters().then(() => setDirectName(null)); }} className="text-muted-foreground">Forget</Button>
                </>
              )}
            </div>
            <div className="space-y-3 pt-1">
              <Step n={1}><span className="font-medium text-foreground">Android tablet:</span> plug the printer in with a USB‑OTG cable, open this page in <span className="font-medium text-foreground">Chrome</span>, tap <span className="font-medium text-foreground">Connect USB printer</span> and pick it.</Step>
              <Step n={2}><span className="font-medium text-foreground">Bluetooth printer that does not show up under Bluetooth:</span> pair it in the tablet’s own Bluetooth settings first (PIN is usually 0000 or 1234), then tap <span className="font-medium text-foreground">Classic Bluetooth / serial</span>.</Step>
              <Step n={3}>Send a test ticket, then keep the <span className="font-medium text-foreground">Kitchen Display</span> open on this tablet — it reconnects on its own and prints every new order, with no print dialog.</Step>
            </div>
            <Troubleshoot tips={[
              <>On Windows the printer’s own driver holds a USB printer — use <span className="font-medium">This device</span> (the print dialog) there instead.</>,
              <>Classic Bluetooth needs Chrome 117+ on a computer or Chrome 137+ on Android.</>,
              <>If tickets come out as strange characters, the printer may not be ESC/POS — check its manual or use a network printer.</>,
            ]} />
          </div>
        )}

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
              <Step n={1}>Plug the 80 mm printer into this tablet/PC and make sure it's installed as the <span className="font-medium text-foreground">default printer</span> in the OS.</Step>
              <Step n={2}>Tap <span className="font-medium text-foreground">"Use this device as the printer"</span>, then <span className="font-medium text-foreground">Send a test ticket</span> to confirm.</Step>
              <Step n={3}>Keep the <span className="font-medium text-foreground">Kitchen Display</span> open on this device — new orders print automatically.</Step>
              <Step n={4}>
                <button type="button" onClick={() => setShowSilent((s) => !s)} className="inline-flex items-center gap-1 text-primary font-medium hover:underline">
                  Print without the popup each time <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showSilent ? 'rotate-180' : ''}`} />
                </button>
                {showSilent && (
                  <div className="mt-2 space-y-3 rounded-lg bg-muted/40 border border-border p-3">
                    <p className="text-xs">Launch Chrome in <span className="font-medium text-foreground">kiosk-printing</span> mode so tickets print silently. Make a desktop shortcut with this target:</p>
                    <CopyField label="Windows shortcut target" value={winShortcut} />
                    <CopyField label="Mac (Terminal)" value={macShortcut} />
                    <p className="text-[11px] text-muted-foreground">On iPad / Android the print sheet appears each time — use Bluetooth or Network for fully silent printing.</p>
                  </div>
                )}
              </Step>
            </div>
            <Troubleshoot tips={[
              <>Check the printer is the <span className="font-medium">default</span> in the operating system's printer settings, with paper loaded.</>,
              <>If a print dialog appears and nothing prints, pick the right printer in that dialog once.</>,
              <>For fully silent printing use the kiosk-printing shortcut above, or switch to Bluetooth.</>,
            ]} />
          </div>
        )}

        {/* NETWORK — now its own section with per-printer addresses. */}
        {method === 'network' && (
          <div className="space-y-3 pt-1">
            <p className="flex items-start gap-2 rounded-lg bg-primary/5 border border-primary/20 px-3 py-2.5 text-sm font-sans text-foreground/80">
              <Wifi className="w-4 h-4 mt-0.5 shrink-0 text-primary" />
              <span>
                A network printer does not need this tablet at all. Add it under <span className="font-semibold text-foreground">Network printers</span> at
                the top of this page — it gets its own address to paste into the printer, and shows here when it is online.
              </span>
            </p>
            <Button variant="outline" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} className="gap-1.5">
              <Wifi className="w-4 h-4" /> Go to Network printers
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default PrinterSetupGuide;
