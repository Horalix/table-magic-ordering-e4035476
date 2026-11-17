import React, { useEffect, useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { QRCodeSVG } from 'qrcode.react';
import { AlertTriangle, Check, Copy, LayoutGrid, Printer, QrCode, RefreshCw, ScanLine, Square } from 'lucide-react';
import { toast } from 'sonner';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { AdminPageHeader } from '@/components/admin/AdminPage';
import { AdminCard, AdminCardContent, AdminCardHeader, EmptyState, Stagger } from '@/components/admin/AdminCard';
import { TONE } from '@/components/staff/status-tone';
import { cn } from '@/lib/utils';
import type { AdminOutletContext } from '@/components/admin/AdminLayout';
import type { Database } from '@/integrations/supabase/types';
import { HOME_VENUE } from '@/lib/home-venue';
import { qrOrigin, venueByDbId, VENUES } from '@/lib/venues';

type Mode = 'sheet' | 'single' | 'venue';
type TableRow = Database['public']['Tables']['tables']['Row'];

/*
 * What the printed codes say. Paper stays on the tables for months, so it
 * must hold whether or not guests can order yet: "Scan for the menu" is true
 * in both, and choosing a table only happens once ordering is on.
 */
const SCAN_LINE = 'Scan for the menu';

/**
 * Each code carries its own restaurant's address: a Vera Italia table's code
 * opens veraitalia.net once that site is up, whichever site the owner prints
 * it from. Rows from before the second restaurant have no restaurant: here.
 */
const originFor = (venueId?: string | null) => qrOrigin(venueByDbId(venueId)?.slug ?? HOME_VENUE);

/**
 * Print layout for the room code and the one-per-page stickers.
 *
 * The A4 sheet keeps its rules in index.css (.qr-sheet, .qr-cell). The
 * one-per-page rules there are keyed on `.qr-card .border-border`, which the
 * Tailwind build turns into `.qr-card *`: every line of a sticker printed in
 * its own dashed box, and the room code was never made visible at all, so it
 * printed a blank page. These rules use their own class names instead.
 */
const PRINT_CSS = `
@media print {
  .qr-pages { display: block !important; margin: 0 !important; padding: 0 !important; }
  .qr-pages .qr-page, .qr-pages .qr-page * { visibility: visible !important; }
  .qr-pages .qr-page {
    display: flex !important; align-items: center; justify-content: center;
    width: 100% !important; height: 240mm; margin: 0 !important; padding: 0 !important;
    break-inside: avoid; page-break-inside: avoid;
  }
  /* A new page before every shown sticker but the first: "Print this one" hides the rest. */
  .qr-pages .qr-page:not(.print-hidden) ~ .qr-page:not(.print-hidden) { break-before: page; page-break-before: always; }
  .qr-pages .qr-page.print-hidden { display: none !important; }
  .qr-pages .qr-tray { padding: 0 !important; }
  .qr-sticker {
    width: 100mm !important; max-width: none !important; padding: 14mm 10mm !important;
    border: 2px dashed #bbb !important; border-radius: 6mm !important;
    box-shadow: none !important; background: #fff !important; color: #000 !important;
  }
  .qr-sticker svg { width: 64mm !important; height: 64mm !important; max-width: none !important; }
  .qr-sticker .qr-code-frame { padding: 0 !important; }
  .qr-sticker .qr-brand { font-size: 13px !important; letter-spacing: 0.28em !important; color: #000 !important; margin-bottom: 6mm !important; }
  .qr-sticker .qr-table-label { font-size: 30px !important; color: #000 !important; margin-top: 6mm !important; }
  .qr-sticker .qr-divider { background: #999 !important; width: 12mm !important; }
  .qr-sticker .qr-subtitle { font-size: 13px !important; color: #444 !important; }
}`;

/** "Tables 1–14", or a count when the numbers have gaps. */
const tableRange = (tables: TableRow[]) => {
  if (tables.length === 0) return '';
  const nums = tables.map((t) => t.table_number).sort((a, b) => a - b);
  const contiguous = nums[nums.length - 1] - nums[0] === nums.length - 1;
  if (nums.length === 1) return `Table ${nums[0]}`;
  return contiguous ? `Tables ${nums[0]}–${nums[nums.length - 1]}` : `${nums.length} tables`;
};

/** The printed card: restaurant, code, what it is for. The same on screen as on paper. */
const Sticker = ({ brand, value, label, size, className }: {
  brand: string; value: string; label: string; size: 'lg' | 'md'; className?: string;
}) => (
  <div className={cn('qr-sticker flex w-full flex-col items-center rounded-2xl border border-border/80 bg-white text-center text-neutral-900 shadow-lux', size === 'lg' ? 'max-w-[320px] px-6 py-7' : 'px-3 py-5 sm:px-5', className)}>
    <p className={cn('qr-brand font-serif font-medium uppercase text-neutral-500', size === 'lg' ? 'mb-4 text-xs tracking-[0.24em]' : 'mb-3 text-[10px] tracking-[0.2em] sm:text-[11px]')}>{brand}</p>
    <div className="qr-code-frame rounded-xl bg-white p-1">
      <QRCodeSVG value={value} size={size === 'lg' ? 220 : 160} level="H" className="h-auto w-full" style={{ maxWidth: size === 'lg' ? 220 : 160 }} />
    </div>
    <p className={cn('qr-table-label font-serif font-bold leading-tight text-neutral-900', size === 'lg' ? 'mt-5 text-2xl' : 'mt-3 text-xl sm:text-2xl')}>{label}</p>
    {size === 'md' && (
      <>
        <div className="qr-divider mx-auto my-2 h-px w-8 bg-neutral-300" aria-hidden />
        <p className="qr-subtitle text-[11px] font-sans text-neutral-500">{SCAN_LINE}</p>
      </>
    )}
  </div>
);

/* ---- Choosing what to print -------------------------------------------- */

/** `name` is the button's accessible name, which the tests and the role specs use ("A4 Sheet"). */
const MODES: { mode: Mode; title: string; name: string; hint: string; icon: typeof ScanLine }[] = [
  { mode: 'venue', title: 'Room code', name: 'Room code', hint: 'One code for the whole room', icon: ScanLine },
  { mode: 'sheet', title: 'A4 sheet', name: 'A4 Sheet', hint: 'Small table stickers, three across', icon: LayoutGrid },
  { mode: 'single', title: 'Per table', name: 'Per table', hint: 'One large sticker per page', icon: Square },
];

const ModePicker = ({ mode, onChange }: { mode: Mode; onChange: (m: Mode) => void }) => (
  <div role="group" aria-label="What to print" className="grid grid-cols-3 gap-2 sm:gap-3">
    {MODES.map(({ mode: m, title, name, hint, icon: Icon }) => {
      const on = mode === m;
      return (
        <button
          key={m}
          type="button"
          aria-pressed={on}
          aria-label={name}
          aria-describedby={`qr-mode-${m}`}
          onClick={() => onChange(m)}
          className={cn(
            'flex min-h-[88px] flex-col items-start rounded-xl border p-3 text-start transition-colors sm:min-h-0 sm:p-4',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            on ? 'border-primary/60 bg-primary/5 ring-1 ring-primary/30' : 'border-border bg-card hover:bg-muted/40',
          )}
        >
          <span className="flex w-full items-center justify-between gap-2">
            <Icon className={cn('h-5 w-5', on ? 'text-primary' : 'text-muted-foreground')} aria-hidden />
            {on && <Check className="h-4 w-4 text-primary" aria-hidden />}
          </span>
          <span className="mt-2 text-sm font-sans font-semibold leading-snug text-foreground">{title}</span>
          <span id={`qr-mode-${m}`} className="mt-0.5 hidden text-xs font-sans leading-snug text-muted-foreground sm:block">{hint}</span>
        </button>
      );
    })}
  </div>
);

/* ---- The three steps ---------------------------------------------------- */

const StepMark = ({ n, done, current }: { n: number; done: boolean; current: boolean }) => (
  <span
    className={cn(
      'grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-semibold font-sans tabular-nums',
      done ? TONE.ready.solid : current ? 'border-2 border-primary text-primary' : 'border border-border text-muted-foreground',
    )}
    aria-hidden
  >
    {done ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : n}
  </span>
);

const Step = ({ n, title, done = false, current = false, children }: {
  n: number; title: string; done?: boolean; current?: boolean; children: React.ReactNode;
}) => (
  <li className="flex min-w-0 gap-3">
    <StepMark n={n} done={done} current={current} />
    <div className="min-w-0 flex-1">
      <p className="text-sm font-sans font-semibold leading-7 text-foreground">
        {done && <span className="sr-only">Done: </span>}{title}
      </p>
      <div className="text-[13px] font-sans leading-relaxed text-muted-foreground">{children}</div>
    </div>
  </li>
);

/** A link on its own line under a step: 44 px to tap on a phone. */
const stepLink = 'mt-0.5 inline-flex min-h-[44px] items-center text-[13px] font-sans font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-0';

const AdminQRCodes = () => {
  const venueName = useOutletContext<AdminOutletContext | null>()?.venueName ?? null;
  const [tables, setTables] = useState<TableRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [menuOnly, setMenuOnly] = useState<boolean | null>(null);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [mode, setMode] = useState<Mode>('venue');
  const [venueToken, setVenueToken] = useState<string | null>(null);
  const [settingsVenue, setSettingsVenue] = useState<string | null>(null);
  const [rotatedAt, setRotatedAt] = useState<string | null>(null);
  const [rotating, setRotating] = useState(false);

  const load = async () => {
    const [{ data: rows, error: tablesError }, { data: settings, error: settingsError }] = await Promise.all([
      supabase.from('tables').select('*').order('table_number'),
      // One row: the access rules show this restaurant's settings only.
      // '*', not a column list: venue_id exists only once the two-restaurant migration is in.
      supabase.from('restaurant_settings').select('*').maybeSingle(),
    ]);
    // A failed load is said as one, never as "no tables" or a code that
    // leads nowhere: a manager would print it.
    setFailed(!!(tablesError || settingsError));
    setLoaded(true);
    setTables(rows || []);
    const row = settings as { venue_qr_token?: string; venue_qr_rotated_at?: string; venue_id?: string | null; menu_only?: boolean } | null;
    setVenueToken(row?.venue_qr_token ?? null);
    setRotatedAt(row?.venue_qr_rotated_at ?? null);
    setSettingsVenue(row?.venue_id ?? null);
    setMenuOnly(typeof row?.menu_only === 'boolean' ? row.menu_only : null);
  };

  useEffect(() => { void load(); }, []);

  const getQRUrl = (table: TableRow) =>
    `${originFor((table as { venue_id?: string | null }).venue_id)}/table/${table.table_number}?token=${table.qr_token}`;

  const venueUrl = venueToken ? `${originFor(settingsVenue)}/start?token=${venueToken}` : null;
  /** The restaurant printed on a code: the table's own, else this admin's. */
  const nameFor = (venueId?: string | null) => venueByDbId(venueId)?.name ?? venueName ?? VENUES[HOME_VENUE]?.name ?? '';
  const roomName = nameFor(settingsVenue);

  /**
   * Rotating kills every printed code instantly. That is the point — it is the
   * one-click answer to "someone photographed our QR".
   */
  const rotateVenue = async () => {
    setRotating(true);
    try {
      const { error } = await supabase.rpc('rotate_venue_qr_token' as never, {} as never);
      if (error) throw new Error(error.message);
      await load();
      toast.success('New room code made. Print it now and replace every old one.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not rotate the QR');
    } finally {
      setRotating(false);
    }
  };

  const printAll = () => window.print();

  const printSingle = (tableId: string) => {
    // temporarily switch to single mode if needed
    const wasSheet = mode === 'sheet';
    if (wasSheet) setMode('single');
    requestAnimationFrame(() => {
      const allCards = document.querySelectorAll('.qr-card');
      allCards.forEach((c) => (c as HTMLElement).classList.add('print-hidden'));
      const target = document.getElementById(`qr-card-${tableId}`);
      target?.classList.remove('print-hidden');
      window.print();
      allCards.forEach((c) => (c as HTMLElement).classList.remove('print-hidden'));
      if (wasSheet) setMode('sheet');
    });
  };

  const canPrint = !failed && loaded && (mode === 'venue' ? !!venueUrl : tables.length > 0);
  const printLabel = mode === 'venue' ? 'Print room code' : mode === 'sheet' ? 'Print A4 sheets' : 'Print all stickers';

  const emptyTables = (
    <EmptyState
      icon={QrCode}
      title="No tables created yet."
      hint={<>Add them under <Link to="/admin/tables" className="font-medium text-primary hover:underline">Tables</Link> first, then come back to print their codes.</>}
    />
  );

  return (
    <div className="mx-auto w-full max-w-5xl">
      <style>{PRINT_CSS}</style>
      <AlertDialog open={confirmReplace} onOpenChange={setConfirmReplace}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Replace the room QR code?</AlertDialogTitle>
            <AlertDialogDescription>
              Every printed room code for {roomName || 'this restaurant'} stops working the moment you confirm.
              Guests who scan an old one are told it is not valid. Only do this if someone has copied your
              code — then print the new one straight away and replace every old one.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-[44px]">Keep the current code</AlertDialogCancel>
            <AlertDialogAction
              className="min-h-[44px] bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { void rotateVenue(); }}
            >
              Replace the code
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AdminPageHeader
        className="no-print"
        title="QR codes"
        description="The codes guests scan to open the menu. Print them once: they keep working until you replace them."
        actions={(
          <Button onClick={printAll} disabled={!canPrint} className="h-11 gap-1.5 lg:h-10">
            <Printer className="h-4 w-4" /> {printLabel}
          </Button>
        )}
      />

      {failed && (
        <div role="alert" className="no-print mb-6 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm font-sans">
          <p className="font-semibold text-destructive">The codes could not be loaded.</p>
          <p className="mt-1 text-muted-foreground">Check the internet connection and try again. Do not print until they show.</p>
          <Button type="button" variant="outline" className="mt-3 h-11 gap-1.5 lg:h-9" onClick={() => { void load(); }}>
            <RefreshCw className="h-4 w-4" /> Try again
          </Button>
        </div>
      )}

      <Stagger className="space-y-6">
        {/* ===== THE PATH: tables → print → test ===== */}
        {!failed && (
          <AdminCard className="no-print">
            <AdminCardHeader title="Get the codes onto the tables" description="Three steps, once. Reprint only if a code is damaged or replaced." />
            <AdminCardContent>
              {!loaded ? (
                <div className="grid gap-5 sm:grid-cols-3" aria-hidden>
                  {[0, 1, 2].map((i) => <div key={i} className="flex gap-3"><Skeleton className="h-7 w-7 rounded-full" /><div className="flex-1 space-y-2"><Skeleton className="h-4 w-28" /><Skeleton className="h-3 w-full" /></div></div>)}
                </div>
              ) : (
                <ol className="grid gap-x-6 gap-y-4 sm:grid-cols-3">
                  <Step n={1} title="Have your tables" done={tables.length > 0} current={tables.length === 0}>
                    <p>{tables.length > 0 ? `${tableRange(tables)}, each with its own code.` : 'No tables yet. Each table gets its own code once it is added.'}</p>
                    <Link to="/admin/tables" className={stepLink}>{tables.length > 0 ? 'Manage tables' : 'Add tables'}</Link>
                  </Step>
                  <Step n={2} title="Print the codes" current={tables.length > 0}>
                    Pick a layout below, then print. Thick paper or sticker sheets last longest.
                  </Step>
                  <Step n={3} title="Test a scan">
                    Scan one with your phone before putting them out. It should open the menu{menuOnly === false ? ' and ask for the table' : ''}.
                  </Step>
                </ol>
              )}
            </AdminCardContent>
          </AdminCard>
        )}

        {/* ===== WHICH LAYOUT ===== */}
        <section aria-label="Layouts" className="no-print">
          <ModePicker mode={mode} onChange={setMode} />
          <p className="mt-2 text-xs font-sans text-muted-foreground sm:hidden">{MODES.find((m) => m.mode === mode)?.hint}</p>
        </section>

        {/* ===== VENUE MODE (single QR for the whole place) ===== */}
        {mode === 'venue' && !failed && (
          <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,360px)]">
            {!loaded ? (
              <Skeleton className="h-[440px] w-full rounded-2xl" />
            ) : venueUrl ? (
              <AdminCard className="qr-pages">
                <div className="qr-tray flex justify-center rounded-2xl bg-muted/40 px-4 py-8 sm:py-10">
                  <div className="qr-card qr-page flex w-full justify-center" id="qr-card-venue">
                    <Sticker brand={roomName} value={venueUrl} label={SCAN_LINE} size="lg" />
                  </div>
                </div>
              </AdminCard>
            ) : (
              <AdminCard className="no-print">
                <EmptyState
                  icon={QrCode}
                  className="py-16"
                  title="This restaurant has no room code yet."
                  hint="Ask your developer to set one up before printing."
                />
              </AdminCard>
            )}

            <AdminCard className="no-print">
              <AdminCardHeader icon={ScanLine} title="One code for the whole room" />
              <AdminCardContent className="space-y-4">
                <p className="text-sm font-sans leading-relaxed text-muted-foreground">
                  {menuOnly === false
                    ? 'Guests scan it and type the table they are sitting at — every visit, because they will not be in the same seat next time. The code proves they are in the restaurant; the table number is what they tell you.'
                    : 'Guests scan it and see the menu. Once ordering is on, the same code also asks them for their table number, so it never needs reprinting.'}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button" variant="outline" className="h-11 gap-1.5 lg:h-10" disabled={!venueUrl}
                    onClick={() => { if (venueUrl) navigator.clipboard.writeText(venueUrl).then(() => toast.success('Link copied')); }}
                  >
                    <Copy className="h-4 w-4" /> Copy link
                  </Button>
                </div>
                {rotatedAt && (
                  <p className="text-xs font-sans text-muted-foreground">
                    Current code issued <span className="tabular-nums">{new Date(rotatedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                  </p>
                )}
                <div className="space-y-2 border-t border-border/70 pt-4">
                  <p className="flex items-start gap-2 text-xs font-sans leading-relaxed text-muted-foreground">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                    <span>Replacing the code stops every printed room code at once. Only do it if someone copied your code, and print the new one straight after.</span>
                  </p>
                  <Button
                    type="button" variant="ghost" className="-ms-3 h-11 gap-1.5 px-3 text-destructive hover:bg-destructive/5 hover:text-destructive lg:h-9"
                    onClick={() => setConfirmReplace(true)} disabled={rotating || !loaded || !venueUrl}
                  >
                    <RefreshCw className={cn('h-4 w-4', rotating && 'animate-spin motion-reduce:animate-none')} /> Replace code…
                  </Button>
                </div>
              </AdminCardContent>
            </AdminCard>
          </div>
        )}

        {/* ===== SHEET MODE (multi-up A4) ===== */}
        {mode === 'sheet' && !failed && (
          <AdminCard>
            <AdminCardHeader
              className="no-print"
              icon={LayoutGrid}
              title="A4 sheet"
              description={tables.length > 0 ? `${tableRange(tables)}. Print, then cut along the dashed lines.` : 'Small stickers, three across. Print, then cut along the dashed lines.'}
            />
            <AdminCardContent>
              {!loaded ? (
                <Skeleton className="h-72 w-full rounded-xl" />
              ) : tables.length === 0 ? (
                emptyTables
              ) : (
                <div className="qr-sheet grid grid-cols-2 overflow-hidden rounded-xl border border-border bg-white text-neutral-900 sm:grid-cols-3">
                  {tables.map((table) => (
                    <div key={table.id} className="qr-cell flex flex-col items-center justify-center border border-dashed border-neutral-300 p-4 text-center">
                      <p className="qr-brand mb-2 font-serif text-[10px] font-semibold uppercase tracking-[0.24em] text-neutral-700 sm:text-[11px]">
                        {nameFor((table as { venue_id?: string | null }).venue_id)}
                      </p>
                      <div className="bg-white p-1">
                        <QRCodeSVG value={getQRUrl(table)} size={120} level="H" className="h-auto w-full" style={{ maxWidth: 120 }} />
                      </div>
                      <p className="qr-table-label mt-2 font-serif text-lg font-bold">Table {table.table_number}</p>
                      <p className="qr-subtitle mt-0.5 text-[10px] font-sans text-neutral-500">{SCAN_LINE}</p>
                    </div>
                  ))}
                </div>
              )}
            </AdminCardContent>
          </AdminCard>
        )}

        {/* ===== SINGLE MODE (one big sticker per page) ===== */}
        {mode === 'single' && !failed && (
          !loaded ? (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4" aria-hidden>
              {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-72 rounded-2xl" />)}
            </div>
          ) : tables.length === 0 ? (
            <AdminCard>{emptyTables}</AdminCard>
          ) : (
            <div className="qr-pages grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">
              {tables.map((table) => (
                <div key={table.id} id={`qr-card-${table.id}`} className="qr-card qr-page flex flex-col items-center">
                  <Sticker
                    brand={nameFor((table as { venue_id?: string | null }).venue_id)}
                    value={getQRUrl(table)}
                    label={`Table ${table.table_number}`}
                    size="md"
                  />
                  <Button onClick={() => printSingle(table.id)} variant="ghost" className="no-print mt-1 h-11 gap-1.5 text-xs text-muted-foreground lg:h-9">
                    <Printer className="h-3.5 w-3.5" /> Print this one
                  </Button>
                </div>
              ))}
            </div>
          )
        )}
      </Stagger>
    </div>
  );
};

export default AdminQRCodes;
