import { db, siteSettingsTable, type SiteSettings } from "@workspace/db";
import { eq } from "drizzle-orm";

let cache: SiteSettings | null = null;
let cacheUntil = 0;
const TTL_MS = 5_000;

export async function getSiteSettings(): Promise<SiteSettings> {
  const now = Date.now();
  if (cache && now < cacheUntil) return cache;
  const [row] = await db
    .select()
    .from(siteSettingsTable)
    .where(eq(siteSettingsTable.id, 1));
  if (row) {
    cache = row;
    cacheUntil = now + TTL_MS;
    return row;
  }
  const [created] = await db
    .insert(siteSettingsTable)
    .values({ id: 1 })
    .returning();
  cache = created;
  cacheUntil = now + TTL_MS;
  return created;
}

export function invalidateSiteSettings(): void {
  cache = null;
  cacheUntil = 0;
}
