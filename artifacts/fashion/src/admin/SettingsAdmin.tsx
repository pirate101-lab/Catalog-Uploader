import { useEffect, useRef, useState } from "react";
import { AdminShell, AdminPageHeader, useAdminIdentity } from "./AdminShell";
import {
  adminApi,
  type SiteSettings,
  type SmtpVerifyResult,
  type TestEmailResult,
} from "./api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

export function SettingsAdmin() {
  const me = useAdminIdentity();
  const isSuper = me?.role === "super_admin" || me == null;
  const [s, setS] = useState<SiteSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [testTo, setTestTo] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestEmailResult | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<SmtpVerifyResult | null>(null);

  const verifySmtp = async () => {
    setVerifying(true);
    setVerifyResult(null);
    try {
      setVerifyResult(await adminApi.verifySmtp());
    } catch (e) {
      setVerifyResult({ ok: false, configured: false, error: (e as Error).message });
    } finally {
      setVerifying(false);
    }
  };

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

  // Validate the operator-alert recipients textarea (comma/semicolon/
  // newline separated). Each non-empty entry must look like an email,
  // matching the server-side check so the inline error message and the
  // PUT response stay aligned.
  const alertRecipientsRaw = s?.paymentAlertRecipients ?? "";
  const alertEntries = alertRecipientsRaw
    .split(/[,;\n]/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  const invalidAlertEntries = alertEntries.filter((e) => !emailRe.test(e));
  const alertRecipientsInvalid = invalidAlertEntries.length > 0;
  const alertModeRequiresRecipients =
    !!s &&
    s.paymentAlertMode !== "off" &&
    alertEntries.length === 0;

  const save = async () => {
    if (!s) return;
    if (fromAddrInvalid || replyToInvalid) {
      toast.error("Please enter valid email addresses.");
      return;
    }
    if (alertRecipientsInvalid) {
      toast.error(
        `Invalid alert recipient${invalidAlertEntries.length === 1 ? "" : "s"}: ${invalidAlertEntries.join(", ")}`,
      );
      return;
    }
    if (alertModeRequiresRecipients) {
      toast.error("Add at least one recipient or set alerts to Off.");
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
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
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
            <LogoField
              value={s.logoUrl ?? ""}
              onChange={(v) => set("logoUrl", v.trim().length === 0 ? null : v)}
            />
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

            {isSuper ? (
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
            ) : null}
          </Section>

          {isSuper ? (
          <Section title="SMTP mailbox (Titan, Zoho, Workspace, …)">
            <p className="text-xs text-muted-foreground -mt-2">
              When SMTP is configured, all order and test emails are sent
              through this mailbox instead of the platform default. Use
              the same username and password you use to sign in to your
              email inbox. Click <em>Verify connection</em> after saving
              to confirm the credentials work.
            </p>
            <Field label="SMTP host">
              <Input
                value={s.smtpHost ?? ""}
                placeholder="smtp.titan.email"
                onChange={(e) => set("smtpHost", e.target.value)}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Port">
                <Input
                  type="number"
                  value={s.smtpPort ?? ""}
                  placeholder="465"
                  min={1}
                  max={65535}
                  onChange={(e) =>
                    set(
                      "smtpPort",
                      e.target.value === "" ? null : Number(e.target.value),
                    )
                  }
                />
              </Field>
              <Field label="Connection">
                <div className="flex items-center gap-3 h-10">
                  <Switch
                    id="smtpSecure"
                    checked={s.smtpSecure}
                    onCheckedChange={(v) => set("smtpSecure", !!v)}
                  />
                  <Label htmlFor="smtpSecure" className="text-sm">
                    SSL/TLS (port 465). Off = STARTTLS (587).
                  </Label>
                </div>
              </Field>
            </div>
            <Field label="Username">
              <Input
                autoComplete="off"
                value={s.smtpUsername ?? ""}
                placeholder="orders@yourbrand.com"
                onChange={(e) => set("smtpUsername", e.target.value)}
              />
            </Field>
            <Field label="Password">
              <Input
                type="password"
                autoComplete="new-password"
                value={s.smtpPassword ?? ""}
                placeholder="Mailbox password"
                onChange={(e) => set("smtpPassword", e.target.value)}
              />
              <p className="text-xs text-muted-foreground mt-1">
                {s.smtpPasswordSet
                  ? "A password is saved (shown as ••••). Type a new password to replace it, or clear the field to remove it."
                  : "Stored server-side and never returned to the browser."}
              </p>
            </Field>

            <div className="border-t pt-4 mt-2 flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={verifySmtp}
                disabled={verifying}
              >
                {verifying ? "Verifying…" : "Verify connection"}
              </Button>
              <p className="text-xs text-muted-foreground">
                Save your changes first, then verify.
              </p>
            </div>
            {verifyResult ? (
              <div
                role="status"
                aria-live="polite"
                className={`mt-2 rounded-md border p-3 text-sm ${
                  verifyResult.ok
                    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                    : "border-destructive/50 bg-destructive/10 text-destructive"
                }`}
              >
                {verifyResult.ok ? (
                  <p className="font-medium">
                    Connected. Your mailbox accepted the credentials.
                  </p>
                ) : (
                  <>
                    <p className="font-medium">
                      {verifyResult.configured
                        ? "Could not connect."
                        : "SMTP not configured."}
                    </p>
                    <p className="text-xs mt-1 break-words">
                      {verifyResult.error ?? "Unknown error."}
                    </p>
                  </>
                )}
              </div>
            ) : null}
          </Section>

          ) : null}

          {isSuper ? (
          <Section title="Operator alerts">
            <p className="text-xs text-muted-foreground -mt-2">
              Email operators when a high-severity Paystack failure fires
              (amount or currency mismatch, verification failed, or no
              matching order). Choose Off to disable, Instant for a
              message per event, or Hourly digest to bundle them.
            </p>
            <Field label="Frequency">
              <select
                value={s.paymentAlertMode}
                onChange={(e) =>
                  set(
                    "paymentAlertMode",
                    e.target.value as SiteSettings["paymentAlertMode"],
                  )
                }
                className="w-full h-10 rounded-md border bg-background px-3 text-sm"
              >
                <option value="off">Off — don't email</option>
                <option value="instant">Instant — one email per event</option>
                <option value="hourly">Hourly digest — bundle within 1 hour</option>
              </select>
            </Field>
            <Field label="Recipients">
              <Textarea
                value={s.paymentAlertRecipients ?? ""}
                placeholder={"ops@yourbrand.com, finance@yourbrand.com"}
                onChange={(e) =>
                  set(
                    "paymentAlertRecipients",
                    e.target.value.length === 0 ? null : e.target.value,
                  )
                }
                rows={3}
                aria-invalid={alertRecipientsInvalid || undefined}
              />
              <p className="text-xs text-muted-foreground mt-1">
                Comma, semicolon, or newline-separated. Uses the same
                "From" address as your order emails.
              </p>
              {alertRecipientsInvalid ? (
                <p className="text-xs text-destructive mt-1">
                  Invalid email{invalidAlertEntries.length === 1 ? "" : "s"}:{" "}
                  {invalidAlertEntries.join(", ")}
                </p>
              ) : null}
              {!alertRecipientsInvalid && alertModeRequiresRecipients ? (
                <p className="text-xs text-destructive mt-1">
                  Add at least one recipient or set frequency to Off.
                </p>
              ) : null}
            </Field>
          </Section>

          ) : null}

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

          <AdminAccountSection />

          <Section title="Site state" className="lg:col-span-2">
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

function AdminAccountSection() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (newPassword && newPassword !== confirmPassword) {
      toast.error("New passwords do not match.");
      return;
    }
    if (!newUsername.trim() && !newPassword) {
      toast.error("Enter a new username or password.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/admin-auth/change", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentPassword,
          newUsername: newUsername.trim() || undefined,
          newPassword: newPassword || undefined,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
      };
      if (!res.ok) {
        const map: Record<string, string> = {
          invalid_current_password: "Current password is incorrect.",
          current_password_required: "Enter your current password.",
          nothing_to_change: "Enter a new username or password.",
          weak_password: body.message ?? "Password too weak.",
          invalid_username: body.message ?? "Invalid username.",
          no_admin_user: "No admin account is configured.",
        };
        toast.error(map[body.error ?? ""] ?? "Failed to update credentials.");
        return;
      }
      toast.success("Admin credentials updated");
      setCurrentPassword("");
      setNewUsername("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Section title="Admin account">
      <p className="text-xs text-muted-foreground -mt-2">
        Change the username and/or password used to sign in to the admin
        dashboard. Confirm with your current password.
      </p>
      <Field label="Current password">
        <Input
          type="password"
          autoComplete="current-password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
        />
      </Field>
      <Field label="New username (optional)">
        <Input
          autoComplete="username"
          value={newUsername}
          onChange={(e) => setNewUsername(e.target.value)}
          placeholder="Leave blank to keep current"
        />
      </Field>
      <Field label="New password (optional)">
        <Input
          type="password"
          autoComplete="new-password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          placeholder="At least 8 characters"
        />
      </Field>
      <Field label="Confirm new password">
        <Input
          type="password"
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
        />
      </Field>
      <div className="flex justify-end pt-1">
        <Button
          variant="outline"
          onClick={submit}
          disabled={saving || !currentPassword}
        >
          {saving ? "Updating…" : "Update credentials"}
        </Button>
      </div>
    </Section>
  );
}

function Section({
  title,
  children,
  className,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`border rounded-lg p-5 space-y-4${className ? ` ${className}` : ""}`}
    >
      <h3 className="text-xs uppercase tracking-widest font-bold">{title}</h3>
      {children}
    </section>
  );
}

function LogoField({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onPick = async (file: File | null) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Please choose an image file (PNG, JPG, SVG, WebP).");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setError("Logo must be under 2 MB.");
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const { publicUrl } = await adminApi.uploadLogo(file);
      onChange(publicUrl);
      toast.success("Logo uploaded — click Save settings to apply.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <Field label="Business logo">
      <div className="flex items-start gap-4">
        <div className="w-20 h-20 rounded-md border bg-muted/40 flex items-center justify-center overflow-hidden shrink-0">
          {value ? (
            <img src={value} alt="Logo preview" className="max-w-full max-h-full object-contain" />
          ) : (
            <span className="text-[10px] text-muted-foreground uppercase tracking-widest">
              No logo
            </span>
          )}
        </div>
        <div className="flex-1 space-y-2">
          <Input
            value={value}
            placeholder="https://… or upload an image"
            onChange={(e) => onChange(e.target.value)}
          />
          <div className="flex items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => onPick(e.target.files?.[0] ?? null)}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
            >
              {uploading ? "Uploading…" : "Upload"}
            </Button>
            {value ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onChange("")}
                disabled={uploading}
              >
                Remove
              </Button>
            ) : null}
          </div>
          {error ? (
            <p className="text-xs text-destructive">{error}</p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Shown in the storefront header. Square or wide images work
              best; transparent PNG or SVG recommended.
            </p>
          )}
        </div>
      </div>
    </Field>
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
