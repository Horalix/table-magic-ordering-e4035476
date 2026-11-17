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
import { AdminPageHeader } from '@/components/admin/AdminPage';
import { AdminCard, AdminCardContent, AdminCardHeader, EmptyState } from '@/components/admin/AdminCard';
import { TONE, type StaffTone } from '@/components/staff/status-tone';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { CalendarCheck, ChefHat, Copy, KeyRound, LockKeyhole, Loader2, Search, Trash2, UserPlus, Users } from 'lucide-react';
import { cn } from '@/lib/utils';
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

/** Past this many accounts the list gets a search box. */
const SEARCH_FROM = 9;

const initials = (name: string) => name.split(' ').map((s) => s[0]).join('').slice(0, 2).toUpperCase();
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** A state as a word with a dot, in the staff screens' colours. */
const Pill = ({ tone, children }: { tone: StaffTone; children: React.ReactNode }) => (
  <span className={cn('inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-sans font-medium', TONE[tone].chip)}>
    <span className={cn('h-1.5 w-1.5 rounded-full', TONE[tone].dot)} aria-hidden />
    {children}
  </span>
);

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
  const [query, setQuery] = useState('');
  const fields = {
    name: useRef<HTMLInputElement>(null),
    username: useRef<HTMLInputElement>(null),
    password: useRef<HTMLInputElement>(null),
    pin: useRef<HTMLInputElement>(null),
  };
  const formCard = useRef<HTMLDivElement>(null);

  // Filled in from the name (or the restaurant, for the kitchen) until the admin types their own.
  const username = typedUsername ?? (kind === 'kitchen' ? kitchenUsername(venueSlug) : suggestUsername(name));
  const displayName = name.trim() || (kind === 'kitchen' ? 'Kitchen' : '');

  /** The list did not load: said as that, not as a restaurant with no waiters. */
  const [loadFailed, setLoadFailed] = useState(false);
  /** The first answer is in: until then the list is a skeleton, not "No waiters yet". */
  const [loaded, setLoaded] = useState(false);

  const fetchAll = useCallback(async () => {
    const [w, s, a] = await Promise.all([
      supabase.from('waiters').select('id, display_name, username, is_active, has_pin, user_id, created_at, pin_set_at, venue_id').order('display_name'),
      supabase.from('sections').select('id, name, color').order('sort_order'),
      // The rota is keyed by trading day (business_day(), 05:00 to 05:00), so
      // at 00:30 "today's sections" are the ones from the shift still running.
      supabase.from('section_assignments').select('section_id, waiter_id').eq('shift_date', businessDayISO()),
    ]);
    setLoaded(true);
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

  /** On a phone the form is under the list: take them to it, ready to type. */
  const goToForm = () => {
    formCard.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    fields.name.current?.focus({ preventScroll: true });
  };

  const problem = (field: Field) => problems[field]
    ? <p id={`waiter-${field}-help`} role="alert" className="text-xs font-sans text-destructive mt-1.5">{problems[field]}</p>
    : null;

  const people = waiters.filter((w) => !isKitchen(w));
  const tablets = waiters.filter(isKitchen);
  const onSection = people.filter((w) => (sectionsByWaiter.get(w.id) ?? []).length > 0).length;
  const switchedOff = waiters.filter((w) => !w.is_active).length;
  const needle = query.trim().toLowerCase();
  const shown = (list: Waiter[]) => (needle
    ? list.filter((w) => w.display_name.toLowerCase().includes(needle) || (w.username ?? '').toLowerCase().includes(needle))
    : list);
  const counts = [
    plural(people.length, 'waiter'),
    people.length > 0 ? `${onSection} on a section today` : null,
    tablets.length > 0 ? plural(tablets.length, 'kitchen tablet') : null,
    switchedOff > 0 ? `${switchedOff} switched off` : null,
  ].filter(Boolean).join(' · ');

  const row = (waiter: Waiter) => {
    const kitchen = isKitchen(waiter);
    const theirs = sectionsByWaiter.get(waiter.id) ?? [];
    return (
      <li key={waiter.id} className="flex flex-wrap items-center gap-x-3 gap-y-3 py-4">
        {/* Name, sign-in and today's section; the switch beside it on a
            phone, the buttons on the line under it. From sm up it is one
            line: buttons, switch, then Remove at the end. */}
        <span
          className={cn(
            'order-1 grid h-10 w-10 shrink-0 place-items-center rounded-full text-xs font-sans font-semibold',
            !waiter.is_active && 'opacity-60',
            theirs.length > 0 && waiter.is_active ? 'text-white' : 'bg-muted text-muted-foreground',
          )}
          style={theirs.length > 0 && waiter.is_active ? { background: theirs[0].color } : undefined}
          aria-hidden
        >
          {kitchen ? <ChefHat className="h-4 w-4" /> : initials(waiter.display_name)}
        </span>
        <div className="order-2 min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <p className={cn('truncate font-sans font-medium', waiter.is_active ? 'text-foreground' : 'text-muted-foreground')}>{waiter.display_name}</p>
            {!waiter.is_active && <Pill tone="served">Switched off</Pill>}
          </div>
          <p className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1.5 text-xs font-sans text-muted-foreground">
            <span className="truncate">{waiter.username ? `@${waiter.username}` : 'no username (legacy)'}</span>
            {kitchen ? (
              <><span aria-hidden>·</span><span>Kitchen tablet</span></>
            ) : waiter.has_pin ? (
              <><span aria-hidden>·</span><span>PIN set</span></>
            ) : (
              <><span aria-hidden>·</span><span className={TONE.preparing.text}>No floor PIN</span></>
            )}
          </p>
          {!kitchen && (
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {theirs.length > 0 ? theirs.map((s) => (
                <span key={s.id} className="inline-flex items-center gap-1.5 rounded-full border border-border/80 bg-background px-2 py-0.5 text-[11px] font-sans font-medium text-foreground">
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: s.color }} aria-hidden />{s.name}
                </span>
              )) : (
                <span className="text-[11px] font-sans text-muted-foreground">No section today</span>
              )}
            </div>
          )}
        </div>
        <Switch
          checked={waiter.is_active}
          aria-label={`${waiter.is_active ? 'Deactivate' : 'Activate'} ${waiter.display_name}`}
          onCheckedChange={() => { void toggleActive(waiter); }}
          // 44 px to tap, the switch its usual size.
          className="relative order-3 after:absolute after:-inset-x-1 after:-inset-y-2.5 sm:order-4"
        />
        <div className="order-4 flex w-full items-center gap-2 ps-[52px] sm:contents">
          {waiter.username && waiter.user_id && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => { setResetTarget(waiter); setResetPassword(''); setResetProblem(null); }}
              className="h-11 gap-1.5 sm:order-3 lg:h-9"
              aria-label={`New password for ${waiter.display_name}`}
            >
              <LockKeyhole className="h-4 w-4" aria-hidden /> Password
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => { setPinTarget(waiter); setPinValue(''); }}
            className="h-11 gap-1.5 sm:order-3 lg:h-9"
            aria-label={`Set PIN for ${waiter.display_name}`}
          >
            <KeyRound className="h-4 w-4" aria-hidden /> PIN
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Remove waiter ${waiter.display_name}`}
                className="ms-auto h-11 w-11 text-destructive hover:bg-destructive/10 hover:text-destructive sm:order-5 sm:ms-0 lg:h-9 lg:w-9"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent className="max-w-[calc(100vw-2rem)] rounded-2xl sm:max-w-md">
              <AlertDialogHeader>
                <AlertDialogTitle>Remove {waiter.display_name}?</AlertDialogTitle>
                <AlertDialogDescription>
                  This permanently deletes the waiter account and login. Past orders are kept but unassigned. This cannot be undone.
                  {waiter.is_active && ' To keep the account but stop them signing in, switch them off instead.'}
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
      </li>
    );
  };

  const list = (() => {
    if (!loaded) {
      return (
        <div className="space-y-3" aria-busy="true" aria-label="Loading waiters">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 py-1">
              <Skeleton className="h-10 w-10 rounded-full" />
              <div className="flex-1 space-y-2"><Skeleton className="h-4 w-40" /><Skeleton className="h-3 w-28" /></div>
            </div>
          ))}
        </div>
      );
    }
    if (loadFailed) {
      return (
        <div>
          <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm font-sans text-destructive">
            The list could not be loaded. Nothing is lost.
          </p>
          <Button variant="outline" className="mt-3 h-11 lg:h-10" onClick={() => { void fetchAll(); }}>Try again</Button>
        </div>
      );
    }
    if (waiters.length === 0) {
      return (
        <EmptyState
          icon={Users}
          title="No waiters yet."
          hint="Add the first one with Add Waiter. You get a card with how they sign in, to send them."
          className="py-8"
        />
      );
    }
    const theseWaiters = shown(people);
    const theseTablets = shown(tablets);
    if (theseWaiters.length + theseTablets.length === 0) {
      return <p className="py-6 text-center text-sm font-sans text-muted-foreground">Nobody matches “{query.trim()}”.</p>;
    }
    return (
      <div className="space-y-5">
        {theseWaiters.length > 0 && (
          <ul aria-label="Waiters" className="-my-4 divide-y divide-border/70">{theseWaiters.map(row)}</ul>
        )}
        {theseTablets.length > 0 && (
          <div className={cn(theseWaiters.length > 0 && 'border-t border-border/70 pt-5')}>
            <p className="flex items-center gap-1.5 text-xs font-sans font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              <ChefHat className="h-3.5 w-3.5" aria-hidden /> Kitchen tablets
            </p>
            <ul aria-label="Kitchen tablets" className="-mb-4 divide-y divide-border/70">{theseTablets.map(row)}</ul>
          </div>
        )}
      </div>
    );
  })();

  return (
    <div className="mx-auto w-full max-w-6xl">
      <AdminPageHeader
        title="Waiters"
        description="Everyone who signs in to the waiter app or the kitchen screen here: add them, switch them off, or give them a new password or floor PIN."
        actions={(
          <>
            <Button variant="outline" onClick={copyLoginLink} className="h-11 gap-2 lg:h-10">
              <Copy className="h-4 w-4" aria-hidden /> Copy waiter login link
            </Button>
            <Button onClick={goToForm} className="h-11 gap-2 lg:hidden">
              <UserPlus className="h-4 w-4" aria-hidden /> Add a waiter
            </Button>
          </>
        )}
      />

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_400px]">
        <AdminCard className="min-w-0">
          <AdminCardHeader
            icon={Users}
            title="Waiters and kitchen tablets"
            description={loaded && !loadFailed && waiters.length > 0 ? counts : undefined}
            action={(
              <Button variant="ghost" size="sm" asChild className="hidden h-9 gap-1.5 text-primary hover:text-primary sm:inline-flex">
                <Link to="/admin/tonight"><CalendarCheck className="h-4 w-4" aria-hidden /> Assign sections</Link>
              </Button>
            )}
          />
          <AdminCardContent className="space-y-4">
            {loaded && !loadFailed && waiters.length >= SEARCH_FROM && (
              <div className="relative">
                <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                <Input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Find by name"
                  aria-label="Find a waiter"
                  className="h-11 ps-9"
                />
              </div>
            )}
            {list}
            {/* On a phone the title needs the width; the way to the rota goes under the list. */}
            {loaded && !loadFailed && people.length > 0 && (
              <Button variant="outline" asChild className="h-11 w-full gap-2 sm:hidden">
                <Link to="/admin/tonight"><CalendarCheck className="h-4 w-4" aria-hidden /> Assign sections</Link>
              </Button>
            )}
          </AdminCardContent>
        </AdminCard>

        <AdminCard ref={formCard} className="min-w-0 scroll-mt-[calc(var(--admin-top,0px)+1rem)] lg:sticky lg:top-[calc(var(--admin-top,0px)+1.5rem)]">
          <AdminCardHeader
            icon={UserPlus}
            title="Add Waiter"
            // Which restaurant, said before anything is typed: the owner adds
            // to the one this page shows, and switches here, not after.
            description={(
              <>
                For <span className="font-semibold text-foreground">{venueName}</span>. They sign in at{' '}
                <span className="font-medium text-foreground break-all">{staffSiteUrl(venueSlug).replace(/^https?:\/\//, '')}/waiter/login</span>.
                {others.map((v) => (
                  <Button key={v.slug} type="button" variant="link" onClick={() => switchStaffVenue(v.slug)} className="ml-1.5 h-auto p-0 align-baseline text-[13px]">
                    Add to {v.name} instead
                  </Button>
                ))}
              </>
            )}
          />
          <AdminCardContent>
            <form onSubmit={(e) => void createWaiter(e)} noValidate className="space-y-4">
              <div role="group" aria-label="Who it is for" className="grid grid-cols-2 gap-1 rounded-xl bg-muted/70 p-1">
                {([['waiter', 'Waiter', Users], ['kitchen', 'Kitchen tablet', ChefHat]] as const).map(([value, label, Icon]) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={kind === value}
                    onClick={() => { setKind(value); setProblems({}); }}
                    className={cn(
                      'inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg px-2 text-sm font-sans transition-colors sm:min-h-10',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      kind === value ? 'bg-background font-semibold text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    <Icon className="h-4 w-4" aria-hidden /> {label}
                  </button>
                ))}
              </div>

              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
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
                    <p id="waiter-username-help" className="text-xs font-sans text-muted-foreground mt-1.5">
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
                  <div className="sm:col-span-2 lg:col-span-1">
                    <Label htmlFor="waiter-pin" className="font-sans text-sm">Floor PIN <span className="text-muted-foreground font-normal">(optional)</span></Label>
                    <Input
                      id="waiter-pin"
                      ref={fields.pin}
                      inputMode="numeric"
                      autoComplete="off"
                      maxLength={4}
                      placeholder="4 digits"
                      value={pin}
                      onChange={(e) => { setPin(e.target.value.replace(/\D/g, '').slice(0, 4)); fix('pin'); }}
                      aria-invalid={!!problems.pin}
                      aria-describedby="waiter-pin-help"
                      className="mt-1.5 h-11 font-mono tracking-[0.3em] placeholder:font-sans placeholder:tracking-normal sm:max-w-[10rem] lg:max-w-none"
                    />
                    {problems.pin ? problem('pin') : (
                      <p id="waiter-pin-help" className="text-xs font-sans text-muted-foreground mt-1.5">Blank: one is made for them and shown on the card.</p>
                    )}
                  </div>
                )}
              </div>

              <Button type="submit" disabled={creating} className="h-11 w-full gap-2 sm:w-auto lg:w-full">
                {creating ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <UserPlus className="h-4 w-4" />}
                Create
              </Button>
            </form>
            <div className="mt-4 space-y-1.5 rounded-xl bg-muted/50 px-4 py-3 text-xs font-sans leading-relaxed text-muted-foreground">
              <p>
                {kind === 'kitchen'
                  ? 'The kitchen tablet signs in with this username and password; its link opens the kitchen screen.'
                  : <>Waiters sign in with their username and password. The <span className="font-medium text-foreground">Floor PIN</span> is for the shared floor screen, to see only their tables.</>}
              </p>
              <p>
                You get a card to copy or share as soon as it is created. It shows the password once; after that nobody can see it, you included.
              </p>
            </div>
          </AdminCardContent>
        </AdminCard>
      </div>

      <Dialog open={!!pinTarget} onOpenChange={(open) => { if (!open) { setPinTarget(null); setPinValue(''); } }}>
        <DialogContent className="max-w-[calc(100vw-2rem)] rounded-2xl sm:max-w-sm">
          <form onSubmit={(e) => { e.preventDefault(); void setWaiterPin(); }} className="grid gap-4">
            <DialogHeader className="pe-8 text-start">
              <DialogTitle className="font-serif">Floor PIN for {pinTarget?.display_name}</DialogTitle>
              <DialogDescription>
                4 digits {pinTarget?.display_name.split(' ')[0]} taps on the floor monitor to see only their tables.
                {pinTarget?.has_pin ? ' It replaces the one they have now.' : ''}
              </DialogDescription>
            </DialogHeader>
            <div>
              <Label htmlFor="waiter-new-pin" className="sr-only">New PIN</Label>
              <Input
                id="waiter-new-pin"
                inputMode="numeric"
                autoComplete="off"
                maxLength={4}
                placeholder="0000"
                value={pinValue}
                onChange={(e) => setPinValue(e.target.value.replace(/\D/g, '').slice(0, 4))}
                className="h-14 indent-[0.5em] text-center font-mono text-2xl tracking-[0.5em] md:text-2xl"
                autoFocus
              />
              <p className="mt-2 text-xs font-sans text-muted-foreground">
                Tell them the PIN now: it is kept scrambled, so nobody can see it again, you included.
              </p>
            </div>
            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" onClick={() => { setPinTarget(null); setPinValue(''); }} className="h-11 lg:h-10">Cancel</Button>
              <Button type="submit" disabled={savingPin || pinValue.length !== 4} className="h-11 lg:h-10">
                {savingPin ? <Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none" /> : 'Save PIN'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* A forgotten password: a new one, shown once on the card. The old
          one stops working at once; nothing else about them changes. */}
      <Dialog open={!!resetTarget} onOpenChange={(open) => { if (!open) { setResetTarget(null); setResetPassword(''); } }}>
        <DialogContent className="max-w-[calc(100vw-2rem)] sm:max-w-md rounded-2xl">
          <form onSubmit={(e) => void giveNewPassword(e)} noValidate className="space-y-4">
            <DialogHeader className="pe-8 text-start">
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
              <p className="mt-2 text-xs font-sans text-muted-foreground">
                Next you get a card with it, to copy or send to them. It is shown there once.
              </p>
            </div>
            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" onClick={() => setResetTarget(null)} className="h-11 lg:h-10">Cancel</Button>
              <Button type="submit" disabled={resetting} className="h-11 gap-2 lg:h-10">
                {resetting && <Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none" />} Set new password
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
