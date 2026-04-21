import { lazy, Suspense, useEffect, useRef } from "react";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { Router, Route, Switch, useLocation } from "wouter";
import { ClerkProvider, useClerk } from "@clerk/react";
import { shadcn } from "@clerk/themes";
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
const clerkPubKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined;
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL as string | undefined;

// Clerk passes full paths to routerPush/routerReplace; wouter prepends the
// base, so strip it once to avoid doubling up.
function stripBase(path: string): string {
  return baseUrl && path.startsWith(baseUrl)
    ? path.slice(baseUrl.length) || "/"
    : path;
}

const clerkAppearance = {
  theme: shadcn,
  cssLayerName: "clerk",
  options: {
    logoPlacement: "inside" as const,
    logoLinkUrl: baseUrl || "/",
    logoImageUrl:
      typeof window !== "undefined"
        ? `${window.location.origin}${baseUrl}/logo.svg`
        : `${baseUrl}/logo.svg`,
  },
  variables: {
    colorPrimary: "hsl(285, 80%, 55%)",
    colorForeground: "hsl(220, 15%, 12%)",
    colorMutedForeground: "hsl(220, 10%, 45%)",
    colorDanger: "hsl(0, 75%, 55%)",
    colorBackground: "hsl(0, 0%, 100%)",
    colorInput: "hsl(220, 14%, 96%)",
    colorInputForeground: "hsl(220, 15%, 12%)",
    colorNeutral: "hsl(220, 13%, 88%)",
    colorModalBackdrop: "rgba(15, 15, 25, 0.55)",
    fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
    borderRadius: "12px",
  },
  elements: {
    rootBox: "w-full",
    cardBox: "bg-background rounded-2xl w-[440px] max-w-full overflow-hidden shadow-xl",
    card: "!shadow-none !border-0 !bg-transparent !rounded-none",
    footer: "!shadow-none !border-0 !bg-transparent !rounded-none",
    headerTitle: "text-foreground font-serif",
    headerSubtitle: "text-muted-foreground",
    socialButtonsBlockButtonText: "text-foreground font-medium",
    socialButtonsBlockButton: "border border-border hover:bg-muted",
    formFieldLabel: "text-foreground font-medium",
    formFieldInput: "bg-muted border border-border text-foreground",
    formButtonPrimary: "bg-primary text-primary-foreground hover:opacity-90 font-medium",
    footerActionLink: "text-primary hover:underline font-medium",
    footerActionText: "text-muted-foreground",
    dividerText: "text-muted-foreground",
    dividerLine: "bg-border",
    identityPreviewEditButton: "text-primary",
    formFieldSuccessText: "text-foreground",
    alertText: "text-foreground",
    alert: "bg-muted border border-border",
    otpCodeFieldInput: "bg-muted border border-border text-foreground",
    formFieldRow: "gap-2",
    main: "gap-4",
    logoBox: "justify-center",
    logoImage: "h-8 w-8",
  },
};

function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const qc = useQueryClient();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (
        prevUserIdRef.current !== undefined &&
        prevUserIdRef.current !== userId
      ) {
        qc.clear();
      }
      prevUserIdRef.current = userId;
    });
    return unsubscribe;
  }, [addListener, qc]);

  return null;
}

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
          <Route path="/sign-in/*?" component={SignInPage} />
          <Route path="/sign-up/*?" component={SignUpPage} />
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

function ClerkRouterBridge({ children }: { children: React.ReactNode }) {
  const [, setLocation] = useLocation();
  if (!clerkPubKey) {
    // Fail safe: if the Clerk key is missing for any reason, render the
    // app without auth so the storefront still works for browsing.
    return <>{children}</>;
  }
  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      appearance={clerkAppearance}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
      localization={{
        signIn: {
          start: {
            title: "Welcome back to VELOUR",
            subtitle: "Sign in with email or phone to continue",
          },
        },
        signUp: {
          start: {
            title: "Join VELOUR",
            subtitle: "Create an account to track orders and save addresses",
          },
        },
      }}
    >
      <ClerkQueryClientCacheInvalidator />
      {children}
    </ClerkProvider>
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
                  <ClerkRouterBridge>
                    <AppRoutes />
                  </ClerkRouterBridge>
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
