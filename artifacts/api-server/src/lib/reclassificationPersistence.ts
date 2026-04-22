import { desc, lt, sql } from "drizzle-orm";
import {
  db,
  reclassificationEventsTable,
  type ReclassificationEvent,
} from "@workspace/db";
import {
  setReclassificationPersister,
  type ReclassificationRecord,
} from "./catalog.ts";
import { logger } from "./logger.ts";

/**
 * Records older than this without a fresh sighting are pruned on each
 * persistence cycle so the table doesn't grow unbounded with stale
 * entries for products that are no longer being reclassified.
 */
const PRUNE_AFTER_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * Upsert a batch of reclassification records into the DB. For each
 * record we keep the original `observedAt` (the first time we ever
 * saw this product moved) and refresh `lastObservedAt`, title, and
 * the current move target — so a rule change that re-routes the row
 * to a different category is reflected without losing the historical
 * "first seen" timestamp. Always runs a prune of records whose
 * `lastObservedAt` is older than 90 days.
 *
 * Failures are logged but never thrown — the catalog loader fires
 * this in the background and a transient DB hiccup must not block
 * storefront traffic.
 */
export async function persistReclassifications(
  records: ReclassificationRecord[],
): Promise<void> {
  try {
    if (records.length > 0) {
      // De-dupe within the batch so the same productId observed twice
      // (e.g. from successive women/men passes — shouldn't happen with
      // gender-prefixed ids, but be defensive) doesn't trigger a
      // "cannot affect row a second time" Postgres error in upsert.
      const byId = new Map<string, ReclassificationRecord>();
      for (const r of records) byId.set(r.id, r);
      const values = [...byId.values()].map((r) => ({
        productId: r.id,
        title: r.title,
        gender: r.gender,
        originalCategory: r.originalCategory,
        newCategory: r.newCategory,
        matchedHint: r.matchedHint,
        ruleId: r.ruleId,
        ruleLabel: r.ruleLabel,
      }));
      await db
        .insert(reclassificationEventsTable)
        .values(values)
        .onConflictDoUpdate({
          target: reclassificationEventsTable.productId,
          set: {
            title: sql`excluded.title`,
            newCategory: sql`excluded.new_category`,
            matchedHint: sql`excluded.matched_hint`,
            // Refresh rule attribution on every sighting so a row whose
            // rule was reassigned (admin edited the pattern, or a
            // different rule now wins precedence) ends up attributed to
            // whichever rule fires today rather than the one captured
            // on first sighting.
            ruleId: sql`excluded.rule_id`,
            ruleLabel: sql`excluded.rule_label`,
            // Preserve the original observed_at (first sighting); only
            // bump the last_observed_at watermark.
            lastObservedAt: sql`NOW()`,
          },
        });
    }
    const cutoff = new Date(Date.now() - PRUNE_AFTER_MS);
    const pruned = await db
      .delete(reclassificationEventsTable)
      .where(lt(reclassificationEventsTable.lastObservedAt, cutoff))
      .returning({ productId: reclassificationEventsTable.productId });
    if (pruned.length > 0) {
      logger.info(
        { pruned: pruned.length },
        "Pruned stale reclassification_events rows",
      );
    }
  } catch (err) {
    logger.warn({ err }, "Failed to persist reclassification records");
  }
}

/**
 * Read every persisted reclassification, newest first. Used by the
 * admin endpoint instead of the in-memory `getReclassifications()`.
 */
export async function listPersistedReclassifications(): Promise<
  ReclassificationEvent[]
> {
  return db
    .select()
    .from(reclassificationEventsTable)
    .orderBy(desc(reclassificationEventsTable.lastObservedAt));
}

/**
 * Tracks the most recent persistence call so callers (e.g. the admin
 * `/admin/reclassifications` endpoint after a cold boot) can await it
 * and avoid the race where the DB read fires before the very first
 * fire-and-forget persist completes.
 */
let lastPersistence: Promise<void> = Promise.resolve();

export function awaitLastPersistence(): Promise<void> {
  return lastPersistence;
}

/**
 * Wire the catalog loader's reclassification callback to the DB
 * persister. Call once at server boot — idempotent.
 */
export function registerReclassificationPersister(): void {
  setReclassificationPersister((records) => {
    lastPersistence = persistReclassifications(records);
    return lastPersistence;
  });
}
