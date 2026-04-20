# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.

## Artifacts

- **`artifacts/fashion`** — VELOUR women's fashion storefront (React + Vite). Reads catalog via `/api/storefront/*`. Vite dev proxies `/api → ${API_PROXY_TARGET}` (set in `artifact.toml [services.env]`). Service binds `PORT=25246`.
- **`artifacts/api-server`** — Express API for storefront (`src/routes/storefront.ts`) and checkout stubs (`src/routes/checkout.ts`). Reads from `data/catalog_lite.json` (18,302 women's products) and `data/catalog_men_lite.json` (2,361 men's products) via `src/lib/catalog.ts`, which merges them and tags each row with `gender: "women" | "men"`. Men's IDs are namespaced with an `m-` prefix to avoid collisions. Service binds `PORT=8080`, paths `/api`. Storefront endpoints accept `?gender=men|women`.
- **`artifacts/mockup-sandbox`** — design canvas (untouched).

## Catalog images (Cloudflare R2)

- 18,302 women's webp images uploaded to R2 bucket `velour-catalog` under prefix `catalog/replit_lite/images/<category>/<id>.webp`, plus 2,361 men's webp images under `catalog/replit_lite_men/images/<category>/<id>.webp`. Both have the same 3 width variants (`_400`, `_800`, `_1600`).
- Re-upload the men's set: `pnpm --filter @workspace/api-server exec node scripts/upload-r2.mjs catalog/replit_lite_men/images catalog/replit_lite_men/images` (script accepts an optional R2 prefix as second arg, or `R2_PREFIX` env override).
- Public CDN base: `R2_PUBLIC_BASE_URL=https://pub-4ad1632e283f4eecafd71b3d7d6c4318.r2.dev` (managed public access).
- API server rewrites image paths to absolute R2 URLs in `artifacts/api-server/src/lib/catalog.ts` (no client-side env needed).
- Re-upload script: `pnpm --filter @workspace/api-server exec node scripts/upload-r2.mjs <source-dir>` (idempotent, skip-if-exists, concurrency 80, immutable cache).
- Public, non-sensitive config in shared env vars: `R2_BUCKET`, `R2_PUBLIC_BASE_URL`.
- The S3 credentials needed only by `scripts/upload-r2.mjs` (`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_S3_ENDPOINT`, `R2_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`) are NOT stored in the repo. To re-run the upload, add them as Replit Secrets via the Secrets tab and they will be injected at runtime. The runtime API server does not need them — only the public base URL.

## Reviews

- Schema: `reviewsTable` in `lib/db/src/schema/admin.ts` (`reviews` table). Columns include `product_id`, `user_id`, `email`, `name`, `rating` (1–5), `title`, `body`, `verified_purchase`, `seeded`, `created_at`. Indexed on `product_id`.
- Push schema after edits: `pnpm --filter @workspace/db run push`.
- Storefront endpoints live in `artifacts/api-server/src/routes/storefront.ts`:
  - `GET /api/storefront/products/:id/reviews` — public list + summary (`{reviews, count, average}`).
  - `GET /api/storefront/products/:id/reviews/eligibility` — returns `{canReview, reason?, defaultName?}`. Reasons: `not_authenticated`, `no_email`, `not_a_buyer`, `already_reviewed`.
  - `POST /api/storefront/products/:id/reviews` — buyer-gated. Requires Replit Auth session AND a matching paid order (status in `paid|fulfilled|shipped|delivered|completed`) on the same email containing the product. One review per user per product (returns 409 otherwise).
- Seed script: `pnpm --filter @workspace/api-server exec node scripts/seed-reviews.mjs`. Flags: `--products N`, `--per-min N`, `--per-max N`, `--gender women|men|all`, `--reset` (only deletes rows where `seeded=true`), `--dry-run`. Defaults to ~200 products × 3–8 reviews. Ratings are weighted (5★ 55%, 4★ 30%, 3★ 10%, 2★ 4%, 1★ 1%). Seeded rows have `verified_purchase=false` and `seeded=true` so production reviews are never touched.
