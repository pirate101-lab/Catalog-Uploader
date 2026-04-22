import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "wouter";
import { AdminShell, AdminPageHeader, useAdminIdentity } from "./AdminShell";
import {
  adminApi,
  fmtCents,
  type PaymentEventRow,
  type SiteSettings,
  type PaymentsUrls,
  type PaymentsTestResult,
} from "./api";
import { usePaymentEventStream } from "./usePaymentEventStream";
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
  Activity,
  XCircle,
  Clock,
  Search,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";

type SaveablePatch = Partial<SiteSettings>;

export function PaymentsAdmin() {
  // General admins get a read-only view of payment events for support
  // work, but never see Paystack keys, callback/webhook URLs or bank
  // account material. Anything mutating those (PUT /admin/settings,
  // /admin/payments/test, etc.) is also blocked server-side.
  const me = useAdminIdentity();
  const isSuper = me?.role === "super_admin" || me == null;
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
    // Settings is required for both roles; the URLs endpoint is
    // super-admin only, so general admins must tolerate a 403 there
    // without breaking the rest of the page (read-only payment events
    // is the whole point of this view for them).
    const urlsPromise = isSuper
      ? adminApi.getPaymentsUrls().catch(() => null)
      : Promise.resolve(null);
    Promise.all([adminApi.getSettings(), urlsPromise])
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
  }, [isSuper]);

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
          {isSuper ? (
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
          ) : null}

          {isSuper ? <UrlsSection urls={urls} /> : null}

          <PaymentEventsSection />

          {isSuper ? (
            <BankSection
              draft={draft}
              saving={saving}
              onChange={updateDraft}
              onSave={() => save()}
              onToggleEnabled={(v) => save({ bankTransferEnabled: v })}
            />
          ) : (
            <p className="text-xs text-muted-foreground">
              Paystack keys, callback URLs and bank-transfer details are
              managed by super admins only.
            </p>
          )}
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
  onToggleEnabled,
}: {
  draft: SiteSettings;
  saving: boolean;
  onChange: (patch: SaveablePatch) => void;
  onSave: () => void;
  onToggleEnabled: (enabled: boolean) => void;
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
      <ToggleRow
        label="Bank transfer enabled"
        help="When off, the bank-transfer option is hidden at checkout. Saved details below are kept."
        checked={!!draft.bankTransferEnabled}
        onChange={onToggleEnabled}
        testId="bank-transfer-enabled"
      />
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

/* ---------------- Payment activity ----------------
 * Recent Paystack outcomes (success / failed / abandoned) with a live
 * stream so a brand-new event slides in at the top without a page
 * refresh. Failed and abandoned rows are the main reason this panel
 * exists — they used to be log-only and easy to miss.
 */
const PAGE_SIZE = 50;

function PaymentEventsSection() {
  const [rows, setRows] = useState<PaymentEventRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "success" | "failed" | "abandoned">(
    "all",
  );
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);

  // Debounce the search box so we don't hammer the API on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(0);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Reset pagination whenever any filter (other than page itself) changes.
  useEffect(() => {
    setPage(0);
  }, [filter, from, to]);

  // `to` is a calendar date; treat it as inclusive by sending end-of-day.
  const toIso = useMemo(() => {
    if (!to) return undefined;
    const d = new Date(`${to}T23:59:59.999`);
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
  }, [to]);
  const fromIso = useMemo(() => {
    if (!from) return undefined;
    const d = new Date(`${from}T00:00:00`);
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
  }, [from]);

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    setError(null);
    adminApi
      .listPaymentEvents({
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
        kind: filter === "all" ? undefined : filter,
        from: fromIso,
        to: toIso,
        q: search || undefined,
      })
      .then((r) => {
        if (cancelled) return;
        setRows(r.rows);
        setTotal(r.total);
        setError(null);
      })
      .catch((e) => !cancelled && setError((e as Error).message));
    return () => {
      cancelled = true;
    };
  }, [filter, fromIso, toIso, search, page]);

  // Live updates via SSE — only prepend on the first page when no
  // search/date filters are active, otherwise pagination + filtering
  // would be misleading. We still keep the listener alive so toggling
  // back to defaults immediately resumes live behavior.
  const liveOk = page === 0 && !search && !fromIso && !toIso;
  usePaymentEventStream((ev) => {
    if (!liveOk) return;
    setRows((prev) => {
      if (!prev) return prev;
      if (filter !== "all" && ev.kind !== filter) return prev;
      if (prev.some((r) => r.id === ev.id)) return prev;
      setTotal((t) => t + 1);
      return [ev, ...prev].slice(0, PAGE_SIZE);
    });
  });

  const filters: Array<{ key: typeof filter; label: string; testId: string }> = useMemo(
    () => [
      { key: "all", label: "All", testId: "filter-all" },
      { key: "success", label: "Successes", testId: "filter-success" },
      { key: "failed", label: "Failed", testId: "filter-failed" },
      { key: "abandoned", label: "Abandoned", testId: "filter-abandoned" },
    ],
    [],
  );

  const pageStart = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const pageEnd = Math.min(total, (page + 1) * PAGE_SIZE);
  const hasPrev = page > 0;
  const hasNext = (page + 1) * PAGE_SIZE < total;
  const filtersActive = !!(search || fromIso || toIso || filter !== "all");

  return (
    <Section
      title="Recent payment activity"
      description="Every Paystack webhook and customer return is recorded here. Live updates — new events appear without a refresh."
      icon={<Activity className="w-4 h-4 text-sky-600" />}
    >
      <div className="flex flex-wrap items-center gap-2">
        {filters.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            data-testid={`payment-events-${f.testId}`}
            className={`text-xs px-3 py-1.5 rounded-full border transition ${
              filter === f.key
                ? "bg-foreground text-background border-foreground"
                : "bg-background hover:bg-muted/40"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto] gap-3 items-end">
        <div className="space-y-1">
          <Label htmlFor="payment-events-search" className="text-xs">
            Search
          </Label>
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <Input
              id="payment-events-search"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Order id, email, or Paystack reference"
              className="pl-8"
              data-testid="payment-events-search"
            />
          </div>
        </div>
        <div className="space-y-1">
          <Label htmlFor="payment-events-from" className="text-xs">
            From
          </Label>
          <Input
            id="payment-events-from"
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            data-testid="payment-events-from"
            className="w-[10rem]"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="payment-events-to" className="text-xs">
            To
          </Label>
          <Input
            id="payment-events-to"
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            data-testid="payment-events-to"
            className="w-[10rem]"
          />
        </div>
      </div>

      {filtersActive && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span data-testid="payment-events-summary">
            {total === 0
              ? "No matches for the current filters."
              : `${total} match${total === 1 ? "" : "es"}`}
          </span>
          <button
            type="button"
            onClick={() => {
              setFilter("all");
              setFrom("");
              setTo("");
              setSearchInput("");
              // Skip the debounce so the cleared state takes effect on
              // the very next request rather than 300ms later.
              setSearch("");
              setPage(0);
            }}
            className="underline hover:text-foreground"
            data-testid="payment-events-clear"
          >
            Clear filters
          </button>
        </div>
      )}

      {error && (
        <div className="text-sm text-destructive flex items-center gap-2">
          <AlertCircle className="w-4 h-4" /> {error}
        </div>
      )}

      {!rows ? (
        <p className="text-sm text-muted-foreground">Loading payment events…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {filtersActive
            ? "No payment events match the current filters."
            : "No payment events yet — once Paystack starts firing, every result (good or bad) will land here."}
        </p>
      ) : (
        <>
          <ul className="divide-y border rounded-md" data-testid="payment-events-list">
            {rows.map((ev) => (
              <PaymentEventItem key={ev.id} event={ev} />
            ))}
          </ul>
          <div className="flex items-center justify-between pt-1 text-xs text-muted-foreground">
            <span data-testid="payment-events-page-info">
              Showing {pageStart}–{pageEnd} of {total}
            </span>
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={!hasPrev}
                data-testid="payment-events-prev"
              >
                <ChevronLeft className="w-3.5 h-3.5 mr-1" />
                Prev
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => p + 1)}
                disabled={!hasNext}
                data-testid="payment-events-next"
              >
                Next
                <ChevronRight className="w-3.5 h-3.5 ml-1" />
              </Button>
            </div>
          </div>
        </>
      )}
    </Section>
  );
}

function PaymentEventItem({ event }: { event: PaymentEventRow }) {
  const meta = kindMeta(event.kind);
  const Icon = meta.icon;
  const when = new Date(event.createdAt);
  const body = (
    <div className="flex items-start gap-3 px-4 py-3 hover:bg-muted/30 transition">
      <div className={`mt-0.5 ${meta.color}`}>
        <Icon className="w-4 h-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-xs uppercase tracking-widest font-semibold ${meta.color}`}>
            {meta.label}
          </span>
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground border rounded px-1.5 py-0.5">
            {event.source}
          </span>
          <span className="text-[10px] font-mono text-muted-foreground">
            {event.code}
          </span>
          {event.amountCents != null ? (
            <span className="text-xs text-muted-foreground">
              {fmtCents(event.amountCents)}
              {event.currency ? ` ${event.currency}` : ""}
            </span>
          ) : null}
        </div>
        {event.message ? (
          <p className="text-sm mt-0.5 break-words">{event.message}</p>
        ) : null}
        <div className="text-[11px] text-muted-foreground mt-1 flex items-center gap-2">
          <Clock className="w-3 h-3" />
          {when.toLocaleString()}
          {event.reference ? (
            <span className="font-mono truncate">· ref {event.reference}</span>
          ) : null}
        </div>
      </div>
    </div>
  );
  // Click-through to the matching order detail when we have one. Failed
  // events without an order id (e.g. forged references) stay non-clickable.
  return (
    <li>
      {event.orderId ? (
        <Link
          href={`/admin/orders/${event.orderId}`}
          className="block"
          data-testid={`payment-event-${event.id}`}
        >
          {body}
        </Link>
      ) : (
        <div data-testid={`payment-event-${event.id}`}>{body}</div>
      )}
    </li>
  );
}

function kindMeta(kind: PaymentEventRow["kind"]): {
  label: string;
  icon: typeof CheckCircle2;
  color: string;
} {
  if (kind === "success") {
    return {
      label: "Paid",
      icon: CheckCircle2,
      color: "text-emerald-600 dark:text-emerald-400",
    };
  }
  if (kind === "abandoned") {
    return {
      label: "Abandoned",
      icon: Clock,
      color: "text-amber-600 dark:text-amber-400",
    };
  }
  return {
    label: "Failed",
    icon: XCircle,
    color: "text-destructive",
  };
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
