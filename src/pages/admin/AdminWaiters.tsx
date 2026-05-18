import React, { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { UserPlus, Loader2, Copy, Trash2, KeyRound, CheckCircle2 } from 'lucide-react';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';

interface Waiter { id: string; user_id: string; display_name: string; is_active: boolean; username: string | null; pin_hash: string | null; }

const AdminWaiters = () => {
  const [waiters, setWaiters] = useState<Waiter[]>([]);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [creating, setCreating] = useState(false);
  const [pinTarget, setPinTarget] = useState<Waiter | null>(null);
  const [pinValue, setPinValue] = useState('');
  const [savingPin, setSavingPin] = useState(false);

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
    if (pin && !/^\d{4}$/.test(pin)) {
      toast.error('PIN must be exactly 4 digits');
      return;
    }
    setCreating(true);
    try {
      const { data, error } = await supabase.functions.invoke('create-waiter', {
        body: { username: u, password, display_name: name.trim(), pin: pin || undefined },
      });
      if (error || (data as any)?.error) {
        toast.error((data as any)?.error || error?.message || 'Failed');
      } else {
        const newPin = (data as any)?.pin;
        toast.success(`Waiter "${name}" created${newPin ? ` — Floor PIN: ${newPin}` : ''}`, { duration: 8000 });
        setUsername(''); setPassword(''); setName(''); setPin('');
        fetchAll();
      }
    } finally {
      setCreating(false);
    }
  };

  const setWaiterPin = async () => {
    if (!pinTarget) return;
    if (!/^\d{4}$/.test(pinValue)) {
      toast.error('PIN must be exactly 4 digits');
      return;
    }
    setSavingPin(true);
    const { error } = await supabase.rpc('admin_set_waiter_pin', { _waiter_id: pinTarget.id, _pin: pinValue } as any);
    setSavingPin(false);
    if (error) {
      toast.error(error.message);
    } else {
      toast.success(`PIN set for ${pinTarget.display_name}`);
      setPinTarget(null);
      setPinValue('');
      fetchAll();
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
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2">
            <Input placeholder="Display name (e.g. John)" value={name} onChange={(e) => setName(e.target.value)} />
            <Input placeholder="Username (e.g. john)" value={username} onChange={(e) => setUsername(e.target.value)} autoCapitalize="none" />
            <Input type="text" placeholder="Password (6+ chars)" value={password} onChange={(e) => setPassword(e.target.value)} />
            <Input
              inputMode="numeric"
              maxLength={4}
              placeholder="Floor PIN (4 digits, auto if blank)"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
            />
          </div>
          <Button onClick={createWaiter} disabled={creating} className="mt-3">
            {creating ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <UserPlus className="w-4 h-4 mr-2" />}
            Create
          </Button>
          <p className="text-xs font-sans text-muted-foreground mt-2">
            Login at <span className="font-medium">/waiter/login</span> with username + password. The <span className="font-medium">Floor PIN</span> is used on the shared monitor to quickly see only their tables.
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
                <div key={w.id} className="flex items-center justify-between py-3 gap-3">
                  <div className="min-w-0">
                    <p className="font-sans font-medium truncate">{w.display_name}</p>
                    <p className="text-xs font-sans text-muted-foreground flex items-center gap-2 flex-wrap">
                      <span>{w.username ? `@${w.username}` : 'no username (legacy)'}</span>
                      <span>·</span>
                      <span>{w.is_active ? 'Active' : 'Inactive'}</span>
                      <span>·</span>
                      {w.pin_hash ? (
                        <span className="inline-flex items-center gap-1 text-primary"><CheckCircle2 className="w-3 h-3" /> PIN set</span>
                      ) : (
                        <span className="text-destructive">no PIN</span>
                      )}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button variant="outline" size="sm" onClick={() => { setPinTarget(w); setPinValue(''); }} className="gap-1.5">
                      <KeyRound className="w-3.5 h-3.5" /> PIN
                    </Button>
                    <Switch checked={w.is_active} onCheckedChange={() => toggleActive(w)} />
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="ghost" size="icon"><Trash2 className="w-4 h-4 text-destructive" /></Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Remove {w.display_name}?</AlertDialogTitle>
                          <AlertDialogDescription>
                            This permanently deletes the waiter account and login. Past orders are kept but unassigned. This cannot be undone.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={() => deleteWaiter(w)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                            Remove
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!pinTarget} onOpenChange={(o) => { if (!o) { setPinTarget(null); setPinValue(''); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-serif">Set Floor PIN — {pinTarget?.display_name}</DialogTitle>
            <DialogDescription>
              4-digit code the waiter taps on the floor monitor to see only their tables.
            </DialogDescription>
          </DialogHeader>
          <Input
            inputMode="numeric"
            maxLength={4}
            placeholder="••••"
            value={pinValue}
            onChange={(e) => setPinValue(e.target.value.replace(/\D/g, '').slice(0, 4))}
            className="text-center text-2xl tracking-[0.5em] h-14"
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => { setPinTarget(null); setPinValue(''); }}>Cancel</Button>
            <Button onClick={setWaiterPin} disabled={savingPin || pinValue.length !== 4}>
              {savingPin ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save PIN'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AdminWaiters;
