import { DEMO_MODE } from '@/lib/demo-mode';
import React, { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Monitor, Wifi, Bluetooth, Copy, Check, Printer, ChevronDown, Loader2, CheckCircle2, AlertTriangle, Sparkles, HelpCircle, Usb, Tablet } from 'lucide-react';
import { toast } from 'sonner';
import { AdminCard, AdminCardContent, AdminCardHeader } from '@/components/admin/AdminCard';
import { cn } from '@/lib/utils';
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
/** The Network printers card's id (CloudPrinters.tsx). */
const NETWORK_PRINTERS_ID = 'network-printers';

const sampleOrder = {
  id: 'test-0000-0000', status: 'pending', total: 27.5, tip_amount: 2.5, payment_method: 'card' as const,
  notes: 'Allergy: nuts', created_at: new Date().toISOString(), table_number: 5, guest_name: 'Test', section_name: 'Terrace',
  items: [
    { quantity: 1, notes: 'no onions', menu_item_name: DEMO_MODE ? 'Casa Burger' : 'La Soul Burger', unit_price: 18 },
    { quantity: 2, notes: null, menu_item_name: 'Espresso', unit_price: 3.5 },
  ],
};

/** Tap targets: 44 px on a phone, the desktop's 40. */
const TAP = 'h-11 sm:h-10';

const CopyField = ({ value, label }: { value: string; label?: string }) => {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(value); setCopied(true); toast.success('Copied'); setTimeout(() => setCopied(false), 1500); }
    catch { toast.error('Could not copy — select and copy manually'); }
  };
  return (
    <div>
      {label && <p className="mb-1 text-xs font-sans font-medium text-muted-foreground">{label}</p>}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
        <code className="min-w-0 flex-1 break-all rounded-lg border border-border bg-card px-3 py-2.5 font-mono text-xs leading-relaxed">{value}</code>
        <Button type="button" variant="outline" onClick={copy} className="h-11 shrink-0 gap-1.5 self-start sm:h-auto sm:min-h-[40px] sm:self-stretch">
          {copied ? <Check className="h-4 w-4 text-primary" /> : <Copy className="h-4 w-4" />}{copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
    </div>
  );
};

const Step = ({ n, children }: { n: number; children: React.ReactNode }) => (
  <li className="flex gap-3">
    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-primary/10 text-xs font-semibold font-sans tabular-nums text-primary" aria-hidden>{n}</span>
    <div className="min-w-0 flex-1 pt-0.5 text-sm font-sans leading-relaxed text-muted-foreground">{children}</div>
  </li>
);

const MethodButton = ({ active, onClick, icon: Icon, title, sub, recommended }: { active: boolean; onClick: () => void; icon: typeof Monitor; title: string; sub: string; recommended?: boolean }) => (
  <button
    type="button" onClick={onClick} aria-pressed={active}
    className={cn(
      'flex h-full min-h-[88px] flex-col rounded-xl border p-3 text-start transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
      active ? 'border-primary/60 bg-primary/5 ring-1 ring-primary/30' : 'border-border hover:bg-muted/40',
    )}
  >
    <span className="mb-2 flex min-h-[20px] items-center justify-between gap-2">
      <Icon className={cn('h-5 w-5', active ? 'text-primary' : 'text-muted-foreground')} aria-hidden />
      {recommended && (
        <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-sans font-semibold uppercase tracking-wide text-primary">
          <Sparkles className="h-2.5 w-2.5" aria-hidden /> Easiest
        </span>
      )}
    </span>
    <span className="font-sans text-sm font-medium text-foreground">{title}</span>
    <span className="mt-0.5 text-xs font-sans leading-snug text-muted-foreground">{sub}</span>
  </button>
);

/** Where this device stands with the chosen method: one line, green when it is ready. */
const StatusLine = ({ ok, warn = false, icon: Icon, children }: { ok: boolean; warn?: boolean; icon: typeof Monitor; children: React.ReactNode }) => (
  <div
    className={cn(
      'flex items-start gap-2 rounded-xl px-3.5 py-3 text-sm font-sans',
      ok ? 'bg-primary/10 text-primary' : warn ? 'bg-amber-500/10 text-amber-800 dark:text-amber-400' : 'bg-muted/60 text-muted-foreground',
    )}
  >
    {ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> : <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />}
    <span className="min-w-0 break-words">{children}</span>
  </div>
);

const Troubleshoot = ({ tips }: { tips: React.ReactNode[] }) => {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl border border-border/80">
      <button
        type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
        className="flex min-h-[44px] w-full items-center justify-between gap-2 rounded-xl px-3.5 text-sm font-sans font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="flex items-center gap-2"><HelpCircle className="h-4 w-4 text-muted-foreground" aria-hidden /> Nothing printed?</span>
        <ChevronDown className={cn('h-4 w-4 text-muted-foreground transition-transform motion-reduce:transition-none', open && 'rotate-180')} aria-hidden />
      </button>
      {open && (
        <ul className="list-disc space-y-1.5 px-3.5 pb-3.5 ps-8 text-xs font-sans leading-relaxed text-muted-foreground">
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
  const spin = 'h-4 w-4 animate-spin motion-reduce:animate-none';
  const b = (s: React.ReactNode) => <span className="font-medium text-foreground">{s}</span>;

  return (
    <AdminCard>
      <AdminCardHeader
        icon={Tablet}
        title="Or print from a tablet"
        description={(
          <>
            For a USB or Bluetooth printer next to the kitchen tablet. Set it up on that tablet; it has to stay on with the Kitchen screen open.
            If a network printer above is online for a station, the tablet leaves that station to it.
          </>
        )}
      />
      <AdminCardContent className="space-y-4">
        {recommend === 'bluetooth' && (
          <p className="flex items-start gap-2 text-xs font-sans leading-relaxed text-muted-foreground">
            <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
            <span><span className="font-medium text-foreground">Easiest on this device:</span> pair a Bluetooth printer once — this tablet then reconnects and prints every new order automatically.</span>
          </p>
        )}

        <div
          role="group" aria-label="How the tablet prints"
          className={cn('grid grid-cols-2 gap-2', btOk && directOk ? 'lg:grid-cols-4' : btOk || directOk ? 'lg:grid-cols-3' : '')}
        >
          {btOk && <MethodButton active={method === 'bluetooth'} onClick={() => setMethod('bluetooth')} icon={Bluetooth} title="Bluetooth" sub="Pair once, prints automatically" recommended={recommend === 'bluetooth'} />}
          {directOk && <MethodButton active={method === 'usb'} onClick={() => setMethod('usb')} icon={Usb} title="USB or classic Bluetooth" sub="Android tablet + USB cable; Bluetooth printers missing above" />}
          <MethodButton active={method === 'device'} onClick={() => setMethod('device')} icon={Monitor} title="This device" sub="Print dialog — Windows/Mac printer" recommended={recommend === 'device'} />
          <MethodButton active={method === 'network'} onClick={() => setMethod('network')} icon={Wifi} title="Network" sub="LAN printer — no tablet needed" />
        </div>

        {/* BLUETOOTH */}
        {method === 'bluetooth' && btOk && (
          <div className="space-y-4 pt-1">
            {btBlocked && (
              <p className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3.5 py-3 text-xs font-sans leading-relaxed text-amber-800 dark:text-amber-400">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <span>You’re in an embedded preview, where browsers block Bluetooth. Open the <span className="font-medium">published site directly in Chrome</span> on the kitchen tablet (<code className="break-all rounded bg-card px-1">{origin}/kitchen</code>) to pair.</span>
              </p>
            )}

            <StatusLine ok={!!btName} warn={!btName && !!remembered} icon={Bluetooth}>
              {btName
                ? <>Connected: <span className="font-semibold">{btName}</span> · reconnects automatically</>
                : remembered
                  ? <>Saved: <span className="font-semibold">{remembered}</span> — turn the printer on, then Reconnect</>
                  : 'No Bluetooth printer connected'}
            </StatusLine>

            <div className="flex flex-wrap gap-2">
              {btName ? (
                <>
                  <Button variant="outline" onClick={testBt} disabled={btBusy} className={cn(TAP, 'gap-1.5')}>
                    {btBusy ? <Loader2 className={spin} /> : <Printer className="h-4 w-4" />} Send a test ticket
                  </Button>
                  <Button variant="ghost" onClick={forgetBt} className={cn(TAP, 'text-muted-foreground')}>Forget</Button>
                </>
              ) : (
                <>
                  <Button onClick={connectBt} disabled={btBusy || btBlocked} className={cn(TAP, 'gap-1.5')}>
                    {btBusy ? <Loader2 className={spin} /> : <Bluetooth className="h-4 w-4" />} {remembered ? 'Pair a different printer' : 'Connect Bluetooth printer'}
                  </Button>
                  {remembered && (
                    <Button variant="outline" onClick={reconnectBt} disabled={btBusy || btBlocked} className={cn(TAP, 'gap-1.5')}>
                      {btBusy ? <Loader2 className={spin} /> : <Bluetooth className="h-4 w-4" />} Reconnect
                    </Button>
                  )}
                </>
              )}
            </div>

            <ol className="space-y-3">
              <Step n={1}>On the {b('kitchen tablet')}, turn the printer on and make sure its {b('Bluetooth is on')} (not already paired to a phone).</Step>
              <Step n={2}>Tap {b('Connect Bluetooth printer')} and choose it from the list.</Step>
              <Step n={3}>Tap {b('Send a test ticket')} — a sample should print. That's it.</Step>
              <Step n={4}>Open the {b('Kitchen Display')} (<code className="break-all rounded bg-muted px-1 text-xs">{origin}/kitchen</code>) on that tablet — it reconnects on its own and prints every new order automatically.</Step>
            </ol>

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
          <div className="space-y-4 pt-1">
            <StatusLine ok={!!directName} icon={Usb}>
              {directName ? <>Connected: <span className="font-semibold">{directName}</span> · reconnects automatically</> : 'No USB or serial printer connected'}
            </StatusLine>
            <div className="flex flex-wrap gap-2">
              {usbSupported() && (
                <Button onClick={() => connectDirect('usb')} disabled={directBusy} variant={directName ? 'outline' : 'default'} className={cn(TAP, 'gap-1.5')}>
                  {directBusy ? <Loader2 className={spin} /> : <Usb className="h-4 w-4" />} Connect USB printer
                </Button>
              )}
              {serialSupported() && (
                <Button onClick={() => connectDirect('serial')} disabled={directBusy} variant="outline" className={cn(TAP, 'gap-1.5')}>
                  <Bluetooth className="h-4 w-4" /> Classic Bluetooth / serial
                </Button>
              )}
              {directName && (
                <>
                  <Button variant="outline" onClick={testDirect} disabled={directBusy} className={cn(TAP, 'gap-1.5')}><Printer className="h-4 w-4" /> Send a test ticket</Button>
                  <Button variant="ghost" onClick={() => { void forgetDirectPrinters().then(() => setDirectName(null)); }} className={cn(TAP, 'text-muted-foreground')}>Forget</Button>
                </>
              )}
            </div>
            <ol className="space-y-3">
              <Step n={1}>{b('Android tablet:')} plug the printer in with a USB‑OTG cable, open this page in {b('Chrome')}, tap {b('Connect USB printer')} and pick it.</Step>
              <Step n={2}>{b('Bluetooth printer that does not show up under Bluetooth:')} pair it in the tablet’s own Bluetooth settings first (PIN is usually 0000 or 1234), then tap {b('Classic Bluetooth / serial')}.</Step>
              <Step n={3}>Send a test ticket, then keep the {b('Kitchen Display')} open on this tablet — it reconnects on its own and prints every new order, with no print dialog.</Step>
            </ol>
            <Troubleshoot tips={[
              <>On Windows the printer’s own driver holds a USB printer — use <span className="font-medium">This device</span> (the print dialog) there instead.</>,
              <>Classic Bluetooth needs Chrome 117+ on a computer or Chrome 137+ on Android.</>,
              <>If tickets come out as strange characters, the printer may not be ESC/POS — check its manual or use a network printer.</>,
            ]} />
          </div>
        )}

        {/* THIS DEVICE */}
        {method === 'device' && (
          <div className="space-y-4 pt-1">
            <StatusLine ok={isPrinter} icon={Printer}>
              {isPrinter ? 'This device is set as the kitchen printer' : 'This device is not set as the printer yet'}
            </StatusLine>
            <div className="flex flex-wrap gap-2">
              <Button onClick={toggleDevice} variant={isPrinter ? 'outline' : 'default'} className={TAP}>
                {isPrinter ? 'Stop using this device' : 'Use this device as the printer'}
              </Button>
              <Button variant="outline" onClick={onTestPrint} className={cn(TAP, 'gap-1.5')}><Printer className="h-4 w-4" /> Send a test ticket</Button>
            </div>
            <ol className="space-y-3">
              <Step n={1}>Plug the 80 mm printer into this tablet/PC and make sure it's installed as the {b('default printer')} in the OS.</Step>
              <Step n={2}>Tap {b('"Use this device as the printer"')}, then {b('Send a test ticket')} to confirm.</Step>
              <Step n={3}>Keep the {b('Kitchen Display')} open on this device — new orders print automatically.</Step>
              <Step n={4}>
                <button
                  type="button" onClick={() => setShowSilent((s) => !s)} aria-expanded={showSilent}
                  className="-my-2 inline-flex min-h-[44px] items-center gap-1 font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-0 sm:my-0"
                >
                  Print without the popup each time <ChevronDown className={cn('h-4 w-4 transition-transform motion-reduce:transition-none', showSilent && 'rotate-180')} aria-hidden />
                </button>
                {showSilent && (
                  <div className="mt-2 space-y-3 rounded-xl bg-muted/40 p-3.5">
                    <p className="text-xs">Launch Chrome in {b('kiosk-printing')} mode so tickets print silently. Make a desktop shortcut with this target:</p>
                    <CopyField label="Windows shortcut target" value={winShortcut} />
                    <CopyField label="Mac (Terminal)" value={macShortcut} />
                    <p className="text-xs text-muted-foreground">On iPad / Android the print sheet appears each time — use Bluetooth or Network for fully silent printing.</p>
                  </div>
                )}
              </Step>
            </ol>
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
            <p className="flex items-start gap-2 rounded-xl bg-primary/5 px-3.5 py-3 text-sm font-sans leading-relaxed text-foreground/80">
              <Wifi className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
              <span>
                A network printer does not need this tablet at all. Add it under <span className="font-semibold text-foreground">Network printers</span> at
                the top of this page — it gets its own address to paste into the printer, and shows there when it is online.
              </span>
            </p>
            <Button
              variant="outline" className={cn(TAP, 'gap-1.5')}
              onClick={() => document.getElementById(NETWORK_PRINTERS_ID)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
            >
              <Wifi className="h-4 w-4" /> Go to Network printers
            </Button>
          </div>
        )}
      </AdminCardContent>
    </AdminCard>
  );
};

export default PrinterSetupGuide;
