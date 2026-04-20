import { useEffect, useState } from "react";
import { AdminShell, AdminPageHeader } from "./AdminShell";
import { adminApi, type HeroSlide } from "./api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ArrowDown, ArrowUp, Trash2, Plus } from "lucide-react";
import { toast } from "sonner";

export function HeroAdmin() {
  const [rows, setRows] = useState<HeroSlide[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = () =>
    adminApi
      .listHero()
      .then(setRows)
      .catch((e) => setError(e.message));

  useEffect(() => {
    reload();
  }, []);

  const move = async (idx: number, dir: -1 | 1) => {
    if (!rows) return;
    const next = [...rows];
    const swap = idx + dir;
    if (swap < 0 || swap >= next.length) return;
    [next[idx], next[swap]] = [next[swap]!, next[idx]!];
    setRows(next);
    await adminApi.reorderHero(next.map((r) => r.id));
  };

  const create = async () => {
    try {
      await adminApi.createHero({
        title: "New slide",
        subtitle: "Edit me",
        ctaLabel: "Shop",
        ctaHref: "/shop",
        imageUrl: "/hero-1-boutique.jpg",
        active: true,
      });
      toast.success("Slide created");
      reload();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <AdminShell>
      <AdminPageHeader
        title="Hero Slides"
        description="The carousel shown on the homepage. Reorder with the arrows."
        action={
          <Button onClick={create}>
            <Plus className="w-4 h-4 mr-2" /> Add slide
          </Button>
        }
      />
      {error && <p className="text-destructive text-sm mb-4">{error}</p>}
      {!rows ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No slides yet. The storefront is using built-in defaults until you add
          one.
        </p>
      ) : (
        <div className="space-y-4">
          {rows.map((slide, idx) => (
            <SlideEditor
              key={slide.id}
              slide={slide}
              onSaved={reload}
              onDelete={async () => {
                if (!confirm("Delete this slide?")) return;
                await adminApi.deleteHero(slide.id);
                toast.success("Deleted");
                reload();
              }}
              onMoveUp={idx > 0 ? () => move(idx, -1) : undefined}
              onMoveDown={
                idx < rows.length - 1 ? () => move(idx, 1) : undefined
              }
            />
          ))}
        </div>
      )}
    </AdminShell>
  );
}

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

function SlideEditor({
  slide,
  onSaved,
  onDelete,
  onMoveUp,
  onMoveDown,
}: {
  slide: HeroSlide;
  onSaved: () => void;
  onDelete: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
}) {
  const [draft, setDraft] = useState<HeroSlide>(slide);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  useEffect(() => setDraft(slide), [slide]);

  const set = <K extends keyof HeroSlide>(k: K, v: HeroSlide[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));

  const save = async () => {
    setSaving(true);
    try {
      await adminApi.updateHero(slide.id, draft);
      toast.success("Saved");
      onSaved();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const onFilePicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Please pick an image file");
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      toast.error("Image is larger than 8 MB");
      return;
    }
    const t = toast.loading("Uploading…");
    setUploading(true);
    try {
      const { uploadURL, publicUrl } = await adminApi.requestUploadUrl(
        file.name,
      );
      const put = await fetch(uploadURL, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!put.ok) throw new Error(`Upload failed (${put.status})`);
      let merged: HeroSlide | null = null;
      setDraft((prev) => {
        merged = { ...prev, imageUrl: publicUrl };
        return merged;
      });
      if (merged) {
        await adminApi.updateHero(slide.id, merged);
      }
      toast.success("Image uploaded", { id: t });
      onSaved();
    } catch (err) {
      toast.error((err as Error).message, { id: t });
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="border rounded-lg overflow-hidden grid grid-cols-1 lg:grid-cols-[280px_1fr]">
      <div className="bg-muted relative aspect-video lg:aspect-auto">
        {draft.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={draft.imageUrl}
            alt={draft.title}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-xs text-muted-foreground">
            No image
          </div>
        )}
      </div>
      <div className="p-5 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="Title">
            <Input
              value={draft.title}
              onChange={(e) => set("title", e.target.value)}
            />
          </Field>
          <Field label="Subtitle">
            <Input
              value={draft.subtitle ?? ""}
              onChange={(e) => set("subtitle", e.target.value)}
            />
          </Field>
          <Field label="Kicker">
            <Input
              value={draft.kicker ?? ""}
              onChange={(e) => set("kicker", e.target.value)}
            />
          </Field>
          <Field label="CTA label">
            <Input
              value={draft.ctaLabel ?? ""}
              onChange={(e) => set("ctaLabel", e.target.value)}
            />
          </Field>
          <Field label="CTA href">
            <Input
              value={draft.ctaHref ?? ""}
              onChange={(e) => set("ctaHref", e.target.value)}
            />
          </Field>
          <Field label="Image">
            <div className="flex gap-2 items-center">
              <Input
                value={draft.imageUrl}
                onChange={(e) => set("imageUrl", e.target.value)}
                placeholder="/path/to/image.jpg or paste URL"
              />
              <input
                id={`upload-${slide.id}`}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={onFilePicked}
              />
              <Button
                type="button"
                variant="outline"
                disabled={uploading}
                onClick={() =>
                  document.getElementById(`upload-${slide.id}`)?.click()
                }
              >
                {uploading ? "Uploading…" : "Upload"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Upload an image (max 8 MB) or paste a URL.
            </p>
          </Field>
        </div>
        <div className="flex items-center justify-between pt-3 border-t">
          <div className="flex items-center gap-3">
            <Switch
              checked={draft.active}
              onCheckedChange={(v) => set("active", !!v)}
              id={`active-${slide.id}`}
            />
            <Label htmlFor={`active-${slide.id}`} className="text-sm">
              Published
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              disabled={!onMoveUp}
              onClick={onMoveUp}
            >
              <ArrowUp className="w-4 h-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              disabled={!onMoveDown}
              onClick={onMoveDown}
            >
              <ArrowDown className="w-4 h-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={onDelete}
              className="text-destructive"
            >
              <Trash2 className="w-4 h-4" />
            </Button>
            <Button onClick={save} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <Label className="text-xs uppercase tracking-widest text-muted-foreground mb-1 block">
        {label}
      </Label>
      {children}
    </div>
  );
}
