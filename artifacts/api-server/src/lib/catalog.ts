import { readFileSync, existsSync } from "node:fs";
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

export type Gender = "women" | "men";

export interface ProductRow {
  id: string;
  title: string;
  category: string | null;
  subCategory: string | null;
  price: string;
  imageUrls: string[];
  sizes: string[];
  colors: { name: string; hex: string; image?: string }[];
  gender: Gender;
}

const PUBLIC_BASE = (process.env["R2_PUBLIC_BASE_URL"] ?? "").replace(/\/+$/, "");
const KEY_PREFIX_BY_GENDER: Record<Gender, string> = {
  women: "catalog/replit_lite",
  men: "catalog/replit_lite_men",
};

function rewriteImageUrl(relPath: string, gender: Gender): string {
  const clean = relPath.replace(/^\/+/, "");
  if (clean.includes("..") || clean.includes("\\")) {
    return `/image-coming-soon.svg`;
  }
  if (!PUBLIC_BASE) {
    return `/image-coming-soon.svg`;
  }
  return `${PUBLIC_BASE}/${KEY_PREFIX_BY_GENDER[gender]}/${clean}`;
}

function loadOne(fileName: string, gender: Gender): ProductRow[] {
  // After esbuild bundling, __dirname === artifacts/api-server/dist, so the data dir is one level up.
  const dataPath = resolve(__dirname, "../data", fileName);
  if (!existsSync(dataPath)) return [];
  const raw = JSON.parse(readFileSync(dataPath, "utf-8")) as CatalogProductRaw[];
  // Namespace IDs by gender to avoid collisions between catalogs.
  return raw.map((p) => ({
    id: `${gender === "men" ? "m-" : ""}${p.id}`,
    title: p.title,
    category: p.category ?? null,
    subCategory: null,
    price: p.price.toFixed(2),
    imageUrls: p.image ? [rewriteImageUrl(p.image, gender)] : [],
    sizes: ["XS", "S", "M", "L", "XL"],
    colors: [],
    gender,
  }));
}

function loadCatalog(): ProductRow[] {
  const women = loadOne("catalog_lite.json", "women");
  const men = loadOne("catalog_men_lite.json", "men");
  // Default sort: gender → category → title (stable, readable when paginated).
  const all = [...women, ...men];
  all.sort((a, b) => {
    if (a.gender !== b.gender) return a.gender === "women" ? -1 : 1;
    const ca = a.category ?? "";
    const cb = b.category ?? "";
    if (ca !== cb) return ca.localeCompare(cb);
    return a.title.localeCompare(b.title);
  });
  return all;
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
