import React, { useEffect, useState } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useCartStore } from '@/lib/cart-store';
import { Loader2, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';

const TableEntry = () => {
  const { tableNumber } = useParams<{ tableNumber: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { setTable, setSessionId } = useCartStore();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const token = searchParams.get('token');

  useEffect(() => {
    const validateAndCreateSession = async () => {
      if (!tableNumber || !token) {
        setError('Invalid QR code. Please ask your waiter for assistance.');
        setLoading(false);
        return;
      }

      try {
        const { data: table, error: tableError } = await supabase
          .from('tables')
          .select('*')
          .eq('table_number', parseInt(tableNumber))
          .eq('qr_token', token)
          .single();

        if (tableError || !table) {
          setError('This QR code is invalid or expired. Please ask your waiter to help you scan.');
          setLoading(false);
          return;
        }

        // Check for existing active session or create new one
        const { data: existingSession } = await supabase
          .from('table_sessions')
          .select('*')
          .eq('table_id', table.id)
          .eq('is_active', true)
          .maybeSingle();

        let sessionId: string;

        if (existingSession) {
          sessionId = existingSession.id;
        } else {
          const { data: newSession, error: sessionError } = await supabase
            .from('table_sessions')
            .insert({ table_id: table.id })
            .select()
            .single();

          if (sessionError || !newSession) {
            setError('Could not start your session. Please try again.');
            setLoading(false);
            return;
          }
          sessionId = newSession.id;
        }

        setTable(parseInt(tableNumber), token);
        setSessionId(sessionId);

        const params = new URLSearchParams({ table: tableNumber, token });
        navigate(`/menu?${params.toString()}`, { replace: true });
      } catch (err) {
        console.error('Table entry error:', err);
        setError('Something went wrong. Please try scanning again.');
        setLoading(false);
      }
    };

    validateAndCreateSession();
  }, [tableNumber, token]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin text-primary mx-auto" />
          <p className="text-muted-foreground font-sans mt-4 text-sm">Setting up your table...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-6">
        <div className="text-center max-w-sm">
          <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center mx-auto mb-4">
            <AlertCircle className="w-8 h-8 text-destructive" />
          </div>
          <h2 className="font-serif text-xl font-bold text-foreground">{error}</h2>
          <Button onClick={() => navigate('/menu')} variant="outline" className="mt-6 rounded-full">
            Browse Menu Without Ordering
          </Button>
        </div>
      </div>
    );
  }

  return null;
};

export default TableEntry;
