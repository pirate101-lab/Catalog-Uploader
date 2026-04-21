import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Link, Redirect, useLocation } from "wouter";
import {
  LayoutDashboard,
  ImageIcon,
  Package,
  ShoppingBag,
  Users,
  Settings,
  LogOut,
  Star,
  Mail,
  CreditCard,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";

export type AdminRole = "admin" | "super_admin";

interface AdminIdentity {
  id: number;
  username: string;
  role: AdminRole;
  via: "admin-local" | "oidc";
  lastLoginAt?: string | null;
}

interface NavEntry {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  superOnly?: boolean;
}

const NAV: NavEntry[] = [
  { to: "/admin", label: "Dashboard", icon: LayoutDashboard },
  { to: "/admin/hero", label: "Hero Slides", icon: ImageIcon },
  { to: "/admin/products", label: "Products", icon: Package },
  { to: "/admin/orders", label: "Orders", icon: ShoppingBag },
  { to: "/admin/payments", label: "Payments", icon: CreditCard },
  { to: "/admin/customers", label: "Customers", icon: Users },
  { to: "/admin/reviews", label: "Reviews", icon: Star },
  { to: "/admin/emails", label: "Emails", icon: Mail },
  { to: "/admin/admins", label: "Admins", icon: ShieldCheck, superOnly: true },
  { to: "/admin/settings", label: "Settings", icon: Settings },
];

interface AdminStatus {
  authenticated: boolean;
  isAdmin: boolean;
  email?: string | null;
  authProvider?: "oidc" | "password" | "admin-local" | null;
}

/**
 * Context that exposes the signed-in admin's identity (and crucially
 * their role) to every page rendered inside <AdminShell>. Pages call
 * `useAdminIdentity()` to gate UI on `role === "super_admin"`.
 */
const AdminIdentityContext = createContext<AdminIdentity | null>(null);

export function useAdminIdentity(): AdminIdentity | null {
  return useContext(AdminIdentityContext);
}

export function AdminShell({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const [status, setStatus] = useState<{
    loaded: boolean;
    data: AdminStatus | null;
    me: AdminIdentity | null;
  }>({ loaded: false, data: null, me: null });

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch("/api/auth/admin-status", { credentials: "include" }).then((r) =>
        r.json(),
      ),
      fetch("/api/admin-auth/me", { credentials: "include" })
        .then((r) => r.json())
        .catch(() => ({ admin: null })),
    ])
      .then(([d, meBody]: [AdminStatus, { admin: AdminIdentity | null }]) => {
        if (cancelled) return;
        setStatus({ loaded: true, data: d, me: meBody.admin ?? null });
      })
      .catch(() => !cancelled && setStatus({ loaded: true, data: null, me: null }));
    return () => {
      cancelled = true;
    };
  }, []);

  const signOut = async () => {
    // Clear whichever session we have. Calling both is safe — the
    // local-admin endpoint just clears the cookie, and the OIDC route
    // tolerates a missing session too.
    try {
      if (status.data?.authProvider === "admin-local") {
        await fetch("/api/admin-auth/logout", {
          method: "POST",
          credentials: "include",
        });
        window.location.href = "/admin/login";
      } else {
        window.location.href = "/api/logout";
      }
    } catch {
      window.location.href = "/admin/login";
    }
  };

  if (!status.loaded) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }

  if (!status.data?.isAdmin) {
    return <Redirect to="/admin/login" />;
  }

  const userLabel =
    status.me?.username ??
    status.data.email ??
    (status.data.authProvider === "admin-local" ? "Admin" : "Operator");

  const role: AdminRole = status.me?.role ?? "super_admin";
  const visibleNav = NAV.filter((n) => !n.superOnly || role === "super_admin");

  return (
    <AdminIdentityContext.Provider value={status.me}>
      <div className="min-h-screen flex bg-background">
        <aside className="w-64 border-r bg-gradient-to-b from-indigo-950 via-violet-950 to-slate-950 text-white flex flex-col">
          <div className="px-6 py-6 border-b border-white/10">
            <Link href="/admin">
              <span className="font-serif text-2xl font-bold bg-gradient-to-r from-indigo-300 via-violet-300 to-fuchsia-300 bg-clip-text text-transparent cursor-pointer">
                VELOUR
              </span>
            </Link>
            <p className="text-[10px] uppercase tracking-[0.25em] text-white/60 mt-1">
              Admin
            </p>
          </div>
          <nav className="flex-1 px-3 py-4 space-y-1">
            {visibleNav.map(({ to, label, icon: Icon }) => {
              const active =
                to === "/admin" ? location === "/admin" : location.startsWith(to);
              return (
                <Link
                  key={to}
                  href={to}
                  className={`flex items-center gap-3 px-3 py-2 rounded text-sm transition-colors ${
                    active
                      ? "bg-white/15 text-white"
                      : "text-white/70 hover:bg-white/10 hover:text-white"
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {label}
                </Link>
              );
            })}
          </nav>
          <div className="p-4 border-t border-white/10 space-y-2">
            <div className="text-xs text-white/80 truncate" data-testid="admin-user-label">
              {userLabel}
            </div>
            <div
              className={`inline-flex items-center text-[10px] uppercase tracking-widest px-2 py-0.5 rounded-full ${
                role === "super_admin"
                  ? "bg-fuchsia-500/20 text-fuchsia-200"
                  : "bg-white/10 text-white/70"
              }`}
              data-testid="admin-role-badge"
            >
              {role === "super_admin" ? "Super admin" : "Admin"}
            </div>
            <Link
              href="/"
              className="block text-xs text-white/70 hover:text-white"
            >
              ← Back to storefront
            </Link>
            <Button
              variant="outline"
              size="sm"
              className="w-full bg-transparent border-white/20 text-white hover:bg-white/10"
              onClick={signOut}
            >
              <LogOut className="w-3 h-3 mr-2" /> Sign out
            </Button>
          </div>
        </aside>
        <main className="flex-1 overflow-x-hidden">
          <div className="p-8 max-w-[1400px] mx-auto">{children}</div>
        </main>
      </div>
    </AdminIdentityContext.Provider>
  );
}

export function AdminPageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between mb-6 gap-4">
      <div>
        <h1 className="font-serif text-3xl font-bold">{title}</h1>
        {description && (
          <p className="text-sm text-muted-foreground mt-1">{description}</p>
        )}
      </div>
      {action}
    </div>
  );
}
