import { Router, type IRouter, type Request, type Response } from "express";
import { getAllProducts, getProductById, type ProductRow } from "../lib/catalog";

const router: IRouter = Router();

const HERO_BASE = "/api/storage/public-objects";

function searchAndSort(
  rows: ProductRow[],
  q: string | undefined,
  category: string | undefined,
  sort: string,
): ProductRow[] {
  let result = rows;
  if (category && category !== "All") {
    const c = category.toLowerCase();
    result = result.filter((p) => (p.category ?? "").toLowerCase() === c);
  }
  if (q) {
    const needle = q.toLowerCase();
    result = result.filter((p) => p.title.toLowerCase().includes(needle));
  }
  switch (sort) {
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

router.get("/storefront/categories", (_req: Request, res: Response) => {
  const rows = getAllProducts();
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
  res.json({ products: getAllProducts().length });
});

router.get("/storefront/products", (req: Request, res: Response) => {
  const q = (req.query["q"] as string | undefined)?.trim();
  const category = req.query["category"] as string | undefined;
  const idsParam = (req.query["ids"] as string | undefined)?.trim();
  const sort = (req.query["sort"] as string | undefined) ?? "featured";
  const limit = Math.min(Number(req.query["limit"] ?? 24), 100);
  const offset = Math.max(Number(req.query["offset"] ?? 0), 0);

  const all = getAllProducts();

  if (idsParam) {
    const ids = new Set(
      idsParam.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 200),
    );
    const rows = all.filter((p) => ids.has(p.id));
    res.json({ rows, total: rows.length, limit: rows.length, offset: 0 });
    return;
  }

  const filtered = searchAndSort(all, q, category, sort);
  const rows = filtered.slice(offset, offset + limit);
  res.json({ rows, total: filtered.length, limit, offset });
});

router.get("/storefront/products/:id", (req: Request, res: Response) => {
  const row = getProductById(req.params["id"]);
  if (!row) {
    res.status(404).json({ error: "Product not found" });
    return;
  }
  res.json(row);
});

void HERO_BASE;

export default router;
