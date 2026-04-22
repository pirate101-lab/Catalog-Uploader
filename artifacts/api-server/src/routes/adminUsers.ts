import { Router, type IRouter, type Request, type Response } from "express";
import { asc } from "drizzle-orm";
import { db, adminUsersTable } from "@workspace/db";
import {
  createAdmin,
  deleteAdmin,
  findAdminById,
  MAX_PASSWORD,
  MIN_PASSWORD,
  superAdminCount,
  updateAdminPassword,
  updateAdminRole,
  USERNAME_RE,
  type AdminRole,
} from "../lib/adminCredentials.ts";
import { getSession, getSessionId } from "../lib/auth.ts";
import { requireAdmin, requireSuperAdmin } from "../middlewares/adminGuard.ts";

const router: IRouter = Router();

// All admin-user management requires an admin session AND super_admin
// role. We attach the guards per-route (rather than `router.use(...)`)
// so they NEVER fire on unrelated routes that happen to flow through
// this sub-router — Express enters every mounted sub-router regardless
// of path, so router-level middleware here would 401 storefront
// traffic too.
const guards = [requireAdmin, requireSuperAdmin] as const;

function shape(row: typeof adminUsersTable.$inferSelect) {
  return {
    id: row.id,
    username: row.username,
    role: row.role as AdminRole,
    createdAt: row.createdAt.toISOString(),
    createdById: row.createdById,
    lastLoginAt: row.lastLoginAt ? row.lastLoginAt.toISOString() : null,
  };
}

router.get("/admin-users", ...guards, async (_req: Request, res: Response) => {
  const rows = await db
    .select()
    .from(adminUsersTable)
    .orderBy(asc(adminUsersTable.id));
  res.json({ rows: rows.map(shape) });
});

router.post("/admin-users", ...guards, async (req: Request, res: Response) => {
  const username = String(req.body?.username ?? "").trim();
  const password = String(req.body?.password ?? "");
  const role = String(req.body?.role ?? "admin");
  if (!USERNAME_RE.test(username)) {
    res.status(400).json({
      error: "invalid_username",
      message: "Use 3–64 letters, numbers, dot, underscore or dash.",
    });
    return;
  }
  if (password.length < MIN_PASSWORD || password.length > MAX_PASSWORD) {
    res.status(400).json({
      error: "weak_password",
      message: `Password must be ${MIN_PASSWORD}–${MAX_PASSWORD} characters.`,
    });
    return;
  }
  if (role !== "admin" && role !== "super_admin") {
    res.status(400).json({ error: "invalid_role" });
    return;
  }
  const me = await currentAdminId(req);
  try {
    const created = await createAdmin({
      username,
      password,
      role: role as AdminRole,
      createdById: me ?? null,
    });
    res.status(201).json(shape(created));
  } catch (err: unknown) {
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code?: string }).code === "23505"
    ) {
      res.status(409).json({ error: "username_taken" });
      return;
    }
    throw err;
  }
});

router.patch("/admin-users/:id", ...guards, async (req: Request, res: Response) => {
  const id = Number(req.params["id"]);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "invalid_id" });
    return;
  }
  const target = await findAdminById(id);
  if (!target) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const me = await currentAdminId(req);

  // Role change
  if ("role" in (req.body ?? {})) {
    const role = String(req.body.role);
    if (role !== "admin" && role !== "super_admin") {
      res.status(400).json({ error: "invalid_role" });
      return;
    }
    if (role === target.role) {
      res.json(shape(target));
      return;
    }
    // Demotion guard: at least one super_admin must remain.
    if (target.role === "super_admin" && role === "admin") {
      const count = await superAdminCount();
      if (count <= 1) {
        res.status(409).json({ error: "last_super_admin" });
        return;
      }
    }
    await updateAdminRole(id, role);
    if (me === id) {
      // If a super_admin demotes themselves they immediately lose
      // access to this endpoint — that's fine, the guard on the next
      // request enforces it.
    }
  }

  // Password reset
  if ("password" in (req.body ?? {}) && req.body.password) {
    const password = String(req.body.password);
    if (password.length < MIN_PASSWORD || password.length > MAX_PASSWORD) {
      res.status(400).json({
        error: "weak_password",
        message: `Password must be ${MIN_PASSWORD}–${MAX_PASSWORD} characters.`,
      });
      return;
    }
    await updateAdminPassword(id, password);
  }

  const updated = await findAdminById(id);
  res.json(shape(updated!));
});

router.delete("/admin-users/:id", ...guards, async (req: Request, res: Response) => {
  const id = Number(req.params["id"]);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "invalid_id" });
    return;
  }
  const target = await findAdminById(id);
  if (!target) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const me = await currentAdminId(req);
  if (me === id) {
    res.status(409).json({ error: "cannot_delete_self" });
    return;
  }
  if (target.role === "super_admin") {
    const count = await superAdminCount();
    if (count <= 1) {
      res.status(409).json({ error: "last_super_admin" });
      return;
    }
  }
  await deleteAdmin(id);
  res.json({ ok: true });
});

async function currentAdminId(req: Request): Promise<number | null> {
  const sid = getSessionId(req);
  if (!sid) return null;
  const session = await getSession(sid);
  return session?.adminUserId ?? null;
}

export default router;
