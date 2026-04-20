import { sql } from "drizzle-orm";
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
