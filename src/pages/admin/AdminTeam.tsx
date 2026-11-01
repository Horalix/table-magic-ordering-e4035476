import React, { useRef, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChefHat, Crown, Loader2, LockKeyhole, ShieldCheck, UserMinus, UserPlus, Users } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import LoginCard from '@/components/admin/LoginCard';
import NewPasswordField from '@/components/admin/NewPasswordField';
import {
  isKitchenUsername, MIN_PASSWORD, plainRefusal, readRefusal, refusalField, staffSiteUrl, type LoginDetails,
} from '@/lib/staff-accounts';
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
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { VENUES } from '@/lib/venues';
import type { AdminOutletContext } from '@/components/admin/AdminLayout';

/**
 * The owner's team: who runs each restaurant (supabase/functions/manage-admins).
 *
 * Every admin, waiter and kitchen account, by restaurant. The owner appoints
 * a restaurant's admin by email — an account that exists gets the role; a
 * new one is created with the initial password typed here, which goes to
 * Supabase Auth and nowhere else, and which the new admin changes after
 * signing in (Admin menu → Change password). The login card says where
 * (their restaurant's own site) and shows that password once. Revoking takes
 * away that one restaurant's admin role and nothing else. Waiters and kitchen
 * tablets are added and removed under Waiters, as before.
 *
 * Every row has a Password button: anyone on the team who forgot theirs gets
 * a new one here, shown once on the login card (manage-admins
 * reset_password). The owner's own row opens Change password instead, which
 * asks for the current one.
 */

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
  // A refusal (400, 403, 409) says why in its body, not in the client's generic message.
  const refusal = await readRefusal(error, data, 'manage-admins');
  if (refusal) {
    // Supabase Auth refusing the initial password is about the password field too.
    throw new TeamError(plainRefusal(refusal), refusalField(refusal) === 'password' ? 'needs_password' : refusal.code);
  }
  return data as T;
}

const who = (a: Account) => a.email ?? (a.username ? `@${a.username}` : 'Unknown account');

/**
 * A kitchen screen: an account with no waiter's row (made by hand), or one
 * made under Waiters → Kitchen tablet, which signs in like a waiter
 * (kitchenUsername in src/lib/staff-accounts.ts).
 */
const kitchenTablet = (a: Account) => a.kind === 'kitchen' || (a.kind === 'waiter' && isKitchenUsername(a.username));

/**
 * Who gets a Password button: a restaurant's admin (signs in with their
 * email), a waiter or a kitchen tablet (with their username). A kitchen
 * account made by hand has no username, so no sign-in the card could point
 * to; an owner changes their own.
 */
const resettable = (a: Account) => (a.kind === 'admin' && !!a.email) || (a.kind !== 'owner' && !!a.username);

/** The login card after a new password. */
function resetCard(a: Account, venueName: string, password: string): LoginDetails {
  const kind = a.kind === 'admin' ? 'admin' : kitchenTablet(a) ? 'kitchen' : 'waiter';
  const username = (kind === 'admin' ? a.email : a.username) ?? '';
  return {
    kind, venueSlug: a.venue ?? '', venueName, name: kind === 'admin' ? username : a.display_name ?? username,
    username, password, event: 'reset',
  };
}

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
  const [card, setCard] = useState<LoginDetails | null>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const [resetTarget, setResetTarget] = useState<Account | null>(null);
  const [resetPassword, setResetPassword] = useState('');
  const [resetProblem, setResetProblem] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);

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
    const initial = password;
    try {
      const result = await callTeam<Appointed>({ action: 'appoint', email: address, venue, password: password || undefined });
      // The password has gone to Supabase Auth; the card shows it once, and
      // it is not kept anywhere here either.
      setPassword('');
      setEmail('');
      if (result.already) {
        toast.success(`${address} is already the admin of ${nameOf(venue)}`);
      } else {
        setCard({
          kind: 'admin', venueSlug: venue, venueName: nameOf(venue), name: address, username: address,
          password: result.created ? initial : null, event: result.created ? 'created' : 'appointed',
        });
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

  const closeReset = () => { setResetTarget(null); setResetPassword(''); setResetProblem(null); };

  const giveNewPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetTarget) return;
    if (resetPassword.length < MIN_PASSWORD) {
      setResetProblem(`At least ${MIN_PASSWORD} characters (${resetPassword.length} now).`);
      return;
    }
    setResetting(true);
    try {
      await callTeam({ action: 'reset_password', user_id: resetTarget.user_id, password: resetPassword });
      setCard(resetCard(resetTarget, nameOf(resetTarget.venue), resetPassword));
      closeReset();
    } catch (err) {
      const problem = err instanceof TeamError ? err : new TeamError('Could not set the new password');
      // A manage-admins from before reset_password does not know the action.
      setResetProblem(/unknown action/i.test(problem.message)
        ? 'The server cannot do this yet: the manage-admins function needs redeploying.'
        : problem.message);
    } finally {
      setResetting(false);
    }
  };

  const passwordButton = (a: Account) => {
    if (a.you) {
      return context?.changePassword ? (
        <Button variant="outline" size="sm" onClick={context.changePassword} className="gap-1.5 min-h-[40px] shrink-0">
          <LockKeyhole className="w-4 h-4" /> Change password
        </Button>
      ) : null;
    }
    if (!resettable(a)) return null;
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={() => { setResetTarget(a); setResetPassword(''); setResetProblem(null); }}
        className="gap-1.5 min-h-[40px] shrink-0"
        aria-label={`New password for ${a.display_name ?? who(a)}`}
      >
        <LockKeyhole className="w-4 h-4" /> Password
      </Button>
    );
  };

  const adminActions = (a: Account) => (
    <div className="flex items-center gap-2 shrink-0">
      {passwordButton(a)}
      {revokeButton(a)}
    </div>
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
                <NewPasswordField
                  id="team-password"
                  ref={passwordRef}
                  value={password}
                  onChange={(v) => { setPassword(v); setNeedsPassword(null); }}
                  problem={needsPassword}
                  hint={`Only if they have no account yet. At least ${MIN_PASSWORD} characters.`}
                  className="mt-1.5"
                />
              </div>
            </div>
            <Button type="submit" disabled={saving || !email.trim()} className="gap-2 min-h-[44px] rounded-xl">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
              Appoint {nameOf(venue)} admin
            </Button>
            <p className="text-xs font-sans text-muted-foreground">
              They sign in at <span className="font-medium text-foreground break-all">{staffSiteUrl(venue).replace(/^https?:\/\//, '')}/admin/login</span> with
              this email. You get a card to copy or share as soon as they are appointed.
            </p>
          </form>
        </CardContent>
      </Card>

      <LoginCard details={card} onDone={() => setCard(null)} />

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
                        action={adminActions}
                      />
                      <People
                        title="Waiters"
                        icon={Users}
                        people={here.filter((a) => a.kind === 'waiter' && !kitchenTablet(a))}
                        empty="No waiters yet. Add them under Waiters."
                        action={passwordButton}
                      />
                      <People
                        title="Kitchen screens"
                        icon={ChefHat}
                        people={here.filter(kitchenTablet)}
                        empty="No kitchen tablet yet. Add one under Waiters → Kitchen tablet."
                        action={passwordButton}
                      />
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
              <People title="Every restaurant" icon={Crown} people={owners} empty="No owner account." action={passwordButton} />
            </CardContent>
          </Card>
        </>
      ) : null}

      {/* A forgotten password: a new one, shown once on the card. The old
          one stops working at once; nothing else about them changes. */}
      <Dialog open={!!resetTarget} onOpenChange={(open) => { if (!open) closeReset(); }}>
        <DialogContent className="max-w-[calc(100vw-2rem)] sm:max-w-md rounded-2xl">
          <form onSubmit={(e) => void giveNewPassword(e)} noValidate className="space-y-4">
            <DialogHeader>
              <DialogTitle className="font-serif">New password for {resetTarget ? resetTarget.display_name ?? who(resetTarget) : ''}</DialogTitle>
              <DialogDescription>
                {resetTarget && <>{nameOf(resetTarget.venue)} · {resetTarget.kind === 'admin' ? 'admin' : kitchenTablet(resetTarget) ? 'kitchen tablet' : 'waiter'}. </>}
                Their old password stops working.
              </DialogDescription>
            </DialogHeader>
            <div>
              <Label htmlFor="team-reset-password" className="font-sans text-sm">New password</Label>
              <NewPasswordField
                id="team-reset-password"
                value={resetPassword}
                onChange={(v) => { setResetPassword(v); setResetProblem(null); }}
                problem={resetProblem}
                className="mt-1.5"
              />
            </div>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button type="button" variant="outline" onClick={closeReset}>Cancel</Button>
              <Button type="submit" disabled={resetting} className="gap-2">
                {resetting && <Loader2 className="w-4 h-4 animate-spin" />} Set new password
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AdminTeam;
