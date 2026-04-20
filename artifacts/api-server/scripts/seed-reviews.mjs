#!/usr/bin/env node
// Seed reviews into the `reviews` table for storefront products.
//
// Usage (from repo root):
//   pnpm --filter @workspace/api-server exec node scripts/seed-reviews.mjs
//
// Flags / env:
//   --products N        How many distinct products to seed (default 200)
//   --per-min N         Min reviews per product (default 3)
//   --per-max N         Max reviews per product (default 8)
//   --gender women|men|all   Restrict catalog (default all)
//   --reset             Delete existing seeded rows first (`seeded=true` only)
//   --dry-run           Show counts without writing
//
// All inserted rows are tagged `seeded=true, verified_purchase=false` so they
// can be safely cleared via `--reset`. Real buyer reviews (`seeded=false`) are
// never touched.

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL must be set.");
  process.exit(1);
}

const args = process.argv.slice(2);
function arg(name, fallback) {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return fallback;
  return args[i + 1];
}
const flag = (name) => args.includes(`--${name}`);

const NUM_PRODUCTS = Number(arg("products", 200));
const PER_MIN = Number(arg("per-min", 3));
const PER_MAX = Number(arg("per-max", 8));
const GENDER = String(arg("gender", "all")).toLowerCase();
const DRY = flag("dry-run");
const RESET = flag("reset");

if (
  !Number.isFinite(NUM_PRODUCTS) ||
  !Number.isFinite(PER_MIN) ||
  !Number.isFinite(PER_MAX) ||
  PER_MIN < 1 ||
  PER_MAX < PER_MIN
) {
  console.error("Invalid --products / --per-min / --per-max values.");
  process.exit(1);
}

// ── Catalog ────────────────────────────────────────────────────────────
function loadCatalog(file, gender) {
  const p = resolve(__dirname, "../data", file);
  const raw = JSON.parse(readFileSync(p, "utf-8"));
  return raw.map((row) => ({
    id: `${gender === "men" ? "m-" : ""}${row.id}`,
    title: row.title,
    category: row.category,
    gender,
  }));
}

const allProducts = [
  ...(GENDER === "men" ? [] : loadCatalog("catalog_lite.json", "women")),
  ...(GENDER === "women" ? [] : loadCatalog("catalog_men_lite.json", "men")),
];

if (allProducts.length === 0) {
  console.error("No products loaded from catalog files.");
  process.exit(1);
}

// ── Content pools ──────────────────────────────────────────────────────
const FIRST_NAMES = [
  "Ava", "Mia", "Emma", "Olivia", "Sophia", "Isabella", "Charlotte", "Amelia",
  "Harper", "Evelyn", "Aria", "Layla", "Zoe", "Nora", "Lily", "Hannah",
  "Grace", "Chloe", "Ella", "Maya", "Ruby", "Stella", "Hazel", "Penelope",
  "Camila", "Eleanor", "Naomi", "Aaliyah", "Madison", "Scarlett",
  "Liam", "Noah", "Ethan", "Lucas", "Mason", "Logan", "James", "Henry",
  "Caleb", "Wyatt", "Owen", "Julian", "Levi", "Asher", "Ezra", "Theo",
  "Jude", "Felix", "Marcus", "Andre", "Diego", "Mateo", "Kai", "Ronan",
];
const LAST_INITIALS = "ABCDEFGHJKLMNPRSTW".split("");

const POSITIVE_BODIES = [
  "Honestly obsessed. The fit is exactly what I was hoping for and the fabric feels really nice in person.",
  "Better than the photos. Quality is solid and it's already become a wardrobe staple.",
  "Got so many compliments the first time I wore this. Runs true to size for me.",
  "The color and fit are perfect. Looks much more expensive than the price suggests.",
  "Lovely piece. Looks high-end, washed well, no shrinkage so far.",
  "Surprised by the quality at this price point. Already eyeing it in another color.",
  "Comfortable and flattering. I sized down half a size and it was just right.",
  "Goes with everything. Easy to dress up or down, exactly what I needed.",
  "Beautiful drape and the cut is really thoughtful. Wearing it twice a week.",
  "Five stars from me. Quick shipping and the piece itself is gorgeous.",
];
const MIXED_BODIES = [
  "Cute piece overall. The fit ran a touch loose on me but the fabric is soft.",
  "I like it but the color is a shade lighter than the listing photos suggest.",
  "Pretty and well made. Wish there were more size options, ordered up just to be safe.",
  "Solid for the price. Stitching is decent, would buy again on sale.",
  "Looks great on, just a little shorter than I expected. Still keeping it.",
];
const LOW_BODIES = [
  "Quality is okay but the fit didn't work for me. Returning.",
  "Looks nice on the photos but felt a bit thinner than I expected in person.",
];

const TITLES = [
  null, null, null, // bias toward no title
  "New favorite",
  "Worth it",
  "Beautiful in person",
  "Runs true to size",
  "Surprised at the quality",
  "Cute but not perfect",
];

// ── RNG (seedable for repeatability) ───────────────────────────────────
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(0xC0FFEE);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const randInt = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));

function pickRating() {
  // Weighted: 5★ ~55%, 4★ ~30%, 3★ ~10%, 2★ ~4%, 1★ ~1%.
  const r = rand();
  if (r < 0.55) return 5;
  if (r < 0.85) return 4;
  if (r < 0.95) return 3;
  if (r < 0.99) return 2;
  return 1;
}

function bodyForRating(rating) {
  if (rating >= 4) return pick(POSITIVE_BODIES);
  if (rating === 3) return pick(MIXED_BODIES);
  return pick(LOW_BODIES);
}

function genName() {
  return `${pick(FIRST_NAMES)} ${pick(LAST_INITIALS)}.`;
}

// Pick distinct products at random.
function pickProducts(n) {
  const shuffled = [...allProducts];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, Math.min(n, shuffled.length));
}

// ── Build inserts ──────────────────────────────────────────────────────
const products = pickProducts(NUM_PRODUCTS);
const rows = [];
for (const p of products) {
  const count = randInt(PER_MIN, PER_MAX);
  for (let i = 0; i < count; i++) {
    const rating = pickRating();
    rows.push({
      productId: p.id,
      name: genName(),
      rating,
      title: pick(TITLES),
      body: bodyForRating(rating),
    });
  }
}

console.log(
  `Seeding ${rows.length} reviews across ${products.length} products ` +
    `(catalog: ${allProducts.length}, gender filter: ${GENDER}).`,
);

if (DRY) {
  console.log("Dry run — no rows written.");
  process.exit(0);
}

// ── Write to DB ────────────────────────────────────────────────────────
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

try {
  // Track every product whose review set we touched so we can refresh
  // the cached summary in one pass at the end. Seeded inserts plus any
  // products whose reviews were just removed by --reset both need a
  // refresh so the cache doesn't drift.
  const touched = new Set(rows.map((r) => r.productId));

  if (RESET) {
    const del = await pool.query(
      `DELETE FROM reviews WHERE seeded = true RETURNING id, product_id`,
    );
    for (const r of del.rows) touched.add(r.product_id);
    console.log(`Cleared ${del.rowCount} previously seeded review row(s).`);
  }

  const BATCH = 500;
  let inserted = 0;
  for (let start = 0; start < rows.length; start += BATCH) {
    const slice = rows.slice(start, start + BATCH);
    const params = [];
    const placeholders = slice.map((row, idx) => {
      const base = idx * 6;
      params.push(
        row.productId,
        row.name,
        row.rating,
        row.title,
        row.body,
        true, // seeded
      );
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, false, $${base + 6})`;
    });
    const q = `
      INSERT INTO reviews (product_id, name, rating, title, body, verified_purchase, seeded)
      VALUES ${placeholders.join(",")}
    `;
    await pool.query(q, params);
    inserted += slice.length;
    process.stdout.write(`\r  inserted ${inserted}/${rows.length}`);
  }
  process.stdout.write("\n");

  // Refresh the cached `product_review_summary` rows for every touched
  // product (and any product whose seeded rows were just deleted via
  // `--reset`). Mirrors the upsert performed at API write time.
  const productIds = Array.from(touched);
  if (productIds.length > 0) {
    const placeholders = productIds.map((_, i) => `$${i + 1}`).join(",");
    const refresh = await pool.query(
      `
      INSERT INTO product_review_summary (product_id, count, average, updated_at)
      SELECT product_id,
             count(*)::int,
             round(avg(rating)::numeric, 2),
             now()
      FROM reviews
      WHERE product_id IN (${placeholders})
      GROUP BY product_id
      ON CONFLICT (product_id) DO UPDATE
        SET count = EXCLUDED.count,
            average = EXCLUDED.average,
            updated_at = EXCLUDED.updated_at
      `,
      productIds,
    );
    // Products that lost all their reviews via --reset will not appear in
    // the SELECT above; zero them out explicitly so the cache stays
    // truthful.
    await pool.query(
      `
      UPDATE product_review_summary
      SET count = 0, average = 0, updated_at = now()
      WHERE product_id IN (${placeholders})
        AND NOT EXISTS (
          SELECT 1 FROM reviews r WHERE r.product_id = product_review_summary.product_id
        )
      `,
      productIds,
    );
    console.log(
      `Refreshed review summary for ${refresh.rowCount} product(s).`,
    );
  }
  console.log("Done.");
} catch (err) {
  console.error("Seed failed:", err);
  process.exitCode = 1;
} finally {
  await pool.end();
}
