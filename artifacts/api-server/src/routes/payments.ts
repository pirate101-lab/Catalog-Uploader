import { Router, type IRouter, type Request, type Response } from "express";
import type { Logger } from "pino";
import { and, eq, isNull } from "drizzle-orm";
import { db, ordersTable, type Order } from "@workspace/db";
import { getSiteSettings } from "../lib/siteSettings";
import {
  getActivePaystackKeys,
  getPublicOrigin,
  verifyWebhookSignature,
  verifyTransaction,
} from "../lib/paystack";
import {
  claimAndSendPaymentFailedEmail,
  sendOrderConfirmationEmail,
  type PaymentFailedVariant,
} from "../lib/email";
import { recordPaymentEvent } from "../lib/paymentEvents";
import { buildResumeUrl } from "../lib/paystackResume";

/**
 * Fire a customer-facing payment_failed reminder. Skipped silently when:
 *   - the order isn't on file (forged reference, deleted order)
 *   - the order has no email (legacy / corrupt row)
 *   - the order is already paid (race we lost — confirmation will fire)
 *   - we already sent one within the last hour (webhook + callback dedupe)
 *   - Paystack isn't configured (no secret to sign the resume link)
 *
 * Always returns void; never throws so the payment-event recording above
 * it remains the source of truth for ops alerts.
 */
async function notifyCustomerOfFailedPayment(
  order: Order | null,
  variant: PaymentFailedVariant,
  req: { log: Logger } & Parameters<typeof getPublicOrigin>[0],
): Promise<void> {
  try {
    if (!order || !order.email || order.paidAt) return;
    const settings = await getSiteSettings();
    const { secretKey } = getActivePaystackKeys(settings);
    if (!secretKey) return;
    // Atomic dedupe lives inside `claimAndSendPaymentFailedEmail`: a
    // transactional advisory lock + recheck + placeholder-row insert
    // closes the TOCTOU window between the webhook + browser callback
    // racing on the same failed charge. The plain "check then send"
    // pattern is not race-safe under concurrent fire.
    const retryUrl = buildResumeUrl(getPublicOrigin(req), order.id, secretKey);
    await claimAndSendPaymentFailedEmail(
      order,
      { variant, retryUrl },
      req.log,
    );
  } catch (err) {
    req.log.error(
      { err, orderId: order?.id, variant },
      "Failed to send customer payment_failed email (non-fatal)",
    );
  }
}

const router: IRouter = Router();

/**
 * Extract the canonical order id from a Paystack `reference`. Plain
 * checkout init uses the order id verbatim — first attempt → ref ===
 * order.id (no dot, helper returns the input unchanged). The resume
 * link path mints a unique reference per attempt as
 * `<orderId>.r<random>` because Paystack rejects re-init with a
 * previously-used reference. The leading segment up to the first dot
 * is always the order id, which lets webhook + callback handlers
 * resolve back to the correct row regardless of how many retry
 * attempts a customer makes.
 */
export function orderIdFromReference(reference: string): string {
  const dot = reference.indexOf(".");
  return dot > 0 ? reference.slice(0, dot) : reference;
}

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
  //
  // Hybrid-currency note: reconciliation is intentionally done in the
  // CHARGE currency (existing.totalCents / existing.currency are KES
  // for Paystack orders post-FX-lock). The display amounts the shopper
  // saw on the storefront live in the `display_*` columns and are NOT
  // checked here — Paystack only ever sees and reports the KES side,
  // so comparing the USD snapshot would always 100% mismatch.
  // Resume-link retries arrive with a suffixed reference like
  // "<orderId>.rABCD" because Paystack rejects re-using the original
  // reference once it's been initialized. Always look up the order by
  // its canonical id, but persist the actual reference Paystack sent
  // below so the audit log shows which attempt completed the charge.
  const orderId = orderIdFromReference(args.reference);
  const [existing] = await db
    .select()
    .from(ordersTable)
    .where(eq(ordersTable.id, orderId));
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
      and(eq(ordersTable.id, orderId), isNull(ordersTable.paidAt)),
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
    .where(eq(ordersTable.id, orderId));
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
      // Acknowledge other events so Paystack doesn't retry. Surface
      // failed/abandoned charge events in the admin audit log so
      // operators can spot declines without grepping the server log.
      const ref = event.data?.reference ?? null;
      if (event.event === "charge.failed") {
        await recordPaymentEvent({
          orderId: ref,
          reference: ref,
          kind: "failed",
          source: "webhook",
          code: "charge_failed",
          message: `Paystack reported charge.failed (${event.data?.status ?? "unknown"})`,
          amountCents: event.data?.amount ?? null,
          currency: event.data?.currency ?? null,
        });
        if (ref) {
          // Look up the order so we can email the customer a retry link.
          // Wrapped in its own try so a missing/forged ref never 500s.
          try {
            const [order] = await db
              .select()
              .from(ordersTable)
              .where(eq(ordersTable.id, orderIdFromReference(ref)));
            await notifyCustomerOfFailedPayment(
              order ?? null,
              "declined",
              req,
            );
          } catch (err) {
            req.log.error({ err, ref }, "Failed to load order for failure email");
          }
        }
      }
      res.status(200).json({ ok: true, ignored: event.event });
      return;
    }
    const ref = event.data?.reference;
    if (!ref) {
      await recordPaymentEvent({
        orderId: null,
        reference: null,
        kind: "failed",
        source: "webhook",
        code: "missing_reference",
        message: "Webhook charge.success had no reference field",
      });
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
      await recordPaymentEvent({
        orderId: null,
        reference: ref,
        kind: "failed",
        source: "webhook",
        code: "order_not_found",
        message: "Webhook charge.success for a reference with no matching order",
        amountCents: event.data?.amount ?? null,
        currency: event.data?.currency ?? null,
      });
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
      await recordPaymentEvent({
        orderId: result.order.id,
        reference: ref,
        kind: "failed",
        source: "webhook",
        code: `${result.mismatch.field}_mismatch`,
        message: `Paystack ${result.mismatch.field} ${String(result.mismatch.got)} != expected ${String(result.mismatch.expected)} — NOT marked paid`,
        amountCents: event.data?.amount ?? null,
        currency: event.data?.currency ?? null,
      });
      await notifyCustomerOfFailedPayment(result.order, "mismatch", req);
      res.status(200).json({ ok: true, mismatch: result.mismatch.field });
      return;
    }
    if (result.updated) {
      await recordPaymentEvent({
        orderId: result.order.id,
        reference: ref,
        kind: "success",
        source: "webhook",
        code: "charge_success",
        message: `Order ${result.order.id} paid (${result.order.email})`,
        amountCents: result.order.totalCents,
        currency: result.order.currency,
      });
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
    // Customer-facing redirects should always show the canonical order
    // id (not a "<orderId>.r<random>" retry suffix that Paystack saw)
    // so support workflows + bookmarks resolve to the same row across
    // multiple retry attempts.
    const canonicalOrderId = reference ? orderIdFromReference(reference) : "";
    if (!reference) {
      await recordPaymentEvent({
        orderId: null,
        reference: null,
        kind: "abandoned",
        source: "callback",
        code: "missing_reference",
        message: "Customer hit Paystack callback URL with no reference (likely abandoned checkout)",
      });
      res.redirect("/checkout?paid=0&error=missing_reference");
      return;
    }
    const settings = await getSiteSettings();
    const { secretKey } = getActivePaystackKeys(settings);
    if (!secretKey) {
      await recordPaymentEvent({
        orderId: reference,
        reference,
        kind: "failed",
        source: "callback",
        code: "not_configured",
        message: "Customer returned from Paystack but no secret key is saved — cannot verify",
      });
      res.redirect("/checkout?paid=0&error=not_configured");
      return;
    }
    const verify = await verifyTransaction(secretKey, reference);
    if (!verify.ok || verify.status !== "success") {
      // `status === "abandoned"` is Paystack's signal that the customer
      // closed the modal without completing payment — bucket those as
      // "abandoned" so operators can distinguish them from real failures.
      const abandoned = verify.status === "abandoned";
      await recordPaymentEvent({
        orderId: reference,
        reference,
        kind: abandoned ? "abandoned" : "failed",
        source: "callback",
        code: abandoned ? "abandoned" : "verification_failed",
        message:
          verify.error ??
          `Paystack verification returned status="${verify.status ?? "unknown"}"`,
        amountCents: verify.amount ?? null,
        currency: verify.currency ?? null,
      });
      // The callback runs in the customer's browser, so we have a real
      // order id to look up and email. Skip silently if the row is gone.
      try {
        const [order] = await db
          .select()
          .from(ordersTable)
          .where(eq(ordersTable.id, orderIdFromReference(reference)));
        await notifyCustomerOfFailedPayment(
          order ?? null,
          abandoned ? "abandoned" : "verification",
          req,
        );
      } catch (err) {
        req.log.error(
          { err, reference },
          "Failed to load order for callback failure email",
        );
      }
      res.redirect(
        `/checkout?paid=0&order=${encodeURIComponent(canonicalOrderId)}&error=${encodeURIComponent(verify.error ?? verify.status ?? "verification_failed")}`,
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
      await recordPaymentEvent({
        orderId: null,
        reference,
        kind: "failed",
        source: "callback",
        code: "order_not_found",
        message: "Customer returned with a Paystack reference that has no matching local order",
        amountCents: verify.amount ?? null,
        currency: verify.currency ?? null,
      });
      res.redirect(
        `/checkout?paid=0&order=${encodeURIComponent(canonicalOrderId)}&error=order_not_found`,
      );
      return;
    }
    if (result.mismatch) {
      req.log.error(
        { reference, mismatch: result.mismatch },
        "Paystack callback amount/currency mismatch — order NOT marked paid",
      );
      await recordPaymentEvent({
        orderId: result.order.id,
        reference,
        kind: "failed",
        source: "callback",
        code: `${result.mismatch.field}_mismatch`,
        message: `Paystack ${result.mismatch.field} ${String(result.mismatch.got)} != expected ${String(result.mismatch.expected)} — NOT marked paid`,
        amountCents: verify.amount ?? null,
        currency: verify.currency ?? null,
      });
      await notifyCustomerOfFailedPayment(result.order, "mismatch", req);
      res.redirect(
        `/checkout?paid=0&order=${encodeURIComponent(canonicalOrderId)}&error=amount_mismatch`,
      );
      return;
    }
    if (result.updated) {
      await recordPaymentEvent({
        orderId: result.order.id,
        reference,
        kind: "success",
        source: "callback",
        code: "charge_success",
        message: `Order ${result.order.id} paid (${result.order.email})`,
        amountCents: result.order.totalCents,
        currency: result.order.currency,
      });
      void sendOrderConfirmationEmail(result.order, req.log);
    }
    res.redirect(`/checkout?paid=1&order=${encodeURIComponent(canonicalOrderId)}`);
  },
);

export default router;
