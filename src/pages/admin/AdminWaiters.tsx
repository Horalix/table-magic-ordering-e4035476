import React, { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { UserPlus, Loader2, Copy, Trash2 } from 'lucide-react';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

interface Waiter { id: string; user_id: string; display_name: string; is_active: boolean; username: string | null; }

const AdminWaiters = () => {
  const [waiters, setWaiters] = useState<Waiter[]>([]);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);

  const fetchAll = async () => {
    const { data } = await supabase.from('waiters').select('*').order('display_name');
    setWaiters((data as any) || []);
  };

  useEffect(() => { fetchAll(); }, []);

  const createWaiter = async () => {
    const u = username.trim().toLowerCase().replace(/[^a-z0-9_.-]/g, '');
    if (u.length < 3 || password.length < 6 || !name.trim()) {
      toast.error('Username (3+), password (6+), and display name are required');
      return;
    }
    setCreating(true);
    try {
      const { data, error } = await supabase.functions.invoke('create-waiter', {
        body: { username: u, password, display_name: name.trim() },
      });
      if (error || (data as any)?.error) {
        toast.error((data as any)?.error || error?.message || 'Failed');
      } else {
        toast.success(`Waiter "${name}" created — they can sign in at /waiter/login`);
        setUsername(''); setPassword(''); setName('');
        fetchAll();
      }
    } finally {
      setCreating(false);
    }
  };

  const deleteWaiter = async (w: Waiter) => {
    const { data, error } = await supabase.functions.invoke('delete-waiter', { body: { waiter_id: w.id } });
    if (error || (data as any)?.error) {
      toast.error((data as any)?.error || error?.message || 'Failed to delete');
    } else {
      toast.success(`${w.display_name} removed`);
      fetchAll();
    }
  };

  const toggleActive = async (w: Waiter) => {
    await supabase.from('waiters').update({ is_active: !w.is_active }).eq('id', w.id);
    fetchAll();
  };

  const copyLoginLink = () => {
    const url = `${window.location.origin}/waiter/login`;
    navigator.clipboard.writeText(url);
    toast.success('Login link copied');
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <h1 className="font-serif text-3xl font-bold text-foreground">Waiters</h1>
        <Button variant="outline" onClick={copyLoginLink} className="gap-2">
          <Copy className="w-4 h-4" /> Copy waiter login link
        </Button>
      </div>

      <Card className="mb-6">
        <CardHeader><CardTitle className="font-serif text-lg flex items-center gap-2"><UserPlus className="w-5 h-5" /> Add Waiter</CardTitle></CardHeader>
        <CardContent>
          <div className="grid sm:grid-cols-3 gap-2">
            <Input placeholder="Display name (e.g. John)" value={name} onChange={(e) => setName(e.target.value)} />
            <Input placeholder="Username (e.g. john)" value={username} onChange={(e) => setUsername(e.target.value)} autoCapitalize="none" />
            <Input type="text" placeholder="Password (6+ chars)" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <Button onClick={createWaiter} disabled={creating} className="mt-3">
            {creating ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <UserPlus className="w-4 h-4 mr-2" />}
            Create
          </Button>
          <p className="text-xs font-sans text-muted-foreground mt-2">
            They sign in at <span className="font-medium">/waiter/login</span> with just their username and password — no email needed.
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
                    <p className="text-xs font-sans text-muted-foreground">
                      {w.username ? `@${w.username}` : 'no username (legacy)'} · {w.is_active ? 'Active' : 'Inactive'}
                    </p>
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
