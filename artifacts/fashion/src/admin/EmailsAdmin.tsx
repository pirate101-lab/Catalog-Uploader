import { useCallback, useEffect, useState } from "react";
import { Link } from "wouter";
import { AdminShell, AdminPageHeader } from "./AdminShell";
import { adminApi, type EmailEventRow } from "./api";
import { Button } from "@/components/ui/button";

const PAGE_SIZE = 50;

const KIND_LABELS: Record<EmailEventRow["kind"], string> = {
  received: "Order received",
  confirmation: "Confirmation",
  shipped: "Shipped",
  delivered: "Delivered",
};

const STATUS_FILTERS: Array<{ value: ""; label: string } | { value: EmailEventRow["status"]; label: string }> = [
  { value: "", label: "All" },
  { value: "sent", label: "Sent" },
  { value: "failed", label: "Failed" },
  { value: "skipped", label: "Skipped" },
];

export function EmailsAdmin() {
  const [rows, setRows] = useState<EmailEventRow[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    adminApi
      .listEmailEvents({
        status: statusFilter || undefined,
        limit: PAGE_SIZE,
        offset,
      })
      .then((r) => {
        setRows(r.rows);
        setTotal(r.total);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [statusFilter, offset]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <AdminShell>
      <AdminPageHeader
        title="Email log"
        description="Most recent transactional emails sent for orders. Failed and skipped sends are visible here so staff can spot delivery problems."
      />

      <div className="flex flex-wrap gap-2 mb-4 items-center">
        {STATUS_FILTERS.map((f) => (
          <Button
            key={f.value || "all"}
            type="button"
            variant={statusFilter === f.value ? "default" : "outline"}
            size="sm"
            onClick={() => {
              setOffset(0);
              setStatusFilter(f.value);
            }}
          >
            {f.label}
          </Button>
        ))}
      </div>

      {error && (
        <div className="text-sm text-destructive mb-4" role="alert">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No email events yet.
        </p>
      ) : (
        <div className="border rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-widest text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-2 font-medium">When</th>
                <th className="text-left px-4 py-2 font-medium">Kind</th>
                <th className="text-left px-4 py-2 font-medium">Status</th>
                <th className="text-left px-4 py-2 font-medium">Recipient</th>
                <th className="text-left px-4 py-2 font-medium">Order</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-muted/20">
                  <td className="px-4 py-2 whitespace-nowrap text-muted-foreground">
                    {new Date(r.createdAt).toLocaleString()}
                  </td>
                  <td className="px-4 py-2 whitespace-nowrap">
                    {KIND_LABELS[r.kind] ?? r.kind}
                  </td>
                  <td className="px-4 py-2">
                    <StatusPill status={r.status} />
                    {r.errorMessage && (
                      <div className="text-xs text-destructive mt-1 max-w-xs truncate">
                        {r.errorMessage}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2 truncate max-w-[220px]">
                    {r.toAddress ?? "—"}
                  </td>
                  <td className="px-4 py-2">
                    <Link
                      href={`/admin/orders/${r.orderId}`}
                      className="text-primary hover:underline font-mono text-xs"
                    >
                      {r.orderId.slice(0, 8)}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex items-center justify-between mt-4 text-sm">
        <Button
          variant="outline"
          size="sm"
          disabled={offset === 0 || loading}
          onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
        >
          ← Previous
        </Button>
        <span className="text-muted-foreground">
          {total === 0
            ? "0 events"
            : `${offset + 1}–${Math.min(offset + rows.length, total)} of ${total}`}
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={offset + rows.length >= total || loading}
          onClick={() => setOffset((o) => o + PAGE_SIZE)}
        >
          Next →
        </Button>
      </div>
    </AdminShell>
  );
}

function StatusPill({ status }: { status: EmailEventRow["status"] }) {
  const cls =
    status === "sent"
      ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30"
      : status === "failed"
        ? "bg-red-500/10 text-red-700 dark:text-red-300 border-red-500/40"
        : "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/40";
  return (
    <span
      className={`inline-block text-[10px] uppercase tracking-widest font-bold px-2 py-0.5 rounded-full border ${cls}`}
    >
      {status}
    </span>
  );
}
