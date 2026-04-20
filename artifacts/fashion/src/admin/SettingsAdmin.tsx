import { useEffect, useState } from "react";
import { AdminShell, AdminPageHeader } from "./AdminShell";
import { adminApi, type SiteSettings } from "./api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";

export function SettingsAdmin() {
  const [s, setS] = useState<SiteSettings | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    adminApi.getSettings().then(setS);
  }, []);

  const set = <K extends keyof SiteSettings>(k: K, v: SiteSettings[K]) =>
    setS((prev) => (prev ? { ...prev, [k]: v } : prev));

  const save = async () => {
    if (!s) return;
    setSaving(true);
    try {
      const next = await adminApi.updateSettings(s);
      setS(next);
      toast.success("Settings saved");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <AdminShell>
      <AdminPageHeader
        title="Settings"
        description="Site-wide knobs that apply to the storefront."
      />
      {!s ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="max-w-2xl space-y-6">
          <Section title="Branding">
            <Field label="Store name">
              <Input
                value={s.storeName}
                onChange={(e) => set("storeName", e.target.value)}
              />
            </Field>
            <Field label="Tagline">
              <Input
                value={s.tagline ?? ""}
                onChange={(e) => set("tagline", e.target.value)}
              />
            </Field>
            <Field label="Currency symbol">
              <Input
                value={s.currencySymbol}
                onChange={(e) => set("currencySymbol", e.target.value)}
                className="w-24"
              />
            </Field>
          </Section>

          <Section title="Announcement bar">
            <div className="flex items-center gap-3">
              <Switch
                id="ann"
                checked={s.announcementActive}
                onCheckedChange={(v) => set("announcementActive", !!v)}
              />
              <Label htmlFor="ann">Show announcement bar</Label>
            </div>
            <Field label="Text">
              <Input
                value={s.announcementText}
                onChange={(e) => set("announcementText", e.target.value)}
              />
            </Field>
          </Section>

          <Section title="Shop">
            <Field label="Default sort">
              <select
                value={s.defaultSort}
                onChange={(e) => set("defaultSort", e.target.value)}
                className="w-full h-10 rounded-md border bg-background px-3 text-sm"
              >
                <option value="featured">Featured</option>
                <option value="price-asc">Price: low to high</option>
                <option value="price-desc">Price: high to low</option>
                <option value="name-asc">Name: A → Z</option>
              </select>
            </Field>
            <Field label="Free shipping threshold (cents)">
              <Input
                type="number"
                value={s.freeShippingThresholdCents}
                onChange={(e) =>
                  set(
                    "freeShippingThresholdCents",
                    Number(e.target.value) || 0,
                  )
                }
              />
            </Field>
          </Section>

          <Section title="Site state">
            <div className="flex items-center gap-3">
              <Switch
                id="maint"
                checked={s.maintenanceMode}
                onCheckedChange={(v) => set("maintenanceMode", !!v)}
              />
              <Label htmlFor="maint">Maintenance mode</Label>
            </div>
          </Section>

          <div className="pt-3 border-t flex justify-end">
            <Button onClick={save} disabled={saving}>
              {saving ? "Saving…" : "Save settings"}
            </Button>
          </div>
        </div>
      )}
    </AdminShell>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border rounded-lg p-5 space-y-4">
      <h3 className="text-xs uppercase tracking-widest font-bold">{title}</h3>
      {children}
    </section>
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
