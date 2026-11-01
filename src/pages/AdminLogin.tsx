import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase, supabaseConfigured, supabaseHost } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { Eye, EyeOff } from 'lucide-react';
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
          'Password accepted, but this account has no admin or staff role yet. ' +
          'It needs a row in user_roles before it can sign in here.',
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
    <div className="min-h-screen flex items-center justify-center px-6" style={{ backgroundColor: BRAND.background }}>
      <div className="w-full max-w-sm">
        {/* [ART] The restaurant's mark on its own colour: La Soul's sage, Vera Italia's dark. */}
        <div className="text-center mb-8">
          <img src={BRAND.mark} alt={HOME.name} width={BRAND.width} height={BRAND.height} className="w-auto h-24 mx-auto mb-4 object-contain" />
          <h1 className="font-serif text-2xl font-bold text-white">{HOME.name} Admin</h1>
          <p className="text-sm text-white/60 font-sans mt-1">Sign in to manage your restaurant</p>
        </div>

        {/* Unmissable, because with no configuration nothing on any screen works. */}
        {!supabaseConfigured && (
          <div className="mb-4 rounded-xl bg-destructive text-destructive-foreground p-4 text-sm font-sans">
            <p className="font-semibold">This build is not connected to a database.</p>
            <p className="mt-1 opacity-90">
              VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY are missing from the hosting
              environment. Nothing will work until they are set and the site is redeployed —
              this is not a network problem.
            </p>
          </div>
        )}

        <form onSubmit={handleLogin} className="space-y-4 bg-card rounded-2xl p-6 shadow-xl">
          <div>
            <Label htmlFor="admin-login-email" className="font-sans text-sm text-foreground">Email</Label>
            <Input
              id="admin-login-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={BRAND.adminEmail}
              required
              autoFocus
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              className="mt-1.5"
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
                className="pr-12"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                className="absolute right-0 top-1/2 -translate-y-1/2 w-11 h-11 flex items-center justify-center text-muted-foreground hover:text-foreground"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
          <Button
            type="submit"
            disabled={loading || !email || !password}
            className="w-full h-12 rounded-xl bg-primary text-primary-foreground font-sans font-semibold"
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </Button>
          <p className="text-xs text-center text-muted-foreground font-sans">
            Forgot your password? The owner gives you a new one in Admin → Team.
          </p>
          <p className="text-xs text-center text-muted-foreground font-sans">
            Waiter or kitchen tablet? <button type="button" onClick={() => navigate('/waiter/login')} className="underline">Staff sign-in</button>
          </p>
        </form>
      </div>
    </div>
  );
};

export default AdminLogin;
