import { useEffect, useMemo, useRef, useState } from "react";
import { AdminShell, AdminPageHeader } from "./AdminShell";
import {
  adminApi,
  type CustomProductInput,
  type ProductOverride,
  type ProductRow,
} from "./api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { Plus, Search, Upload, Loader2 } from "lucide-react";

type Row = ProductRow & { override: ProductOverride | null };

interface DraftFields {
  title: string;
  category: string;
  subCategory: string;
  price: string;
  badge: string;
  featured: boolean;
  hidden: boolean;
  stockLevel: string;
  imageUrl: string;
  sizesCsv: string;
  /** Free-form "Name #hex" lines, one per color. */
  colorsText: string;
  gender: "men" | "women";
}

function parseColorsText(
  text: string,
): { name: string; hex: string }[] {
  const out: { name: string; hex: string }[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    // Expected format: "Color Name #aabbcc"  (last token is the hex)
    const m = line.match(/^(.*?)\s+(#[0-9a-fA-F]{3,8})\s*$/);
    if (!m) continue;
    out.push({ name: m[1]!.trim(), hex: m[2]!.toLowerCase() });
  }
  return out;
}

function colorsToText(arr: { name: string; hex: string }[] | null | undefined) {
  if (!arr || arr.length === 0) return "";
  return arr.map((c) => `${c.name} ${c.hex}`).join("\n");
}

function rowToDraft(r: Row): DraftFields {
  const ov = r.override;
  return {
    title: ov?.titleOverride ?? r.title,
    category: r.category ?? "",
    subCategory: ov?.subCategoryOverride ?? r.subCategory ?? "",
    price: ov?.priceOverride ?? r.price,
    badge: ov?.badge ?? r.badge ?? "",
    featured: !!(ov?.featured ?? r.featured),
    hidden: !!ov?.hidden,
    stockLevel: ov?.stockLevel != null ? String(ov.stockLevel) : "",
    imageUrl: ov?.imageUrlOverride ?? r.imageUrls?.[0] ?? "",
    sizesCsv: (ov?.sizesOverride ?? r.sizes ?? []).join(", "),
    colorsText: colorsToText(ov?.colorsOverride ?? r.colors ?? []),
    gender: (ov?.genderOverride ?? r.gender) as "men" | "women",
  };
}

const EMPTY_DRAFT: DraftFields = {
  title: "",
  category: "",
  subCategory: "",
  price: "",
  badge: "",
  featured: false,
  hidden: false,
  stockLevel: "",
  imageUrl: "",
  sizesCsv: "",
  colorsText: "",
  gender: "women",
};

export function ProductsAdmin() {
  const [q, setQ] = useState("");
  const [showDeleted, setShowDeleted] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);
  const [editing, setEditing] = useState<Row | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<DraftFields>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Row | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    adminApi
      .listProducts({
        q,
        limit: 2000,
        includeDeleted: showDeleted,
      })
      .then((data) => {
        if (cancelled) return;
        setRows(data.rows as Row[]);
      })
      .catch((e) => toast.error(`Load failed: ${(e as Error).message}`))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [q, showDeleted, reloadTick]);

  const reload = () => setReloadTick((n) => n + 1);

  const grouped = useMemo(() => {
    const m = new Map<string, Row[]>();
    for (const r of rows) {
      const cat = r.category || "Uncategorized";
      const arr = m.get(cat) ?? [];
      arr.push(r);
      m.set(cat, arr);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [rows]);

  const openEdit = (r: Row) => {
    setEditing(r);
    setCreating(false);
    setDraft(rowToDraft(r));
  };
  const openCreate = () => {
    setEditing(null);
    setCreating(true);
    setDraft(EMPTY_DRAFT);
  };
  const closeDrawer = () => {
    setEditing(null);
    setCreating(false);
  };

  const handleUpload = async (file: File) => {
    setUploading(true);
    try {
      const { publicUrl } = await adminApi.uploadProductImage(file);
      setDraft((d) => ({ ...d, imageUrl: publicUrl }));
      toast.success("Image uploaded");
    } catch (e) {
      toast.error(`Upload failed: ${(e as Error).message}`);
    } finally {
      setUploading(false);
    }
  };

  const handleSave = async () => {
    if (!draft.title.trim()) {
      toast.error("Title is required");
      return;
    }
    if (!draft.category.trim()) {
      toast.error("Category is required");
      return;
    }
    setSaving(true);
    try {
      const sizes = draft.sizesCsv
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const colors = parseColorsText(draft.colorsText);
      const stock =
        draft.stockLevel.trim() === "" ? null : Number(draft.stockLevel);

      if (creating) {
        const body: CustomProductInput = {
          title: draft.title.trim(),
          category: draft.category.trim(),
          subCategory: draft.subCategory.trim() || null,
          price: draft.price || "0",
          gender: draft.gender,
          imageUrl: draft.imageUrl.trim(),
          sizes,
          colors,
          badge: draft.badge.trim() || null,
          featured: draft.featured,
          hidden: draft.hidden,
          stockLevel: stock,
        };
        await adminApi.createCustomProduct(body);
        toast.success("Product created");
      } else if (editing) {
        if (editing.id.startsWith("cust_")) {
          // Custom product — edit in-place on custom_products table.
          await adminApi.updateCustomProduct(editing.id, {
            title: draft.title.trim(),
            category: draft.category.trim(),
            subCategory: draft.subCategory.trim() || null,
            price: draft.price || "0",
            gender: draft.gender,
            imageUrl: draft.imageUrl.trim(),
            sizes,
            colors,
            badge: draft.badge.trim() || null,
            featured: draft.featured,
            hidden: draft.hidden,
            stockLevel: stock,
          });
        } else {
          // JSON-catalog product — write through product_overrides so
          // the underlying read-only catalog file stays untouched.
          const ovPatch: Partial<ProductOverride> = {
            featured: draft.featured,
            hidden: draft.hidden,
            priceOverride:
              draft.price && draft.price !== editing.price
                ? draft.price
                : null,
            badge: draft.badge.trim() || null,
            stockLevel: stock,
            categoryOverride:
              draft.category.trim() && draft.category.trim() !== editing.category
                ? draft.category.trim()
                : null,
            subCategoryOverride:
              draft.subCategory.trim() &&
              draft.subCategory.trim() !== (editing.subCategory ?? "")
                ? draft.subCategory.trim()
                : null,
            titleOverride:
              draft.title.trim() && draft.title.trim() !== editing.title
                ? draft.title.trim()
                : null,
            imageUrlOverride:
              draft.imageUrl.trim() &&
              draft.imageUrl.trim() !== (editing.imageUrls?.[0] ?? "")
                ? draft.imageUrl.trim()
                : null,
            sizesOverride:
              sizes.length > 0 &&
              sizes.join(",") !== (editing.sizes ?? []).join(",")
                ? sizes
                : null,
            colorsOverride:
              colors.length > 0 &&
              JSON.stringify(colors) !==
                JSON.stringify(editing.colors ?? [])
                ? colors
                : null,
            genderOverride:
              draft.gender !== editing.gender ? draft.gender : null,
          };
          await adminApi.upsertOverride(editing.id, ovPatch);
        }
        toast.success("Product updated");
      }
      closeDrawer();
      reload();
    } catch (e) {
      toast.error(`Save failed: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (r: Row) => {
    try {
      await adminApi.softDeleteProduct(r.id);
      toast.success(`Deleted "${r.title}"`, {
        action: {
          label: "Undo",
          onClick: async () => {
            try {
              await adminApi.restoreProduct(r.id);
              reload();
            } catch (e) {
              toast.error(`Undo failed: ${(e as Error).message}`);
            }
          },
        },
      });
      setConfirmDelete(null);
      reload();
    } catch (e) {
      toast.error(`Delete failed: ${(e as Error).message}`);
    }
  };

  const handleRestore = async (r: Row) => {
    try {
      await adminApi.restoreProduct(r.id);
      toast.success(`Restored "${r.title}"`);
      reload();
    } catch (e) {
      toast.error(`Restore failed: ${(e as Error).message}`);
    }
  };

  return (
    <AdminShell>
      <AdminPageHeader
        title="Products"
        description={`${rows.length.toLocaleString()} products across ${grouped.length} ${grouped.length === 1 ? "category" : "categories"}.`}
        action={
          <Button onClick={openCreate} size="sm">
            <Plus className="w-4 h-4 mr-1" /> Add product
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative w-72">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search title or id…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Switch
            id="show-deleted"
            checked={showDeleted}
            onCheckedChange={setShowDeleted}
          />
          <Label htmlFor="show-deleted" className="text-sm cursor-pointer">
            Show deleted
          </Label>
        </div>
      </div>

      {loading && (
        <div className="text-sm text-muted-foreground py-8 text-center">
          Loading…
        </div>
      )}

      {!loading && grouped.length === 0 && (
        <div className="border rounded-lg p-12 text-center text-muted-foreground">
          No products match your filters.
        </div>
      )}

      {!loading && grouped.length > 0 && (
        <Accordion type="multiple" className="space-y-2">
          {grouped.map(([cat, items]) => (
            <AccordionItem
              key={cat}
              value={cat}
              className="border rounded-lg px-4"
            >
              <AccordionTrigger className="hover:no-underline">
                <div className="flex items-center gap-3">
                  <span className="font-medium capitalize">{cat}</span>
                  <Badge variant="secondary">{items.length}</Badge>
                </div>
              </AccordionTrigger>
              <AccordionContent>
                <ul className="divide-y">
                  {items.map((r) => {
                    // Custom products tombstone via their own deletedAt
                    // column; JSON-catalog products tombstone via the
                    // override row. Either source counts here.
                    const isDeleted =
                      !!r.override?.deletedAt ||
                      !!(r as { deletedAt?: string | null }).deletedAt;
                    const isCustom = r.id.startsWith("cust_");
                    return (
                      <li
                        key={r.id}
                        className={`flex items-center gap-3 py-2 ${
                          isDeleted ? "opacity-50" : ""
                        }`}
                      >
                        {r.imageUrls?.[0] ? (
                          <img
                            src={r.imageUrls[0]}
                            alt=""
                            className="w-12 h-14 object-cover rounded border"
                          />
                        ) : (
                          <div className="w-12 h-14 rounded border bg-muted" />
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="font-medium line-clamp-1">
                            {r.title}
                          </div>
                          <div className="text-xs text-muted-foreground flex items-center gap-2 flex-wrap">
                            <span>${r.price}</span>
                            <span>·</span>
                            <span>{r.gender}</span>
                            {r.badge && (
                              <Badge variant="outline" className="h-4 text-[10px]">
                                {r.badge}
                              </Badge>
                            )}
                            {r.featured && (
                              <Badge className="h-4 text-[10px]">Featured</Badge>
                            )}
                            {r.override?.hidden && (
                              <Badge
                                variant="secondary"
                                className="h-4 text-[10px]"
                              >
                                Hidden
                              </Badge>
                            )}
                            {isCustom && (
                              <Badge
                                variant="outline"
                                className="h-4 text-[10px]"
                              >
                                Custom
                              </Badge>
                            )}
                            {isDeleted && (
                              <Badge
                                variant="destructive"
                                className="h-4 text-[10px]"
                              >
                                Deleted
                              </Badge>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {!isDeleted && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => openEdit(r)}
                            >
                              Edit
                            </Button>
                          )}
                          {isDeleted ? (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleRestore(r)}
                            >
                              Restore
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-destructive hover:text-destructive"
                              onClick={() => setConfirmDelete(r)}
                            >
                              Delete
                            </Button>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      )}

      {/* Edit / Add drawer */}
      <Sheet
        open={editing !== null || creating}
        onOpenChange={(open) => {
          if (!open) closeDrawer();
        }}
      >
        <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle>
              {creating
                ? "Add product"
                : editing?.id.startsWith("cust_")
                  ? "Edit custom product"
                  : "Edit product"}
            </SheetTitle>
            <SheetDescription>
              {creating
                ? "Custom products live alongside the catalog and are fully editable."
                : editing?.id.startsWith("cust_")
                  ? "Changes save directly to this custom product."
                  : "Edits save as overrides on top of the catalog. Leaving a field unchanged keeps the catalog default."}
            </SheetDescription>
          </SheetHeader>

          <div className="space-y-4 py-4">
            <Field label="Title">
              <Input
                value={draft.title}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, title: e.target.value }))
                }
              />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Category">
                <Input
                  value={draft.category}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, category: e.target.value }))
                  }
                  placeholder="dresses"
                />
              </Field>
              <Field label="Sub-category">
                <Input
                  value={draft.subCategory}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, subCategory: e.target.value }))
                  }
                  placeholder="midi"
                />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Price">
                <Input
                  inputMode="decimal"
                  value={draft.price}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, price: e.target.value }))
                  }
                  placeholder="49.99"
                />
              </Field>
              <Field label="Gender">
                <select
                  value={draft.gender}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      gender: e.target.value as "men" | "women",
                    }))
                  }
                  className="h-9 w-full rounded-md border bg-transparent px-3 text-sm"
                >
                  <option value="women">women</option>
                  <option value="men">men</option>
                </select>
              </Field>
            </div>

            <Field label="Image URL">
              <div className="flex gap-2">
                <Input
                  value={draft.imageUrl}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, imageUrl: e.target.value }))
                  }
                  placeholder="https://… or /api/storage/public-objects/products/…"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                >
                  {uploading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Upload className="w-4 h-4" />
                  )}
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleUpload(f);
                    e.target.value = "";
                  }}
                />
              </div>
              {draft.imageUrl && (
                <img
                  src={draft.imageUrl}
                  alt=""
                  className="mt-2 w-24 h-28 object-cover rounded border"
                />
              )}
            </Field>

            <Field label="Sizes (comma-separated)">
              <Input
                value={draft.sizesCsv}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, sizesCsv: e.target.value }))
                }
                placeholder="XS, S, M, L, XL"
              />
            </Field>

            <Field
              label="Colors"
              hint='One per line: "Black #000000"'
            >
              <Textarea
                rows={3}
                value={draft.colorsText}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, colorsText: e.target.value }))
                }
                placeholder={"Black #000000\nIvory #f5f0e6"}
              />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Badge">
                <Input
                  value={draft.badge}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, badge: e.target.value }))
                  }
                  placeholder="NEW"
                />
              </Field>
              <Field label="Stock level">
                <Input
                  type="number"
                  min={0}
                  value={draft.stockLevel}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, stockLevel: e.target.value }))
                  }
                  placeholder="—"
                />
              </Field>
            </div>

            <div className="flex items-center gap-6">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <Switch
                  checked={draft.featured}
                  onCheckedChange={(v) =>
                    setDraft((d) => ({ ...d, featured: v }))
                  }
                />
                Featured
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <Switch
                  checked={draft.hidden}
                  onCheckedChange={(v) => setDraft((d) => ({ ...d, hidden: v }))}
                />
                Hidden
              </label>
            </div>
          </div>

          <SheetFooter>
            <Button variant="outline" onClick={closeDrawer} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? (
                <>
                  <Loader2 className="w-4 h-4 mr-1 animate-spin" /> Saving
                </>
              ) : creating ? (
                "Create product"
              ) : (
                "Save changes"
              )}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <AlertDialog
        open={confirmDelete !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete product?</AlertDialogTitle>
            <AlertDialogDescription>
              "{confirmDelete?.title}" will be hidden from the storefront. You
              can restore it later from the "Show deleted" view.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => confirmDelete && handleDelete(confirmDelete)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AdminShell>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs uppercase tracking-wider text-muted-foreground">
        {label}
      </Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
