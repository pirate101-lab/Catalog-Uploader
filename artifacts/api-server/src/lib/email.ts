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

const RESEND_ENDPOINT = "https://api.resend.com/emails";

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

interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

function renderStatusEmail(
  order: Order,
  status: "shipped" | "delivered",
  storeName: string,
  currencySymbol: string,
): RenderedEmail {
  const items = (order.items as OrderItem[]) ?? [];
  const orderRef = shortOrderId(order.id);
  const heading =
    status === "shipped"
      ? "Your order is on its way"
      : "Your order has been delivered";
  const intro =
    status === "shipped"
      ? `Good news — your order #${orderRef} from ${storeName} just shipped.`
      : `Your order #${orderRef} from ${storeName} has been delivered. We hope you love it.`;

  const subject =
    status === "shipped"
      ? `Order #${orderRef} has shipped`
      : `Order #${orderRef} has been delivered`;

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

  const total = formatMoney(order.totalCents, currencySymbol);

  const html = `<!doctype html>
<html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#fafafa;padding:24px;color:#111;">
  <div style="max-width:560px;margin:0 auto;background:#fff;padding:32px;border-radius:8px;">
    <h1 style="font-size:22px;margin:0 0 8px 0;">${escapeHtml(heading)}</h1>
    <p style="margin:0 0 24px 0;color:#444;">${escapeHtml(intro)}</p>
    <h2 style="font-size:14px;text-transform:uppercase;letter-spacing:1px;color:#666;margin:0 0 8px 0;">Order #${orderRef}</h2>
    <table style="width:100%;border-collapse:collapse;font-size:14px;">
      ${itemsHtml}
      <tr>
        <td style="padding:12px 0 0 0;font-weight:600;">Total</td>
        <td style="padding:12px 0 0 0;text-align:right;font-weight:600;">${total}</td>
      </tr>
    </table>
    <p style="margin:32px 0 0 0;color:#888;font-size:12px;">${escapeHtml(storeName)}</p>
  </div>
</body></html>`;

  const textLines = [
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
    `Total: ${total}`,
    "",
    storeName,
  ];

  return { subject, html, text: textLines.join("\n") };
}

export async function sendOrderStatusEmail(
  order: Order,
  status: "shipped" | "delivered",
  log: Logger,
): Promise<void> {
  const apiKey = process.env["RESEND_API_KEY"];
  if (!apiKey) {
    log.warn(
      { orderId: order.id, status },
      "RESEND_API_KEY not configured; skipping order status email",
    );
    return;
  }

  const settings = await getSiteSettings();
  const storeName = settings.storeName ?? "Store";
  const currencySymbol = settings.currencySymbol ?? "$";
  const from =
    process.env["ORDER_EMAIL_FROM"] ?? "orders@resend.dev";

  const { subject, html, text } = renderStatusEmail(
    order,
    status,
    storeName,
    currencySymbol,
  );

  try {
    const response = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        from,
        to: order.email,
        subject,
        html,
        text,
      }),
    });
    if (!response.ok) {
      const body = await response.text();
      log.error(
        { orderId: order.id, status, statusCode: response.status, body },
        "Resend API rejected order status email",
      );
      return;
    }
    log.info(
      { orderId: order.id, status, to: order.email },
      "Sent order status email",
    );
  } catch (err) {
    log.error(
      { err, orderId: order.id, status },
      "Failed to send order status email",
    );
  }
}
