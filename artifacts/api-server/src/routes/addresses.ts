import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { and, desc, eq } from "drizzle-orm";
import { db, addressesTable } from "@workspace/db";

const router: IRouter = Router();

interface AuthedRequest extends Request {
  authedUserId?: string;
}

function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): void {
  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  req.authedUserId = userId;
  next();
}

function sanitize(body: any) {
  const cleanString = (v: unknown, max: number) =>
    typeof v === "string" ? v.trim().slice(0, max) : "";
  return {
    label: cleanString(body?.label, 64) || null,
    fullName: cleanString(body?.fullName, 191),
    phone: cleanString(body?.phone, 32) || null,
    countryCode: cleanString(body?.countryCode, 4) || null,
    line1: cleanString(body?.line1, 500),
    line2: cleanString(body?.line2, 500) || null,
    city: cleanString(body?.city, 128),
    region: cleanString(body?.region, 128) || null,
    postalCode: cleanString(body?.postalCode, 32) || null,
    country: cleanString(body?.country, 64),
    isDefault: !!body?.isDefault,
  };
}

function validate(payload: ReturnType<typeof sanitize>): string | null {
  if (!payload.fullName) return "fullName is required";
  if (!payload.line1) return "line1 is required";
  if (!payload.city) return "city is required";
  if (!payload.country) return "country is required";
  return null;
}

router.get("/addresses", requireAuth, async (req: AuthedRequest, res) => {
  const rows = await db
    .select()
    .from(addressesTable)
    .where(eq(addressesTable.userId, req.authedUserId!))
    .orderBy(desc(addressesTable.isDefault), desc(addressesTable.updatedAt));
  res.json({ addresses: rows });
});

router.post("/addresses", requireAuth, async (req: AuthedRequest, res): Promise<void> => {
  const payload = sanitize(req.body);
  const err = validate(payload);
  if (err) {
    res.status(400).json({ error: err });
    return;
  }

  if (payload.isDefault) {
    await db
      .update(addressesTable)
      .set({ isDefault: false })
      .where(eq(addressesTable.userId, req.authedUserId!));
  }
  const [row] = await db
    .insert(addressesTable)
    .values({ ...payload, userId: req.authedUserId! })
    .returning();
  res.status(201).json({ address: row });
});

router.patch("/addresses/:id", requireAuth, async (req: AuthedRequest, res): Promise<void> => {
  const id = String(req.params.id);
  const payload = sanitize(req.body);
  const err = validate(payload);
  if (err) {
    res.status(400).json({ error: err });
    return;
  }

  if (payload.isDefault) {
    await db
      .update(addressesTable)
      .set({ isDefault: false })
      .where(eq(addressesTable.userId, req.authedUserId!));
  }
  const [row] = await db
    .update(addressesTable)
    .set(payload)
    .where(and(eq(addressesTable.id, id), eq(addressesTable.userId, req.authedUserId!)))
    .returning();
  if (!row) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  res.json({ address: row });
});

router.delete("/addresses/:id", requireAuth, async (req: AuthedRequest, res): Promise<void> => {
  const id = String(req.params.id);
  const result = await db
    .delete(addressesTable)
    .where(and(eq(addressesTable.id, id), eq(addressesTable.userId, req.authedUserId!)))
    .returning({ id: addressesTable.id });
  if (result.length === 0) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  res.json({ ok: true });
});

export default router;
