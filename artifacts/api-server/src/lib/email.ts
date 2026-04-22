import type { Logger } from "pino";
import net from "node:net";
import nodemailer, { type Transporter } from "nodemailer";
import { getSiteSettings, symbolForCurrency } from "./siteSettings";
import {
  db,
  orderEmailEventsTable,
  type Order,
  type PaymentEvent,
  type SiteSettings,
} from "@workspace/db";
import { logger as baseLogger } from "./logger";

async function recordOrderEmailEvent(args: {
  orderId: string;
  kind: OrderEmailKind;
  status: "sent" | "failed" | "skipped";
  toAddress: string | null;
  fromAddress: string | null;
  errorMessage?: string | null;
  statusCode?: number | null;
  log: Logger;
}): Promise<void> {
  try {
    await db.insert(orderEmailEventsTable).values({
      orderId: args.orderId,
      kind: args.kind,
      status: args.status,
      toAddress: args.toAddress,
      fromAddress: args.fromAddress,
      errorMessage: args.errorMessage ?? null,
      statusCode: args.statusCode ?? null,
    });
  } catch (err) {
    args.log.error(
      { err, orderId: args.orderId, kind: args.kind },
      "Failed to record order email event",
    );
  }
}

interface OrderItem {
  productId: string;
  title: string;
  quantity: number;
  color?: string;
  size?: string;
  unitPriceCents: number;
  image?: string;
}

interface ShippingAddress {
  firstName?: string | null;
  lastName?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  country?: string | null;
}

const RESEND_ENDPOINT = "https://api.resend.com/emails";

export type OrderEmailKind =
  | "received"
  | "confirmation"
  | "shipped"
  | "delivered";

/** Display labels mirrored on the admin UI. */
export const ORDER_EMAIL_KINDS: readonly OrderEmailKind[] = [
  "received",
  "confirmation",
  "shipped",
  "delivered",
] as const;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatMoney(cents: number, symbol: string): string {
  return `${symbol}${(cents / 100).toFixed(2)}`;
}

function shortOrderId(id: string): string {
  return id.slice(0, 8).toUpperCase();
}

function formatAddressLines(addr: ShippingAddress | null | undefined): string[] {
  if (!addr) return [];
  const name = [addr.firstName, addr.lastName].filter(Boolean).join(" ");
  const cityLine = [
    addr.city,
    [addr.state, addr.zip].filter(Boolean).join(" "),
  ]
    .filter((part) => part && String(part).trim().length > 0)
    .join(", ");
  return [name, addr.address ?? "", cityLine, addr.country ?? ""]
    .map((line) => (line ?? "").toString().trim())
    .filter((line) => line.length > 0);
}

interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

/**
 * Pick the right amounts to render in the email body.
 *
 * Hybrid-currency context: the storefront prices everything in USD
 * (`displayCurrency` + `display*Cents`) but the Paystack charge — and
 * therefore the canonical `order.currency` / `order.*Cents` columns —
 * is denominated in KES. The customer agreed to a USD price on the
 * storefront, so the breakdown has to lead with USD; we then surface
 * the KES amount as a contextual "card was charged" line so the
 * shopper isn't confused when their bank statement disagrees with the
 * dollar figure.
 *
 * Legacy orders (pre-FX-lock) have NULL display columns; for those we
 * fall back to the canonical columns so the old emails still render.
 */
function viewOrderAmounts(order: Order, fallbackSymbol: string) {
  const hasDisplaySnapshot =
    !!order.displayCurrency && order.displayTotalCents !== null;
  const displayCurrency = order.displayCurrency ?? order.currency;
  return {
    displayCurrency,
    displaySymbol: hasDisplaySnapshot
      ? symbolForCurrency(displayCurrency)
      : fallbackSymbol,
    displaySubtotalCents:
      order.displaySubtotalCents ?? order.subtotalCents,
    displayShippingCents:
      order.displayShippingCents ?? order.shippingCents,
    displayTaxCents: order.displayTaxCents ?? order.taxCents,
    displayTotalCents: order.displayTotalCents ?? order.totalCents,
    chargeCurrency: order.currency,
    chargeSymbol: symbolForCurrency(order.currency),
    chargeTotalCents: order.totalCents,
    showChargeContext:
      hasDisplaySnapshot &&
      order.currency.toUpperCase() !== displayCurrency.toUpperCase(),
  };
}

function renderOrderEmail(
  order: Order,
  kind: OrderEmailKind,
  storeName: string,
  currencySymbol: string,
): RenderedEmail {
  const items = (order.items as OrderItem[]) ?? [];
  const view = viewOrderAmounts(order, currencySymbol);
  const orderRef = shortOrderId(order.id);
  const storefrontUrl = getStorefrontUrl();
  const storefrontDisplay = getStorefrontDisplay(storefrontUrl);
  const ctaLabel =
    kind === "delivered" ? "Shop again" : "Visit the shop";

  let heading: string;
  let intro: string;
  let subject: string;
  if (kind === "received") {
    heading = "Thanks — we've got your order";
    intro = `We just received your order #${orderRef} from ${storeName} and our team is reviewing it. You'll get a separate confirmation email the moment it's packed and ready to ship.`;
    subject = `We received your order #${orderRef}`;
  } else if (kind === "confirmation") {
    heading = "Your order is confirmed";
    intro = `Great news — your order #${orderRef} from ${storeName} is confirmed and being packed for dispatch. We'll email you again as soon as it's on its way.`;
    subject = `Your order #${orderRef} is confirmed`;
  } else if (kind === "shipped") {
    heading = "Your order is on its way";
    intro = `Your order #${orderRef} from ${storeName} just shipped. Tracking details will follow as soon as the carrier scans it in.`;
    subject = `Order #${orderRef} shipped`;
  } else {
    heading = "Your order has arrived";
    intro = `Your order #${orderRef} from ${storeName} has been delivered. We hope you love every piece — reply to this email if anything isn't quite right.`;
    subject = `Order #${orderRef} delivered`;
  }

  const itemsHtml = items
    .map((it) => {
      const variant = [it.color, it.size].filter(Boolean).join(" / ");
      const lineTotal = formatMoney(
        it.unitPriceCents * it.quantity,
        view.displaySymbol,
      );
      return `<tr>
        <td style="padding:8px 0;border-bottom:1px solid #eee;">
          <div style="font-weight:600;">${escapeHtml(it.title)}</div>
          ${variant ? `<div style="color:#666;font-size:12px;">${escapeHtml(variant)}</div>` : ""}
          <div style="color:#666;font-size:12px;">Qty ${it.quantity}</div>
        </td>
        <td style="padding:8px 0;border-bottom:1px solid #eee;text-align:right;vertical-align:top;">
          ${lineTotal}
        </td>
      </tr>`;
    })
    .join("");

  // Lead with the display currency the shopper saw on the storefront
  // (USD today). `view` falls back to the canonical columns for legacy
  // orders so older emails still render with the original symbol.
  const subtotal = formatMoney(view.displaySubtotalCents, view.displaySymbol);
  const shipping = formatMoney(view.displayShippingCents, view.displaySymbol);
  const tax = formatMoney(view.displayTaxCents, view.displaySymbol);
  const total = formatMoney(view.displayTotalCents, view.displaySymbol);
  const chargeTotal = view.showChargeContext
    ? formatMoney(view.chargeTotalCents, view.chargeSymbol)
    : null;

  const showBreakdown = kind === "received" || kind === "confirmation";
  const breakdownHtml = showBreakdown
    ? `
      <tr>
        <td style="padding:8px 0 0 0;color:#444;">Subtotal</td>
        <td style="padding:8px 0 0 0;text-align:right;color:#444;">${subtotal}</td>
      </tr>
      <tr>
        <td style="padding:4px 0;color:#444;">Shipping</td>
        <td style="padding:4px 0;text-align:right;color:#444;">${shipping}</td>
      </tr>
      <tr>
        <td style="padding:4px 0;color:#444;">Tax</td>
        <td style="padding:4px 0;text-align:right;color:#444;">${tax}</td>
      </tr>`
    : "";

  // Surface the actual card-charge amount so the customer doesn't get
  // confused when their bank statement shows KES instead of USD.
  const chargeNoteHtml =
    chargeTotal && (kind === "received" || kind === "confirmation")
      ? `<p style="margin:12px 0 0 0;color:#666;font-size:12px;">
          Your card was charged ${chargeTotal} ${escapeHtml(view.chargeCurrency)} via Paystack (≈ ${total} ${escapeHtml(view.displayCurrency)}).
        </p>`
      : "";

  const addressLines =
    kind === "received" || kind === "confirmation"
      ? formatAddressLines(order.shippingAddress as ShippingAddress | null)
      : [];
  const addressHtml =
    addressLines.length > 0
      ? `<h2 style="font-size:14px;text-transform:uppercase;letter-spacing:1px;color:#666;margin:24px 0 8px 0;">Shipping to</h2>
         <div style="font-size:14px;color:#444;line-height:1.5;">
           ${addressLines.map((l) => escapeHtml(l)).join("<br>")}
         </div>`
      : "";

  // `color-scheme:light` + explicit hex colours keeps Gmail / Apple Mail /
  // Outlook web from inverting our palette in dark mode (which previously
  // turned light text on white into white on white). The wrapper bg is a
  // neutral light grey that reads well in both schemes.
  const html = `<!doctype html>
<html><head><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"></head><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#fafafa;padding:24px;color:#111;color-scheme:light;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;padding:32px;border-radius:8px;color:#111;">
    <h1 style="font-size:22px;margin:0 0 8px 0;">${escapeHtml(heading)}</h1>
    <p style="margin:0 0 24px 0;color:#444;">${escapeHtml(intro)}</p>
    <h2 style="font-size:14px;text-transform:uppercase;letter-spacing:1px;color:#666;margin:0 0 8px 0;">Order #${orderRef}</h2>
    <table style="width:100%;border-collapse:collapse;font-size:14px;">
      ${itemsHtml}
      ${breakdownHtml}
      <tr>
        <td style="padding:12px 0 0 0;font-weight:600;border-top:${showBreakdown ? "1px solid #eee" : "0"};">Total</td>
        <td style="padding:12px 0 0 0;text-align:right;font-weight:600;border-top:${showBreakdown ? "1px solid #eee" : "0"};">${total}</td>
      </tr>
    </table>
    ${chargeNoteHtml}
    ${addressHtml}
    <p style="margin:32px 0 16px 0;">
      <a href="${escapeHtml(storefrontUrl)}" style="display:inline-block;background:#111;color:#ffffff;text-decoration:none;padding:10px 20px;border-radius:4px;font-size:14px;">${escapeHtml(ctaLabel)}</a>
    </p>
    <p style="margin:24px 0 0 0;color:#888;font-size:12px;">${escapeHtml(storeName)} · <a href="${escapeHtml(storefrontUrl)}" style="color:#888;">${escapeHtml(storefrontDisplay)}</a></p>
  </div>
</body></html>`;

  const textLines: string[] = [
    heading,
    "",
    intro,
    "",
    `Order #${orderRef}`,
    ...items.map((it) => {
      const variant = [it.color, it.size].filter(Boolean).join(" / ");
      const variantStr = variant ? ` (${variant})` : "";
      const lineTotal = formatMoney(
        it.unitPriceCents * it.quantity,
        view.displaySymbol,
      );
      return `- ${it.title}${variantStr} x${it.quantity}  ${lineTotal}`;
    }),
    "",
  ];
  if (showBreakdown) {
    textLines.push(
      `Subtotal: ${subtotal}`,
      `Shipping: ${shipping}`,
      `Tax: ${tax}`,
    );
  }
  textLines.push(`Total: ${total}`);
  if (chargeTotal && (kind === "received" || kind === "confirmation")) {
    textLines.push(
      `Card charged: ${chargeTotal} ${view.chargeCurrency} via Paystack (≈ ${total} ${view.displayCurrency})`,
    );
  }
  if (addressLines.length > 0) {
    textLines.push("", "Shipping to:", ...addressLines);
  }
  textLines.push("", `${ctaLabel}: ${storefrontUrl}`, "", storeName);

  return { subject, html, text: textLines.join("\n") };
}

/** Resolve the public storefront URL used in email CTAs. Honours the
 *  `PUBLIC_SITE_URL` env var (set in production), then the dev preview
 *  domain, and finally a sensible default so links never render blank. */
function getStorefrontUrl(): string {
  const fromEnv = process.env["PUBLIC_SITE_URL"]?.trim();
  if (fromEnv) return fromEnv.replace(/\/+$/, "");
  const devDomain = process.env["REPLIT_DEV_DOMAIN"]?.trim();
  if (devDomain) return `https://${devDomain}`;
  return "https://shopthelook.page";
}

function getStorefrontDisplay(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

interface SenderResolution {
  from: string;
  replyTo: string | null;
  storeName: string;
  currencySymbol: string;
  /** true when from-address came from configured settings or env override
   *  rather than the resend.dev sandbox fallback. */
  configured: boolean;
}

interface SettingsLike {
  storeName?: string | null;
  currencySymbol?: string | null;
  emailFromAddress?: string | null;
  emailFromName?: string | null;
  emailReplyTo?: string | null;
  smtpHost?: string | null;
  smtpPort?: number | null;
  smtpSecure?: boolean | null;
  smtpUsername?: string | null;
  smtpPassword?: string | null;
}

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string;
}

/** All four credentials Titan/Zoho/Google etc. require at minimum to
 *  open and authenticate an SMTP session. Surfacing the exact subset
 *  that's missing lets the admin UI tell the operator which input is
 *  empty rather than a blanket "not fully configured" message. */
export type SmtpField = "host" | "port" | "username" | "password";

export interface SmtpResolution {
  cfg: SmtpConfig | null;
  /** Names of the required credentials that are missing/blank. Empty
   *  array means cfg is non-null. */
  missing: SmtpField[];
}

export function resolveSmtpConfigWithDiagnostics(
  s: SettingsLike,
): SmtpResolution {
  const host = (s.smtpHost ?? "").trim();
  const username = (s.smtpUsername ?? "").trim();
  const password = s.smtpPassword ?? "";
  const port = s.smtpPort ?? 0;
  const missing: SmtpField[] = [];
  if (!host) missing.push("host");
  if (!port) missing.push("port");
  if (!username) missing.push("username");
  if (!password) missing.push("password");
  if (missing.length > 0) return { cfg: null, missing };
  return {
    cfg: {
      host,
      port,
      secure: s.smtpSecure ?? true,
      username,
      password,
    },
    missing,
  };
}

/** Back-compat helper used by the order-email send path. Returns the
 *  fully-validated SMTP config or null when any of host/port/username/
 *  password is missing. */
export function resolveSmtpConfig(s: SettingsLike): SmtpConfig | null {
  return resolveSmtpConfigWithDiagnostics(s).cfg;
}

/** Structured error returned from {@link verifySmtp} so the admin UI
 *  can render a category-specific hint instead of dumping the raw
 *  nodemailer message. */
export type SmtpErrorCategory =
  | "auth"
  | "tls"
  | "dns"
  | "timeout"
  | "connection"
  | "unknown";

export interface SmtpVerifyError {
  category: SmtpErrorCategory;
  /** Underlying nodemailer / SMTP code if known (e.g. EAUTH, ECONNREFUSED). */
  code: string | null;
  /** SMTP response status code (e.g. 535) when the server replied. */
  statusCode: number | null;
  /** Raw message from nodemailer, for the "details" line. */
  message: string;
  /** Operator-facing hint describing how to fix the category. */
  hint: string;
}

/** Map a nodemailer error to one of the operator-friendly categories.
 *  Covers EAUTH (auth), ECONNREFUSED (connection), ETIMEDOUT (timeout),
 *  ENOTFOUND (DNS), ESOCKET / certificate issues (tls). Anything else
 *  is reported as "unknown" with the raw message preserved. */
export function categorizeSmtpError(err: unknown): SmtpVerifyError {
  const e = err as {
    message?: string;
    code?: string;
    responseCode?: number;
    command?: string;
  };
  const code = e.code ?? null;
  const statusCode =
    typeof e.responseCode === "number" ? e.responseCode : null;
  const message = e.message ?? "Unknown SMTP error";
  const lc = message.toLowerCase();

  // Auth: nodemailer code EAUTH, or 5xx 535/534/501 response on AUTH.
  if (
    code === "EAUTH" ||
    statusCode === 535 ||
    statusCode === 534 ||
    /authentication failed|auth failed|invalid login|username and password not accepted/.test(
      lc,
    )
  ) {
    return {
      category: "auth",
      code,
      statusCode,
      message,
      hint: "Authentication failed. Double-check the SMTP username (it must be the full email address) and password. Titan, Zoho and Google Workspace require an app-specific password when 2FA is on — your normal mailbox password will be rejected. On Titan, a wrong password often shows up as a silent timeout instead of a clean 535 error, so if the host/port are right this is the most likely cause.",
    };
  }

  // TLS / certificate / handshake.
  if (
    /tls|ssl|certificate|self.signed|hostname.*mismatch|wrong version number/.test(
      lc,
    )
  ) {
    return {
      category: "tls",
      code,
      statusCode,
      message,
      hint: "TLS handshake failed. Try toggling SSL/TLS off (uses STARTTLS on port 587) or on (uses SSL on port 465), and confirm the host matches your provider's documentation.",
    };
  }

  // DNS resolution.
  if (code === "ENOTFOUND" || code === "EAI_AGAIN" || /getaddrinfo|enotfound/.test(lc)) {
    return {
      category: "dns",
      code,
      statusCode,
      message,
      hint: "The SMTP host could not be resolved. Check for a typo (e.g. smtp.titan.email, not smtp.titan.mail) and that DNS is reachable from this server.",
    };
  }

  // Timeout: nodemailer ETIMEDOUT or our own greeting/socket/connection
  // timeouts firing inside buildTransport.
  if (
    code === "ETIMEDOUT" ||
    code === "ETIME" ||
    /timed out|timeout/.test(lc)
  ) {
    return {
      category: "timeout",
      code,
      statusCode,
      message,
      hint: "Connection timed out. The host may be wrong, blocked by a firewall, or using a different port. Try the alternate port (465 ↔ 587).",
    };
  }

  // Connection refused / reset / network-level failure.
  if (
    code === "ECONNREFUSED" ||
    code === "ECONNRESET" ||
    code === "EHOSTUNREACH" ||
    code === "ENETUNREACH" ||
    code === "ESOCKET"
  ) {
    return {
      category: "connection",
      code,
      statusCode,
      message,
      hint: "Could not open a connection to the SMTP server. Confirm the host/port and that this server is allowed to reach it (some hosts block port 25/587 by default).",
    };
  }

  return {
    category: "unknown",
    code,
    statusCode,
    message,
    hint: "Unrecognised SMTP error. The full message above is from your mail provider — search it in their docs to identify the next step.",
  };
}

/**
 * Open a raw TCP socket to host:port with a tight timeout, then
 * immediately close it. Used as a pre-flight before {@link verifySmtp}
 * so we can tell the difference between:
 *
 *   - a true network problem (DNS, blocked port, host typo) — the
 *     probe fails and we report a clean network category, AND
 *
 *   - a credential problem masquerading as a timeout — the probe
 *     succeeds (proving the network is fine) but the subsequent SMTP
 *     conversation hangs because the server silently drops the socket
 *     after AUTH. Titan and Zoho both do this; without the probe the
 *     operator sees ETIMEDOUT and assumes a firewall issue.
 *
 * Returns null on success, or a probe error object that mirrors the
 * shape nodemailer would have given us so categorizeSmtpError() can
 * consume it directly.
 */
async function probeSmtpReachable(
  host: string,
  port: number,
  timeoutMs = 6_000,
): Promise<{ code: string; message: string } | null> {
  return await new Promise((resolve) => {
    const sock = new net.Socket();
    let settled = false;
    const finish = (err: { code: string; message: string } | null) => {
      if (settled) return;
      settled = true;
      try {
        sock.destroy();
      } catch {
        /* socket already closed */
      }
      resolve(err);
    };
    sock.setTimeout(timeoutMs);
    sock.once("timeout", () =>
      finish({
        code: "ETIMEDOUT",
        message: `TCP connect to ${host}:${port} timed out after ${timeoutMs}ms`,
      }),
    );
    sock.once("error", (err: NodeJS.ErrnoException) =>
      finish({
        code: err.code ?? "ESOCKET",
        message: err.message || `TCP connect to ${host}:${port} failed`,
      }),
    );
    sock.once("connect", () => finish(null));
    try {
      sock.connect(port, host);
    } catch (err) {
      finish({
        code: "ESOCKET",
        message:
          err instanceof Error ? err.message : `Could not initiate connect to ${host}:${port}`,
      });
    }
  });
}

function buildTransport(cfg: SmtpConfig): Transporter {
  return nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure, // true for 465, false for 587/STARTTLS
    auth: { user: cfg.username, pass: cfg.password },
    // Titan and many shared SMTP hosts can be slow to handshake on
    // first connection; give them up to 15s before we time out.
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 20_000,
  });
}

async function sendViaSmtp(args: {
  cfg: SmtpConfig;
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo: string | null;
}): Promise<SendAttempt> {
  try {
    const transport = buildTransport(args.cfg);
    const info = await transport.sendMail({
      from: args.from,
      to: args.to,
      subject: args.subject,
      html: args.html,
      text: args.text,
      replyTo: args.replyTo ?? undefined,
    });
    transport.close();
    if (info.rejected && info.rejected.length > 0) {
      return {
        ok: false,
        errorMessage: `SMTP rejected recipient(s): ${info.rejected.join(", ")}`,
        transient: false,
      };
    }
    return { ok: true, transient: false };
  } catch (err) {
    // nodemailer surfaces the SMTP response code in `responseCode` and
    // a friendly message in `message`. Surface both so the admin can
    // tell the difference between "auth failed" (535) and "connection
    // refused" (network).
    const e = err as { message?: string; responseCode?: number; code?: string };
    const code = e.responseCode ?? e.code ?? null;
    const msg = e.message ?? "Unknown SMTP error";
    return {
      ok: false,
      errorMessage: code ? `${msg} (code ${code})` : msg,
      // 4xx SMTP responses are transient by spec; 5xx and connect errors
      // we treat as permanent so we don't loop on bad credentials.
      transient: typeof e.responseCode === "number" && e.responseCode >= 400 && e.responseCode < 500,
      statusCode: typeof e.responseCode === "number" ? e.responseCode : undefined,
    };
  }
}

export interface SmtpVerifyResult {
  ok: boolean;
  /** True when host/port/username/password were all present at verify
   *  time (so we actually attempted the handshake). False means the
   *  request was rejected before any network call. */
  configured: boolean;
  /** When configured=false: the names of the credentials that are
   *  blank/missing. Empty array when configured=true. */
  missing: SmtpField[];
  /** Structured error when ok=false. Null on success. */
  error: SmtpVerifyError | null;
}

/** Run a no-op SMTP handshake to check that the supplied credentials
 *  can authenticate against the configured host. Used by the admin
 *  "Verify connection" button. The returned result is structured so
 *  the UI can render a category-specific hint (auth/tls/dns/timeout/
 *  connection) rather than the raw nodemailer string. */
export async function verifySmtp(s: SettingsLike): Promise<SmtpVerifyResult> {
  const { cfg, missing } = resolveSmtpConfigWithDiagnostics(s);
  if (!cfg) {
    const labels = missing.join(", ");
    return {
      ok: false,
      configured: false,
      missing,
      error: {
        category: "unknown",
        code: null,
        statusCode: null,
        message: `Missing required SMTP field${missing.length === 1 ? "" : "s"}: ${labels}.`,
        hint: "Fill in host, port, username and password, save, then click Verify connection again.",
      },
    };
  }
  // Pre-flight: prove the TCP socket can actually open. If this fails
  // we report a real network category and skip the (much longer)
  // nodemailer handshake — saves the operator 15s and avoids the
  // misleading "ETIMEDOUT during AUTH" hint.
  const probeError = await probeSmtpReachable(cfg.host, cfg.port);
  if (probeError) {
    return {
      ok: false,
      configured: true,
      missing: [],
      error: categorizeSmtpError(probeError),
    };
  }

  const transport = buildTransport(cfg);
  try {
    await transport.verify();
    return { ok: true, configured: true, missing: [], error: null };
  } catch (err) {
    const categorized = categorizeSmtpError(err);
    // Network was demonstrably reachable (probe succeeded), so any
    // socket-level timeout / reset / generic socket error from
    // nodemailer means the server accepted the connection and then
    // silently hung up — overwhelmingly that's bad credentials on
    // providers like Titan and Zoho. Re-categorize as `auth` so the UI
    // points the operator at the password instead of their firewall.
    if (
      categorized.category === "timeout" ||
      categorized.category === "connection"
    ) {
      return {
        ok: false,
        configured: true,
        missing: [],
        error: {
          category: "auth",
          code: categorized.code,
          statusCode: categorized.statusCode,
          message: `TCP to ${cfg.host}:${cfg.port} succeeded, but the SMTP session was dropped before completion (${categorized.message}).`,
          hint: "The network reached your SMTP server, but the server cut the connection mid-conversation. On Titan and Zoho this almost always means the username or password is wrong (they drop the socket instead of returning a 535 error). Double-check that the username is the full email address, that you used an app-specific password if 2FA is on, and that the mailbox finished provisioning in the provider's webmail.",
        },
      };
    }
    return {
      ok: false,
      configured: true,
      missing: [],
      error: categorized,
    };
  } finally {
    transport.close();
  }
}

/**
 * Build the {from, replyTo} sender header pair using the same priority
 * order order emails use:
 *   1. Site-settings emailFromAddress + emailFromName (preferred)
 *   2. ORDER_EMAIL_FROM env var (back-compat; may already be formatted)
 *   3. Sandbox `orders@resend.dev` fallback so dev still works
 * Exposed so the test-send endpoint stays in lock-step with real sends.
 */
export function resolveOrderSender(settings: SettingsLike): SenderResolution {
  const storeName = settings.storeName ?? "Store";
  const currencySymbol = settings.currencySymbol ?? "$";
  const settingsFromAddress = settings.emailFromAddress?.trim() || "";
  const settingsFromName = settings.emailFromName?.trim() || "";
  const envFrom = process.env["ORDER_EMAIL_FROM"]?.trim() || "";

  let from: string;
  let configured: boolean;
  if (settingsFromAddress) {
    const name = settingsFromName || storeName;
    from = name ? `${name} <${settingsFromAddress}>` : settingsFromAddress;
    configured = true;
  } else if (envFrom) {
    from = /[<>]/.test(envFrom) ? envFrom : `${storeName} <${envFrom}>`;
    configured = true;
  } else {
    from = `${storeName} <orders@resend.dev>`;
    configured = false;
  }
  const replyTo =
    settings.emailReplyTo && settings.emailReplyTo.trim()
      ? settings.emailReplyTo.trim()
      : null;
  return { from, replyTo, storeName, currencySymbol, configured };
}

/** Outcome of one Resend POST attempt. `transient` distinguishes 5xx /
 *  network blips (worth retrying once) from 4xx-style permanent failures
 *  (bad domain, invalid email — retrying won't help). */
interface SendAttempt {
  ok: boolean;
  statusCode?: number;
  errorMessage?: string;
  transient: boolean;
}

async function postToResend(
  apiKey: string,
  payload: Record<string, unknown>,
): Promise<SendAttempt> {
  try {
    const response = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    });
    if (response.ok) return { ok: true, statusCode: response.status, transient: false };
    const body = await response.text();
    let errorMessage = body;
    try {
      const parsed = JSON.parse(body) as { message?: string; error?: string };
      errorMessage = parsed.message ?? parsed.error ?? body;
    } catch {
      /* not JSON; keep raw text */
    }
    return {
      ok: false,
      statusCode: response.status,
      errorMessage: errorMessage || `Resend returned HTTP ${response.status}`,
      transient: response.status >= 500,
    };
  } catch (err) {
    return {
      ok: false,
      errorMessage: err instanceof Error ? err.message : "Unknown network error",
      transient: true,
    };
  }
}

async function sendOrderEmail(
  order: Order,
  kind: OrderEmailKind,
  log: Logger,
): Promise<void> {
  const settings = await getSiteSettings();
  const smtp = resolveSmtpConfig(settings);
  const apiKey = process.env["RESEND_API_KEY"];

  // Choose transport: prefer SMTP when fully configured (Titan, Zoho,
  // Workspace, etc), else Resend HTTP API, else skip with a clear log
  // entry the operator can find in the Emails tab.
  if (!smtp && !apiKey) {
    log.warn(
      { orderId: order.id, kind },
      "No email transport configured (SMTP or RESEND_API_KEY); skipping order email",
    );
    await recordOrderEmailEvent({
      orderId: order.id,
      kind,
      status: "skipped",
      toAddress: order.email,
      fromAddress: null,
      errorMessage:
        "Email is not configured. Add SMTP credentials in Settings → Email, or set RESEND_API_KEY.",
      log,
    });
    return;
  }

  const { from, replyTo, storeName, currencySymbol } = resolveOrderSender(settings);

  const { subject, html, text } = renderOrderEmail(
    order,
    kind,
    storeName,
    currencySymbol,
  );

  // First attempt + one retry on transient failures (5xx / network).
  // 500ms backoff is enough to clear a momentary provider blip without
  // making the admin UI feel sluggish if the second call also fails.
  const trySend = async (): Promise<SendAttempt> => {
    if (smtp) {
      return sendViaSmtp({
        cfg: smtp,
        from,
        to: order.email,
        subject,
        html,
        text,
        replyTo,
      });
    }
    const payload: Record<string, unknown> = {
      from,
      to: order.email,
      subject,
      html,
      text,
    };
    if (replyTo) payload["reply_to"] = replyTo;
    return postToResend(apiKey!, payload);
  };

  let attempt = await trySend();
  if (!attempt.ok && attempt.transient) {
    log.warn(
      { orderId: order.id, kind, statusCode: attempt.statusCode },
      "Order email transient failure — retrying once",
    );
    await new Promise((resolve) => setTimeout(resolve, 500));
    attempt = await trySend();
  }

  if (!attempt.ok) {
    log.error(
      {
        orderId: order.id,
        kind,
        statusCode: attempt.statusCode,
        error: attempt.errorMessage,
        transport: smtp ? "smtp" : "resend",
      },
      "Email transport rejected order email",
    );
    await recordOrderEmailEvent({
      orderId: order.id,
      kind,
      status: "failed",
      toAddress: order.email,
      fromAddress: from,
      errorMessage: attempt.errorMessage ?? "Unknown send failure",
      statusCode: attempt.statusCode ?? null,
      log,
    });
    return;
  }

  log.info(
    { orderId: order.id, kind, to: order.email, transport: smtp ? "smtp" : "resend" },
    "Sent order email",
  );
  await recordOrderEmailEvent({
    orderId: order.id,
    kind,
    status: "sent",
    toAddress: order.email,
    fromAddress: from,
    log,
  });
}

export async function sendOrderStatusEmail(
  order: Order,
  status: "shipped" | "delivered",
  log: Logger,
): Promise<void> {
  return sendOrderEmail(order, status, log);
}

export async function sendOrderConfirmationEmail(
  order: Order,
  log: Logger,
): Promise<void> {
  return sendOrderEmail(order, "confirmation", log);
}

/** Sent synchronously on checkout submission so the customer sees a
 *  receipt immediately, before any admin action. */
export async function sendOrderReceivedEmail(
  order: Order,
  log: Logger,
): Promise<void> {
  return sendOrderEmail(order, "received", log);
}

/** Generic dispatcher used by the admin "Resend" buttons so the UI can
 *  re-fire any of the four templates on demand. */
export async function sendOrderEmailByKind(
  order: Order,
  kind: OrderEmailKind,
  log: Logger,
): Promise<void> {
  return sendOrderEmail(order, kind, log);
}

export interface TestEmailResult {
  ok: boolean;
  /** Provider error body or short failure reason when ok=false. */
  error?: string;
  /** Echoed sender header so the UI can show what was actually used. */
  from?: string;
  /** True when the resend.dev sandbox fallback was used because no
   *  custom from-address has been configured yet. */
  usingSandbox?: boolean;
}

/**
 * Send a small "test message" email to `to` using exactly the same from
 * / reply-to header pair the order emails use. Returns a structured
 * result so the Settings UI can surface success or the provider's
 * error message inline rather than failing silently.
 */
export async function sendTestOrderEmail(
  to: string,
  log: Logger,
): Promise<TestEmailResult> {
  const settings = await getSiteSettings();
  const smtp = resolveSmtpConfig(settings);
  const apiKey = process.env["RESEND_API_KEY"];
  if (!smtp && !apiKey) {
    return {
      ok: false,
      error:
        "Email is not configured. Add SMTP credentials in Settings → Email, or set RESEND_API_KEY on the server.",
    };
  }
  const { from, replyTo, storeName, configured } = resolveOrderSender(settings);
  const subject = `Test email from ${storeName}`;
  const safeStore = escapeHtml(storeName);
  const safeFrom = escapeHtml(from);
  const safeTo = escapeHtml(to);
  const html = `<!doctype html>
<html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#fafafa;padding:24px;color:#111;">
  <div style="max-width:520px;margin:0 auto;background:#fff;padding:32px;border-radius:8px;">
    <h1 style="font-size:20px;margin:0 0 12px 0;">Test email from ${safeStore}</h1>
    <p style="margin:0 0 16px 0;color:#444;">
      This is a test message sent from your storefront's Settings page to
      confirm that order emails are configured correctly.
    </p>
    <p style="margin:0 0 8px 0;color:#666;font-size:13px;"><strong>From:</strong> ${safeFrom}</p>
    <p style="margin:0 0 24px 0;color:#666;font-size:13px;"><strong>Sent to:</strong> ${safeTo}</p>
    <p style="margin:0;color:#888;font-size:12px;">If you received this, your customers will receive their order confirmations from the same address.</p>
  </div>
</body></html>`;
  const text = [
    `Test email from ${storeName}`,
    "",
    "This is a test message sent from your storefront's Settings page to",
    "confirm that order emails are configured correctly.",
    "",
    `From: ${from}`,
    `Sent to: ${to}`,
  ].join("\n");

  try {
    if (smtp) {
      const attempt = await sendViaSmtp({
        cfg: smtp,
        from,
        to,
        subject,
        html,
        text,
        replyTo,
      });
      if (!attempt.ok) {
        log.warn(
          { to, transport: "smtp", error: attempt.errorMessage },
          "SMTP rejected test email",
        );
        return {
          ok: false,
          error: attempt.errorMessage ?? "SMTP send failed",
          from,
          usingSandbox: false,
        };
      }
      log.info({ to, from, transport: "smtp" }, "Sent test email via SMTP");
      return { ok: true, from, usingSandbox: false };
    }

    const payload: Record<string, unknown> = {
      from,
      to,
      subject,
      html,
      text,
    };
    if (replyTo) payload["reply_to"] = replyTo;
    const response = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey!}`,
      },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const body = await response.text();
      let errorMessage = body;
      try {
        const parsed = JSON.parse(body) as { message?: string; error?: string };
        errorMessage = parsed.message ?? parsed.error ?? body;
      } catch {
        /* not JSON; show raw text */
      }
      log.warn(
        { to, statusCode: response.status, body },
        "Resend API rejected test email",
      );
      return {
        ok: false,
        error: errorMessage || `Resend returned ${response.status}`,
        from,
        usingSandbox: !configured,
      };
    }
    log.info({ to, from, transport: "resend" }, "Sent test email via Resend");
    return { ok: true, from, usingSandbox: !configured };
  } catch (err) {
    log.error({ err, to }, "Failed to send test email");
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Unknown network error",
      from,
      usingSandbox: !configured,
    };
  }
}

/* ---------------- Operator payment alerts ----------------
 * High-severity Paystack failures should reach operators even when
 * nobody is watching the admin dashboard. Two delivery modes:
 *   - "instant"  → email per event as it arrives
 *   - "hourly"   → buffer in-memory, flush at most once per hour
 * Mode "off" disables alerts. Recipients is a comma-separated list
 * stored in site_settings.
 *
 * High severity is the subset called out in the task brief plus the
 * adjacent currency_mismatch (same family as amount_mismatch).
 */

const HIGH_SEVERITY_PAYMENT_CODES: ReadonlySet<string> = new Set([
  "amount_mismatch",
  "currency_mismatch",
  "verification_failed",
  "order_not_found",
]);

export function isHighSeverityPaymentEvent(event: {
  kind: string;
  code: string;
}): boolean {
  return event.kind === "failed" && HIGH_SEVERITY_PAYMENT_CODES.has(event.code);
}

export type PaymentAlertMode = "off" | "instant" | "hourly";

const VALID_ALERT_MODES: ReadonlySet<PaymentAlertMode> = new Set([
  "off",
  "instant",
  "hourly",
]);

export function parseAlertMode(raw: unknown): PaymentAlertMode | null {
  if (typeof raw !== "string") return null;
  return VALID_ALERT_MODES.has(raw as PaymentAlertMode)
    ? (raw as PaymentAlertMode)
    : null;
}

export function parseAlertRecipients(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(/[,;\n]/)) {
    const trimmed = part.trim().toLowerCase();
    if (!trimmed) continue;
    if (!EMAIL_RE_ALERT.test(trimmed)) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

const EMAIL_RE_ALERT = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const HOURLY_DIGEST_INTERVAL_MS = 60 * 60 * 1000;
// Poll every 5 minutes; we still only emit when the last digest was
// more than an hour ago. 5min keeps wakeups cheap while bounding the
// max latency between an event and its digest at ~hour + 5min.
const DIGEST_POLL_MS = 5 * 60 * 1000;

interface AlertBufferEntry {
  event: PaymentEvent;
  receivedAt: number;
}

const pendingDigest: AlertBufferEntry[] = [];
let lastDigestSentAt = 0;
let digestTimer: NodeJS.Timeout | null = null;

function ensureDigestTimer(): void {
  if (digestTimer) return;
  digestTimer = setInterval(() => {
    void flushDigestIfDue();
  }, DIGEST_POLL_MS);
  // Don't keep the process alive solely for the digest timer.
  digestTimer.unref?.();
}

async function flushDigestIfDue(): Promise<void> {
  if (pendingDigest.length === 0) return;
  let settings: SiteSettings;
  try {
    settings = await getSiteSettings();
  } catch (err) {
    baseLogger.error(
      { err },
      "Failed to load site settings for payment alert digest",
    );
    return;
  }
  // Mode might have been changed since events were buffered. If so,
  // drop the buffer rather than sending under outdated routing.
  if (settings.paymentAlertMode !== "hourly") {
    pendingDigest.length = 0;
    return;
  }
  const now = Date.now();
  if (lastDigestSentAt !== 0 && now - lastDigestSentAt < HOURLY_DIGEST_INTERVAL_MS) {
    return;
  }
  const recipients = parseAlertRecipients(settings.paymentAlertRecipients);
  if (recipients.length === 0) {
    pendingDigest.length = 0;
    return;
  }
  const batch = pendingDigest.splice(0, pendingDigest.length);
  const sent = await sendPaymentAlertEmail(
    recipients,
    batch.map((e) => e.event),
    settings,
    baseLogger,
  );
  if (sent) {
    // Only advance the once-per-hour clock when the provider accepted
    // the email; on failure the batch is re-buffered so the next poll
    // can retry instead of silently dropping events.
    lastDigestSentAt = now;
  } else {
    pendingDigest.unshift(...batch);
  }
}

/** Public: route a payment_event to the operator alert pipeline. Never
 *  throws — alerting is best-effort and must not impact the webhook
 *  response that triggered it. */
export async function dispatchPaymentAlert(
  event: PaymentEvent,
  log?: Logger,
): Promise<void> {
  const useLog = log ?? baseLogger;
  try {
    if (!isHighSeverityPaymentEvent(event)) return;
    const settings = await getSiteSettings();
    const mode = (settings.paymentAlertMode ?? "off") as PaymentAlertMode;
    if (mode === "off") return;
    const recipients = parseAlertRecipients(settings.paymentAlertRecipients);
    if (recipients.length === 0) {
      useLog.warn(
        { eventId: event.id, mode },
        "Payment alert mode is on but no valid recipients configured — alert dropped",
      );
      return;
    }
    if (mode === "instant") {
      await sendPaymentAlertEmail(recipients, [event], settings, useLog);
      return;
    }
    // hourly: buffer + arm timer + try a flush in case the previous
    // digest was already > 1h ago.
    pendingDigest.push({ event, receivedAt: Date.now() });
    ensureDigestTimer();
    await flushDigestIfDue();
  } catch (err) {
    useLog.error(
      { err, eventId: event.id },
      "dispatchPaymentAlert threw — alert not sent",
    );
  }
}

function formatAlertMoney(
  cents: number | null,
  currency: string | null,
  fallbackSymbol: string,
): string {
  if (cents === null || cents === undefined) return "—";
  const amount = (cents / 100).toFixed(2);
  return currency ? `${amount} ${currency}` : `${fallbackSymbol}${amount}`;
}

function renderPaymentAlertEmail(
  events: PaymentEvent[],
  storeName: string,
  currencySymbol: string,
  isDigest: boolean,
): RenderedEmail {
  const count = events.length;
  const subject = isDigest
    ? `[${storeName}] Payment alerts — ${count} failure${count === 1 ? "" : "s"} in the last hour`
    : `[${storeName}] Payment alert — ${events[0]?.code ?? "failed"}`;

  const heading = isDigest
    ? `${count} payment failure${count === 1 ? "" : "s"} need attention`
    : "A Paystack payment failed";
  const intro = isDigest
    ? `The following high-severity Paystack failures were captured in the last hour. Open the Payments tab in the admin to investigate.`
    : `A high-severity Paystack failure just fired on ${storeName}. Open the Payments tab in the admin to investigate.`;

  const rowsHtml = events
    .map((ev) => {
      const when = new Date(ev.createdAt).toISOString().replace("T", " ").slice(0, 19);
      return `<tr>
        <td style="padding:8px 0;border-bottom:1px solid #eee;vertical-align:top;font-family:ui-monospace,Menlo,monospace;font-size:12px;color:#666;white-space:nowrap;">${escapeHtml(when)}</td>
        <td style="padding:8px 8px;border-bottom:1px solid #eee;vertical-align:top;">
          <div style="font-weight:600;">${escapeHtml(ev.code)}</div>
          ${ev.message ? `<div style="color:#444;font-size:13px;">${escapeHtml(ev.message)}</div>` : ""}
          <div style="color:#888;font-size:12px;margin-top:4px;">
            ${escapeHtml(ev.source)} · ref ${escapeHtml(ev.reference ?? "—")}${ev.orderId ? ` · order ${escapeHtml(ev.orderId)}` : ""}
          </div>
        </td>
        <td style="padding:8px 0;border-bottom:1px solid #eee;text-align:right;vertical-align:top;white-space:nowrap;">
          ${escapeHtml(formatAlertMoney(ev.amountCents, ev.currency, currencySymbol))}
        </td>
      </tr>`;
    })
    .join("");

  const html = `<!doctype html>
<html><head><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#fafafa;padding:24px;color:#111;color-scheme:light;">
  <div style="max-width:640px;margin:0 auto;background:#ffffff;padding:32px;border-radius:8px;color:#111;">
    <div style="display:inline-block;background:#fee2e2;color:#991b1b;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:1px;padding:4px 8px;border-radius:4px;margin-bottom:12px;">Payment alert</div>
    <h1 style="font-size:20px;margin:0 0 8px 0;">${escapeHtml(heading)}</h1>
    <p style="margin:0 0 20px 0;color:#444;">${escapeHtml(intro)}</p>
    <table style="width:100%;border-collapse:collapse;font-size:14px;">
      <thead>
        <tr>
          <th style="text-align:left;padding:6px 0;border-bottom:2px solid #eee;color:#666;font-size:11px;text-transform:uppercase;letter-spacing:1px;">When (UTC)</th>
          <th style="text-align:left;padding:6px 8px;border-bottom:2px solid #eee;color:#666;font-size:11px;text-transform:uppercase;letter-spacing:1px;">Event</th>
          <th style="text-align:right;padding:6px 0;border-bottom:2px solid #eee;color:#666;font-size:11px;text-transform:uppercase;letter-spacing:1px;">Amount</th>
        </tr>
      </thead>
      <tbody>${rowsHtml}</tbody>
    </table>
    <p style="margin:24px 0 0 0;color:#888;font-size:12px;">${escapeHtml(storeName)} operator alert · sent because your account is on the recipients list in Settings → Operator alerts.</p>
  </div>
</body></html>`;

  const textLines: string[] = [
    heading,
    "",
    intro,
    "",
  ];
  for (const ev of events) {
    const when = new Date(ev.createdAt).toISOString().replace("T", " ").slice(0, 19);
    textLines.push(
      `[${when}] ${ev.code} (${ev.source})`,
      `  amount: ${formatAlertMoney(ev.amountCents, ev.currency, currencySymbol)}`,
      `  ref: ${ev.reference ?? "—"}${ev.orderId ? `  order: ${ev.orderId}` : ""}`,
    );
    if (ev.message) textLines.push(`  ${ev.message}`);
    textLines.push("");
  }
  textLines.push(`${storeName} operator alert.`);
  return { subject, html, text: textLines.join("\n") };
}

async function sendPaymentAlertEmail(
  recipients: string[],
  events: PaymentEvent[],
  settings: SiteSettings,
  log: Logger,
): Promise<boolean> {
  if (events.length === 0 || recipients.length === 0) return false;
  const apiKey = process.env["RESEND_API_KEY"];
  if (!apiKey) {
    log.warn(
      { recipients: recipients.length, events: events.length },
      "Cannot send payment alert email — RESEND_API_KEY not configured",
    );
    return false;
  }
  const { from, replyTo, storeName, currencySymbol } = resolveOrderSender(settings);
  const { subject, html, text } = renderPaymentAlertEmail(
    events,
    storeName,
    currencySymbol,
    events.length > 1,
  );
  const payload: Record<string, unknown> = {
    from,
    to: recipients,
    subject,
    html,
    text,
  };
  if (replyTo) payload["reply_to"] = replyTo;

  let attempt = await postToResend(apiKey, payload);
  if (!attempt.ok && attempt.transient) {
    await new Promise((r) => setTimeout(r, 500));
    attempt = await postToResend(apiKey, payload);
  }
  if (!attempt.ok) {
    log.error(
      {
        recipients,
        events: events.length,
        statusCode: attempt.statusCode,
        error: attempt.errorMessage,
      },
      "Resend API rejected payment alert email",
    );
    return false;
  }
  log.info(
    { recipients, events: events.length, digest: events.length > 1 },
    "Sent payment alert email",
  );
  return true;
}

/** Test-only / future: peek at pending digest size. Used in places where
 *  we want to surface "alerts are queued" status. */
export function getPendingPaymentAlertCount(): number {
  return pendingDigest.length;
}
