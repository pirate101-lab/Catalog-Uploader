import crypto from "node:crypto";

/* ------------------------------------------------------------------ *
 * Paystack resume-payment link helpers
 * ------------------------------------------------------------------ *
 * The "Complete your payment" button in our payment_failed email
 * points at GET /api/checkout/paystack/resume?order=<id>&token=<sig>.
 * The token is an HMAC of `<orderId>.<expiryMs>` keyed off the active
 * Paystack secret, so:
 *   - the link is non-guessable (you'd need the secret to forge one)
 *   - it expires after 7 days
 *   - rotating the Paystack secret invalidates all in-flight links,
 *     which is the right behaviour for a security rotation
 *
 * These helpers live in `lib/` (rather than inside `routes/checkout.ts`)
 * so other route modules — payments.ts, admin.ts — can mint retry links
 * without importing from a sibling route file.
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

export function verifyResumeToken(
  orderId: string,
  token: string,
  secret: string,
): boolean {
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
