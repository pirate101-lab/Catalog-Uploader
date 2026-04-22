import crypto from "node:crypto";

/* ------------------------------------------------------------------ *
 * Order-view link helpers
 * ------------------------------------------------------------------ *
 * The "View your order" CTA in success-path order emails (received,
 * confirmation, shipped, delivered) deep-links into a public
 * order-status page guarded by an HMAC-signed token. Without the
 * token the public lookup endpoint refuses to return an order, so
 * order IDs (UUIDs) on their own are not enumerable.
 *
 * The signing secret is SESSION_SECRET (already required for the
 * server to boot), so no new env var is introduced. Tokens expire
 * after 90 days — long enough for shoppers to pull up an old email
 * but short enough that a leaked link doesn't grant indefinite
 * read access.
 */

const VIEW_TOKEN_TTL_MS = 90 * 24 * 60 * 60 * 1000;

function getSecret(): string {
  const s = process.env["SESSION_SECRET"];
  if (!s) {
    throw new Error(
      "SESSION_SECRET is required to mint order-view tokens",
    );
  }
  return s;
}

function signViewPayload(orderId: string, expiresAt: number, secret: string): string {
  return crypto
    .createHmac("sha256", secret)
    .update(`order-view:${orderId}.${expiresAt}`)
    .digest("base64url");
}

/** Mint a fresh signed token for the given order. */
export function mintOrderViewToken(orderId: string): string {
  const exp = Date.now() + VIEW_TOKEN_TTL_MS;
  const sig = signViewPayload(orderId, exp, getSecret());
  return `${exp}.${sig}`;
}

/** Build the public order-status URL the email CTA points to. */
export function buildOrderViewUrl(storefrontUrl: string, orderId: string): string {
  const token = mintOrderViewToken(orderId);
  const base = storefrontUrl.replace(/\/+$/, "");
  return `${base}/orders/${encodeURIComponent(orderId)}?t=${encodeURIComponent(token)}`;
}

export function verifyOrderViewToken(orderId: string, token: string): boolean {
  const dot = token.indexOf(".");
  if (dot <= 0) return false;
  const expStr = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < Date.now()) return false;
  const expected = signViewPayload(orderId, exp, getSecret());
  if (sig.length !== expected.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  } catch {
    return false;
  }
}
