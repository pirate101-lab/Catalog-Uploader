#!/usr/bin/env node
// Repeatable p95 benchmark for the hot storefront endpoints called out in
// the Task #19 site audit. Run with the API server already serving on
// $API_URL (defaults to http://localhost:8080):
//
//   node artifacts/api-server/scripts/bench-storefront.mjs
//
// Optional env: API_URL, BENCH_N (default 80), BENCH_WARMUP (default 5).

const API = process.env.API_URL ?? "http://localhost:8080";
const N = Number(process.env.BENCH_N ?? 80);
const WARMUP = Number(process.env.BENCH_WARMUP ?? 5);

async function timeRequest(url) {
  const start = performance.now();
  const res = await fetch(url);
  await res.text();
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return performance.now() - start;
}

async function bench(label, url) {
  for (let i = 0; i < WARMUP; i++) await timeRequest(url);
  const samples = [];
  for (let i = 0; i < N; i++) samples.push(await timeRequest(url));
  samples.sort((a, b) => a - b);
  const pick = (q) => samples[Math.min(samples.length - 1, Math.floor(q * samples.length))];
  return {
    label,
    n: N,
    minMs: +samples[0].toFixed(2),
    p50Ms: +pick(0.5).toFixed(2),
    p95Ms: +pick(0.95).toFixed(2),
    maxMs: +samples[samples.length - 1].toFixed(2),
  };
}

const productsPlain = `${API}/api/storefront/products?limit=24`;
const productsFiltered = `${API}/api/storefront/products?limit=24&category=Dresses&gender=women&sort=price-asc`;

// Pick a real product id so the reviews endpoint hits a populated row.
const sample = await (await fetch(productsPlain)).json();
const sampleId = sample?.rows?.[0]?.id;
if (!sampleId) throw new Error("No products returned — is the API server running?");
const reviews = `${API}/api/storefront/products/${encodeURIComponent(sampleId)}/reviews?limit=20`;

const results = [];
results.push(await bench("products(plain)", productsPlain));
results.push(await bench("products(filtered)", productsFiltered));
results.push(await bench("products/:id/reviews", reviews));

console.table(results);

const target = 200;
const overBudget = results.filter((r) => r.p95Ms > target);
if (overBudget.length > 0) {
  console.error(`FAIL: p95 exceeded ${target} ms for:`, overBudget.map((r) => r.label));
  process.exit(1);
}
console.log(`OK: all p95 ≤ ${target} ms`);
