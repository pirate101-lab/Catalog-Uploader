import { EventEmitter } from "node:events";
import { db, paymentEventsTable, type PaymentEvent } from "@workspace/db";
import { logger } from "./logger";
import { dispatchPaymentAlert } from "./email";

/**
 * In-process pub/sub for payment events. The admin SSE endpoint
 * subscribes here so a successful Paystack webhook (or a failed
 * callback) instantly fans out to every connected admin browser.
 *
 * This is intentionally NOT cross-process — Replit only runs one API
 * server instance, so a plain EventEmitter is the right primitive.
 * If the API ever scales horizontally this should move to Postgres
 * LISTEN/NOTIFY (or Redis pub/sub) so all instances receive the fan-out.
 */
export const paymentEventBus: EventEmitter = new EventEmitter();
// Each open SSE connection adds a listener. Default 10 is too low for an
// admin team that might leave several dashboards open.
paymentEventBus.setMaxListeners(100);

export type PaymentEventKind = "success" | "failed" | "abandoned";
export type PaymentEventSource = "webhook" | "callback";

/**
 * Persist a payment event AND fan it out to live admin listeners. Never
 * throws — payment processing is the priority and a failed audit insert
 * must not 500 the webhook (which would cause Paystack to retry).
 */
export async function recordPaymentEvent(input: {
  orderId: string | null;
  reference: string | null;
  kind: PaymentEventKind;
  source: PaymentEventSource;
  code: string;
  message?: string | null;
  amountCents?: number | null;
  currency?: string | null;
}): Promise<PaymentEvent | null> {
  try {
    const [row] = await db
      .insert(paymentEventsTable)
      .values({
        orderId: input.orderId,
        reference: input.reference,
        kind: input.kind,
        source: input.source,
        code: input.code,
        message: input.message ?? null,
        amountCents: input.amountCents ?? null,
        currency: input.currency ?? null,
      })
      .returning();
    if (row) {
      paymentEventBus.emit("event", row);
      // Fire-and-forget operator alert dispatch — high-severity failures
      // notify the operator email list per their configured frequency.
      // Errors are swallowed inside dispatchPaymentAlert so a broken
      // alert pipeline never blocks payment processing.
      void dispatchPaymentAlert(row, logger);
    }
    return row ?? null;
  } catch (err) {
    logger.error(
      { err, input },
      "Failed to persist payment_event — admin audit log will miss this entry",
    );
    return null;
  }
}
