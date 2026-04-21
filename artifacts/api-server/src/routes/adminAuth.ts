import { Router, type IRouter, type Request, type Response } from "express";
import {
  ensureAdminCredentials,
  LOCAL_ADMIN_USER_ID,
  updateAdminCredentials,
  verifyAdminPassword,
} from "../lib/adminCredentials";
import {
  clearSession,
  createSession,
  getSessionId,
  SESSION_COOKIE,
  SESSION_TTL,
  type SessionData,
} from "../lib/auth";

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

const USERNAME_RE = /^[a-zA-Z0-9._-]{3,64}$/;

router.post("/admin-auth/login", async (req: Request, res: Response) => {
  // Lazy bootstrap so the first ever login attempt can never race with
  // server start: if the admin row was wiped, ensure() restores it and
  // the operator just has to look at the next server-log line.
  await ensureAdminCredentials();
  const username = String(req.body?.username ?? "").trim();
  const password = String(req.body?.password ?? "");
  if (!username || !password) {
    res.status(400).json({ error: "missing_credentials" });
    return;
  }
  const ok = await verifyAdminPassword(username, password);
  if (!ok) {
    res.status(401).json({ error: "invalid_credentials" });
    return;
  }
  const sessionData: SessionData = {
    user: {
      id: LOCAL_ADMIN_USER_ID,
      email: null,
      firstName: "Admin",
      lastName: null,
      profileImageUrl: null,
    },
    access_token: "admin-local",
    authProvider: "admin-local",
  };
  const sid = await createSession(sessionData);
  setSessionCookie(res, sid);
  res.json({ ok: true, user: sessionData.user });
});

router.post("/admin-auth/logout", async (req: Request, res: Response) => {
  const sid = getSessionId(req);
  await clearSession(res, sid);
  res.json({ ok: true });
});

router.post("/admin-auth/change", async (req: Request, res: Response) => {
  // Reuse the same admin guard semantics — require an active admin
  // session before letting anyone rotate the credentials.
  const { requireAdmin } = await import("../middlewares/adminGuard");
  requireAdmin(req, res, async () => {
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
    if (newPassword && (newPassword.length < 8 || newPassword.length > 200)) {
      res.status(400).json({
        error: "weak_password",
        message: "Password must be 8–200 characters.",
      });
      return;
    }
    // Require the *current* admin password to confirm intent — even an
    // already-signed-in admin shouldn't be able to silently swap the
    // credentials (e.g. if the laptop is left unlocked).
    const { adminUsername } = await (
      await import("../lib/siteSettings")
    ).getSiteSettings();
    if (!adminUsername) {
      res.status(400).json({ error: "no_admin_user" });
      return;
    }
    const ok = await verifyAdminPassword(adminUsername, currentPassword);
    if (!ok) {
      res.status(401).json({ error: "invalid_current_password" });
      return;
    }
    await updateAdminCredentials({ newUsername, newPassword });
    res.json({ ok: true });
  });
});

export default router;
