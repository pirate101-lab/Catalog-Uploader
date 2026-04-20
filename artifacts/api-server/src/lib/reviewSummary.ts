import { eq, sql } from "drizzle-orm";
import { db, productReviewSummaryTable, reviewsTable } from "@workspace/db";

export async function refreshProductReviewSummary(
  productId: string,
): Promise<void> {
  const rows = await db
    .select({
      count: sql<number>`count(*)::int`,
      average: sql<number>`coalesce(avg(${reviewsTable.rating}), 0)::float`,
    })
    .from(reviewsTable)
    .where(sql`${reviewsTable.productId} = ${productId}`);
  const { count = 0, average = 0 } = (rows[0] ?? {}) as {
    count?: number;
    average?: number;
  };
  await db
    .insert(productReviewSummaryTable)
    .values({
      productId,
      count,
      average: average.toFixed(2),
    })
    .onConflictDoUpdate({
      target: productReviewSummaryTable.productId,
      set: {
        count,
        average: average.toFixed(2),
        updatedAt: new Date(),
      },
    });
}

/**
 * Delete a review and keep `product_review_summary` in sync.
 *
 * Returns the affected `productId` (or `null` if no row matched).
 *
 * Funnelling deletions through this helper guarantees that the cached
 * count/average never drifts from `reviews`. Any future moderation path
 * (admin UI, GDPR purge, etc.) should call this rather than issuing a
 * raw `DELETE FROM reviews`.
 */
export async function deleteReviewById(
  reviewId: number,
): Promise<string | null> {
  const [removed] = await db
    .delete(reviewsTable)
    .where(eq(reviewsTable.id, reviewId))
    .returning({ productId: reviewsTable.productId });
  if (!removed) return null;
  await refreshProductReviewSummary(removed.productId);
  return removed.productId;
}

export async function backfillProductReviewSummary(): Promise<number> {
  const rows = await db
    .select({
      productId: reviewsTable.productId,
      count: sql<number>`count(*)::int`,
      average: sql<number>`coalesce(avg(${reviewsTable.rating}), 0)::float`,
    })
    .from(reviewsTable)
    .groupBy(reviewsTable.productId);
  if (rows.length === 0) return 0;
  await db
    .insert(productReviewSummaryTable)
    .values(
      rows.map((r: { productId: string; count: number; average: number }) => ({
        productId: r.productId,
        count: r.count,
        average: r.average.toFixed(2),
      })),
    )
    .onConflictDoUpdate({
      target: productReviewSummaryTable.productId,
      set: {
        count: sql`excluded.count`,
        average: sql`excluded.average`,
        updatedAt: new Date(),
      },
    });
  return rows.length;
}
