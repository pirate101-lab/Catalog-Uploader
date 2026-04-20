import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface CatalogProductRaw {
  id: string;
  title: string;
  price: number;
  category: string;
  image: string;
  source_image?: string;
}

export interface ProductRow {
  id: string;
  title: string;
  category: string | null;
  subCategory: string | null;
  price: string;
  imageUrls: string[];
  sizes: string[];
  colors: { name: string; hex: string; image?: string }[];
}

const PUBLIC_BASE = (process.env["R2_PUBLIC_BASE_URL"] ?? "").replace(/\/+$/, "");
const KEY_PREFIX = "catalog/replit_lite";

function rewriteImageUrl(relPath: string): string {
  const clean = relPath.replace(/^\/+/, "");
  // Defense in depth: refuse paths that could escape the catalog prefix.
  if (clean.includes("..") || clean.includes("\\")) {
    return `/image-coming-soon.svg`;
  }
  if (!PUBLIC_BASE) {
    // Fallback if env not set; serves a placeholder so the page still renders.
    return `/image-coming-soon.svg`;
  }
  // We emit the "base" .webp URL here; the frontend's imageUrl()/imageSrcSet()
  // helpers derive the per-width variants (`_400.webp` / `_800.webp` /
  // `_1600.webp`) that scripts/upload-r2.mjs actually uploads to R2.
  return `${PUBLIC_BASE}/${KEY_PREFIX}/${clean}`;
}

function loadCatalog(): ProductRow[] {
  // After esbuild bundling, __dirname === artifacts/api-server/dist, so the data dir is one level up.
  const dataPath = resolve(__dirname, "../data/catalog_lite.json");
  const raw = JSON.parse(readFileSync(dataPath, "utf-8")) as CatalogProductRaw[];
  return raw.map((p) => ({
    id: p.id,
    title: p.title,
    category: p.category ?? null,
    subCategory: null,
    price: p.price.toFixed(2),
    imageUrls: p.image ? [rewriteImageUrl(p.image)] : [],
    sizes: ["XS", "S", "M", "L", "XL"],
    colors: [],
  }));
}

let cache: ProductRow[] | null = null;

export function getAllProducts(): ProductRow[] {
  if (cache === null) {
    cache = loadCatalog();
  }
  return cache;
}

export function getProductById(id: string): ProductRow | null {
  return getAllProducts().find((p) => p.id === id) ?? null;
}
