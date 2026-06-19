import React, { useEffect, useState } from 'react';
import { useNavigate, Outlet, Link, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { supabase } from '@/integrations/supabase/client';
import {
  LayoutDashboard, UtensilsCrossed, TableProperties, ClipboardList,
  BarChart3, QrCode, LogOut, ChefHat, Menu, X, Layers, Users, Star, Monitor, CalendarCheck
} from 'lucide-react';
import { toast } from 'sonner';
import { springPill } from '@/lib/motion';
import type { User } from '@supabase/supabase-js';

// Grouped so the sidebar reads as a hierarchy, not a flat list.
const navGroups = [
  {
    heading: 'Operations',
    items: [
      { label: 'Dashboard', icon: LayoutDashboard, path: '/admin' },
      { label: 'Tonight', icon: CalendarCheck, path: '/admin/tonight' },
      { label: 'Orders', icon: ClipboardList, path: '/admin/orders' },
      { label: 'Tables', icon: TableProperties, path: '/admin/tables' },
      { label: 'Floor Monitor', icon: Monitor, path: '/waiter/monitor' },
      { label: 'Kitchen', icon: ChefHat, path: '/kitchen' },
    ],
  },
  {
    heading: 'Menu & Setup',
    items: [
      { label: 'Menu', icon: UtensilsCrossed, path: '/admin/menu' },
      { label: 'Sections', icon: Layers, path: '/admin/sections' },
      { label: 'Waiters', icon: Users, path: '/admin/waiters' },
      { label: 'QR Codes', icon: QrCode, path: '/admin/qr-codes' },
    ],
  },
  {
    heading: 'Insights',
    items: [
      { label: 'Performance', icon: Star, path: '/admin/performance' },
      { label: 'Analytics', icon: BarChart3, path: '/admin/analytics' },
    ],
  },
];

const AdminLayout = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [authChecked, setAuthChecked] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const checkAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        if (!cancelled) setAuthChecked(true);
        navigate('/admin/login');
        return;
      }

      const { data: hasAdminRole } = await supabase.rpc('has_role', {
        _user_id: session.user.id,
        _role: 'admin',
      });

      if (!hasAdminRole) {
        await supabase.auth.signOut();
        if (!cancelled) setAuthChecked(true);
        navigate('/admin/login');
        toast.error('Unauthorized access');
        return;
      }

      if (!cancelled) {
        setUser(session.user);
        setAuthChecked(true);
      }
    };

    checkAuth();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') navigate('/admin/login');
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [navigate]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate('/admin/login');
  };

  if (!authChecked) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <div className="min-h-screen bg-background flex">
      {/* Mobile menu button */}
      <button
        onClick={() => setSidebarOpen(!sidebarOpen)}
        aria-label={sidebarOpen ? 'Close admin navigation' : 'Open admin navigation'}
        aria-expanded={sidebarOpen}
        className="lg:hidden fixed top-4 left-4 z-50 p-2 rounded-lg bg-card border border-border shadow-sm"
      >
        {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
      </button>

      {/* Sidebar */}
      <aside className={`
        fixed lg:static inset-y-0 left-0 z-40 w-64 bg-sidebar border-r border-sidebar-border
        transform transition-transform duration-200
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
      `}>
        <div className="flex flex-col h-full">
          <div className="px-6 py-6 border-b border-sidebar-border">
            <h1 className="font-serif text-xl font-bold text-sidebar-foreground">La Soul</h1>
            <p className="text-xs text-sidebar-foreground/60 font-sans mt-0.5">Admin Dashboard</p>
          </div>

          <nav className="flex-1 px-3 py-4 overflow-y-auto space-y-4">
            {navGroups.map((group) => (
              <div key={group.heading} className="space-y-1">
                <p className="px-3 mb-1 text-[10px] font-sans font-semibold uppercase tracking-[0.14em] text-sidebar-foreground/40">
                  {group.heading}
                </p>
                {group.items.map((item) => {
                  const isActive = location.pathname === item.path;
                  return (
                    <Link
                      key={item.path}
                      to={item.path}
                      onClick={() => setSidebarOpen(false)}
                      className={`relative flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-sans transition-colors ${
                        isActive
                          ? 'text-sidebar-accent-foreground font-medium'
                          : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/40 hover:text-sidebar-foreground'
                      }`}
                    >
                      {isActive && (
                        <motion.span
                          layoutId="admin-nav-active"
                          transition={springPill}
                          className="absolute inset-0 rounded-lg bg-sidebar-accent"
                        />
                      )}
                      <item.icon className="relative z-10 w-4 h-4" />
                      <span className="relative z-10">{item.label}</span>
                    </Link>
                  );
                })}
              </div>
            ))}
          </nav>

          <div className="px-3 py-4 border-t border-sidebar-border">
            <button
              onClick={handleLogout}
              className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-sans text-sidebar-foreground/70 hover:bg-sidebar-accent/50 w-full"
            >
              <LogOut className="w-4 h-4" />
              Sign Out
            </button>
          </div>
        </div>
      </aside>

      {/* Mobile overlay */}
      {sidebarOpen && (
        <div className="lg:hidden fixed inset-0 z-30 bg-charcoal/50" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Main content */}
      <main className="flex-1 min-w-0 lg:ml-0">
        <div className="p-6 lg:p-8 pt-16 lg:pt-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
};

export default AdminLayout;
