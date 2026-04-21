import crypto from "crypto";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db, siteSettingsTable } from "@workspace/db";
import { getSiteSettings, invalidateSiteSettings } from "./siteSettings";
import { logger } from "./logger";

const DEFAULT_USERNAME = "admin";
const PASSWORD_LEN = 16;

/** Synthetic admin user id used for the local-admin session. Distinct
 *  from any real `users.id` so admin-local sessions can never be
 *  confused with a customer's storefront login. */
export const LOCAL_ADMIN_USER_ID = "local-admin";

/** Letters+digits without ambiguous chars (no 0/O/1/l/I) so the
 *  generated password is safe to read from the console. */
const PASSWORD_ALPHABET =
  "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

function generatePassword(len = PASSWORD_LEN): string {
  const bytes = crypto.randomBytes(len);
  let out = "";
  for (let i = 0; i < len; i += 1) {
    out += PASSWORD_ALPHABET[bytes[i]! % PASSWORD_ALPHABET.length];
  }
  return out;
}

/**
 * Make sure there's a working admin username/password on first boot.
 * If the credentials are missing, generate a random password and log
 * it ONCE so the operator can sign in. Subsequent boots are no-ops.
 */
export async function ensureAdminCredentials(): Promise<void> {
  const settings = await getSiteSettings();
  if (settings.adminUsername && settings.adminPasswordHash) return;

  const username = settings.adminUsername ?? DEFAULT_USERNAME;
  const password = generatePassword();
  const hash = await bcrypt.hash(password, 12);

  await db
    .update(siteSettingsTable)
    .set({ adminUsername: username, adminPasswordHash: hash })
    .where(eq(siteSettingsTable.id, 1));
  invalidateSiteSettings();

  // Banner is intentionally loud — this password will only ever be
  // shown once. After the first sign-in the operator should rotate it
  // from the admin Account page.
  const bar = "=".repeat(60);
  logger.warn(
    `\n${bar}\n  ADMIN CREDENTIALS BOOTSTRAPPED — change these after sign-in\n  Visit /admin/login\n  Username: ${username}\n  Password: ${password}\n${bar}\n`,
  );
}

export async function verifyAdminPassword(
  username: string,
  password: string,
): Promise<boolean> {
  const settings = await getSiteSettings();
  if (!settings.adminUsername || !settings.adminPasswordHash) return false;
  if (settings.adminUsername !== username) return false;
  return bcrypt.compare(password, settings.adminPasswordHash);
}

export async function updateAdminCredentials(args: {
  newUsername?: string;
  newPassword?: string;
}): Promise<void> {
  const patch: { adminUsername?: string; adminPasswordHash?: string } = {};
  if (args.newUsername) patch.adminUsername = args.newUsername;
  if (args.newPassword)
    patch.adminPasswordHash = await bcrypt.hash(args.newPassword, 12);
  if (Object.keys(patch).length === 0) return;
  await db
    .update(siteSettingsTable)
    .set(patch)
    .where(eq(siteSettingsTable.id, 1));
  invalidateSiteSettings();
}
