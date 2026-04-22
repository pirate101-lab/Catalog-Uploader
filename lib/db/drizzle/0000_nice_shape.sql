-- Targeted migration: add the index that backs the hourly
-- `pruneStaleBuckets` cleanup (`DELETE FROM rate_limit_buckets
-- WHERE updated_at < cutoff`). Without this, the cleanup degrades
-- to a sequential scan as the table grows.
--
-- The rest of the schema in this project is synced via
-- `drizzle-kit push` (see `lib/db/package.json`), so this is the
-- first migration file in the directory.
CREATE INDEX IF NOT EXISTS "rate_limit_buckets_updated_at_idx" ON "rate_limit_buckets" USING btree ("updated_at");
