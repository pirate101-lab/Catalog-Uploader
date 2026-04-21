import type { Request, Response, NextFunction } from "express";
import { findAdminById, type AdminRole } from "../lib/adminCredentials";
import { clearSession, getSession, getSessionId } from "../lib/auth";

function getAdminEmails(): Set<string> {
  const raw = process.env["ADMIN_EMAILS"] ?? "";
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

export async function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  // For local-admin sessions, re-validate that the underlying
  // admin_users row still exists. Without this check a deleted admin
  // could continue using their cookie until it expires — a textbook
  // session-revocation bug. We also clear the cookie so the browser
  // immediately bounces them to the login screen.
  if (req.authProvider === "admin-local") {
    const sid = getSessionId(req);
    const session = sid ? await getSession(sid) : null;
    const adminUserId = session?.adminUserId;
    if (!adminUserId) {
      await clearSession(res, sid);
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const row = await findAdminById(adminUserId);
    if (!row) {
      await clearSession(res, sid);
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    next();
    return;
  }
  // Admin access is only granted to OIDC-authenticated identities. Storefront
  // password sessions have no email-ownership proof, so an attacker who
  // registers with an admin email must NEVER gain admin access through
  // matching the allowlist alone.
  if (req.authProvider !== "oidc") {
    res.status(403).json({ error: "Admin access requires SSO sign-in" });
    return;
  }
  const allowlist = getAdminEmails();
  const email = (req.user.email ?? "").toLowerCase();
  // If allowlist is empty, allow any authenticated user in development so the
  // dashboard is usable on first run, but DENY in production to avoid an
  // accidental privilege-escalation by misconfiguration.
  if (allowlist.size === 0) {
    if (process.env["NODE_ENV"] === "production") {
      req.log.error(
        "ADMIN_EMAILS is not set in production — refusing admin access",
      );
      res.status(403).json({
        error:
          "Admin access is not configured. Set ADMIN_EMAILS to a comma-separated list of allowed accounts.",
      });
      return;
    }
    req.log.warn(
      "ADMIN_EMAILS is not set — every authenticated user has admin access (dev only)",
    );
    next();
    return;
  }
  if (!email || !allowlist.has(email)) {
    res.status(403).json({ error: "Not authorized for admin access" });
    return;
  }
  next();
}

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const allowlist = getAdminEmails();
  if (allowlist.size === 0) return process.env["NODE_ENV"] !== "production";
  return allowlist.has(email.toLowerCase());
}

// Convenience for the /api/auth/admin-status endpoint: only OIDC sessions
// can ever be admins, mirroring the requireAdmin middleware.
export function isOidcAdmin(req: { authProvider?: string; user?: { email?: string | null } | null }): boolean {
  // Local-admin sessions are always admins. OIDC sessions must match
  // the email allowlist. Anything else (storefront password) never is.
  if (req.authProvider === "admin-local") return true;
  if (req.authProvider !== "oidc") return false;
  return isAdminEmail(req.user?.email ?? null);
}

/**
 * Resolve the effective admin role for a request:
 *   - admin-local sessions read from admin_users.role (fresh from DB,
 *     so a demotion applied moments earlier takes effect immediately)
 *   - OIDC admins are treated as super_admin (legacy operators
 *     configured outside the dashboard) so the dashboard remains fully
 *     usable for them after the migration.
 *   - Anything else has no role.
 */
export async function getAdminRole(
  req: Request,
): Promise<AdminRole | null> {
  if (!req.isAuthenticated()) return null;
  if (req.authProvider === "admin-local") {
    const sid = getSessionId(req);
    if (!sid) return null;
    const session = await getSession(sid);
    const id = session?.adminUserId;
    if (!id) return null;
    const row = await findAdminById(id);
    if (!row) return null;
    return row.role as AdminRole;
  }
  if (isOidcAdmin(req)) return "super_admin";
  return null;
}

/**
 * Express middleware: only allow super_admin (or OIDC admin). Returns
 * 403 with `{ error: "super_admin_required" }` so the UI can surface a
 * specific message.
 */
export async function requireSuperAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const role = await getAdminRole(req);
  if (role !== "super_admin") {
    // Spec error contract: the dashboard expects a generic `forbidden`
    // for every role-gated denial so smoke tests and the UI's error
    // mapper can rely on a single token.
    res.status(403).json({ error: "forbidden" });
    return;
  }
  next();
}
