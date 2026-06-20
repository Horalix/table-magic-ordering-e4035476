import React, { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Monitor, Wifi, Copy, Check, Printer, ChevronDown } from 'lucide-react';
import { toast } from 'sonner';

/**
 * Plain-language, self-serve printer setup for non-technical staff.
 * Two paths: (1) a tablet/PC at the pass that prints via the browser (easiest),
 * (2) a network thermal printer that pulls tickets itself (silent, no computer).
 */

const origin = typeof window !== 'undefined' ? window.location.origin : 'https://menu.lasoul.net';
const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? 'https://YOUR-PROJECT.supabase.co';
const cloudPrntUrl = `${supabaseUrl}/functions/v1/cloudprnt?token=YOUR_TOKEN`;
const winShortcut = `"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --kiosk-printing ${origin}/kitchen`;
const macShortcut = `open -a "Google Chrome" --args --kiosk-printing ${origin}/kitchen`;

const CopyField = ({ value, label }: { value: string; label?: string }) => {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast.success('Copied');
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error('Could not copy — select and copy manually');
    }
  };
  return (
    <div className="mt-1">
      {label && <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-sans mb-1">{label}</p>}
      <div className="flex items-stretch gap-2">
        <code className="flex-1 min-w-0 text-xs bg-muted/60 border border-border rounded-lg px-3 py-2 font-mono break-all">{value}</code>
        <Button type="button" variant="outline" size="sm" onClick={copy} className="shrink-0 gap-1.5">
          {copied ? <Check className="w-3.5 h-3.5 text-primary" /> : <Copy className="w-3.5 h-3.5" />}
          {copied ? 'Copied' : 'Copy'}
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

const PrinterSetupGuide = ({ onTestPrint }: { onTestPrint: () => void }) => {
  const [method, setMethod] = useState<'device' | 'network'>('device');
  const [showSilent, setShowSilent] = useState(false);

  return (
    <Card>
      <CardContent className="p-5 space-y-4">
        <div>
          <h2 className="font-serif text-lg font-semibold text-foreground flex items-center gap-2">
            <Printer className="w-5 h-5 text-primary" /> Connect your printer
          </h2>
          <p className="text-xs text-muted-foreground font-sans mt-1">Pick how the kitchen will print. Most restaurants use the first option.</p>
        </div>

        {/* Method picker */}
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setMethod('device')}
            className={`text-left rounded-xl border p-3 transition-colors ${method === 'device' ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/40'}`}
          >
            <Monitor className={`w-5 h-5 mb-1.5 ${method === 'device' ? 'text-primary' : 'text-muted-foreground'}`} />
            <p className="font-sans text-sm font-medium text-foreground">Tablet or computer</p>
            <p className="text-[11px] text-muted-foreground font-sans mt-0.5">Easiest — prints via the device's own printer</p>
          </button>
          <button
            type="button"
            onClick={() => setMethod('network')}
            className={`text-left rounded-xl border p-3 transition-colors ${method === 'network' ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/40'}`}
          >
            <Wifi className={`w-5 h-5 mb-1.5 ${method === 'network' ? 'text-primary' : 'text-muted-foreground'}`} />
            <p className="font-sans text-sm font-medium text-foreground">Network printer</p>
            <p className="text-[11px] text-muted-foreground font-sans mt-0.5">Silent, no computer — Star/Epson CloudPRNT</p>
          </button>
        </div>

        {method === 'device' ? (
          <div className="space-y-3 pt-1">
            <Step n={1}>On the tablet or computer next to your printer, open the <span className="font-medium text-foreground">Kitchen Display</span> (<code className="text-xs bg-muted px-1 rounded">{origin}/kitchen</code>).</Step>
            <Step n={2}>Tap the <Printer className="w-3.5 h-3.5 inline -mt-0.5" /> button in the top bar — it turns green. <span className="font-medium text-foreground">That device now prints every new order automatically.</span></Step>
            <Step n={3}>
              <button type="button" onClick={() => setShowSilent((s) => !s)} className="inline-flex items-center gap-1 text-primary font-medium hover:underline">
                Print without the popup each time <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showSilent ? 'rotate-180' : ''}`} />
              </button>
              {showSilent && (
                <div className="mt-2 space-y-3 rounded-lg bg-muted/40 border border-border p-3">
                  <p className="text-xs">Launch Chrome in <span className="font-medium text-foreground">kiosk-printing</span> mode so tickets print silently. Create a desktop shortcut with this target:</p>
                  <div>
                    <CopyField label="Windows shortcut target" value={winShortcut} />
                    <p className="text-[11px] text-muted-foreground mt-1">Right-click desktop → New → Shortcut → paste this. Set the printer as the Windows default first.</p>
                  </div>
                  <div>
                    <CopyField label="Mac (Terminal)" value={macShortcut} />
                  </div>
                  <p className="text-[11px] text-muted-foreground">On iPad / Android the system print sheet appears each time — for fully silent printing use the Network printer option instead.</p>
                </div>
              )}
            </Step>
            <div className="pt-1">
              <Button variant="outline" onClick={onTestPrint} className="gap-1.5"><Printer className="w-4 h-4" /> Send a test ticket</Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3 pt-1">
            <Step n={1}>Set a secret password for the printer: in <span className="font-medium text-foreground">Supabase → Edge Functions → Secrets</span>, add <code className="text-xs bg-muted px-1 rounded">CLOUDPRNT_TOKEN</code> with any strong value.</Step>
            <Step n={2}>
              Open your Star/Epson printer's setup page and paste this as the <span className="font-medium text-foreground">Server / Poll URL</span> (replace <code className="text-xs bg-muted px-1 rounded">YOUR_TOKEN</code> with the secret from step 1):
              <CopyField value={cloudPrntUrl} />
            </Step>
            <Step n={3}>Save on the printer. It checks for new orders every few seconds and <span className="font-medium text-foreground">prints them automatically — no tablet or computer needed.</span></Step>
            <p className="text-[11px] text-muted-foreground font-sans flex items-start gap-1.5 rounded-lg bg-muted/40 border border-border p-2.5">
              <Wifi className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              This uses the Star CloudPRNT standard. The endpoint is ready, but confirm the exact field name on your printer model with your installer the first time.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default PrinterSetupGuide;
