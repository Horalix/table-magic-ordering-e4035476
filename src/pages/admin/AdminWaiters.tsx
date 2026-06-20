import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { todayISO } from '@/lib/assignments';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { CalendarCheck, CheckCircle2, Copy, KeyRound, Loader2, Trash2, UserPlus } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { Database } from '@/integrations/supabase/types';

// pin_hash is never sent to the client (column SELECT revoked); has_pin is a
// boolean generated column the UI uses instead.
type Waiter = Omit<Database['public']['Tables']['waiters']['Row'], 'pin_hash'> & { has_pin?: boolean | null };

interface CreateWaiterResponse {
  error?: string;
  pin?: string;
}

interface DeleteWaiterResponse {
  error?: string;
}

interface SectionLite { id: string; name: string; color: string }

const AdminWaiters = () => {
  const [waiters, setWaiters] = useState<Waiter[]>([]);
  const [sections, setSections] = useState<SectionLite[]>([]);
  const [assignments, setAssignments] = useState<{ section_id: string; waiter_id: string }[]>([]);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [creating, setCreating] = useState(false);
  const [pinTarget, setPinTarget] = useState<Waiter | null>(null);
  const [pinValue, setPinValue] = useState('');
  const [savingPin, setSavingPin] = useState(false);

  const fetchAll = useCallback(async () => {
    const [w, s, a] = await Promise.all([
      supabase.from('waiters').select('id, display_name, username, is_active, has_pin, user_id, created_at, pin_set_at').order('display_name'),
      supabase.from('sections').select('id, name, color').order('sort_order'),
      supabase.from('section_assignments').select('section_id, waiter_id').eq('shift_date', todayISO()),
    ]);
    if (w.error) { toast.error('Failed to load waiters'); return; }
    setWaiters(w.data ?? []);
    setSections((s.data as SectionLite[]) ?? []);
    setAssignments(a.data ?? []);
  }, []);

  const sectionsByWaiter = useMemo(() => {
    const map = new Map<string, SectionLite[]>();
    assignments.forEach((a) => {
      const sec = sections.find((s) => s.id === a.section_id);
      if (!sec) return;
      const list = map.get(a.waiter_id) ?? [];
      list.push(sec);
      map.set(a.waiter_id, list);
    });
    return map;
  }, [assignments, sections]);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  const createWaiter = async () => {
    const normalizedUsername = username.trim().toLowerCase().replace(/[^a-z0-9_.-]/g, '');
    if (normalizedUsername.length < 3 || password.length < 6 || !name.trim()) {
      toast.error('Username (3+), password (6+), and display name are required');
      return;
    }
    if (pin && !/^\d{4}$/.test(pin)) {
      toast.error('PIN must be exactly 4 digits');
      return;
    }

    setCreating(true);
    try {
      const { data, error } = await supabase.functions.invoke<CreateWaiterResponse>('create-waiter', {
        body: {
          username: normalizedUsername,
          password,
          display_name: name.trim(),
          pin: pin || undefined,
        },
      });

      if (error || data?.error) {
        toast.error(data?.error ?? error?.message ?? 'Failed');
        return;
      }

      toast.success(`Waiter "${name}" created${data?.pin ? ` - Floor PIN: ${data.pin}` : ''}`, { duration: 8000 });
      setUsername('');
      setPassword('');
      setName('');
      setPin('');
      await fetchAll();
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
    const { error } = await supabase.rpc('admin_set_waiter_pin', { _waiter_id: pinTarget.id, _pin: pinValue });
    setSavingPin(false);

    if (error) {
      toast.error(error.message);
      return;
    }

    toast.success(`PIN set for ${pinTarget.display_name}`);
    setPinTarget(null);
    setPinValue('');
    await fetchAll();
  };

  const deleteWaiter = async (waiter: Waiter) => {
    const { data, error } = await supabase.functions.invoke<DeleteWaiterResponse>('delete-waiter', {
      body: { waiter_id: waiter.id },
    });

    if (error || data?.error) {
      toast.error(data?.error ?? error?.message ?? 'Failed to delete');
      return;
    }

    toast.success(`${waiter.display_name} removed`);
    await fetchAll();
  };

  const toggleActive = async (waiter: Waiter) => {
    const { error } = await supabase.from('waiters').update({ is_active: !waiter.is_active }).eq('id', waiter.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    await fetchAll();
  };

  const copyLoginLink = async () => {
    const url = `${window.location.origin}/waiter/login`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success('Login link copied');
    } catch (error) {
      console.warn('Unable to copy waiter login link', error);
      toast.error('Could not copy login link');
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <h1 className="font-serif text-3xl font-bold text-foreground">Waiters</h1>
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" asChild className="gap-2">
            <Link to="/admin/tonight"><CalendarCheck className="w-4 h-4" /> Assign sections</Link>
          </Button>
          <Button variant="outline" onClick={copyLoginLink} className="gap-2">
            <Copy className="w-4 h-4" /> Copy waiter login link
          </Button>
        </div>
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="font-serif text-lg flex items-center gap-2"><UserPlus className="w-5 h-5" /> Add Waiter</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2">
            <Input placeholder="Display name (e.g. John)" value={name} onChange={(e) => setName(e.target.value)} />
            <Input placeholder="Username (e.g. john)" value={username} onChange={(e) => setUsername(e.target.value)} autoCapitalize="none" autoComplete="username" />
            <Input type="password" placeholder="Password (6+ chars)" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
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
        <CardHeader>
          <CardTitle className="font-serif text-lg">Team</CardTitle>
        </CardHeader>
        <CardContent>
          {waiters.length === 0 ? (
            <p className="text-sm font-sans text-muted-foreground">No waiters yet.</p>
          ) : (
            <div className="divide-y divide-border">
              {waiters.map((waiter) => (
                <div key={waiter.id} className="flex items-center justify-between py-3 gap-3">
                  <div className="min-w-0">
                    <p className="font-sans font-medium truncate">{waiter.display_name}</p>
                    <p className="text-xs font-sans text-muted-foreground flex items-center gap-2 flex-wrap">
                      <span>{waiter.username ? `@${waiter.username}` : 'no username (legacy)'}</span>
                      <span>|</span>
                      <span>{waiter.is_active ? 'Active' : 'Inactive'}</span>
                      <span>|</span>
                      {waiter.has_pin ? (
                        <span className="inline-flex items-center gap-1 text-primary"><CheckCircle2 className="w-3 h-3" /> PIN set</span>
                      ) : (
                        <span className="text-destructive">no PIN</span>
                      )}
                    </p>
                    <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
                      {(sectionsByWaiter.get(waiter.id) ?? []).length > 0 ? (
                        sectionsByWaiter.get(waiter.id)!.map((s) => (
                          <span key={s.id} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-sans" style={{ background: `${s.color}22`, color: s.color }}>
                            <span className="w-1.5 h-1.5 rounded-full" style={{ background: s.color }} />{s.name}
                          </span>
                        ))
                      ) : (
                        <span className="text-[11px] font-sans text-muted-foreground">No section today</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button variant="outline" size="sm" onClick={() => { setPinTarget(waiter); setPinValue(''); }} className="gap-1.5">
                      <KeyRound className="w-3.5 h-3.5" /> PIN
                    </Button>
                    <Switch
                      checked={waiter.is_active}
                      aria-label={`${waiter.is_active ? 'Deactivate' : 'Activate'} ${waiter.display_name}`}
                      onCheckedChange={() => { void toggleActive(waiter); }}
                    />
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="ghost" size="icon" aria-label={`Remove waiter ${waiter.display_name}`}>
                          <Trash2 className="w-4 h-4 text-destructive" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Remove {waiter.display_name}?</AlertDialogTitle>
                          <AlertDialogDescription>
                            This permanently deletes the waiter account and login. Past orders are kept but unassigned. This cannot be undone.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => { void deleteWaiter(waiter); }}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          >
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

      <Dialog open={!!pinTarget} onOpenChange={(open) => { if (!open) { setPinTarget(null); setPinValue(''); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-serif">Set Floor PIN - {pinTarget?.display_name}</DialogTitle>
            <DialogDescription>
              4-digit code the waiter taps on the floor monitor to see only their tables.
            </DialogDescription>
          </DialogHeader>
          <Input
            inputMode="numeric"
            maxLength={4}
            placeholder="0000"
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
