import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router, Route, Switch } from "wouter";
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

const queryClient = new QueryClient();

const baseUrl = import.meta.env.BASE_URL.replace(/\/$/, "");

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
       <TooltipProvider>
        <ProductsProvider>
          <WishlistProvider>
            <CartProvider>
              <Router base={baseUrl}>
                <div className="min-h-[100dvh] flex flex-col w-full bg-background font-sans text-foreground">
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
                </div>
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
