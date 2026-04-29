import React, { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { UserPlus, Loader2 } from 'lucide-react';

interface Waiter { id: string; user_id: string; display_name: string; is_active: boolean; }

const AdminWaiters = () => {
  const [waiters, setWaiters] = useState<Waiter[]>([]);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);

  const fetchAll = async () => {
    const { data } = await supabase.from('waiters').select('*').order('display_name');
    setWaiters(data || []);
  };

  useEffect(() => { fetchAll(); }, []);

  const createWaiter = async () => {
    if (!email || password.length < 8 || !name.trim()) {
      toast.error('Email, password (min 8 chars), and name required');
      return;
    }
    setCreating(true);
    try {
      const { data, error } = await supabase.functions.invoke('create-waiter', {
        body: { email, password, display_name: name.trim() },
      });
      if (error || (data as any)?.error) {
        toast.error((data as any)?.error || error?.message || 'Failed');
      } else {
        toast.success('Waiter account created');
        setEmail(''); setPassword(''); setName('');
        fetchAll();
      }
    } finally {
      setCreating(false);
    }
  };

  const toggleActive = async (w: Waiter) => {
    await supabase.from('waiters').update({ is_active: !w.is_active }).eq('id', w.id);
    fetchAll();
  };

  return (
    <div>
      <h1 className="font-serif text-3xl font-bold text-foreground mb-6">Waiters</h1>

      <Card className="mb-6">
        <CardHeader><CardTitle className="font-serif text-lg flex items-center gap-2"><UserPlus className="w-5 h-5" /> Add Waiter</CardTitle></CardHeader>
        <CardContent>
          <div className="grid sm:grid-cols-3 gap-2">
            <Input placeholder="Display name" value={name} onChange={(e) => setName(e.target.value)} />
            <Input type="email" placeholder="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            <Input type="password" placeholder="password (8+ chars)" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <Button onClick={createWaiter} disabled={creating} className="mt-3">
            {creating ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <UserPlus className="w-4 h-4 mr-2" />}
            Create
          </Button>
          <p className="text-xs font-sans text-muted-foreground mt-2">
            They sign in at /admin/login with these credentials, then go to /waiter.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="font-serif text-lg">Team</CardTitle></CardHeader>
        <CardContent>
          {waiters.length === 0 ? (
            <p className="text-sm font-sans text-muted-foreground">No waiters yet.</p>
          ) : (
            <div className="divide-y divide-border">
              {waiters.map(w => (
                <div key={w.id} className="flex items-center justify-between py-3">
                  <div>
                    <p className="font-sans font-medium">{w.display_name}</p>
                    <p className="text-xs font-sans text-muted-foreground">{w.is_active ? 'Active' : 'Inactive'}</p>
                  </div>
                  <Switch checked={w.is_active} onCheckedChange={() => toggleActive(w)} />
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default AdminWaiters;
