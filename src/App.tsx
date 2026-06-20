import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { lazy, Suspense } from "react";
import StaffGate from "./components/auth/StaffGate";

// Code-split route bundles so guests, staff, and admin screens load only when needed.
const GuestMenu = lazy(() => import("./pages/GuestMenu"));
const CategoryPage = lazy(() => import("./pages/CategoryPage"));
const CartPage = lazy(() => import("./pages/CartPage"));
const RunningTabPage = lazy(() => import("./pages/RunningTabPage"));
const TableEntry = lazy(() => import("./pages/TableEntry"));
const Trust = lazy(() => import("./pages/Trust"));
const PageTransition = lazy(() => import("./components/PageTransition"));
const TablePresence = lazy(() => import("./components/guest/TablePresence"));
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
const AdminWaiters = lazy(() => import("./pages/admin/AdminWaiters"));
const AdminPerformance = lazy(() => import("./pages/admin/AdminPerformance"));
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
    },
  },
});

const RouteFallback = () => (
  <div className="min-h-screen bg-background flex items-center justify-center">
    <div className="w-6 h-6 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
  </div>
);

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Suspense fallback={null}>
          {/* Guest-only: shows a join-approval prompt whenever this device is
              in an active table session. No-op for staff/admin (no sessionId). */}
          <TablePresence />
        </Suspense>
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            {/* Guest routes wrapped in soft page transition. */}
            <Route path="/" element={<PageTransition><GuestMenu /></PageTransition>} />
            <Route path="/menu" element={<PageTransition><GuestMenu /></PageTransition>} />
            <Route path="/menu/:type" element={<PageTransition><CategoryPage /></PageTransition>} />
            <Route path="/cart" element={<PageTransition><CartPage /></PageTransition>} />
            <Route path="/tab" element={<PageTransition><RunningTabPage /></PageTransition>} />
            <Route path="/table/:tableNumber" element={<TableEntry />} />
            <Route path="/privacy" element={<PageTransition><Trust /></PageTransition>} />

            {/* Admin Routes */}
            <Route path="/admin/login" element={<AdminLogin />} />
            <Route path="/admin" element={<AdminLayout />}>
              <Route index element={<AdminDashboard />} />
              <Route path="menu" element={<AdminMenu />} />
              <Route path="tables" element={<AdminTables />} />
              <Route path="orders" element={<AdminOrders />} />
              <Route path="analytics" element={<AdminAnalytics />} />
              <Route path="qr-codes" element={<AdminQRCodes />} />
              <Route path="sections" element={<AdminSections />} />
              <Route path="tonight" element={<AdminFloorTonight />} />
              <Route path="waiters" element={<AdminWaiters />} />
              <Route path="performance" element={<AdminPerformance />} />
            </Route>

            {/* Kitchen & Waiter */}
            <Route path="/kitchen" element={<StaffGate><KitchenDisplay /></StaffGate>} />
            <Route path="/waiter/login" element={<WaiterLogin />} />
            <Route path="/waiter/monitor" element={<StaffGate redirectTo="/waiter/login"><WaiterMonitor /></StaffGate>} />
            <Route path="/waiter" element={<StaffGate redirectTo="/waiter/login"><WaiterDashboard /></StaffGate>} />

            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
