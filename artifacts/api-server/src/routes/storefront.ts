import { Router, type IRouter, type Request, type Response } from "express";
import { getAllProducts, getProductById, type ProductRow } from "../lib/catalog";

const router: IRouter = Router();

const HERO_BASE = "/api/storage/public-objects";

function parseGender(v: unknown): "men" | "women" | undefined {
  if (v === "men" || v === "women") return v;
  return undefined;
}

interface SearchFilters {
  q?: string;
  category?: string;
  gender?: "men" | "women";
  sort: string;
  sizes?: string[];
  priceMin?: number;
  priceMax?: number;
}

function searchAndSort(rows: ProductRow[], f: SearchFilters): ProductRow[] {
  let result = rows;
  if (f.gender) {
    result = result.filter((p) => p.gender === f.gender);
  }
  if (f.category && f.category !== "All") {
    const c = f.category.toLowerCase();
    result = result.filter((p) => (p.category ?? "").toLowerCase() === c);
  }
  if (f.q) {
    const needle = f.q.toLowerCase();
    result = result.filter((p) => p.title.toLowerCase().includes(needle));
  }
  if (f.sizes && f.sizes.length > 0) {
    const wanted = new Set(f.sizes.map((s) => s.toUpperCase()));
    result = result.filter((p) => {
      const sizes = (p.sizes ?? []) as string[];
      return sizes.some((s) => wanted.has(String(s).toUpperCase()));
    });
  }
  if (typeof f.priceMin === "number") {
    const min = f.priceMin;
    result = result.filter((p) => Number(p.price) >= min);
  }
  if (typeof f.priceMax === "number") {
    const max = f.priceMax;
    result = result.filter((p) => Number(p.price) <= max);
  }
  switch (f.sort) {
    case "price-asc":
      result = [...result].sort((a, b) => Number(a.price) - Number(b.price));
      break;
    case "price-desc":
      result = [...result].sort((a, b) => Number(b.price) - Number(a.price));
      break;
    case "name-asc":
      result = [...result].sort((a, b) => a.title.localeCompare(b.title));
      break;
  }
  return result;
}

router.get("/storefront/settings", (_req: Request, res: Response) => {
  res.json({
    id: 1,
    storeName: "VELOUR",
    tagline: "Women's Fashion Store",
    stripePublishableKey: null,
    paymentsConfigured: false,
  });
});

router.get("/storefront/hero", (_req: Request, res: Response) => {
  res.json([
    {
      id: 1,
      title: "New Season Edit",
      subtitle: "Discover this week's standout pieces",
      ctaLabel: "Shop New In",
      ctaHref: "/shop",
      imageUrl: "/hero-1-boutique.jpg",
      sortOrder: 1,
      active: true,
    },
    {
      id: 2,
      title: "Statement Outerwear",
      subtitle: "Coats, jackets and layering essentials",
      ctaLabel: "Explore",
      ctaHref: "/shop?category=outerwear",
      imageUrl: "/hero-2-display.jpg",
      sortOrder: 2,
      active: true,
    },
    {
      id: 3,
      title: "Vintage-Inspired Denim",
      subtitle: "From classic blue to washed silhouettes",
      ctaLabel: "Shop Denim",
      ctaHref: "/shop?category=denim",
      imageUrl: "/hero-3-vintage.jpg",
      sortOrder: 3,
      active: true,
    },
    {
      id: 4,
      title: "The Modern Wardrobe",
      subtitle: "Curated pieces for everyday luxury",
      ctaLabel: "Browse All",
      ctaHref: "/shop",
      imageUrl: "/hero-4-moda.jpg",
      sortOrder: 4,
      active: true,
    },
  ]);
});

router.get("/storefront/categories", (req: Request, res: Response) => {
  const gender = parseGender(req.query["gender"]);
  const rows = getAllProducts().filter((r) => (gender ? r.gender === gender : true));
  const counts = new Map<string, number>();
  for (const r of rows) {
    if (!r.category) continue;
    counts.set(r.category, (counts.get(r.category) ?? 0) + 1);
  }
  const list = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([slug, count], i) => ({
      id: i + 1,
      slug,
      label: slug.charAt(0).toUpperCase() + slug.slice(1).replace(/-/g, " "),
      productCount: count,
      sortOrder: i,
      active: true,
    }));
  res.json(list);
});

router.get("/storefront/stats", (_req: Request, res: Response) => {
  const all = getAllProducts();
  const byGender = { women: 0, men: 0 };
  for (const p of all) byGender[p.gender]++;
  res.json({ products: all.length, women: byGender.women, men: byGender.men });
});

function parseNumber(v: unknown): number | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

router.get("/storefront/products", (req: Request, res: Response) => {
  const q = (req.query["q"] as string | undefined)?.trim();
  const category = req.query["category"] as string | undefined;
  const gender = parseGender(req.query["gender"]);
  const idsParam = (req.query["ids"] as string | undefined)?.trim();
  const sort = (req.query["sort"] as string | undefined) ?? "featured";
  const limit = Math.min(Number(req.query["limit"] ?? 24), 100);
  const offset = Math.max(Number(req.query["offset"] ?? 0), 0);
  const sizesParam = (req.query["sizes"] as string | undefined)?.trim();
  const sizes = sizesParam
    ? sizesParam.split(",").map((s) => s.trim()).filter(Boolean)
    : undefined;
  const priceMin = parseNumber(req.query["priceMin"]);
  const priceMax = parseNumber(req.query["priceMax"]);

  const all = getAllProducts();

  if (idsParam) {
    const ids = new Set(
      idsParam.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 200),
    );
    const rows = all.filter(
      (p) => ids.has(p.id) && (gender ? p.gender === gender : true),
    );
    res.json({ rows, total: rows.length, limit: rows.length, offset: 0 });
    return;
  }

  const filtered = searchAndSort(all, {
    q,
    category,
    gender,
    sort,
    sizes,
    priceMin,
    priceMax,
  });
  const rows = filtered.slice(offset, offset + limit);
  res.json({ rows, total: filtered.length, limit, offset });
});

router.get("/storefront/products/:id", (req: Request, res: Response) => {
  const idParam = req.params["id"];
  const id = Array.isArray(idParam) ? idParam[0] : idParam;
  if (!id) {
    res.status(400).json({ error: "Missing id" });
    return;
  }
  const row = getProductById(id);
  if (!row) {
    res.status(404).json({ error: "Product not found" });
    return;
  }
  res.json(row);
});

void HERO_BASE;

export default router;
