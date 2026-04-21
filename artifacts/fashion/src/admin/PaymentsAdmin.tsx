import { useEffect, useState, type ReactNode } from "react";
import { AdminShell, AdminPageHeader } from "./AdminShell";
import {
  adminApi,
  type SiteSettings,
  type PaymentsUrls,
  type PaymentsTestResult,
} from "./api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  AlertCircle,
  CheckCircle2,
  Copy,
  Eye,
  EyeOff,
  Loader2,
  ShieldCheck,
  Banknote,
  Link as LinkIcon,
} from "lucide-react";

type SaveablePatch = Partial<SiteSettings>;

export function PaymentsAdmin() {
  const [settings, setSettings] = useState<SiteSettings | null>(null);
  const [urls, setUrls] = useState<PaymentsUrls | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<PaymentsTestResult | null>(null);

  // Track the working copy separately so the operator can edit fields and
  // hit Save once. The masked secret strings come back from the server on
  // load and on save — we only send a new secret if the operator typed
  // something other than the mask.
  const [draft, setDraft] = useState<SiteSettings | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([adminApi.getSettings(), adminApi.getPaymentsUrls()])
      .then(([s, u]) => {
        if (cancelled) return;
        setSettings(s);
        setDraft(s);
        setUrls(u);
      })
      .catch((e) => !cancelled && setLoadError((e as Error).message));
    return () => {
      cancelled = true;
    };
  }, []);

  const updateDraft = (patch: SaveablePatch) =>
    setDraft((prev) => (prev ? { ...prev, ...patch } : prev));

  const save = async (extraPatch?: SaveablePatch) => {
    if (!draft) return;
    setSaving(true);
    try {
      const merged = { ...draft, ...(extraPatch ?? {}) };
      const next = await adminApi.updateSettings(merged);
      setSettings(next);
      setDraft(next);
      setTestResult(null);
      toast.success("Payment settings saved");
    } catch (e) {
      toast.error("Save failed", { description: (e as Error).message });
    } finally {
      setSaving(false);
    }
  };

  const runTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const r = await adminApi.testPayments();
      setTestResult(r);
      if (r.ok) toast.success(`Paystack ${r.mode} key OK`);
      else toast.error("Paystack rejected the key", { description: r.error });
    } catch (e) {
      toast.error("Test failed", { description: (e as Error).message });
    } finally {
      setTesting(false);
    }
  };

  return (
    <AdminShell>
      <AdminPageHeader
        title="Payments"
        description="Configure Paystack and the bank-transfer fallback. Keys live in the database — no redeploy needed."
      />

      {loadError && (
        <div className="mb-6 border border-destructive/40 bg-destructive/5 text-destructive text-sm rounded-md px-4 py-3 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{loadError}</span>
        </div>
      )}

      {!draft || !settings ? (
        <div className="text-sm text-muted-foreground">Loading payment settings…</div>
      ) : (
        <div className="space-y-8 max-w-3xl">
          <PaystackSection
            draft={draft}
            settings={settings}
            saving={saving}
            testing={testing}
            testResult={testResult}
            onChange={updateDraft}
            onSave={() => save()}
            onTest={runTest}
            onToggleEnabled={(v) => save({ paystackEnabled: v })}
            onToggleTestMode={(v) => save({ paystackTestMode: v })}
          />

          <UrlsSection urls={urls} />

          <BankSection
            draft={draft}
            saving={saving}
            onChange={updateDraft}
            onSave={() => save()}
          />
        </div>
      )}
    </AdminShell>
  );
}

function Section({
  title,
  description,
  icon,
  children,
  footer,
}: {
  title: string;
  description: string;
  icon: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <section className="border rounded-lg overflow-hidden bg-card">
      <header className="px-6 py-4 border-b bg-muted/30 flex items-start gap-3">
        <div className="p-2 rounded-md bg-background border">{icon}</div>
        <div>
          <h2 className="font-semibold">{title}</h2>
          <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
        </div>
      </header>
      <div className="p-6 space-y-5">{children}</div>
      {footer ? <footer className="px-6 py-4 border-t bg-muted/20">{footer}</footer> : null}
    </section>
  );
}

function PaystackSection({
  draft,
  settings,
  saving,
  testing,
  testResult,
  onChange,
  onSave,
  onTest,
  onToggleEnabled,
  onToggleTestMode,
}: {
  draft: SiteSettings;
  settings: SiteSettings;
  saving: boolean;
  testing: boolean;
  testResult: PaymentsTestResult | null;
  onChange: (patch: SaveablePatch) => void;
  onSave: () => void;
  onTest: () => void;
  onToggleEnabled: (v: boolean) => void;
  onToggleTestMode: (v: boolean) => void;
}) {
  return (
    <Section
      title="Paystack"
      description="Customers will see a Pay with Paystack button when this is enabled and at least one key pair is saved."
      icon={<ShieldCheck className="w-4 h-4 text-violet-600" />}
      footer={
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={onTest}
              disabled={testing}
              data-testid="paystack-test-connection"
            >
              {testing ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : null}
              Test connection
            </Button>
            {testResult ? (
              <span
                className={`text-xs flex items-center gap-1 ${
                  testResult.ok
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-destructive"
                }`}
              >
                {testResult.ok ? (
                  <CheckCircle2 className="w-3.5 h-3.5" />
                ) : (
                  <AlertCircle className="w-3.5 h-3.5" />
                )}
                {testResult.ok
                  ? `${testResult.mode} key verified`
                  : testResult.error}
              </span>
            ) : null}
          </div>
          <Button onClick={onSave} disabled={saving} data-testid="paystack-save">
            {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
            Save Paystack settings
          </Button>
        </div>
      }
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <ToggleRow
          label="Paystack enabled"
          help="When off, only the bank-transfer fallback shows at checkout."
          checked={!!draft.paystackEnabled}
          onChange={onToggleEnabled}
          testId="paystack-enabled"
        />
        <ToggleRow
          label="Test mode"
          help="Uses your sk_test_/pk_test_ keys instead of live."
          checked={!!draft.paystackTestMode}
          onChange={onToggleTestMode}
          testId="paystack-test-mode"
        />
      </div>

      <KeyPair
        label="Live keys"
        publicKeyValue={draft.paystackLivePublicKey ?? ""}
        publicKeyPlaceholder="pk_live_…"
        onPublicKeyChange={(v) => onChange({ paystackLivePublicKey: v })}
        secretKeyValue={draft.paystackLiveSecretKey ?? ""}
        secretKeySaved={settings.paystackLiveSecretKeySet}
        secretKeyPlaceholder="sk_live_…"
        onSecretKeyChange={(v) => onChange({ paystackLiveSecretKey: v })}
        testIdPrefix="live"
      />

      <KeyPair
        label="Test keys (optional)"
        publicKeyValue={draft.paystackTestPublicKey ?? ""}
        publicKeyPlaceholder="pk_test_…"
        onPublicKeyChange={(v) => onChange({ paystackTestPublicKey: v })}
        secretKeyValue={draft.paystackTestSecretKey ?? ""}
        secretKeySaved={settings.paystackTestSecretKeySet}
        secretKeyPlaceholder="sk_test_…"
        onSecretKeyChange={(v) => onChange({ paystackTestSecretKey: v })}
        testIdPrefix="test"
      />
    </Section>
  );
}

function KeyPair({
  label,
  publicKeyValue,
  publicKeyPlaceholder,
  onPublicKeyChange,
  secretKeyValue,
  secretKeySaved,
  secretKeyPlaceholder,
  onSecretKeyChange,
  testIdPrefix,
}: {
  label: string;
  publicKeyValue: string;
  publicKeyPlaceholder: string;
  onPublicKeyChange: (v: string) => void;
  secretKeyValue: string;
  secretKeySaved: boolean;
  secretKeyPlaceholder: string;
  onSecretKeyChange: (v: string) => void;
  testIdPrefix: string;
}) {
  const [reveal, setReveal] = useState(false);
  return (
    <div className="border rounded-md p-4 space-y-4 bg-muted/10">
      <div className="text-xs uppercase tracking-widest text-muted-foreground font-semibold">
        {label}
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${testIdPrefix}-pk`}>Public key</Label>
        <Input
          id={`${testIdPrefix}-pk`}
          value={publicKeyValue}
          onChange={(e) => onPublicKeyChange(e.target.value)}
          placeholder={publicKeyPlaceholder}
          autoComplete="off"
          spellCheck={false}
          data-testid={`paystack-${testIdPrefix}-public-key`}
          className="font-mono text-sm"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${testIdPrefix}-sk`} className="flex items-center justify-between">
          <span>Secret key</span>
          <button
            type="button"
            onClick={() => setReveal((v) => !v)}
            className="text-[11px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
          >
            {reveal ? (
              <>
                <EyeOff className="w-3 h-3" /> Hide
              </>
            ) : (
              <>
                <Eye className="w-3 h-3" /> Show
              </>
            )}
          </button>
        </Label>
        <Input
          id={`${testIdPrefix}-sk`}
          type={reveal ? "text" : "password"}
          value={secretKeyValue}
          onChange={(e) => onSecretKeyChange(e.target.value)}
          placeholder={
            secretKeySaved ? "(saved — paste a new key to replace)" : secretKeyPlaceholder
          }
          autoComplete="off"
          spellCheck={false}
          data-testid={`paystack-${testIdPrefix}-secret-key`}
          className="font-mono text-sm"
        />
        <p className="text-[11px] text-muted-foreground">
          The secret key is stored in the database and never sent back to
          the browser in full — you'll see <span className="font-mono">••••</span> until you
          paste a fresh value. Treat database access accordingly.
        </p>
      </div>
    </div>
  );
}

function ToggleRow({
  label,
  help,
  checked,
  onChange,
  testId,
}: {
  label: string;
  help: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  testId: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border rounded-md p-4 bg-muted/10">
      <div>
        <div className="text-sm font-medium">{label}</div>
        <p className="text-xs text-muted-foreground mt-1">{help}</p>
      </div>
      <Switch
        checked={checked}
        onCheckedChange={onChange}
        data-testid={testId}
      />
    </div>
  );
}

function UrlsSection({ urls }: { urls: PaymentsUrls | null }) {
  return (
    <Section
      title="Webhook & Callback URLs"
      description="Paste these into your Paystack dashboard so payments come back to this site. They update automatically with the current domain."
      icon={<LinkIcon className="w-4 h-4 text-indigo-600" />}
    >
      {!urls ? (
        <p className="text-sm text-muted-foreground">Resolving site URL…</p>
      ) : (
        <div className="space-y-4">
          <UrlRow
            label="Live Callback URL"
            help="Paystack → Settings → Preferences → Callback URL"
            value={urls.callbackUrl}
            testId="paystack-callback-url"
          />
          <UrlRow
            label="Live Webhook URL"
            help="Paystack → Settings → API Keys & Webhooks → Webhook URL"
            value={urls.webhookUrl}
            testId="paystack-webhook-url"
          />
        </div>
      )}
    </Section>
  );
}

function UrlRow({
  label,
  help,
  value,
  testId,
}: {
  label: string;
  help: string;
  value: string;
  testId: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        <Label className="text-xs uppercase tracking-widest">{label}</Label>
        <span className="text-[11px] text-muted-foreground">{help}</span>
      </div>
      <div className="flex items-stretch gap-2">
        <code
          className="flex-1 font-mono text-sm break-all border rounded-md px-3 py-2 bg-muted/30"
          data-testid={testId}
        >
          {value}
        </code>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            void navigator.clipboard
              .writeText(value)
              .then(() => {
                setCopied(true);
                toast.success(`${label} copied`);
                setTimeout(() => setCopied(false), 1500);
              })
              .catch(() => toast.error("Could not copy"));
          }}
          className="shrink-0"
        >
          {copied ? (
            <CheckCircle2 className="w-4 h-4 mr-1" />
          ) : (
            <Copy className="w-4 h-4 mr-1" />
          )}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
    </div>
  );
}

function BankSection({
  draft,
  saving,
  onChange,
  onSave,
}: {
  draft: SiteSettings;
  saving: boolean;
  onChange: (patch: SaveablePatch) => void;
  onSave: () => void;
}) {
  return (
    <Section
      title="Bank transfer fallback"
      description="Shown to customers when Paystack is disabled (or no keys are saved). Leave blank to hide a row."
      icon={<Banknote className="w-4 h-4 text-emerald-600" />}
      footer={
        <div className="flex justify-end">
          <Button onClick={onSave} disabled={saving} data-testid="bank-save">
            {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
            Save bank details
          </Button>
        </div>
      }
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <BankField label="Bank name" value={draft.bankName} onChange={(v) => onChange({ bankName: v })} testId="bank-name" />
        <BankField label="Account name" value={draft.bankAccountName} onChange={(v) => onChange({ bankAccountName: v })} testId="bank-account-name" />
        <BankField label="Account number" value={draft.bankAccountNumber} onChange={(v) => onChange({ bankAccountNumber: v })} testId="bank-account-number" mono />
        <BankField label="Routing / ABA" value={draft.bankRoutingNumber} onChange={(v) => onChange({ bankRoutingNumber: v })} testId="bank-routing" mono />
        <BankField label="SWIFT / BIC" value={draft.bankSwiftCode} onChange={(v) => onChange({ bankSwiftCode: v })} testId="bank-swift" mono />
      </div>
      <div className="space-y-2">
        <Label htmlFor="bank-instructions">Notes for customer</Label>
        <Textarea
          id="bank-instructions"
          value={draft.bankInstructions ?? ""}
          onChange={(e) => onChange({ bankInstructions: e.target.value })}
          rows={3}
          placeholder="e.g. Please include your order number in the transfer reference."
          data-testid="bank-instructions"
        />
      </div>
    </Section>
  );
}

function BankField({
  label,
  value,
  onChange,
  testId,
  mono,
}: {
  label: string;
  value: string | null;
  onChange: (v: string) => void;
  testId: string;
  mono?: boolean;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={testId}>{label}</Label>
      <Input
        id={testId}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        className={mono ? "font-mono text-sm" : undefined}
        data-testid={testId}
      />
    </div>
  );
}
