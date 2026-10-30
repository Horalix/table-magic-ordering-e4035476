import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider, hashKey } from "@tanstack/react-query";
import { MotionConfig } from "framer-motion";
import { BrowserRouter, Routes, Route, Navigate, useLocation, useParams } from "react-router-dom";
import { lazy, Suspense, useEffect, type ReactNode } from "react";
import StaffGate from "./components/auth/StaffGate";
import { ClockProvider } from "./lib/clock";
import LocaleShell from "./components/LocaleShell";
import { menuCategoryPath, menuHome, ownSiteElsewhere, venueBySlug } from "./lib/venues";
import { currentVenueSlug } from "./lib/current-venue";
import { HOME_VENUE } from "./lib/home-venue";

const VERA_HOME = HOME_VENUE === "veraitalia";
/** Vera Italia's own site, when its pages are not this site's to show. */
const VERA_ELSEWHERE = ownSiteElsewhere("veraitalia");
import { VenueTheme } from "./hooks/useVenue";
import { AppUpdater } from "./lib/app-update";

// Code-split route bundles so guests, staff, and admin screens load only when needed.
// The website at / is a chunk of its own: a guest scanning a table code never downloads it.
const SiteHome = lazy(() => import("./pages/site/SiteHome"));
// Vera Italia's website (docs/two-restaurants.md).
const VeraSite = lazy(() => import("./pages/vera/VeraSite"));
const DishLink = lazy(() => import("./pages/DishLink"));
const GuestMenu = lazy(() => import("./pages/GuestMenu"));
const CategoryPage = lazy(() => import("./pages/CategoryPage"));
const CartPage = lazy(() => import("./pages/CartPage"));
const RunningTabPage = lazy(() => import("./pages/RunningTabPage"));
const TableEntry = lazy(() => import("./pages/TableEntry"));
const TableNumberEntry = lazy(() => import("./pages/TableNumberEntry"));
const Trust = lazy(() => import("./pages/Trust"));
const PageTransition = lazy(() => import("./components/PageTransition"));
const TablePresence = lazy(() => import("./components/guest/TablePresence"));
const FlyToCart = lazy(() => import("./components/guest/FlyToCart"));
const AdminLogin = lazy(() => import("./pages/AdminLogin"));
const AdminLayout = lazy(() => import("./components/admin/AdminLayout"));
const AdminDashboard = lazy(() => import("./pages/admin/AdminDashboard"));
const AdminMenu = lazy(() => import("./pages/admin/AdminMenu"));
const AdminTables = lazy(() => import("./pages/admin/AdminTables"));
const AdminOrders = lazy(() => import("./pages/admin/AdminOrders"));
const AdminAnalytics = lazy(() => import("./pages/admin/AdminAnalytics"));
const AdminQRCodes = lazy(() => import("./pages/admin/AdminQRCodes"));
const AdminSections = lazy(() => import("./pages/admin/AdminSections"));
const AdminFloorTonight = lazy(() => import("./pages/admin/AdminFloorTonight"));
const AdminPrinting = lazy(() => import("./pages/admin/AdminPrinting"));
const AdminService = lazy(() => import("./pages/admin/AdminService"));
const AdminMenuIntelligence = lazy(() => import("./pages/admin/AdminMenuIntelligence"));
const AdminReports = lazy(() => import("./pages/admin/AdminReports"));
const AdminWaiters = lazy(() => import("./pages/admin/AdminWaiters"));
const AdminPerformance = lazy(() => import("./pages/admin/AdminPerformance"));
const AdminAudit = lazy(() => import("./pages/admin/AdminAudit"));
const AdminImpact = lazy(() => import("./pages/admin/AdminImpact"));
const AdminPromotions = lazy(() => import("./pages/admin/AdminPromotions"));
const KitchenDisplay = lazy(() => import("./pages/KitchenDisplay"));
const WaiterDashboard = lazy(() => import("./pages/WaiterDashboard"));
const WaiterLogin = lazy(() => import("./pages/WaiterLogin"));
const WaiterMonitor = lazy(() => import("./pages/WaiterMonitor"));
const NotFound = lazy(() => import("./pages/NotFound"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      gcTime: 30 * 60 * 1000,
      refetchOnWindowFocus: false,
      retry: 1,
      // Every answer is one restaurant's (the x-venue header, src/lib/current-venue.ts),
      // so the cache keeps each restaurant's apart: La Soul's categories must
      // never be what Vera Italia's menu shows for a moment.
      queryKeyHashFn: (key) => hashKey([currentVenueSlug() ?? '', ...key]),
    },
  },
});

const RouteFallback = () => (
  <div className="min-h-screen bg-background flex items-center justify-center">
    <div className="w-6 h-6 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
  </div>
);

/*
 * Each restaurant's menu lives under /menu/<venue> (src/lib/venues.ts). The
 * addresses that came before — /menu, /menu/drinks, the old static site's
 * pages via public/_redirects — keep working: printed QR codes, saved home
 * screen icons and search results all point at them.
 */
const LEGACY_CATEGORIES = new Set(['drinks', 'food', 'desserts']);

const MenuRedirect = () => {
  const { search } = useLocation();
  return <Navigate to={menuHome(search)} replace />;
};

/** A full page load of another address: the browser leaves this site. */
const ForwardTo = ({ to }: { to: string }) => {
  useEffect(() => { window.location.replace(to); }, [to]);
  return null;
};

/**
 * A restaurant with a site of its own (veraitalia.net) is shown there: the
 * same page, at its own address. Netlify forwards these on a first visit; a
 * phone whose service worker answers never asks Netlify, so the app does too.
 */
const OnItsOwnSite = ({ children }: { children: ReactNode }) => {
  const { venue } = useParams<{ venue: string }>();
  const { pathname, search, hash } = useLocation();
  const away = ownSiteElsewhere(venue);
  return away ? <ForwardTo to={`${away}${pathname}${search}${hash}`} /> : <>{children}</>;
};

const VenueMenu = () => {
  const { venue } = useParams<{ venue: string }>();
  const { search } = useLocation();
  if (venueBySlug(venue)) return <PageTransition><GuestMenu /></PageTransition>;
  if (venue && LEGACY_CATEGORIES.has(venue)) return <Navigate to={`${menuCategoryPath(venue)}${search}`} replace />;
  return <NotFound />;
};

const VenueCategory = () => {
  const { venue } = useParams<{ venue: string }>();
  return venueBySlug(venue) ? <PageTransition><CategoryPage /></PageTransition> : <NotFound />;
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    {/*
      Honour the OS "reduce motion" setting everywhere at once.

      The CSS `prefers-reduced-motion` block only neutralises CSS animation and
      transitions. Every framer-motion animation in the app — the pager drag,
      the grid scale-in, sheet slides, the cart bar — ignored it entirely and
      played at full amplitude, which for a vestibular-sensitive guest is the
      difference between usable and nauseating. One line covers all of them.
    */}
    <MotionConfig reducedMotion="user">
    <TooltipProvider>
      <Toaster />
      <Sonner />
      {/* Add-to-order flights; see src/lib/cart-fx.ts. */}
      <Suspense fallback={null}><FlyToCart /></Suspense>
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <LocaleShell>
        <VenueTheme />
        <AppUpdater />
        <Suspense fallback={null}>
          {/* Guest-only: shows a join-approval prompt whenever this device is
              in an active table session. No-op for staff/admin (no sessionId). */}
          <TablePresence />
        </Suspense>
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            {/* The website (lasoul.net). No page transition: its hero is the
                page's largest paint and should not wait for a fade. On
                Vera Italia's own site (veraitalia.net, src/lib/home-venue.ts)
                "/", /bs and /ar are Vera Italia's website in each language. */}
            <Route path="/" element={VERA_HOME ? <VeraSite /> : <SiteHome />} />
            <Route path="/bs" element={VERA_HOME ? <VeraSite locale="bs" /> : <SiteHome locale="bs" />} />
            <Route path="/ar" element={VERA_HOME ? <VeraSite locale="ar" /> : <SiteHome locale="ar" />} />
            <Route path="/veraitalia" element={VERA_HOME ? <Navigate to="/" replace /> : VERA_ELSEWHERE ? <ForwardTo to={`${VERA_ELSEWHERE}/`} /> : <VeraSite />} />
            {/* Guest routes wrapped in soft page transition. */}
            <Route path="/menu" element={<MenuRedirect />} />
            <Route path="/menu/:venue" element={<OnItsOwnSite><VenueMenu /></OnItsOwnSite>} />
            <Route path="/menu/:venue/:type" element={<OnItsOwnSite><VenueCategory /></OnItsOwnSite>} />
            <Route path="/menu/:venue/dish/:dishSlug" element={<OnItsOwnSite><DishLink /></OnItsOwnSite>} />
            <Route path="/cart" element={<PageTransition><CartPage /></PageTransition>} />
            <Route path="/tab" element={<PageTransition><RunningTabPage /></PageTransition>} />
            <Route path="/table/:tableNumber" element={<TableEntry />} />
            <Route path="/start" element={<TableNumberEntry />} />
            <Route path="/privacy" element={<PageTransition><Trust /></PageTransition>} />

            {/* Admin Routes */}
            <Route path="/admin/login" element={<AdminLogin />} />
            <Route path="/admin" element={<ClockProvider><AdminLayout /></ClockProvider>}>
              <Route index element={<AdminDashboard />} />
              <Route path="menu" element={<AdminMenu />} />
              <Route path="promotions" element={<AdminPromotions />} />
              <Route path="tables" element={<AdminTables />} />
              <Route path="orders" element={<AdminOrders />} />
              <Route path="analytics" element={<AdminAnalytics />} />
              <Route path="qr-codes" element={<AdminQRCodes />} />
              <Route path="sections" element={<AdminSections />} />
              <Route path="tonight" element={<AdminFloorTonight />} />
              <Route path="printing" element={<AdminPrinting />} />
              <Route path="service" element={<AdminService />} />
              <Route path="menu-intelligence" element={<AdminMenuIntelligence />} />
              <Route path="reports" element={<AdminReports />} />
              <Route path="waiters" element={<AdminWaiters />} />
              <Route path="performance" element={<AdminPerformance />} />
              <Route path="audit" element={<AdminAudit />} />
              <Route path="impact" element={<AdminImpact />} />
            </Route>

            {/* Kitchen & Waiter. Wrapped in ClockProvider so every elapsed-time
                card on these screens shares one interval instead of owning its
                own — forty table cards used to mean forty timers. */}
            <Route path="/kitchen" element={<StaffGate><ClockProvider><KitchenDisplay /></ClockProvider></StaffGate>} />
            <Route path="/waiter/login" element={<WaiterLogin />} />
            <Route path="/waiter/monitor" element={<StaffGate redirectTo="/waiter/login"><ClockProvider><WaiterMonitor /></ClockProvider></StaffGate>} />
            <Route path="/waiter" element={<StaffGate redirectTo="/waiter/login"><ClockProvider><WaiterDashboard /></ClockProvider></StaffGate>} />

            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </LocaleShell>
      </BrowserRouter>
    </TooltipProvider>
    </MotionConfig>
  </QueryClientProvider>
);

export default App;
