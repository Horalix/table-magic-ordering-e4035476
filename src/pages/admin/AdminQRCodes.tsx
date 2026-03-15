import React, { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { QRCodeSVG } from 'qrcode.react';
import { Printer } from 'lucide-react';

const AdminQRCodes = () => {
  const [tables, setTables] = useState<any[]>([]);

  useEffect(() => {
    const fetchTables = async () => {
      const { data } = await supabase.from('tables').select('*').order('table_number');
      setTables(data || []);
    };
    fetchTables();
  }, []);

  const getQRUrl = (table: any) => `${window.location.origin}/table/${table.table_number}?token=${table.qr_token}`;

  const printSingle = (tableId: string) => {
    const allCards = document.querySelectorAll('.qr-card');
    allCards.forEach((card) => {
      (card as HTMLElement).classList.add('print-hidden');
    });
    const target = document.getElementById(`qr-card-${tableId}`);
    if (target) target.classList.remove('print-hidden');
    window.print();
    allCards.forEach((card) => {
      (card as HTMLElement).classList.remove('print-hidden');
    });
  };

  const printAll = () => window.print();

  return (
    <div>
      <div className="flex items-center justify-between mb-6 no-print">
        <h1 className="font-serif text-3xl font-bold text-foreground">QR Codes</h1>
        <Button onClick={printAll} className="font-sans" size="sm">
          <Printer className="w-4 h-4 mr-1" /> Print All as Stickers
        </Button>
      </div>

      <p className="text-sm text-muted-foreground font-sans mb-6 no-print">
        Print these QR codes and place them on each table. Each QR code prints on its own page — perfect for cutting into individual stickers.
      </p>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-6 qr-print-grid">
        {tables.map((table) => (
          <div key={table.id} id={`qr-card-${table.id}`} className="qr-card">
            <Card className="border-border">
              <CardContent className="p-5 flex flex-col items-center">
                {/* Sticker content */}
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
                <Button
                  onClick={() => printSingle(table.id)}
                  variant="ghost"
                  size="sm"
                  className="mt-3 text-xs font-sans no-print"
                >
                  <Printer className="w-3 h-3 mr-1" /> Print
                </Button>
              </CardContent>
            </Card>
          </div>
        ))}
      </div>

      {tables.length === 0 && (
        <p className="text-center text-muted-foreground font-sans py-10 no-print">
          No tables created yet. Go to Table Management to add tables first.
        </p>
      )}
    </div>
  );
};

export default AdminQRCodes;
