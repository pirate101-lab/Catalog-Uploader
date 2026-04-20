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

const IMAGE_BASE_PATH = "/api/storage/public-objects/catalog/replit_lite";

function rewriteImageUrl(relPath: string): string {
  const clean = relPath.replace(/^\/+/, "");
  return `${IMAGE_BASE_PATH}/${clean}`;
}

function loadCatalog(): ProductRow[] {
  const dataPath = resolve(__dirname, "../../data/catalog_lite.json");
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
