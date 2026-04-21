import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq, isNull } from "drizzle-orm";
import { db, ordersTable } from "@workspace/db";
import { getSiteSettings } from "../lib/siteSettings";
import {
  getActivePaystackKeys,
  verifyWebhookSignature,
  verifyTransaction,
} from "../lib/paystack";
import { sendOrderConfirmationEmail } from "../lib/email";

const router: IRouter = Router();

interface PaystackWebhookEvent {
  event?: string;
  data?: {
    reference?: string;
    status?: string;
    amount?: number;
    currency?: string;
    paid_at?: string | null;
  };
}

/**
 * Mark an order as paid (idempotent). Returns the updated order or null
 * if the order does not exist / was already in a terminal state.
 */
async function markOrderPaid(args: {
  reference: string;
  amount: number | undefined;
  currency: string | undefined;
  paidAt: string | null | undefined;
}): Promise<{
  updated: boolean;
  alreadyPaid: boolean;
  mismatch: null | { field: "amount" | "currency"; expected: unknown; got: unknown };
  order: typeof ordersTable.$inferSelect | null;
}> {
  // First load the order so we can verify the verified amount/currency
  // from Paystack actually match what we asked them to charge. A
  // mismatch means either tampering, a partial capture, or a bug in
  // pricing — either way we must NOT transition to paid.
  const [existing] = await db
    .select()
    .from(ordersTable)
    .where(eq(ordersTable.id, args.reference));
  if (!existing) {
    return { updated: false, alreadyPaid: false, mismatch: null, order: null };
  }
  if (existing.paidAt) {
    return {
      updated: false,
      alreadyPaid: true,
      mismatch: null,
      order: existing,
    };
  }
  if (
    typeof args.amount !== "number" ||
    args.amount !== existing.totalCents
  ) {
    return {
      updated: false,
      alreadyPaid: false,
      mismatch: {
        field: "amount",
        expected: existing.totalCents,
        got: args.amount,
      },
      order: existing,
    };
  }
  if (
    typeof args.currency !== "string" ||
    args.currency.toUpperCase() !== String(existing.currency).toUpperCase()
  ) {
    return {
      updated: false,
      alreadyPaid: false,
      mismatch: {
        field: "currency",
        expected: existing.currency,
        got: args.currency,
      },
      order: existing,
    };
  }
  // Atomic conditional update: only the first caller whose row still has
  // paid_at IS NULL gets a returning row. The webhook-vs-callback race
  // can't both fire side effects (e.g. duplicate confirmation emails).
  const paidAt = args.paidAt ? new Date(args.paidAt) : new Date();
  const updatedRows = await db
    .update(ordersTable)
    .set({
      status: "paid",
      paymentProvider: "paystack",
      paymentReference: args.reference,
      paidAt,
    })
    .where(
      and(eq(ordersTable.id, args.reference), isNull(ordersTable.paidAt)),
    )
    .returning();
  if (updatedRows.length > 0) {
    return {
      updated: true,
      alreadyPaid: false,
      mismatch: null,
      order: updatedRows[0]!,
    };
  }
  // Lost the race: someone else (the other handler) just paid the order.
  const [reread] = await db
    .select()
    .from(ordersTable)
    .where(eq(ordersTable.id, args.reference));
  return {
    updated: false,
    alreadyPaid: !!reread?.paidAt,
    mismatch: null,
    order: reread ?? null,
  };
}

/**
 * Paystack webhook. Mounted with raw body parser in app.ts so we can
 * compute the HMAC over the exact bytes Paystack signed.
 */
router.post(
  "/payments/paystack/webhook",
  async (req: Request, res: Response) => {
    const settings = await getSiteSettings();
    const { secretKey } = getActivePaystackKeys(settings);
    if (!secretKey) {
      req.log.warn("Paystack webhook hit but no secret key configured");
      res.status(503).json({ error: "Paystack not configured" });
      return;
    }
    const sig = req.header("x-paystack-signature");
    const raw = (req.body as Buffer | undefined) ?? Buffer.alloc(0);
    if (!verifyWebhookSignature(raw, sig, secretKey)) {
      req.log.warn("Paystack webhook signature mismatch");
      res.status(400).json({ error: "Invalid signature" });
      return;
    }
    let event: PaystackWebhookEvent;
    try {
      event = JSON.parse(raw.toString("utf8")) as PaystackWebhookEvent;
    } catch {
      res.status(400).json({ error: "Invalid JSON" });
      return;
    }
    if (event.event !== "charge.success") {
      // Acknowledge other events so Paystack doesn't retry.
      res.status(200).json({ ok: true, ignored: event.event });
      return;
    }
    const ref = event.data?.reference;
    if (!ref) {
      res.status(400).json({ error: "Missing reference" });
      return;
    }
    const result = await markOrderPaid({
      reference: ref,
      amount: event.data?.amount,
      currency: event.data?.currency,
      paidAt: event.data?.paid_at ?? null,
    });
    if (!result.order) {
      req.log.warn({ ref }, "Paystack webhook for unknown order");
      // Return 200 anyway so Paystack doesn't infinitely retry an order
      // that we may have intentionally pruned.
      res.status(200).json({ ok: true, found: false });
      return;
    }
    if (result.mismatch) {
      // Verified charge does NOT match the stored order — refuse to flip
      // to paid. Ack with 200 (so Paystack stops retrying the same bad
      // payload) but log loudly so an operator can investigate / refund.
      req.log.error(
        { ref, mismatch: result.mismatch },
        "Paystack webhook amount/currency mismatch — order NOT marked paid",
      );
      res.status(200).json({ ok: true, mismatch: result.mismatch.field });
      return;
    }
    if (result.updated) {
      void sendOrderConfirmationEmail(result.order, req.log);
    }
    res.status(200).json({ ok: true, alreadyPaid: result.alreadyPaid });
  },
);

/**
 * Customer-facing return URL Paystack redirects to after payment. We
 * verify server-side rather than trusting the redirect, then bounce the
 * customer to /checkout?paid=1&order=<id>.
 */
router.get(
  "/checkout/paystack/callback",
  async (req: Request, res: Response) => {
    const reference = String(req.query["reference"] ?? req.query["trxref"] ?? "");
    if (!reference) {
      res.redirect("/checkout?paid=0&error=missing_reference");
      return;
    }
    const settings = await getSiteSettings();
    const { secretKey } = getActivePaystackKeys(settings);
    if (!secretKey) {
      res.redirect("/checkout?paid=0&error=not_configured");
      return;
    }
    const verify = await verifyTransaction(secretKey, reference);
    if (!verify.ok || verify.status !== "success") {
      res.redirect(
        `/checkout?paid=0&order=${encodeURIComponent(reference)}&error=${encodeURIComponent(verify.error ?? verify.status ?? "verification_failed")}`,
      );
      return;
    }
    const result = await markOrderPaid({
      reference,
      amount: verify.amount,
      currency: verify.currency,
      paidAt: verify.paidAt ?? null,
    });
    // Paystack accepted the charge but we have no matching local order
    // (e.g. the order was deleted, or the reference was forged). Don't
    // tell the customer the cart was paid — surface the mismatch.
    if (!result.order) {
      req.log.warn({ reference }, "Paystack callback for unknown local order");
      res.redirect(
        `/checkout?paid=0&order=${encodeURIComponent(reference)}&error=order_not_found`,
      );
      return;
    }
    if (result.mismatch) {
      req.log.error(
        { reference, mismatch: result.mismatch },
        "Paystack callback amount/currency mismatch — order NOT marked paid",
      );
      res.redirect(
        `/checkout?paid=0&order=${encodeURIComponent(reference)}&error=amount_mismatch`,
      );
      return;
    }
    if (result.updated) {
      void sendOrderConfirmationEmail(result.order, req.log);
    }
    res.redirect(`/checkout?paid=1&order=${encodeURIComponent(reference)}`);
  },
);

export default router;
