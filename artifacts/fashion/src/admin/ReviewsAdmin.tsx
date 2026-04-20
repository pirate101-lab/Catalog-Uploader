import { useCallback, useEffect, useState } from "react";
import { AdminShell, AdminPageHeader } from "./AdminShell";
import { adminApi, type ReviewRow } from "./api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Star, Trash2 } from "lucide-react";

const PAGE_SIZE = 25;

export function ReviewsAdmin() {
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [productFilter, setProductFilter] = useState("");
  const [appliedFilter, setAppliedFilter] = useState("");
  const [offset, setOffset] = useState(0);
  const [pendingDelete, setPendingDelete] = useState<number | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    adminApi
      .listReviews({
        productId: appliedFilter || undefined,
        limit: PAGE_SIZE,
        offset,
      })
      .then((r) => setRows(r.rows))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [appliedFilter, offset]);

  useEffect(() => {
    load();
  }, [load]);

  const onDelete = async (id: number) => {
    if (
      typeof window !== "undefined" &&
      !window.confirm("Delete this review? This cannot be undone.")
    ) {
      return;
    }
    setPendingDelete(id);
    try {
      await adminApi.deleteReview(id);
      toast.success("Review deleted");
      load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setPendingDelete(null);
    }
  };

  const applyFilter = () => {
    setOffset(0);
    setAppliedFilter(productFilter.trim());
  };

  return (
    <AdminShell>
      <AdminPageHeader
        title="Reviews"
        description="Moderate customer reviews. Deletions also refresh the cached product rating."
      />

      <div className="flex flex-wrap gap-2 mb-4 items-end">
        <div className="flex-1 min-w-[240px]">
          <label
            htmlFor="reviewProductFilter"
            className="block text-xs uppercase tracking-widest text-muted-foreground mb-1"
          >
            Filter by product ID
          </label>
          <Input
            id="reviewProductFilter"
            value={productFilter}
            onChange={(e) => setProductFilter(e.target.value)}
            placeholder="e.g. m-12345 or 67890"
            onKeyDown={(e) => {
              if (e.key === "Enter") applyFilter();
            }}
          />
        </div>
        <Button type="button" variant="outline" onClick={applyFilter}>
          Apply
        </Button>
        {appliedFilter && (
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setProductFilter("");
              setAppliedFilter("");
              setOffset(0);
            }}
          >
            Clear
          </Button>
        )}
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
          {appliedFilter
            ? "No reviews for that product."
            : "No reviews yet."}
        </p>
      ) : (
        <ul className="border rounded-lg divide-y">
          {rows.map((r) => (
            <li key={r.id} className="p-4 flex flex-col sm:flex-row gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <RatingStars value={r.rating} />
                  <span className="font-semibold text-sm">{r.name}</span>
                  {r.verifiedPurchase && (
                    <span className="text-[10px] uppercase tracking-widest font-bold text-emerald-700 dark:text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full">
                      Verified
                    </span>
                  )}
                  {r.seeded && (
                    <span className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                      Seeded
                    </span>
                  )}
                </div>
                {r.title && (
                  <div className="font-medium text-sm mb-1">{r.title}</div>
                )}
                <p className="text-sm text-muted-foreground whitespace-pre-wrap break-words">
                  {r.body}
                </p>
                <div className="text-xs text-muted-foreground mt-2 flex flex-wrap gap-3">
                  <span>Product: {r.productId}</span>
                  <span>{new Date(r.createdAt).toLocaleString()}</span>
                  {r.email && <span>{r.email}</span>}
                </div>
              </div>
              <div className="sm:self-start">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => onDelete(r.id)}
                  disabled={pendingDelete === r.id}
                  aria-label={`Delete review by ${r.name}`}
                >
                  <Trash2 className="w-3 h-3 mr-1" />
                  {pendingDelete === r.id ? "Deleting…" : "Delete"}
                </Button>
              </div>
            </li>
          ))}
        </ul>
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
          Showing {rows.length === 0 ? 0 : offset + 1}–{offset + rows.length}
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={rows.length < PAGE_SIZE || loading}
          onClick={() => setOffset((o) => o + PAGE_SIZE)}
        >
          Next →
        </Button>
      </div>
    </AdminShell>
  );
}

function RatingStars({ value }: { value: number }) {
  return (
    <span
      className="inline-flex items-center"
      aria-label={`${value} out of 5 stars`}
    >
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          className={`w-3.5 h-3.5 ${
            n <= value
              ? "fill-amber-400 text-amber-400"
              : "text-muted-foreground/40"
          }`}
        />
      ))}
    </span>
  );
}
