import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import GuestMenu from "./pages/GuestMenu";
import CategoryPage from "./pages/CategoryPage";
import CartPage from "./pages/CartPage";
import RunningTabPage from "./pages/RunningTabPage";
import TableEntry from "./pages/TableEntry";
import AdminLogin from "./pages/AdminLogin";
import AdminLayout from "./components/admin/AdminLayout";
import AdminDashboard from "./pages/admin/AdminDashboard";
import AdminMenu from "./pages/admin/AdminMenu";
import AdminTables from "./pages/admin/AdminTables";
import AdminOrders from "./pages/admin/AdminOrders";
import AdminAnalytics from "./pages/admin/AdminAnalytics";
import AdminQRCodes from "./pages/admin/AdminQRCodes";
import AdminSections from "./pages/admin/AdminSections";
import AdminWaiters from "./pages/admin/AdminWaiters";
import AdminPerformance from "./pages/admin/AdminPerformance";
import KitchenDisplay from "./pages/KitchenDisplay";
import WaiterDashboard from "./pages/WaiterDashboard";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          {/* Guest Routes */}
          <Route path="/" element={<GuestMenu />} />
          <Route path="/menu" element={<GuestMenu />} />
          <Route path="/menu/:type" element={<CategoryPage />} />
          <Route path="/cart" element={<CartPage />} />
          <Route path="/tab" element={<RunningTabPage />} />
          <Route path="/table/:tableNumber" element={<TableEntry />} />

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
            <Route path="waiters" element={<AdminWaiters />} />
            <Route path="performance" element={<AdminPerformance />} />
          </Route>

          {/* Kitchen & Waiter */}
          <Route path="/kitchen" element={<KitchenDisplay />} />
          <Route path="/waiter" element={<WaiterDashboard />} />

          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
