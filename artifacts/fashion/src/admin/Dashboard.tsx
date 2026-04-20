import { useEffect, useState } from "react";
import { Link } from "wouter";
import { AdminShell, AdminPageHeader } from "./AdminShell";
import { adminApi, fmtCents, type AdminOverview } from "./api";
import {
  Package,
  ShoppingBag,
  DollarSign,
  TrendingUp,
  AlertTriangle,
  MailWarning,
  Calculator,
  CalendarDays,
} from "lucide-react";

const FUNNEL_LABELS: Array<{ key: string; label: string; color: string }> = [
  { key: "new", label: "Pending", color: "bg-amber-500" },
  { key: "packed", label: "Packed", color: "bg-blue-500" },
  { key: "shipped", label: "Shipped", color: "bg-violet-500" },
  { key: "delivered", label: "Delivered", color: "bg-emerald-500" },
  { key: "cancelled", label: "Cancelled", color: "bg-red-500" },
];

export function AdminDashboard() {
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    adminApi
      .getOverview()
      .then((o) => !cancelled && setOverview(o))
      .catch((e) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, []);

  const funnelTotal = overview
    ? Object.values(overview.funnel).reduce((a, b) => a + b, 0)
    : 0;

  return (
    <AdminShell>
      <AdminPageHeader
        title="Overview"
        description="Activity across the storefront."
      />
      {error && <div className="text-sm text-destructive mb-4">{error}</div>}
      {!overview ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : (
        <>
          {/* Window KPIs — orders + revenue + AOV across today / week / month */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <WindowCard
              title="Today"
              icon={<CalendarDays className="w-4 h-4" />}
              window={overview.today}
            />
            <WindowCard
              title="Last 7 days"
              icon={<TrendingUp className="w-4 h-4" />}
              window={overview.week}
            />
            <WindowCard
              title="Last 30 days"
              icon={<DollarSign className="w-4 h-4" />}
              window={overview.month}
            />
          </div>

          {/* Secondary KPIs */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            <Kpi
              icon={<Package className="w-4 h-4" />}
              label="Products"
              value={overview.productsCount.toLocaleString()}
            />
            <Kpi
              icon={<ShoppingBag className="w-4 h-4" />}
              label="Orders today"
              value={overview.today.count.toLocaleString()}
              sub={`${overview.week.count} this week`}
            />
            <Kpi
              icon={<AlertTriangle className="w-4 h-4" />}
              label="Low stock"
              value={overview.lowStockProducts.length.toLocaleString()}
              sub={
                overview.lowStockProducts.length === 0
                  ? "All good"
                  : "Needs attention"
              }
            />
            <Kpi
              icon={<MailWarning className="w-4 h-4" />}
              label="Emails failed 24h"
              value={overview.emailsFailed24h.toLocaleString()}
              sub={
                overview.emailsFailed24h === 0
                  ? "All delivered"
                  : "Check Emails tab"
              }
            />
          </div>

          {/* Funnel + Top sellers side-by-side on desktop */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
            <section className="border rounded-lg p-6">
              <h2 className="text-xs uppercase tracking-widest font-bold mb-4 flex items-center gap-2">
                <Calculator className="w-4 h-4" /> Order status funnel
              </h2>
              {funnelTotal === 0 ? (
                <p className="text-sm text-muted-foreground">No orders yet.</p>
              ) : (
                <ul className="space-y-3">
                  {FUNNEL_LABELS.map(({ key, label, color }) => {
                    const count = overview.funnel[key] ?? 0;
                    const pct = funnelTotal > 0 ? (count / funnelTotal) * 100 : 0;
                    return (
                      <li key={key}>
                        <div className="flex justify-between text-sm mb-1">
                          <span className="font-medium">{label}</span>
                          <span className="text-muted-foreground">
                            {count} · {pct.toFixed(0)}%
                          </span>
                        </div>
                        <div className="h-2 bg-muted rounded-full overflow-hidden">
                          <div
                            className={`h-full ${color} transition-all`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <section className="border rounded-lg p-6">
              <h2 className="text-xs uppercase tracking-widest font-bold mb-4">
                Top 5 best sellers
              </h2>
              {overview.topSellers.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No sales recorded yet.
                </p>
              ) : (
                <ol className="space-y-2">
                  {overview.topSellers.map((p, i) => (
                    <li
                      key={p.productId}
                      className="flex items-center justify-between gap-3 text-sm"
                    >
                      <span className="flex items-center gap-3 min-w-0">
                        <span className="text-muted-foreground tabular-nums w-5">
                          {i + 1}.
                        </span>
                        <span className="truncate">{p.title}</span>
                      </span>
                      <span className="text-muted-foreground whitespace-nowrap">
                        {p.qty} sold · {fmtCents(p.revenueCents)}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </div>

          {overview.lowStockProducts.length > 0 && (
            <section className="border rounded-lg p-6 mb-6 border-amber-500/40 bg-amber-500/5">
              <h2 className="text-xs uppercase tracking-widest font-bold mb-4 flex items-center gap-2 text-amber-700 dark:text-amber-300">
                <AlertTriangle className="w-4 h-4" />
                Low stock alerts
              </h2>
              <ul className="divide-y">
                {overview.lowStockProducts.map((p) => (
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

          <section className="border rounded-lg p-6">
            <h2 className="text-xs uppercase tracking-widest font-bold mb-4">
              Recent orders
            </h2>
            {overview.recentOrders.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No orders yet. Submitted checkouts will show up here.
              </p>
            ) : (
              <ul className="divide-y">
                {overview.recentOrders.map((o) => (
                  <li
                    key={o.id}
                    className="py-2 text-sm flex justify-between gap-3"
                  >
                    <Link
                      href={`/admin/orders/${o.id}`}
                      className="hover:underline truncate"
                    >
                      {o.email}
                    </Link>
                    <span className="text-muted-foreground whitespace-nowrap">
                      {fmtCents(o.totalCents)} · {o.status}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </AdminShell>
  );
}

function WindowCard({
  title,
  icon,
  window,
}: {
  title: string;
  icon: React.ReactNode;
  window: { count: number; revenueCents: number; aovCents: number };
}) {
  return (
    <div className="border rounded-lg p-5 bg-gradient-to-br from-indigo-50 to-violet-50 dark:from-indigo-950/30 dark:to-violet-950/30">
      <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground mb-3">
        {icon}
        {title}
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
            Orders
          </div>
          <div className="text-xl font-bold">{window.count.toLocaleString()}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
            Revenue
          </div>
          <div className="text-xl font-bold">{fmtCents(window.revenueCents)}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
            AOV
          </div>
          <div className="text-xl font-bold">{fmtCents(window.aovCents)}</div>
        </div>
      </div>
    </div>
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
