import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';

type AppRole = Database['public']['Enums']['app_role'];

interface StaffGateProps {
  children: React.ReactNode;
  allowed?: AppRole[];
  redirectTo?: string;
}

const DEFAULT_ALLOWED_ROLES: AppRole[] = ['admin', 'staff'];

const StaffGate = ({ children, allowed = DEFAULT_ALLOWED_ROLES, redirectTo = '/admin/login' }: StaffGateProps) => {
  const navigate = useNavigate();
  const [isAllowed, setIsAllowed] = useState<boolean | null>(null);
  const [unreachable, setUnreachable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let retry: number | undefined;

    const checkAccess = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        if (!cancelled) setIsAllowed(false);
        navigate(redirectTo, { replace: true });
        return;
      }

      const roleChecks = await Promise.all(
        allowed.map((role) =>
          supabase.rpc('has_role', {
            _user_id: session.user.id,
            _role: role,
          }),
        ),
      );
      const hasAllowedRole = roleChecks.some(({ data }) => data === true);
      /*
       * A check that could not be asked is not a "no". On flaky wifi a reload
       * used to land a signed-in waiter or the kitchen tablet on the sign-in
       * page, where nobody can sign in without the network either. Stay, say
       * so, and ask again.
       */
      if (!hasAllowedRole && roleChecks.some(({ error }) => !!error)) {
        if (!cancelled) {
          setUnreachable(true);
          retry = window.setTimeout(() => { void checkAccess(); }, 5000);
        }
        return;
      }
      if (!cancelled) setUnreachable(false);
      if (!hasAllowedRole) {
        if (!cancelled) setIsAllowed(false);
        navigate(redirectTo, { replace: true });
        return;
      }

      if (!cancelled) setIsAllowed(true);
    };

    checkAccess();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        setIsAllowed(false);
        navigate(redirectTo, { replace: true });
      }
    });

    return () => {
      cancelled = true;
      window.clearTimeout(retry);
      subscription.unsubscribe();
    };
  }, [allowed, navigate, redirectTo]);

  if (isAllowed === null) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-4 px-6 text-center">
        <div className="w-6 h-6 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
        {unreachable && (
          <p role="status" className="max-w-xs text-sm font-sans text-muted-foreground">
            Cannot reach the server. Check the wifi — this screen opens by itself once it is back.
          </p>
        )}
      </div>
    );
  }

  if (!isAllowed) return null;

  return <>{children}</>;
};

export default StaffGate;
