import { useEffect, useState } from "react";
import { AdminShell, AdminPageHeader } from "./AdminShell";
import { adminApi, type SiteSettings, type TestEmailResult } from "./api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";

export function SettingsAdmin() {
  const [s, setS] = useState<SiteSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [testTo, setTestTo] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestEmailResult | null>(null);

  useEffect(() => {
    adminApi.getSettings().then(setS);
  }, []);

  const set = <K extends keyof SiteSettings>(k: K, v: SiteSettings[K]) =>
    setS((prev) => (prev ? { ...prev, [k]: v } : prev));

  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const testToInvalid = testTo.trim().length > 0 && !emailRe.test(testTo.trim());

  const sendTest = async () => {
    const to = testTo.trim();
    if (!to || !emailRe.test(to)) {
      setTestResult({ ok: false, error: "Enter a valid email address." });
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      const result = await adminApi.sendTestEmail(to);
      setTestResult(result);
    } catch (e) {
      setTestResult({ ok: false, error: (e as Error).message });
    } finally {
      setTesting(false);
    }
  };
  const fromAddrInvalid =
    !!s?.emailFromAddress && s.emailFromAddress.trim().length > 0 && !emailRe.test(s.emailFromAddress.trim());
  const replyToInvalid =
    !!s?.emailReplyTo && s.emailReplyTo.trim().length > 0 && !emailRe.test(s.emailReplyTo.trim());

  const save = async () => {
    if (!s) return;
    if (fromAddrInvalid || replyToInvalid) {
      toast.error("Please enter valid email addresses.");
      return;
    }
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

          <Section title="Order email branding">
            <p className="text-xs text-muted-foreground -mt-2">
              Used for order confirmation, shipped, and delivered emails.
              Leave the address blank to fall back to the platform default.
            </p>
            <Field label="From name">
              <Input
                value={s.emailFromName ?? ""}
                placeholder={s.storeName}
                onChange={(e) => set("emailFromName", e.target.value)}
              />
            </Field>
            <Field label="From email">
              <Input
                type="email"
                value={s.emailFromAddress ?? ""}
                placeholder="orders@yourbrand.com"
                onChange={(e) => set("emailFromAddress", e.target.value)}
                aria-invalid={fromAddrInvalid || undefined}
              />
              {fromAddrInvalid ? (
                <p className="text-xs text-destructive mt-1">
                  Enter a valid email address.
                </p>
              ) : null}
            </Field>
            <Field label="Reply-to (optional)">
              <Input
                type="email"
                value={s.emailReplyTo ?? ""}
                placeholder="support@yourbrand.com"
                onChange={(e) => set("emailReplyTo", e.target.value)}
                aria-invalid={replyToInvalid || undefined}
              />
              {replyToInvalid ? (
                <p className="text-xs text-destructive mt-1">
                  Enter a valid email address.
                </p>
              ) : null}
            </Field>

            <div className="border-t pt-4 mt-2">
              <Label className="text-xs uppercase tracking-widest text-muted-foreground mb-1 block">
                Send test email
              </Label>
              <p className="text-xs text-muted-foreground mb-2">
                Sends a sample message using the saved branding above.
                Save first if you've made changes.
              </p>
              <div className="flex gap-2">
                <Input
                  type="email"
                  value={testTo}
                  placeholder="you@example.com"
                  onChange={(e) => {
                    setTestTo(e.target.value);
                    if (testResult) setTestResult(null);
                  }}
                  aria-invalid={testToInvalid || undefined}
                  disabled={testing}
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={sendTest}
                  disabled={
                    testing ||
                    testTo.trim().length === 0 ||
                    testToInvalid ||
                    fromAddrInvalid ||
                    replyToInvalid
                  }
                >
                  {testing ? "Sending…" : "Send test"}
                </Button>
              </div>
              {testToInvalid ? (
                <p className="text-xs text-destructive mt-1">
                  Enter a valid email address.
                </p>
              ) : null}
              {testResult ? (
                <div
                  role="status"
                  aria-live="polite"
                  className={`mt-3 rounded-md border p-3 text-sm ${
                    testResult.ok
                      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                      : "border-destructive/50 bg-destructive/10 text-destructive"
                  }`}
                >
                  {testResult.ok ? (
                    <>
                      <p className="font-medium">
                        Test email sent to {testTo.trim()}.
                      </p>
                      {testResult.from ? (
                        <p className="text-xs mt-1 opacity-80">
                          From: {testResult.from}
                        </p>
                      ) : null}
                      {testResult.usingSandbox ? (
                        <p className="text-xs mt-1 opacity-80">
                          Sent from the resend.dev sandbox because no custom
                          From address is configured. Add one above to send
                          from your own domain.
                        </p>
                      ) : null}
                    </>
                  ) : (
                    <>
                      <p className="font-medium">Failed to send test email.</p>
                      <p className="text-xs mt-1 break-words">
                        {testResult.error ?? "Unknown error from email provider."}
                      </p>
                      {testResult.from ? (
                        <p className="text-xs mt-1 opacity-80">
                          Attempted From: {testResult.from}
                        </p>
                      ) : null}
                    </>
                  )}
                </div>
              ) : null}
            </div>
          </Section>

          <Section title="Storefront behavior">
            <div className="flex items-center gap-3">
              <Switch
                id="heroAuto"
                checked={s.heroAutoAdvance}
                onCheckedChange={(v) => set("heroAutoAdvance", !!v)}
              />
              <Label htmlFor="heroAuto">
                Auto-advance hero slider
              </Label>
            </div>
            <p className="text-xs text-muted-foreground -mt-2">
              When off, customers must use the keyboard arrows to change
              hero slides.
            </p>
            <div className="flex items-center gap-3">
              <Switch
                id="guestReviews"
                checked={s.allowGuestReviews}
                onCheckedChange={(v) => set("allowGuestReviews", !!v)}
              />
              <Label htmlFor="guestReviews">
                Allow guest reviews
              </Label>
            </div>
            <p className="text-xs text-muted-foreground -mt-2">
              Reserved for a future review flow. Today, reviews still
              require a signed-in buyer with a delivered order.
            </p>
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
