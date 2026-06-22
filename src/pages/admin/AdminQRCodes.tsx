import React, { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { QRCodeSVG } from 'qrcode.react';
import { Printer, LayoutGrid, Square, ScanLine, AlertTriangle, Copy } from 'lucide-react';
import { toast } from 'sonner';
import type { Database } from '@/integrations/supabase/types';

type Mode = 'sheet' | 'single' | 'venue';
const UNIFY_SQL = "WITH s AS (SELECT encode(gen_random_bytes(32),'hex') AS tok)\nUPDATE public.tables SET qr_token = (SELECT tok FROM s);";
type TableRow = Database['public']['Tables']['tables']['Row'];

const AdminQRCodes = () => {
  const [tables, setTables] = useState<TableRow[]>([]);
  const [mode, setMode] = useState<Mode>('sheet');

  useEffect(() => {
    const fetchTables = async () => {
      const { data } = await supabase.from('tables').select('*').order('table_number');
      setTables(data || []);
    };
    fetchTables();
  }, []);

  const getQRUrl = (table: TableRow) =>
    `${window.location.origin}/table/${table.table_number}?token=${table.qr_token}`;

  const venueToken = tables[0]?.qr_token;
  const venueUrl = `${window.location.origin}/start?token=${venueToken ?? ''}`;
  const tokensUnified = tables.length > 0 && tables.every((t) => t.qr_token === venueToken);

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
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6 no-print">
        <div>
          <h1 className="font-serif text-3xl font-bold text-foreground">QR Codes</h1>
          <p className="text-sm text-muted-foreground font-sans mt-1">
            {mode === 'sheet'
              ? 'A4 sheet — 12 per-table stickers. Print, then cut along the dashed lines.'
              : mode === 'single'
                ? 'One large per-table sticker per page.'
                : 'One QR for the whole venue — guests pick their table after scanning.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-md border border-border bg-card p-0.5">
            <button
              onClick={() => setMode('venue')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-sans transition-colors ${
                mode === 'venue' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <ScanLine className="w-3.5 h-3.5" /> Venue QR
            </button>
            <button
              onClick={() => setMode('sheet')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-sans transition-colors ${
                mode === 'sheet' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <LayoutGrid className="w-3.5 h-3.5" /> A4 Sheet
            </button>
            <button
              onClick={() => setMode('single')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-sans transition-colors ${
                mode === 'single' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Square className="w-3.5 h-3.5" /> Per table
            </button>
          </div>
          <Button onClick={printAll} className="font-sans" size="sm">
            <Printer className="w-4 h-4 mr-1" /> Print
          </Button>
        </div>
      </div>

      {/* ===== VENUE MODE (single QR for the whole place) ===== */}
      {mode === 'venue' && (
        <div className="max-w-md mx-auto">
          {!tokensUnified && tables.length > 0 && (
            <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3.5 text-xs font-sans text-amber-700 dark:text-amber-400 no-print">
              <p className="font-semibold flex items-center gap-1.5"><AlertTriangle className="w-4 h-4" /> One-time step to enable the single QR</p>
              <p className="mt-1.5 text-foreground/70">So one QR works for every table, all tables must share a token. Run this once (Supabase → SQL, or Lovable), then refresh:</p>
              <div className="mt-2 flex items-stretch gap-2">
                <code className="flex-1 bg-card border border-border rounded p-2 break-all text-[11px] text-foreground/80 whitespace-pre-wrap">{UNIFY_SQL}</code>
                <Button type="button" variant="outline" size="sm" className="shrink-0" onClick={() => { navigator.clipboard.writeText(UNIFY_SQL).then(() => toast.success('Copied')); }}>
                  <Copy className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          )}
          <Card className="border-border">
            <CardContent className="p-6 flex flex-col items-center text-center qr-card" id="qr-card-venue">
              <p className="font-serif text-xs tracking-[0.2em] uppercase text-muted-foreground mb-3 qr-brand">La Soul</p>
              <div className="p-4 bg-white rounded-xl">
                <QRCodeSVG value={venueUrl} size={210} level="H" />
              </div>
              <p className="font-serif text-2xl font-bold text-foreground mt-4 qr-table-label">Scan to order</p>
              <div className="w-8 h-px bg-primary/30 mx-auto my-2 qr-divider" />
              <p className="text-[11px] text-muted-foreground font-sans qr-subtitle">Choose your table after scanning</p>
              <Button onClick={printAll} variant="ghost" size="sm" className="mt-4 text-xs font-sans no-print">
                <Printer className="w-3 h-3 mr-1" /> Print
              </Button>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ===== SHEET MODE (multi-up A4) ===== */}
      {mode === 'sheet' && (
        <div className="qr-sheet bg-white text-foreground rounded-lg overflow-hidden border border-border shadow-sm">
          {tables.map((table) => (
            <div key={table.id} className="qr-cell border border-dashed border-border p-4 flex flex-col items-center justify-center text-center">
              <p className="qr-brand font-serif text-[11px] tracking-[0.28em] uppercase text-charcoal font-semibold mb-2">
                La Soul
              </p>
              <div className="p-2 bg-white">
                <QRCodeSVG value={getQRUrl(table)} size={120} level="H" />
              </div>
              <p className="qr-table-label font-serif text-lg font-bold mt-2">Table {table.table_number}</p>
              <p className="qr-subtitle text-[10px] text-muted-foreground font-sans mt-0.5">Scan to order</p>
            </div>
          ))}
          {tables.length === 0 && (
            <p className="col-span-3 text-center text-muted-foreground font-sans py-10">
              No tables created yet.
            </p>
          )}
        </div>
      )}

      {/* ===== SINGLE MODE (one big sticker per page) ===== */}
      {mode === 'single' && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-6 qr-print-grid">
          {tables.map((table) => (
            <div key={table.id} id={`qr-card-${table.id}`} className="qr-card">
              <Card className="border-border">
                <CardContent className="p-5 flex flex-col items-center">
                  <div className="qr-sticker-content flex flex-col items-center w-full">
                    <p className="font-serif text-xs font-medium text-muted-foreground tracking-[0.2em] uppercase text-center mb-2 qr-brand">
                      La Soul
                    </p>
                    <div className="p-3 bg-white rounded-xl">
                      <QRCodeSVG value={getQRUrl(table)} size={160} level="H" />
                    </div>
                    <div className="text-center mt-3">
                      <p className="font-serif text-2xl font-bold text-foreground qr-table-label">Table {table.table_number}</p>
                      <div className="w-8 h-px bg-primary/30 mx-auto my-2 qr-divider" />
                      <p className="text-[11px] text-muted-foreground font-sans qr-subtitle">Scan to view menu & order</p>
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
