import React, { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Check, ChevronDown, Copy, Loader2, MoreHorizontal, Plus, Printer, RefreshCw, Trash2, Wifi } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  addPrinter, deletePrinter, listPrinters, pollUrl, requestTestPrint, rotatePollToken, updatePrinter,
  type PrinterRow, type PrinterStation,
} from '@/lib/printers-api';
import { printerSummary, type Tone } from '@/lib/print-routing';

/**
 * Network printers that fetch their own tickets.
 *
 * The easiest setup that keeps working: the printer polls the server, so no
 * tablet has to stay awake, paired or open. Adding one is a name and a
 * station; the page then gives the one URL to paste into the printer's own
 * settings page, and shows within seconds whether it has started asking.
 */

const STATION_LABEL: Record<PrinterStation, string> = { kitchen: 'Kitchen', bar: 'Bar', all: 'Kitchen + bar' };
const PROTOCOL_LABEL = { star_cloudprnt: 'Star CloudPRNT', epson_sdp: 'Epson Server Direct Print' } as const;

const TONE_DOT: Record<Tone, string> = {
  ok: 'bg-primary', busy: 'bg-accent', bad: 'bg-destructive animate-pulse', idle: 'bg-muted-foreground/50',
};
const TONE_TEXT: Record<Tone, string> = {
  ok: 'text-primary', busy: 'text-accent', bad: 'text-destructive', idle: 'text-muted-foreground',
};

const CopyUrl = ({ url }: { url: string }) => {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error('Could not copy — select the address and copy it by hand');
    }
  };
  return (
    <div className="flex items-stretch gap-2">
      <code className="flex-1 min-w-0 text-xs bg-muted/60 border border-border rounded-lg px-3 py-2 font-mono break-all select-all">{url}</code>
      <Button type="button" variant="outline" size="sm" onClick={copy} className="shrink-0 gap-1.5 min-h-[40px]">
        {copied ? <Check className="w-3.5 h-3.5 text-primary" /> : <Copy className="w-3.5 h-3.5" />}{copied ? 'Copied' : 'Copy'}
      </Button>
    </div>
  );
};

const Steps = ({ steps }: { steps: React.ReactNode[] }) => (
  <ol className="space-y-2">
    {steps.map((step, i) => (
      <li key={i} className="flex gap-3 text-sm font-sans text-muted-foreground leading-relaxed">
        <span className="shrink-0 w-6 h-6 rounded-full bg-primary/15 text-primary text-xs font-bold flex items-center justify-center">{i + 1}</span>
        <span className="min-w-0 pt-0.5">{step}</span>
      </li>
    ))}
  </ol>
);

const Setup = ({ printer }: { printer: PrinterRow }) => {
  const [brand, setBrand] = useState<'star' | 'epson'>(printer.protocol === 'epson_sdp' ? 'epson' : 'star');
  const url = pollUrl(printer.poll_token);
  const b = (s: string) => <span className="font-medium text-foreground">{s}</span>;
  return (
    <div className="space-y-3 rounded-xl border border-border bg-muted/20 p-3">
      <div>
        <p className="text-xs font-sans font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">This printer’s address</p>
        <CopyUrl url={url} />
        <p className="text-[11px] text-muted-foreground mt-1">Keep it private: anyone with this address can read this printer’s tickets. “New address” below replaces it.</p>
      </div>
      <div className="inline-flex rounded-full border border-border overflow-hidden" role="group" aria-label="Printer brand">
        {(['star', 'epson'] as const).map((key) => (
          <button
            key={key}
            type="button"
            aria-pressed={brand === key}
            onClick={() => setBrand(key)}
            className={`px-3 min-h-[40px] text-sm font-sans ${brand === key ? 'bg-foreground text-background' : 'bg-card text-muted-foreground'}`}
          >
            {key === 'star' ? 'Star' : 'Epson'}
          </button>
        ))}
      </div>
      {brand === 'star' ? (
        <Steps steps={[
          <>Connect the printer to the router with a network cable and switch it on. Hold the {b('FEED')} button while switching on to print its settings page — it shows the printer’s {b('IP address')}.</>,
          <>On a phone or laptop on the same Wi-Fi, open {b('http://<that IP>')}, log in ({b('root')} / {b('public')} unless changed) and go to {b('CloudPRNT')}.</>,
          <>Turn CloudPRNT {b('on')}, paste the address above as the {b('Server URL')}, set the {b('polling interval to 5 seconds')}, then {b('Save')} and {b('Restart')}.</>,
          <>Come back here: within a few seconds this printer shows {b('Online')}. Press {b('Test print')}.</>,
        ]} />
      ) : (
        <Steps steps={[
          <>Connect the printer with a network cable and switch it on. Hold {b('FEED')} while switching on to print its status sheet with the {b('IP address')}.</>,
          <>Open {b('http://<that IP>')} (Epson Web Config; default password is on the label or the status sheet) and go to {b('Server Direct Print')}.</>,
          <>Enable it, paste the address above as {b('URL')} (ID: anything, e.g. kitchen), set the {b('interval to 5 seconds')}, and {b('Save')}.</>,
          <>Come back here: the printer shows {b('Online')} within a few seconds. Press {b('Test print')}.</>,
        ]} />
      )}
      <p className="text-[11px] text-muted-foreground font-sans">
        Works with Star TSP143IV, mC-Print3 (CloudPRNT) and Epson TM-m30III, TM-T88VII, TM-m50 (Server Direct Print).
        An Epson TM-T20 cannot poll — use it from a tablet instead (below).
      </p>
    </div>
  );
};

const PrinterCard = ({ printer, onChanged }: { printer: PrinterRow; onChanged: () => void }) => {
  const [open, setOpen] = useState(!printer.last_seen_at);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const summary = printerSummary({
    enabled: printer.enabled,
    online: !!printer.last_seen_at && Date.now() - new Date(printer.last_seen_at).getTime() < 60_000,
    last_seen_at: printer.last_seen_at,
    last_error: printer.last_error,
  });
  const testPending = !!printer.test_requested_at
    && (!printer.last_test_printed_at || printer.last_test_printed_at < printer.test_requested_at);

  const act = async (label: string, fn: () => Promise<void>) => {
    setBusy(true);
    try { await fn(); onChanged(); } catch (error) {
      toast.error(`${label}: ${error instanceof Error ? error.message : 'failed'}`);
    } finally { setBusy(false); }
  };

  return (
    <div className="rounded-xl border border-border bg-card p-3 sm:p-4 space-y-3" data-testid="cloud-printer">
      <div className="flex items-start gap-3">
        <span className={`mt-1.5 w-2.5 h-2.5 rounded-full shrink-0 ${TONE_DOT[summary.tone]}`} aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-sans font-semibold text-foreground">{printer.name}</p>
            <span className="text-[11px] font-sans px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{STATION_LABEL[printer.station]}</span>
            <span className="text-[11px] font-sans px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{printer.paper_width} mm</span>
          </div>
          <p className={`text-sm font-sans ${TONE_TEXT[summary.tone]}`} role="status">{summary.label}</p>
          <p className="text-xs text-muted-foreground font-sans">
            {printer.protocol ? PROTOCOL_LABEL[printer.protocol] : 'Waiting for the printer to call in'}
            {printer.last_status ? ` · status ${printer.last_status}` : ''}
            {printer.plain_text ? ' · plain text mode' : ''}
          </p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button
            variant="outline" size="sm" className="gap-1.5 min-h-[40px]" disabled={busy || !printer.enabled}
            onClick={() => act('Test print', async () => {
              await requestTestPrint(printer.id);
              toast.success(`${printer.name} prints a test page on its next call — within about 10 seconds`);
            })}
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Printer className="w-4 h-4" />}
            {testPending ? 'Test sent…' : 'Test print'}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="min-h-[40px] min-w-[40px]" aria-label={`More for ${printer.name}`}>
                <MoreHorizontal className="w-4 h-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60">
              <DropdownMenuLabel>Prints</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={printer.station}
                onValueChange={(v) => act('Station', () => updatePrinter(printer.id, { station: v as PrinterStation }))}
              >
                {(Object.keys(STATION_LABEL) as PrinterStation[]).map((s) => (
                  <DropdownMenuRadioItem key={s} value={s} className="min-h-[40px]">{STATION_LABEL[s]} tickets</DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
              <DropdownMenuRadioGroup
                value={String(printer.paper_width)}
                onValueChange={(v) => act('Paper', () => updatePrinter(printer.id, { paper_width: Number(v) as 58 | 80 }))}
              >
                <DropdownMenuRadioItem value="80" className="min-h-[40px]">80 mm paper</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="58" className="min-h-[40px]">58 mm paper</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
              <DropdownMenuCheckboxItem
                checked={printer.plain_text}
                onCheckedChange={(v) => act('Plain text', () => updatePrinter(printer.id, { plain_text: !!v }))}
                className="min-h-[40px]"
              >
                Plain text (if tickets print garbled)
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={printer.enabled}
                onCheckedChange={(v) => act('Enable', () => updatePrinter(printer.id, { enabled: !!v }))}
                className="min-h-[40px]"
              >
                Printing on
              </DropdownMenuCheckboxItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="min-h-[40px] gap-2"
                onSelect={() => act('New address', async () => {
                  await rotatePollToken(printer.id);
                  setOpen(true);
                  toast.success('New address made — paste it into the printer, the old one no longer works');
                })}
              >
                <RefreshCw className="w-4 h-4" /> New address
              </DropdownMenuItem>
              <DropdownMenuItem className="min-h-[40px] gap-2 text-destructive focus:text-destructive" onSelect={() => setConfirmDelete(true)}>
                <Trash2 className="w-4 h-4" /> Remove printer
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex items-center gap-1 text-sm font-sans font-medium text-primary min-h-[36px]"
      >
        {open ? 'Hide setup' : 'Address & setup steps'} <ChevronDown className={`w-4 h-4 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <Setup printer={printer} />}

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {printer.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Its address stops working at once. Tickets for its station go back to being printed from a tablet, if one is set up.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-[44px]">Keep it</AlertDialogCancel>
            <AlertDialogAction
              className="min-h-[44px] bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => act('Remove', () => deletePrinter(printer.id))}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

const AddPrinter = ({ existing, onAdded }: { existing: PrinterRow[]; onAdded: () => void }) => {
  const suggested: PrinterStation = existing.some((p) => p.station !== 'bar') ? 'bar' : 'kitchen';
  const [name, setName] = useState(suggested === 'bar' ? 'Bar printer' : 'Kitchen printer');
  const [station, setStation] = useState<PrinterStation>(suggested);
  const [paper, setPaper] = useState<58 | 80>(80);
  const [busy, setBusy] = useState(false);

  const add = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await addPrinter({ name: name.trim(), station, paper_width: paper });
      toast.success(`${name.trim()} added — paste its address into the printer`);
      onAdded();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not add the printer');
    } finally { setBusy(false); }
  };

  return (
    <div className="rounded-xl border border-dashed border-border p-3 sm:p-4 space-y-3">
      <p className="text-sm font-sans font-semibold text-foreground">Add a network printer</p>
      <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto_auto] items-center">
        <Input value={name} onChange={(e) => setName(e.target.value)} aria-label="Printer name" className="h-11" maxLength={60} />
        <div className="inline-flex rounded-full border border-border overflow-hidden" role="group" aria-label="Prints">
          {(Object.keys(STATION_LABEL) as PrinterStation[]).map((s) => (
            <button
              key={s} type="button" aria-pressed={station === s} onClick={() => setStation(s)}
              className={`px-3 min-h-[44px] text-sm font-sans ${station === s ? 'bg-foreground text-background' : 'bg-card text-muted-foreground'}`}
            >
              {STATION_LABEL[s]}
            </button>
          ))}
        </div>
        <div className="inline-flex rounded-full border border-border overflow-hidden" role="group" aria-label="Paper width">
          {([80, 58] as const).map((w) => (
            <button
              key={w} type="button" aria-pressed={paper === w} onClick={() => setPaper(w)}
              className={`px-3 min-h-[44px] text-sm font-sans tabular-nums ${paper === w ? 'bg-foreground text-background' : 'bg-card text-muted-foreground'}`}
            >
              {w} mm
            </button>
          ))}
        </div>
        <Button onClick={add} disabled={busy || !name.trim()} className="min-h-[44px] gap-1.5">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Add printer
        </Button>
      </div>
    </div>
  );
};

const CloudPrinters = () => {
  const [printers, setPrinters] = useState<PrinterRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setPrinters(await listPrinters());
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Could not load printers');
      setPrinters((prev) => prev ?? []);
    }
  }, []);

  // Live enough to watch a printer come online while setting it up.
  useEffect(() => {
    void load();
    const id = setInterval(() => { void load(); }, 5_000);
    return () => clearInterval(id);
  }, [load]);

  return (
    <Card>
      <CardContent className="p-4 sm:p-5 space-y-4">
        <div>
          <h2 className="font-serif text-lg font-semibold text-foreground flex items-center gap-2">
            <Wifi className="w-5 h-5 text-primary" /> Network printers
            <span className="text-[10px] font-sans font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-primary text-primary-foreground">Recommended</span>
          </h2>
          <p className="text-xs text-muted-foreground font-sans mt-1">
            The printer fetches its own tickets from the internet — no tablet has to stay on, paired or awake.
            One per station (kitchen, bar), or one for both.
          </p>
        </div>

        {loadError && (
          <p className="text-xs font-sans text-destructive" role="alert">
            {/relation|does not exist|schema cache/i.test(loadError)
              ? 'Network printers need the 20261026120000_cloud_printers migration to be applied first.'
              : loadError}
          </p>
        )}

        {printers === null ? (
          <Skeleton className="h-24 w-full rounded-xl" />
        ) : (
          <div className="space-y-3">
            {printers.map((p) => <PrinterCard key={p.id} printer={p} onChanged={load} />)}
            <AddPrinter existing={printers} onAdded={load} />
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default CloudPrinters;
