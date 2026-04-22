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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Plus, Search, Upload, Loader2, Pencil, Trash2, RotateCcw } from "lucide-react";

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
  // For custom products, hidden/stockLevel/badge/featured live on the
  // row itself; for JSON-catalog products, only the override row carries
  // them. Fall through both sources so opening + saving an unchanged
  // form never silently flips a custom product's flags.
  const hidden = ov?.hidden ?? r.hidden ?? false;
  const stockLevel =
    ov?.stockLevel != null
      ? String(ov.stockLevel)
      : r.stockLevel != null
        ? String(r.stockLevel)
        : "";
  return {
    title: ov?.titleOverride ?? r.title,
    category: r.category ?? "",
    subCategory: ov?.subCategoryOverride ?? r.subCategory ?? "",
    price: ov?.priceOverride ?? r.price,
    badge: ov?.badge ?? r.badge ?? "",
    featured: !!(ov?.featured ?? r.featured),
    hidden,
    stockLevel,
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
  const [viewing, setViewing] = useState<Row | null>(null);
  const [categories, setCategories] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    adminApi
      .listProductCategories()
      .then((arr) => setCategories(arr.map((c) => c.category)))
      .catch(() => {
        /* non-fatal — picker degrades to free-text input */
      });
  }, [reloadTick]);

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
          // The PUT endpoint replaces ALL override columns from the
          // request body, so we always send the full effective state
          // the admin sees in the form. (Comparing against `editing`
          // would be wrong because `editing` is itself the post-override
          // value, so unchanged fields would round-trip to null and
          // wipe pre-existing overrides.)
          const ovPatch: Partial<ProductOverride> = {
            featured: draft.featured,
            hidden: draft.hidden,
            priceOverride: draft.price?.trim() ? draft.price.trim() : null,
            badge: draft.badge.trim() || null,
            stockLevel: stock,
            categoryOverride: draft.category.trim() || null,
            subCategoryOverride: draft.subCategory.trim() || null,
            titleOverride: draft.title.trim() || null,
            imageUrlOverride: draft.imageUrl.trim() || null,
            sizesOverride: sizes.length > 0 ? sizes : null,
            colorsOverride: colors.length > 0 ? colors : null,
            genderOverride: draft.gender,
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
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-3 pt-1 pb-3">
                  {items.map((r) => {
                    // Custom products tombstone via their own deletedAt
                    // column; JSON-catalog products tombstone via the
                    // override row. Either source counts here.
                    const isDeleted =
                      !!r.override?.deletedAt || !!r.deletedAt;
                    const isCustom = r.id.startsWith("cust_");
                    return (
                      <button
                        key={r.id}
                        type="button"
                        onClick={() => setViewing(r)}
                        className={`group relative text-left border rounded-lg overflow-hidden bg-card hover:shadow-md transition-shadow focus:outline-none focus:ring-2 focus:ring-ring ${
                          isDeleted ? "opacity-50" : ""
                        }`}
                      >
                        <div className="aspect-[4/5] bg-muted overflow-hidden">
                          {r.imageUrls?.[0] ? (
                            <img
                              src={r.imageUrls[0]}
                              alt=""
                              loading="lazy"
                              className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                            />
                          ) : null}
                        </div>
                        <div className="p-2 space-y-1">
                          <div className="text-xs font-medium line-clamp-2 leading-tight min-h-[2lh]">
                            {r.title}
                          </div>
                          <div className="flex items-center justify-between gap-1">
                            <span className="text-xs font-semibold">
                              ${r.price}
                            </span>
                            <span className="text-[10px] uppercase text-muted-foreground">
                              {r.gender}
                            </span>
                          </div>
                          <div className="flex items-center gap-1 flex-wrap">
                            {r.badge && (
                              <Badge variant="outline" className="h-4 text-[9px] px-1">
                                {r.badge}
                              </Badge>
                            )}
                            {r.featured && (
                              <Badge className="h-4 text-[9px] px-1">Featured</Badge>
                            )}
                            {r.override?.hidden && (
                              <Badge variant="secondary" className="h-4 text-[9px] px-1">
                                Hidden
                              </Badge>
                            )}
                            {isCustom && (
                              <Badge variant="outline" className="h-4 text-[9px] px-1">
                                Custom
                              </Badge>
                            )}
                            {isDeleted && (
                              <Badge variant="destructive" className="h-4 text-[9px] px-1">
                                Deleted
                              </Badge>
                            )}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
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
                  list="admin-product-categories"
                  value={draft.category}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, category: e.target.value }))
                  }
                  placeholder="dresses"
                />
                <datalist id="admin-product-categories">
                  {categories.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
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

      {/* Detail modal — click any card in the grid to open. Shows the
          full effective product state (title, price, sizes, colors,
          flags, override audit) and exposes Edit / Delete / Restore
          actions inline. */}
      <Dialog
        open={viewing !== null}
        onOpenChange={(open) => {
          if (!open) setViewing(null);
        }}
      >
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          {viewing && (() => {
            const r = viewing;
            const isDeleted = !!r.override?.deletedAt || !!r.deletedAt;
            const isCustom = r.id.startsWith("cust_");
            return (
              <>
                <DialogHeader>
                  <DialogTitle className="pr-8">{r.title}</DialogTitle>
                  <DialogDescription className="font-mono text-xs">
                    {r.id}
                  </DialogDescription>
                </DialogHeader>
                <div className="grid grid-cols-1 sm:grid-cols-[200px_1fr] gap-4 py-2">
                  <div className="aspect-[4/5] bg-muted rounded overflow-hidden border">
                    {r.imageUrls?.[0] && (
                      <img
                        src={r.imageUrls[0]}
                        alt=""
                        className="w-full h-full object-cover"
                      />
                    )}
                  </div>
                  <dl className="space-y-2 text-sm">
                    <DetailRow label="Price">${r.price}</DetailRow>
                    <DetailRow label="Category">
                      <span className="capitalize">{r.category ?? "—"}</span>
                      {r.subCategory && (
                        <span className="text-muted-foreground"> · {r.subCategory}</span>
                      )}
                    </DetailRow>
                    <DetailRow label="Gender">{r.gender}</DetailRow>
                    {r.sizes && r.sizes.length > 0 && (
                      <DetailRow label="Sizes">{r.sizes.join(", ")}</DetailRow>
                    )}
                    {r.colors && r.colors.length > 0 && (
                      <DetailRow label="Colors">
                        <div className="flex flex-wrap gap-1.5">
                          {r.colors.map((c) => (
                            <span
                              key={c.hex + c.name}
                              className="inline-flex items-center gap-1.5 text-xs"
                            >
                              <span
                                className="w-3.5 h-3.5 rounded-full border"
                                style={{ backgroundColor: c.hex }}
                              />
                              {c.name}
                            </span>
                          ))}
                        </div>
                      </DetailRow>
                    )}
                    {r.stockLevel != null && (
                      <DetailRow label="Stock">{r.stockLevel}</DetailRow>
                    )}
                    <DetailRow label="Flags">
                      <div className="flex flex-wrap gap-1">
                        {r.badge && <Badge variant="outline">{r.badge}</Badge>}
                        {r.featured && <Badge>Featured</Badge>}
                        {r.override?.hidden && (
                          <Badge variant="secondary">Hidden</Badge>
                        )}
                        {isCustom && <Badge variant="outline">Custom</Badge>}
                        {isDeleted && <Badge variant="destructive">Deleted</Badge>}
                        {!r.badge &&
                          !r.featured &&
                          !r.override?.hidden &&
                          !isCustom &&
                          !isDeleted && (
                            <span className="text-muted-foreground">None</span>
                          )}
                      </div>
                    </DetailRow>
                    {r.override && (
                      <DetailRow label="Overrides">
                        <span className="text-xs text-muted-foreground">
                          This product has admin overrides applied.
                        </span>
                      </DetailRow>
                    )}
                  </dl>
                </div>
                <DialogFooter className="gap-2 sm:gap-2">
                  {isDeleted ? (
                    <Button
                      variant="outline"
                      onClick={() => {
                        handleRestore(r);
                        setViewing(null);
                      }}
                    >
                      <RotateCcw className="w-4 h-4 mr-1" /> Restore
                    </Button>
                  ) : (
                    <>
                      <Button
                        variant="ghost"
                        className="text-destructive hover:text-destructive"
                        onClick={() => {
                          setConfirmDelete(r);
                          setViewing(null);
                        }}
                      >
                        <Trash2 className="w-4 h-4 mr-1" /> Delete
                      </Button>
                      <Button
                        onClick={() => {
                          openEdit(r);
                          setViewing(null);
                        }}
                      >
                        <Pencil className="w-4 h-4 mr-1" /> Edit
                      </Button>
                    </>
                  )}
                </DialogFooter>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>

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

// Two-column "label : value" row used inside the product detail
// modal — keeps the label width consistent across rows so the values
// line up nicely.
function DetailRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[80px_1fr] gap-3 items-start">
      <dt className="text-xs uppercase tracking-wider text-muted-foreground pt-0.5">
        {label}
      </dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}
