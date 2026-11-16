import { DEMO_MODE } from '@/lib/demo-mode';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, Outlet, Link, Navigate, useLocation, useNavigationType } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { ArrowRight, CalendarClock, RotateCw, Search } from 'lucide-react';
import { toast } from 'sonner';
import { useStaffDocument } from '@/components/staff/useStaffDocument';
import { useLearningHeartbeat } from '@/hooks/useLearningHeartbeat';
import { switchStaffVenue, useStaffVenue } from '@/hooks/useStaffVenue';
import AdminMobileTabs from '@/components/admin/AdminMobileTabs';
import AdminCommandPalette from '@/components/admin/nav/AdminCommandPalette';
import AdminSidebar from '@/components/admin/nav/AdminSidebar';
import AreaTabs from '@/components/admin/nav/AreaTabs';
import ChangePasswordDialog from '@/components/admin/nav/ChangePasswordDialog';
import InstallHint from '@/components/admin/nav/InstallHint';
import MoreSheet from '@/components/admin/nav/MoreSheet';
import ScreenFrame from '@/components/admin/nav/ScreenFrame';
import { RESERVATIONS_PATH, areaOf, ownerPaths, pageAt, type NavLauncher } from '@/components/admin/nav/admin-nav';
import { LEAVE_FRAME, inScreenFrame, setIconBadge, useStandalone } from '@/components/admin/nav/manager-app';
import { rememberVisit } from '@/components/admin/nav/nav-memory';
import type { AdminShell } from '@/components/admin/nav/shell';
import { VENUES } from '@/lib/venues';
import EndOfDayTables from '@/components/staff/EndOfDayTables';
import MenuOnlyNotice from '@/components/staff/MenuOnlyNotice';
import { countPendingReservations } from '@/lib/reservations';
import type { User } from '@supabase/supabase-js';

/*
 * The admin's frame: who may be here, which restaurant it is about, and the
 * navigation around every page.
 *
 * Five areas (Home, Service, Menu, Reports, Setup), the same on a laptop and
 * on a phone; the pages inside an area are tabs at the top of the content.
 * The map is one list, src/components/admin/nav/admin-nav.ts, and no address
 * changed when it was drawn: every /admin/… link still opens its page.
 *
 *   laptop   sidebar (AdminSidebar): restaurant, search, areas, other screens, account
 *   phone    top bar + bottom bar (AdminMobileTabs) + More (MoreSheet)
 *   both     AreaTabs above the page, the search on ⌘K / Ctrl K (AdminCommandPalette)
 *
 * Each page renders its own AdminPageHeader first; everything around it is here.
 *
 * The owner's pages (both restaurants at once, and who runs them): nobody
 * else sees them in the navigation, and their addresses send anyone else to
 * their own restaurant's dashboard.
 */
const OWNER_PATHS = ownerPaths(DEMO_MODE);

/** How often the "waiting" count is asked for: a guest's request also rings the admin's phone. */
const PENDING_REFRESH_MS = 45_000;

/** What every admin page can read with useOutletContext(). */
export interface AdminOutletContext {
  /** The restaurant these pages are about; null while the account's roles load. */
  venueName: string | null;
  /** Its slug (src/lib/venues.ts); null while the roles load. */
  venueSlug: string | null;
  /** The owner, who has every restaurant; null while the roles load. */
  owner: boolean | null;
  /** The restaurants this account can switch between (useStaffVenue); empty while the roles load. */
  choices?: string[];
  /** Opens Change password for the signed-in account (Team's "you" row). */
  changePassword?: () => void;
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

const Spinner = () => (
  <div className="py-24 flex items-center justify-center">
    <div className="w-6 h-6 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
  </div>
);

const topButton = 'grid h-11 w-11 shrink-0 place-items-center rounded-full text-foreground/80 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

const AdminLayout = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const navigationType = useNavigationType();
  const queryClient = useQueryClient();
  const [moreOpen, setMoreOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [framed, setFramed] = useState<NavLauncher | null>(null);
  const [refreshed, setRefreshed] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const standalone = useStandalone();
  const staffVenue = useStaffVenue(user?.id ?? null);
  const owner = staffVenue?.owner ?? null;
  const currentPage = pageAt(location.pathname);
  const currentLabel = currentPage?.label ?? 'Dashboard';
  const currentArea = currentPage?.area ?? null;
  const ownerPage = OWNER_PATHS.includes(location.pathname);
  // Nothing until the roles say whose admin this is: a restaurant's admin
  // must never see the other restaurant's name, not even while loading.
  const venueName = staffVenue?.venue.name ?? null;
  const bothNames = Object.values(VENUES).map((v) => v.name).join(' & ');

  // Guests waiting for an answer about a table, shown on Service and on its
  // Reservations tab wherever in the admin the manager is. Zero until the
  // database has reservations at all.
  const reservationsVenue = staffVenue?.venue.dbId ?? null;
  const [pendingReservations, setPendingReservations] = useState(0);
  useEffect(() => {
    if (!reservationsVenue) return;
    let cancelled = false;
    const ask = () => {
      if (document.visibilityState !== 'visible') return;
      void countPendingReservations(reservationsVenue).then((n) => { if (!cancelled) setPendingReservations(n); });
    };
    ask();
    const timer = setInterval(ask, PENDING_REFRESH_MS);
    document.addEventListener('visibilitychange', ask);
    return () => { cancelled = true; clearInterval(timer); document.removeEventListener('visibilitychange', ask); };
  }, [reservationsVenue, location.pathname, refreshed]);

  // The same number on the Manager app's icon, where the phone has one to put it on.
  useEffect(() => { setIconBadge(pendingReservations); }, [pendingReservations]);

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

  const handleLogout = useCallback(async () => {
    rememberOverview(false);
    await supabase.auth.signOut();
    navigate('/admin/login');
  }, [navigate]);

  // Which page, now that it is known whose admin this is.
  const firstScreen = !DEMO_MODE && location.pathname === '/admin' && !overviewSeen();
  const waiting = !staffVenue && (ownerPage || firstScreen);
  const refused = !waiting && ownerPage && !owner;
  const toOverview = !waiting && !refused && firstScreen && !!owner;
  const showing = !!user && !waiting && !refused && !toOverview;

  // The area remembers the page last used in it, and the search lists the last few first.
  // From the moment the page shows, not once the roles have loaded: a quick tap onward
  // must not lose it. (An owner's page is never "showing" for anyone else.)
  useEffect(() => {
    if (showing) rememberVisit(location.pathname);
  }, [showing, location.pathname]);

  // A page opened from the navigation starts at its top; Back returns to where the manager was.
  useEffect(() => {
    if (navigationType !== 'POP') window.scrollTo(0, 0);
  }, [location.pathname, navigationType]);

  // ⌘K on a Mac, Ctrl K anywhere else: the search, from any page.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setSearchOpen((open) => !open);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /*
   * The kitchen display and the floor monitor, opened inside the Manager app
   * (ScreenFrame). The kitchen's gear leads to Admin → Printing: inside the
   * frame that would be an admin within the admin, so a framed admin page
   * says where it is and the app around it goes there instead.
   */
  useEffect(() => {
    if (inScreenFrame()) {
      window.parent.postMessage({ type: LEAVE_FRAME, path: window.location.pathname }, window.location.origin);
      return;
    }
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const data = event.data as { type?: string; path?: string } | null;
      if (data?.type !== LEAVE_FRAME || typeof data.path !== 'string' || !data.path.startsWith('/admin')) return;
      setFramed(null);
      navigate(data.path);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [navigate]);

  // How tall the bar that stays at the top is, for a page that pins something
  // under it: top-[calc(var(--admin-top,0px)+1rem)].
  const shellRef = useRef<HTMLDivElement>(null);
  const stickyRef = useRef<HTMLDivElement>(null);
  const signedIn = !!user;
  useEffect(() => {
    const bar = stickyRef.current;
    const root = shellRef.current;
    if (!bar || !root || typeof ResizeObserver === 'undefined') return;
    const measure = () => root.style.setProperty('--admin-top', `${Math.round(bar.getBoundingClientRect().height)}px`);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(bar);
    return () => observer.disconnect();
  }, [authChecked, signedIn]);

  /*
   * A Home Screen app cannot be pulled down to refresh, and has no reload
   * button. This asks every page for its figures again: what was fetched is
   * marked stale and the open page starts afresh, as if it had just been
   * opened. The arrow turns while it does.
   */
  const refresh = useCallback(() => {
    setRefreshing(true);
    setRefreshed((n) => n + 1);
    void queryClient.invalidateQueries().finally(() => {
      window.setTimeout(() => setRefreshing(false), 600);
    });
  }, [queryClient]);

  const audience = useMemo(() => ({ owner: !!owner, demo: DEMO_MODE }), [owner]);
  const choices = useMemo(() => staffVenue?.choices ?? [], [staffVenue]);
  const launch = useCallback((launcher: NavLauncher) => {
    if (standalone) setFramed(launcher);
    else window.open(launcher.path, '_blank', 'noopener');
  }, [standalone]);

  if (!authChecked) {
    return (
      <div className="min-h-[100dvh] bg-background flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) {
    return null;
  }

  const shell: AdminShell = {
    audience,
    pathname: location.pathname,
    area: currentArea,
    pending: pendingReservations,
    venueName,
    owner,
    choices,
    venueSlug: staffVenue?.venue.slug ?? null,
    email: user.email ?? null,
    standalone,
    openSearch: () => setSearchOpen(true),
    changePassword: () => setPasswordOpen(true),
    signOut: () => { void handleLogout(); },
    switchVenue: switchStaffVenue,
    launch,
  };

  let page: React.ReactNode;
  if (waiting) {
    page = <Spinner />;
  } else if (refused) {
    page = <Navigate to="/admin" replace />;
  } else if (toOverview) {
    page = <Navigate to="/admin/overview" replace />;
  } else {
    page = (
      <Outlet
        context={{
          venueName,
          venueSlug: staffVenue?.venue.slug ?? null,
          owner,
          choices: staffVenue?.choices.map((v) => v.slug) ?? [],
          changePassword: () => setPasswordOpen(true),
        } satisfies AdminOutletContext}
      />
    );
  }

  return (
    <div ref={shellRef} className="min-h-[100dvh] bg-background lg:flex">
      <AdminSidebar shell={shell} />

      <div className="flex min-w-0 flex-1 flex-col">
        {/* What stays put while the page scrolls under it: on a phone the bar
            that says where you are, and under it the pages of this area. */}
        <div ref={stickyRef} className="sticky top-0 z-30 border-b border-border/70 bg-background/95 backdrop-blur-md lg:border-0 print:hidden">
          <header className="box-content flex h-14 items-center gap-1 pl-[calc(env(safe-area-inset-left)+1rem)] pr-[calc(env(safe-area-inset-right)+0.375rem)] pt-[env(safe-area-inset-top)] lg:hidden">
            <div className="min-w-0 flex-1 leading-tight">
              <p data-testid="admin-top-venue" className="truncate font-serif text-[17px] font-semibold text-foreground">
                {ownerPage ? bothNames : venueName ?? 'Admin'}
              </p>
              <p className="truncate font-sans text-xs text-muted-foreground">
                {currentArea ? areaOf(currentArea).label : 'Admin'}
              </p>
            </div>
            {standalone && (
              <button type="button" onClick={refresh} aria-label="Refresh this page" className={topButton}>
                <RotateCw className={`h-[18px] w-[18px] ${refreshing ? 'animate-spin motion-reduce:animate-none' : ''}`} aria-hidden />
              </button>
            )}
            <button type="button" onClick={() => setSearchOpen(true)} aria-label="Search or jump to a page" className={topButton}>
              <Search className="h-5 w-5" aria-hidden />
            </button>
          </header>
          {currentArea && <AreaTabs area={currentArea} audience={audience} pathname={location.pathname} pending={pendingReservations} />}
        </div>

        <main className="mx-auto w-full max-w-7xl flex-1 pb-[calc(env(safe-area-inset-bottom)+5.5rem)] pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] pt-5 sm:px-6 sm:pt-6 lg:px-8 lg:pb-12 lg:pt-8">
          {/* What needs saying before the page, as one quiet stack; nothing is drawn when there is nothing to say. */}
          <div className="mb-6 flex flex-col gap-3 empty:hidden print:hidden">
            {/* A guest is looking at their phone for an answer about a table: said on every page but the one that answers. */}
            {staffVenue && !ownerPage && pendingReservations > 0 && location.pathname !== RESERVATIONS_PATH && (
              <Link
                to={RESERVATIONS_PATH}
                data-testid="reservations-waiting-notice"
                className="group flex min-h-[48px] items-center gap-3 rounded-xl border border-primary/25 bg-primary/[0.08] px-3.5 py-2.5 font-sans text-sm text-foreground transition-colors hover:bg-primary/[0.12] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <CalendarClock className="h-[18px] w-[18px] shrink-0 text-primary" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="font-semibold">
                    {pendingReservations === 1 ? 'A guest is waiting for an answer about a table' : `${pendingReservations} guests are waiting for an answer about a table`}
                  </span>
                </span>
                <span className="inline-flex items-center gap-1 whitespace-nowrap font-semibold text-primary">
                  Answer <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" aria-hidden />
                </span>
              </Link>
            )}
            {/* Every restaurant page but the switch's own, which says it in place. */}
            {staffVenue && !ownerPage && location.pathname !== '/admin/service' && <MenuOnlyNotice audience="admin" />}
            {/* After the work day: the tables nobody freed, and Close all tables. */}
            {staffVenue && !ownerPage && <EndOfDayTables hours={staffVenue.venue.hours} />}
            {/* Once, in a browser: how to make this the Manager app. */}
            {staffVenue && <InstallHint standalone={standalone} demo={DEMO_MODE} />}
          </div>
          <React.Fragment key={refreshed}>{page}</React.Fragment>
        </main>
      </div>

      <AdminMobileTabs shell={shell} moreOpen={moreOpen} onMore={() => setMoreOpen(true)} />
      <MoreSheet shell={shell} open={moreOpen} onOpenChange={setMoreOpen} />
      <AdminCommandPalette shell={shell} open={searchOpen} onOpenChange={setSearchOpen} />
      <ChangePasswordDialog open={passwordOpen} onOpenChange={setPasswordOpen} email={user.email ?? null} />
      <ScreenFrame screen={framed} onClose={() => setFramed(null)} />
    </div>
  );
};

export default AdminLayout;
