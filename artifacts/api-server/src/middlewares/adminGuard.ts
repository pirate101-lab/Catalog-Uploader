import type { Request, Response, NextFunction } from "express";

function getAdminEmails(): Set<string> {
  const raw = process.env["ADMIN_EMAILS"] ?? "";
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Authentication required" });
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
  if (req.authProvider !== "oidc") return false;
  return isAdminEmail(req.user?.email ?? null);
}
