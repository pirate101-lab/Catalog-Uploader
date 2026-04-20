import { useEffect, useState } from "react";
import { AdminShell, AdminPageHeader } from "./AdminShell";
import { adminApi, fmtCents, type CustomerRow } from "./api";

export function CustomersAdmin() {
  const [rows, setRows] = useState<CustomerRow[] | null>(null);

  useEffect(() => {
    adminApi.listCustomers().then(setRows);
  }, []);

  return (
    <AdminShell>
      <AdminPageHeader
        title="Customers"
        description="Aggregated from submitted orders."
      />
      <div className="border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase tracking-widest">
            <tr>
              <th className="p-3 text-left">Email</th>
              <th className="p-3 text-left">Name</th>
              <th className="p-3 text-right">Orders</th>
              <th className="p-3 text-right">Lifetime spend</th>
              <th className="p-3 text-right">Wishlist</th>
              <th className="p-3 text-left">Last activity</th>
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
                  No customers yet.
                </td>
              </tr>
            )}
            {rows?.map((c) => {
              const lastTs = Math.max(
                c.lastOrderAt ? new Date(c.lastOrderAt).getTime() : 0,
                c.lastWishlistAt ? new Date(c.lastWishlistAt).getTime() : 0,
              );
              return (
                <tr key={c.email} className="hover:bg-muted/30">
                  <td className="p-3 font-mono text-xs">{c.email}</td>
                  <td className="p-3">{c.name ?? "—"}</td>
                  <td className="p-3 text-right">{c.orderCount}</td>
                  <td className="p-3 text-right">
                    {fmtCents(Number(c.totalSpentCents))}
                  </td>
                  <td className="p-3 text-right">{c.wishlistCount}</td>
                  <td className="p-3 text-muted-foreground text-xs">
                    {lastTs ? new Date(lastTs).toLocaleString() : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </AdminShell>
  );
}
