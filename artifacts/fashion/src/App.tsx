import { lazy, Suspense } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router, Route, Switch, useLocation } from "wouter";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/context/AuthContext";
import { CartProvider } from "@/context/CartContext";
import { WishlistProvider } from "@/context/WishlistContext";
import { ProductsProvider } from "@/context/ProductsContext";
import { ThemeProvider } from "@/context/ThemeContext";
import { Header } from "@/components/Header";
import { CartDrawer } from "@/components/CartDrawer";
import { Footer } from "@/components/Footer";
import { HomePage } from "@/pages/Home";
import { ShopPage } from "@/pages/Shop";
import { ProductDetailPage } from "@/pages/ProductDetail";
import { CheckoutPage } from "@/pages/Checkout";
import { WishlistPage } from "@/pages/Wishlist";
import { SignInPage } from "@/pages/SignIn";
import { SignUpPage } from "@/pages/SignUp";
import { ProfilePage } from "@/pages/Profile";
import NotFound from "@/pages/not-found";

const AdminDashboard = lazy(() =>
  import("@/admin/Dashboard").then((m) => ({ default: m.AdminDashboard })),
);
const HeroAdmin = lazy(() =>
  import("@/admin/HeroAdmin").then((m) => ({ default: m.HeroAdmin })),
);
const ProductsAdmin = lazy(() =>
  import("@/admin/ProductsAdmin").then((m) => ({ default: m.ProductsAdmin })),
);
const OrdersAdmin = lazy(() =>
  import("@/admin/OrdersAdmin").then((m) => ({ default: m.OrdersAdmin })),
);
const OrderDetailAdmin = lazy(() =>
  import("@/admin/OrdersAdmin").then((m) => ({ default: m.OrderDetailAdmin })),
);
const CustomersAdmin = lazy(() =>
  import("@/admin/CustomersAdmin").then((m) => ({ default: m.CustomersAdmin })),
);
const ReviewsAdmin = lazy(() =>
  import("@/admin/ReviewsAdmin").then((m) => ({ default: m.ReviewsAdmin })),
);
const EmailsAdmin = lazy(() =>
  import("@/admin/EmailsAdmin").then((m) => ({ default: m.EmailsAdmin })),
);
const SettingsAdmin = lazy(() =>
  import("@/admin/SettingsAdmin").then((m) => ({ default: m.SettingsAdmin })),
);

function AdminFallback() {
  return (
    <div className="min-h-[60vh] flex items-center justify-center text-sm text-muted-foreground">
      Loading admin…
    </div>
  );
}

const queryClient = new QueryClient();
const baseUrl = import.meta.env.BASE_URL.replace(/\/$/, "");

function StorefrontShell() {
  return (
    <>
      <Header />
      <main className="flex-1">
        <Switch>
          <Route path="/" component={HomePage} />
          <Route path="/shop" component={ShopPage} />
          <Route path="/wishlist" component={WishlistPage} />
          <Route path="/product/:id" component={ProductDetailPage} />
          <Route path="/checkout" component={CheckoutPage} />
          <Route path="/profile" component={ProfilePage} />
          <Route path="/sign-in" component={SignInPage} />
          <Route path="/sign-up" component={SignUpPage} />
          <Route component={NotFound} />
        </Switch>
      </main>
      <Footer />
      <CartDrawer />
    </>
  );
}

function AppRoutes() {
  const [location] = useLocation();
  const isAdmin = location === "/admin" || location.startsWith("/admin/");

  return (
    <div
      className={
        isAdmin
          ? "min-h-[100dvh] w-full bg-background text-foreground"
          : "min-h-[100dvh] flex flex-col w-full bg-background font-sans text-foreground"
      }
    >
      <Suspense fallback={isAdmin ? <AdminFallback /> : null}>
        <Switch>
          <Route path="/admin" component={AdminDashboard} />
          <Route path="/admin/hero" component={HeroAdmin} />
          <Route path="/admin/products" component={ProductsAdmin} />
          <Route path="/admin/orders" component={OrdersAdmin} />
          <Route path="/admin/orders/:id">
            {(params) => <OrderDetailAdmin id={params.id} />}
          </Route>
          <Route path="/admin/customers" component={CustomersAdmin} />
          <Route path="/admin/reviews" component={ReviewsAdmin} />
          <Route path="/admin/emails" component={EmailsAdmin} />
          <Route path="/admin/settings" component={SettingsAdmin} />
          <Route path="/admin/:rest*" component={AdminDashboard} />
          <Route>
            <StorefrontShell />
          </Route>
        </Switch>
      </Suspense>
    </div>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TooltipProvider>
          <AuthProvider>
            <ProductsProvider>
              <WishlistProvider>
                <CartProvider>
                  <Router base={baseUrl}>
                    <AppRoutes />
                  </Router>
                  <Toaster />
                  <Sonner position="top-center" />
                </CartProvider>
              </WishlistProvider>
            </ProductsProvider>
          </AuthProvider>
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
