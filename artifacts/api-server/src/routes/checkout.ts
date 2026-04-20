import { Router, type IRouter, type Request, type Response } from "express";
import { db, ordersTable } from "@workspace/db";
import { getProductById } from "../lib/catalog";
import { getOverridesMap } from "../lib/overrides";
import { getSiteSettings } from "../lib/siteSettings";
import { sendOrderConfirmationEmail } from "../lib/email";

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
    const product = getProductById(item.productId);
    if (!product) {
      throw new Error(`Product not found: ${item.productId}`);
    }
    const ov = overrides.get(item.productId);
    if (ov?.hidden) {
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

// Stripe is not configured for this storefront, so /checkout/intent and
// /checkout/confirm are intentionally stubs that return 503. Real cart
// submissions go through /checkout/submit (below), which persists an order
// without taking payment so the admin Orders queue still works.
router.post("/checkout/intent", async (req: Request, res: Response) => {
  try {
    const items: CartItemPayload[] = req.body?.items ?? [];
    if (items.length === 0) {
      res.status(400).json({ error: "Cart is empty" });
      return;
    }
    const { subtotalCents, shippingCents, taxCents, totalCents } =
      await priceCart(items);
    res.status(503).json({
      error: "Payments are not configured for this storefront.",
      paymentsConfigured: false,
      subtotalCents,
      shippingCents,
      taxCents,
      totalCents,
    });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

router.post("/checkout/confirm", (_req: Request, res: Response) => {
  res.status(503).json({
    error: "Payments are not configured for this storefront.",
    paymentsConfigured: false,
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
        currency: "USD",
        status: "new",
      })
      .returning();

    void sendOrderConfirmationEmail(order, req.log);

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

export default router;
