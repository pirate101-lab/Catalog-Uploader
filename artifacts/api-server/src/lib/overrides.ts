import { db, productOverridesTable, type ProductOverride } from "@workspace/db";

let cache: Map<string, ProductOverride> | null = null;
let cacheUntil = 0;
const TTL_MS = 5_000;
let warnedOnce = false;

export async function getOverridesMap(): Promise<Map<string, ProductOverride>> {
  const now = Date.now();
  if (cache && now < cacheUntil) return cache;
  try {
    const rows = await db.select().from(productOverridesTable);
    const map = new Map<string, ProductOverride>();
    for (const r of rows) map.set(r.productId, r);
    cache = map;
    cacheUntil = now + TTL_MS;
    return map;
  } catch (err) {
    if (!warnedOnce) {
      warnedOnce = true;
      console.warn(
        "[overrides] failed to load product_overrides; serving catalog without overrides:",
        (err as Error).message,
      );
    }
    const empty = new Map<string, ProductOverride>();
    cache = empty;
    cacheUntil = now + TTL_MS;
    return empty;
  }
}

export function invalidateOverrides(): void {
  cache = null;
  cacheUntil = 0;
}
