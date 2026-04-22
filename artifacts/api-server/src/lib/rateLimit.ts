import { eq, sql } from "drizzle-orm";
import { db, rateLimitBucketsTable } from "@workspace/db";

/**
 * Cross-process sliding-window rate limiter backed by the
 * `rate_limit_buckets` Postgres table.
 *
 * Semantics intentionally match the previous in-memory implementation
 * used by `routes/storefront.ts` (order lookup) and `routes/admin.ts`
 * (test-email send): a bucket holds the unix-ms timestamps of recent
 * successful submissions, falling outside the window expires them, and
 * an optional `minGapMs` enforces a soft "please wait a moment" gap
 * between back-to-back attempts.
 *
 * Concurrency: the read-modify-write happens inside a transaction with
 * a row-level `FOR UPDATE` lock so two replicas hitting the same
 * bucket simultaneously serialise instead of racing past the limit.
 */
export interface QuotaOptions {
  /** Bucket key (callers should namespace, e.g. `lookup:ip:1.2.3.4`). */
  key: string;
  /** Sliding window length in milliseconds. */
  windowMs: number;
  /** Maximum successful submissions allowed within the window. */
  limit: number;
  /** Optional minimum gap between successive submissions, in ms. */
  minGapMs?: number;
}

export type QuotaResult =
  | { ok: true }
  | {
      ok: false;
      /** Why the quota rejected — lets callers pick a user-facing message. */
      kind: "gap" | "limit";
      /** Suggested wait before retrying, in milliseconds. */
      retryAfterMs: number;
    };

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function checkQuota(opts: QuotaOptions): Promise<QuotaResult> {
  const { key, windowMs, limit, minGapMs } = opts;
  const now = Date.now();
  const windowAgo = now - windowMs;

  return await db.transaction(async (tx: Tx) => {
    // Serialise on the bucket key BEFORE the SELECT. A plain
    // `SELECT ... FOR UPDATE` only locks an existing row; on a fresh
    // key (the common first-request case) two replicas would each see
    // "no row", each let the request through, and then race their
    // upserts — silently raising the effective limit. The advisory
    // lock is held for the transaction and released on commit, so
    // concurrent callers on the same key serialise here regardless of
    // whether the row exists yet.
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${key}))`,
    );
    const rows = await tx
      .select({ recent: rateLimitBucketsTable.recent })
      .from(rateLimitBucketsTable)
      .where(eq(rateLimitBucketsTable.key, key))
      .for("update");

    const recentRaw = rows[0]?.recent ?? [];
    // jsonb survives the round-trip as a JS array; coerce defensively
    // in case a legacy row stored something else.
    const recent: number[] = Array.isArray(recentRaw)
      ? recentRaw.filter(
          (n): n is number => typeof n === "number" && n > windowAgo,
        )
      : [];

    if (minGapMs && recent.length > 0) {
      const last = recent[recent.length - 1] ?? 0;
      const gap = now - last;
      if (gap < minGapMs) {
        // Persist the pruned `recent` so the row doesn't grow unbounded
        // even when every request is being rejected for the gap.
        await persist(tx, key, recent);
        return {
          ok: false as const,
          kind: "gap" as const,
          retryAfterMs: minGapMs - gap,
        };
      }
    }

    if (recent.length >= limit) {
      const earliest = recent[0] ?? now;
      await persist(tx, key, recent);
      return {
        ok: false as const,
        kind: "limit" as const,
        retryAfterMs: windowMs - (now - earliest),
      };
    }

    recent.push(now);
    await persist(tx, key, recent);
    return { ok: true as const };
  });
}

async function persist(tx: Tx, key: string, recent: number[]): Promise<void> {
  await tx
    .insert(rateLimitBucketsTable)
    .values({ key, recent })
    .onConflictDoUpdate({
      target: rateLimitBucketsTable.key,
      set: { recent, updatedAt: sql`now()` },
    });
}
