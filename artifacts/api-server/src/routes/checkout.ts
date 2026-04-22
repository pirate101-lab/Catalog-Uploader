import { Router, type IRouter, type Request, type Response } from "express";
import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { db, ordersTable } from "@workspace/db";
import { getMergedProductById } from "../lib/productCatalog";
import { getOverridesMap } from "../lib/overrides";
import { getSiteSettings } from "../lib/siteSettings";
import { sendOrderReceivedEmail } from "../lib/email";
import {
  getActivePaystackKeys,
  getCallbackUrl,
  getPublicOrigin,
  initializeTransaction,
  isPaystackReady,
} from "../lib/paystack";
import {
  CHARGE_CURRENCY,
  DISPLAY_CURRENCY,
  convertCart,
} from "../lib/fx";
import { symbolForCurrency } from "../lib/siteSettings";

const router: IRouter = Router();

const TAX_RATE = 0.08;
const SHIPPING_FLAT_CENTS = 800;

interface CartItemPayload {
  productId: string;
  quantity: number;
  color?: string;
  size?: string;
}

async function priceCart(items: CartItemPayload[]) {
  const overrides = await getOverridesMap();
  const settings = await getSiteSettings();
  let subtotalCents = 0;
  const lineItems: Array<{
    productId: string;
    title: string;
    quantity: number;
    color?: string;
    size?: string;
    unitPriceCents: number;
    image?: string;
  }> = [];

  for (const item of items) {
    if (
      !item.productId ||
      !Number.isInteger(item.quantity) ||
      item.quantity < 1 ||
      item.quantity > 99
    ) {
      throw new Error(`Invalid line item`);
    }
    const product = await getMergedProductById(item.productId);
    if (!product) {
      throw new Error(`Product not found: ${item.productId}`);
    }
    const ov = overrides.get(item.productId);
    // Block both override-tombstoned/hidden JSON products and custom
    // products whose row carries hidden/deleted flags directly.
    if (ov?.hidden || ov?.deletedAt || product.hidden || product.deletedAt) {
      throw new Error(`Product unavailable: ${item.productId}`);
    }
    const unitPrice = ov?.priceOverride
      ? Number(ov.priceOverride)
      : Number(product.price);
    const unitPriceCents = Math.round(unitPrice * 100);
    subtotalCents += unitPriceCents * item.quantity;
    lineItems.push({
      productId: product.id,
      title: product.title,
      quantity: item.quantity,
      ...(item.color !== undefined ? { color: item.color } : {}),
      ...(item.size !== undefined ? { size: item.size } : {}),
      unitPriceCents,
      ...(product.imageUrls[0] ? { image: product.imageUrls[0] } : {}),
    });
  }

  const freeShippingMin = settings.freeShippingThresholdCents ?? 15000;
  const shippingCents =
    subtotalCents === 0 || subtotalCents >= freeShippingMin
      ? 0
      : SHIPPING_FLAT_CENTS;
  const taxCents = Math.round(subtotalCents * TAX_RATE);
  const totalCents = subtotalCents + shippingCents + taxCents;
  return { lineItems, subtotalCents, shippingCents, taxCents, totalCents };
}

/**
 * Server-authoritative pricing preview. The storefront calls this on
 * cart change so the displayed totals (and the Pay-with-Paystack button
 * label) always reflect the same numbers the server will charge — never
 * a client-side estimate of shipping/tax.
 */
router.post("/checkout/quote", async (req: Request, res: Response) => {
  try {
    const body = req.body ?? {};
    const items: CartItemPayload[] = body.items ?? [];
    if (items.length === 0) {
      res.status(400).json({ error: "Cart is empty" });
      return;
    }
    const priced = await priceCart(items);
    const settings = await getSiteSettings();
    const fx = convertCart(priced, settings);
    res.json({
      // Display totals — what the shopper sees on the storefront and
      // in the order summary. Always USD today.
      subtotalCents: fx.displaySubtotalCents,
      shippingCents: fx.displayShippingCents,
      taxCents: fx.displayTaxCents,
      totalCents: fx.displayTotalCents,
      currency: DISPLAY_CURRENCY,
      currencySymbol: symbolForCurrency(DISPLAY_CURRENCY),
      // Payment-side totals — what Paystack will actually be asked to
      // charge after USD→KES conversion. Used by the disclosure banner
      // shown above the Pay button so the customer knows the exact KES
      // amount that will hit their card.
      paymentCurrency: CHARGE_CURRENCY,
      paymentCurrencySymbol: symbolForCurrency(CHARGE_CURRENCY),
      paymentSubtotalCents: fx.chargeSubtotalCents,
      paymentShippingCents: fx.chargeShippingCents,
      paymentTaxCents: fx.chargeTaxCents,
      paymentTotalCents: fx.chargeTotalCents,
      fxRate: fx.fxRate,
      fxRateAsOf: fx.fxRateAsOf?.toISOString() ?? null,
    });
  } catch (err) {
    req.log.warn({ err }, "Checkout quote failed");
    res.status(400).json({ error: (err as Error).message || "Could not price cart" });
  }
});

/**
 * Lightweight FX-quote endpoint. The storefront calls this when the
 * checkout disclosure banner needs the latest USD→KES rate without
 * re-pricing the cart (e.g. on page open before items have loaded).
 * Always returns the active stored rate — never hits an upstream
 * provider, so it is cheap to call repeatedly.
 */
router.get("/checkout/fx-quote", async (_req: Request, res: Response) => {
  const settings = await getSiteSettings();
  const fx = convertCart(
    { subtotalCents: 100, shippingCents: 0, taxCents: 0, totalCents: 100 },
    settings,
  );
  res.json({
    displayCurrency: DISPLAY_CURRENCY,
    displayCurrencySymbol: symbolForCurrency(DISPLAY_CURRENCY),
    paymentCurrency: CHARGE_CURRENCY,
    paymentCurrencySymbol: symbolForCurrency(CHARGE_CURRENCY),
    fxRate: fx.fxRate,
    fxRateAsOf: fx.fxRateAsOf?.toISOString() ?? null,
  });
});

// New endpoint: place an order WITHOUT payment processing. Used by the
// storefront so checkout submissions land in the admin Orders queue even
// though Stripe is not wired up.
router.post("/checkout/submit", async (req: Request, res: Response) => {
  try {
    const body = req.body ?? {};
    const items: CartItemPayload[] = body.items ?? [];
    const customer = body.customer ?? {};
    if (!customer.email) {
      res.status(400).json({ error: "Email is required" });
      return;
    }
    // Normalise so verified-buyer lookups (`routes/storefront.ts → reviews`)
    // and any future per-customer queries match regardless of casing/whitespace.
    const normalisedEmail = String(customer.email).trim().toLowerCase();
    if (items.length === 0) {
      res.status(400).json({ error: "Cart is empty" });
      return;
    }
    const priced = await priceCart(items);

    const customerName = [customer.firstName, customer.lastName]
      .filter(Boolean)
      .join(" ") || null;

    // Bank-transfer / "submit" path: no FX conversion happens because
    // the customer is settling offline in display currency (USD). We
    // still mirror the totals into the display_* columns so the order
    // detail page and email templates can use the same code path as
    // Paystack orders without falling back to legacy lookups.
    const [order] = await db
      .insert(ordersTable)
      .values({
        email: normalisedEmail,
        customerName,
        shippingAddress: {
          firstName: customer.firstName ?? null,
          lastName: customer.lastName ?? null,
          address: customer.address ?? null,
          city: customer.city ?? null,
          state: customer.state ?? null,
          zip: customer.zip ?? null,
          country: customer.country ?? null,
        },
        items: priced.lineItems,
        subtotalCents: priced.subtotalCents,
        shippingCents: priced.shippingCents,
        taxCents: priced.taxCents,
        totalCents: priced.totalCents,
        currency: DISPLAY_CURRENCY,
        displayCurrency: DISPLAY_CURRENCY,
        displaySubtotalCents: priced.subtotalCents,
        displayShippingCents: priced.shippingCents,
        displayTaxCents: priced.taxCents,
        displayTotalCents: priced.totalCents,
        fxRate: null,
        fxRateLockedAt: null,
        status: "new",
      })
      .returning();

    // Fire-and-forget — the customer should always see "order placed"
    // even if the email provider is degraded. Failures are recorded in
    // order_email_events and surface in the admin order detail.
    void sendOrderReceivedEmail(order, req.log);

    res.status(201).json({
      orderId: order.id,
      totalCents: order.totalCents,
      currency: order.currency,
    });
  } catch (err) {
    req.log.error({ err }, "Checkout submit failed");
    res.status(400).json({ error: (err as Error).message });
  }
});

/**
 * Paystack flow:
 *   1. Client POSTs cart + customer here.
 *   2. We price the cart server-side and insert a pending order.
 *   3. We call Paystack /transaction/initialize using the order id as the
 *      reference, so the webhook can look up the order by primary key.
 *   4. We return the authorization URL — the client redirects there.
 */
router.post("/checkout/paystack/init", async (req: Request, res: Response) => {
  try {
    const body = req.body ?? {};
    const items: CartItemPayload[] = body.items ?? [];
    const customer = body.customer ?? {};
    if (!customer.email) {
      res.status(400).json({ error: "Email is required" });
      return;
    }
    if (items.length === 0) {
      res.status(400).json({ error: "Cart is empty" });
      return;
    }
    const settings = await getSiteSettings();
    if (!isPaystackReady(settings)) {
      res.status(503).json({
        error:
          "Paystack is not configured. Ask the store operator to enable it in the admin Payments page.",
      });
      return;
    }
    const { secretKey, mode } = getActivePaystackKeys(settings);
    if (!secretKey) {
      res.status(503).json({ error: "Paystack secret key missing" });
      return;
    }
    const normalisedEmail = String(customer.email).trim().toLowerCase();
    const priced = await priceCart(items);
    const customerName =
      [customer.firstName, customer.lastName].filter(Boolean).join(" ") || null;

    // Hybrid currency: shopper sees USD on the storefront but the
    // Paystack merchant account is locked to KES, so we convert the
    // priced cart and persist BOTH sides — the charge totals (KES) go
    // into the canonical `subtotal_cents/total_cents/currency` columns
    // because that's what reconciles against the webhook payload, and
    // the display totals (USD) get mirrored into the display_* columns
    // so the order/email pages can keep showing what the customer saw.
    const fx = convertCart(priced, settings);
    const lockedAt = new Date();

    const [order] = await db
      .insert(ordersTable)
      .values({
        email: normalisedEmail,
        customerName,
        shippingAddress: {
          firstName: customer.firstName ?? null,
          lastName: customer.lastName ?? null,
          address: customer.address ?? null,
          city: customer.city ?? null,
          state: customer.state ?? null,
          zip: customer.zip ?? null,
          country: customer.country ?? null,
        },
        items: priced.lineItems,
        subtotalCents: fx.chargeSubtotalCents,
        shippingCents: fx.chargeShippingCents,
        taxCents: fx.chargeTaxCents,
        totalCents: fx.chargeTotalCents,
        currency: CHARGE_CURRENCY,
        displayCurrency: DISPLAY_CURRENCY,
        displaySubtotalCents: fx.displaySubtotalCents,
        displayShippingCents: fx.displayShippingCents,
        displayTaxCents: fx.displayTaxCents,
        displayTotalCents: fx.displayTotalCents,
        fxRate: fx.fxRate.toFixed(6),
        fxRateLockedAt: lockedAt,
        status: "pending_payment",
        paymentProvider: "paystack",
      })
      .returning();
    if (!order) {
      res.status(500).json({ error: "Could not create order" });
      return;
    }

    const init = await initializeTransaction(secretKey, {
      email: normalisedEmail,
      // Paystack expects amounts in the smallest currency unit (kobo for
      // NGN, cents for USD/GHS/ZAR/KES). Our `totalCents` is already in
      // the smallest unit of `order.currency` (KES sub-units here), so
      // they line up 1:1 with the currency code below.
      amountKobo: order.totalCents,
      reference: order.id,
      callbackUrl: getCallbackUrl(req),
      currency: order.currency,
      metadata: {
        orderId: order.id,
        mode,
        // Stash the FX context on the Paystack transaction for ops
        // forensics — if a customer ever queries why their card was
        // charged X KES for a $Y order, the receipt has the rate too.
        displayCurrency: DISPLAY_CURRENCY,
        displayTotalCents: fx.displayTotalCents,
        fxRate: fx.fxRate,
      },
    });
    if (!init.ok || !init.authorizationUrl) {
      // Roll back the half-created order so the admin queue stays clean.
      await db.delete(ordersTable).where(eq(ordersTable.id, order.id));
      // Surface a stable error code (e.g. "currency_not_supported") so
      // the storefront can render a tailored, actionable hint instead
      // of Paystack's raw message.
      res.status(502).json({
        error: init.error ?? "Could not start Paystack transaction",
        ...(init.code ? { code: init.code } : {}),
        currency: order.currency,
      });
      return;
    }
    res.status(200).json({
      authorizationUrl: init.authorizationUrl,
      reference: order.id,
      // Echo BOTH sides so the storefront can show "$Y will be charged
      // as KSh X at $1 ≈ KSh Z" before redirecting to Paystack.
      totalCents: order.totalCents,
      currency: order.currency,
      displayTotalCents: fx.displayTotalCents,
      displayCurrency: DISPLAY_CURRENCY,
      fxRate: fx.fxRate,
    });
  } catch (err) {
    req.log.error({ err }, "Paystack init failed");
    res.status(400).json({ error: (err as Error).message });
  }
});

/* ------------------------------------------------------------------ *
 * Resume-payment link (used in customer payment-failed emails)
 * ------------------------------------------------------------------ *
 * The "Complete your payment" button in our payment_failed email
 * points at GET /api/checkout/paystack/resume?order=<id>&token=<sig>.
 * The token is an HMAC of `<orderId>.<expiryMs>` keyed off the active
 * Paystack secret, so:
 *   - the link is non-guessable (you'd need the secret to forge one)
 *   - it expires after 7 days
 *   - rotating the Paystack secret invalidates all in-flight links,
 *     which is the right behaviour for a security rotation
 * The endpoint re-initializes a Paystack transaction against the same
 * order id and 302-redirects the customer to Paystack's hosted
 * authorization URL — so they finish payment in the exact same UI as
 * the original checkout, and the existing webhook/callback flow flips
 * the order to paid with no changes.
 */
const RESUME_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function signResumePayload(orderId: string, expiresAt: number, secret: string): string {
  return crypto
    .createHmac("sha256", secret)
    .update(`${orderId}.${expiresAt}`)
    .digest("base64url");
}

/** Mint a fresh signed token + URL for the given order. */
export function buildResumeUrl(
  origin: string,
  orderId: string,
  secret: string,
): string {
  const exp = Date.now() + RESUME_TOKEN_TTL_MS;
  const sig = signResumePayload(orderId, exp, secret);
  const token = `${exp}.${sig}`;
  return `${origin}/api/checkout/paystack/resume?order=${encodeURIComponent(orderId)}&token=${encodeURIComponent(token)}`;
}

function verifyResumeToken(orderId: string, token: string, secret: string): boolean {
  const dot = token.indexOf(".");
  if (dot <= 0) return false;
  const expStr = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < Date.now()) return false;
  const expected = signResumePayload(orderId, exp, secret);
  if (sig.length !== expected.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  } catch {
    return false;
  }
}

router.get("/checkout/paystack/resume", async (req: Request, res: Response) => {
  const orderId = String(req.query["order"] ?? "");
  const token = String(req.query["token"] ?? "");
  if (!orderId || !token) {
    res.redirect("/checkout?paid=0&error=missing_token");
    return;
  }
  const settings = await getSiteSettings();
  if (!isPaystackReady(settings)) {
    res.redirect("/checkout?paid=0&error=not_configured");
    return;
  }
  const { secretKey, mode } = getActivePaystackKeys(settings);
  if (!secretKey) {
    res.redirect("/checkout?paid=0&error=not_configured");
    return;
  }
  if (!verifyResumeToken(orderId, token, secretKey)) {
    req.log.warn({ orderId }, "Paystack resume link rejected (bad/expired token)");
    res.redirect("/checkout?paid=0&error=expired_link");
    return;
  }
  const [order] = await db
    .select()
    .from(ordersTable)
    .where(eq(ordersTable.id, orderId));
  if (!order) {
    res.redirect("/checkout?paid=0&error=order_not_found");
    return;
  }
  // Already paid — bounce them to the success page instead of opening
  // a fresh Paystack session that would attempt a duplicate charge.
  if (order.paidAt) {
    res.redirect(`/checkout?paid=1&order=${encodeURIComponent(orderId)}`);
    return;
  }
  // Paystack rejects re-using a reference that has already been
  // initialized — even if the original attempt was abandoned without
  // any charge being made. So each resume mints a fresh, unique
  // reference of the form "<orderId>.r<random>". The webhook +
  // callback handlers strip the trailing ".r…" segment via
  // `orderIdFromReference()` to resolve back to the same order row,
  // so a customer can retry as many times as they need from the same
  // signed link without colliding with their own previous attempts.
  const retrySuffix = crypto.randomBytes(6).toString("hex");
  const retryReference = `${order.id}.r${retrySuffix}`;
  const init = await initializeTransaction(secretKey, {
    email: order.email,
    amountKobo: order.totalCents,
    reference: retryReference,
    callbackUrl: getCallbackUrl(req),
    currency: order.currency,
    metadata: {
      orderId: order.id,
      mode,
      resumed: true,
    },
  });
  if (!init.ok || !init.authorizationUrl) {
    req.log.error(
      { orderId, error: init.error },
      "Failed to re-initialize Paystack for resume link",
    );
    res.redirect(
      `/checkout?paid=0&order=${encodeURIComponent(orderId)}&error=${encodeURIComponent(init.error ?? "resume_failed")}`,
    );
    return;
  }
  res.redirect(init.authorizationUrl);
});

export { getPublicOrigin };
export default router;
