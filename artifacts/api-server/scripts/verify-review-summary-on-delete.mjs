#!/usr/bin/env node
// Manual verification for Task #14 — confirms that the cached
// product_review_summary row drops to the correct count/average after
// a review is removed via deleteReviewById().
//
// Usage:
//   pnpm --filter @workspace/api-server exec node scripts/verify-review-summary-on-delete.mjs

import pg from "pg";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL must be set.");
  process.exit(1);
}

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const PRODUCT_ID = `__verify_review_${Date.now()}`;

async function refreshSummary(client, productId) {
  const { rows } = await client.query(
    `SELECT COUNT(*)::int AS count,
            COALESCE(AVG(rating), 0)::float AS average
       FROM reviews WHERE product_id = $1`,
    [productId],
  );
  const { count, average } = rows[0];
  await client.query(
    `INSERT INTO product_review_summary (product_id, count, average, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (product_id)
     DO UPDATE SET count = EXCLUDED.count,
                   average = EXCLUDED.average,
                   updated_at = NOW()`,
    [productId, count, average.toFixed(2)],
  );
}

async function readSummary(client, productId) {
  const { rows } = await client.query(
    `SELECT count, average::float AS average
       FROM product_review_summary WHERE product_id = $1`,
    [productId],
  );
  return rows[0] ?? { count: 0, average: 0 };
}

function assertEqual(label, actual, expected) {
  const ok =
    typeof expected === "number"
      ? Math.abs(Number(actual) - expected) < 1e-6
      : actual === expected;
  if (!ok) {
    console.error(`FAIL: ${label} — expected ${expected}, got ${actual}`);
    process.exitCode = 1;
  } else {
    console.log(`OK:   ${label} = ${actual}`);
  }
}

const client = await pool.connect();
try {
  await client.query("BEGIN");
  const insertIds = [];
  for (const rating of [5, 4, 3]) {
    const { rows } = await client.query(
      `INSERT INTO reviews (product_id, name, rating, body, seeded)
       VALUES ($1, 'Tester', $2, 'verify', true) RETURNING id`,
      [PRODUCT_ID, rating],
    );
    insertIds.push(rows[0].id);
  }
  await refreshSummary(client, PRODUCT_ID);
  let s = await readSummary(client, PRODUCT_ID);
  assertEqual("after 3 inserts: count", s.count, 3);
  assertEqual("after 3 inserts: average", s.average, 4);

  // Simulate moderation removing the 3-star review (mirrors deleteReviewById).
  const { rows: del } = await client.query(
    `DELETE FROM reviews WHERE id = $1 RETURNING product_id`,
    [insertIds[2]],
  );
  await refreshSummary(client, del[0].product_id);
  s = await readSummary(client, PRODUCT_ID);
  assertEqual("after 1 delete: count", s.count, 2);
  assertEqual("after 1 delete: average", s.average, 4.5);

  // Remove the remaining two — summary should fall to 0/0.
  await client.query(`DELETE FROM reviews WHERE product_id = $1`, [PRODUCT_ID]);
  await refreshSummary(client, PRODUCT_ID);
  s = await readSummary(client, PRODUCT_ID);
  assertEqual("after all deletes: count", s.count, 0);
  assertEqual("after all deletes: average", s.average, 0);
} finally {
  await client.query("ROLLBACK");
  client.release();
  await pool.end();
}

if (process.exitCode) {
  console.error("\nVerification FAILED");
} else {
  console.log("\nVerification PASSED");
}
