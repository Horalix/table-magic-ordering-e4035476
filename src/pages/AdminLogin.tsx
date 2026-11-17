import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase, supabaseConfigured, supabaseHost } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
import { useStaffDocument } from '@/components/staff/useStaffDocument';
import { HOME, STAFF_BRAND as BRAND } from '@/components/staff/staff-brand';

const AdminLogin = () => {
  useStaffDocument(`${HOME.name} admin sign in`);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;

      const [{ data: hasAdminRole }, { data: hasStaffRole }] = await Promise.all([
        supabase.rpc('has_role', { _user_id: data.user.id, _role: 'admin' }),
        supabase.rpc('has_role', { _user_id: data.user.id, _role: 'staff' }),
      ]);

      if (!hasAdminRole && !hasStaffRole) {
        await supabase.auth.signOut();
        /*
         * The password was right. The account simply has no role.
         *
         * This is the state every fresh install starts in — nothing seeds an
         * admin — and the old wording ("You do not have admin access") sent
         * people back to re-check a password that was never the problem. Say
         * which half of the login failed.
         */
        toast.error(
          'Password accepted, but this account is not a manager yet. ' +
          'Ask the owner to add it in Admin → Team.',
          { duration: 8000 },
        );
        return;
      }

      if (hasAdminRole) {
        navigate('/admin');
      } else if (hasStaffRole) {
        navigate('/kitchen');
      }
    } catch (err: unknown) {
      const raw = err instanceof Error ? err.message : 'Login failed';
      // "Failed to fetch" means the request never reached the server — offline,
      // VPN, or a blocker. Saying "login failed" here sends people hunting for
      // a password problem that doesn't exist.
      const isNetwork = /failed to fetch|networkerror|load failed/i.test(raw);
      if (isNetwork) console.error(`Supabase request failed. Host: ${supabaseHost}`);
      /*
       * A build with no Supabase URL falls back to an unroutable placeholder,
       * so every request fails exactly like a dead connection. Distinguishing
       * the two matters: one is fixed by a deploy setting, the other by wifi,
       * and the wrong message sends you to the wrong place for an hour.
       */
      if (isNetwork && !supabaseConfigured) {
        toast.error(
          'This build has no Supabase configuration. Set VITE_SUPABASE_URL and ' +
          'VITE_SUPABASE_PUBLISHABLE_KEY in the hosting environment and redeploy.',
          { duration: 12000 },
        );
        return;
      }
      // An unconfirmed address is the other common fresh-install failure, and
      // the provider's raw wording does not say what to do about it.
      const isUnconfirmed = /email not confirmed/i.test(raw);
      // "Invalid login credentials" — and a waiter who typed a username here
      // gets told where waiters sign in.
      const isWrong = /invalid login credentials|invalid_grant/i.test(raw);
      toast.error(
        isNetwork
          ? 'Cannot reach the server. Check your internet connection (or disable VPN/ad blocker) and try again.'
          : isUnconfirmed
            ? 'This address has never been confirmed. Confirm it in Supabase → Authentication, or create the account with auto-confirm on.'
            : isWrong
              ? 'Wrong email or password. Waiters and kitchen tablets sign in with a username at Staff sign-in, below.'
              : raw,
        { duration: isNetwork || isUnconfirmed || isWrong ? 8000 : 5000 },
      );
    } finally {
      setLoading(false);
    }

  };

  return (
    <div className="min-h-[100dvh] bg-background lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      {/* [ART] On a laptop, the restaurant's mark on its own colour beside the form:
          La Soul's sage, Vera Italia's dark. The same split as the admin behind it. */}
      <div className="hidden flex-col justify-between p-12 text-white lg:flex xl:p-16" style={{ backgroundColor: BRAND.background }}>
        <img src={BRAND.mark} alt={HOME.name} width={BRAND.width} height={BRAND.height} className="h-28 w-auto self-start object-contain" />
        <div>
          <p className="font-serif text-4xl font-semibold leading-tight">{HOME.name}</p>
          <p className="mt-2 font-sans text-base text-white/75">{HOME.tagline}</p>
        </div>
      </div>

      <main className="flex min-h-[100dvh] flex-col items-center justify-center pb-[calc(env(safe-area-inset-bottom)+2rem)] pl-[max(1.25rem,env(safe-area-inset-left))] pr-[max(1.25rem,env(safe-area-inset-right))] pt-[calc(env(safe-area-inset-top)+2rem)]">
        <div className="w-full max-w-sm">
          {/* On a phone, the mark as the app's icon would show it: the Manager app opens here. */}
          <div
            className="mb-6 grid h-20 w-20 place-items-center rounded-[22px] shadow-lux-lg lg:hidden"
            style={{ backgroundColor: BRAND.background }}
          >
            <img src={BRAND.mark} alt={HOME.name} width={BRAND.width} height={BRAND.height} className="h-14 w-14 object-contain" />
          </div>
          <h1 className="font-serif text-[1.75rem] font-bold leading-tight tracking-[-0.01em] text-foreground sm:text-3xl">{HOME.name} Admin</h1>
          <p className="mt-1.5 font-sans text-sm text-muted-foreground">Sign in to manage your restaurant</p>

          {/* Unmissable, because with no configuration nothing on any screen works. */}
          {!supabaseConfigured && (
            <div className="mt-5 rounded-xl bg-destructive p-4 font-sans text-sm text-destructive-foreground">
              <p className="font-semibold">This build is not connected to a database.</p>
              <p className="mt-1 opacity-90">
                VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY are missing from the hosting
                environment. Nothing will work until they are set and the site is redeployed —
                this is not a network problem.
              </p>
            </div>
          )}

          <form onSubmit={handleLogin} className="mt-6 space-y-4 rounded-2xl border border-border/80 bg-card p-5 shadow-lux sm:p-6">
            <div>
              <Label htmlFor="admin-login-email" className="font-sans text-sm text-foreground">Email</Label>
              <Input
                id="admin-login-email"
                type="email"
                inputMode="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={BRAND.adminEmail}
                required
                autoFocus
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                // 16px at every width: iPhone zooms the page into anything smaller.
                className="mt-1.5 h-12 md:text-base"
              />
            </div>
            <div>
              <Label htmlFor="admin-login-password" className="font-sans text-sm text-foreground">Password</Label>
              <div className="relative mt-1.5">
                <Input
                  id="admin-login-password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  autoComplete="current-password"
                  className="h-12 pr-12 md:text-base"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  aria-pressed={showPassword}
                  className="absolute right-0.5 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
                </button>
              </div>
            </div>
            <Button
              type="submit"
              disabled={loading || !email || !password}
              className="h-12 w-full gap-2 rounded-xl bg-primary font-sans text-base font-semibold text-primary-foreground"
            >
              {loading && <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />}
              {loading ? 'Signing in...' : 'Sign In'}
            </Button>
          </form>

          <div className="mt-5 space-y-1 font-sans text-[13px] leading-relaxed text-muted-foreground">
            <p>Forgot your password? The owner gives you a new one in Admin → Team.</p>
            <p>
              Waiter or kitchen tablet?{' '}
              <button
                type="button"
                onClick={() => navigate('/waiter/login')}
                className="-my-3 inline-flex min-h-[44px] items-center font-medium text-foreground underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Staff sign-in
              </button>
            </p>
          </div>
        </div>
      </main>
    </div>
  );
};

export default AdminLogin;
