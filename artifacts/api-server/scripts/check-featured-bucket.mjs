#!/usr/bin/env node
// Regression check for Task #8 — guards the homepage "today's featured
// edit" grid (Home.tsx → FEATURED_BUCKET = "tiktok_verified") against a
// silent zero-result regression like the one that left the Men's Edit
// reading "0 pieces available" for weeks. Fails loudly when either
// gender's tiktok_verified pool is empty so a future change to
// deriveBuckets() / loadCatalog() can't ship without tripping CI.
//
// Usage (server must already be running):
//   API_URL=http://localhost:8080 \
//     node artifacts/api-server/scripts/check-featured-bucket.mjs
//
// Defaults to http://localhost:8080 when API_URL is unset.

const API = (process.env.API_URL ?? "http://localhost:8080").replace(/\/+$/, "");
const FEATURED_BUCKET = "tiktok_verified";
const GENDERS = ["women", "men"];

async function fetchTotal(gender) {
  const url = `${API}/api/storefront/products?gender=${gender}&bucket=${FEATURED_BUCKET}&limit=1`;
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
for (const gender of GENDERS) {
  try {
    const { url, total } = await fetchTotal(gender);
    if (total <= 0) {
      failures.push(`${gender}: total=${total} (expected > 0) — ${url}`);
    } else {
      console.log(`ok  ${gender} ${FEATURED_BUCKET}: total=${total}`);
    }
  } catch (err) {
    failures.push(`${gender}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

if (failures.length > 0) {
  console.error(
    `\nFAIL ${FEATURED_BUCKET} regression check:\n  - ${failures.join("\n  - ")}`,
  );
  process.exit(1);
}
console.log(`\nall ${GENDERS.length} gender(s) have non-empty ${FEATURED_BUCKET} bucket`);
