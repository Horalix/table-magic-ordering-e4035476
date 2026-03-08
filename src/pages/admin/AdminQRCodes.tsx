import React, { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { QRCodeSVG } from 'qrcode.react';
import { Download, Printer } from 'lucide-react';

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

  const printAll = () => window.print();

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-serif text-3xl font-bold text-foreground">QR Codes</h1>
        <Button onClick={printAll} className="font-sans" size="sm">
          <Printer className="w-4 h-4 mr-1" /> Print All
        </Button>
      </div>

      <p className="text-sm text-muted-foreground font-sans mb-6">
        Print these QR codes and place them on each table. Guests scan to access the menu and place orders.
      </p>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 print:grid-cols-3">
        {tables.map((table) => (
          <Card key={table.id} className="border-border print:border print:shadow-none">
            <CardContent className="p-4 flex flex-col items-center">
              <QRCodeSVG value={getQRUrl(table)} size={140} className="mb-3" />
              <div className="text-center">
                <p className="font-serif text-lg font-bold text-foreground">Table {table.table_number}</p>
                <p className="text-xs text-muted-foreground font-sans mt-0.5">La Soul</p>
                <p className="text-[10px] text-muted-foreground font-sans mt-1">Scan to view menu & order</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {tables.length === 0 && (
        <p className="text-center text-muted-foreground font-sans py-10">
          No tables created yet. Go to Table Management to add tables first.
        </p>
      )}
    </div>
  );
};

export default AdminQRCodes;
