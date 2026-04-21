import { useCallback, useEffect, useState } from "react";
import { Link } from "wouter";
import { toast } from "sonner";
import { AdminShell, AdminPageHeader } from "./AdminShell";
import { adminApi, fmtCents, type AdminOverview, type PaymentEventRow } from "./api";
import { usePaymentEventStream } from "./usePaymentEventStream";
import {
  Package,
  ShoppingBag,
  DollarSign,
  TrendingUp,
  AlertTriangle,
  MailWarning,
  Calculator,
  CalendarDays,
  CreditCard,
  Activity,
  CheckCircle2,
  XCircle,
  Clock,
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
  const [liveEvents, setLiveEvents] = useState<PaymentEventRow[]>([]);

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

  // Real-time Paystack alerts. Successes also bump the live KPIs so the
  // operator doesn't have to refresh; failures + abandoned charges are
  // surfaced as toasts pointing at the matching order page.
  const handlePaymentEvent = useCallback((ev: PaymentEventRow) => {
    setLiveEvents((prev) => {
      if (prev.some((p) => p.id === ev.id)) return prev;
      return [ev, ...prev].slice(0, 8);
    });
    if (ev.kind === "success") {
      const amt = ev.amountCents != null ? ` ${fmtCents(ev.amountCents)}` : "";
      toast.success(`Payment received${amt}`, {
        description: ev.message ?? "Order marked as paid.",
        action: ev.orderId
          ? {
              label: "View order",
              onClick: () => {
                window.location.assign(`/admin/orders/${ev.orderId}`);
              },
            }
          : undefined,
      });
      // Optimistically bump today's payments KPI without a re-fetch.
      setOverview((prev) =>
        prev
          ? {
              ...prev,
              paymentsToday: {
                count: prev.paymentsToday.count + 1,
                revenueCents:
                  prev.paymentsToday.revenueCents + (ev.amountCents ?? 0),
              },
            }
          : prev,
      );
    } else if (ev.kind === "failed") {
      toast.error("Payment failed", {
        description: ev.message ?? `Paystack reported ${ev.code}.`,
        action: ev.orderId
          ? {
              label: "View order",
              onClick: () => {
                window.location.assign(`/admin/orders/${ev.orderId}`);
              },
            }
          : undefined,
      });
    } else {
      // abandoned — quieter, info toast.
      toast(`Checkout abandoned`, {
        description: ev.message ?? "Customer left Paystack without paying.",
      });
    }
  }, []);
  usePaymentEventStream(handlePaymentEvent);

  const funnelTotal = overview
    ? Object.values(overview.funnel).reduce((a, b) => a + b, 0)
    : 0;

  return (
    <AdminShell>
      <AdminPageHeader
        title="Overview"
        description="Activity across the storefront."
        action={
          overview ? (
            <PaystackPill
              status={overview.paystackStatus}
              testMode={overview.paystackTestMode}
            />
          ) : null
        }
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
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
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
              icon={<CreditCard className="w-4 h-4" />}
              label="Payments today"
              value={overview.paymentsToday.count.toLocaleString()}
              sub={fmtCents(overview.paymentsToday.revenueCents)}
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

          {liveEvents.length > 0 && (
            <section
              className="border rounded-lg p-6 mb-6 border-sky-500/40 bg-sky-500/5"
              data-testid="dashboard-live-payments"
            >
              <h2 className="text-xs uppercase tracking-widest font-bold mb-4 flex items-center gap-2 text-sky-700 dark:text-sky-300">
                <Activity className="w-4 h-4" />
                Live payment activity
                <span className="ml-auto inline-flex items-center gap-1 text-[10px] uppercase tracking-widest text-sky-700/70 dark:text-sky-300/70">
                  <span className="w-1.5 h-1.5 rounded-full bg-sky-500 animate-pulse" />
                  Streaming
                </span>
              </h2>
              <ul className="divide-y">
                {liveEvents.map((ev) => (
                  <LivePaymentRow key={ev.id} event={ev} />
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

function PaystackPill({
  status,
  testMode,
}: {
  status: AdminOverview["paystackStatus"];
  testMode: boolean;
}) {
  const config: Record<
    AdminOverview["paystackStatus"],
    { label: string; className: string }
  > = {
    enabled: {
      label: testMode ? "Paystack: Test mode" : "Paystack: Live",
      className:
        "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
    },
    disabled: {
      label: "Paystack: Disabled",
      className:
        "bg-muted text-muted-foreground border-border",
    },
    keys_missing: {
      label: "Paystack: Keys missing",
      className:
        "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30",
    },
  };
  const c = config[status];
  return (
    <Link
      href="/admin/payments"
      className={`inline-flex items-center gap-2 text-xs px-3 py-1.5 border rounded-full hover:opacity-90 transition ${c.className}`}
      data-testid="dashboard-paystack-pill"
    >
      <CreditCard className="w-3 h-3" />
      {c.label}
    </Link>
  );
}

function LivePaymentRow({ event }: { event: PaymentEventRow }) {
  const Icon =
    event.kind === "success"
      ? CheckCircle2
      : event.kind === "abandoned"
        ? Clock
        : XCircle;
  const color =
    event.kind === "success"
      ? "text-emerald-600 dark:text-emerald-400"
      : event.kind === "abandoned"
        ? "text-amber-600 dark:text-amber-400"
        : "text-destructive";
  const label =
    event.kind === "success"
      ? "Paid"
      : event.kind === "abandoned"
        ? "Abandoned"
        : "Failed";
  const body = (
    <div className="py-2 flex items-center gap-3 text-sm">
      <Icon className={`w-4 h-4 shrink-0 ${color}`} />
      <span className={`text-xs uppercase tracking-widest font-semibold ${color}`}>
        {label}
      </span>
      <span className="truncate flex-1 text-muted-foreground">
        {event.message ?? event.code}
      </span>
      {event.amountCents != null && (
        <span className="whitespace-nowrap font-medium">
          {fmtCents(event.amountCents)}
        </span>
      )}
      <span className="text-[11px] text-muted-foreground whitespace-nowrap">
        {new Date(event.createdAt).toLocaleTimeString()}
      </span>
    </div>
  );
  return event.orderId ? (
    <li>
      <Link
        href={`/admin/orders/${event.orderId}`}
        className="block hover:bg-sky-500/10 -mx-2 px-2 rounded transition"
      >
        {body}
      </Link>
    </li>
  ) : (
    <li>{body}</li>
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
