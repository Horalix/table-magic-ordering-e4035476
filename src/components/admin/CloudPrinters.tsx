import React, { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Check, ChevronDown, Copy, Loader2, MoreHorizontal, Plus, Printer, RefreshCw, Trash2, Wifi } from 'lucide-react';
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
import { AdminCard, AdminCardContent, AdminCardHeader, EmptyState } from '@/components/admin/AdminCard';
import { TONE, type StaffTone } from '@/components/staff/status-tone';
import { cn } from '@/lib/utils';
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

/**
 * Element ids the Printing page and the tablet guide scroll to (the add
 * form's name field, this card). Written out there too: a component file
 * that exports constants loses fast refresh.
 */
const ADD_PRINTER_INPUT_ID = 'add-printer-name';
const NETWORK_PRINTERS_ID = 'network-printers';

/** A printer's state in the staff screens' colours: green fine, amber busy, red wrong, grey idle. */
const PRINT_TONE: Record<Tone, StaffTone> = { ok: 'ready', busy: 'preparing', bad: 'late', idle: 'served' };

/** Seen in the last minute: the same test the printer health check uses. */
const isOnline = (p: Pick<PrinterRow, 'last_seen_at'>) =>
  !!p.last_seen_at && Date.now() - new Date(p.last_seen_at).getTime() < 60_000;

/**
 * One row of choices, one tap each, the choice always visible. Buttons with
 * aria-pressed in a labelled group, which the tests and screen readers use.
 */
export const Segmented = <T extends string | number>({ value, options, onChange, label, className }: {
  value: T;
  options: { value: NoInfer<T>; label: React.ReactNode }[];
  onChange: (v: NoInfer<T>) => void;
  label: string;
  className?: string;
}) => (
  <div role="group" aria-label={label} className={cn('inline-flex max-w-full gap-1 rounded-lg bg-muted/70 p-1', className)}>
    {options.map((o) => {
      const on = value === o.value;
      return (
        <button
          key={String(o.value)}
          type="button"
          aria-pressed={on}
          onClick={() => onChange(o.value)}
          className={cn(
            'flex-1 whitespace-nowrap rounded-md px-3 h-10 sm:h-8 text-sm font-sans font-medium tabular-nums transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            on ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {o.label}
        </button>
      );
    })}
  </div>
);

/** A state as a word in a soft pill with its dot: never colour alone. */
export const StatePill = ({ tone, children, pulse = false, className, ...rest }: React.HTMLAttributes<HTMLSpanElement> & {
  tone: StaffTone; pulse?: boolean;
}) => (
  <span
    className={cn('inline-flex max-w-full items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-sans font-medium leading-5', TONE[tone].chip, className)}
    {...rest}
  >
    <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', TONE[tone].dot, pulse && 'animate-pulse motion-reduce:animate-none')} aria-hidden />
    <span className="min-w-0 truncate">{children}</span>
  </span>
);

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
    <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
      <code className="min-w-0 flex-1 select-all break-all rounded-lg border border-border bg-card px-3 py-2.5 font-mono text-xs leading-relaxed">{url}</code>
      <Button type="button" variant="outline" onClick={copy} className="h-11 shrink-0 gap-1.5 self-start sm:h-auto lg:min-h-[40px] sm:self-stretch">
        {copied ? <Check className="h-4 w-4 text-primary" /> : <Copy className="h-4 w-4" />}{copied ? 'Copied' : 'Copy'}
      </Button>
    </div>
  );
};

const Steps = ({ steps }: { steps: React.ReactNode[] }) => (
  <ol className="space-y-3">
    {steps.map((step, i) => (
      <li key={i} className="flex gap-3 text-sm font-sans leading-relaxed text-muted-foreground">
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-primary/10 text-xs font-semibold tabular-nums text-primary" aria-hidden>{i + 1}</span>
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
    <div className="mt-3 space-y-4 rounded-xl bg-muted/40 p-4 sm:ms-[52px]">
      <div>
        <p className="mb-1.5 text-xs font-sans font-medium text-muted-foreground">This printer’s address</p>
        <CopyUrl url={url} />
        <p className="mt-1.5 text-xs font-sans leading-relaxed text-muted-foreground">Keep it private: anyone with this address can read this printer’s tickets. “New address” below replaces it.</p>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <p className="text-xs font-sans font-medium text-muted-foreground">Steps for</p>
        <Segmented
          label="Printer brand" value={brand} onChange={setBrand}
          options={[{ value: 'star', label: 'Star' }, { value: 'epson', label: 'Epson' }]}
        />
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
      <p className="text-xs font-sans leading-relaxed text-muted-foreground">
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
  // A new address stops the printer until someone types it into the printer itself.
  const [confirmNewAddress, setConfirmNewAddress] = useState(false);
  const summary = printerSummary({
    enabled: printer.enabled,
    online: isOnline(printer),
    last_seen_at: printer.last_seen_at,
    last_error: printer.last_error,
  });
  const testPending = !!printer.test_requested_at
    && (!printer.last_test_printed_at || printer.last_test_printed_at < printer.test_requested_at);
  // "Offline — last seen 4 min ago": the state in the pill, the detail beside it.
  const [stateWord, ...detail] = summary.label.split(' — ');
  const facts = [
    printer.protocol ? PROTOCOL_LABEL[printer.protocol] : 'Waiting for the printer to call in',
    printer.last_status ? `status ${printer.last_status}` : null,
    printer.plain_text ? 'plain text mode' : null,
  ].filter(Boolean).join(' · ');

  const act = async (label: string, fn: () => Promise<void>) => {
    setBusy(true);
    try { await fn(); onChanged(); } catch (error) {
      toast.error(`${label}: ${error instanceof Error ? error.message : 'failed'}`);
    } finally { setBusy(false); }
  };

  return (
    <li className="py-4 first:pt-0" data-testid="cloud-printer">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 hidden h-10 w-10 shrink-0 place-items-center rounded-xl bg-muted text-muted-foreground sm:grid" aria-hidden>
          <Printer className="h-[18px] w-[18px]" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-sans font-semibold text-foreground">{printer.name}</p>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
            <span role="status" className={cn('inline-flex min-w-0 max-w-full flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs font-sans', TONE[PRINT_TONE[summary.tone]].text)}>
              <StatePill tone={PRINT_TONE[summary.tone]} pulse={summary.tone === 'bad'}>{stateWord}</StatePill>
              {detail.length > 0 && <span className="min-w-0 break-words">{detail.join(' — ')}</span>}
            </span>
            <span className="text-xs font-sans text-muted-foreground">{STATION_LABEL[printer.station]} · <span className="tabular-nums">{printer.paper_width} mm</span></span>
          </div>
          <p className="mt-1 text-xs font-sans text-muted-foreground break-words">{facts}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="outline" className="h-11 gap-1.5 px-3 lg:h-10" disabled={busy || !printer.enabled}
            onClick={() => act('Test print', async () => {
              await requestTestPrint(printer.id);
              toast.success(`${printer.name} prints a test page on its next call — within about 10 seconds`);
            })}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <Printer className="h-4 w-4" />}
            {testPending ? 'Test sent…' : 'Test print'}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-11 w-11 lg:h-10 lg:w-10" aria-label={`More for ${printer.name}`}>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60">
              <DropdownMenuLabel>Prints</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={printer.station}
                onValueChange={(v) => act('Station', () => updatePrinter(printer.id, { station: v as PrinterStation }))}
              >
                {(Object.keys(STATION_LABEL) as PrinterStation[]).map((s) => (
                  <DropdownMenuRadioItem key={s} value={s} className="min-h-[44px] lg:min-h-[40px]">{STATION_LABEL[s]} tickets</DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
              <DropdownMenuRadioGroup
                value={String(printer.paper_width)}
                onValueChange={(v) => act('Paper', () => updatePrinter(printer.id, { paper_width: Number(v) as 58 | 80 }))}
              >
                <DropdownMenuRadioItem value="80" className="min-h-[44px] lg:min-h-[40px]">80 mm paper</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="58" className="min-h-[44px] lg:min-h-[40px]">58 mm paper</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
              <DropdownMenuCheckboxItem
                checked={printer.plain_text}
                onCheckedChange={(v) => act('Plain text', () => updatePrinter(printer.id, { plain_text: !!v }))}
                className="min-h-[44px] lg:min-h-[40px]"
              >
                Plain text (if tickets print garbled)
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={printer.enabled}
                onCheckedChange={(v) => act('Enable', () => updatePrinter(printer.id, { enabled: !!v }))}
                className="min-h-[44px] lg:min-h-[40px]"
              >
                Printing on
              </DropdownMenuCheckboxItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="min-h-[44px] gap-2 lg:min-h-[40px]"
                onSelect={() => setConfirmNewAddress(true)}
              >
                <RefreshCw className="h-4 w-4" /> New address
              </DropdownMenuItem>
              <DropdownMenuItem className="min-h-[44px] gap-2 text-destructive focus:text-destructive lg:min-h-[40px]" onSelect={() => setConfirmDelete(true)}>
                <Trash2 className="h-4 w-4" /> Remove printer
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="mt-1 inline-flex min-h-[44px] items-center gap-1 rounded-md text-sm font-sans font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:ms-[52px] lg:min-h-[36px]"
      >
        {open ? 'Hide setup' : 'Address & setup steps'}
        <ChevronDown className={cn('h-4 w-4 transition-transform motion-reduce:transition-none', open && 'rotate-180')} aria-hidden />
      </button>
      {open && <Setup printer={printer} />}

      <AlertDialog open={confirmNewAddress} onOpenChange={setConfirmNewAddress}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Give {printer.name} a new address?</AlertDialogTitle>
            <AlertDialogDescription>
              It stops printing tickets until someone enters the new address on the printer itself. Only do this if the old address was shared by mistake.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-[44px]">Keep the current address</AlertDialogCancel>
            <AlertDialogAction
              className="min-h-[44px] bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => act('New address', async () => {
                await rotatePollToken(printer.id);
                setOpen(true);
                toast.success('New address made — paste it into the printer, the old one no longer works');
              })}
            >
              Make a new address
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
    </li>
  );
};

const AddPrinter = ({ existing, onAdded }: { existing: PrinterRow[]; onAdded: () => void }) => {
  // Suggest whichever station has no printer yet; a spare once both do.
  const covers = (s: 'kitchen' | 'bar') => existing.some((p) => p.station === s || p.station === 'all');
  const suggested: PrinterStation = !covers('kitchen') ? 'kitchen' : !covers('bar') ? 'bar' : 'kitchen';
  const [name, setName] = useState(
    !covers('kitchen') ? 'Kitchen printer' : !covers('bar') ? 'Bar printer' : `Printer ${existing.length + 1}`,
  );
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
    <div className={cn('space-y-3', existing.length > 0 && 'border-t border-border/70 pt-5')}>
      <div>
        <p className="text-sm font-sans font-semibold text-foreground">Add a network printer</p>
        <p className="mt-0.5 text-xs font-sans text-muted-foreground">Name it after where it stands, pick what it prints, then paste the address it gets into the printer.</p>
      </div>
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto_auto_auto] lg:items-center">
        <Input
          id={ADD_PRINTER_INPUT_ID} value={name} onChange={(e) => setName(e.target.value)}
          aria-label="Printer name" className="h-11" maxLength={60}
        />
        <div className="flex flex-wrap items-center gap-2 lg:contents">
          <Segmented
            label="Prints" value={station} onChange={setStation}
            options={(Object.keys(STATION_LABEL) as PrinterStation[]).map((s) => ({ value: s, label: STATION_LABEL[s] }))}
          />
          <Segmented
            label="Paper width" value={paper} onChange={setPaper}
            options={([80, 58] as const).map((w) => ({ value: w, label: `${w} mm` }))}
          />
        </div>
        <Button onClick={add} disabled={busy || !name.trim()} className="h-11 gap-1.5 lg:h-10">
          {busy ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <Plus className="h-4 w-4" />} Add printer
        </Button>
      </div>
    </div>
  );
};

export interface CloudPrintersState {
  /** null until the first load has answered. */
  printers: PrinterRow[] | null;
  error: string | null;
}

const CloudPrinters = ({ onChange }: { onChange?: (state: CloudPrintersState) => void }) => {
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

  // The page's setup steps read the same list: one load, two views of it.
  useEffect(() => { onChange?.({ printers, error: loadError }); }, [printers, loadError, onChange]);

  return (
    <AdminCard id={NETWORK_PRINTERS_ID} className="scroll-mt-6">
      <AdminCardHeader
        icon={Wifi}
        title={(
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            Network printers
            <span className="rounded-full bg-primary/10 px-2 py-0.5 font-sans text-[11px] font-semibold leading-4 text-primary">Recommended</span>
          </span>
        )}
        description="The printer fetches its own tickets over the internet, so no tablet has to stay on, paired or awake. One per station (kitchen, bar), or one for both."
      />
      <AdminCardContent className="space-y-4">
        {loadError && (
          <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm font-sans text-destructive">
            {/relation|does not exist|schema cache/i.test(loadError)
              ? 'Network printers need the 20261026120000_cloud_printers migration to be applied first.'
              : loadError}
          </p>
        )}

        {printers === null ? (
          <div className="space-y-3" aria-hidden>
            {[0, 1].map((i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="hidden h-10 w-10 rounded-xl sm:block" />
                <div className="flex-1 space-y-2"><Skeleton className="h-4 w-40" /><Skeleton className="h-3 w-56" /></div>
                <Skeleton className="h-10 w-28 rounded-md" />
              </div>
            ))}
          </div>
        ) : (
          <>
            {printers.length > 0 ? (
              <ul className="divide-y divide-border/70" aria-label="Network printers">
                {printers.map((p) => <PrinterCard key={p.id} printer={p} onChanged={load} />)}
              </ul>
            ) : !loadError && (
              <EmptyState
                icon={Printer}
                className="py-6"
                title="No network printer yet"
                hint="Add one below. It gets its own address to paste into the printer, and shows Online here once it calls in."
              />
            )}
            <AddPrinter existing={printers} onAdded={load} />
          </>
        )}
      </AdminCardContent>
    </AdminCard>
  );
};

export default CloudPrinters;
