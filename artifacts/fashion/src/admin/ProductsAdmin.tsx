import { useEffect, useMemo, useState } from "react";
import { AdminShell, AdminPageHeader } from "./AdminShell";
import {
  adminApi,
  type ProductOverride,
  type ProductRow,
} from "./api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { Search } from "lucide-react";

const PAGE = 50;

export function ProductsAdmin() {
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<ProductRow[]>([]);
  const [total, setTotal] = useState(0);
  const [overrides, setOverrides] = useState<Map<string, ProductOverride>>(
    new Map(),
  );
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    adminApi.listOverrides().then((arr) => {
      const m = new Map<string, ProductOverride>();
      for (const o of arr) m.set(o.productId, o);
      setOverrides(m);
    });
  }, []);

  useEffect(() => {
    setLoading(true);
    adminApi
      .listProducts({ q, limit: PAGE, offset: page * PAGE })
      .then((data) => {
        setRows(data.rows);
        setTotal(data.total);
      })
      .finally(() => setLoading(false));
  }, [q, page]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE));

  const setOv = async (productId: string, patch: Partial<ProductOverride>) => {
    const current = overrides.get(productId) ?? {
      productId,
      featured: false,
      hidden: false,
      priceOverride: null,
      badge: null,
    };
    const merged = { ...current, ...patch };
    const saved = await adminApi.upsertOverride(productId, merged);
    setOverrides((m) => new Map(m).set(productId, saved));
  };

  const bulk = async (patch: Partial<ProductOverride>) => {
    if (selected.size === 0) {
      toast.error("Select rows first");
      return;
    }
    await adminApi.bulkOverride([...selected], patch);
    toast.success(`Updated ${selected.size}`);
    setSelected(new Set());
    const arr = await adminApi.listOverrides();
    const m = new Map<string, ProductOverride>();
    for (const o of arr) m.set(o.productId, o);
    setOverrides(m);
  };

  const allChecked = useMemo(
    () => rows.length > 0 && rows.every((r) => selected.has(r.id)),
    [rows, selected],
  );

  return (
    <AdminShell>
      <AdminPageHeader
        title="Products"
        description={`${total.toLocaleString()} catalog rows. Edit overrides per product or in bulk.`}
      />

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative w-72">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search title…"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(0);
            }}
            className="pl-9"
          />
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-muted-foreground mr-2">
            {selected.size} selected
          </span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => bulk({ hidden: true })}
            disabled={selected.size === 0}
          >
            Hide
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => bulk({ hidden: false })}
            disabled={selected.size === 0}
          >
            Show
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => bulk({ featured: true })}
            disabled={selected.size === 0}
          >
            Feature
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => bulk({ badge: "NEW" })}
            disabled={selected.size === 0}
          >
            Badge "NEW"
          </Button>
        </div>
      </div>

      <div className="border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase tracking-widest">
            <tr>
              <th className="p-3 w-10">
                <Checkbox
                  checked={allChecked}
                  onCheckedChange={(v) => {
                    setSelected((s) => {
                      const next = new Set(s);
                      if (v) for (const r of rows) next.add(r.id);
                      else for (const r of rows) next.delete(r.id);
                      return next;
                    });
                  }}
                />
              </th>
              <th className="p-3 w-14">Img</th>
              <th className="p-3 text-left">Title</th>
              <th className="p-3 text-left">Category</th>
              <th className="p-3 text-right">Price</th>
              <th className="p-3 text-center">Hidden</th>
              <th className="p-3 text-center">Featured</th>
              <th className="p-3 text-left">Override $</th>
              <th className="p-3 text-left">Badge</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {loading && (
              <tr>
                <td colSpan={9} className="p-6 text-center text-muted-foreground">
                  Loading…
                </td>
              </tr>
            )}
            {!loading &&
              rows.map((r) => {
                const ov = overrides.get(r.id);
                return (
                  <tr key={r.id} className="hover:bg-muted/30">
                    <td className="p-3">
                      <Checkbox
                        checked={selected.has(r.id)}
                        onCheckedChange={(v) => {
                          setSelected((s) => {
                            const next = new Set(s);
                            if (v) next.add(r.id);
                            else next.delete(r.id);
                            return next;
                          });
                        }}
                      />
                    </td>
                    <td className="p-2">
                      {r.imageUrls[0] && (
                        <img
                          src={r.imageUrls[0]}
                          alt=""
                          className="w-10 h-12 object-cover"
                        />
                      )}
                    </td>
                    <td className="p-3">
                      <div className="font-medium line-clamp-1">{r.title}</div>
                      <div className="text-xs text-muted-foreground">
                        {r.id} · {r.gender}
                      </div>
                    </td>
                    <td className="p-3 capitalize text-muted-foreground">
                      {r.category ?? "—"}
                    </td>
                    <td className="p-3 text-right">${r.price}</td>
                    <td className="p-3 text-center">
                      <Checkbox
                        checked={!!ov?.hidden}
                        onCheckedChange={(v) => setOv(r.id, { hidden: !!v })}
                      />
                    </td>
                    <td className="p-3 text-center">
                      <Checkbox
                        checked={!!ov?.featured}
                        onCheckedChange={(v) => setOv(r.id, { featured: !!v })}
                      />
                    </td>
                    <td className="p-3">
                      <Input
                        defaultValue={ov?.priceOverride ?? ""}
                        placeholder="—"
                        className="h-8 w-24"
                        onBlur={(e) => {
                          const v = e.target.value.trim();
                          setOv(r.id, { priceOverride: v === "" ? null : v });
                        }}
                      />
                    </td>
                    <td className="p-3">
                      <Input
                        defaultValue={ov?.badge ?? ""}
                        placeholder="—"
                        className="h-8 w-28"
                        onBlur={(e) => {
                          const v = e.target.value.trim();
                          setOv(r.id, { badge: v === "" ? null : v });
                        }}
                      />
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between mt-4 text-sm">
        <span className="text-muted-foreground">
          Page {page + 1} of {totalPages}
        </span>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages - 1}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </div>
      </div>
    </AdminShell>
  );
}
