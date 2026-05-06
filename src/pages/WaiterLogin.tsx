import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { User, Lock, Loader2 } from 'lucide-react';

const synthEmail = (u: string) => `${u}@waiter.lasoul.local`;

const WaiterLogin = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const u = username.trim().toLowerCase().replace(/[^a-z0-9_.-]/g, '');
      if (!u) {
        toast.error('Enter your username');
        return;
      }
      const { data, error } = await supabase.auth.signInWithPassword({
        email: synthEmail(u),
        password,
      });
      if (error) throw error;

      const { data: waiter } = await supabase
        .from('waiters')
        .select('id, is_active')
        .eq('user_id', data.user.id)
        .maybeSingle();

      if (!waiter) {
        await supabase.auth.signOut();
        toast.error('No waiter profile linked to this account');
        return;
      }
      if (!waiter.is_active) {
        await supabase.auth.signOut();
        toast.error('Your account is inactive. Contact your manager.');
        return;
      }

      navigate('/waiter');
    } catch (err: any) {
      toast.error('Wrong username or password');
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
          </div>
          <div>
            <Label className="font-sans text-sm text-foreground">Password</Label>
            <div className="relative mt-1.5">
              <Lock className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                autoComplete="current-password"
                className="pl-9 h-12"
              />
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
