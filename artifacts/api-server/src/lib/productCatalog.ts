import { db, customProductsTable, type CustomProduct, type ProductOverride } from "@workspace/db";
import { isNull, or, eq } from "drizzle-orm";
import { getAllProducts as getJsonCatalog, type ProductRow, type Gender } from "./catalog.ts";

// Short-lived cache so the storefront's repeated catalog reads don't
// hammer Postgres. Custom-product CRUD calls invalidate explicitly.
let customCache: ProductRow[] | null = null;
let customCacheUntil = 0;
const TTL_MS = 5_000;

function customRowToProduct(c: CustomProduct): ProductRow {
  return {
    id: c.id,
    title: c.title,
    category: c.category ?? null,
    subCategory: c.subCategory ?? null,
    price: Number(c.price).toFixed(2),
    imageUrls: Array.isArray(c.imageUrls) ? c.imageUrls : [],
    sizes: Array.isArray(c.sizes) ? c.sizes : [],
    colors: Array.isArray(c.colors) ? c.colors : [],
    gender: (c.gender as Gender) ?? "women",
    isNewIn: false,
    isCollection: false,
    isTikTokVerified: false,
    isTrending: false,
    trendScore: 0,
    buckets: [],
    // Preserve admin-authored fields so storefront/checkout/admin all
    // honour the custom row's badge/featured/hidden/stock and so the
    // admin "show deleted" view can detect tombstones on custom rows.
    badge: c.badge ?? null,
    featured: !!c.featured,
    hidden: !!c.hidden,
    stockLevel: c.stockLevel ?? null,
    deletedAt: c.deletedAt ? new Date(c.deletedAt as unknown as string).toISOString() : null,
  };
}

/**
 * Fetch all custom products. By default excludes soft-deleted rows;
 * pass `includeDeleted: true` from admin views that need them. Cached
 * for TTL_MS to keep storefront listing cheap.
 */
export async function getCustomProducts(opts?: {
  includeDeleted?: boolean;
}): Promise<ProductRow[]> {
  const includeDeleted = !!opts?.includeDeleted;
  const now = Date.now();
  if (!includeDeleted && customCache && now < customCacheUntil) {
    return customCache;
  }
  try {
    const rows = await db
      .select()
      .from(customProductsTable)
      .where(includeDeleted ? undefined : isNull(customProductsTable.deletedAt));
    const mapped = rows.map(customRowToProduct);
    if (!includeDeleted) {
      customCache = mapped;
      customCacheUntil = now + TTL_MS;
    }
    return mapped;
  } catch (err) {
    console.warn(
      "[productCatalog] failed to load custom_products:",
      (err as Error).message,
    );
    return [];
  }
}

export function invalidateCustomProducts(): void {
  customCache = null;
  customCacheUntil = 0;
}

/**
 * Storefront/admin merged catalog: JSON catalog UNION live custom
 * products. JSON rows still have their bucket flags; custom rows do
 * not (admins can flag-via-override later if needed).
 */
export async function getMergedProducts(opts?: {
  includeDeleted?: boolean;
}): Promise<ProductRow[]> {
  const json = getJsonCatalog();
  const custom = await getCustomProducts(opts);
  return [...json, ...custom];
}

export async function getMergedProductById(
  id: string,
  opts?: { includeDeleted?: boolean },
): Promise<ProductRow | null> {
  const includeDeleted = !!opts?.includeDeleted;
  if (id.startsWith("cust_")) {
    try {
      const [row] = await db
        .select()
        .from(customProductsTable)
        .where(eq(customProductsTable.id, id))
        .limit(1);
      if (!row) return null;
      // Soft-deleted custom products are invisible to all callers
      // unless the admin layer explicitly asks for them, mirroring the
      // override.deletedAt tombstoning of JSON-catalog products.
      if (!includeDeleted && row.deletedAt) return null;
      return customRowToProduct(row);
    } catch {
      return null;
    }
  }
  return getJsonCatalog().find((p) => p.id === id) ?? null;
}

/**
 * Apply a ProductOverride on top of a ProductRow. Returns a new row
 * with effective fields. Caller is responsible for filtering out rows
 * where the override is soft-deleted.
 */
export function applyOverride(
  product: ProductRow,
  ov: ProductOverride | undefined | null,
): ProductRow & {
  badge?: string | null;
  featured?: boolean;
  hidden?: boolean;
} {
  const out: ProductRow & {
    badge?: string | null;
    featured?: boolean;
    hidden?: boolean;
  } = { ...product };
  if (!ov) return out;
  if (ov.titleOverride) out.title = ov.titleOverride;
  if (ov.categoryOverride !== null && ov.categoryOverride !== undefined) {
    out.category = ov.categoryOverride;
  }
  if (ov.subCategoryOverride !== null && ov.subCategoryOverride !== undefined) {
    out.subCategory = ov.subCategoryOverride;
  }
  if (ov.priceOverride) {
    out.price = Number(ov.priceOverride).toFixed(2);
  }
  if (ov.imageUrlOverride) {
    out.imageUrls = [ov.imageUrlOverride, ...product.imageUrls.slice(1)];
  }
  if (Array.isArray(ov.sizesOverride) && ov.sizesOverride.length > 0) {
    out.sizes = ov.sizesOverride;
  }
  if (Array.isArray(ov.colorsOverride) && ov.colorsOverride.length > 0) {
    out.colors = ov.colorsOverride;
  }
  if (ov.genderOverride === "men" || ov.genderOverride === "women") {
    out.gender = ov.genderOverride;
  }
  if (ov.badge) out.badge = ov.badge;
  if (ov.featured) out.featured = true;
  if (ov.hidden) out.hidden = true;
  return out;
}
