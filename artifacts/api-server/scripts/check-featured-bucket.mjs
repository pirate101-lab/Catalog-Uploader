#!/usr/bin/env node
// Regression check for the curated merch buckets surfaced on the
// homepage and storefront landing pages. Originally added in Task #8
// for `tiktok_verified` (the homepage's "today's featured edit"
// grid), and broadened in Task #10 to cover every bucket actually
// rendered as a tile/tab on Home.tsx + Shop.tsx, namely:
//   - new_in
//   - collection
//   - tiktok_verified
//   - trending
// Each of those is reachable from the secondary nav (and from
// /shop?bucket=<key>), so a silent zero-result regression on any of
// them — for either gender — would land the same "0 pieces available"
// dead tile that motivated Task #8 in the first place. This check
// fails loudly when ANY (gender, bucket) pair is empty so a future
// change to deriveBuckets() / loadCatalog() can't ship without
// tripping CI.
//
// Usage (server must already be running):
//   API_URL=http://localhost:8080 \
//     node artifacts/api-server/scripts/check-featured-bucket.mjs
//
// Defaults to http://localhost:8080 when API_URL is unset.

const API = (process.env.API_URL ?? "http://localhost:8080").replace(/\/+$/, "");
// Keep this list in sync with VALID_BUCKETS in
// artifacts/fashion/src/lib/productsApi.ts and the TOP_LEVEL_BUCKETS
// map in artifacts/fashion/src/data/taxonomy.ts. These are the buckets
// the storefront UI surfaces as nav tabs / featured tiles.
const CURATED_BUCKETS = ["new_in", "collection", "tiktok_verified", "trending"];
const GENDERS = ["women", "men"];

async function fetchTotal(gender, bucket) {
  const url = `${API}/api/storefront/products?gender=${gender}&bucket=${bucket}&limit=1`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`${url} → HTTP ${res.status}`);
  }
  const body = await res.json();
  if (typeof body?.total !== "number") {
    throw new Error(`${url} → missing numeric "total" in response`);
  }
  return { url, total: body.total };
}

const failures = [];
let checked = 0;
for (const bucket of CURATED_BUCKETS) {
  for (const gender of GENDERS) {
    checked += 1;
    try {
      const { url, total } = await fetchTotal(gender, bucket);
      if (total <= 0) {
        failures.push(`${gender} ${bucket}: total=${total} (expected > 0) — ${url}`);
      } else {
        console.log(`ok  ${gender} ${bucket}: total=${total}`);
      }
    } catch (err) {
      failures.push(`${gender} ${bucket}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

if (failures.length > 0) {
  console.error(
    `\nFAIL curated-bucket regression check:\n  - ${failures.join("\n  - ")}`,
  );
  process.exit(1);
}
console.log(
  `\nall ${checked} (gender, bucket) pair(s) across ${CURATED_BUCKETS.length} curated bucket(s) are non-empty`,
);
