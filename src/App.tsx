import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { ThemeProvider } from "next-themes";
import { TelemetryProvider } from "@/lib/telemetry";
import { AuthProvider } from "@/lib/auth";
import { ProtectedRoute, GuestRoute, AdminRoute } from "@/lib/auth";
import Index from "./pages/Index";
import SignIn from "./pages/SignIn";
import SignUp from "./pages/SignUp";
import Dashboard from "./pages/Dashboard";
import ReportPrice from "./pages/ReportPrice";
import Prices from "./pages/Prices";
import ProductDetails from "./pages/ProductDetails";
import NotFound from "./pages/NotFound";
import Explore from "./pages/Explore";
import ProductOffers from "./pages/ProductOffers";
import ProductCompare from "./pages/ProductCompare";
import NotificationsPage from "./pages/Notifications";
import SettingsPage from "./pages/Settings";
import AdminPage from "./pages/Admin";
import ScanPage from "./pages/Scan";
import WatchlistPage from "./pages/Watchlist";
const queryClient = new QueryClient();

const App = () => (
  <ThemeProvider attribute="class" defaultTheme="light" enableSystem storageKey="shkad-theme">
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <TelemetryProvider>
          <AuthProvider>
            <Toaster />
            <Sonner />
            <BrowserRouter>
              <Routes>
                <Route path="/" element={<Index />} />
                <Route
                  path="/sign-in"
                  element={
                    <GuestRoute>
                      <SignIn />
                    </GuestRoute>
                  }
                />
                <Route
                  path="/sign-up"
                  element={
                    <GuestRoute>
                      <SignUp />
                    </GuestRoute>
                  }
                />
                <Route
                  path="/dashboard"
                  element={
                    <ProtectedRoute>
                      <Dashboard />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/report-price"
                  element={
                    <ProtectedRoute>
                      <ReportPrice />
                    </ProtectedRoute>
                  }
                />
                <Route path="/prices" element={<Prices />} />
                <Route path="/products/:productId" element={<ProductDetails />} />
                <Route path="/explore" element={<Explore />} />
                <Route path="/explore/compare" element={<ProductCompare />} />
                <Route path="/scan" element={<ScanPage />} />
                <Route path="/explore/:productId" element={<ProductOffers />} />
                <Route path="/watchlist" element={<ProtectedRoute><WatchlistPage /></ProtectedRoute>} />
                <Route path="/notifications" element={<NotificationsPage />} />
                <Route path="/settings" element={<ProtectedRoute><SettingsPage /></ProtectedRoute>} />
                <Route path="/admin" element={<AdminRoute><AdminPage /></AdminRoute>} />
                {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
                <Route path="*" element={<NotFound />} />
              </Routes>
            </BrowserRouter>
          </AuthProvider>
        </TelemetryProvider>
      </TooltipProvider>
    </QueryClientProvider>
  </ThemeProvider>
);

export default App;
