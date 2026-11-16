import React, { useRef, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChefHat, Copy, Crown, Loader2, LockKeyhole, ShieldCheck, Trash2, UserMinus, UserPlus, Users, UserX } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import LoginCard from '@/components/admin/LoginCard';
import NewPasswordField from '@/components/admin/NewPasswordField';
import { AdminPageHeader } from '@/components/admin/AdminPage';
import { AdminCard, AdminCardContent, AdminCardHeader } from '@/components/admin/AdminCard';
import {
  isKitchenTablet, lastSignInWords, MIN_PASSWORD, plainRefusal, readRefusal, refusalField, staffSiteUrl,
  teamSignInsText, type LoginDetails, type TeamAccount,
} from '@/lib/staff-accounts';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { VENUES } from '@/lib/venues';
import type { AdminOutletContext } from '@/components/admin/AdminLayout';

/**
 * The owner's team: who runs each restaurant (supabase/functions/manage-admins).
 *
 * Every admin, waiter and kitchen account, by restaurant. The owner appoints
 * a restaurant's admin by email, for one restaurant or both — one person may
 * run both, and switches between them at the top of the admin menu
 * (20261106120000_admin_of_both_restaurants.sql). An account that exists gets the role; a
 * new one is created with the initial password typed here, which goes to
 * Supabase Auth and nowhere else, and which the new admin changes after
 * signing in (Admin menu → Change password). The login card says where
 * (their restaurant's own site) and shows that password once. Waiters and
 * kitchen tablets are added under Waiters, as before.
 *
 * Every row has a Password button: anyone on the team who forgot theirs gets
 * a new one here, shown once on the login card (manage-admins
 * reset_password). The owner's own row opens Change password instead, which
 * asks for the current one. Passwords themselves are never shown: Supabase
 * keeps them scrambled, so there is nothing to show.
 *
 * Every row but the owner's own has Remove (manage-admins remove): the
 * account's sign-in is deleted for good, with every role it holds at both
 * restaurants — an admin, a waiter, a kitchen tablet, another owner. Orders,
 * bills and history stay. An admin's Remove also offers the old Revoke: stop
 * running that one restaurant and keep the account. Sign-ins left with no role
 * at all (a revoked admin, say) are listed on their own, to be removed.
 *
 * Copy all sign-ins copies the whole list — who, what they type, the address
 * they open, never a password (teamSignInsText).
 *
 * Layout: the people first, by restaurant, then the owner and any sign-in
 * with no role; the appoint form beside them on a laptop, under them on a
 * phone. Add an admin, at the top, goes to the form.
 */

type Account = TeamAccount;

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

/** The Team form's third choice: one person runs every restaurant (20261106120000_admin_of_both_restaurants.sql). */
const BOTH = 'both';

const who = (a: Account) => a.email ?? (a.username ? `@${a.username}` : 'Unknown account');
const personOf = (a: Account) => a.display_name ?? who(a);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const initials = (a: Account) => {
  const words = personOf(a).replace(/^@/, '').split(/[\s@.]+/).filter(Boolean);
  return (a.display_name ? words.slice(0, 2).map((w) => w[0]).join('') : (words[0]?.[0] ?? '?')).toUpperCase();
};

/**
 * Who gets a Password button: a restaurant's admin (signs in with their
 * email), a waiter or a kitchen tablet (with their username). A kitchen
 * account made by hand has no username, so no sign-in the card could point
 * to; an owner changes their own; a sign-in with no role opens nothing.
 */
const resettable = (a: Account) =>
  (a.kind === 'admin' && !!a.email) || (a.kind !== 'owner' && a.kind !== 'none' && !!a.username);

/** The login card after a new password. */
function resetCard(a: Account, venueName: string, password: string): LoginDetails {
  const kind = a.kind === 'admin' ? 'admin' : isKitchenTablet(a) ? 'kitchen' : 'waiter';
  const username = (kind === 'admin' ? a.email : a.username) ?? '';
  return {
    kind, venueSlug: a.venue ?? '', venueName, name: kind === 'admin' ? username : a.display_name ?? username,
    username, password, event: 'reset',
  };
}

/** One group of people in a card: a small label (when given), then a row each. */
const People = ({ title, icon: Icon, people, empty, action }: {
  title?: string;
  icon?: React.ElementType;
  people: Account[];
  empty: string;
  action?: (a: Account) => React.ReactNode;
}) => (
  <div>
    {title && (
      <p className="mb-1 flex items-center gap-1.5 text-[11px] font-sans font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        {Icon && <Icon className="h-3.5 w-3.5" aria-hidden />} {title}
        {people.length > 0 && <span className="font-medium tabular-nums tracking-normal text-muted-foreground/80">· {people.length}</span>}
      </p>
    )}
    {people.length === 0 ? (
      <p className="py-2 text-sm font-sans text-muted-foreground">{empty}</p>
    ) : (
      <ul className="divide-y divide-border/70">
        {people.map((a) => {
          // Who they sign in as, under a name, and when they last did.
          const sub = [a.display_name ? who(a) : null, lastSignInWords(a.last_sign_in_at)].filter(Boolean).join(' · ');
          return (
            <li key={`${a.user_id}-${a.kind}`} className="flex min-h-[44px] items-center gap-3 py-2.5">
              <span
                className={cn(
                  'hidden h-8 w-8 shrink-0 place-items-center rounded-full text-[11px] font-sans font-semibold sm:grid',
                  a.you ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground',
                )}
                aria-hidden
              >
                {isKitchenTablet(a) ? <ChefHat className="h-3.5 w-3.5" /> : initials(a)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-sans font-medium text-foreground">
                  {personOf(a)}
                  {a.you && <span className="ml-1.5 text-xs font-normal text-muted-foreground">(you)</span>}
                </p>
                {sub && <p className="truncate text-xs font-sans text-muted-foreground">{sub}</p>}
              </div>
              {action?.(a)}
            </li>
          );
        })}
      </ul>
    )}
  </div>
);

const AdminTeam = () => {
  const context = useOutletContext<AdminOutletContext | null>();
  const [email, setEmail] = useState('');
  /** The restaurant the new admin will run, or BOTH. */
  const [venue, setVenue] = useState<string>(() => context?.venueSlug ?? Object.keys(VENUES)[0]);
  const [password, setPassword] = useState('');
  const [needsPassword, setNeedsPassword] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [card, setCard] = useState<LoginDetails | null>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const formCard = useRef<HTMLDivElement>(null);
  const [resetTarget, setResetTarget] = useState<Account | null>(null);
  const [resetPassword, setResetPassword] = useState('');
  const [resetProblem, setResetProblem] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<Account | null>(null);
  const [removing, setRemoving] = useState<'remove' | 'revoke' | null>(null);

  const { data, error, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['owner-team'],
    queryFn: () => callTeam<TeamList>({ action: 'list' }),
    staleTime: 0,
    retry: false,
  });

  const venues = data?.venues?.length ? data.venues : Object.values(VENUES).map(({ slug, name }) => ({ slug, name }));
  const nameOf = (slug: string | null) => venues.find((v) => v.slug === slug)?.name ?? VENUES[slug ?? '']?.name ?? slug ?? '';
  const accounts = data?.accounts ?? [];
  const chosen = venue === BOTH ? venues.map((v) => v.slug) : [venue];
  const chosenNames = chosen.map(nameOf).join(' & ');

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
      const result = await callTeam<Appointed>({
        action: 'appoint',
        email: address,
        ...(chosen.length > 1 ? { venues: chosen } : { venue: chosen[0] }),
        password: password || undefined,
      }).catch((err: unknown) => {
        // A manage-admins from before both restaurants reads only `venue`.
        if (chosen.length > 1 && err instanceof TeamError && /choose the restaurant/i.test(err.message)) {
          throw new TeamError('The server cannot appoint both restaurants yet: the manage-admins function needs redeploying.');
        }
        throw err;
      });
      // The password has gone to Supabase Auth; the card shows it once, and
      // it is not kept anywhere here either.
      setPassword('');
      setEmail('');
      if (result.already) {
        toast.success(`${address} is already the admin of ${chosenNames}`);
      } else {
        setCard({
          kind: 'admin', venueSlug: chosen[0], venueName: chosenNames, name: address, username: address,
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

  /** An admin stops running that one restaurant; the account and its other roles stay. */
  const revoke = async (a: Account) => {
    setRemoving('revoke');
    try {
      await callTeam({ action: 'revoke', user_id: a.user_id, venue: a.venue });
      setRemoveTarget(null);
      toast.success(`${who(a)} no longer runs ${nameOf(a.venue)}`);
      await refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not revoke');
    } finally {
      setRemoving(null);
    }
  };

  /** The account's sign-in, deleted for good, with every role it holds. */
  const removeAccount = async (a: Account) => {
    setRemoving('remove');
    try {
      const result = await callTeam<{ removed?: boolean; warning?: string }>({ action: 'remove', user_id: a.user_id });
      setRemoveTarget(null);
      if (result?.warning) toast.warning(result.warning);
      else toast.success(`${personOf(a)} is removed: that sign-in no longer works`);
      await refetch();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not remove the account';
      // A manage-admins from before remove does not know the action.
      toast.error(/unknown action/i.test(message)
        ? 'The server cannot do this yet: the manage-admins function needs redeploying.'
        : message);
    } finally {
      setRemoving(null);
    }
  };

  /** What one row of the account does, for the Remove dialog. */
  const roleWords = (x: Account) => x.kind === 'owner'
    ? 'owner of every restaurant'
    : x.kind === 'none'
      ? 'no role: it signs in and opens nothing'
      : `${nameOf(x.venue)} ${x.kind === 'admin' ? 'admin' : isKitchenTablet(x) ? 'kitchen tablet' : 'waiter'}`;
  /** Everything that account does, at both restaurants: Remove takes all of it. */
  const everythingOf = (a: Account) => {
    const words = [...new Set(accounts.filter((x) => x.user_id === a.user_id).map(roleWords))];
    const all = (words.length ? words : [roleWords(a)]).join(' · ');
    return all.charAt(0).toUpperCase() + all.slice(1);
  };

  // On a phone the row's buttons are icons only, each a full 44 px tap, so
  // both fit beside a name at 360 px; their labels come back from sm up.
  const rowButton = 'gap-1.5 min-h-[44px] min-w-[44px] px-2.5 sm:min-h-[40px] sm:px-3 shrink-0';

  const removeButton = (a: Account) => (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => setRemoveTarget(a)}
      className={`${rowButton} text-destructive hover:bg-destructive/10 hover:text-destructive`}
      aria-label={`Remove ${personOf(a)}`}
    >
      <Trash2 className="w-4 h-4" aria-hidden /> <span className="hidden sm:inline">Remove</span>
    </Button>
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
        <Button variant="outline" size="sm" onClick={context.changePassword} className={rowButton} aria-label="Change password">
          <LockKeyhole className="w-4 h-4" aria-hidden /> <span className="hidden sm:inline">Change password</span>
        </Button>
      ) : null;
    }
    if (!resettable(a)) return null;
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={() => { setResetTarget(a); setResetPassword(''); setResetProblem(null); }}
        className={rowButton}
        aria-label={`New password for ${a.display_name ?? who(a)}`}
      >
        <LockKeyhole className="w-4 h-4" aria-hidden /> <span className="hidden sm:inline">Password</span>
      </Button>
    );
  };

  /** Password (or, on your own row, Change password), and Remove on everyone's but yours. */
  const rowActions = (a: Account) => (
    <div className="flex items-center gap-1.5 shrink-0 sm:gap-2">
      {passwordButton(a)}
      {!a.you && removeButton(a)}
    </div>
  );

  const owners = accounts.filter((a) => a.kind === 'owner');
  const noRole = accounts.filter((a) => a.kind === 'none');
  const signIns = new Set(accounts.map((a) => a.user_id)).size;

  const copyAll = async () => {
    const text = teamSignInsText(venues, accounts);
    const people = new Set(accounts.map((a) => a.user_id)).size;
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`Copied ${people} sign-in${people === 1 ? '' : 's'}, without passwords`);
    } catch {
      toast.error('This browser would not copy. Try again, or from a laptop.');
    }
  };

  /** The form is under the people: take the owner to it, ready to type. */
  const goToForm = () => {
    formCard.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    emailRef.current?.focus({ preventScroll: true });
  };

  const appointForm = (
    <AdminCard ref={formCard} className="scroll-mt-20">
      <AdminCardHeader
        icon={UserPlus}
        title="Appoint a restaurant admin"
        description="They run one restaurant, or both, and sign in with their email."
      />
      <AdminCardContent>
        <form onSubmit={appoint} className="space-y-4">
          <div>
            <Label htmlFor="team-email" className="font-sans text-sm">Their email</Label>
            <Input
              id="team-email"
              ref={emailRef}
              type="email"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              value={email}
              onChange={(e) => { setEmail(e.target.value); setNeedsPassword(null); }}
              placeholder="name@example.com"
              required
              className="mt-1.5 h-11"
            />
          </div>
          <div>
            <Label id="team-venue" className="font-sans text-sm">Restaurant they will run</Label>
            <div
              role="group"
              aria-labelledby="team-venue"
              className="mt-1.5 grid gap-1 rounded-xl bg-muted/70 p-1"
              style={{ gridTemplateColumns: `repeat(${venues.length + 1}, minmax(0, 1fr))` }}
            >
              {[...venues, { slug: BOTH, name: 'Both' }].map((v) => (
                <button
                  key={v.slug}
                  type="button"
                  aria-pressed={venue === v.slug}
                  onClick={() => setVenue(v.slug)}
                  className={cn(
                    'min-h-11 truncate rounded-lg px-2 text-sm font-sans transition-colors sm:min-h-10',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    venue === v.slug ? 'bg-background font-semibold text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                  )}
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
          <Button type="submit" disabled={saving || !email.trim()} className="h-auto min-h-11 w-full gap-2 whitespace-normal py-2.5">
            {saving ? <Loader2 className="w-4 h-4 shrink-0 animate-spin motion-reduce:animate-none" /> : <ShieldCheck className="w-4 h-4 shrink-0" />}
            Appoint {chosenNames} admin
          </Button>
        </form>
        <div className="mt-4 space-y-1.5 rounded-xl bg-muted/50 px-4 py-3 text-xs font-sans leading-relaxed text-muted-foreground">
          <p>
            They sign in at{' '}
            {chosen.map((slug, i) => (
              <span key={slug}>
                {i > 0 && ' or '}
                <span className="font-medium text-foreground break-all">{staffSiteUrl(slug).replace(/^https?:\/\//, '')}/admin/login</span>
              </span>
            ))}{' '}
            with this email{chosen.length > 1 ? ', and switch between the two restaurants at the top of the admin menu' : ''}.
          </p>
          <p>
            You get a card to copy or share as soon as they are appointed. An initial password is shown on it once; ask them to change it after signing in.
          </p>
        </div>
      </AdminCardContent>
    </AdminCard>
  );

  const ownerCard = data && (
    <AdminCard>
      <AdminCardHeader icon={Crown} title="Owner" description="Every restaurant, every page, and this one." />
      <AdminCardContent>
        <People people={owners} empty="No owner account." action={rowActions} />
      </AdminCardContent>
    </AdminCard>
  );

  return (
    <div className="mx-auto w-full max-w-6xl">
      <AdminPageHeader
        title="Team"
        description="Who runs each restaurant, and every sign-in. Only you, the owner, see this page."
        actions={(
          <>
            <Button variant="outline" onClick={() => void copyAll()} disabled={!data} className="h-11 gap-2 sm:h-10">
              <Copy className="w-4 h-4" aria-hidden /> Copy all sign-ins
            </Button>
            <Button onClick={goToForm} className="h-11 gap-2 sm:h-10">
              <UserPlus className="w-4 h-4" aria-hidden /> Add an admin
            </Button>
          </>
        )}
      >
        <div className="flex max-w-3xl items-start gap-2.5 rounded-xl border border-border/70 bg-card/60 px-3.5 py-2.5 text-xs font-sans leading-relaxed text-muted-foreground">
          <LockKeyhole className="mt-0.5 h-3.5 w-3.5 shrink-0 text-foreground/70" aria-hidden />
          <p>
            Passwords can't be shown, not even here: they are stored scrambled. Password (the lock) gives someone a new one,
            shown once on a card for you to send them.
            {data && signIns > 0 && <span className="text-foreground/80"> {plural(signIns, 'sign-in')} in all.</span>}
          </p>
        </div>
      </AdminPageHeader>

      {error && (
        <div className="mb-6">
          <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm font-sans text-destructive">
            Could not load the team: {error.message}. The manage-admins function may not be deployed yet.
          </p>
          <Button variant="outline" disabled={isFetching} onClick={() => { void refetch(); }} className="mt-3 h-11 gap-2 sm:h-10">
            {isFetching && <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />} Try again
          </Button>
        </div>
      )}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-6">
          {isLoading ? (
            venues.map((v) => (
              <AdminCard key={v.slug} className="p-5 sm:p-6" aria-busy="true" aria-label={`Loading ${v.name}`}>
                <Skeleton className="h-6 w-40" />
                <Skeleton className="mt-2 h-4 w-56" />
                <div className="mt-6 space-y-3">
                  {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-11 w-full rounded-lg" />)}
                </div>
              </AdminCard>
            ))
          ) : data ? (
            <>
              {/* min-w-0 all the way down: without it a phone's one column
                  grows to the longest name, and the cards run off the screen. */}
              {venues.map((v) => {
                const here = accounts.filter((a) => a.venue === v.slug);
                const admins = here.filter((a) => a.kind === 'admin');
                const waiters = here.filter((a) => a.kind === 'waiter' && !isKitchenTablet(a));
                const kitchens = here.filter(isKitchenTablet);
                const counts = [plural(admins.length, 'admin'), plural(waiters.length, 'waiter'), plural(kitchens.length, 'kitchen screen')].join(' · ');
                return (
                  <section key={v.slug} aria-label={`${v.name} team`} className="min-w-0">
                    <AdminCard>
                      <AdminCardHeader title={v.name} description={counts} />
                      <AdminCardContent className="space-y-5">
                        <People
                          title="Admins"
                          icon={ShieldCheck}
                          people={admins}
                          empty="No admin of its own yet: you run it."
                          action={rowActions}
                        />
                        <People
                          title="Waiters"
                          icon={Users}
                          people={waiters}
                          empty="No waiters yet. Add them under Waiters."
                          action={rowActions}
                        />
                        <People
                          title="Kitchen screens"
                          icon={ChefHat}
                          people={kitchens}
                          empty="No kitchen tablet yet. Add one under Waiters → Kitchen tablet."
                          action={rowActions}
                        />
                      </AdminCardContent>
                    </AdminCard>
                  </section>
                );
              })}

              {ownerCard}

              {noRole.length > 0 && (
                <section aria-label="Sign-ins with no role" className="min-w-0">
                  <AdminCard>
                    <AdminCardHeader
                      icon={UserX}
                      tone="muted"
                      title="Sign-ins with no role"
                      description="These still sign in, but open nothing: an admin whose role was revoked, or a waiter whose sign-in stayed behind. Remove them, or appoint one by their email."
                    />
                    <AdminCardContent>
                      <People people={noRole} empty="" action={rowActions} />
                    </AdminCardContent>
                  </AdminCard>
                </section>
              )}
            </>
          ) : null}
        </div>

        <div className="min-w-0 lg:sticky lg:top-6">
          {appointForm}
        </div>
      </div>

      <LoginCard details={card} onDone={() => setCard(null)} />

      {/* Remove: the sign-in goes for good, with everything it does at both
          restaurants. An admin's row also offers the old Revoke. */}
      <AlertDialog open={!!removeTarget} onOpenChange={(open) => { if (!open && !removing) setRemoveTarget(null); }}>
        <AlertDialogContent className="max-w-[calc(100vw-2rem)] sm:max-w-md rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {removeTarget ? personOf(removeTarget) : ''}?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                {removeTarget && <p className="font-medium text-foreground">{everythingOf(removeTarget)}.</p>}
                <p>
                  Their sign-in is deleted for good, with all of that. They lose access at once.
                  Orders, bills and history stay.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <Button type="button" variant="outline" disabled={!!removing} onClick={() => setRemoveTarget(null)} className="h-11 sm:h-10">
              Keep them
            </Button>
            {removeTarget?.kind === 'admin' && (
              <Button
                type="button"
                variant="outline"
                disabled={!!removing}
                onClick={() => removeTarget && void revoke(removeTarget)}
                className="h-11 gap-2 sm:h-10"
              >
                {removing === 'revoke' ? <Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none" /> : <UserMinus className="w-4 h-4" />}
                Only stop running {nameOf(removeTarget.venue)}
              </Button>
            )}
            <Button
              type="button"
              disabled={!!removing}
              onClick={() => removeTarget && void removeAccount(removeTarget)}
              className="h-11 gap-2 bg-destructive text-destructive-foreground hover:bg-destructive/90 sm:h-10"
            >
              {removing === 'remove' ? <Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none" /> : <Trash2 className="w-4 h-4" />}
              Remove account
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* A forgotten password: a new one, shown once on the card. The old
          one stops working at once; nothing else about them changes. */}
      <Dialog open={!!resetTarget} onOpenChange={(open) => { if (!open) closeReset(); }}>
        <DialogContent className="max-w-[calc(100vw-2rem)] sm:max-w-md rounded-2xl">
          <form onSubmit={(e) => void giveNewPassword(e)} noValidate className="space-y-4">
            <DialogHeader className="pe-8 text-start">
              <DialogTitle className="font-serif">New password for {resetTarget ? resetTarget.display_name ?? who(resetTarget) : ''}</DialogTitle>
              <DialogDescription>
                {resetTarget && <>{nameOf(resetTarget.venue)} · {resetTarget.kind === 'admin' ? 'admin' : isKitchenTablet(resetTarget) ? 'kitchen tablet' : 'waiter'}. </>}
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
              <p className="mt-2 text-xs font-sans text-muted-foreground">
                Next you get a card with it, to copy or send to them. It is shown there once.
              </p>
            </div>
            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" onClick={closeReset} className="h-11 sm:h-10">Cancel</Button>
              <Button type="submit" disabled={resetting} className="h-11 gap-2 sm:h-10">
                {resetting && <Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none" />} Set new password
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AdminTeam;
