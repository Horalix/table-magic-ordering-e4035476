import React, { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { QRCodeSVG } from 'qrcode.react';
import { Printer, LayoutGrid, Square } from 'lucide-react';
import type { Database } from '@/integrations/supabase/types';

type Mode = 'sheet' | 'single';
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
              ? 'A4 sheet — 12 stickers per page. Print, then cut along the dashed lines.'
              : 'One large sticker per page.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-md border border-border bg-card p-0.5">
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
              <Square className="w-3.5 h-3.5" /> Single
            </button>
          </div>
          <Button onClick={printAll} className="font-sans" size="sm">
            <Printer className="w-4 h-4 mr-1" /> Print
          </Button>
        </div>
      </div>

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
