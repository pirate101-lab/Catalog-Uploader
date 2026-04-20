import type { Logger } from "pino";
import { getSiteSettings } from "./siteSettings";
import type { Order } from "@workspace/db";

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

export type OrderEmailKind = "confirmation" | "shipped" | "delivered";

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

  let heading: string;
  let intro: string;
  let subject: string;
  if (kind === "shipped") {
    heading = "Your order is on its way";
    intro = `Good news — your order #${orderRef} from ${storeName} just shipped.`;
    subject = `Order #${orderRef} has shipped`;
  } else if (kind === "delivered") {
    heading = "Your order has been delivered";
    intro = `Your order #${orderRef} from ${storeName} has been delivered. We hope you love it.`;
    subject = `Order #${orderRef} has been delivered`;
  } else {
    heading = "Thanks for your order";
    intro = `We've received your order #${orderRef} from ${storeName}. Here's your receipt.`;
    subject = `Order #${orderRef} confirmed`;
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

  const showBreakdown = kind === "confirmation";
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
    kind === "confirmation"
      ? formatAddressLines(order.shippingAddress as ShippingAddress | null)
      : [];
  const addressHtml =
    addressLines.length > 0
      ? `<h2 style="font-size:14px;text-transform:uppercase;letter-spacing:1px;color:#666;margin:24px 0 8px 0;">Shipping to</h2>
         <div style="font-size:14px;color:#444;line-height:1.5;">
           ${addressLines.map((l) => escapeHtml(l)).join("<br>")}
         </div>`
      : "";

  const html = `<!doctype html>
<html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#fafafa;padding:24px;color:#111;">
  <div style="max-width:560px;margin:0 auto;background:#fff;padding:32px;border-radius:8px;">
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
    <p style="margin:32px 0 0 0;color:#888;font-size:12px;">${escapeHtml(storeName)}</p>
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
  textLines.push("", storeName);

  return { subject, html, text: textLines.join("\n") };
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

async function sendOrderEmail(
  order: Order,
  kind: OrderEmailKind,
  log: Logger,
): Promise<void> {
  const apiKey = process.env["RESEND_API_KEY"];
  if (!apiKey) {
    log.warn(
      { orderId: order.id, kind },
      "RESEND_API_KEY not configured; skipping order email",
    );
    return;
  }

  const settings = await getSiteSettings();
  const { from, replyTo, storeName, currencySymbol } = resolveOrderSender(settings);

  const { subject, html, text } = renderOrderEmail(
    order,
    kind,
    storeName,
    currencySymbol,
  );

  try {
    const payload: Record<string, unknown> = {
      from,
      to: order.email,
      subject,
      html,
      text,
    };
    if (replyTo) payload["reply_to"] = replyTo;
    const response = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const body = await response.text();
      log.error(
        { orderId: order.id, kind, statusCode: response.status, body },
        "Resend API rejected order email",
      );
      return;
    }
    log.info(
      { orderId: order.id, kind, to: order.email },
      "Sent order email",
    );
  } catch (err) {
    log.error(
      { err, orderId: order.id, kind },
      "Failed to send order email",
    );
  }
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
  const apiKey = process.env["RESEND_API_KEY"];
  if (!apiKey) {
    return {
      ok: false,
      error:
        "Email is not configured on this server (missing RESEND_API_KEY). Set the API key to enable order emails.",
    };
  }
  const settings = await getSiteSettings();
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
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const body = await response.text();
      // Try to surface Resend's "message" field for nicer UI; fall back to body.
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
    log.info({ to, from }, "Sent test email");
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
