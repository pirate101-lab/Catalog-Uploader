import {
  Router,
  type IRouter,
  type Request,
  type Response,
  raw as expressRaw,
} from "express";
import { ObjectStorageService, StorageNotConfiguredError } from "../lib/objectStorage.ts";
import { eq, sql, desc, asc, and, gte, lte, or, ilike, inArray } from "drizzle-orm";
import {
  db,
  heroSlidesTable,
  productOverridesTable,
  customProductsTable,
  ordersTable,
  orderEmailEventsTable,
  paymentEventsTable,
  reviewsTable,
  siteSettingsTable,
  wishlistSignalsTable,
  type PaymentEvent,
  type CustomProduct,
} from "@workspace/db";
import { randomUUID } from "node:crypto";
import { paymentEventBus } from "../lib/paymentEvents.ts";
import { getAdminRole, requireAdmin, requireSuperAdmin } from "../middlewares/adminGuard.ts";
import { invalidateOverrides } from "../lib/overrides.ts";
import {
  invalidateSiteSettings,
  getSiteSettings,
  isPaystackCurrency,
  symbolForCurrency,
  PAYSTACK_CURRENCIES,
} from "../lib/siteSettings.ts";
import { getAllProducts, previewShoesByPattern } from "../lib/catalog.ts";
import {
  awaitLastPersistence,
  listPersistedReclassifications,
} from "../lib/reclassificationPersistence.ts";
import {
  ensureRecategorisationRulesLoaded,
  invalidateRecategorisationRules,
  listAllRecategorisationRules,
} from "../lib/recategorisationRules.ts";
import {
  recategorisationRulesTable,
  reclassificationEventsTable,
} from "@workspace/db";
import {
  getMergedProducts,
  getMergedProductById,
  applyOverride,
  invalidateCustomProducts,
} from "../lib/productCatalog.ts";
import {
  getActivePaystackKeys,
  getCallbackUrl,
  getPublicOrigin,
  getWebhookUrl,
  isPaystackReady,
  maskSecret,
  probeSecretKey,
} from "../lib/paystack.ts";
import { buildResumeUrl } from "../lib/paystackResume.ts";
import {
  sendOrderStatusEmail,
  sendOrderConfirmationEmail,
  sendOrderEmailByKind,
  sendTestOrderEmail,
  verifySmtp,
  parseAlertMode,
  parseAlertRecipients,
  ORDER_EMAIL_KINDS,
  type OrderEmailKind,
} from "../lib/email.ts";
import { deleteReviewById } from "../lib/reviewSummary.ts";
import { refreshFxRate, FX_RATE_MIN, FX_RATE_MAX } from "../lib/fx.ts";
import { checkQuota } from "../lib/rateLimit.ts";

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

// Allow-list of valid gender targets for hero slides. The DB also
// enforces this via a check constraint, but we validate here so the
// admin gets a clean 400 instead of a generic Postgres failure.
const HERO_GENDERS = new Set(["all", "men", "women"]);

function parseHeroGender(v: unknown): "all" | "men" | "women" | undefined {
  if (typeof v !== "string") return undefined;
  return HERO_GENDERS.has(v) ? (v as "all" | "men" | "women") : undefined;
}

router.post("/admin/hero-slides", async (req: Request, res: Response) => {
  const body = req.body ?? {};
  if (!body.title || !body.imageUrl) {
    res.status(400).json({ error: "title and imageUrl are required" });
    return;
  }
  // Match PATCH semantics: reject explicit-but-invalid values rather
  // than silently coercing them, but keep "all" as the implicit default
  // when the field is omitted entirely.
  let gender: "all" | "men" | "women" = "all";
  if (body.gender !== undefined && body.gender !== null) {
    const parsed = parseHeroGender(body.gender);
    if (!parsed) {
      res.status(400).json({ error: "gender must be 'all', 'men', or 'women'" });
      return;
    }
    gender = parsed;
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
      gender,
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
  if ("gender" in body) {
    const g = parseHeroGender(body.gender);
    if (!g) {
      res.status(400).json({ error: "gender must be 'all', 'men', or 'women'" });
      return;
    }
    patch["gender"] = g;
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

function normalizeStringArray(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  const out = v
    .map((x) => (typeof x === "string" ? x.trim() : ""))
    .filter((x) => x.length > 0);
  return out.length > 0 ? out : null;
}

function normalizeColorsArray(
  v: unknown,
): { name: string; hex: string; image?: string }[] | null {
  if (!Array.isArray(v)) return null;
  const out: { name: string; hex: string; image?: string }[] = [];
  for (const item of v) {
    if (!item || typeof item !== "object") continue;
    const name = typeof (item as { name?: unknown }).name === "string"
      ? (item as { name: string }).name.trim()
      : "";
    const hex = typeof (item as { hex?: unknown }).hex === "string"
      ? (item as { hex: string }).hex.trim()
      : "";
    if (!name || !hex) continue;
    const image = typeof (item as { image?: unknown }).image === "string"
      ? (item as { image: string }).image.trim()
      : "";
    out.push(image ? { name, hex, image } : { name, hex });
  }
  return out.length > 0 ? out : null;
}

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
      categoryOverride:
        typeof body.categoryOverride === "string" && body.categoryOverride.trim()
          ? body.categoryOverride.trim()
          : null,
      subCategoryOverride:
        typeof body.subCategoryOverride === "string" &&
        body.subCategoryOverride.trim()
          ? body.subCategoryOverride.trim()
          : null,
      titleOverride:
        typeof body.titleOverride === "string" && body.titleOverride.trim()
          ? body.titleOverride.trim()
          : null,
      imageUrlOverride:
        typeof body.imageUrlOverride === "string" && body.imageUrlOverride.trim()
          ? body.imageUrlOverride.trim()
          : null,
      sizesOverride: normalizeStringArray(body.sizesOverride),
      colorsOverride: normalizeColorsArray(body.colorsOverride),
      genderOverride:
        body.genderOverride === "men" || body.genderOverride === "women"
          ? body.genderOverride
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
          categoryOverride: values.categoryOverride,
          subCategoryOverride: values.subCategoryOverride,
          titleOverride: values.titleOverride,
          imageUrlOverride: values.imageUrlOverride,
          sizesOverride: values.sizesOverride,
          colorsOverride: values.colorsOverride,
          genderOverride: values.genderOverride,
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

/* Bulk restore — used by the "Undo" action in the admin UI to revert
 * a bulk override to the prior state. For each entry, if `override` is
 * null, any existing override for that product is deleted (because the
 * product had no override before the bulk action); otherwise the row
 * is upserted with the supplied prior values.
 */
router.post("/admin/product-overrides/bulk-restore", async (req, res) => {
  const entries: Array<{
    productId: string;
    override: {
      featured?: boolean;
      hidden?: boolean;
      priceOverride?: string | null;
      badge?: string | null;
      stockLevel?: number | null;
    } | null;
  }> = Array.isArray(req.body?.entries) ? req.body.entries : [];
  let restored = 0;
  for (const entry of entries) {
    if (!entry?.productId) continue;
    if (entry.override === null) {
      await db
        .delete(productOverridesTable)
        .where(eq(productOverridesTable.productId, entry.productId));
      restored++;
      continue;
    }
    const ov = entry.override;
    const values = {
      productId: entry.productId,
      featured: !!ov.featured,
      hidden: !!ov.hidden,
      priceOverride:
        ov.priceOverride !== undefined && ov.priceOverride !== null
          ? String(ov.priceOverride)
          : null,
      badge: ov.badge ?? null,
      stockLevel:
        ov.stockLevel === undefined || ov.stockLevel === null
          ? null
          : Number.isFinite(Number(ov.stockLevel))
            ? Math.max(0, Math.floor(Number(ov.stockLevel)))
            : null,
    };
    await db
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
      });
    restored++;
  }
  invalidateOverrides();
  res.json({ restored });
});

/* ---------------- Admin Products listing ----------------
 * Storefront /storefront/products intentionally hides products with
 * { hidden: true } overrides. The admin needs the full catalog so it
 * can unhide them again — this endpoint returns all products with their
 * effective override metadata merged in.
 */

router.get("/admin/products", async (req: Request, res: Response) => {
  const limit = Math.min(
    Number((req.query["limit"] as string) ?? 500) || 500,
    2000,
  );
  const offset = Math.max(Number((req.query["offset"] as string) ?? 0) || 0, 0);
  const q = ((req.query["q"] as string) ?? "").trim().toLowerCase();
  const category = (req.query["category"] as string) ?? "";
  const showHiddenOnly = req.query["hiddenOnly"] === "1";
  const showFeaturedOnly = req.query["featuredOnly"] === "1";
  const includeDeleted = req.query["includeDeleted"] === "1";
  const deletedOnly = req.query["deletedOnly"] === "1";

  const all = await getMergedProducts({ includeDeleted: true });
  const overrideRows = await db.select().from(productOverridesTable);
  const overridesById = new Map(overrideRows.map((o) => [o.productId, o]));

  // Apply override fields so callers see the EFFECTIVE category/title
  // (this is what makes "recategorize" work end-to-end — the admin list
  // groups under the override category, not the JSON one).
  let decorated = all.map((p) => {
    const ov = overridesById.get(p.id) ?? null;
    return { ...applyOverride(p, ov), override: ov };
  });

  // Soft-delete handling. JSON catalog products are tombstoned via the
  // override table; custom products carry their own deleted_at column
  // (preserved on the merged row). Either source counts as deleted so
  // the admin "Show deleted" toggle and Restore action work uniformly.
  decorated = decorated.filter((p) => {
    const isDeleted = !!p.override?.deletedAt || !!p.deletedAt;
    if (deletedOnly) return isDeleted;
    if (!includeDeleted && isDeleted) return false;
    return true;
  });

  if (q) {
    decorated = decorated.filter(
      (p) =>
        p.title.toLowerCase().includes(q) ||
        p.id.toLowerCase().includes(q),
    );
  }
  if (category) {
    decorated = decorated.filter((p) => p.category === category);
  }
  if (showHiddenOnly) {
    decorated = decorated.filter((p) => p.hidden || p.override?.hidden);
  }
  if (showFeaturedOnly) {
    decorated = decorated.filter((p) => p.featured || p.override?.featured);
  }

  const slice = decorated.slice(offset, offset + limit);
  res.json({ rows: slice, total: decorated.length, limit, offset });
});

/* ---------------- Auto-recategorisation audit log ----------------
 * The boot-time `reclassifyMislabeledShoes` heuristic moves rows out
 * of the "shoes" bucket when the title contains an apparel keyword
 * (e.g. "Boot Graphic T-Shirt" → tops). This endpoint surfaces those
 * moves to the admin so staff can spot-check them and, if needed,
 * revert by setting a `categoryOverride: "shoes"` via the existing
 * bulk-category endpoint. Reverted rows are filtered out so the list
 * shows only moves that are still in effect on the live storefront.
 */
router.get("/admin/reclassifications", async (req, res) => {
  const limit = Math.min(
    Number((req.query["limit"] as string) ?? 200) || 200,
    1000,
  );
  // Force catalog initialization so the persistence callback runs at
  // least once after a cold boot — the DB query below is otherwise
  // empty on the very first hit until the storefront triggers a load.
  // Awaiting `lastPersistence` closes the cold-boot race between the
  // fire-and-forget upsert and our SELECT below.
  getAllProducts();
  await awaitLastPersistence();
  const records = await listPersistedReclassifications();
  const overrideRows = await db
    .select({
      productId: productOverridesTable.productId,
      categoryOverride: productOverridesTable.categoryOverride,
    })
    .from(productOverridesTable);
  const overrideById = new Map(
    overrideRows.map((o) => [o.productId, o.categoryOverride]),
  );
  // Fetch the live rule set so we can flag rows whose responsible rule
  // has been disabled or deleted — staff need that highlighted before
  // they decide whether to revert each move.
  const ruleRows = await db
    .select({
      id: recategorisationRulesTable.id,
      label: recategorisationRulesTable.label,
      enabled: recategorisationRulesTable.enabled,
    })
    .from(recategorisationRulesTable);
  const ruleById = new Map(ruleRows.map((r) => [r.id, r]));
  const decorated = records.map((r) => {
    const ov = overrideById.get(r.productId) ?? null;
    const liveRule = r.ruleId !== null ? ruleById.get(r.ruleId) ?? null : null;
    // "deleted"  → we have a ruleId but the rule no longer exists
    // "disabled" → rule exists but is turned off
    // "active"   → rule exists and is enabled (the normal case)
    // "unknown"  → row was captured by the bootstrap NON_SHOE_HINTS
    //              fallback (no ruleId), so there's nothing to attribute
    let ruleStatus: "active" | "disabled" | "deleted" | "unknown";
    if (r.ruleId === null) ruleStatus = "unknown";
    else if (!liveRule) ruleStatus = "deleted";
    else if (!liveRule.enabled) ruleStatus = "disabled";
    else ruleStatus = "active";
    return {
      // Mirror the previous in-memory shape so the admin UI doesn't
      // need to change: `id` (== productId) + observedAt as ISO.
      id: r.productId,
      title: r.title,
      gender: r.gender,
      originalCategory: r.originalCategory,
      newCategory: r.newCategory,
      matchedHint: r.matchedHint,
      ruleId: r.ruleId,
      // Prefer the live label so a renamed rule shows the current name;
      // fall back to the snapshot stored on the row when the rule was
      // deleted (so the admin can still tell which rule moved this row).
      ruleLabel: liveRule?.label ?? r.ruleLabel,
      ruleStatus,
      observedAt: r.observedAt.toISOString(),
      lastObservedAt: r.lastObservedAt.toISOString(),
      currentCategoryOverride: ov,
      reverted: ov === r.originalCategory,
    };
  });
  const visible = decorated.filter((r) => !r.reverted);
  res.json({
    rows: visible.slice(0, limit),
    total: visible.length,
    totalEverMoved: records.length,
  });
});

/* ---------------- Recategorisation rules CRUD ----------------
 * Editable copy of what used to be the hard-coded `NON_SHOE_HINTS`
 * list in catalog.ts. Each rule has a label, a regex pattern (compiled
 * case-insensitively), a target category, and an enabled flag. Adding,
 * editing, disabling, or deleting a rule clears the in-process rule
 * cache + the catalog cache so the very next product fetch re-runs
 * `reclassifyMislabeledShoes` against the new rule set — no restart
 * needed.
 */
router.get("/admin/recategorisation-rules", async (_req, res) => {
  // Make sure the table is seeded with defaults the very first time
  // this endpoint is hit (covers fresh databases where the boot-time
  // loader hasn't run yet, e.g. inside an integration test harness).
  await ensureRecategorisationRulesLoaded().catch(() => {
    /* swallow — listAll will still return [] on a hard DB failure */
  });
  const rows = await listAllRecategorisationRules();

  // Attach a per-rule "pendingRevertCount" so the admin UI can offer a
  // "Revert all N moves" button next to each disabled rule without an
  // extra round-trip per row. The count mirrors the dry-run logic in
  // /admin/reclassifications/revert-by-rule (records whose current
  // category override doesn't match the originalCategory captured at
  // move time), so the badge on the rule row equals the count shown in
  // the bulk-revert confirmation dialog.
  const events = await db
    .select({
      productId: reclassificationEventsTable.productId,
      originalCategory: reclassificationEventsTable.originalCategory,
      ruleId: reclassificationEventsTable.ruleId,
    })
    .from(reclassificationEventsTable);
  const candidateIds = Array.from(
    new Set(events.map((e) => e.productId).filter((id) => id.length > 0)),
  );
  const overrideRows =
    candidateIds.length > 0
      ? await db
          .select({
            productId: productOverridesTable.productId,
            categoryOverride: productOverridesTable.categoryOverride,
          })
          .from(productOverridesTable)
          .where(inArray(productOverridesTable.productId, candidateIds))
      : [];
  const overrideById = new Map(
    overrideRows.map((o) => [o.productId, o.categoryOverride]),
  );
  const pendingByRule = new Map<number, number>();
  for (const e of events) {
    if (e.ruleId === null) continue;
    if (overrideById.get(e.productId) === e.originalCategory) continue;
    pendingByRule.set(e.ruleId, (pendingByRule.get(e.ruleId) ?? 0) + 1);
  }

  res.json(
    rows.map((r) => ({
      ...r,
      pendingRevertCount: pendingByRule.get(r.id) ?? 0,
    })),
  );
});

interface RuleInput {
  label?: unknown;
  pattern?: unknown;
  targetCategory?: unknown;
  enabled?: unknown;
  sortOrder?: unknown;
}

function parseRuleBody(
  body: RuleInput,
  partial: boolean,
):
  | { ok: true; values: Partial<typeof recategorisationRulesTable.$inferInsert> }
  | { ok: false; error: string } {
  const out: Partial<typeof recategorisationRulesTable.$inferInsert> = {};
  if (body.label !== undefined) {
    if (typeof body.label !== "string" || !body.label.trim()) {
      return { ok: false, error: "label must be a non-empty string" };
    }
    out.label = body.label.trim();
  } else if (!partial) {
    return { ok: false, error: "label is required" };
  }
  if (body.pattern !== undefined) {
    if (typeof body.pattern !== "string" || !body.pattern.trim()) {
      return { ok: false, error: "pattern must be a non-empty string" };
    }
    // Validate the regex up-front so the admin gets a clean 400 instead
    // of silently saving a rule that the catalog loader will skip.
    try {
      new RegExp(body.pattern, "i");
    } catch (e) {
      return { ok: false, error: `pattern is not a valid regex: ${(e as Error).message}` };
    }
    out.pattern = body.pattern;
  } else if (!partial) {
    return { ok: false, error: "pattern is required" };
  }
  if (body.targetCategory !== undefined) {
    if (typeof body.targetCategory !== "string" || !body.targetCategory.trim()) {
      return { ok: false, error: "targetCategory must be a non-empty string" };
    }
    out.targetCategory = body.targetCategory.trim();
  } else if (!partial) {
    return { ok: false, error: "targetCategory is required" };
  }
  if (body.enabled !== undefined) {
    // Strict boolean check — string payloads like "false" should not
    // silently coerce to true via `!!`. Reject anything that isn't a
    // literal boolean so the admin can't accidentally mass-enable rules.
    if (typeof body.enabled !== "boolean") {
      return { ok: false, error: "enabled must be a boolean" };
    }
    out.enabled = body.enabled;
  }
  if (body.sortOrder !== undefined) {
    const n = Number(body.sortOrder);
    if (!Number.isFinite(n)) {
      return { ok: false, error: "sortOrder must be a number" };
    }
    out.sortOrder = Math.floor(n);
  }
  return { ok: true, values: out };
}

router.post("/admin/recategorisation-rules", async (req, res) => {
  const parsed = parseRuleBody((req.body ?? {}) as RuleInput, false);
  if (!parsed.ok) {
    res.status(400).json({ error: parsed.error });
    return;
  }
  // Default sortOrder to "after the current max" so new rules append
  // to the end of the list rather than colliding with sortOrder=0.
  if (parsed.values.sortOrder === undefined) {
    const [maxRow] = await db
      .select({
        max: sql<number>`COALESCE(MAX(${recategorisationRulesTable.sortOrder}), -1)`,
      })
      .from(recategorisationRulesTable);
    parsed.values.sortOrder = (maxRow?.max ?? -1) + 1;
  }
  const [created] = await db
    .insert(recategorisationRulesTable)
    .values(parsed.values as typeof recategorisationRulesTable.$inferInsert)
    .returning();
  invalidateRecategorisationRules();
  // Re-prime the cache so the very next /admin/products call picks up
  // the new rule without a cold-load penalty.
  await ensureRecategorisationRulesLoaded().catch(() => {
    /* non-fatal */
  });
  res.status(201).json(created);
});

router.patch("/admin/recategorisation-rules/:id", async (req, res) => {
  const id = Number(req.params["id"]);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const parsed = parseRuleBody((req.body ?? {}) as RuleInput, true);
  if (!parsed.ok) {
    res.status(400).json({ error: parsed.error });
    return;
  }
  if (Object.keys(parsed.values).length === 0) {
    res.status(400).json({ error: "No fields to update" });
    return;
  }
  const [updated] = await db
    .update(recategorisationRulesTable)
    .set(parsed.values)
    .where(eq(recategorisationRulesTable.id, id))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  invalidateRecategorisationRules();
  await ensureRecategorisationRulesLoaded().catch(() => {
    /* non-fatal */
  });
  res.json(updated);
});

router.delete("/admin/recategorisation-rules/:id", async (req, res) => {
  const id = Number(req.params["id"]);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  await db
    .delete(recategorisationRulesTable)
    .where(eq(recategorisationRulesTable.id, id));
  invalidateRecategorisationRules();
  await ensureRecategorisationRulesLoaded().catch(() => {
    /* non-fatal */
  });
  res.status(204).end();
});

/* ---------------- Bulk-revert moves attributed to a single rule ----------------
 * When an admin disables or deletes a rule, every product the rule
 * moved is still sitting in the new category. Reverting those moves
 * one-by-one (via the per-row Revert button on the audit log) is
 * tedious for rules that fired across dozens of products, so this
 * endpoint flips the override back to `originalCategory` for every
 * unreverted record attributed to the given ruleId in a single call.
 *
 * Guardrails:
 *  - Only allowed for rules that are currently disabled or deleted.
 *    Reverting moves from an active rule would just be undone on the
 *    next catalog reload, so refuse with 400.
 *  - `dryRun: true` returns the count + rule label without writing,
 *    so the UI can show a confirmation step before applying.
 *  - Custom (cust_-prefixed) products write to `customProductsTable`
 *    instead of the override row, mirroring the per-row revert path.
 *  - Idempotent: rows whose current category override already matches
 *    `originalCategory` are skipped, so double-clicking the button
 *    won't double-count or thrash the DB.
 */
router.post("/admin/reclassifications/revert-by-rule", async (req, res) => {
  const body = (req.body ?? {}) as {
    ruleId?: unknown;
    dryRun?: unknown;
  };
  const ruleIdNum = Number(body.ruleId);
  if (!Number.isFinite(ruleIdNum) || !Number.isInteger(ruleIdNum)) {
    res.status(400).json({ error: "ruleId must be an integer" });
    return;
  }
  const dryRun = body.dryRun === true;

  // Look up the live rule so we can refuse "active" rules and surface
  // a friendly label in the response. A missing row means the rule was
  // deleted — that's a valid case for this endpoint.
  const [liveRule] = await db
    .select({
      id: recategorisationRulesTable.id,
      label: recategorisationRulesTable.label,
      enabled: recategorisationRulesTable.enabled,
    })
    .from(recategorisationRulesTable)
    .where(eq(recategorisationRulesTable.id, ruleIdNum));
  let ruleStatus: "disabled" | "deleted";
  if (!liveRule) {
    ruleStatus = "deleted";
  } else if (!liveRule.enabled) {
    ruleStatus = "disabled";
  } else {
    res.status(400).json({
      error:
        "Refusing to bulk-revert moves from an enabled rule — disable or delete the rule first so the next catalog reload won't undo the revert.",
    });
    return;
  }

  // Pull every audit record attributed to this rule. We need the
  // original target category per row because rules can move products
  // out of multiple source categories (e.g. some hint variants live
  // outside the default "shoes" bucket), and we want to put each row
  // back where it came from.
  const records = await db
    .select({
      productId: reclassificationEventsTable.productId,
      originalCategory: reclassificationEventsTable.originalCategory,
    })
    .from(reclassificationEventsTable)
    .where(eq(reclassificationEventsTable.ruleId, ruleIdNum));

  // Filter out anything whose categoryOverride already matches the
  // original — those rows are already reverted. Reading overrides
  // for only the candidate ids keeps this proportional to the rule's
  // footprint rather than the whole overrides table.
  const candidateIds = records.map((r) => r.productId);
  const overrideRows =
    candidateIds.length > 0
      ? await db
          .select({
            productId: productOverridesTable.productId,
            categoryOverride: productOverridesTable.categoryOverride,
          })
          .from(productOverridesTable)
          .where(inArray(productOverridesTable.productId, candidateIds))
      : [];
  const overrideById = new Map(
    overrideRows.map((o) => [o.productId, o.categoryOverride]),
  );
  const pending = records.filter(
    (r) => overrideById.get(r.productId) !== r.originalCategory,
  );

  const ruleLabel = liveRule?.label ?? null;

  if (dryRun) {
    res.json({
      ruleId: ruleIdNum,
      ruleLabel,
      ruleStatus,
      count: pending.length,
    });
    return;
  }

  let custTouched = false;
  let ovTouched = false;
  for (const r of pending) {
    const id = r.productId;
    const target = r.originalCategory;
    if (id.startsWith("cust_")) {
      await db
        .update(customProductsTable)
        .set({ category: target })
        .where(eq(customProductsTable.id, id));
      custTouched = true;
    } else {
      await db
        .insert(productOverridesTable)
        .values({ productId: id, categoryOverride: target })
        .onConflictDoUpdate({
          target: productOverridesTable.productId,
          set: { categoryOverride: target },
        });
      ovTouched = true;
    }
  }
  if (custTouched) invalidateCustomProducts();
  if (ovTouched) invalidateOverrides();

  res.json({
    ruleId: ruleIdNum,
    ruleLabel,
    ruleStatus,
    reverted: pending.length,
  });
});

/* Dry-run a candidate rule against the live catalog without saving.
 * Returns the count + first 20 currently-shoes products whose titles
 * match the supplied regex, so staff can spot an overly broad pattern
 * (e.g. /b/ matching every other title) before it goes live. The
 * `targetCategory` field is accepted and echoed back so the UI can
 * label the preview, but it doesn't change which products are
 * surfaced — matching is purely on the pattern + the current
 * "shoes" filter, mirroring `reclassifyMislabeledShoes`.
 */
router.post("/admin/recategorisation-rules/preview", async (req, res) => {
  const body = (req.body ?? {}) as {
    pattern?: unknown;
    targetCategory?: unknown;
  };
  const pattern = typeof body.pattern === "string" ? body.pattern.trim() : "";
  if (!pattern) {
    res.status(400).json({ error: "pattern is required" });
    return;
  }
  const targetCategory =
    typeof body.targetCategory === "string" && body.targetCategory.trim()
      ? body.targetCategory.trim()
      : null;
  let preview;
  try {
    preview = previewShoesByPattern(pattern, 20);
  } catch (e) {
    res.status(400).json({
      error: `pattern is not a valid regex: ${(e as Error).message}`,
    });
    return;
  }
  res.json({
    pattern,
    targetCategory,
    total: preview.total,
    matches: preview.matches,
  });
});

/* ---------------- Catalog category list ----------------
 * Distinct effective categories (JSON + custom + applied overrides)
 * with counts. Powers the "move to category" picker in the admin
 * Products edit drawer.
 */
router.get("/admin/products/categories", async (_req, res) => {
  const all = await getMergedProducts({ includeDeleted: true });
  const overrideRows = await db.select().from(productOverridesTable);
  const overridesById = new Map(overrideRows.map((o) => [o.productId, o]));
  const counts = new Map<string, number>();
  for (const p of all) {
    const ov = overridesById.get(p.id);
    // Skip both override-tombstoned (JSON) and row-tombstoned (custom)
    // products so the category counts match what's actually live.
    if (ov?.deletedAt || p.deletedAt) continue;
    const eff = ov?.categoryOverride ?? p.category;
    if (!eff) continue;
    counts.set(eff, (counts.get(eff) ?? 0) + 1);
  }
  const list = [...counts.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([category, count]) => ({ category, count }));
  res.json(list);
});

/* ---------------- Catalog soft-delete & restore ----------------
 * Soft-delete works for both JSON-catalog rows (sets override.deletedAt)
 * and custom-product rows (sets custom_products.deletedAt). Restore is
 * the inverse. Both are 404-safe — the admin can call restore on a row
 * that was never deleted.
 */
router.post("/admin/products/:productId/delete", async (req, res) => {
  const raw = req.params["productId"];
  const productId = Array.isArray(raw) ? raw[0] : raw;
  if (!productId) {
    res.status(400).json({ error: "Missing productId" });
    return;
  }
  if (productId.startsWith("cust_")) {
    await db
      .update(customProductsTable)
      .set({ deletedAt: new Date() })
      .where(eq(customProductsTable.id, productId));
    invalidateCustomProducts();
  } else {
    await db
      .insert(productOverridesTable)
      .values({ productId, deletedAt: new Date() })
      .onConflictDoUpdate({
        target: productOverridesTable.productId,
        set: { deletedAt: new Date() },
      });
    invalidateOverrides();
  }
  res.json({ ok: true, productId });
});

router.post("/admin/products/:productId/restore", async (req, res) => {
  const raw = req.params["productId"];
  const productId = Array.isArray(raw) ? raw[0] : raw;
  if (!productId) {
    res.status(400).json({ error: "Missing productId" });
    return;
  }
  if (productId.startsWith("cust_")) {
    await db
      .update(customProductsTable)
      .set({ deletedAt: null })
      .where(eq(customProductsTable.id, productId));
    invalidateCustomProducts();
  } else {
    await db
      .update(productOverridesTable)
      .set({ deletedAt: null })
      .where(eq(productOverridesTable.productId, productId));
    invalidateOverrides();
  }
  res.json({ ok: true, productId });
});

/* ---------------- Bulk product actions ----------------
 * Powers the multi-select action bar in the admin product grid. Each
 * endpoint accepts `{ productIds: string[] }` and routes per-id to the
 * right table — `cust_*` ids edit custom_products in place, everything
 * else writes through product_overrides so the JSON catalog file stays
 * read-only. Cache invalidation is done once per call after the loop.
 */

function parseProductIds(body: unknown): string[] {
  const ids = Array.isArray((body as { productIds?: unknown })?.productIds)
    ? ((body as { productIds: unknown[] }).productIds as unknown[])
    : [];
  return ids
    .filter((x): x is string => typeof x === "string" && x.length > 0)
    .slice(0, 1000);
}

router.post("/admin/products/bulk-delete", async (req, res) => {
  const ids = parseProductIds(req.body);
  let custTouched = false;
  let ovTouched = false;
  const now = new Date();
  for (const id of ids) {
    if (id.startsWith("cust_")) {
      await db
        .update(customProductsTable)
        .set({ deletedAt: now })
        .where(eq(customProductsTable.id, id));
      custTouched = true;
    } else {
      await db
        .insert(productOverridesTable)
        .values({ productId: id, deletedAt: now })
        .onConflictDoUpdate({
          target: productOverridesTable.productId,
          set: { deletedAt: now },
        });
      ovTouched = true;
    }
  }
  if (custTouched) invalidateCustomProducts();
  if (ovTouched) invalidateOverrides();
  res.json({ updated: ids.length });
});

router.post("/admin/products/bulk-restore", async (req, res) => {
  const ids = parseProductIds(req.body);
  let custTouched = false;
  let ovTouched = false;
  for (const id of ids) {
    if (id.startsWith("cust_")) {
      await db
        .update(customProductsTable)
        .set({ deletedAt: null })
        .where(eq(customProductsTable.id, id));
      custTouched = true;
    } else {
      await db
        .update(productOverridesTable)
        .set({ deletedAt: null })
        .where(eq(productOverridesTable.productId, id));
      ovTouched = true;
    }
  }
  if (custTouched) invalidateCustomProducts();
  if (ovTouched) invalidateOverrides();
  res.json({ updated: ids.length });
});

router.post("/admin/products/bulk-feature", async (req, res) => {
  const ids = parseProductIds(req.body);
  const featured = !!(req.body as { featured?: unknown })?.featured;
  let custTouched = false;
  let ovTouched = false;
  for (const id of ids) {
    if (id.startsWith("cust_")) {
      await db
        .update(customProductsTable)
        .set({ featured })
        .where(eq(customProductsTable.id, id));
      custTouched = true;
    } else {
      await db
        .insert(productOverridesTable)
        .values({ productId: id, featured })
        .onConflictDoUpdate({
          target: productOverridesTable.productId,
          set: { featured },
        });
      ovTouched = true;
    }
  }
  if (custTouched) invalidateCustomProducts();
  if (ovTouched) invalidateOverrides();
  res.json({ updated: ids.length });
});

router.post("/admin/products/bulk-category", async (req, res) => {
  const ids = parseProductIds(req.body);
  const rawCat = (req.body as { category?: unknown })?.category;
  const category = typeof rawCat === "string" ? rawCat.trim() : "";
  if (!category) {
    res.status(400).json({ error: "category is required" });
    return;
  }
  let custTouched = false;
  let ovTouched = false;
  for (const id of ids) {
    if (id.startsWith("cust_")) {
      await db
        .update(customProductsTable)
        .set({ category })
        .where(eq(customProductsTable.id, id));
      custTouched = true;
    } else {
      await db
        .insert(productOverridesTable)
        .values({ productId: id, categoryOverride: category })
        .onConflictDoUpdate({
          target: productOverridesTable.productId,
          set: { categoryOverride: category },
        });
      ovTouched = true;
    }
  }
  if (custTouched) invalidateCustomProducts();
  if (ovTouched) invalidateOverrides();
  res.json({ updated: ids.length });
});

/* ---------------- Custom Products (admin-authored) ----------------
 * Fully editable products that live in custom_products. IDs always
 * carry a `cust_` prefix (enforced by the schema check + here when we
 * generate one) so they can never collide with the JSON catalog.
 */

interface CustomProductInput {
  title?: unknown;
  category?: unknown;
  subCategory?: unknown;
  price?: unknown;
  imageUrls?: unknown;
  imageUrl?: unknown;
  sizes?: unknown;
  colors?: unknown;
  gender?: unknown;
  badge?: unknown;
  featured?: unknown;
  hidden?: unknown;
  stockLevel?: unknown;
}

function parseCustomProductCreate(
  body: CustomProductInput,
): { ok: true; values: typeof customProductsTable.$inferInsert } | { ok: false; error: string } {
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) return { ok: false, error: "title is required" };
  const category = typeof body.category === "string" ? body.category.trim() : "";
  if (!category) return { ok: false, error: "category is required" };
  const priceNum =
    body.price !== undefined && body.price !== null && body.price !== ""
      ? Number(body.price)
      : NaN;
  if (!Number.isFinite(priceNum) || priceNum < 0) {
    return { ok: false, error: "price must be a non-negative number" };
  }
  const gender = body.gender === "men" ? "men" : "women";
  const sizes = normalizeStringArray(body.sizes) ?? [];
  const colors = normalizeColorsArray(body.colors) ?? [];
  let imageUrls: string[] = [];
  if (Array.isArray(body.imageUrls)) {
    imageUrls = normalizeStringArray(body.imageUrls) ?? [];
  } else if (typeof body.imageUrl === "string" && body.imageUrl.trim()) {
    imageUrls = [body.imageUrl.trim()];
  }
  return {
    ok: true,
    values: {
      id: `cust_${randomUUID().replace(/-/g, "").slice(0, 20)}`,
      title,
      category,
      subCategory:
        typeof body.subCategory === "string" && body.subCategory.trim()
          ? body.subCategory.trim()
          : null,
      price: priceNum.toFixed(2),
      imageUrls,
      sizes,
      colors,
      gender,
      badge:
        typeof body.badge === "string" && body.badge.trim()
          ? body.badge.trim()
          : null,
      featured: !!body.featured,
      hidden: !!body.hidden,
      stockLevel:
        body.stockLevel === undefined || body.stockLevel === null || body.stockLevel === ""
          ? null
          : Number.isFinite(Number(body.stockLevel))
            ? Math.max(0, Math.floor(Number(body.stockLevel)))
            : null,
    },
  };
}

router.post("/admin/custom-products", async (req: Request, res: Response) => {
  const parsed = parseCustomProductCreate(req.body ?? {});
  if (!parsed.ok) {
    res.status(400).json({ error: parsed.error });
    return;
  }
  const [row] = await db
    .insert(customProductsTable)
    .values(parsed.values)
    .returning();
  invalidateCustomProducts();
  res.status(201).json(row);
});

router.patch("/admin/custom-products/:id", async (req: Request, res: Response) => {
  const idRaw = req.params["id"];
  const id = Array.isArray(idRaw) ? idRaw[0] : idRaw;
  if (!id || !id.startsWith("cust_")) {
    res.status(400).json({ error: "Invalid custom product id" });
    return;
  }
  const body = (req.body ?? {}) as CustomProductInput;
  const patch: Partial<typeof customProductsTable.$inferInsert> = {};
  if (typeof body.title === "string" && body.title.trim()) {
    patch.title = body.title.trim();
  }
  if (typeof body.category === "string" && body.category.trim()) {
    patch.category = body.category.trim();
  }
  if ("subCategory" in body) {
    patch.subCategory =
      typeof body.subCategory === "string" && body.subCategory.trim()
        ? body.subCategory.trim()
        : null;
  }
  if (body.price !== undefined && body.price !== null && body.price !== "") {
    const n = Number(body.price);
    if (!Number.isFinite(n) || n < 0) {
      res.status(400).json({ error: "price must be a non-negative number" });
      return;
    }
    patch.price = n.toFixed(2);
  }
  if ("imageUrls" in body) {
    patch.imageUrls = normalizeStringArray(body.imageUrls) ?? [];
  } else if (typeof body.imageUrl === "string") {
    patch.imageUrls = body.imageUrl.trim() ? [body.imageUrl.trim()] : [];
  }
  if ("sizes" in body) patch.sizes = normalizeStringArray(body.sizes) ?? [];
  if ("colors" in body) patch.colors = normalizeColorsArray(body.colors) ?? [];
  if (body.gender === "men" || body.gender === "women") {
    patch.gender = body.gender;
  }
  if ("badge" in body) {
    patch.badge =
      typeof body.badge === "string" && body.badge.trim()
        ? body.badge.trim()
        : null;
  }
  if ("featured" in body) patch.featured = !!body.featured;
  if ("hidden" in body) patch.hidden = !!body.hidden;
  if ("stockLevel" in body) {
    patch.stockLevel =
      body.stockLevel === null || body.stockLevel === ""
        ? null
        : Number.isFinite(Number(body.stockLevel))
          ? Math.max(0, Math.floor(Number(body.stockLevel)))
          : null;
  }
  const [row] = await db
    .update(customProductsTable)
    .set(patch)
    .where(eq(customProductsTable.id, id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  invalidateCustomProducts();
  res.json(row);
});

router.delete("/admin/custom-products/:id", async (req: Request, res: Response) => {
  const idRaw = req.params["id"];
  const id = Array.isArray(idRaw) ? idRaw[0] : idRaw;
  if (!id || !id.startsWith("cust_")) {
    res.status(400).json({ error: "Invalid custom product id" });
    return;
  }
  // Hard delete is fine for custom products: nothing else owns them.
  // Use the soft-delete endpoint above if a recoverable removal is
  // wanted (e.g. to mirror JSON-catalog tombstoning behaviour).
  await db.delete(customProductsTable).where(eq(customProductsTable.id, id));
  invalidateCustomProducts();
  res.status(204).end();
});

/* ---------------- Product image upload ----------------
 * Same server-side validation as the logo endpoint, but writes under
 * the `products/` prefix and is allowed for any admin (not just super)
 * because day-to-day catalog editing isn't a sensitive operation.
 */
const PRODUCT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const PRODUCT_IMAGE_MIME_TO_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

router.post(
  "/admin/products/image",
  expressRaw({ type: () => true, limit: PRODUCT_IMAGE_MAX_BYTES + 1024 }),
  async (req: Request, res: Response) => {
    const ctRaw = String(req.headers["content-type"] ?? "")
      .split(";")[0]!
      .trim()
      .toLowerCase();
    const ext = PRODUCT_IMAGE_MIME_TO_EXT[ctRaw];
    if (!ext) {
      res.status(400).json({
        error: "Unsupported image type. Use PNG, JPG, WebP, or GIF (≤ 5 MB).",
      });
      return;
    }
    const buf = req.body;
    if (!Buffer.isBuffer(buf) || buf.length === 0) {
      res.status(400).json({ error: "Empty upload." });
      return;
    }
    if (buf.length > PRODUCT_IMAGE_MAX_BYTES) {
      res.status(413).json({ error: "Image must be 5 MB or smaller." });
      return;
    }
    try {
      const svc = new ObjectStorageService();
      const publicUrl = await svc.uploadServerSide(buf, ctRaw, ext, "products");
      res.json({ publicUrl });
    } catch (e) {
      if (e instanceof StorageNotConfiguredError) {
        res.status(503).json({
          error:
            "Object storage is not configured on this server. Paste an image URL instead.",
        });
        return;
      }
      req.log?.error?.({ err: e }, "product image upload failed");
      res
        .status(500)
        .json({ error: (e as Error).message || "Image upload failed." });
    }
  },
);

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
  const emailEvents = await db
    .select()
    .from(orderEmailEventsTable)
    .where(eq(orderEmailEventsTable.orderId, id))
    .orderBy(asc(orderEmailEventsTable.createdAt));
  res.json({ ...row, emailEvents });
});

router.patch("/admin/orders/:id", async (req, res) => {
  const idRaw = req.params["id"];
  const id = Array.isArray(idRaw) ? idRaw[0] : idRaw;
  if (!id) {
    res.status(400).json({ error: "Missing id" });
    return;
  }
  const body = (req.body ?? {}) as {
    status?: unknown;
    carrier?: unknown;
    trackingNumber?: unknown;
  };
  const hasStatus = Object.prototype.hasOwnProperty.call(body, "status");
  const hasCarrier = Object.prototype.hasOwnProperty.call(body, "carrier");
  const hasTracking = Object.prototype.hasOwnProperty.call(
    body,
    "trackingNumber",
  );
  if (!hasStatus && !hasCarrier && !hasTracking) {
    res.status(400).json({ error: "No fields to update" });
    return;
  }
  const update: Partial<typeof ordersTable.$inferInsert> = {};
  if (hasStatus) {
    if (
      typeof body.status !== "string" ||
      !(ORDER_STATUSES as readonly string[]).includes(body.status)
    ) {
      res.status(400).json({ error: "Invalid status" });
      return;
    }
    update.status = body.status as (typeof ORDER_STATUSES)[number];
  }
  if (hasCarrier) {
    if (body.carrier === null || body.carrier === "") {
      update.carrier = null;
    } else if (typeof body.carrier === "string") {
      update.carrier = body.carrier.trim().slice(0, 64) || null;
    } else {
      res.status(400).json({ error: "Invalid carrier" });
      return;
    }
  }
  if (hasTracking) {
    if (body.trackingNumber === null || body.trackingNumber === "") {
      update.trackingNumber = null;
    } else if (typeof body.trackingNumber === "string") {
      update.trackingNumber = body.trackingNumber.trim().slice(0, 128) || null;
    } else {
      res.status(400).json({ error: "Invalid tracking number" });
      return;
    }
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
    .set(update)
    .where(eq(ordersTable.id, id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  if (existing.status !== row.status) {
    // Fire-and-forget so a slow/failing email provider does not block the
    // admin UI. Errors are logged + recorded inside the helpers.
    //
    // Confirmation fires only on the `new → packed` transition. Other
    // moves into `packed` (e.g. shipped → packed correction, or a
    // packed → new → packed flip) are treated as admin-side bookkeeping
    // and do NOT auto-resend — staff should use the dedicated
    // /resend-email endpoint if they intentionally want another copy.
    if (existing.status === "new" && row.status === "packed") {
      void sendOrderConfirmationEmail(row, req.log);
    } else if (row.status === "shipped" || row.status === "delivered") {
      void sendOrderStatusEmail(row, row.status, req.log);
    }
  }
  res.json(row);
});

/** Manually resend any of the four order emails. Used by the Resend
 *  buttons in the admin order detail when the original send failed,
 *  or when staff want to nudge a customer who lost the email. */
router.post(
  "/admin/orders/:id/resend-email",
  async (req: Request, res: Response) => {
    const idRaw = req.params["id"];
    const id = Array.isArray(idRaw) ? idRaw[0] : idRaw;
    if (!id) {
      res.status(400).json({ error: "Missing id" });
      return;
    }
    const kind = req.body?.kind as OrderEmailKind | undefined;
    if (!kind || !ORDER_EMAIL_KINDS.includes(kind)) {
      res.status(400).json({
        error: `Invalid kind. Expected one of ${ORDER_EMAIL_KINDS.join(", ")}.`,
      });
      return;
    }
    const [order] = await db
      .select()
      .from(ordersTable)
      .where(eq(ordersTable.id, id));
    if (!order) {
      res.status(404).json({ error: "Order not found" });
      return;
    }
    // payment_failed needs a freshly-signed Paystack resume URL — mint
    // one from the current request origin + active Paystack secret so
    // the operator's manual resend gives the customer a working link.
    if (kind === "payment_failed") {
      const settings = await getSiteSettings();
      const { secretKey } = getActivePaystackKeys(settings);
      if (!secretKey) {
        res.status(503).json({
          error:
            "Cannot resend a payment-failed email — Paystack is not configured.",
        });
        return;
      }
      const retryUrl = buildResumeUrl(getPublicOrigin(req), order.id, secretKey);
      await sendOrderEmailByKind(order, kind, req.log, {
        variant: "declined",
        retryUrl,
      });
    } else {
      await sendOrderEmailByKind(order, kind, req.log);
    }
    // Return the freshly-recorded email events so the UI can refresh
    // without a second round-trip.
    const events = await db
      .select()
      .from(orderEmailEventsTable)
      .where(eq(orderEmailEventsTable.orderId, id))
      .orderBy(asc(orderEmailEventsTable.createdAt));
    res.json({ ok: true, kind, emailEvents: events });
  },
);

/* ---------------- Reviews moderation ----------------
 * Admins can list and remove individual reviews. Deletion goes through
 * `deleteReviewById` so the cached `product_review_summary` row for the
 * affected product is refreshed in the same call — otherwise the
 * storefront would keep showing the pre-deletion count/average.
 */

router.get("/admin/reviews", async (req: Request, res: Response) => {
  const limit = Math.min(Number(req.query["limit"] ?? 100) || 100, 500);
  const offset = Math.max(Number(req.query["offset"] ?? 0) || 0, 0);
  const productIdRaw = req.query["productId"];
  const productId =
    typeof productIdRaw === "string" && productIdRaw.length > 0
      ? productIdRaw
      : null;
  const where = productId
    ? eq(reviewsTable.productId, productId)
    : sql`TRUE`;
  const rows = await db
    .select()
    .from(reviewsTable)
    .where(where)
    .orderBy(desc(reviewsTable.createdAt))
    .limit(limit)
    .offset(offset);
  res.json({ rows, limit, offset });
});

router.delete("/admin/reviews/:id", async (req: Request, res: Response) => {
  const id = Number(req.params["id"]);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const productId = await deleteReviewById(id);
  if (!productId) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json({ success: true, productId });
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
      // Sum the display-currency snapshot (USD) so we don't add KES
      // and USD orders together. Falls back to total_cents for legacy
      // pre-FX-lock orders, which were already denominated in USD.
      totalSpentCents: sql<number>`COALESCE(SUM(COALESCE(${ordersTable.displayTotalCents}, ${ordersTable.totalCents})), 0)::bigint`,
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

/**
 * Mask Paystack secret keys before sending settings to the admin browser.
 * The raw secret never leaves the server. The admin UI shows the mask so
 * the operator knows a key is saved without it being recoverable from
 * the page source / network tab.
 */
// Fields that hold credentials/secrets or operator-alert configuration
// — visible and editable by super_admin only. General admins see them
// stripped/blanked from GET /admin/settings and any attempt to mutate
// them through PUT is silently dropped.
const SUPER_ADMIN_ONLY_FIELDS = [
  "paystackEnabled",
  "paystackTestMode",
  "paystackLivePublicKey",
  "paystackLiveSecretKey",
  "paystackTestPublicKey",
  "paystackTestSecretKey",
  "paystackLiveSecretKeySet",
  "paystackTestSecretKeySet",
  "smtpHost",
  "smtpPort",
  "smtpSecure",
  "smtpUsername",
  "smtpPassword",
  "smtpPasswordSet",
  "resendApiKey",
  "resendApiKeySet",
  "bankTransferEnabled",
  "bankName",
  "bankAccountName",
  "bankAccountNumber",
  "bankSwiftCode",
  "bankRoutingNumber",
  "bankInstructions",
  "paymentAlertMode",
  "paymentAlertRecipients",
  // Store currency drives Paystack charge initialization, so only the
  // super-admin should be able to switch it (the symbol is derived
  // server-side from this code so it is also gated indirectly).
  "currencyCode",
  "currencySymbol",
  // FX (USD→KES) controls the amount Paystack actually charges, so
  // edits are super-admin only. The auto-refresh toggle is gated for
  // the same reason — flipping it off "freezes" the charge ratio.
  "usdToKesRate",
  "fxAutoRefresh",
] as const;

function shapeSettingsForAdmin(
  s: Awaited<ReturnType<typeof getSiteSettings>>,
  role: "admin" | "super_admin",
) {
  // Strip credential material before returning to the browser. The
  // bcrypt hash never needs to leave the server, and the username is
  // managed exclusively through `/api/admin-auth/*` endpoints.
  const {
    adminPasswordHash: _hash,
    adminUsername: _username,
    smtpPassword: _smtpPwd,
    resendApiKey: _resendKey,
    ...rest
  } = s;
  void _hash;
  void _username;
  void _smtpPwd;
  void _resendKey;
  const full = {
    ...rest,
    paystackLiveSecretKey: maskSecret(s.paystackLiveSecretKey),
    paystackTestSecretKey: maskSecret(s.paystackTestSecretKey),
    paystackLiveSecretKeySet: !!s.paystackLiveSecretKey,
    paystackTestSecretKeySet: !!s.paystackTestSecretKey,
    // SMTP password is write-only — surface a mask + a "set" flag so
    // the UI can show "saved" without ever revealing the secret.
    smtpPassword: maskSecret(s.smtpPassword),
    smtpPasswordSet: !!s.smtpPassword,
    // Resend API key is write-only too — same masked + "set" pattern.
    resendApiKey: maskSecret(s.resendApiKey),
    resendApiKeySet: !!s.resendApiKey,
  };
  if (role === "super_admin") return full;
  // General admin view: blank out every super-admin-only field so the
  // browser never even sees a masked indicator. Numeric/boolean fields
  // still need to satisfy the SiteSettings TS type on the client, so we
  // substitute neutral defaults rather than deleting them outright.
  const stripped: Record<string, unknown> = { ...full };
  for (const key of SUPER_ADMIN_ONLY_FIELDS) {
    const current = (full as Record<string, unknown>)[key];
    if (typeof current === "boolean") stripped[key] = false;
    else if (typeof current === "number") stripped[key] = 0;
    else stripped[key] = key === "paymentAlertMode" ? "off" : null;
  }
  return stripped;
}

router.get("/admin/settings", async (req, res) => {
  const role = (await getAdminRole(req)) ?? "admin";
  const settings = await getSiteSettings();
  res.json(shapeSettingsForAdmin(settings, role));
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

router.put("/admin/settings", async (req, res) => {
  const body = { ...(req.body ?? {}) } as Record<string, unknown>;
  const role = (await getAdminRole(req)) ?? "admin";
  if (role !== "super_admin") {
    // Defence-in-depth: silently drop any super-admin-only field from
    // the patch so a manipulated browser request can never overwrite
    // secrets. The UI hides these inputs entirely for general admins.
    for (const key of SUPER_ADMIN_ONLY_FIELDS) delete body[key];
  }
  const allowed = [
    "announcementText",
    "announcementActive",
    "defaultSort",
    "freeShippingThresholdCents",
    "maintenanceMode",
    "storeName",
    "tagline",
    "logoUrl",
    "emailFromAddress",
    "emailFromName",
    "emailReplyTo",
    "heroAutoAdvance",
    "allowGuestReviews",
    "paystackEnabled",
    "paystackTestMode",
    "paystackLivePublicKey",
    "paystackTestPublicKey",
    "bankTransferEnabled",
    "bankName",
    "bankAccountName",
    "bankAccountNumber",
    "bankSwiftCode",
    "bankRoutingNumber",
    "bankInstructions",
    "smtpHost",
    "smtpPort",
    "smtpSecure",
    "smtpUsername",
    "paymentAlertRecipients",
    "fxAutoRefresh",
  ];
  const patch: Record<string, unknown> = {};
  for (const k of allowed) if (k in body) patch[k] = body[k];

  // Store currency is hard-locked to USD by the hybrid-currency design
  // (USD on the storefront, KES on Paystack). The selector was removed
  // from the admin UI, but a stale or crafted client could still POST
  // `currencyCode` — so we ignore the field entirely and force the
  // canonical pair on every save. This is defence-in-depth; flipping
  // the storefront currency back to KES would silently break the
  // disclosure banner and FX-locked checkout assumptions.
  if ("currencyCode" in body || "currencySymbol" in body) {
    patch["currencyCode"] = "USD";
    patch["currencySymbol"] = symbolForCurrency("USD");
  }

  // FX rate: super-admin only. Defence-in-depth strips the field above
  // for general admins, so by the time we get here it is safe to trust
  // the role check. Validate the numeric range so a typo can never
  // flip the rate to something that would massively over- or
  // under-charge real customers (real KES has lived in 100–200 range).
  if ("usdToKesRate" in body) {
    const raw = body["usdToKesRate"];
    const n = Number(raw);
    if (!Number.isFinite(n) || n < FX_RATE_MIN || n > FX_RATE_MAX) {
      res.status(400).json({
        error: `usdToKesRate must be a number between ${FX_RATE_MIN} and ${FX_RATE_MAX}`,
      });
      return;
    }
    patch["usdToKesRate"] = n.toFixed(6);
    // Stamp updatedAt so the admin UI shows "as of just now" instead
    // of a stale timestamp from a previous auto-refresh.
    patch["fxRateUpdatedAt"] = new Date();
  }
  if ("fxAutoRefresh" in patch) {
    patch["fxAutoRefresh"] = !!patch["fxAutoRefresh"];
  }

  // Operator alert mode is enum-validated rather than free-form text
  // so the DB only ever sees one of the three known values.
  if ("paymentAlertMode" in body) {
    const mode = parseAlertMode(body["paymentAlertMode"]);
    if (!mode) {
      res.status(400).json({
        error: "paymentAlertMode must be 'off', 'instant', or 'hourly'",
      });
      return;
    }
    patch["paymentAlertMode"] = mode;
  }
  // Recipients: accept the raw textarea value but normalise + validate.
  // Reject the save if any non-empty entry isn't a valid email so the
  // operator can correct the typo before alerts start failing silently.
  if ("paymentAlertRecipients" in patch) {
    const raw = patch["paymentAlertRecipients"];
    if (raw === null || raw === undefined || String(raw).trim() === "") {
      patch["paymentAlertRecipients"] = null;
    } else {
      const text = String(raw);
      const entries = text
        .split(/[,;\n]/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      const invalid = entries.filter((e) => !EMAIL_RE.test(e));
      if (invalid.length > 0) {
        res.status(400).json({
          error: `Invalid email${invalid.length === 1 ? "" : "s"} in alert recipients: ${invalid.join(", ")}`,
        });
        return;
      }
      // Persist the normalised, deduplicated list so the admin UI
      // re-render mirrors what the dispatcher actually uses.
      const normalised = parseAlertRecipients(text);
      patch["paymentAlertRecipients"] =
        normalised.length === 0 ? null : normalised.join(", ");
    }
  }

  // Secret keys are write-only. The admin page sends back the masked
  // string we previously rendered when the operator hasn't typed a new
  // key. Treat blanks and the masked placeholder as "do not change".
  const acceptSecret = (raw: unknown): string | null | undefined => {
    if (raw === undefined) return undefined;
    if (raw === null) return null;
    const s = String(raw).trim();
    if (s === "") return null;
    if (s.includes("••••")) return undefined;
    return s;
  };
  const liveSecret = acceptSecret(body["paystackLiveSecretKey"]);
  if (liveSecret !== undefined) patch["paystackLiveSecretKey"] = liveSecret;
  const testSecret = acceptSecret(body["paystackTestSecretKey"]);
  if (testSecret !== undefined) patch["paystackTestSecretKey"] = testSecret;
  const smtpPwd = acceptSecret(body["smtpPassword"]);
  if (smtpPwd !== undefined) patch["smtpPassword"] = smtpPwd;
  const resendKey = acceptSecret(body["resendApiKey"]);
  if (resendKey !== undefined) patch["resendApiKey"] = resendKey;

  // Coerce/validate the SMTP host/port/string fields so we never save
  // garbage that would break nodemailer at send time.
  if ("smtpHost" in patch) {
    const v = patch["smtpHost"];
    patch["smtpHost"] =
      v === null || v === undefined || String(v).trim() === ""
        ? null
        : String(v).trim();
  }
  if ("smtpUsername" in patch) {
    const v = patch["smtpUsername"];
    patch["smtpUsername"] =
      v === null || v === undefined || String(v).trim() === ""
        ? null
        : String(v).trim();
  }
  if ("smtpPort" in patch) {
    const raw = patch["smtpPort"];
    if (raw === null || raw === undefined || raw === "") {
      patch["smtpPort"] = null;
    } else {
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 1 || n > 65535) {
        res.status(400).json({ error: "smtpPort must be a port between 1 and 65535." });
        return;
      }
      patch["smtpPort"] = n;
    }
  }
  if ("smtpSecure" in patch) {
    patch["smtpSecure"] = !!patch["smtpSecure"];
  }

  // Trim+null bank string fields so blank inputs clear the row instead
  // of saving whitespace that the storefront would render verbatim.
  const bankStringFields = [
    "bankName",
    "bankAccountName",
    "bankAccountNumber",
    "bankSwiftCode",
    "bankRoutingNumber",
    "bankInstructions",
    "paystackLivePublicKey",
    "paystackTestPublicKey",
  ] as const;
  for (const k of bankStringFields) {
    if (k in patch) {
      const v = patch[k];
      patch[k] =
        v === null || v === undefined || String(v).trim() === ""
          ? null
          : String(v).trim();
    }
  }

  const normEmail = (v: unknown): string | null => {
    if (v === null || v === undefined) return null;
    const s = String(v).trim();
    return s.length === 0 ? null : s;
  };
  if ("emailFromAddress" in patch) patch["emailFromAddress"] = normEmail(patch["emailFromAddress"]);
  if ("emailReplyTo" in patch) patch["emailReplyTo"] = normEmail(patch["emailReplyTo"]);
  if ("emailFromName" in patch) {
    const v = patch["emailFromName"];
    patch["emailFromName"] =
      v === null || v === undefined || String(v).trim() === ""
        ? null
        : String(v).trim();
  }
  for (const k of ["emailFromAddress", "emailReplyTo"] as const) {
    const v = patch[k];
    if (typeof v === "string" && !EMAIL_RE.test(v)) {
      res.status(400).json({ error: `Invalid email for ${k}` });
      return;
    }
  }
  await db
    .insert(siteSettingsTable)
    .values({ id: 1, ...(patch as object) })
    .onConflictDoUpdate({
      target: siteSettingsTable.id,
      set: patch,
    });
  invalidateSiteSettings();
  const settings = await getSiteSettings();
  res.json(shapeSettingsForAdmin(settings, role));
});

/* ---------------- FX rate refresh ---------------- *
 * Super-admin clicks "Refresh from upstream" in Settings → FX rate.
 * We hit a free public provider (open.er-api.com → exchangerate.host)
 * and persist the result. Always returns 200 so the UI can render
 * { ok:false, error } inline without going through its generic error
 * path, mirroring /admin/payments/test.
 */
router.post(
  "/admin/settings/refresh-fx-rate",
  requireSuperAdmin,
  async (_req, res) => {
    const result = await refreshFxRate();
    if (!result.ok) {
      res.status(200).json({ ok: false, error: result.error ?? "Refresh failed" });
      return;
    }
    res.status(200).json({
      ok: true,
      rate: result.rate,
      asOf: result.asOf?.toISOString() ?? null,
      source: result.source ?? null,
    });
  },
);

/* ---------------- Branding logo upload ---------------- */

const LOGO_MAX_BYTES = 2 * 1024 * 1024;
const LOGO_MIME_TO_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/svg+xml": "svg",
};

router.post(
  "/admin/settings/logo",
  requireSuperAdmin,
  expressRaw({ type: () => true, limit: LOGO_MAX_BYTES + 1024 }),
  async (req: Request, res: Response) => {
    const ctRaw = String(req.headers["content-type"] ?? "")
      .split(";")[0]!
      .trim()
      .toLowerCase();
    const ext = LOGO_MIME_TO_EXT[ctRaw];
    if (!ext) {
      res.status(400).json({
        error:
          "Unsupported logo type. Use PNG, JPG, SVG, WebP, or GIF (≤ 2 MB).",
      });
      return;
    }
    const buf = req.body;
    if (!Buffer.isBuffer(buf) || buf.length === 0) {
      res.status(400).json({ error: "Empty upload." });
      return;
    }
    if (buf.length > LOGO_MAX_BYTES) {
      res.status(413).json({ error: "Logo must be 2 MB or smaller." });
      return;
    }
    try {
      const svc = new ObjectStorageService();
      const publicUrl = await svc.uploadBranding(buf, ctRaw, ext);
      res.json({ publicUrl });
    } catch (e) {
      if (e instanceof StorageNotConfiguredError) {
        res.status(503).json({
          error:
            "Object storage is not configured on this server. Set PUBLIC_OBJECT_SEARCH_PATHS or paste a logo URL instead.",
        });
        return;
      }
      req.log?.error?.({ err: e }, "logo upload failed");
      res
        .status(500)
        .json({ error: (e as Error).message || "Logo upload failed." });
    }
  },
);

/* ---------------- Payments admin ---------------- */

router.get("/admin/payments/urls", requireSuperAdmin, (req, res) => {
  res.json({
    callbackUrl: getCallbackUrl(req),
    webhookUrl: getWebhookUrl(req),
  });
});

router.post("/admin/payments/test", requireSuperAdmin, async (_req, res) => {
  const settings = await getSiteSettings();
  const { secretKey, mode } = getActivePaystackKeys(settings);
  if (!secretKey) {
    // Always 200 so the admin UI can render `ok:false + error` inline
    // without triggering its generic adminFetch error path. The "did the
    // request succeed?" signal is the `ok` field, not the HTTP status.
    res.status(200).json({
      ok: false,
      mode,
      error: `No ${mode} secret key saved. Paste your sk_${mode}_… key and save before testing.`,
      enabled: settings.paystackEnabled,
      ready: isPaystackReady(settings),
    });
    return;
  }
  const probe = await probeSecretKey(secretKey);
  res.status(200).json({
    ok: probe.ok,
    mode,
    error: probe.error,
    enabled: settings.paystackEnabled,
    ready: isPaystackReady(settings),
  });
});

/* ---------------- Email test send ----------------
 * POST /admin/settings/test-email { to } — sends a small sample message
 * using the same From / Reply-To headers that real order emails use, so
 * the operator can confirm Resend accepts their domain before placing
 * a real order. Rate-limited per admin (in-memory) to keep the button
 * from being abused as a free-form mailer.
 */

const TEST_SEND_LIMIT_HOUR = 5;
const TEST_SEND_WINDOW_MS = 60 * 60 * 1000;
const TEST_SEND_MIN_GAP_MS = 10_000;

async function checkTestSendQuota(
  key: string,
): Promise<{ ok: true } | { ok: false; retryAfterMs: number; reason: string }> {
  const result = await checkQuota({
    key: `test-email:${key}`,
    windowMs: TEST_SEND_WINDOW_MS,
    limit: TEST_SEND_LIMIT_HOUR,
    minGapMs: TEST_SEND_MIN_GAP_MS,
  });
  if (result.ok) return { ok: true };
  return {
    ok: false,
    retryAfterMs: result.retryAfterMs,
    reason:
      result.kind === "gap"
        ? "Please wait a few seconds before sending another test email."
        : `Test-send limit reached (${TEST_SEND_LIMIT_HOUR} per hour). Try again later.`,
  };
}

const TEST_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

router.post("/admin/settings/test-email", requireSuperAdmin, async (req, res) => {
  const to = typeof req.body?.to === "string" ? req.body.to.trim() : "";
  if (!to || !TEST_EMAIL_RE.test(to)) {
    res.status(400).json({ ok: false, error: "Enter a valid email address." });
    return;
  }
  // Prefer the authenticated email as the throttle key, but fall back to
  // the request IP so a missing user object still rate-limits.
  const adminEmail = req.user?.email?.toLowerCase();
  const ip = req.ip ?? req.socket?.remoteAddress ?? "unknown";
  const quotaKey = adminEmail ?? `ip:${ip}`;
  const quota = await checkTestSendQuota(quotaKey);
  if (!quota.ok) {
    res
      .status(429)
      .setHeader("Retry-After", Math.ceil(quota.retryAfterMs / 1000))
      .json({ ok: false, error: quota.reason });
    return;
  }
  const result = await sendTestOrderEmail(to, req.log);
  res.status(result.ok ? 200 : 502).json(result);
});

/* ---------------- SMTP verify ----------------
 * POST /admin/settings/verify-smtp — performs an SMTP handshake +
 * AUTH against the saved SMTP credentials without sending mail. The
 * admin UI uses this so the operator can confirm Titan / Zoho / etc.
 * accept the username + password before relying on order-confirmation
 * delivery. Always 200 so the UI renders the result inline.
 */
router.post("/admin/settings/verify-smtp", requireSuperAdmin, async (req, res) => {
  const settings = await getSiteSettings();
  // Accept the in-progress form values as an override so the operator
  // can verify before saving. Anything missing or sent as the masked
  // placeholder ("••••…") falls back to the saved DB value — this is
  // the same convention the PUT /admin/settings handler uses.
  const body = (req.body ?? {}) as Record<string, unknown>;
  const trimmedString = (raw: unknown, fallback: string | null): string | null => {
    if (raw === undefined) return fallback;
    if (raw === null) return null;
    const s = String(raw).trim();
    return s.length === 0 ? null : s;
  };
  const portOverride = (raw: unknown, fallback: number | null): number | null => {
    if (raw === undefined) return fallback;
    if (raw === null || raw === "") return null;
    const n = Number(raw);
    // Invalid input: treat as missing rather than silently using the
    // saved value so the verify result reflects the operator's typo.
    if (!Number.isInteger(n) || n < 1 || n > 65535) return null;
    return n;
  };
  const passwordOverride = (raw: unknown, fallback: string | null): string | null => {
    if (raw === undefined) return fallback;
    if (raw === null) return null;
    const s = String(raw);
    // Treat the masked placeholder we ship to the browser as "no
    // change" so re-verifying after a partial form edit keeps using
    // the saved password instead of clearing it.
    if (s.includes("••••")) return fallback;
    if (s.trim().length === 0) return null;
    return s;
  };
  const merged = {
    ...settings,
    smtpHost: trimmedString(body["smtpHost"], settings.smtpHost),
    smtpUsername: trimmedString(body["smtpUsername"], settings.smtpUsername),
    smtpPort: portOverride(body["smtpPort"], settings.smtpPort),
    // Strict boolean parse: only accept actual booleans so a payload
    // like the string "false" never coerces to true and silently
    // changes the TLS mode being verified.
    smtpSecure:
      typeof body["smtpSecure"] === "boolean"
        ? (body["smtpSecure"] as boolean)
        : settings.smtpSecure,
    smtpPassword: passwordOverride(body["smtpPassword"], settings.smtpPassword),
  };
  const result = await verifySmtp(merged);
  res.status(200).json(result);
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

  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const [emailFailAgg] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(orderEmailEventsTable)
    .where(
      and(
        gte(orderEmailEventsTable.createdAt, oneDayAgo),
        sql`${orderEmailEventsTable.status} IN ('failed', 'skipped')`,
      ),
    );

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
    emailsFailed24h: Number(emailFailAgg?.count ?? 0),
  });
});

/* ---------------- Dashboard Overview ----------------
 * Aggregation for the admin Overview tab. All independent queries run
 * in parallel via Promise.all so the endpoint is one HTTP round-trip
 * even though it issues several SQL statements. Returns:
 *   - orders + revenue + AOV by window (today / week / month)
 *   - full status funnel
 *   - top 5 best-selling products (qty + revenue)
 *   - the 10 most recent orders
 *   - low-stock products (override stock_level <= 5)
 *   - failed/skipped email events in the last 24h
 *   - total catalog product count
 */

router.get("/admin/overview", async (_req, res) => {
  const now = new Date();
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const aggregate = async (since: Date) => {
    const [row] = await db
      .select({
        count: sql<number>`COUNT(*)::int`,
        // Hybrid currency: aggregate the storefront-display amount
        // (USD) so dashboards don't accidentally sum KES + USD.
        revenue: sql<number>`COALESCE(SUM(COALESCE(${ordersTable.displayTotalCents}, ${ordersTable.totalCents})), 0)::bigint`,
      })
      .from(ordersTable)
      .where(
        and(
          gte(ordersTable.createdAt, since),
          sql`${ordersTable.status} <> 'cancelled'`,
        ),
      );
    const count = Number(row?.count ?? 0);
    const revenue = Number(row?.revenue ?? 0);
    return {
      count,
      revenueCents: revenue,
      aovCents: count > 0 ? Math.round(revenue / count) : 0,
    };
  };

  const allProducts = getAllProducts();

  const settings = await getSiteSettings();

  const [
    today,
    week,
    month,
    paymentsTodayRow,
    funnelRows,
    topSellerResult,
    recentOrders,
    lowStockOverrides,
    emailFailRow,
  ] = await Promise.all([
    aggregate(startOfDay),
    aggregate(sevenDaysAgo),
    aggregate(thirtyDaysAgo),
    db
      .select({
        count: sql<number>`COUNT(*)::int`,
        // Same display-currency normalization as `aggregate()` above.
        revenue: sql<number>`COALESCE(SUM(COALESCE(${ordersTable.displayTotalCents}, ${ordersTable.totalCents})), 0)::bigint`,
      })
      .from(ordersTable)
      .where(
        and(
          gte(ordersTable.createdAt, startOfDay),
          sql`${ordersTable.status} = 'paid'`,
        ),
      )
      .then((rows) => rows[0]),
    db
      .select({
        status: ordersTable.status,
        count: sql<number>`COUNT(*)::int`,
      })
      .from(ordersTable)
      .groupBy(ordersTable.status),
    // Top sellers — unnest the items JSONB array, count quantities per
    // productId. Excludes cancelled orders. Title falls back to whatever
    // was stored at order time so it survives catalog churn.
    db.execute<{
      product_id: string;
      title: string;
      qty: number;
      revenue: number;
    }>(sql`
      SELECT (item->>'productId') AS product_id,
             MAX(item->>'title') AS title,
             SUM((item->>'quantity')::int)::int AS qty,
             SUM((item->>'quantity')::int * (item->>'unitPriceCents')::int)::bigint AS revenue
      FROM ${ordersTable}, jsonb_array_elements(${ordersTable.items}) AS item
      WHERE ${ordersTable.status} <> 'cancelled'
        AND (item->>'productId') IS NOT NULL
      GROUP BY (item->>'productId')
      ORDER BY qty DESC
      LIMIT 5
    `),
    db
      .select()
      .from(ordersTable)
      .orderBy(desc(ordersTable.createdAt))
      .limit(10),
    db
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
      .limit(10)
      .then((rows) => rows),
    db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(orderEmailEventsTable)
      .where(
        and(
          gte(orderEmailEventsTable.createdAt, oneDayAgo),
          sql`${orderEmailEventsTable.status} IN ('failed', 'skipped')`,
        ),
      )
      .then((rows) => rows[0]),
  ]);

  const funnel: Record<string, number> = {
    new: 0,
    packed: 0,
    shipped: 0,
    delivered: 0,
    cancelled: 0,
  };
  for (const r of funnelRows) {
    funnel[r.status] = Number(r.count);
  }

  const topSellers = (topSellerResult.rows ?? []).map((r) => ({
    productId: r.product_id,
    title: r.title ?? r.product_id,
    qty: Number(r.qty),
    revenueCents: Number(r.revenue),
  }));

  const lowStockProducts = lowStockOverrides.map((o) => {
    const p = allProducts.find((x) => x.id === o.productId);
    return {
      productId: o.productId,
      title: p?.title ?? o.productId,
      stockLevel: o.stockLevel ?? 0,
    };
  });

  // Paystack health pill for the dashboard header. Three states make
  // it obvious to the operator whether checkout is wired up.
  const { secretKey: activeSecret, publicKey: activePublic } =
    getActivePaystackKeys(settings);
  const paystackStatus: "enabled" | "disabled" | "keys_missing" = (() => {
    if (!settings.paystackEnabled) return "disabled";
    if (!activeSecret || !activePublic) return "keys_missing";
    return "enabled";
  })();

  res.json({
    today,
    week,
    month,
    paymentsToday: {
      count: Number(paymentsTodayRow?.count ?? 0),
      revenueCents: Number(paymentsTodayRow?.revenue ?? 0),
    },
    paystackStatus,
    paystackTestMode: !!settings.paystackTestMode,
    funnel,
    topSellers,
    recentOrders,
    lowStockProducts,
    emailsFailed24h: Number(emailFailRow?.count ?? 0),
    productsCount: allProducts.length,
  });
});

/* ---------------- Payment events ----------------
 * Audit log + live stream for Paystack outcomes (success, failed,
 * abandoned). The list endpoint backs the Payments admin's activity
 * panel; the SSE endpoint pushes real-time updates so a successful
 * webhook turns into a toast in the dashboard within milliseconds.
 */

router.get("/admin/payment-events", async (req: Request, res: Response) => {
  const limit = Math.min(Number(req.query["limit"] ?? 50) || 50, 200);
  const offset = Math.max(Number(req.query["offset"] ?? 0) || 0, 0);
  const kindRaw = typeof req.query["kind"] === "string" ? req.query["kind"] : "";
  const fromRaw = typeof req.query["from"] === "string" ? req.query["from"] : "";
  const toRaw = typeof req.query["to"] === "string" ? req.query["to"] : "";
  const qRaw = typeof req.query["q"] === "string" ? req.query["q"].trim() : "";

  const conds = [] as Array<ReturnType<typeof eq>>;
  if (kindRaw === "success" || kindRaw === "failed" || kindRaw === "abandoned") {
    conds.push(eq(paymentEventsTable.kind, kindRaw));
  }
  // Date range — `from` is inclusive (start of that day in the caller's
  // local time, sent as ISO), `to` is inclusive (we treat it as the END
  // of that day so picking the same date twice still matches that day).
  if (fromRaw) {
    const d = new Date(fromRaw);
    if (!Number.isNaN(d.getTime())) {
      conds.push(gte(paymentEventsTable.createdAt, d));
    }
  }
  if (toRaw) {
    const d = new Date(toRaw);
    if (!Number.isNaN(d.getTime())) {
      conds.push(lte(paymentEventsTable.createdAt, d));
    }
  }
  // Free-text search: match against the Paystack reference, the linked
  // order id, or — via a correlated subquery — the customer email on the
  // linked order. We use ILIKE for case-insensitive contains-matching.
  if (qRaw) {
    const pattern = `%${qRaw.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const emailMatch = sql`EXISTS (
      SELECT 1 FROM ${ordersTable}
      WHERE ${ordersTable.id} = ${paymentEventsTable.orderId}
        AND ${ordersTable.email} ILIKE ${pattern}
    )`;
    conds.push(
      or(
        ilike(paymentEventsTable.reference, pattern),
        ilike(paymentEventsTable.orderId, pattern),
        emailMatch,
      )!,
    );
  }

  const where = conds.length > 0 ? and(...conds) : sql`TRUE`;
  const rows = await db
    .select()
    .from(paymentEventsTable)
    .where(where)
    .orderBy(desc(paymentEventsTable.createdAt))
    .limit(limit)
    .offset(offset);
  const [countRow] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(paymentEventsTable)
    .where(where);
  res.json({
    rows,
    total: Number(countRow?.count ?? 0),
    limit,
    offset,
  });
});

/**
 * Server-Sent Events stream of new payment_event rows. The admin
 * dashboard subscribes via EventSource — admin auth cookies are sent
 * automatically because the stream lives under /api/admin/* which is
 * already gated by `requireAdmin`.
 *
 * Emits a periodic comment-only keepalive so any intermediary proxy
 * doesn't close an idle connection.
 */
router.get("/admin/payment-events/stream", (req: Request, res: Response) => {
  res.status(200).set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    // Disable proxy buffering on platforms that respect this hint
    // (e.g. nginx) so events arrive immediately rather than in chunks.
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();
  // Initial comment lets the client know the stream is open.
  res.write(`: connected ${new Date().toISOString()}\n\n`);

  const send = (event: PaymentEvent) => {
    try {
      res.write(`event: payment\n`);
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    } catch {
      // Client disconnected mid-write — cleanup happens via 'close'.
    }
  };
  paymentEventBus.on("event", send);

  const keepalive = setInterval(() => {
    try {
      res.write(`: keepalive ${Date.now()}\n\n`);
    } catch {
      /* ignore */
    }
  }, 25_000);

  req.on("close", () => {
    clearInterval(keepalive);
    paymentEventBus.off("event", send);
    try {
      res.end();
    } catch {
      /* already closed */
    }
  });
});

/* ---------------- Email events log ----------------
 * Paginated list across all orders for the new Emails tab.
 */
router.get("/admin/email-events", async (req, res) => {
  const limit = Math.min(Number(req.query["limit"] ?? 50) || 50, 200);
  const offset = Math.max(Number(req.query["offset"] ?? 0) || 0, 0);
  const status = typeof req.query["status"] === "string" ? req.query["status"] : "";
  const where =
    status === "sent" || status === "failed" || status === "skipped"
      ? eq(orderEmailEventsTable.status, status)
      : sql`TRUE`;
  const rows = await db
    .select()
    .from(orderEmailEventsTable)
    .where(where)
    .orderBy(desc(orderEmailEventsTable.createdAt))
    .limit(limit)
    .offset(offset);
  const [countRow] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(orderEmailEventsTable)
    .where(where);
  res.json({
    rows,
    total: Number(countRow?.count ?? 0),
    limit,
    offset,
  });
});

export default router;
