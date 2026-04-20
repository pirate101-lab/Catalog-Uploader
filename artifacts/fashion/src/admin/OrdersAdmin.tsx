import { useEffect, useState } from "react";
import { Link } from "wouter";
import { AdminShell, AdminPageHeader } from "./AdminShell";
import { adminApi, fmtCents, type OrderRow, type OrderEmailEvent } from "./api";
import { Button } from "@/components/ui/button";

const STATUSES = ["new", "packed", "shipped", "delivered", "cancelled"];

export function OrdersAdmin() {
  const [rows, setRows] = useState<OrderRow[] | null>(null);
  const [filter, setFilter] = useState<string>("all");

  useEffect(() => {
    const params = filter === "all" ? {} : { status: filter };
    adminApi.listOrders(params).then((d) => setRows(d.rows));
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
            {rows && rows.length === 0 && (
              <tr>
                <td colSpan={6} className="p-6 text-center text-muted-foreground">
                  No orders.
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
                <td className="p-3 text-right">{fmtCents(o.totalCents)}</td>
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
                      {it.color ?? ""} {it.size ? `· ${it.size}` : ""} · qty{" "}
                      {it.quantity}
                    </div>
                  </div>
                  <div className="text-sm">
                    {fmtCents(it.unitPriceCents * it.quantity)}
                  </div>
                </li>
              ))}
            </ul>
            <div className="mt-4 pt-4 border-t text-sm space-y-1">
              <Row label="Subtotal" value={fmtCents(order.subtotalCents)} />
              <Row label="Shipping" value={fmtCents(order.shippingCents)} />
              <Row label="Tax" value={fmtCents(order.taxCents)} />
              <Row
                label="Total"
                value={fmtCents(order.totalCents)}
                bold
              />
            </div>
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
            <EmailEventsCard events={order.emailEvents ?? []} />
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
  confirmation: "Order confirmation",
  shipped: "Shipped notification",
  delivered: "Delivered notification",
};

function EmailEventsCard({ events }: { events: OrderEmailEvent[] }) {
  const latestByKind = new Map<OrderEmailEvent["kind"], OrderEmailEvent>();
  for (const e of events) {
    latestByKind.set(e.kind, e);
  }
  const kinds: OrderEmailEvent["kind"][] = [
    "confirmation",
    "shipped",
    "delivered",
  ];
  return (
    <div className="border rounded-lg p-5">
      <h3 className="text-xs uppercase tracking-widest font-bold mb-3">
        Emails
      </h3>
      <ul className="space-y-3 text-sm">
        {kinds.map((k) => {
          const e = latestByKind.get(k);
          if (!e) {
            return (
              <li key={k} className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-medium">{EMAIL_KIND_LABEL[k]}</div>
                  <div className="text-xs text-muted-foreground">
                    Not sent yet
                  </div>
                </div>
                <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                  pending
                </span>
              </li>
            );
          }
          const tone =
            e.status === "sent"
              ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
              : e.status === "skipped"
              ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
              : "bg-rose-500/15 text-rose-700 dark:text-rose-300";
          return (
            <li key={k} className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="font-medium">{EMAIL_KIND_LABEL[k]}</div>
                <div className="text-xs text-muted-foreground">
                  {new Date(e.createdAt).toLocaleString()}
                  {e.toAddress ? ` · to ${e.toAddress}` : ""}
                </div>
                {(e.status === "failed" || e.status === "skipped") &&
                  e.errorMessage && (
                    <div className="text-xs text-rose-600 dark:text-rose-400 mt-1 break-words">
                      {e.statusCode ? `[${e.statusCode}] ` : ""}
                      {e.errorMessage}
                    </div>
                  )}
              </div>
              <span
                className={`text-xs px-2 py-0.5 rounded-full capitalize ${tone}`}
              >
                {e.status}
              </span>
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
