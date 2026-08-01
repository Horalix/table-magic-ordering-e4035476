import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { User, Lock, Loader2, Eye, EyeOff } from 'lucide-react';

const synthEmail = (u: string) => `${u}@waiter.lasoul.local`;
const normalizeUsername = (value: string) =>
  value.trim().toLowerCase().replace(/[^a-z0-9_.-]/g, '');

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
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const navigate = useNavigate();

  const setWaiterSessionFromFunction = async (u: string) => {
    const { data, error } = await supabase.functions.invoke<WaiterLoginResponse>('waiter-login', {
      body: { username: u, password },
    });

    // A transport failure is not a rejected password. Falling through to the
    // synthetic-email path is correct here (it is the deployment without the
    // edge function), but the DISTINCTION has to survive so the final message
    // can be honest about which happened.
    if (error) throw new InfrastructureError('Could not reach the login service');
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

  const ensureActiveWaiterProfile = async (userId: string) => {
    const { data: waiter, error } = await supabase
      .from('waiters')
      .select('id, is_active')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) throw error;

    if (!waiter) {
      await supabase.auth.signOut();
      toast.error('No waiter profile linked to this account');
      return false;
    }

    if (!waiter.is_active) {
      await supabase.auth.signOut();
      toast.error('Your account is inactive. Contact your manager.');
      return false;
    }

    return true;
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
      const hasProfile = await ensureActiveWaiterProfile(userId);

      if (!hasProfile) {
        return;
      }

      navigate('/waiter', { replace: true });
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
    <div className="min-h-screen flex items-center justify-center px-6" style={{ backgroundColor: 'hsl(140, 12%, 53%)' }}>
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <img
            src="/lasoul-logo.svg"
            alt="La Soul"
            className="w-20 h-20 object-contain brightness-0 invert mx-auto mb-4"
          />
          <h1 className="font-serif text-2xl font-bold text-white">Waiter Sign In</h1>
          <p className="text-sm text-white/70 font-sans mt-1">Use your username and password</p>
        </div>

        <form onSubmit={handleLogin} className="space-y-4 bg-card rounded-2xl p-6 shadow-xl">
          <div>
            <Label className="font-sans text-sm text-foreground">Username</Label>
            <div className="relative mt-1.5">
              <User className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="e.g. john"
                required
                autoFocus
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
            <Label className="font-sans text-sm text-foreground">Password</Label>
            <div className="relative mt-1.5">
              <Lock className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
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
            Manager? <button type="button" onClick={() => navigate('/admin/login')} className="underline">Admin login</button>
          </p>
        </form>
      </div>
    </div>
  );
};

export default WaiterLogin;
