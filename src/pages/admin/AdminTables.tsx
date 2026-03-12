import React, { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Plus, QrCode, PowerOff } from 'lucide-react';
import { toast } from 'sonner';
import { QRCodeSVG } from 'qrcode.react';

const AdminTables = () => {
  const [tables, setTables] = useState<any[]>([]);
  const [newTableNumber, setNewTableNumber] = useState('');
  const [showQR, setShowQR] = useState<string | null>(null);

  const fetchTables = async () => {
    const { data } = await supabase
      .from('tables')
      .select(`*, table_sessions(id, is_active, opened_at, guest_name)`)
      .order('table_number');
    setTables(data || []);
  };

  useEffect(() => { fetchTables(); }, []);

  const addMultipleTables = async () => {
    const count = parseInt(newTableNumber);
    if (isNaN(count) || count < 1 || count > 50) { toast.error('Enter a number between 1 and 50'); return; }

    const existing = tables.map(t => t.table_number);
    const toAdd = [];
    for (let i = 1; i <= count; i++) {
      if (!existing.includes(i)) toAdd.push({ table_number: i });
    }

    if (toAdd.length === 0) { toast.info('All tables already exist'); return; }

    const { error } = await supabase.from('tables').insert(toAdd);
    if (error) toast.error(error.message);
    else { toast.success(`${toAdd.length} tables added`); setNewTableNumber(''); fetchTables(); }
  };

  const closeSession = async (sessionId: string, tableId: string) => {
    // Close session
    const { error } = await supabase
      .from('table_sessions')
      .update({ is_active: false, closed_at: new Date().toISOString() })
      .eq('id', sessionId);
    if (error) { toast.error('Failed to close session'); return; }

    // Regenerate QR token to invalidate old QR codes (anti-fraud)
    const newToken = Array.from(crypto.getRandomValues(new Uint8Array(32)))
      .map(b => b.toString(16).padStart(2, '0')).join('');
    await supabase.from('tables').update({ qr_token: newToken }).eq('id', tableId);

    toast.success('Session closed & QR token regenerated');
    fetchTables();
  };

  const regenerateToken = async (tableId: string) => {
    const newToken = Array.from(crypto.getRandomValues(new Uint8Array(32)))
      .map(b => b.toString(16).padStart(2, '0')).join('');
    const { error } = await supabase.from('tables').update({ qr_token: newToken }).eq('id', tableId);
    if (error) toast.error('Failed to regenerate token');
    else { toast.success('Token regenerated'); fetchTables(); }
  };

  const getQRUrl = (table: any) => {
    const baseUrl = window.location.origin;
    return `${baseUrl}/table/${table.table_number}?token=${table.qr_token}`;
  };

  return (
    <div>
      <h1 className="font-serif text-3xl font-bold text-foreground mb-6">Table Management</h1>

      <Card className="mb-6 border-border">
        <CardContent className="p-4">
          <div className="flex gap-2">
            <Input
              placeholder="Number of tables (e.g. 30)"
              value={newTableNumber}
              onChange={(e) => setNewTableNumber(e.target.value)}
              type="number"
              className="max-w-[200px]"
            />
            <Button onClick={addMultipleTables} className="font-sans" size="sm">
              <Plus className="w-4 h-4 mr-1" /> Generate Tables
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
        {tables.map((table) => {
          const activeSession = table.table_sessions?.find((s: any) => s.is_active);
          return (
            <Card key={table.id} className={`border-border ${activeSession ? 'border-primary/30 bg-primary/5' : ''}`}>
              <CardContent className="p-4 text-center">
                <p className="font-serif text-2xl font-bold text-foreground">{table.table_number}</p>
                <Badge variant="outline" className={`mt-1 text-xs ${activeSession ? 'border-primary text-primary' : 'border-muted-foreground text-muted-foreground'}`}>
                  {activeSession ? 'Occupied' : 'Available'}
                </Badge>
                {activeSession?.guest_name && (
                  <p className="text-xs text-muted-foreground font-sans mt-1">{activeSession.guest_name}</p>
                )}

                <div className="flex gap-1 mt-3 justify-center">
                  <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setShowQR(showQR === table.id ? null : table.id)}>
                    <QrCode className="w-3.5 h-3.5" />
                  </Button>
                  {activeSession && (
                    <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => closeSession(activeSession.id, table.id)}>
                      <PowerOff className="w-3.5 h-3.5 text-destructive" />
                    </Button>
                  )}
                </div>

                {showQR === table.id && (
                  <div className="mt-3 p-3 bg-card rounded-lg border border-border">
                    <QRCodeSVG value={getQRUrl(table)} size={120} className="mx-auto" />
                    <p className="text-[10px] text-muted-foreground mt-2 break-all">{getQRUrl(table)}</p>
                    <Button variant="ghost" size="sm" className="mt-2 text-xs font-sans" onClick={() => regenerateToken(table.id)}>
                      Regenerate Token
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
};

export default AdminTables;
