import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

/**
 * Cross-process rate-limit state. Each row is a "bucket" identified by
 * an opaque key (e.g. `lookup:ip:1.2.3.4` or `test-email:user@x.com`)
 * and stores the unix-ms timestamps of recent successful submissions.
 *
 * Centralising the buckets in Postgres lets multiple API replicas
 * enforce a single shared limit. A hostile caller can no longer bypass
 * the throttle by load-balancing across processes, and the bucket
 * survives deploys instead of resetting on every restart.
 */
export const rateLimitBucketsTable = pgTable(
  "rate_limit_buckets",
  {
    key: text("key").primaryKey(),
    recent: jsonb("recent").$type<number[]>().notNull().default([]),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    // Supports the hourly `pruneStaleBuckets` cleanup
    // (`DELETE ... WHERE updated_at < cutoff`). Without this, the
    // cleanup degrades to a sequential scan over every bucket row as
    // the table grows.
    index("rate_limit_buckets_updated_at_idx").on(table.updatedAt),
  ],
);

export type RateLimitBucket = typeof rateLimitBucketsTable.$inferSelect;
