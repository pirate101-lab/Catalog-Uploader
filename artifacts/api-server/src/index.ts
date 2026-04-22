import app from "./app";
import { logger } from "./lib/logger";
import { ObjectStorageService } from "./lib/objectStorage";
import { migrateAdminCredentials } from "./lib/adminCredentials";
import { db, ordersTable } from "@workspace/db";
import { sql, isNull } from "drizzle-orm";
import { getSiteSettings } from "./lib/siteSettings";
import { refreshFxRate } from "./lib/fx";
import { pruneStaleBuckets } from "./lib/rateLimit";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// SESSION_SECRET signs HMAC tokens used by the customer
// order-status link in success-path order emails (see
// lib/orderViewToken.ts). Without it, success-path email rendering
// would throw at send time and customers would silently lose their
// order-status link. Fail fast at boot instead.
if (!process.env["SESSION_SECRET"] || !process.env["SESSION_SECRET"].trim()) {
  throw new Error(
    "SESSION_SECRET environment variable is required but was not provided.",
  );
}

const storageConfigured = new ObjectStorageService().isConfigured();

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  // One-time migration of legacy site_settings credentials into the
  // admin_users table. No-op once it has run, and never auto-creates an
  // admin row — first-run setup happens via the registration UI now.
  migrateAdminCredentials().catch((err) => {
    logger.error({ err }, "Failed to migrate admin credentials");
  });

  if (storageConfigured) {
    logger.info("Object storage: configured");
  } else {
    logger.warn(
      "Object storage: NOT configured — set PUBLIC_OBJECT_SEARCH_PATHS " +
        "(provision an Object Storage bucket to get this value)"
    );
  }

  // Skip background work in tests so unit/integration runs don't fan
  // out HTTP calls to the FX provider or mutate fixture rows.
  if (process.env["NODE_ENV"] === "test") return;

  // One-time backfill: orders placed before the display_* split landed
  // have nulls in those columns. Mirror the canonical totals into them
  // so the admin order detail and email templates can use the same
  // viewOrderAmounts() code path for legacy and new rows alike.
  void backfillDisplayColumns().catch((err) => {
    logger.error({ err }, "Failed to backfill display_* on orders");
  });

  // Auto-refresh USD→KES every hour while the toggle is on. We poll
  // hourly but only call the upstream provider when the stored rate
  // is stale (>24h) or never set, keeping the free-tier hit minimal.
  const FX_POLL_MS = 60 * 60 * 1000;
  const FX_STALE_MS = 24 * 60 * 60 * 1000;
  const fxTimer = setInterval(() => {
    void maybeRefreshFx(FX_STALE_MS).catch((err) => {
      logger.warn({ err }, "FX auto-refresh attempt failed");
    });
  }, FX_POLL_MS);
  fxTimer.unref?.();
  // Kick once on boot so the very first deployment doesn't have to
  // wait an hour for the first refresh.
  void maybeRefreshFx(FX_STALE_MS).catch((err) => {
    logger.warn({ err }, "FX auto-refresh attempt failed (boot)");
  });

  // Garbage-collect stale rate-limit buckets so the table doesn't
  // grow unbounded with one row per unique caller. The longest
  // active sliding window is ~1h (test-email send); deleting rows
  // untouched for >24h leaves a wide safety margin while keeping
  // the table size proportional to recently-active callers.
  const RATE_LIMIT_GC_INTERVAL_MS = 60 * 60 * 1000;
  const RATE_LIMIT_GC_MAX_AGE_MS = 24 * 60 * 60 * 1000;
  const rateLimitGcTimer = setInterval(() => {
    void pruneRateLimitBuckets(RATE_LIMIT_GC_MAX_AGE_MS);
  }, RATE_LIMIT_GC_INTERVAL_MS);
  rateLimitGcTimer.unref?.();
  // Run once on boot so a fresh deploy immediately reaps anything
  // left over from the previous process.
  void pruneRateLimitBuckets(RATE_LIMIT_GC_MAX_AGE_MS);
});

async function backfillDisplayColumns(): Promise<void> {
  // Single UPDATE — run idempotently on every boot. Cheap because the
  // WHERE clause uses the partial nullness of display_total_cents,
  // which becomes empty after the first run.
  const result = await db
    .update(ordersTable)
    .set({
      displayCurrency: sql`COALESCE(${ordersTable.displayCurrency}, ${ordersTable.currency})`,
      displaySubtotalCents: sql`COALESCE(${ordersTable.displaySubtotalCents}, ${ordersTable.subtotalCents})`,
      displayShippingCents: sql`COALESCE(${ordersTable.displayShippingCents}, ${ordersTable.shippingCents})`,
      displayTaxCents: sql`COALESCE(${ordersTable.displayTaxCents}, ${ordersTable.taxCents})`,
      displayTotalCents: sql`COALESCE(${ordersTable.displayTotalCents}, ${ordersTable.totalCents})`,
    })
    .where(isNull(ordersTable.displayTotalCents))
    .returning({ id: ordersTable.id });
  if (result.length > 0) {
    logger.info(
      { count: result.length },
      "Backfilled display_* columns on legacy orders",
    );
  }
}

async function pruneRateLimitBuckets(maxAgeMs: number): Promise<void> {
  try {
    const removed = await pruneStaleBuckets(maxAgeMs);
    if (removed > 0) {
      logger.info({ removed }, "Pruned stale rate-limit buckets");
    }
  } catch (err) {
    logger.warn({ err }, "Failed to prune stale rate-limit buckets");
  }
}

async function maybeRefreshFx(staleMs: number): Promise<void> {
  const settings = await getSiteSettings();
  if (!settings.fxAutoRefresh) return;
  const last = settings.fxRateUpdatedAt?.getTime?.() ?? 0;
  if (last !== 0 && Date.now() - last < staleMs) return;
  const result = await refreshFxRate();
  if (result.ok) {
    logger.info(
      { rate: result.rate, source: result.source },
      "Auto-refreshed USD→KES FX rate",
    );
  } else {
    logger.warn({ error: result.error }, "Auto-refresh of FX rate failed");
  }
}
