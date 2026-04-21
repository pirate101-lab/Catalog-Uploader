import { db, siteSettingsTable, type SiteSettings } from "@workspace/db";
import { eq } from "drizzle-orm";

let cache: SiteSettings | null = null;
let cacheUntil = 0;
const TTL_MS = 5_000;

export async function getSiteSettings(): Promise<SiteSettings> {
  const now = Date.now();
  if (cache && now < cacheUntil) return cache;
  const [row] = await db
    .select()
    .from(siteSettingsTable)
    .where(eq(siteSettingsTable.id, 1));
  if (row) {
    cache = row;
    cacheUntil = now + TTL_MS;
    return row;
  }
  const [created] = await db
    .insert(siteSettingsTable)
    .values({ id: 1 })
    .returning();
  cache = created;
  cacheUntil = now + TTL_MS;
  return created;
}

export function invalidateSiteSettings(): void {
  cache = null;
  cacheUntil = 0;
}

const FALLBACK_SETTINGS: SiteSettings = {
  id: 1,
  announcementText: "",
  announcementActive: false,
  defaultSort: "featured",
  freeShippingThresholdCents: 15000,
  currencySymbol: "$",
  maintenanceMode: false,
  storeName: "VELOUR",
  tagline: "Women's Fashion Store",
  logoUrl: null,
  emailFromAddress: null,
  emailFromName: null,
  emailReplyTo: null,
  heroAutoAdvance: true,
  allowGuestReviews: false,
  paystackEnabled: false,
  paystackTestMode: false,
  paystackLivePublicKey: null,
  paystackLiveSecretKey: null,
  paystackTestPublicKey: null,
  paystackTestSecretKey: null,
  bankName: null,
  bankAccountName: null,
  bankAccountNumber: null,
  bankSwiftCode: null,
  bankRoutingNumber: null,
  bankInstructions: null,
  paymentAlertMode: "off",
  paymentAlertRecipients: null,
  adminUsername: null,
  adminPasswordHash: null,
  smtpHost: null,
  smtpPort: null,
  smtpSecure: true,
  smtpUsername: null,
  smtpPassword: null,
  updatedAt: new Date(0),
};

let storefrontWarnedOnce = false;

/**
 * Storefront-only variant: never throws. If the underlying
 * `site_settings` table is missing/unreachable, logs once and serves
 * the static {@link FALLBACK_SETTINGS} so the public storefront keeps
 * rendering. Admin and email/checkout flows must continue to call
 * {@link getSiteSettings} directly so DB outages remain visible.
 */
export async function getSiteSettingsForStorefront(): Promise<SiteSettings> {
  try {
    return await getSiteSettings();
  } catch (err) {
    if (!storefrontWarnedOnce) {
      storefrontWarnedOnce = true;
      console.warn(
        "[siteSettings] failed to load site_settings for storefront; serving defaults:",
        (err as Error).message,
      );
    }
    return FALLBACK_SETTINGS;
  }
}
