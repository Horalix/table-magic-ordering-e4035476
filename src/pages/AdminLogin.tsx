import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
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

      const { data: roles, error: roleError } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', data.user.id);

      if (roleError || !roles || roles.length === 0) {
        await supabase.auth.signOut();
        toast.error('You do not have admin access.');
        return;
      }

      const userRole = roles[0].role;
      if (userRole === 'admin') {
        navigate('/admin');
      } else if (userRole === 'staff') {
        navigate('/kitchen');
      }
    } catch (err: any) {
      toast.error(err.message || 'Login failed');
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
