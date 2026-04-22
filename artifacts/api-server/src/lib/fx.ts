import type { SiteSettings } from "@workspace/db";
import { getSiteSettings, invalidateSiteSettings } from "./siteSettings.ts";
import { db, siteSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

/**
 * Hybrid currency: shoppers see USD prices on the storefront, but the
 * Paystack merchant account is locked to KES — so every charge is
 * converted USD → KES using a stored rate that operators can refresh
 * from a free FX provider or override manually.
 *
 * All monetary inputs/outputs are in the smallest unit of their
 * currency (cents for USD, cents-of-shilling for KES). KES uses 100
 * subunits per shilling per ISO 4217, so the math is the same shape
 * as USD cents.
 */

/** What we actually charge the customer through Paystack. Locked to
 *  KES today because that's the merchant account currency. */
export const CHARGE_CURRENCY = "KES" as const;

/** What shoppers see on the storefront. Locked to USD today because
 *  the priced catalog is in USD. */
export const DISPLAY_CURRENCY = "USD" as const;

/** Sane bounds for the USD→KES rate so we never accept a runaway
 *  value (manual typo or upstream provider glitch) that would massively
 *  over- or under-charge. The real rate has lived in 100–200 for years. */
export const FX_RATE_MIN = 50;
export const FX_RATE_MAX = 1000;

export interface ConvertedTotals {
  /** Display-currency cents (what the shopper sees). */
  displaySubtotalCents: number;
  displayShippingCents: number;
  displayTaxCents: number;
  displayTotalCents: number;
  /** Charge-currency cents (what Paystack will be asked to charge). */
  chargeSubtotalCents: number;
  chargeShippingCents: number;
  chargeTaxCents: number;
  chargeTotalCents: number;
  fxRate: number;
  fxRateAsOf: Date | null;
}

/** Read the active rate from settings. Fail-soft on parse: if the
 *  stored value is somehow non-numeric we fall back to the column
 *  default so checkout never crashes. */
export function getActiveRate(settings: SiteSettings): number {
  const raw = Number(settings.usdToKesRate ?? "130");
  if (!Number.isFinite(raw) || raw <= 0) return 130;
  return raw;
}

/** Pure conversion helper — no DB I/O. Used by /quote and /paystack/init.
 *  All inputs are USD cents; outputs include both display and charge. */
export function convertCart(
  usd: {
    subtotalCents: number;
    shippingCents: number;
    taxCents: number;
    totalCents: number;
  },
  settings: SiteSettings,
): ConvertedTotals {
  const rate = getActiveRate(settings);
  // KES has 100 subunits per shilling, so cents-of-USD * rate = cents-of-KES.
  const toCharge = (usdCents: number): number => Math.round(usdCents * rate);
  return {
    displaySubtotalCents: usd.subtotalCents,
    displayShippingCents: usd.shippingCents,
    displayTaxCents: usd.taxCents,
    displayTotalCents: usd.totalCents,
    chargeSubtotalCents: toCharge(usd.subtotalCents),
    chargeShippingCents: toCharge(usd.shippingCents),
    chargeTaxCents: toCharge(usd.taxCents),
    chargeTotalCents: toCharge(usd.totalCents),
    fxRate: rate,
    fxRateAsOf: settings.fxRateUpdatedAt ?? null,
  };
}

export interface FxRefreshResult {
  ok: boolean;
  rate?: number;
  asOf?: Date;
  source?: string;
  error?: string;
}

/** Fetch the latest USD→KES mid-market rate from a free public
 *  provider. We try open.er-api.com first (no key, very high free
 *  tier), then fall back to exchangerate.host. Both return JSON of
 *  shape { rates: { KES: number } } or similar. */
export async function fetchUpstreamRate(): Promise<FxRefreshResult> {
  const providers: Array<{
    name: string;
    url: string;
    extract: (data: unknown) => number | null;
  }> = [
    {
      name: "open.er-api.com",
      url: "https://open.er-api.com/v6/latest/USD",
      extract: (d) => {
        const rates = (d as { rates?: Record<string, unknown> }).rates;
        const r = rates?.["KES"];
        return typeof r === "number" ? r : null;
      },
    },
    {
      name: "exchangerate.host",
      url: "https://api.exchangerate.host/latest?base=USD&symbols=KES",
      extract: (d) => {
        const rates = (d as { rates?: Record<string, unknown> }).rates;
        const r = rates?.["KES"];
        return typeof r === "number" ? r : null;
      },
    },
  ];
  let lastError = "No FX provider returned a usable rate.";
  for (const p of providers) {
    try {
      const res = await fetch(p.url, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(8_000),
      });
      if (!res.ok) {
        lastError = `${p.name} returned HTTP ${res.status}`;
        continue;
      }
      const data = (await res.json().catch(() => null)) as unknown;
      if (!data) {
        lastError = `${p.name} returned non-JSON`;
        continue;
      }
      const rate = p.extract(data);
      if (rate === null || !Number.isFinite(rate) || rate <= 0) {
        lastError = `${p.name} did not include a USD→KES rate`;
        continue;
      }
      if (rate < FX_RATE_MIN || rate > FX_RATE_MAX) {
        lastError = `${p.name} returned an out-of-range rate (${rate})`;
        continue;
      }
      return { ok: true, rate, asOf: new Date(), source: p.name };
    } catch (err) {
      lastError = `${p.name}: ${(err as Error).message}`;
    }
  }
  return { ok: false, error: lastError };
}

/** Fetch + persist a fresh rate. Returns the persisted rate or an
 *  error so the admin can surface it inline. */
export async function refreshFxRate(): Promise<FxRefreshResult> {
  const fetched = await fetchUpstreamRate();
  if (!fetched.ok || fetched.rate === undefined || fetched.asOf === undefined) {
    return fetched;
  }
  await db
    .update(siteSettingsTable)
    .set({
      usdToKesRate: fetched.rate.toFixed(6),
      fxRateUpdatedAt: fetched.asOf,
    })
    .where(eq(siteSettingsTable.id, 1));
  invalidateSiteSettings();
  return fetched;
}

/** Format a USD→KES rate for display ("1 USD ≈ KSh 130.50"). */
export function formatRateForDisplay(rate: number): string {
  return `$1 ≈ KSh ${rate.toFixed(2)}`;
}

/** Helpers used by admin/email rendering to pick the "shopper-facing"
 *  amount for a stored order, falling back to the charge column for
 *  legacy rows that predate the displayCurrency split. */
export interface OrderAmountsView {
  /** Best-effort display total (USD for new orders; charge currency
   *  for legacy ones). */
  displayCurrency: string;
  displaySubtotalCents: number;
  displayShippingCents: number;
  displayTaxCents: number;
  displayTotalCents: number;
  /** True when displayCurrency != currency, i.e. this order was
   *  charged in a different currency (FX conversion happened). */
  hasFxConversion: boolean;
  /** Stored charge values for display in admin reconciliation. */
  chargeCurrency: string;
  chargeTotalCents: number;
  fxRate: number | null;
}

export function viewOrderAmounts(order: {
  currency: string;
  subtotalCents: number;
  shippingCents: number;
  taxCents: number;
  totalCents: number;
  displayCurrency: string | null;
  displaySubtotalCents: number | null;
  displayShippingCents: number | null;
  displayTaxCents: number | null;
  displayTotalCents: number | null;
  fxRate: string | null;
}): OrderAmountsView {
  const displayCurrency = order.displayCurrency ?? order.currency;
  const displaySubtotalCents =
    order.displaySubtotalCents ?? order.subtotalCents;
  const displayShippingCents =
    order.displayShippingCents ?? order.shippingCents;
  const displayTaxCents = order.displayTaxCents ?? order.taxCents;
  const displayTotalCents = order.displayTotalCents ?? order.totalCents;
  const fxRate =
    order.fxRate !== null && order.fxRate !== undefined
      ? Number(order.fxRate)
      : null;
  return {
    displayCurrency,
    displaySubtotalCents,
    displayShippingCents,
    displayTaxCents,
    displayTotalCents,
    hasFxConversion: displayCurrency !== order.currency,
    chargeCurrency: order.currency,
    chargeTotalCents: order.totalCents,
    fxRate: Number.isFinite(fxRate as number) ? fxRate : null,
  };
}

/** Read settings + return active rate. Convenience wrapper used by
 *  routes that don't already have settings in scope. */
export async function getActiveRateFromDb(): Promise<{
  rate: number;
  asOf: Date | null;
}> {
  const s = await getSiteSettings();
  return { rate: getActiveRate(s), asOf: s.fxRateUpdatedAt ?? null };
}
