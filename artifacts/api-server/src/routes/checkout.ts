import { Router, type IRouter, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import { db, ordersTable } from "@workspace/db";
import { getMergedProductById } from "../lib/productCatalog";
import { getOverridesMap } from "../lib/overrides";
import { getSiteSettings } from "../lib/siteSettings";
import { sendOrderReceivedEmail } from "../lib/email";
import {
  getActivePaystackKeys,
  getCallbackUrl,
  initializeTransaction,
  isPaystackReady,
} from "../lib/paystack";

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
    res.json({
      subtotalCents: priced.subtotalCents,
      shippingCents: priced.shippingCents,
      taxCents: priced.taxCents,
      totalCents: priced.totalCents,
      currency: settings.currencyCode,
      currencySymbol: settings.currencySymbol ?? "$",
    });
  } catch (err) {
    req.log.warn({ err }, "Checkout quote failed");
    res.status(400).json({ error: (err as Error).message || "Could not price cart" });
  }
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
    const submitSettings = await getSiteSettings();

    const customerName = [customer.firstName, customer.lastName]
      .filter(Boolean)
      .join(" ") || null;

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
        currency: submitSettings.currencyCode,
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
        currency: settings.currencyCode,
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
      // the smallest unit of `order.currency`, so they line up 1:1 as
      // long as we send the matching currency code below.
      amountKobo: order.totalCents,
      reference: order.id,
      callbackUrl: getCallbackUrl(req),
      currency: order.currency,
      metadata: {
        orderId: order.id,
        mode,
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
      totalCents: order.totalCents,
      currency: order.currency,
    });
  } catch (err) {
    req.log.error({ err }, "Paystack init failed");
    res.status(400).json({ error: (err as Error).message });
  }
});

export default router;
