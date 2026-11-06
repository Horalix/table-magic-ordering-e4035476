import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { businessDayISO } from '@/lib/reporting';
import { shownVenueSlug } from '@/lib/current-venue';
import { VENUES } from '@/lib/venues';
import {
  isKitchenUsername, kitchenUsername, MIN_PASSWORD, normalizeUsername, plainRefusal, readRefusal, refusalField,
  staffSiteUrl, suggestUsername, type LoginDetails,
} from '@/lib/staff-accounts';
import { switchStaffVenue } from '@/hooks/useStaffVenue';
import type { AdminOutletContext } from '@/components/admin/AdminLayout';
import LoginCard from '@/components/admin/LoginCard';
import NewPasswordField from '@/components/admin/NewPasswordField';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { CalendarCheck, CheckCircle2, ChefHat, Copy, KeyRound, LockKeyhole, Loader2, Trash2, UserPlus, Users } from 'lucide-react';
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
  code?: string;
  pin?: string | null;
  warning?: string;
  reset?: boolean;
}

interface DeleteWaiterResponse {
  error?: string;
}

interface SectionLite { id: string; name: string; color: string }

/*
 * Who the account is for. A kitchen tablet signs in like a waiter (a
 * username, at /waiter/login) and its link goes on to the kitchen screen;
 * it is listed here with the waiters, so it can be switched off, given a
 * new password or removed the same way.
 */
type AccountKind = 'waiter' | 'kitchen';
type Field = 'name' | 'username' | 'password' | 'pin';

/** A kitchen tablet's account, as this page made it. */
const isKitchen = (w: Waiter) => isKitchenUsername(w.username);

const AdminWaiters = () => {
  const context = useOutletContext<AdminOutletContext | null>();
  // The restaurant this page shows, which is the one a new account works at
  // (create-waiter is sent the same, below).
  const venueSlug = context?.venueSlug ?? shownVenueSlug();
  const venueName = context?.venueName ?? VENUES[venueSlug]?.name ?? venueSlug;
  // The other restaurants this account can switch to: every one for the owner, the other it runs for an admin of both.
  const others = (context?.choices ?? []).filter((slug) => slug !== venueSlug).map((slug) => VENUES[slug]).filter(Boolean);

  const [waiters, setWaiters] = useState<Waiter[]>([]);
  const [sections, setSections] = useState<SectionLite[]>([]);
  const [assignments, setAssignments] = useState<{ section_id: string; waiter_id: string }[]>([]);
  const [kind, setKind] = useState<AccountKind>('waiter');
  const [name, setName] = useState('');
  const [typedUsername, setTypedUsername] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [pin, setPin] = useState('');
  const [problems, setProblems] = useState<Partial<Record<Field, string>>>({});
  const [creating, setCreating] = useState(false);
  const [card, setCard] = useState<LoginDetails | null>(null);
  const [pinTarget, setPinTarget] = useState<Waiter | null>(null);
  const [pinValue, setPinValue] = useState('');
  const [savingPin, setSavingPin] = useState(false);
  const [resetTarget, setResetTarget] = useState<Waiter | null>(null);
  const [resetPassword, setResetPassword] = useState('');
  const [resetProblem, setResetProblem] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const fields = {
    name: useRef<HTMLInputElement>(null),
    username: useRef<HTMLInputElement>(null),
    password: useRef<HTMLInputElement>(null),
    pin: useRef<HTMLInputElement>(null),
  };

  // Filled in from the name (or the restaurant, for the kitchen) until the admin types their own.
  const username = typedUsername ?? (kind === 'kitchen' ? kitchenUsername(venueSlug) : suggestUsername(name));
  const displayName = name.trim() || (kind === 'kitchen' ? 'Kitchen' : '');

  /** The list did not load: said as that, not as a restaurant with no waiters. */
  const [loadFailed, setLoadFailed] = useState(false);

  const fetchAll = useCallback(async () => {
    const [w, s, a] = await Promise.all([
      supabase.from('waiters').select('id, display_name, username, is_active, has_pin, user_id, created_at, pin_set_at, venue_id').order('display_name'),
      supabase.from('sections').select('id, name, color').order('sort_order'),
      // The rota is keyed by trading day (business_day(), 05:00 to 05:00), so
      // at 00:30 "today's sections" are the ones from the shift still running.
      supabase.from('section_assignments').select('section_id, waiter_id').eq('shift_date', businessDayISO()),
    ]);
    if (w.error) { setLoadFailed(true); toast.error('Could not load the waiters'); return; }
    setLoadFailed(false);
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

  const fix = (field: Field) => setProblems((p) => ({ ...p, [field]: undefined }));

  const createWaiter = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const normalizedUsername = normalizeUsername(username);
    const found: Partial<Record<Field, string>> = {};
    if (!displayName) found.name = 'Type their name, as the team calls them.';
    if (normalizedUsername.length < 3) found.username = 'At least 3 letters or digits.';
    if (password.length < MIN_PASSWORD) {
      found.password = password ? `Too short: at least ${MIN_PASSWORD} characters (${password.length} now).` : `Type one of at least ${MIN_PASSWORD} characters, or Generate.`;
    }
    if (pin && !/^\d{4}$/.test(pin)) found.pin = 'Exactly 4 digits, or leave it blank.';
    setProblems(found);
    const first = (['name', 'username', 'password', 'pin'] as Field[]).find((f) => found[f]);
    if (first) {
      fields[first].current?.focus();
      return;
    }

    setCreating(true);
    try {
      const { data, error } = await supabase.functions.invoke<CreateWaiterResponse>('create-waiter', {
        body: {
          username: normalizedUsername,
          password,
          display_name: displayName,
          pin: kind === 'waiter' && pin ? pin : undefined,
          // The owner adds to the restaurant this page shows — the one the
          // switch picked, or this site's own before any pick (the function
          // refuses the owner a request that names none). A restaurant admin
          // always adds to their own, whatever this says.
          venue: shownVenueSlug(),
        },
      });

      const refusal = await readRefusal(error, data, 'create-waiter');
      if (refusal) {
        const field = refusalField(refusal);
        if (field) {
          setProblems({ [field]: plainRefusal(refusal) });
          fields[field].current?.focus();
        } else {
          toast.error(plainRefusal(refusal), { duration: 8000 });
        }
        return;
      }

      // The password goes on the card, once, and nowhere else.
      setCard({
        kind, venueSlug, venueName, name: displayName, username: normalizedUsername, password,
        pin: data?.pin ?? null, event: 'created',
      });
      if (data?.warning) toast.warning(data.warning, { duration: 8000 });
      setName('');
      setTypedUsername(null);
      setPassword('');
      setPin('');
      setKind('waiter');
      await fetchAll();
    } finally {
      setCreating(false);
    }
  };

  const giveNewPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetTarget) return;
    if (resetPassword.length < MIN_PASSWORD) {
      setResetProblem(`At least ${MIN_PASSWORD} characters (${resetPassword.length} now).`);
      return;
    }
    setResetting(true);
    try {
      const { data, error } = await supabase.functions.invoke<CreateWaiterResponse>('create-waiter', {
        body: { action: 'reset_password', waiter_id: resetTarget.id, password: resetPassword },
      });
      const refusal = await readRefusal(error, data, 'create-waiter');
      if (refusal || !data?.reset) {
        // A create-waiter from before reset_password reads this as a new waiter with no name.
        const outdated = !refusal || /username|display name/i.test(refusal.message);
        setResetProblem(outdated
          ? 'The server cannot reset passwords yet: the create-waiter function needs redeploying.'
          : plainRefusal(refusal));
        return;
      }
      setCard({
        kind: isKitchen(resetTarget) ? 'kitchen' : 'waiter', venueSlug, venueName, name: resetTarget.display_name,
        username: resetTarget.username ?? '', password: resetPassword, event: 'reset',
      });
      setResetTarget(null);
      setResetPassword('');
    } finally {
      setResetting(false);
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

    const refusal = await readRefusal(error, data, 'delete-waiter');
    if (refusal) {
      toast.error(refusal.message);
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
    const url = `${staffSiteUrl(venueSlug)}/waiter/login`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success('Login link copied');
    } catch (error) {
      console.warn('Unable to copy waiter login link', error);
      toast.error('Could not copy login link');
    }
  };

  const problem = (field: Field) => problems[field]
    ? <p id={`waiter-${field}-help`} role="alert" className="text-xs font-sans text-destructive mt-1">{problems[field]}</p>
    : null;

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
        <CardHeader className="pb-3">
          <CardTitle className="font-serif text-lg flex items-center gap-2"><UserPlus className="w-5 h-5" /> Add Waiter</CardTitle>
          {/* Which restaurant, said before anything is typed: the owner adds
              to the one this page shows, and switches here, not after. */}
          <p className="text-sm font-sans text-muted-foreground">
            For <span className="font-semibold text-foreground">{venueName}</span>. They sign in at{' '}
            <span className="font-medium text-foreground break-all">{staffSiteUrl(venueSlug).replace(/^https?:\/\//, '')}/waiter/login</span>.
            {others.map((v) => (
              <Button key={v.slug} type="button" variant="link" onClick={() => switchStaffVenue(v.slug)} className="h-auto p-0 ml-1.5 align-baseline">
                Add to {v.name} instead
              </Button>
            ))}
          </p>
        </CardHeader>
        <CardContent>
          <form onSubmit={(e) => void createWaiter(e)} noValidate className="space-y-4">
            <div role="group" aria-label="Who it is for" className="grid grid-cols-2 gap-1 rounded-lg bg-muted/60 p-1 max-w-sm">
              {([['waiter', 'Waiter', Users], ['kitchen', 'Kitchen tablet', ChefHat]] as const).map(([value, label, Icon]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={kind === value}
                  onClick={() => { setKind(value); setProblems({}); }}
                  className={`min-h-10 rounded-md px-2 text-sm font-sans inline-flex items-center justify-center gap-1.5 transition-colors ${
                    kind === value ? 'bg-background text-foreground font-semibold shadow-sm' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <Icon className="w-4 h-4" aria-hidden /> {label}
                </button>
              ))}
            </div>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <Label htmlFor="waiter-name" className="font-sans text-sm">Name</Label>
                <Input
                  id="waiter-name"
                  ref={fields.name}
                  value={name}
                  onChange={(e) => { setName(e.target.value); fix('name'); if (typedUsername === null) fix('username'); }}
                  placeholder={kind === 'kitchen' ? 'Kitchen' : 'e.g. Marko'}
                  autoComplete="off"
                  aria-invalid={!!problems.name}
                  aria-describedby={problems.name ? 'waiter-name-help' : undefined}
                  className="mt-1.5 h-11"
                />
                {problem('name')}
              </div>
              <div>
                <Label htmlFor="waiter-username" className="font-sans text-sm">Username</Label>
                <Input
                  id="waiter-username"
                  ref={fields.username}
                  value={username}
                  onChange={(e) => { setTypedUsername(e.target.value); fix('username'); }}
                  placeholder="e.g. marko"
                  autoCapitalize="none"
                  autoComplete="off"
                  spellCheck={false}
                  aria-invalid={!!problems.username}
                  aria-describedby="waiter-username-help"
                  className="mt-1.5 h-11 font-mono"
                />
                {problems.username ? problem('username') : (
                  <p id="waiter-username-help" className="text-xs font-sans text-muted-foreground mt-1">
                    {username && normalizeUsername(username) !== username
                      ? <>Signs in as <span className="font-medium text-foreground">{normalizeUsername(username)}</span></>
                      : 'Shared by both restaurants, so it must be unique.'}
                  </p>
                )}
              </div>
              <div className="sm:col-span-2 lg:col-span-1">
                <Label htmlFor="waiter-password" className="font-sans text-sm">Password</Label>
                <NewPasswordField
                  id="waiter-password"
                  ref={fields.password}
                  value={password}
                  onChange={(v) => { setPassword(v); fix('password'); }}
                  problem={problems.password}
                  className="mt-1.5"
                />
              </div>
              {kind === 'waiter' && (
                <div>
                  <Label htmlFor="waiter-pin" className="font-sans text-sm">Floor PIN <span className="text-muted-foreground font-normal">(optional)</span></Label>
                  <Input
                    id="waiter-pin"
                    ref={fields.pin}
                    inputMode="numeric"
                    maxLength={4}
                    placeholder="4 digits"
                    value={pin}
                    onChange={(e) => { setPin(e.target.value.replace(/\D/g, '').slice(0, 4)); fix('pin'); }}
                    aria-invalid={!!problems.pin}
                    aria-describedby="waiter-pin-help"
                    className="mt-1.5 h-11"
                  />
                  {problems.pin ? problem('pin') : (
                    <p id="waiter-pin-help" className="text-xs font-sans text-muted-foreground mt-1">Blank: one is made for them.</p>
                  )}
                </div>
              )}
            </div>

            <Button type="submit" disabled={creating} className="gap-2 min-h-[44px] rounded-xl">
              {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
              Create
            </Button>
          </form>
          <p className="text-xs font-sans text-muted-foreground mt-3">
            {kind === 'kitchen'
              ? 'The kitchen tablet signs in with this username and password; its link opens the kitchen screen.'
              : <>Waiters sign in with their username and password. The <span className="font-medium">Floor PIN</span> is for the shared floor screen, to see only their tables.</>}
            {' '}You get a card to copy or share as soon as it is created.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="font-serif text-lg">Waiters and kitchen tablets</CardTitle>
        </CardHeader>
        <CardContent>
          {loadFailed ? (
            <div role="alert" className="text-sm font-sans">
              <p className="text-foreground">The list could not be loaded. Nothing is lost.</p>
              <Button variant="outline" size="sm" className="mt-2 min-h-[44px]" onClick={() => { void fetchAll(); }}>Try again</Button>
            </div>
          ) : waiters.length === 0 ? (
            <p className="text-sm font-sans text-muted-foreground">No waiters yet.</p>
          ) : (
            <div className="divide-y divide-border">
              {waiters.map((waiter) => (
                <div key={waiter.id} className="flex flex-col sm:flex-row sm:items-center sm:justify-between py-3 gap-2 sm:gap-3">
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
                  <div className="flex items-center gap-2 shrink-0 flex-wrap">
                    {waiter.username && waiter.user_id && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => { setResetTarget(waiter); setResetPassword(''); setResetProblem(null); }}
                        className="gap-1.5"
                        aria-label={`New password for ${waiter.display_name}`}
                      >
                        <LockKeyhole className="w-3.5 h-3.5" /> Password
                      </Button>
                    )}
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

      {/* A forgotten password: a new one, shown once on the card. The old
          one stops working at once; nothing else about them changes. */}
      <Dialog open={!!resetTarget} onOpenChange={(open) => { if (!open) { setResetTarget(null); setResetPassword(''); } }}>
        <DialogContent className="max-w-[calc(100vw-2rem)] sm:max-w-md rounded-2xl">
          <form onSubmit={(e) => void giveNewPassword(e)} noValidate className="space-y-4">
            <DialogHeader>
              <DialogTitle className="font-serif">New password for {resetTarget?.display_name}</DialogTitle>
              <DialogDescription>
                For <span className="font-mono">@{resetTarget?.username}</span>. Their old password stops working.
              </DialogDescription>
            </DialogHeader>
            <div>
              <Label htmlFor="reset-password" className="font-sans text-sm">New password</Label>
              <NewPasswordField
                id="reset-password"
                value={resetPassword}
                onChange={(v) => { setResetPassword(v); setResetProblem(null); }}
                problem={resetProblem}
                className="mt-1.5"
              />
            </div>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button type="button" variant="outline" onClick={() => setResetTarget(null)}>Cancel</Button>
              <Button type="submit" disabled={resetting} className="gap-2">
                {resetting && <Loader2 className="w-4 h-4 animate-spin" />} Set new password
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <LoginCard details={card} onDone={() => setCard(null)} />
    </div>
  );
};

export default AdminWaiters;
