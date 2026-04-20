import { useEffect, useState } from "react";
import { Link } from "wouter";
import { AdminShell, AdminPageHeader } from "./AdminShell";
import { adminApi, fmtCents, type DashboardStats } from "./api";
import {
  Package,
  ShoppingBag,
  DollarSign,
  TrendingUp,
  AlertTriangle,
  MailWarning,
} from "lucide-react";

export function AdminDashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    adminApi
      .getStats()
      .then((s) => !cancelled && setStats(s))
      .catch((e) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <AdminShell>
      <AdminPageHeader
        title="Dashboard"
        description="Activity across the storefront."
      />
      {error && (
        <div className="text-sm text-destructive mb-4">{error}</div>
      )}
      {!stats ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-6 gap-4 mb-8">
            <Kpi
              icon={<Package className="w-4 h-4" />}
              label="Products"
              value={stats.products.toLocaleString()}
            />
            <Kpi
              icon={<ShoppingBag className="w-4 h-4" />}
              label="Orders today"
              value={stats.ordersToday.toLocaleString()}
              sub={`${stats.ordersWeek} this week`}
            />
            <Kpi
              icon={<DollarSign className="w-4 h-4" />}
              label="Revenue today"
              value={fmtCents(stats.revenueTodayCents)}
            />
            <Kpi
              icon={<TrendingUp className="w-4 h-4" />}
              label="Revenue 7d"
              value={fmtCents(stats.revenueWeekCents)}
            />
            <Kpi
              icon={<AlertTriangle className="w-4 h-4" />}
              label="Low stock"
              value={stats.lowStockCount.toLocaleString()}
              sub={
                stats.lowStockCount === 0
                  ? "All good"
                  : "Needs attention"
              }
            />
            <Kpi
              icon={<MailWarning className="w-4 h-4" />}
              label="Emails failed 24h"
              value={(stats.emailsFailed24h ?? 0).toLocaleString()}
              sub={
                (stats.emailsFailed24h ?? 0) === 0
                  ? "All delivered"
                  : "Check order details"
              }
            />
          </div>

          {stats.lowStockProducts.length > 0 && (
            <section className="border rounded-lg p-6 mb-6 border-amber-500/40 bg-amber-500/5">
              <h2 className="text-xs uppercase tracking-widest font-bold mb-4 flex items-center gap-2 text-amber-700 dark:text-amber-300">
                <AlertTriangle className="w-4 h-4" />
                Low stock alerts
              </h2>
              <ul className="divide-y">
                {stats.lowStockProducts.map((p) => (
                  <li
                    key={p.productId}
                    className="py-2 text-sm flex justify-between"
                  >
                    <span className="truncate pr-4">{p.title}</span>
                    <span className="text-amber-700 dark:text-amber-400 font-medium">
                      {p.stockLevel} left
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <section className="border rounded-lg p-6">
              <h2 className="text-xs uppercase tracking-widest font-bold mb-4">
                Top categories
              </h2>
              <ul className="space-y-2 text-sm">
                {stats.topCategories.map((c) => (
                  <li key={c.slug} className="flex justify-between">
                    <span className="capitalize">{c.slug.replace(/-/g, " ")}</span>
                    <span className="text-muted-foreground">{c.count}</span>
                  </li>
                ))}
                {stats.topCategories.length === 0 && (
                  <li className="text-muted-foreground">No data</li>
                )}
              </ul>
            </section>
            <section className="border rounded-lg p-6">
              <h2 className="text-xs uppercase tracking-widest font-bold mb-4">
                Recent orders
              </h2>
              {stats.recentOrders.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No orders yet. Submitted checkouts will show up here.
                </p>
              ) : (
                <ul className="divide-y">
                  {stats.recentOrders.map((o) => (
                    <li key={o.id} className="py-2 text-sm flex justify-between">
                      <Link href={`/admin/orders/${o.id}`}>
                        <span className="hover:underline cursor-pointer">
                          {o.email}
                        </span>
                      </Link>
                      <span className="text-muted-foreground">
                        {fmtCents(o.totalCents)} · {o.status}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </>
      )}
    </AdminShell>
  );
}

function Kpi({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="border rounded-lg p-5 bg-gradient-to-br from-indigo-50 to-violet-50 dark:from-indigo-950/30 dark:to-violet-950/30">
      <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="mt-2 text-2xl font-bold">{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
    </div>
  );
}
