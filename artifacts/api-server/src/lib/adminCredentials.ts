import bcrypt from "bcryptjs";
import { eq, sql } from "drizzle-orm";
import { db, adminUsersTable, siteSettingsTable } from "@workspace/db";
import { getSiteSettings, invalidateSiteSettings } from "./siteSettings.ts";
import { logger } from "./logger.ts";

/** Synthetic user-id prefix used for the admin-local session's `user.id`.
 *  Combined with the numeric admin_users.id so different admins get
 *  distinct session identities (useful for audit/debug). */
export const LOCAL_ADMIN_USER_ID_PREFIX = "local-admin:";

export type AdminRole = "admin" | "super_admin";

export const USERNAME_RE = /^[a-zA-Z0-9._-]{3,64}$/;
export const MIN_PASSWORD = 8;
export const MAX_PASSWORD = 200;

export function localAdminSessionUserId(adminUserId: number): string {
  return `${LOCAL_ADMIN_USER_ID_PREFIX}${adminUserId}`;
}

/**
 * One-time migration from the legacy single-admin model
 * (site_settings.admin_username/admin_password_hash) to the new
 * admin_users table. If the table is empty AND legacy credentials
 * exist, copy them across as a super_admin and null the legacy
 * columns so they can never be used again.
 *
 * No bootstrap fallback — when no admins exist at all the UI shows a
 * first-run registration screen instead of generating a random
 * password. That removes the single point of weakness where the
 * password was printed to the console on every fresh boot.
 */
export async function migrateAdminCredentials(): Promise<void> {
  const [{ count }] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(adminUsersTable);
  if (Number(count) > 0) return;

  const settings = await getSiteSettings();
  if (!settings.adminUsername || !settings.adminPasswordHash) return;

  await db.insert(adminUsersTable).values({
    username: settings.adminUsername,
    passwordHash: settings.adminPasswordHash,
    role: "super_admin",
  });
  await db
    .update(siteSettingsTable)
    .set({ adminUsername: null, adminPasswordHash: null })
    .where(eq(siteSettingsTable.id, 1));
  invalidateSiteSettings();
  logger.info(
    { username: settings.adminUsername },
    "Migrated legacy admin credentials into admin_users as super_admin",
  );
}

export async function adminUsersCount(): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(adminUsersTable);
  return Number(row?.count ?? 0);
}

export async function superAdminCount(): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(adminUsersTable)
    .where(eq(adminUsersTable.role, "super_admin"));
  return Number(row?.count ?? 0);
}

export async function findAdminByUsername(
  username: string,
): Promise<typeof adminUsersTable.$inferSelect | null> {
  const [row] = await db
    .select()
    .from(adminUsersTable)
    .where(sql`lower(${adminUsersTable.username}) = lower(${username})`);
  return row ?? null;
}

export async function findAdminById(
  id: number,
): Promise<typeof adminUsersTable.$inferSelect | null> {
  const [row] = await db
    .select()
    .from(adminUsersTable)
    .where(eq(adminUsersTable.id, id));
  return row ?? null;
}

export async function verifyAdminPassword(
  username: string,
  password: string,
): Promise<typeof adminUsersTable.$inferSelect | null> {
  const row = await findAdminByUsername(username);
  if (!row) return null;
  const ok = await bcrypt.compare(password, row.passwordHash);
  return ok ? row : null;
}

export async function createAdmin(args: {
  username: string;
  password: string;
  role: AdminRole;
  createdById?: number | null;
}): Promise<typeof adminUsersTable.$inferSelect> {
  const passwordHash = await bcrypt.hash(args.password, 12);
  const [row] = await db
    .insert(adminUsersTable)
    .values({
      username: args.username,
      passwordHash,
      role: args.role,
      createdById: args.createdById ?? null,
    })
    .returning();
  return row!;
}

export async function updateAdminPassword(
  id: number,
  newPassword: string,
): Promise<void> {
  const passwordHash = await bcrypt.hash(newPassword, 12);
  await db
    .update(adminUsersTable)
    .set({ passwordHash })
    .where(eq(adminUsersTable.id, id));
}

export async function updateAdminUsername(
  id: number,
  newUsername: string,
): Promise<void> {
  await db
    .update(adminUsersTable)
    .set({ username: newUsername })
    .where(eq(adminUsersTable.id, id));
}

export async function updateAdminRole(
  id: number,
  role: AdminRole,
): Promise<void> {
  await db
    .update(adminUsersTable)
    .set({ role })
    .where(eq(adminUsersTable.id, id));
}

export async function deleteAdmin(id: number): Promise<void> {
  await db.delete(adminUsersTable).where(eq(adminUsersTable.id, id));
}

export async function touchLastLogin(id: number): Promise<void> {
  await db
    .update(adminUsersTable)
    .set({ lastLoginAt: new Date() })
    .where(eq(adminUsersTable.id, id));
}
