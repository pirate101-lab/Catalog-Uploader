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
} from "@workspace/db";
import { requireAdmin } from "../middlewares/adminGuard";
import { invalidateOverrides } from "../lib/overrides";
import { invalidateSiteSettings, getSiteSettings } from "../lib/siteSettings";
import { getAllProducts } from "../lib/catalog";

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
        },
      });
  }
  invalidateOverrides();
  res.json({ updated: ids.length });
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
  const [row] = await db
    .update(ordersTable)
    .set({ status })
    .where(eq(ordersTable.id, id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(row);
});

/* ---------------- Customers (aggregated from orders) ---------------- */

router.get("/admin/customers", async (_req, res) => {
  const rows = await db
    .select({
      email: ordersTable.email,
      name: sql<string | null>`MAX(${ordersTable.customerName})`,
      orderCount: sql<number>`COUNT(*)::int`,
      totalSpentCents: sql<number>`COALESCE(SUM(${ordersTable.totalCents}), 0)::bigint`,
      lastOrderAt: sql<Date>`MAX(${ordersTable.createdAt})`,
    })
    .from(ordersTable)
    .groupBy(ordersTable.email)
    .orderBy(desc(sql`MAX(${ordersTable.createdAt})`));
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

  res.json({
    products: allProducts.length,
    ordersToday: Number(todayAgg?.count ?? 0),
    ordersWeek: Number(weekAgg?.count ?? 0),
    revenueTodayCents: Number(todayAgg?.revenue ?? 0),
    revenueWeekCents: Number(weekAgg?.revenue ?? 0),
    topCategories,
    recentOrders,
  });
});

export default router;
