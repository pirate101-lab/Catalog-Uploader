#!/usr/bin/env node
// Backfill the `product_review_summary` cache from the live `reviews` table.
//
// Usage (from repo root):
//   pnpm --filter @workspace/api-server exec node scripts/backfill-review-summary.mjs
//
// Safe to re-run: rebuilds every summary row from scratch using a single
// upsert per product. Existing rows are overwritten with current values.

import pg from "pg";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL must be set.");
  process.exit(1);
}

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

try {
  const upsert = await pool.query(`
    INSERT INTO product_review_summary (product_id, count, average, updated_at)
    SELECT product_id,
           count(*)::int AS count,
           round(avg(rating)::numeric, 2) AS average,
           now() AS updated_at
    FROM reviews
    GROUP BY product_id
    ON CONFLICT (product_id) DO UPDATE
      SET count = EXCLUDED.count,
          average = EXCLUDED.average,
          updated_at = EXCLUDED.updated_at
    RETURNING product_id
  `);
  // Products that previously had reviews but no longer do are absent
  // from the SELECT above. Drop their stale summary rows so reruns
  // truly rebuild the cache from scratch.
  const stale = await pool.query(`
    DELETE FROM product_review_summary s
    WHERE NOT EXISTS (
      SELECT 1 FROM reviews r WHERE r.product_id = s.product_id
    )
    RETURNING product_id
  `);
  console.log(
    `Refreshed summary rows for ${upsert.rowCount} product(s); ` +
      `removed ${stale.rowCount} stale row(s).`,
  );
} catch (err) {
  console.error("Backfill failed:", err);
  process.exitCode = 1;
} finally {
  await pool.end();
}
