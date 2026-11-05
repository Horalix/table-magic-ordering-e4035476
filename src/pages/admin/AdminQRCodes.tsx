import React, { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { QRCodeSVG } from 'qrcode.react';
import { Printer, LayoutGrid, Square, ScanLine, AlertTriangle, Copy, RefreshCw } from 'lucide-react';
import { useOutletContext } from 'react-router-dom';
import { toast } from 'sonner';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
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

  return (
    <div>
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

      <div className="flex flex-wrap items-center justify-between gap-3 mb-6 no-print">
        <div>
          <h1 className="font-serif text-3xl font-bold text-foreground">QR Codes</h1>
          <p className="text-sm text-muted-foreground font-sans mt-1">
            {mode === 'sheet'
              ? 'A4 sheet — 12 per-table stickers. Print, then cut along the dashed lines.'
              : mode === 'single'
                ? 'One large per-table sticker per page.'
                : menuOnly === false
                  ? 'One code for the whole room — guests pick their table after scanning.'
                  : 'One code for the whole room — it opens the menu.'}
          </p>
        </div>
        {/* Wraps as a whole (Print to the next line) rather than each label
            breaking in two on a 360px phone. */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-md border border-border bg-card p-0.5">
            <button
              onClick={() => setMode('venue')}
              className={`flex items-center gap-1.5 px-3 py-1.5 min-h-[44px] whitespace-nowrap rounded text-xs font-sans transition-colors ${
                mode === 'venue' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <ScanLine className="w-3.5 h-3.5" /> Venue QR
            </button>
            <button
              onClick={() => setMode('sheet')}
              className={`flex items-center gap-1.5 px-3 py-1.5 min-h-[44px] whitespace-nowrap rounded text-xs font-sans transition-colors ${
                mode === 'sheet' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <LayoutGrid className="w-3.5 h-3.5" /> A4 Sheet
            </button>
            <button
              onClick={() => setMode('single')}
              className={`flex items-center gap-1.5 px-3 py-1.5 min-h-[44px] whitespace-nowrap rounded text-xs font-sans transition-colors ${
                mode === 'single' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Square className="w-3.5 h-3.5" /> Per table
            </button>
          </div>
          <Button onClick={printAll} className="font-sans" size="sm" disabled={failed || (mode === 'venue' && !venueUrl)}>
            <Printer className="w-4 h-4 mr-1" /> Print
          </Button>
        </div>
      </div>

      {failed && (
        <div role="alert" className="mb-6 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm font-sans no-print">
          <p className="font-semibold text-foreground">The codes could not be loaded.</p>
          <p className="mt-1 text-muted-foreground">Check the internet connection and try again. Do not print until they show.</p>
          <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => { void load(); }}>
            <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Try again
          </Button>
        </div>
      )}

      {/* ===== VENUE MODE (single QR for the whole place) ===== */}
      {mode === 'venue' && !failed && (
        <div className="max-w-md mx-auto">
          <div className="mb-4 rounded-lg border border-border bg-muted/40 p-3.5 text-xs font-sans no-print">
            <p className="font-semibold text-foreground">One code for the whole room.</p>
            <p className="mt-1 text-muted-foreground leading-relaxed">
              {menuOnly === false
                ? 'Guests scan it and type the table they are sitting at — every visit, because they will not be in the same seat next time. The code proves they are in the restaurant; the table number is what they tell you.'
                : 'Guests scan it and see the menu. Once ordering is on, the same code also asks them for their table number, so it never needs reprinting.'}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button type="button" variant="outline" size="sm" className="gap-1.5" disabled={!venueUrl}
                onClick={() => { if (venueUrl) navigator.clipboard.writeText(venueUrl).then(() => toast.success('Link copied')); }}>
                <Copy className="w-3.5 h-3.5" /> Copy link
              </Button>
              <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => setConfirmReplace(true)} disabled={rotating || !loaded || !venueUrl}>
                <RefreshCw className={`w-3.5 h-3.5 ${rotating ? 'animate-spin' : ''}`} /> Replace code…
              </Button>
              {rotatedAt && (
                <span className="text-muted-foreground">
                  Current code issued {new Date(rotatedAt).toLocaleDateString()}
                </span>
              )}
            </div>
            <p className="mt-2 text-muted-foreground inline-flex items-start gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              Replacing the code stops every printed room code at once. Only do it if someone copied
              your code, and print the new one straight after.
            </p>
          </div>
          {venueUrl ? (
            <Card className="border-border">
              <CardContent className="p-6 flex flex-col items-center text-center qr-card" id="qr-card-venue">
                <p className="font-serif text-xs tracking-[0.2em] uppercase text-muted-foreground mb-3 qr-brand">{roomName}</p>
                <div className="p-4 bg-white rounded-xl">
                  <QRCodeSVG value={venueUrl} size={210} level="H" />
                </div>
                <p className="font-serif text-2xl font-bold text-foreground mt-4 qr-table-label">{SCAN_LINE}</p>
                <Button onClick={printAll} variant="ghost" size="sm" className="mt-4 text-xs font-sans no-print">
                  <Printer className="w-3 h-3 mr-1" /> Print
                </Button>
              </CardContent>
            </Card>
          ) : loaded && (
            <p className="rounded-lg border border-border p-4 text-center text-sm text-muted-foreground font-sans no-print">
              This restaurant has no room code yet. Ask your developer to set one up before printing.
            </p>
          )}
        </div>
      )}

      {/* ===== SHEET MODE (multi-up A4) ===== */}
      {mode === 'sheet' && !failed && (
        <div className="qr-sheet bg-white text-foreground rounded-lg overflow-hidden border border-border shadow-sm">
          {tables.map((table) => (
            <div key={table.id} className="qr-cell border border-dashed border-border p-4 flex flex-col items-center justify-center text-center">
              <p className="qr-brand font-serif text-[11px] tracking-[0.28em] uppercase text-charcoal font-semibold mb-2">
                {nameFor((table as { venue_id?: string | null }).venue_id)}
              </p>
              <div className="p-2 bg-white">
                <QRCodeSVG value={getQRUrl(table)} size={120} level="H" />
              </div>
              <p className="qr-table-label font-serif text-lg font-bold mt-2">Table {table.table_number}</p>
              <p className="qr-subtitle text-[10px] text-muted-foreground font-sans mt-0.5">{SCAN_LINE}</p>
            </div>
          ))}
          {loaded && tables.length === 0 && (
            <p className="col-span-3 text-center text-muted-foreground font-sans py-10">
              No tables created yet. Add them under Tables first.
            </p>
          )}
        </div>
      )}

      {/* ===== SINGLE MODE (one big sticker per page) ===== */}
      {mode === 'single' && !failed && loaded && tables.length === 0 && (
        <p className="text-center text-muted-foreground font-sans py-10">No tables created yet. Add them under Tables first.</p>
      )}
      {mode === 'single' && !failed && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-6 qr-print-grid">
          {tables.map((table) => (
            <div key={table.id} id={`qr-card-${table.id}`} className="qr-card">
              <Card className="border-border">
                <CardContent className="p-5 flex flex-col items-center">
                  <div className="qr-sticker-content flex flex-col items-center w-full">
                    <p className="font-serif text-xs font-medium text-muted-foreground tracking-[0.2em] uppercase text-center mb-2 qr-brand">
                      {nameFor((table as { venue_id?: string | null }).venue_id)}
                    </p>
                    <div className="p-3 bg-white rounded-xl">
                      <QRCodeSVG value={getQRUrl(table)} size={160} level="H" />
                    </div>
                    <div className="text-center mt-3">
                      <p className="font-serif text-2xl font-bold text-foreground qr-table-label">Table {table.table_number}</p>
                      <div className="w-8 h-px bg-primary/30 mx-auto my-2 qr-divider" />
                      <p className="text-[11px] text-muted-foreground font-sans qr-subtitle">{SCAN_LINE}</p>
                    </div>
                  </div>
                  <Button onClick={() => printSingle(table.id)} variant="ghost" size="sm" className="mt-3 text-xs font-sans no-print">
                    <Printer className="w-3 h-3 mr-1" /> Print this one
                  </Button>
                </CardContent>
              </Card>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default AdminQRCodes;
