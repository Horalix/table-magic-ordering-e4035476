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

  useEffect(() => {
    let cancelled = false;

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
      subscription.unsubscribe();
    };
  }, [allowed, navigate, redirectTo]);

  if (isAllowed === null) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  if (!isAllowed) return null;

  return <>{children}</>;
};

export default StaffGate;
