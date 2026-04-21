import type { Logger } from "pino";
import nodemailer, { type Transporter } from "nodemailer";
import { getSiteSettings } from "./siteSettings";
import { db, orderEmailEventsTable, type Order } from "@workspace/db";

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

function renderOrderEmail(
  order: Order,
  kind: OrderEmailKind,
  storeName: string,
  currencySymbol: string,
): RenderedEmail {
  const items = (order.items as OrderItem[]) ?? [];
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
        currencySymbol,
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

  const subtotal = formatMoney(order.subtotalCents, currencySymbol);
  const shipping = formatMoney(order.shippingCents, currencySymbol);
  const tax = formatMoney(order.taxCents, currencySymbol);
  const total = formatMoney(order.totalCents, currencySymbol);

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
        currencySymbol,
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

/** Returns a fully-configured SMTP config or null if any required
 *  field is missing. Hosts like Titan, Zoho, Google etc. all need at
 *  minimum host + port + auth. */
export function resolveSmtpConfig(s: SettingsLike): SmtpConfig | null {
  const host = (s.smtpHost ?? "").trim();
  const username = (s.smtpUsername ?? "").trim();
  const password = s.smtpPassword ?? "";
  const port = s.smtpPort ?? 0;
  if (!host || !username || !password || !port) return null;
  return {
    host,
    port,
    secure: s.smtpSecure ?? true,
    username,
    password,
  };
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

/** Run a no-op SMTP handshake to check that the saved credentials can
 *  authenticate against the configured host. Used by the admin
 *  "Verify connection" button. */
export async function verifySmtp(s: SettingsLike): Promise<{
  ok: boolean;
  error?: string;
  configured: boolean;
}> {
  const cfg = resolveSmtpConfig(s);
  if (!cfg) {
    return {
      ok: false,
      configured: false,
      error:
        "SMTP is not fully configured. Fill in host, port, username and password before testing.",
    };
  }
  const transport = buildTransport(cfg);
  try {
    await transport.verify();
    return { ok: true, configured: true };
  } catch (err) {
    const e = err as { message?: string; responseCode?: number; code?: string };
    const codeBits = [e.responseCode, e.code].filter(Boolean).join(" / ");
    return {
      ok: false,
      configured: true,
      error: codeBits
        ? `${e.message ?? "SMTP verify failed"} (${codeBits})`
        : (e.message ?? "SMTP verify failed"),
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
