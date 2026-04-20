import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router, Route, Switch, useLocation } from "wouter";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
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
import NotFound from "@/pages/not-found";
import { AdminDashboard } from "@/admin/Dashboard";
import { HeroAdmin } from "@/admin/HeroAdmin";
import { ProductsAdmin } from "@/admin/ProductsAdmin";
import { OrdersAdmin, OrderDetailAdmin } from "@/admin/OrdersAdmin";
import { CustomersAdmin } from "@/admin/CustomersAdmin";
import { SettingsAdmin } from "@/admin/SettingsAdmin";

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
      <Switch>
        <Route path="/admin" component={AdminDashboard} />
        <Route path="/admin/hero" component={HeroAdmin} />
        <Route path="/admin/products" component={ProductsAdmin} />
        <Route path="/admin/orders" component={OrdersAdmin} />
        <Route path="/admin/orders/:id">
          {(params) => <OrderDetailAdmin id={params.id} />}
        </Route>
        <Route path="/admin/customers" component={CustomersAdmin} />
        <Route path="/admin/settings" component={SettingsAdmin} />
        <Route path="/admin/:rest*" component={AdminDashboard} />
        <Route>
          <StorefrontShell />
        </Route>
      </Switch>
    </div>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TooltipProvider>
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
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
