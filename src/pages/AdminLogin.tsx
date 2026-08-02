import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase, supabaseConfigured, supabaseHost } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';

const AdminLogin = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
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
      toast.error(
        isNetwork
          ? 'Cannot reach the server. Check your internet connection (or disable VPN/ad blocker) and try again.'
          : isUnconfirmed
            ? 'This address has never been confirmed. Confirm it in Supabase → Authentication, or create the account with auto-confirm on.'
            : raw,
        { duration: isNetwork || isUnconfirmed ? 8000 : 5000 },
      );
    } finally {
      setLoading(false);
    }

  };

  return (
    <div className="min-h-screen flex items-center justify-center px-6" style={{ backgroundColor: 'hsl(140, 12%, 53%)' }}>
      <div className="w-full max-w-sm">
        {/* [ART] Logo + branding on sage background */}
        <div className="text-center mb-8">
          <img
            src="/lasoul-logo.svg"
            alt="La Soul"
            className="w-20 h-20 object-contain brightness-0 invert mx-auto mb-4"
          />
          <h1 className="font-serif text-2xl font-bold text-white">La Soul Admin</h1>
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
            <Label className="font-sans text-sm text-foreground">Email</Label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@lasoul.net"
              required
              autoFocus
              className="mt-1.5"
            />
          </div>
          <div>
            <Label className="font-sans text-sm text-foreground">Password</Label>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              className="mt-1.5"
            />
          </div>
          <Button
            type="submit"
            disabled={loading || !email || !password}
            className="w-full h-12 rounded-xl bg-primary text-primary-foreground font-sans font-semibold"
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </Button>
        </form>
      </div>
    </div>
  );
};

export default AdminLogin;
