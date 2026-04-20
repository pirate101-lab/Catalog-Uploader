import { Router, type IRouter, type Request, type Response } from "express";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  heroSlidesTable,
  ordersTable,
  productReviewSummaryTable,
  reviewsTable,
  wishlistSignalsTable,
} from "@workspace/db";
import { refreshProductReviewSummary } from "../lib/reviewSummary";
import {
  getAllProducts,
  getProductById,
  type BucketKey,
  type ProductRow,
} from "../lib/catalog";
import { getOverridesMap } from "../lib/overrides";
import { getSiteSettings } from "../lib/siteSettings";

const router: IRouter = Router();

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
  featuredOnly?: boolean;
  bucket?: BucketKey;
  dailyRotate?: boolean;
  seed?: string;
}

const VALID_BUCKETS: ReadonlySet<string> = new Set([
  "new_in",
  "collection",
  "tiktok_verified",
  "trending",
]);

// Mulberry32 — small, fast, deterministic PRNG. Seeded from the daily
// date string so the homepage's "TikTok featured" grid stays consistent
// for every visitor on a given day, then rotates at midnight UTC.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedFromString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// Fisher–Yates shuffle using the seeded PRNG. Returns a NEW array;
// the caller's input is untouched so the cached catalog isn't mutated.
function seededShuffle<T>(rows: readonly T[], seed: string): T[] {
  const out = rows.slice();
  const rand = mulberry32(seedFromString(seed));
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = out[i]!;
    out[i] = out[j]!;
    out[j] = tmp;
  }
  return out;
}

interface DecoratedRow extends ProductRow {
  badge?: string | null;
  featured?: boolean;
}

async function decorate(rows: ProductRow[]): Promise<DecoratedRow[]> {
  const overrides = await getOverridesMap();
  const out: DecoratedRow[] = [];
  for (const r of rows) {
    const ov = overrides.get(r.id);
    if (ov?.hidden) continue;
    const next: DecoratedRow = { ...r };
    if (ov?.priceOverride) {
      next.price = Number(ov.priceOverride).toFixed(2);
    }
    if (ov?.badge) next.badge = ov.badge;
    if (ov?.featured) next.featured = true;
    out.push(next);
  }
  return out;
}

function searchAndSort(rows: DecoratedRow[], f: SearchFilters): DecoratedRow[] {
  let result = rows;
  if (f.gender) result = result.filter((p) => p.gender === f.gender);
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
    result = result.filter((p) =>
      (p.sizes ?? []).some((s) => wanted.has(String(s).toUpperCase())),
    );
  }
  if (typeof f.priceMin === "number") {
    const min = f.priceMin;
    result = result.filter((p) => Number(p.price) >= min);
  }
  if (typeof f.priceMax === "number") {
    const max = f.priceMax;
    result = result.filter((p) => Number(p.price) <= max);
  }
  if (f.featuredOnly) result = result.filter((p) => p.featured);
  if (f.bucket) {
    const bk = f.bucket;
    result = result.filter((p) => p.buckets.includes(bk));
  }
  // Daily rotate intentionally short-circuits the sort: the shuffle IS
  // the order, otherwise the rotated lineup would just be re-sorted
  // back into a stable shape. The seed is required: the homepage always
  // passes today's YYYY-MM-DD so every visitor sees the same grid until
  // midnight UTC. Callers that need a deterministic sort instead of a
  // rotation should simply omit `dailyRotate`.
  if (f.dailyRotate && f.seed) {
    return seededShuffle(result, f.seed);
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
    case "featured":
      // Featured items first, then keep original order
      result = [...result].sort((a, b) => {
        const af = a.featured ? 1 : 0;
        const bf = b.featured ? 1 : 0;
        return bf - af;
      });
      break;
  }
  return result;
}

router.get("/storefront/settings", async (_req: Request, res: Response) => {
  const s = await getSiteSettings();
  res.json({
    id: s.id,
    storeName: s.storeName,
    tagline: s.tagline,
    announcementText: s.announcementText,
    announcementActive: s.announcementActive,
    defaultSort: s.defaultSort,
    freeShippingThresholdCents: s.freeShippingThresholdCents,
    currency: "USD",
    currencySymbol: s.currencySymbol,
    maintenanceMode: s.maintenanceMode,
    heroAutoAdvance: s.heroAutoAdvance,
    stripePublishableKey: null,
    paymentsConfigured: false,
  });
});

const FALLBACK_HERO = [
  {
    id: 1,
    title: "New Season Edit",
    subtitle: "Discover this week's standout pieces",
    kicker: null,
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
    kicker: null,
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
    kicker: null,
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
    kicker: null,
    ctaLabel: "Browse All",
    ctaHref: "/shop",
    imageUrl: "/hero-4-moda.jpg",
    sortOrder: 4,
    active: true,
  },
];

router.get("/storefront/hero", async (_req: Request, res: Response) => {
  const rows = await db
    .select()
    .from(heroSlidesTable)
    .where(eq(heroSlidesTable.active, true))
    .orderBy(asc(heroSlidesTable.sortOrder), asc(heroSlidesTable.id));
  if (rows.length === 0) {
    res.json(FALLBACK_HERO);
    return;
  }
  res.json(rows);
});

router.get("/storefront/categories", async (req: Request, res: Response) => {
  const gender = parseGender(req.query["gender"]);
  const decorated = await decorate(getAllProducts());
  const rows = decorated.filter((r) => (gender ? r.gender === gender : true));
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

router.get("/storefront/stats", async (_req: Request, res: Response) => {
  const decorated = await decorate(getAllProducts());
  const byGender = { women: 0, men: 0 };
  for (const p of decorated) byGender[p.gender]++;
  res.json({ products: decorated.length, women: byGender.women, men: byGender.men });
});

function parseNumber(v: unknown): number | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

router.get("/storefront/products", async (req: Request, res: Response) => {
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
  const featuredOnly = req.query["featured"] === "true";
  const bucketRaw = (req.query["bucket"] as string | undefined)?.trim();
  const bucket =
    bucketRaw && VALID_BUCKETS.has(bucketRaw)
      ? (bucketRaw as BucketKey)
      : undefined;
  const dailyRotate = req.query["dailyRotate"] === "true";
  const seedRaw = (req.query["seed"] as string | undefined)?.trim();
  // Bound the seed to a small alnum/dash slug so a hostile client can't
  // pin the cache key with arbitrary garbage (each unique seed forces
  // a fresh shuffle). YYYY-MM-DD is the expected shape.
  const seed =
    seedRaw && /^[A-Za-z0-9_-]{1,32}$/.test(seedRaw) ? seedRaw : undefined;

  const decorated = await decorate(getAllProducts());

  if (idsParam) {
    const ids = new Set(
      idsParam.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 200),
    );
    const rows = decorated.filter(
      (p) => ids.has(p.id) && (gender ? p.gender === gender : true),
    );
    res.json({ rows, total: rows.length, limit: rows.length, offset: 0 });
    return;
  }

  const filtered = searchAndSort(decorated, {
    q,
    category,
    gender,
    sort,
    sizes,
    priceMin,
    priceMax,
    featuredOnly,
    bucket,
    dailyRotate,
    seed,
  });
  const rows = filtered.slice(offset, offset + limit);
  res.json({ rows, total: filtered.length, limit, offset });
});

router.post(
  "/storefront/wishlist-signal",
  async (req: Request, res: Response) => {
    const productId =
      typeof req.body?.productId === "string" ? req.body.productId : null;
    if (!productId) {
      res.status(400).json({ error: "productId is required" });
      return;
    }
    // Prefer the authenticated user's email (server-trusted) so wishlist
    // signals can be attributed to a customer in the admin Customers view.
    // Fall back to a body-supplied email only when not authenticated.
    const sessionEmail =
      req.isAuthenticated() && typeof req.user?.email === "string"
        ? req.user.email.toLowerCase()
        : null;
    const bodyEmail =
      typeof req.body?.email === "string" && req.body.email.includes("@")
        ? req.body.email.toLowerCase()
        : null;
    const email = sessionEmail ?? bodyEmail;
    const sessionId =
      typeof req.body?.sessionId === "string"
        ? req.body.sessionId.slice(0, 64)
        : null;
    await db.insert(wishlistSignalsTable).values({
      productId,
      email,
      sessionId,
    });
    res.status(201).json({ ok: true });
  },
);

// ── Reviews ────────────────────────────────────────────────────────────
// Only fully-completed orders qualify as buyer-verified. The orders
// lifecycle (`new | packed | shipped | delivered | cancelled`, see
// `routes/admin.ts`) treats `delivered` as the terminal completed state,
// so that's the single status accepted here.
const COMPLETED_ORDER_STATUSES = new Set(["delivered"]);

interface OrderItemShape {
  productId?: string;
}

// Returns the id of the qualifying completed order containing the
// product, or null if none exists. The order id is persisted on the
// review row as a buyer-verification audit link.
async function findQualifyingOrderId(
  email: string,
  productId: string,
): Promise<string | null> {
  // `orders.email` is normalised at write time in `routes/checkout.ts`.
  // Lowercasing the lookup defends against any legacy rows that pre-date
  // that normalisation.
  const normalised = email.trim().toLowerCase();
  const rows = await db
    .select({
      id: ordersTable.id,
      items: ordersTable.items,
      status: ordersTable.status,
      createdAt: ordersTable.createdAt,
    })
    .from(ordersTable)
    .where(sql`lower(${ordersTable.email}) = ${normalised}`)
    .orderBy(desc(ordersTable.createdAt));
  for (const r of rows) {
    if (!COMPLETED_ORDER_STATUSES.has(r.status)) continue;
    const items = (Array.isArray(r.items) ? r.items : []) as OrderItemShape[];
    if (items.some((it) => it && it.productId === productId)) return r.id;
  }
  return null;
}

const reviewSubmissionSchema = z.object({
  name: z.string().trim().min(1, "Please enter your name.").max(80),
  rating: z
    .number()
    .int("Rating must be a whole number.")
    .min(1, "Rating must be between 1 and 5.")
    .max(5, "Rating must be between 1 and 5."),
  title: z.string().trim().max(120).optional().nullable(),
  body: z
    .string()
    .trim()
    .min(4, "Review must be at least 4 characters.")
    .max(4000, "Review must be 4000 characters or fewer."),
});

router.get(
  "/storefront/products/:id/reviews",
  async (req: Request, res: Response) => {
    const idParam = req.params["id"];
    const productId = Array.isArray(idParam) ? idParam[0] : idParam;
    if (!productId) {
      res.status(400).json({ error: "Missing product id" });
      return;
    }
    // Tolerate malformed query strings: anything non-integer falls back to defaults.
    const parseInt = (v: unknown, fallback: number): number => {
      const n = Number(v);
      return Number.isFinite(n) ? Math.trunc(n) : fallback;
    };
    const limit = Math.min(Math.max(parseInt(req.query["limit"], 20), 1), 100);
    const offset = Math.max(parseInt(req.query["offset"], 0), 0);

    const rows = await db
      .select({
        id: reviewsTable.id,
        name: reviewsTable.name,
        rating: reviewsTable.rating,
        title: reviewsTable.title,
        body: reviewsTable.body,
        verifiedPurchase: reviewsTable.verifiedPurchase,
        createdAt: reviewsTable.createdAt,
      })
      .from(reviewsTable)
      .where(eq(reviewsTable.productId, productId))
      .orderBy(desc(reviewsTable.createdAt))
      .limit(limit)
      .offset(offset);

    // Read the cached aggregate written by `refreshProductReviewSummary`
    // on every insert. Falls back to zero when no review has ever been
    // recorded for the product (no summary row exists).
    const summary = await db
      .select({
        count: productReviewSummaryTable.count,
        average: productReviewSummaryTable.average,
      })
      .from(productReviewSummaryTable)
      .where(eq(productReviewSummaryTable.productId, productId))
      .limit(1);

    const summaryRow = summary[0];
    const count = summaryRow?.count ?? 0;
    const average = summaryRow ? Number(summaryRow.average) : 0;
    res.json({
      reviews: rows.map((r: (typeof rows)[number]) => ({
        id: r.id,
        name: r.name,
        rating: r.rating,
        title: r.title,
        body: r.body,
        verifiedPurchase: r.verifiedPurchase,
        createdAt: r.createdAt.toISOString(),
      })),
      count,
      average: Math.round(average * 10) / 10,
    });
  },
);

router.get(
  "/storefront/products/:id/reviews/eligibility",
  async (req: Request, res: Response) => {
    const idParam = req.params["id"];
    const productId = Array.isArray(idParam) ? idParam[0] : idParam;
    if (!productId) {
      res.status(400).json({ error: "Missing product id" });
      return;
    }
    if (!req.isAuthenticated()) {
      res.json({ canReview: false, reason: "not_authenticated" });
      return;
    }
    const email = req.user.email;
    if (!email) {
      res.json({ canReview: false, reason: "no_email" });
      return;
    }
    // Has the user already left a review for this product?
    const existing = await db
      .select({ id: reviewsTable.id })
      .from(reviewsTable)
      .where(
        and(
          eq(reviewsTable.productId, productId),
          eq(reviewsTable.userId, req.user.id),
        ),
      )
      .limit(1);
    if (existing.length > 0) {
      res.json({ canReview: false, reason: "already_reviewed" });
      return;
    }
    const orderId = await findQualifyingOrderId(email, productId);
    if (!orderId) {
      res.json({ canReview: false, reason: "not_a_buyer" });
      return;
    }
    res.json({
      canReview: true,
      defaultName:
        req.user.firstName ??
        (email.includes("@") ? email.split("@")[0] : null),
    });
  },
);

router.post(
  "/storefront/products/:id/reviews",
  async (req: Request, res: Response) => {
    const idParam = req.params["id"];
    const productId = Array.isArray(idParam) ? idParam[0] : idParam;
    if (!productId) {
      res.status(400).json({ error: "Missing product id" });
      return;
    }
    if (!req.isAuthenticated()) {
      res
        .status(401)
        .json({ error: "Please sign in to leave a review for this product." });
      return;
    }
    const email = req.user.email;
    if (!email) {
      res.status(401).json({ error: "Your account needs an email address before you can leave a review." });
      return;
    }

    const parsed = reviewSubmissionSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      res.status(400).json({
        error: first?.message ?? "Invalid review submission.",
        issues: parsed.error.issues,
      });
      return;
    }
    const {
      name,
      rating,
      body: reviewBody,
      title: rawTitle,
    } = parsed.data;
    const title = rawTitle && rawTitle.length > 0 ? rawTitle : null;

    const orderId = await findQualifyingOrderId(email, productId);
    if (!orderId) {
      res.status(403).json({
        error:
          "Only verified buyers can review this item. Once your order is delivered you'll be able to leave a review.",
      });
      return;
    }

    // One review per user per product.
    const existing = await db
      .select({ id: reviewsTable.id })
      .from(reviewsTable)
      .where(
        and(
          eq(reviewsTable.productId, productId),
          eq(reviewsTable.userId, req.user.id),
        ),
      )
      .limit(1);
    if (existing.length > 0) {
      res.status(409).json({ error: "You've already reviewed this product." });
      return;
    }

    try {
      await db.insert(reviewsTable).values({
        productId,
        userId: req.user.id,
        orderId,
        email: email.toLowerCase(),
        name,
        rating,
        title,
        body: reviewBody,
        verifiedPurchase: true,
        seeded: false,
      });
      await refreshProductReviewSummary(productId);
    } catch (err) {
      // Race against the soft check above — partial unique index on
      // (product_id, user_id) WHERE user_id IS NOT NULL.
      if ((err as { code?: string }).code === "23505") {
        res.status(409).json({ error: "You've already reviewed this product." });
        return;
      }
      throw err;
    }
    res.status(201).json({ ok: true, status: "published" });
  },
);

router.get("/storefront/products/:id", async (req: Request, res: Response) => {
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
  const overrides = await getOverridesMap();
  const ov = overrides.get(row.id);
  if (ov?.hidden) {
    res.status(404).json({ error: "Product not found" });
    return;
  }
  const out: DecoratedRow = { ...row };
  if (ov?.priceOverride) out.price = Number(ov.priceOverride).toFixed(2);
  if (ov?.badge) out.badge = ov.badge;
  if (ov?.featured) out.featured = true;
  res.json(out);
});

export default router;
