import React, { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { User, Lock, Loader2, Eye, EyeOff } from 'lucide-react';
import { useStaffDocument } from '@/components/staff/useStaffDocument';
import { HOME, STAFF_BRAND } from '@/components/staff/staff-brand';
import { afterWaiterSignIn, normalizeUsername } from '@/lib/staff-accounts';

const synthEmail = (u: string) => `${u}@waiter.lasoul.local`;

interface WaiterLoginSession {
  access_token: string;
  refresh_token: string;
}

interface WaiterLoginResponse {
  session?: WaiterLoginSession;
  error?: string;
}

/**
 * Something broke, as opposed to the credentials being wrong.
 *
 * Every failure used to end in "Wrong username or password", so a waiter
 * locked out by an outage retyped a correct password until someone senior
 * walked over. Telling them the truth costs nothing and saves the shift.
 */
class InfrastructureError extends Error {}

const WaiterLogin = () => {
  /*
   * The link on a login card (Admin → Waiters) fills in the username — ?u=
   * — so the person only types the password, and a kitchen tablet's link
   * (?to=kitchen) goes on to the kitchen screen.
   */
  const [params] = useSearchParams();
  const linkedUsername = normalizeUsername(params.get('u') ?? '');
  const destination = afterWaiterSignIn(params.get('to'));
  const [username, setUsername] = useState(linkedUsername);
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const navigate = useNavigate();
  const forKitchen = destination === '/kitchen';
  // A guest's Arabic choice must not mirror the staff sign-in on a shared device.
  useStaffDocument(`${HOME.name} ${forKitchen ? 'kitchen' : 'waiter'} sign in`);

  const setWaiterSessionFromFunction = async (u: string) => {
    const { data, error } = await supabase.functions.invoke<WaiterLoginResponse>('waiter-login', {
      body: { username: u, password },
    });

    // A transport failure is not a rejected password, and the DISTINCTION has
    // to survive so the final message can be honest about which happened.
    // The function answers a wrong password — and an account that is not an
    // active waiter's: a kitchen tablet's, a switched-off waiter's — with
    // 401, which supabase-js reports as an error like any other. That, and a
    // 404 (a project without the function), fall through to signing in
    // directly, which tells them apart. It used to be read as an outage:
    // "your password is probably fine" to someone who had mistyped it.
    if (error) {
      const context = (error as { context?: unknown }).context;
      const status = context instanceof Response ? context.status : null;
      if (status === 401 || status === 404) return false;
      throw new InfrastructureError('Could not reach the login service');
    }
    if (data?.error || !data?.session) {
      return false;
    }

    const { error: sessionError } = await supabase.auth.setSession({
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
    });

    if (sessionError) throw sessionError;
    return true;
  };

  const signInWithSyntheticEmail = async (u: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: synthEmail(u),
      password,
    });

    if (error) {
      // Supabase reports bad credentials with a specific message; anything
      // else here is the service, not the person standing at the till.
      if (/invalid login credentials|invalid_grant/i.test(error.message)) throw error;
      throw new InfrastructureError(error.message);
    }
    return data.user.id;
  };

  const getSignedInUserId = async () => {
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) throw error || new Error('Missing waiter session');
    return user.id;
  };

  /** Where this account goes now, or null if it may not sign in here. */
  const placeFor = async (userId: string): Promise<string | null> => {
    const { data: waiter, error } = await supabase
      .from('waiters')
      .select('id, is_active')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) throw error;

    if (!waiter) {
      // Staff with no waiter's row is a kitchen screen's account
      // (manage-admins); it belongs on the kitchen screen, not signed out.
      const { data: isStaff } = await supabase.rpc('has_role', { _user_id: userId, _role: 'staff' });
      if (isStaff) return '/kitchen';
      await supabase.auth.signOut();
      toast.error('No waiter profile linked to this account');
      return null;
    }

    if (!waiter.is_active) {
      await supabase.auth.signOut();
      toast.error('Your account is inactive. Contact your manager.');
      return null;
    }

    return destination;
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const u = normalizeUsername(username);
      if (!u) {
        toast.error('Enter your username');
        return;
      }

      const didUseServerLogin = await setWaiterSessionFromFunction(u);
      const userId = didUseServerLogin ? await getSignedInUserId() : await signInWithSyntheticEmail(u);
      const place = await placeFor(userId);

      if (!place) {
        return;
      }

      navigate(place, { replace: true });
    } catch (err) {
      console.error('Waiter login failed:', err);
      if (err instanceof InfrastructureError) {
        toast.error(`${err.message}. Your password is probably fine — check the connection or ask a manager.`);
      } else {
        toast.error('Wrong username or password');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-6" style={{ backgroundColor: STAFF_BRAND.background }}>
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <img src={STAFF_BRAND.mark} alt={HOME.name} width={STAFF_BRAND.width} height={STAFF_BRAND.height} className="w-auto h-24 mx-auto mb-4 object-contain" />
          <h1 className="font-serif text-2xl font-bold text-white">{forKitchen ? 'Kitchen Sign In' : 'Waiter Sign In'}</h1>
          <p className="text-sm text-white/70 font-sans mt-1">
            {linkedUsername ? 'Your username is filled in: type your password' : 'Use your username and password'}
          </p>
        </div>

        <form onSubmit={handleLogin} className="space-y-4 bg-card rounded-2xl p-6 shadow-xl">
          <div>
            <Label htmlFor="waiter-login-username" className="font-sans text-sm text-foreground">Username</Label>
            <div className="relative mt-1.5">
              <User className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="waiter-login-username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="e.g. john"
                required
                autoFocus={!linkedUsername}
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                className="pl-9 h-12"
              />
            </div>
            {/* Usernames are lower-cased and stripped. Showing the result stops
                a waiter retyping "Marko " forever without ever seeing why. */}
            {username && normalizeUsername(username) !== username && (
              <p className="text-xs text-muted-foreground font-sans mt-1">
                Signing in as <span className="font-medium text-foreground">{normalizeUsername(username)}</span>
              </p>
            )}
          </div>
          <div>
            <Label htmlFor="waiter-login-password" className="font-sans text-sm text-foreground">Password</Label>
            <div className="relative mt-1.5">
              <Lock className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="waiter-login-password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                autoFocus={!!linkedUsername}
                autoComplete="current-password"
                className="pl-9 pr-12 h-12"
              />
              {/* A shared phone with a greasy screen and a shift about to
                  start. Being able to see what you typed is not a luxury. */}
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                className="absolute right-1 top-1/2 -translate-y-1/2 w-11 h-11 flex items-center justify-center text-muted-foreground hover:text-foreground"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
          <Button
            type="submit"
            disabled={loading || !username || !password}
            className="w-full h-12 rounded-xl bg-primary text-primary-foreground font-sans font-semibold"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Sign In'}
          </Button>
          <p className="text-xs text-center text-muted-foreground font-sans">
            Forgot your password? Your manager gives you a new one in Admin → Waiters.
          </p>
          <p className="text-xs text-center text-muted-foreground font-sans">
            Manager? <button type="button" onClick={() => navigate('/admin/login')} className="underline">Admin login</button>
          </p>
        </form>
      </div>
    </div>
  );
};

export default WaiterLogin;
