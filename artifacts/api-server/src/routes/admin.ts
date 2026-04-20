import {
  Router,
  type IRouter,
  type Request,
  type Response,
} from "express";
import { eq, sql, desc, asc, and, gte } from "drizzle-orm";
import {
  db,
  heroSlidesTable,
  productOverridesTable,
  ordersTable,
  siteSettingsTable,
  wishlistSignalsTable,
} from "@workspace/db";
import { requireAdmin } from "../middlewares/adminGuard";
import { invalidateOverrides } from "../lib/overrides";
import { invalidateSiteSettings, getSiteSettings } from "../lib/siteSettings";
import { getAllProducts } from "../lib/catalog";
import { sendOrderStatusEmail } from "../lib/email";

const router: IRouter = Router();

router.use(requireAdmin);

/* ---------------- Hero Slides ---------------- */

router.get("/admin/hero-slides", async (_req: Request, res: Response) => {
  const rows = await db
    .select()
    .from(heroSlidesTable)
    .orderBy(asc(heroSlidesTable.sortOrder), asc(heroSlidesTable.id));
  res.json(rows);
});

router.post("/admin/hero-slides", async (req: Request, res: Response) => {
  const body = req.body ?? {};
  if (!body.title || !body.imageUrl) {
    res.status(400).json({ error: "title and imageUrl are required" });
    return;
  }
  const [maxRow] = await db
    .select({ max: sql<number>`COALESCE(MAX(${heroSlidesTable.sortOrder}), 0)` })
    .from(heroSlidesTable);
  const nextOrder = (maxRow?.max ?? 0) + 1;
  const [created] = await db
    .insert(heroSlidesTable)
    .values({
      title: body.title,
      subtitle: body.subtitle ?? null,
      kicker: body.kicker ?? null,
      ctaLabel: body.ctaLabel ?? null,
      ctaHref: body.ctaHref ?? null,
      imageUrl: body.imageUrl,
      sortOrder: typeof body.sortOrder === "number" ? body.sortOrder : nextOrder,
      active: body.active !== false,
    })
    .returning();
  res.status(201).json(created);
});

router.patch("/admin/hero-slides/:id", async (req: Request, res: Response) => {
  const id = Number(req.params["id"]);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const body = req.body ?? {};
  const patch: Record<string, unknown> = {};
  for (const k of [
    "title",
    "subtitle",
    "kicker",
    "ctaLabel",
    "ctaHref",
    "imageUrl",
    "sortOrder",
    "active",
  ]) {
    if (k in body) patch[k] = body[k];
  }
  if (Object.keys(patch).length === 0) {
    res.status(400).json({ error: "No fields to update" });
    return;
  }
  const [updated] = await db
    .update(heroSlidesTable)
    .set(patch)
    .where(eq(heroSlidesTable.id, id))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(updated);
});

router.delete("/admin/hero-slides/:id", async (req: Request, res: Response) => {
  const id = Number(req.params["id"]);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  await db.delete(heroSlidesTable).where(eq(heroSlidesTable.id, id));
  res.status(204).end();
});

router.post(
  "/admin/hero-slides/reorder",
  async (req: Request, res: Response) => {
    const order = req.body?.order;
    if (!Array.isArray(order)) {
      res.status(400).json({ error: "order must be an array of ids" });
      return;
    }
    for (let i = 0; i < order.length; i++) {
      const id = Number(order[i]);
      if (!Number.isFinite(id)) continue;
      await db
        .update(heroSlidesTable)
        .set({ sortOrder: i + 1 })
        .where(eq(heroSlidesTable.id, id));
    }
    res.json({ success: true });
  },
);

/* ---------------- Product Overrides ---------------- */

router.get("/admin/product-overrides", async (_req, res) => {
  const rows = await db.select().from(productOverridesTable);
  res.json(rows);
});

router.put(
  "/admin/product-overrides/:productId",
  async (req: Request, res: Response) => {
    const raw = req.params["productId"];
    const productId = Array.isArray(raw) ? raw[0] : raw;
    if (!productId) {
      res.status(400).json({ error: "Missing productId" });
      return;
    }
    const body = req.body ?? {};
    const values = {
      productId,
      featured: !!body.featured,
      hidden: !!body.hidden,
      priceOverride:
        body.priceOverride !== undefined && body.priceOverride !== null
          ? String(body.priceOverride)
          : null,
      badge: body.badge ?? null,
      stockLevel:
        body.stockLevel === undefined || body.stockLevel === null
          ? null
          : Number.isFinite(Number(body.stockLevel))
            ? Math.max(0, Math.floor(Number(body.stockLevel)))
            : null,
    };
    const [row] = await db
      .insert(productOverridesTable)
      .values(values)
      .onConflictDoUpdate({
        target: productOverridesTable.productId,
        set: {
          featured: values.featured,
          hidden: values.hidden,
          priceOverride: values.priceOverride,
          badge: values.badge,
          stockLevel: values.stockLevel,
        },
      })
      .returning();
    invalidateOverrides();
    res.json(row);
  },
);

router.delete(
  "/admin/product-overrides/:productId",
  async (req: Request, res: Response) => {
    const raw = req.params["productId"];
    const productId = Array.isArray(raw) ? raw[0] : raw;
    if (!productId) {
      res.status(400).json({ error: "Missing productId" });
      return;
    }
    await db
      .delete(productOverridesTable)
      .where(eq(productOverridesTable.productId, productId));
    invalidateOverrides();
    res.status(204).end();
  },
);

router.post("/admin/product-overrides/bulk", async (req, res) => {
  const ids: string[] = Array.isArray(req.body?.productIds)
    ? req.body.productIds
    : [];
  const patch = req.body?.patch ?? {};
  for (const id of ids) {
    const values = {
      productId: id,
      featured: !!patch.featured,
      hidden: !!patch.hidden,
      priceOverride:
        patch.priceOverride !== undefined && patch.priceOverride !== null
          ? String(patch.priceOverride)
          : null,
      badge: patch.badge ?? null,
      stockLevel:
        patch.stockLevel === undefined || patch.stockLevel === null
          ? null
          : Number.isFinite(Number(patch.stockLevel))
            ? Math.max(0, Math.floor(Number(patch.stockLevel)))
            : null,
    };
    await db
      .insert(productOverridesTable)
      .values(values)
      .onConflictDoUpdate({
        target: productOverridesTable.productId,
        set: {
          ...(("featured" in patch) && { featured: values.featured }),
          ...(("hidden" in patch) && { hidden: values.hidden }),
          ...(("priceOverride" in patch) && {
            priceOverride: values.priceOverride,
          }),
          ...(("badge" in patch) && { badge: values.badge }),
          ...(("stockLevel" in patch) && { stockLevel: values.stockLevel }),
        },
      });
  }
  invalidateOverrides();
  res.json({ updated: ids.length });
});

/* ---------------- Admin Products listing ----------------
 * Storefront /storefront/products intentionally hides products with
 * { hidden: true } overrides. The admin needs the full catalog so it
 * can unhide them again — this endpoint returns all products with their
 * effective override metadata merged in.
 */

router.get("/admin/products", async (req: Request, res: Response) => {
  const limit = Math.min(
    Number((req.query["limit"] as string) ?? 50) || 50,
    200,
  );
  const offset = Math.max(Number((req.query["offset"] as string) ?? 0) || 0, 0);
  const q = ((req.query["q"] as string) ?? "").trim().toLowerCase();
  const category = (req.query["category"] as string) ?? "";
  const showHiddenOnly = req.query["hiddenOnly"] === "1";
  const showFeaturedOnly = req.query["featuredOnly"] === "1";

  const all = await getAllProducts();
  const overrideRows = await db.select().from(productOverridesTable);
  const overridesById = new Map(overrideRows.map((o) => [o.productId, o]));

  let filtered = all;
  if (q) {
    filtered = filtered.filter(
      (p) =>
        p.title.toLowerCase().includes(q) ||
        p.id.toLowerCase().includes(q),
    );
  }
  if (category) {
    filtered = filtered.filter((p) => p.category === category);
  }
  if (showHiddenOnly) {
    filtered = filtered.filter((p) => overridesById.get(p.id)?.hidden);
  }
  if (showFeaturedOnly) {
    filtered = filtered.filter((p) => overridesById.get(p.id)?.featured);
  }

  const slice = filtered.slice(offset, offset + limit).map((p) => ({
    ...p,
    override: overridesById.get(p.id) ?? null,
  }));
  res.json({ rows: slice, total: filtered.length, limit, offset });
});

/* ---------------- Orders ---------------- */

const ORDER_STATUSES = [
  "new",
  "packed",
  "shipped",
  "delivered",
  "cancelled",
] as const;

router.get("/admin/orders", async (req: Request, res: Response) => {
  const status = req.query["status"] as string | undefined;
  const limit = Math.min(Number(req.query["limit"] ?? 100), 500);
  const offset = Math.max(Number(req.query["offset"] ?? 0), 0);
  const where = status && ORDER_STATUSES.includes(status as never)
    ? eq(ordersTable.status, status)
    : undefined;
  const rows = await db
    .select()
    .from(ordersTable)
    .where(where ?? sql`TRUE`)
    .orderBy(desc(ordersTable.createdAt))
    .limit(limit)
    .offset(offset);
  res.json({ rows, limit, offset });
});

router.get("/admin/orders/:id", async (req, res) => {
  const idRaw = req.params["id"];
  const id = Array.isArray(idRaw) ? idRaw[0] : idRaw;
  if (!id) {
    res.status(400).json({ error: "Missing id" });
    return;
  }
  const [row] = await db.select().from(ordersTable).where(eq(ordersTable.id, id));
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(row);
});

router.patch("/admin/orders/:id", async (req, res) => {
  const idRaw = req.params["id"];
  const id = Array.isArray(idRaw) ? idRaw[0] : idRaw;
  if (!id) {
    res.status(400).json({ error: "Missing id" });
    return;
  }
  const status = req.body?.status;
  if (!status || !ORDER_STATUSES.includes(status)) {
    res.status(400).json({ error: "Invalid status" });
    return;
  }
  const [existing] = await db
    .select()
    .from(ordersTable)
    .where(eq(ordersTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const [row] = await db
    .update(ordersTable)
    .set({ status })
    .where(eq(ordersTable.id, id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  if (
    existing.status !== row.status &&
    (row.status === "shipped" || row.status === "delivered")
  ) {
    // Fire-and-forget so a slow/failing email provider does not block the
    // admin UI. Errors are logged inside the helper.
    void sendOrderStatusEmail(row, row.status, req.log);
  }
  res.json(row);
});

/* ---------------- Customers (aggregated from orders) ---------------- */

router.get("/admin/customers", async (_req, res) => {
  // Best-effort customer list aggregating two signals:
  //   1. Submitted orders (authoritative spend + name)
  //   2. Wishlist signals tagged with an email (interest indicator)
  // Customers may appear from wishlist alone (orderCount 0) if they ever
  // wishlisted with an email but have not yet checked out.
  const orderRows = await db
    .select({
      email: ordersTable.email,
      name: sql<string | null>`MAX(${ordersTable.customerName})`,
      orderCount: sql<number>`COUNT(*)::int`,
      totalSpentCents: sql<number>`COALESCE(SUM(${ordersTable.totalCents}), 0)::bigint`,
      lastOrderAt: sql<Date>`MAX(${ordersTable.createdAt})`,
    })
    .from(ordersTable)
    .groupBy(ordersTable.email);

  const wishRows = await db
    .select({
      email: wishlistSignalsTable.email,
      wishlistCount: sql<number>`COUNT(*)::int`,
      lastWishlistAt: sql<Date>`MAX(${wishlistSignalsTable.createdAt})`,
    })
    .from(wishlistSignalsTable)
    .where(sql`${wishlistSignalsTable.email} IS NOT NULL`)
    .groupBy(wishlistSignalsTable.email);

  type Row = {
    email: string;
    name: string | null;
    orderCount: number;
    totalSpentCents: number;
    lastOrderAt: Date | null;
    wishlistCount: number;
    lastWishlistAt: Date | null;
  };
  const map = new Map<string, Row>();
  for (const r of orderRows) {
    map.set(r.email, {
      email: r.email,
      name: r.name,
      orderCount: r.orderCount,
      totalSpentCents: Number(r.totalSpentCents),
      lastOrderAt: r.lastOrderAt,
      wishlistCount: 0,
      lastWishlistAt: null,
    });
  }
  for (const w of wishRows) {
    if (!w.email) continue;
    const existing = map.get(w.email);
    if (existing) {
      existing.wishlistCount = w.wishlistCount;
      existing.lastWishlistAt = w.lastWishlistAt;
    } else {
      map.set(w.email, {
        email: w.email,
        name: null,
        orderCount: 0,
        totalSpentCents: 0,
        lastOrderAt: null,
        wishlistCount: w.wishlistCount,
        lastWishlistAt: w.lastWishlistAt,
      });
    }
  }
  const rows = [...map.values()].sort((a, b) => {
    const ta =
      Math.max(
        a.lastOrderAt ? a.lastOrderAt.getTime() : 0,
        a.lastWishlistAt ? a.lastWishlistAt.getTime() : 0,
      );
    const tb =
      Math.max(
        b.lastOrderAt ? b.lastOrderAt.getTime() : 0,
        b.lastWishlistAt ? b.lastWishlistAt.getTime() : 0,
      );
    return tb - ta;
  });
  res.json(rows);
});

/* ---------------- Settings ---------------- */

router.get("/admin/settings", async (_req, res) => {
  const settings = await getSiteSettings();
  res.json(settings);
});

router.put("/admin/settings", async (req, res) => {
  const body = req.body ?? {};
  const allowed = [
    "announcementText",
    "announcementActive",
    "defaultSort",
    "freeShippingThresholdCents",
    "currencySymbol",
    "maintenanceMode",
    "storeName",
    "tagline",
  ];
  const patch: Record<string, unknown> = {};
  for (const k of allowed) if (k in body) patch[k] = body[k];
  await db
    .insert(siteSettingsTable)
    .values({ id: 1, ...(patch as object) })
    .onConflictDoUpdate({
      target: siteSettingsTable.id,
      set: patch,
    });
  invalidateSiteSettings();
  const settings = await getSiteSettings();
  res.json(settings);
});

/* ---------------- Dashboard KPIs ---------------- */

router.get("/admin/stats", async (_req, res) => {
  const allProducts = getAllProducts();
  const now = new Date();
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const [todayAgg] = await db
    .select({
      count: sql<number>`COUNT(*)::int`,
      revenue: sql<number>`COALESCE(SUM(${ordersTable.totalCents}), 0)::bigint`,
    })
    .from(ordersTable)
    .where(
      and(
        gte(ordersTable.createdAt, startOfDay),
        sql`${ordersTable.status} <> 'cancelled'`,
      ),
    );

  const [weekAgg] = await db
    .select({
      count: sql<number>`COUNT(*)::int`,
      revenue: sql<number>`COALESCE(SUM(${ordersTable.totalCents}), 0)::bigint`,
    })
    .from(ordersTable)
    .where(
      and(
        gte(ordersTable.createdAt, sevenDaysAgo),
        sql`${ordersTable.status} <> 'cancelled'`,
      ),
    );

  const recentOrders = await db
    .select()
    .from(ordersTable)
    .orderBy(desc(ordersTable.createdAt))
    .limit(8);

  const categoryCounts = new Map<string, number>();
  for (const p of allProducts) {
    if (!p.category) continue;
    categoryCounts.set(p.category, (categoryCounts.get(p.category) ?? 0) + 1);
  }
  const topCategories = [...categoryCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([slug, count]) => ({ slug, count }));

  const lowStockOverrides = await db
    .select({
      productId: productOverridesTable.productId,
      stockLevel: productOverridesTable.stockLevel,
    })
    .from(productOverridesTable)
    .where(
      and(
        sql`${productOverridesTable.stockLevel} IS NOT NULL`,
        sql`${productOverridesTable.stockLevel} <= 5`,
      ),
    )
    .limit(10);

  const lowStockProducts = lowStockOverrides.map((o) => {
    const p = allProducts.find((x) => x.id === o.productId);
    return {
      productId: o.productId,
      title: p?.title ?? o.productId,
      stockLevel: o.stockLevel ?? 0,
    };
  });

  res.json({
    products: allProducts.length,
    ordersToday: Number(todayAgg?.count ?? 0),
    ordersWeek: Number(weekAgg?.count ?? 0),
    revenueTodayCents: Number(todayAgg?.revenue ?? 0),
    revenueWeekCents: Number(weekAgg?.revenue ?? 0),
    lowStockCount: lowStockProducts.length,
    lowStockProducts,
    topCategories,
    recentOrders,
  });
});

export default router;
