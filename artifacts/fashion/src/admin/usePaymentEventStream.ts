import { useEffect, useRef } from "react";
import type { PaymentEventRow } from "./api";

/**
 * Subscribe to the admin Server-Sent Events stream of new payment_event
 * rows. The endpoint is gated by the same admin cookie session used by
 * the rest of /api/admin/* — EventSource sends cookies automatically
 * for same-origin requests, which is the case here because the API and
 * admin SPA share the Replit edge proxy origin.
 *
 * The handler receives each parsed event. Components are responsible
 * for being idempotent (the SSE socket may reconnect and replay).
 */
export function usePaymentEventStream(
  onEvent: (ev: PaymentEventRow) => void,
  enabled: boolean = true,
): void {
  // Keep a stable ref to the handler so re-renders that change the
  // closure don't tear down and rebuild the EventSource connection.
  const handlerRef = useRef(onEvent);
  useEffect(() => {
    handlerRef.current = onEvent;
  }, [onEvent]);

  useEffect(() => {
    if (!enabled) return;
    if (typeof window === "undefined" || typeof EventSource === "undefined") {
      return;
    }
    const es = new EventSource("/api/admin/payment-events/stream", {
      withCredentials: true,
    });
    const onPayment = (e: MessageEvent) => {
      try {
        const parsed = JSON.parse(e.data) as PaymentEventRow;
        handlerRef.current(parsed);
      } catch {
        // Malformed payload — ignore rather than crash the dashboard.
      }
    };
    es.addEventListener("payment", onPayment);
    return () => {
      es.removeEventListener("payment", onPayment);
      es.close();
    };
  }, [enabled]);
}
