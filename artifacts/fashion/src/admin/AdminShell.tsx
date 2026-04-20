import { type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@workspace/replit-auth-web";
import {
  LayoutDashboard,
  ImageIcon,
  Package,
  ShoppingBag,
  Users,
  Settings,
  LogOut,
  ShieldAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";

const NAV: Array<{ to: string; label: string; icon: typeof LayoutDashboard }> = [
  { to: "/admin", label: "Dashboard", icon: LayoutDashboard },
  { to: "/admin/hero", label: "Hero Slides", icon: ImageIcon },
  { to: "/admin/products", label: "Products", icon: Package },
  { to: "/admin/orders", label: "Orders", icon: ShoppingBag },
  { to: "/admin/customers", label: "Customers", icon: Users },
  { to: "/admin/settings", label: "Settings", icon: Settings },
];

export function AdminShell({ children }: { children: ReactNode }) {
  const { user, isLoading, isAuthenticated, login, logout } = useAuth();
  const [location] = useLocation();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="max-w-md w-full p-10 border rounded-lg text-center space-y-6">
          <ShieldAlert className="w-10 h-10 mx-auto text-primary" />
          <div>
            <h1 className="font-serif text-3xl font-bold mb-2">VELOUR Admin</h1>
            <p className="text-sm text-muted-foreground">
              Sign in to manage the storefront.
            </p>
          </div>
          <Button onClick={login} className="w-full h-12">
            Sign in
          </Button>
        </div>
      </div>
    );
  }

  return (
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
          {NAV.map(({ to, label, icon: Icon }) => {
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
          <div className="text-xs text-white/60 truncate">
            {user?.email ?? user?.firstName ?? "Operator"}
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
            onClick={logout}
          >
            <LogOut className="w-3 h-3 mr-2" /> Sign out
          </Button>
        </div>
      </aside>
      <main className="flex-1 overflow-x-hidden">
        <div className="p-8 max-w-[1400px] mx-auto">{children}</div>
      </main>
    </div>
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
