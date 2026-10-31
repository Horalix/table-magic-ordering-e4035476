import React, { useEffect, useState } from 'react';
import { useNavigate, Outlet, Link, Navigate, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { supabase } from '@/integrations/supabase/client';
import {
  LayoutDashboard, UtensilsCrossed, TableProperties, ClipboardList,
  BarChart3, QrCode, LogOut, ChefHat, Menu, X, Layers, Users, Star, Monitor,
  CalendarCheck, Printer, Receipt, Sparkles, Brain, ScrollText, TrendingUp, Tag,
  LayoutGrid, UserCog, KeyRound, Loader2,
} from 'lucide-react';
import { toast } from 'sonner';
import { springPill } from '@/lib/motion';
import { useStaffDocument } from '@/components/staff/useStaffDocument';
import { useLearningHeartbeat } from '@/hooks/useLearningHeartbeat';
import { switchStaffVenue, useStaffVenue } from '@/hooks/useStaffVenue';
import AdminMobileTabs from '@/components/admin/AdminMobileTabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { VENUES } from '@/lib/venues';
import type { User } from '@supabase/supabase-js';

/*
 * The owner's pages: both restaurants at once, and who runs them. Nobody
 * else sees them in the navigation, and their addresses send anyone else to
 * their own restaurant's dashboard.
 */
const ownerGroup = {
  heading: 'Owner',
  items: [
    { label: 'Overview', icon: LayoutGrid, path: '/admin/overview' },
    { label: 'Team', icon: UserCog, path: '/admin/team' },
  ],
};
const OWNER_PATHS = ownerGroup.items.map((i) => i.path);

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
      { label: 'Promotions', icon: Tag, path: '/admin/promotions' },
      { label: 'Sections', icon: Layers, path: '/admin/sections' },
      { label: 'Waiters', icon: Users, path: '/admin/waiters' },
      { label: 'QR Codes', icon: QrCode, path: '/admin/qr-codes' },
      { label: 'Printing', icon: Printer, path: '/admin/printing' },
      { label: 'Service & suggestions', icon: Sparkles, path: '/admin/service' },
    ],
  },
  {
    heading: 'Insights',
    items: [
      { label: 'What the app earned', icon: TrendingUp, path: '/admin/impact' },
      { label: 'Daily Report', icon: Receipt, path: '/admin/reports' },
      { label: 'Performance', icon: Star, path: '/admin/performance' },
      { label: 'Menu intelligence', icon: Brain, path: '/admin/menu-intelligence' },
      { label: 'Analytics', icon: BarChart3, path: '/admin/analytics' },
      { label: 'Audit log', icon: ScrollText, path: '/admin/audit' },
    ],
  },
];

/** What every admin page can read with useOutletContext(). */
export interface AdminOutletContext {
  /** The restaurant these pages are about; null while the account's roles load. */
  venueName: string | null;
  /** Its slug (src/lib/venues.ts); null while the roles load. */
  venueSlug: string | null;
  /** The owner, who has every restaurant; null while the roles load. */
  owner: boolean | null;
}

/*
 * The owner's first screen in a tab is both restaurants (/admin/overview);
 * after that, /admin is the dashboard of the restaurant they picked — which
 * is where "Open La Soul admin" lands, after a full page load. Remembered for
 * the tab, and forgotten at sign-out so the next sign-in starts there again.
 * Where storage is off, the owner simply starts on the dashboard, as before.
 */
const OVERVIEW_SEEN_KEY = 'admin:overview-seen';

function overviewSeen(): boolean {
  try {
    return sessionStorage.getItem(OVERVIEW_SEEN_KEY) === '1';
  } catch {
    return true;
  }
}

function rememberOverview(seen: boolean): void {
  try {
    if (seen) sessionStorage.setItem(OVERVIEW_SEEN_KEY, '1');
    else sessionStorage.removeItem(OVERVIEW_SEEN_KEY);
  } catch {
    // Storage off: nothing to remember, nothing to forget.
  }
}

const MIN_PASSWORD = 10;

/**
 * Any admin changes their own password. An admin the owner appointed signs
 * in with the password the owner typed for them (Admin → Team), and changes
 * it here. The current password is asked for first, so a tablet left signed
 * in cannot be used to lock its admin out.
 */
const ChangePasswordDialog = ({ open, onOpenChange, email }: { open: boolean; onOpenChange: (open: boolean) => void; email: string | null }) => {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (open) return;
    setCurrent(''); setNext(''); setRepeat(''); setProblem(null);
  }, [open]);

  const tooShort = next.length > 0 && next.length < MIN_PASSWORD;
  const mismatch = repeat.length > 0 && repeat !== next;
  const ready = !!current && next.length >= MIN_PASSWORD && next === repeat && !saving;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready || !email) return;
    setSaving(true);
    setProblem(null);
    try {
      const { error: wrong } = await supabase.auth.signInWithPassword({ email, password: current });
      if (wrong) { setProblem('That is not your current password.'); return; }
      const { error } = await supabase.auth.updateUser({ password: next });
      if (error) {
        // Supabase may ask for a recent sign-in before a password change.
        setProblem(/reauth/i.test(error.message)
          ? 'For your safety, sign out, sign in again, and change it straight away.'
          : error.message);
        return;
      }
      toast.success('Password changed. Use the new one next time you sign in.');
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={save} className="space-y-4">
          <DialogHeader>
            <DialogTitle className="font-serif">Change password</DialogTitle>
            <DialogDescription>
              {email ? <>For <span className="font-medium text-foreground">{email}</span>. </> : null}
              At least {MIN_PASSWORD} characters.
            </DialogDescription>
          </DialogHeader>
          <div>
            <Label htmlFor="password-current" className="font-sans text-sm">Current password</Label>
            <Input id="password-current" type="password" autoComplete="current-password" value={current}
              onChange={(e) => setCurrent(e.target.value)} className="mt-1.5 h-11" required />
          </div>
          <div>
            <Label htmlFor="password-new" className="font-sans text-sm">New password</Label>
            <Input id="password-new" type="password" autoComplete="new-password" value={next}
              onChange={(e) => setNext(e.target.value)} className="mt-1.5 h-11" required minLength={MIN_PASSWORD}
              aria-invalid={tooShort} />
            {tooShort && <p className="text-xs font-sans text-destructive mt-1">At least {MIN_PASSWORD} characters.</p>}
          </div>
          <div>
            <Label htmlFor="password-repeat" className="font-sans text-sm">New password again</Label>
            <Input id="password-repeat" type="password" autoComplete="new-password" value={repeat}
              onChange={(e) => setRepeat(e.target.value)} className="mt-1.5 h-11" required aria-invalid={mismatch} />
            {mismatch && <p className="text-xs font-sans text-destructive mt-1">The two do not match.</p>}
          </div>
          {problem && <p role="alert" className="text-sm font-sans text-destructive">{problem}</p>}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={!ready} className="gap-2">
              {saving && <Loader2 className="w-4 h-4 animate-spin" />} Change password
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

const Spinner = () => (
  <div className="py-24 flex items-center justify-center">
    <div className="w-6 h-6 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
  </div>
);

const AdminLayout = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const staffVenue = useStaffVenue(user?.id ?? null);
  const owner = staffVenue?.owner ?? null;
  const groups = owner ? [ownerGroup, ...navGroups] : navGroups;
  const currentLabel = [ownerGroup, ...navGroups].flatMap((g) => g.items)
    .filter((i) => location.pathname === i.path || (i.path !== '/admin' && location.pathname.startsWith(i.path)))
    .sort((a, b) => b.path.length - a.path.length)[0]?.label ?? 'Dashboard';
  const ownerPage = OWNER_PATHS.includes(location.pathname);
  // Nothing until the roles say whose admin this is: a restaurant's admin
  // must never see the other restaurant's name, not even while loading.
  const venueName = staffVenue?.venue.name ?? null;
  const bothNames = Object.values(VENUES).map((v) => v.name).join(' & ');

  // English, left-to-right, whatever a guest last picked on this device; the
  // tab named after the page and the restaurant.
  useStaffDocument(ownerPage
    ? `${currentLabel} · ${bothNames}`
    : `${currentLabel} · ${venueName ? `${venueName} admin` : 'Admin'}`);
  useLearningHeartbeat();

  // The owner has seen both restaurants in this tab; anyone else has nothing to see.
  useEffect(() => {
    if (owner === false || (owner && location.pathname === '/admin/overview')) rememberOverview(true);
  }, [owner, location.pathname]);

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
        /*
         * Send staff back to their own screen instead of signing them out.
         *
         * The kitchen's printer gear and a mistyped URL both land a cook or a
         * waiter here. Signing them out used to log the kitchen tablet out
         * mid-service — and it then sat on a login screen that nobody on the
         * line knows the password for. Only a session with no staff role at
         * all is signed out, because it has no business being signed in.
         */
        const { data: isStaff } = await supabase.rpc('has_role', {
          _user_id: session.user.id,
          _role: 'staff',
        });
        if (cancelled) return;

        if (isStaff) {
          const { data: waiterRow } = await supabase
            .from('waiters').select('id').eq('user_id', session.user.id).maybeSingle();
          if (cancelled) return;
          setAuthChecked(true);
          toast.error('The admin area is for managers');
          navigate(waiterRow ? '/waiter' : '/kitchen', { replace: true });
          return;
        }

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
      if (event === 'SIGNED_OUT') {
        rememberOverview(false);
        navigate('/admin/login');
      }
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [navigate]);

  const handleLogout = async () => {
    rememberOverview(false);
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

  // Which page, now that it is known whose admin this is.
  const firstScreen = location.pathname === '/admin' && !overviewSeen();
  let page: React.ReactNode;
  if (!staffVenue && (ownerPage || firstScreen)) {
    page = <Spinner />;
  } else if (ownerPage && !owner) {
    page = <Navigate to="/admin" replace />;
  } else if (firstScreen && owner) {
    page = <Navigate to="/admin/overview" replace />;
  } else {
    page = (
      <Outlet
        context={{
          venueName,
          venueSlug: staffVenue?.venue.slug ?? null,
          owner,
        } satisfies AdminOutletContext}
      />
    );
  }

  return (
    <div className="min-h-screen bg-background flex">
      {/* Sidebar. On a phone it opens between the top bar and the tab bar
          (56px + its 1px border + the home indicator): drawn over them, the
          bar hid the restaurant's name and the tab bar hid Sign Out. */}
      <aside className={`
        fixed lg:static top-14 bottom-[calc(57px+env(safe-area-inset-bottom))] lg:inset-y-0 left-0 z-40 w-64 bg-sidebar border-r border-sidebar-border
        transform transition-transform duration-200
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
      `}>
        <div className="flex flex-col h-full">
          <div className="px-6 py-6 border-b border-sidebar-border">
            {venueName
              ? <h1 className="font-serif text-xl font-bold text-sidebar-foreground">{venueName}</h1>
              : <Skeleton aria-label="Loading the restaurant" className="h-7 w-32 rounded bg-sidebar-accent/60" />}
            <p className="text-xs text-sidebar-foreground/60 font-sans mt-0.5">{owner ? 'Owner · Admin Dashboard' : 'Admin Dashboard'}</p>
            {/* The owner looks at one restaurant at a time; everyone else only ever has theirs. */}
            {staffVenue?.owner && (
              <div role="group" aria-label="Restaurant" className="mt-3 grid grid-cols-2 gap-1 rounded-lg bg-sidebar-accent/40 p-1">
                {Object.values(VENUES).map((v) => {
                  const current = v.slug === staffVenue.venue.slug;
                  return (
                    <button
                      key={v.slug}
                      type="button"
                      aria-pressed={current}
                      onClick={() => { if (!current) switchStaffVenue(v.slug); }}
                      className={`min-h-9 rounded-md px-2 text-xs font-sans transition-colors ${
                        current
                          ? 'bg-sidebar text-sidebar-foreground font-semibold shadow-sm'
                          : 'text-sidebar-foreground/70 hover:text-sidebar-foreground'
                      }`}
                    >
                      {v.name}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <nav aria-label="Admin menu" className="flex-1 px-3 py-4 overflow-y-auto space-y-4">
            {groups.map((group) => (
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

          <div className="px-3 py-4 border-t border-sidebar-border space-y-1">
            <button
              type="button"
              onClick={() => { setSidebarOpen(false); setPasswordOpen(true); }}
              className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-sans text-sidebar-foreground/70 hover:bg-sidebar-accent/50 w-full"
            >
              <KeyRound className="w-4 h-4" />
              Change password
            </button>
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
        {/* A real top bar on phones instead of a lone floating button: it says
            where you are and stays put while the page scrolls under it. */}
        <div className="lg:hidden sticky top-0 z-50 h-14 flex items-center gap-2 px-2 bg-background/90 backdrop-blur border-b border-border/70">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            aria-label={sidebarOpen ? 'Close admin navigation' : 'Open admin navigation'}
            aria-expanded={sidebarOpen}
            className="w-11 h-11 rounded-full flex items-center justify-center hover:bg-muted"
          >
            {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
          <div className="min-w-0 leading-tight">
            <p className="font-serif text-base font-semibold truncate">
              {ownerPage ? bothNames : venueName ? `${venueName} admin` : 'Admin'}
            </p>
            <p className="text-xs text-muted-foreground truncate">{currentLabel}</p>
          </div>
        </div>
        <div className="px-4 py-5 pb-24 sm:p-6 sm:pb-24 lg:p-8 max-w-7xl mx-auto w-full">
          {page}
        </div>
      </main>
      <AdminMobileTabs owner={!!owner} onMore={() => setSidebarOpen(true)} />
      <ChangePasswordDialog open={passwordOpen} onOpenChange={setPasswordOpen} email={user.email ?? null} />
    </div>
  );
};

export default AdminLayout;
