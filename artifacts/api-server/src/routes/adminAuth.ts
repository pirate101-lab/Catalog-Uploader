import { Router, type IRouter, type Request, type Response } from "express";
import { getSiteSettings } from "../lib/siteSettings.ts";
import {
  adminUsersCount,
  createAdmin,
  findAdminById,
  localAdminSessionUserId,
  MIN_PASSWORD,
  MAX_PASSWORD,
  touchLastLogin,
  updateAdminPassword,
  updateAdminUsername,
  USERNAME_RE,
  verifyAdminPassword,
} from "../lib/adminCredentials.ts";
import {
  clearSession,
  createSession,
  getSession,
  getSessionId,
  SESSION_COOKIE,
  SESSION_TTL,
  type SessionData,
} from "../lib/auth.ts";
import { getAdminRole } from "../middlewares/adminGuard.ts";

const router: IRouter = Router();

function setSessionCookie(res: Response, sid: string) {
  res.cookie(SESSION_COOKIE, sid, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL,
  });
}

function buildAdminSession(args: {
  adminUserId: number;
  username: string;
  role: "admin" | "super_admin";
}): SessionData {
  return {
    user: {
      id: localAdminSessionUserId(args.adminUserId),
      email: null,
      firstName: args.username,
      lastName: null,
      profileImageUrl: null,
    },
    access_token: "admin-local",
    authProvider: "admin-local",
    adminUserId: args.adminUserId,
    adminRole: args.role,
  };
}

/* -------- Setup / first-run -------- */

/**
 * Tell the admin login page whether any admin exists yet. If not, the
 * UI swaps to a registration form so the very first operator can claim
 * the dashboard. After at least one admin exists this returns
 * `needsSetup: false` permanently and the registration endpoint is
 * locked out — additional admins must be invited from the Admins tab
 * by an existing super_admin.
 */
router.get(
  "/admin-auth/setup-status",
  async (_req: Request, res: Response) => {
    // Setup is only available when BOTH stores are empty: the new
    // admin_users table has no rows AND the legacy site_settings
    // credentials are unset. Checking both protects against a window
    // where migrateAdminCredentials hasn't yet run (or failed) — without
    // this guard the UI would offer first-run registration even though
    // a legacy super-admin still owns the dashboard.
    const [count, settings] = await Promise.all([
      adminUsersCount(),
      getSiteSettings(),
    ]);
    const legacyConfigured = !!(
      settings.adminUsername && settings.adminPasswordHash
    );
    res.json({ needsSetup: count === 0 && !legacyConfigured });
  },
);

router.post("/admin-auth/setup", async (req: Request, res: Response) => {
  // Same dual check as setup-status: refuse to register a first admin
  // if either store already has credentials. This prevents an attacker
  // from racing the migration to seed their own super_admin.
  const [count, settings] = await Promise.all([
    adminUsersCount(),
    getSiteSettings(),
  ]);
  if (count > 0 || (settings.adminUsername && settings.adminPasswordHash)) {
    res.status(409).json({ error: "setup_already_done" });
    return;
  }
  const username = String(req.body?.username ?? "").trim();
  const password = String(req.body?.password ?? "");
  const validation = validateCredentials(username, password);
  if (validation) {
    res.status(400).json(validation);
    return;
  }
  // First operator is always a super_admin — they need full access to
  // configure secrets and invite teammates.
  const created = await createAdmin({
    username,
    password,
    role: "super_admin",
  });
  await touchLastLogin(created.id);
  const session = buildAdminSession({
    adminUserId: created.id,
    username: created.username,
    role: "super_admin",
  });
  const sid = await createSession(session);
  setSessionCookie(res, sid);
  res.json({ ok: true, user: shapeSelf(created, "super_admin") });
});

/* -------- Login / Logout / Me -------- */

router.post("/admin-auth/login", async (req: Request, res: Response) => {
  const username = String(req.body?.username ?? "").trim();
  const password = String(req.body?.password ?? "");
  if (!username || !password) {
    res.status(400).json({ error: "missing_credentials" });
    return;
  }
  const row = await verifyAdminPassword(username, password);
  if (!row) {
    res.status(401).json({ error: "invalid_credentials" });
    return;
  }
  await touchLastLogin(row.id);
  const session = buildAdminSession({
    adminUserId: row.id,
    username: row.username,
    role: row.role as "admin" | "super_admin",
  });
  const sid = await createSession(session);
  setSessionCookie(res, sid);
  res.json({
    ok: true,
    user: shapeSelf(row, row.role as "admin" | "super_admin"),
  });
});

router.post("/admin-auth/logout", async (req: Request, res: Response) => {
  const sid = getSessionId(req);
  await clearSession(res, sid);
  res.json({ ok: true });
});

/**
 * Identity for the currently signed-in admin. The browser uses this
 * to render role-aware UI (hide secrets and the Admins tab from
 * general admins). Always returns the freshest role from the DB —
 * not the snapshot stored in the session — so a demotion is reflected
 * on the very next request.
 */
router.get("/admin-auth/me", async (req: Request, res: Response) => {
  const sid = getSessionId(req);
  if (!sid) {
    res.json({ admin: null });
    return;
  }
  const session = await getSession(sid);
  if (!session) {
    res.json({ admin: null });
    return;
  }
  if (session.authProvider === "admin-local" && session.adminUserId) {
    const row = await findAdminById(session.adminUserId);
    if (!row) {
      res.json({ admin: null });
      return;
    }
    res.json({
      admin: shapeSelf(row, row.role as "admin" | "super_admin"),
    });
    return;
  }
  // OIDC sessions: surface a role of super_admin if the operator is on
  // the email allowlist, otherwise no admin identity. This lets the
  // dashboard render correctly for legacy SSO operators too.
  const role = await getAdminRole(req);
  if (!role) {
    res.json({ admin: null });
    return;
  }
  res.json({
    admin: {
      id: 0,
      username: session.user.email ?? "operator",
      role,
      via: "oidc" as const,
    },
  });
});

/**
 * Change the *signed-in* admin's own username and/or password. Other
 * admins must be edited from the Admins tab (super_admin only).
 */
router.post("/admin-auth/change", async (req: Request, res: Response) => {
  const sid = getSessionId(req);
  const session = sid ? await getSession(sid) : null;
  if (!session || session.authProvider !== "admin-local" || !session.adminUserId) {
    res.status(401).json({ error: "not_signed_in" });
    return;
  }
  const me = await findAdminById(session.adminUserId);
  if (!me) {
    res.status(401).json({ error: "not_signed_in" });
    return;
  }
  const currentPassword = String(req.body?.currentPassword ?? "");
  const newUsername = req.body?.newUsername
    ? String(req.body.newUsername).trim()
    : undefined;
  const newPassword = req.body?.newPassword
    ? String(req.body.newPassword)
    : undefined;
  if (!currentPassword) {
    res.status(400).json({ error: "current_password_required" });
    return;
  }
  if (!newUsername && !newPassword) {
    res.status(400).json({ error: "nothing_to_change" });
    return;
  }
  if (newUsername && !USERNAME_RE.test(newUsername)) {
    res.status(400).json({
      error: "invalid_username",
      message: "Use 3–64 letters, numbers, dot, underscore or dash.",
    });
    return;
  }
  if (
    newPassword &&
    (newPassword.length < MIN_PASSWORD || newPassword.length > MAX_PASSWORD)
  ) {
    res.status(400).json({
      error: "weak_password",
      message: `Password must be ${MIN_PASSWORD}–${MAX_PASSWORD} characters.`,
    });
    return;
  }
  const verified = await verifyAdminPassword(me.username, currentPassword);
  if (!verified) {
    res.status(401).json({ error: "invalid_current_password" });
    return;
  }
  try {
    if (newUsername && newUsername.toLowerCase() !== me.username.toLowerCase()) {
      await updateAdminUsername(me.id, newUsername);
    }
    if (newPassword) {
      await updateAdminPassword(me.id, newPassword);
    }
  } catch (err: unknown) {
    // Most likely a unique-constraint collision on the case-insensitive
    // username index. Surface a clean error for the UI.
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
  res.json({ ok: true });
});

function validateCredentials(
  username: string,
  password: string,
): { error: string; message?: string } | null {
  if (!username || !password) {
    return { error: "missing_credentials" };
  }
  if (!USERNAME_RE.test(username)) {
    return {
      error: "invalid_username",
      message: "Use 3–64 letters, numbers, dot, underscore or dash.",
    };
  }
  if (password.length < MIN_PASSWORD || password.length > MAX_PASSWORD) {
    return {
      error: "weak_password",
      message: `Password must be ${MIN_PASSWORD}–${MAX_PASSWORD} characters.`,
    };
  }
  return null;
}

function shapeSelf(
  row: { id: number; username: string; lastLoginAt: Date | null },
  role: "admin" | "super_admin",
) {
  return {
    id: row.id,
    username: row.username,
    role,
    lastLoginAt: row.lastLoginAt ? row.lastLoginAt.toISOString() : null,
    via: "admin-local" as const,
  };
}

export default router;
