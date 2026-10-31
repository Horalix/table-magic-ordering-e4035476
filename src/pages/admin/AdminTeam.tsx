import React, { useRef, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChefHat, Crown, KeyRound, Loader2, ShieldCheck, UserMinus, UserPlus, Users } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import { VENUES } from '@/lib/venues';
import type { AdminOutletContext } from '@/components/admin/AdminLayout';

/**
 * The owner's team: who runs each restaurant (supabase/functions/manage-admins).
 *
 * Every admin, waiter and kitchen account, by restaurant. The owner appoints
 * a restaurant's admin by email — an account that exists gets the role; a
 * new one is created with the initial password typed here, which goes to
 * Supabase Auth and nowhere else, and which the new admin changes after
 * signing in (Admin menu → Change password). Revoking takes away that one
 * restaurant's admin role and nothing else. Waiters are added and removed
 * under Waiters, as before.
 */

const MIN_PASSWORD = 10;

interface Account {
  user_id: string;
  email: string | null;
  username: string | null;
  display_name: string | null;
  kind: 'owner' | 'admin' | 'waiter' | 'kitchen';
  venue: string | null;
  you: boolean;
}

interface TeamList {
  venues: { slug: string; name: string }[];
  accounts: Account[];
}

interface Appointed {
  created: boolean;
  already?: boolean;
}

class TeamError extends Error {
  constructor(message: string, readonly code?: string) {
    super(message);
  }
}

async function callTeam<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T & { error?: string; code?: string }>('manage-admins', { body });
  if (error) {
    // A refusal (400, 403, 409) says why in its body, not in the client's generic message.
    const context = (error as { context?: unknown }).context;
    if (context instanceof Response) {
      const reason = await context.json().catch(() => null) as { error?: string; code?: string } | null;
      if (reason?.error) throw new TeamError(reason.error, reason.code);
    }
    throw new TeamError(error.message);
  }
  if (data?.error) throw new TeamError(data.error, data.code);
  return data as T;
}

const who = (a: Account) => a.email ?? (a.username ? `@${a.username}` : 'Unknown account');

const People = ({ title, icon: Icon, people, empty, action }: {
  title: string;
  icon: React.ElementType;
  people: Account[];
  empty: string;
  action?: (a: Account) => React.ReactNode;
}) => (
  <div>
    <p className="text-xs font-sans font-semibold uppercase tracking-[0.12em] text-muted-foreground flex items-center gap-1.5 mb-1.5">
      <Icon className="w-3.5 h-3.5" aria-hidden /> {title}
    </p>
    {people.length === 0 ? (
      <p className="text-sm font-sans text-muted-foreground py-1.5">{empty}</p>
    ) : (
      <ul className="divide-y divide-border">
        {people.map((a) => (
          <li key={`${a.user_id}-${a.kind}`} className="flex items-center justify-between gap-3 py-2 min-h-[44px]">
            <div className="min-w-0">
              <p className="text-sm font-sans font-medium text-foreground truncate">
                {a.display_name ?? who(a)}
                {a.you && <span className="ml-1.5 text-xs font-normal text-muted-foreground">(you)</span>}
              </p>
              {a.display_name && <p className="text-xs font-sans text-muted-foreground truncate">{who(a)}</p>}
            </div>
            {action?.(a)}
          </li>
        ))}
      </ul>
    )}
  </div>
);

const AdminTeam = () => {
  const context = useOutletContext<AdminOutletContext | null>();
  const [email, setEmail] = useState('');
  const [venue, setVenue] = useState<string>(() => context?.venueSlug ?? Object.keys(VENUES)[0]);
  const [password, setPassword] = useState('');
  const [needsPassword, setNeedsPassword] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [created, setCreated] = useState<{ email: string; venue: string } | null>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  const { data, error, isLoading, refetch } = useQuery({
    queryKey: ['owner-team'],
    queryFn: () => callTeam<TeamList>({ action: 'list' }),
    staleTime: 0,
    retry: false,
  });

  const venues = data?.venues?.length ? data.venues : Object.values(VENUES).map(({ slug, name }) => ({ slug, name }));
  const nameOf = (slug: string | null) => venues.find((v) => v.slug === slug)?.name ?? VENUES[slug ?? '']?.name ?? slug ?? '';
  const accounts = data?.accounts ?? [];

  const appoint = async (e: React.FormEvent) => {
    e.preventDefault();
    const address = email.trim().toLowerCase();
    if (!address) return;
    if (password && password.length < MIN_PASSWORD) {
      setNeedsPassword(`At least ${MIN_PASSWORD} characters.`);
      passwordRef.current?.focus();
      return;
    }
    setSaving(true);
    setNeedsPassword(null);
    setCreated(null);
    try {
      const result = await callTeam<Appointed>({ action: 'appoint', email: address, venue, password: password || undefined });
      // The password has gone to Supabase Auth; it is not kept here either.
      setPassword('');
      setEmail('');
      if (result.created) {
        setCreated({ email: address, venue });
      } else {
        toast.success(result.already
          ? `${address} is already the admin of ${nameOf(venue)}`
          : `${address} is now the admin of ${nameOf(venue)}. They sign in with their own password.`);
      }
      await refetch();
    } catch (err) {
      const problem = err instanceof TeamError ? err : new TeamError('Could not appoint them');
      if (problem.code === 'needs_password') {
        setNeedsPassword(problem.message);
        passwordRef.current?.focus();
      } else {
        toast.error(problem.message);
      }
    } finally {
      setSaving(false);
    }
  };

  const revoke = async (a: Account) => {
    try {
      await callTeam({ action: 'revoke', user_id: a.user_id, venue: a.venue });
      toast.success(`${who(a)} no longer runs ${nameOf(a.venue)}`);
      await refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not revoke');
    }
  };

  const revokeButton = (a: Account) => (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5 min-h-[40px] shrink-0" aria-label={`Revoke ${who(a)} as ${nameOf(a.venue)} admin`}>
          <UserMinus className="w-4 h-4" /> Revoke
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Revoke {who(a)}?</AlertDialogTitle>
          <AlertDialogDescription>
            They will no longer manage {nameOf(a.venue)}. Their account stays, and so does anything else it does
            (another restaurant's floor or kitchen, for instance).
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep them</AlertDialogCancel>
          <AlertDialogAction onClick={() => void revoke(a)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
            Revoke admin
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  const owners = accounts.filter((a) => a.kind === 'owner');

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-serif text-3xl font-bold text-foreground">Team</h1>
        <p className="text-sm font-sans text-muted-foreground mt-1">
          Who runs each restaurant. Only you, the owner, see this page.
        </p>
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="font-serif text-lg flex items-center gap-2"><UserPlus className="w-5 h-5" /> Appoint a restaurant admin</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={appoint} className="space-y-4">
            <div className="grid gap-4 lg:grid-cols-3">
              <div>
                <Label htmlFor="team-email" className="font-sans text-sm">Their email</Label>
                <Input
                  id="team-email"
                  type="email"
                  autoComplete="off"
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); setNeedsPassword(null); }}
                  placeholder="name@example.com"
                  required
                  className="mt-1.5 h-11"
                />
              </div>
              <div>
                <Label id="team-venue" className="font-sans text-sm">Restaurant they will run</Label>
                <div role="group" aria-labelledby="team-venue" className="mt-1.5 grid grid-cols-2 gap-1 rounded-lg bg-muted/60 p-1">
                  {venues.map((v) => (
                    <button
                      key={v.slug}
                      type="button"
                      aria-pressed={venue === v.slug}
                      onClick={() => setVenue(v.slug)}
                      className={`min-h-9 rounded-md px-2 text-sm font-sans transition-colors ${
                        venue === v.slug ? 'bg-background text-foreground font-semibold shadow-sm' : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      {v.name}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <Label htmlFor="team-password" className="font-sans text-sm">Initial password <span className="text-muted-foreground font-normal">(new accounts only)</span></Label>
                <Input
                  id="team-password"
                  ref={passwordRef}
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setNeedsPassword(null); }}
                  minLength={MIN_PASSWORD}
                  aria-invalid={!!needsPassword}
                  aria-describedby="team-password-help"
                  className="mt-1.5 h-11"
                />
                <p id="team-password-help" className={`text-xs font-sans mt-1 ${needsPassword ? 'text-destructive' : 'text-muted-foreground'}`}>
                  {needsPassword ?? `Only if they have no account yet. At least ${MIN_PASSWORD} characters; tell them in person.`}
                </p>
              </div>
            </div>
            <Button type="submit" disabled={saving || !email.trim()} className="gap-2 min-h-[44px] rounded-xl">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
              Appoint {nameOf(venue)} admin
            </Button>
          </form>

          {created && (
            <div role="status" className="mt-4 flex items-start gap-2 rounded-xl border border-primary/25 bg-primary/5 px-3 py-2.5">
              <KeyRound className="w-4 h-4 text-primary shrink-0 mt-0.5" aria-hidden />
              <p className="text-sm font-sans text-foreground">
                Account created: <span className="font-medium">{created.email}</span> now runs {nameOf(created.venue)}.
                Give them the password in person, and ask them to change it after signing in (admin menu → Change password).
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {error && (
        <Card className="border-destructive/25 bg-destructive/5 mb-6">
          <CardContent className="p-4 sm:p-5">
            <p role="alert" className="text-sm font-sans text-foreground">
              Could not load the team: {error.message}. The manage-admins function may not be deployed yet.
            </p>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {venues.map((v) => <Skeleton key={v.slug} className="h-72 rounded-xl" />)}
        </div>
      ) : data ? (
        <>
          <div className="grid gap-4 lg:grid-cols-2 mb-6">
            {venues.map((v) => {
              const here = accounts.filter((a) => a.venue === v.slug);
              return (
                <section key={v.slug} aria-label={`${v.name} team`}>
                  <Card className="h-full">
                    <CardHeader className="pb-3">
                      <CardTitle className="font-serif text-xl">{v.name}</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <People
                        title="Admins"
                        icon={ShieldCheck}
                        people={here.filter((a) => a.kind === 'admin')}
                        empty="No admin of its own yet: you run it."
                        action={revokeButton}
                      />
                      <People title="Waiters" icon={Users} people={here.filter((a) => a.kind === 'waiter')} empty="No waiters yet. Add them under Waiters." />
                      <People title="Kitchen screens" icon={ChefHat} people={here.filter((a) => a.kind === 'kitchen')} empty="No kitchen account." />
                    </CardContent>
                  </Card>
                </section>
              );
            })}
          </div>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="font-serif text-lg flex items-center gap-2"><Crown className="w-5 h-5" /> Owner</CardTitle>
            </CardHeader>
            <CardContent>
              <People title="Every restaurant" icon={Crown} people={owners} empty="No owner account." />
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
};

export default AdminTeam;
