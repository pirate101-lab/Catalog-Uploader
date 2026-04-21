import crypto from "node:crypto";
import type { SiteSettings } from "@workspace/db";

export type PaystackKeyMode = "live" | "test";

export interface PaystackKeys {
  publicKey: string | null;
  secretKey: string | null;
  mode: PaystackKeyMode;
}

export function getActivePaystackKeys(s: SiteSettings): PaystackKeys {
  const mode: PaystackKeyMode = s.paystackTestMode ? "test" : "live";
  if (mode === "test") {
    return {
      mode,
      publicKey: s.paystackTestPublicKey ?? null,
      secretKey: s.paystackTestSecretKey ?? null,
    };
  }
  return {
    mode,
    publicKey: s.paystackLivePublicKey ?? null,
    secretKey: s.paystackLiveSecretKey ?? null,
  };
}

export function isPaystackReady(s: SiteSettings): boolean {
  if (!s.paystackEnabled) return false;
  const { publicKey, secretKey } = getActivePaystackKeys(s);
  return !!publicKey && !!secretKey;
}

/** "sk_live_abcdef1234" → "sk_live_••••1234". Returns "" if no key. */
export function maskSecret(value: string | null | undefined): string {
  if (!value) return "";
  const trimmed = value.trim();
  if (trimmed.length <= 4) return "••••";
  const last4 = trimmed.slice(-4);
  // Preserve common Paystack prefixes (sk_live_ / sk_test_) for clarity.
  const prefixMatch = trimmed.match(/^(sk_live_|sk_test_|pk_live_|pk_test_)/);
  const prefix = prefixMatch ? prefixMatch[1] : "";
  return `${prefix}••••${last4}`;
}

/** Verify Paystack webhook signature (HMAC-SHA512 of raw body). */
export function verifyWebhookSignature(
  rawBody: Buffer | string,
  signature: string | undefined,
  secretKey: string | null,
): boolean {
  if (!signature || !secretKey) return false;
  const buf = typeof rawBody === "string" ? Buffer.from(rawBody) : rawBody;
  const expected = crypto
    .createHmac("sha512", secretKey)
    .update(buf)
    .digest("hex");
  if (expected.length !== signature.length) return false;
  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected),
      Buffer.from(signature),
    );
  } catch {
    return false;
  }
}

const PAYSTACK_BASE = "https://api.paystack.co";

export interface PaystackInitResult {
  ok: boolean;
  authorizationUrl?: string;
  accessCode?: string;
  reference?: string;
  error?: string;
}

export async function initializeTransaction(
  secretKey: string,
  args: {
    email: string;
    amountKobo: number;
    reference: string;
    callbackUrl: string;
    currency?: string;
    metadata?: Record<string, unknown>;
  },
): Promise<PaystackInitResult> {
  try {
    const r = await fetch(`${PAYSTACK_BASE}/transaction/initialize`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: args.email,
        amount: args.amountKobo,
        reference: args.reference,
        callback_url: args.callbackUrl,
        currency: args.currency ?? "NGN",
        metadata: args.metadata ?? {},
      }),
    });
    const data = (await r.json().catch(() => ({}))) as {
      status?: boolean;
      message?: string;
      data?: {
        authorization_url?: string;
        access_code?: string;
        reference?: string;
      };
    };
    if (!r.ok || !data.status || !data.data?.authorization_url) {
      return {
        ok: false,
        error: data.message ?? `Paystack returned HTTP ${r.status}`,
      };
    }
    return {
      ok: true,
      authorizationUrl: data.data.authorization_url,
      accessCode: data.data.access_code ?? undefined,
      reference: data.data.reference ?? args.reference,
    };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export interface PaystackVerifyResult {
  ok: boolean;
  status?: string;
  amount?: number;
  currency?: string;
  reference?: string;
  paidAt?: string | null;
  error?: string;
}

export async function verifyTransaction(
  secretKey: string,
  reference: string,
): Promise<PaystackVerifyResult> {
  try {
    const r = await fetch(
      `${PAYSTACK_BASE}/transaction/verify/${encodeURIComponent(reference)}`,
      {
        headers: { Authorization: `Bearer ${secretKey}` },
      },
    );
    const data = (await r.json().catch(() => ({}))) as {
      status?: boolean;
      message?: string;
      data?: {
        status?: string;
        amount?: number;
        currency?: string;
        reference?: string;
        paid_at?: string | null;
        paidAt?: string | null;
      };
    };
    if (!r.ok || !data.status || !data.data) {
      return {
        ok: false,
        error: data.message ?? `Paystack returned HTTP ${r.status}`,
      };
    }
    return {
      ok: true,
      status: data.data.status,
      amount: data.data.amount,
      currency: data.data.currency,
      reference: data.data.reference,
      paidAt: data.data.paid_at ?? data.data.paidAt ?? null,
    };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/** Probe the secret key against /balance to confirm validity. */
export async function probeSecretKey(
  secretKey: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const r = await fetch(`${PAYSTACK_BASE}/balance`, {
      headers: { Authorization: `Bearer ${secretKey}` },
    });
    if (r.ok) return { ok: true };
    const data = (await r.json().catch(() => ({}))) as { message?: string };
    return {
      ok: false,
      error: data.message ?? `Paystack returned HTTP ${r.status}`,
    };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

interface OriginRequestLike {
  protocol?: string;
  get?: (name: string) => string | undefined;
  headers?: { host?: string | string[] | undefined };
}

/**
 * Resolve the canonical https origin used to build callback/webhook
 * URLs. Prefer the actual incoming request's host so the URLs reflect
 * the current domain (custom domains, *.replit.app, *.replit.dev all
 * Just Work). Falls back to env if no request is available.
 */
export function getPublicOrigin(req?: OriginRequestLike): string {
  const fromEnv = process.env["PUBLIC_SITE_URL"]?.trim();
  if (fromEnv) return fromEnv.replace(/\/+$/, "");
  if (req) {
    const host =
      req.get?.("host") ??
      (Array.isArray(req.headers?.host) ? req.headers!.host[0] : req.headers?.host);
    if (host) {
      const proto =
        req.protocol && req.protocol !== "http" ? req.protocol : "https";
      return `${proto}://${host}`.replace(/\/+$/, "");
    }
  }
  const dev = process.env["REPLIT_DEV_DOMAIN"]?.trim();
  if (dev) return `https://${dev}`;
  const deployed = process.env["REPLIT_DEPLOYMENT"]?.trim();
  if (deployed) return `https://${deployed}`;
  return "http://localhost";
}

export function getCallbackUrl(req?: OriginRequestLike): string {
  return `${getPublicOrigin(req)}/api/checkout/paystack/callback`;
}

export function getWebhookUrl(req?: OriginRequestLike): string {
  return `${getPublicOrigin(req)}/api/payments/paystack/webhook`;
}
