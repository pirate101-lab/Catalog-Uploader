import { useEffect, useState } from "react";
import { Link } from "wouter";
import { AdminShell, AdminPageHeader } from "./AdminShell";
import {
  adminApi,
  fmtCentsFor,
  type OrderRow,
  type OrderEmailEvent,
} from "./api";
import { Button } from "@/components/ui/button";

const STATUSES = ["new", "packed", "shipped", "delivered", "cancelled"];

export function OrdersAdmin() {
  const [rows, setRows] = useState<OrderRow[] | null>(null);
  const [filter, setFilter] = useState<string>("all");
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    const params = filter === "all" ? {} : { status: filter };
    let cancelled = false;
    setRows(null);
    setLoadError(null);
    adminApi
      .listOrders(params)
      .then((d) => {
        if (!cancelled) setRows(d.rows);
      })
      .catch((e: Error) => {
        if (!cancelled) {
          setLoadError(e.message || "Failed to load orders.");
          setRows([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [filter]);

  return (
    <AdminShell>
      <AdminPageHeader
        title="Orders"
        description="Submitted checkouts move through this pipeline."
      />
      <div className="flex gap-2 mb-4">
        {["all", ...STATUSES].map((s) => (
          <Button
            key={s}
            variant={filter === s ? "default" : "outline"}
            size="sm"
            onClick={() => setFilter(s)}
            className="capitalize"
          >
            {s}
          </Button>
        ))}
      </div>
      {loadError && (
        <p className="text-destructive text-sm mb-3" role="alert">
          {loadError}
        </p>
      )}
      <div className="border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase tracking-widest">
            <tr>
              <th className="p-3 text-left">Order</th>
              <th className="p-3 text-left">Customer</th>
              <th className="p-3 text-left">Items</th>
              <th className="p-3 text-right">Total</th>
              <th className="p-3 text-left">Status</th>
              <th className="p-3 text-left">Date</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {!rows && (
              <tr>
                <td colSpan={6} className="p-6 text-center text-muted-foreground">
                  Loading…
                </td>
              </tr>
            )}
            {rows && rows.length === 0 && !loadError && (
              <tr>
                <td colSpan={6} className="p-6 text-center text-muted-foreground">
                  No orders.
                </td>
              </tr>
            )}
            {rows && rows.length === 0 && loadError && (
              <tr>
                <td colSpan={6} className="p-6 text-center text-muted-foreground">
                  Couldn't load orders. See the error above.
                </td>
              </tr>
            )}
            {rows?.map((o) => (
              <tr key={o.id} className="hover:bg-muted/30">
                <td className="p-3">
                  <Link href={`/admin/orders/${o.id}`}>
                    <span className="font-mono text-xs hover:underline cursor-pointer">
                      {o.id.slice(0, 8)}
                    </span>
                  </Link>
                </td>
                <td className="p-3">
                  <div>{o.customerName ?? o.email}</div>
                  <div className="text-xs text-muted-foreground">{o.email}</div>
                </td>
                <td className="p-3 text-muted-foreground">
                  {Array.isArray(o.items) ? o.items.length : 0}
                </td>
                <td className="p-3 text-right">
                  {/* Lead with the storefront/display amount the
                      shopper actually saw (USD today). Show the
                      charge-currency total underneath when it differs
                      so operators can reconcile against Paystack. */}
                  <div>
                    {fmtCentsFor(
                      o.displayTotalCents ?? o.totalCents,
                      o.displayCurrency ?? o.currency,
                    )}
                  </div>
                  {o.displayCurrency &&
                  o.displayCurrency.toUpperCase() !==
                    o.currency.toUpperCase() ? (
                    <div className="text-xs text-muted-foreground">
                      {fmtCentsFor(o.totalCents, o.currency)} charged
                    </div>
                  ) : null}
                </td>
                <td className="p-3 capitalize">{o.status}</td>
                <td className="p-3 text-muted-foreground text-xs">
                  {new Date(o.createdAt).toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AdminShell>
  );
}

export function OrderDetailAdmin({ id }: { id: string }) {
  const [order, setOrder] = useState<OrderRow | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    adminApi
      .getOrder(id)
      .then(setOrder)
      .catch((e) => setError(e.message));

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const setStatus = async (s: string) => {
    await adminApi.setOrderStatus(id, s);
    load();
  };

  return (
    <AdminShell>
      <AdminPageHeader
        title="Order Detail"
        description={`Order ${id}`}
        action={
          <Link href="/admin/orders">
            <Button variant="outline" size="sm">
              ← Back
            </Button>
          </Link>
        }
      />
      {error && <p className="text-destructive text-sm">{error}</p>}
      {!order ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6">
          <section className="border rounded-lg p-6">
            <h3 className="text-xs uppercase tracking-widest font-bold mb-4">
              Items
            </h3>
            {(() => {
              // Hybrid-currency rendering: prefer the locked-in display
              // snapshot (USD) so the breakdown matches what the
              // shopper agreed to. Fall back to the canonical columns
              // for legacy orders that predate the FX-lock columns.
              const displayCurrency = order.displayCurrency ?? order.currency;
              const sub = order.displaySubtotalCents ?? order.subtotalCents;
              const ship = order.displayShippingCents ?? order.shippingCents;
              const tax = order.displayTaxCents ?? order.taxCents;
              const total = order.displayTotalCents ?? order.totalCents;
              const showCharge =
                !!order.displayCurrency &&
                displayCurrency.toUpperCase() !==
                  order.currency.toUpperCase();
              return (
                <>
                  <ul className="divide-y">
                    {order.items.map((it, i) => (
                      <li key={i} className="py-3 flex gap-3">
                        {it.image && (
                          <img
                            src={it.image}
                            alt=""
                            className="w-14 h-16 object-cover"
                          />
                        )}
                        <div className="flex-1">
                          <div className="text-sm font-medium">{it.title}</div>
                          <div className="text-xs text-muted-foreground">
                            {it.color ?? ""}{" "}
                            {it.size ? `· ${it.size}` : ""} · qty {it.quantity}
                          </div>
                        </div>
                        <div className="text-sm">
                          {fmtCentsFor(
                            it.unitPriceCents * it.quantity,
                            displayCurrency,
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                  <div className="mt-4 pt-4 border-t text-sm space-y-1">
                    <Row
                      label="Subtotal"
                      value={fmtCentsFor(sub, displayCurrency)}
                    />
                    <Row
                      label="Shipping"
                      value={fmtCentsFor(ship, displayCurrency)}
                    />
                    <Row label="Tax" value={fmtCentsFor(tax, displayCurrency)} />
                    <Row
                      label="Total"
                      value={fmtCentsFor(total, displayCurrency)}
                      bold
                    />
                    {showCharge ? (
                      <div className="pt-2 mt-2 border-t text-xs text-muted-foreground space-y-0.5">
                        <Row
                          label={`Charged (${order.currency})`}
                          value={fmtCentsFor(order.totalCents, order.currency)}
                        />
                        {order.fxRate ? (
                          <Row
                            label="FX rate"
                            value={`$1 ≈ ${Number(order.fxRate).toFixed(2)} ${order.currency}`}
                          />
                        ) : null}
                        {order.fxRateLockedAt ? (
                          <Row
                            label="Rate locked"
                            value={new Date(
                              order.fxRateLockedAt,
                            ).toLocaleString()}
                          />
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </>
              );
            })()}
          </section>
          <aside className="space-y-4">
            <div className="border rounded-lg p-5">
              <h3 className="text-xs uppercase tracking-widest font-bold mb-3">
                Customer
              </h3>
              <div className="text-sm">
                <div>{order.customerName ?? "—"}</div>
                <div className="text-muted-foreground">{order.email}</div>
                <div className="text-muted-foreground mt-2 text-xs">
                  {order.shippingAddress.address}
                  <br />
                  {order.shippingAddress.city}, {order.shippingAddress.state}{" "}
                  {order.shippingAddress.zip}
                  <br />
                  {order.shippingAddress.country}
                </div>
              </div>
            </div>
            <EmailEventsCard
              orderId={id}
              events={order.emailEvents ?? []}
              onChange={(events) =>
                setOrder((prev) => (prev ? { ...prev, emailEvents: events } : prev))
              }
            />
            <div className="border rounded-lg p-5">
              <h3 className="text-xs uppercase tracking-widest font-bold mb-3">
                Status
              </h3>
              <div className="text-sm mb-3 capitalize">{order.status}</div>
              <div className="grid grid-cols-2 gap-2">
                {STATUSES.map((s) => (
                  <Button
                    key={s}
                    size="sm"
                    variant={s === order.status ? "default" : "outline"}
                    onClick={() => setStatus(s)}
                    className="capitalize"
                  >
                    {s}
                  </Button>
                ))}
              </div>
            </div>
          </aside>
        </div>
      )}
    </AdminShell>
  );
}

const EMAIL_KIND_LABEL: Record<OrderEmailEvent["kind"], string> = {
  received: "Order received",
  confirmation: "Order confirmed",
  shipped: "Shipped notification",
  delivered: "Delivered notification",
};

const EMAIL_KIND_HINT: Record<OrderEmailEvent["kind"], string> = {
  received: "Sent automatically when the order is placed.",
  confirmation: "Sent when the status moves from new → packed.",
  shipped: "Sent when the status moves to shipped.",
  delivered: "Sent when the status moves to delivered.",
};

function EmailEventsCard({
  orderId,
  events,
  onChange,
}: {
  orderId: string;
  events: OrderEmailEvent[];
  onChange: (events: OrderEmailEvent[]) => void;
}) {
  const [busyKind, setBusyKind] = useState<OrderEmailEvent["kind"] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const latestByKind = new Map<OrderEmailEvent["kind"], OrderEmailEvent>();
  for (const e of events) {
    latestByKind.set(e.kind, e);
  }
  const kinds: OrderEmailEvent["kind"][] = [
    "received",
    "confirmation",
    "shipped",
    "delivered",
  ];

  const resend = async (kind: OrderEmailEvent["kind"]) => {
    setBusyKind(kind);
    setError(null);
    try {
      const result = await adminApi.resendOrderEmail(orderId, kind);
      onChange(result.emailEvents);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyKind(null);
    }
  };

  // Only warn when the *latest* attempt for a given kind is in a bad
  // state. A historical failure that's since been resent successfully
  // shouldn't keep the banner red.
  const anyFailed = [...latestByKind.values()].some(
    (e) => e.status === "failed" || e.status === "skipped",
  );

  return (
    <div className="border rounded-lg p-5">
      <h3 className="text-xs uppercase tracking-widest font-bold mb-3">
        Emails
      </h3>
      {anyFailed && (
        <p className="text-xs text-rose-600 dark:text-rose-400 mb-3">
          One or more emails didn't send — review the entries below and use
          Resend to try again.
        </p>
      )}
      {error && (
        <p className="text-xs text-rose-600 dark:text-rose-400 mb-3">
          {error}
        </p>
      )}
      <ul className="space-y-3 text-sm">
        {kinds.map((k) => {
          const e = latestByKind.get(k);
          const tone = !e
            ? "bg-muted text-muted-foreground"
            : e.status === "sent"
            ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
            : e.status === "skipped"
            ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
            : "bg-rose-500/15 text-rose-700 dark:text-rose-300";
          const statusLabel = !e ? "not sent" : e.status;
          return (
            <li key={k} className="flex flex-col gap-1.5 pb-3 last:pb-0 border-b last:border-b-0">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-medium">{EMAIL_KIND_LABEL[k]}</div>
                  <div className="text-xs text-muted-foreground">
                    {e
                      ? `${new Date(e.createdAt).toLocaleString()}${
                          e.toAddress ? ` · to ${e.toAddress}` : ""
                        }`
                      : EMAIL_KIND_HINT[k]}
                  </div>
                  {e &&
                    (e.status === "failed" || e.status === "skipped") &&
                    e.errorMessage && (
                      <div className="text-xs text-rose-600 dark:text-rose-400 mt-1 break-words">
                        {e.statusCode ? `[${e.statusCode}] ` : ""}
                        {e.errorMessage}
                      </div>
                    )}
                </div>
                <span
                  className={`text-xs px-2 py-0.5 rounded-full capitalize shrink-0 ${tone}`}
                >
                  {statusLabel}
                </span>
              </div>
              <div className="flex justify-end">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => resend(k)}
                  disabled={busyKind !== null}
                  className="h-7 px-3 text-xs"
                >
                  {busyKind === k ? "Sending…" : "Resend"}
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Row({
  label,
  value,
  bold,
}: {
  label: string;
  value: string;
  bold?: boolean;
}) {
  return (
    <div
      className={`flex justify-between ${bold ? "font-bold pt-2 border-t" : ""}`}
    >
      <span className="text-muted-foreground">{label}</span>
      <span>{value}</span>
    </div>
  );
}
