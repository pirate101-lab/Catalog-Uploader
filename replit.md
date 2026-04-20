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

- Schema: `reviewsTable` in `lib/db/src/schema/admin.ts` (`reviews` table). Columns: `product_id`, `user_id`, `order_id` (FK → `orders.id`, `ON DELETE SET NULL`), `email`, `name`, `rating` (1–5), `title`, `body`, `verified_purchase`, `seeded`, `created_at`. Indexed on `product_id`. Partial unique index `UX_reviews_user_product` on `(product_id, user_id) WHERE user_id IS NOT NULL` enforces one review per real user per product (seeded rows with `user_id=NULL` are exempt).
- Push schema after edits: `pnpm --filter @workspace/db run push`.
- Storefront endpoints live in `artifacts/api-server/src/routes/storefront.ts`:
  - `GET /api/storefront/products/:id/reviews` — public list + summary (`{reviews, count, average}`).
  - `GET /api/storefront/products/:id/reviews/eligibility` — returns `{canReview, reason?, defaultName?}`. Reasons: `not_authenticated`, `no_email`, `not_a_buyer`, `already_reviewed`.
  - `POST /api/storefront/products/:id/reviews` — buyer-gated. Validated with zod (`reviewSubmissionSchema`). Requires a Replit Auth session AND a completed order (status `delivered` — the terminal state in the `orders` lifecycle `new | packed | shipped | delivered | cancelled`) on the same email containing the product. The qualifying `order_id` is persisted on the review row. One review per user per product (DB-level partial unique index → 409 on conflict).
- Seed script: `pnpm --filter @workspace/api-server exec node scripts/seed-reviews.mjs`. Flags: `--products N`, `--per-min N`, `--per-max N`, `--gender women|men|all`, `--reset` (only deletes rows where `seeded=true`), `--dry-run`. Defaults to ~200 products × 3–8 reviews. Ratings are weighted (5★ 55%, 4★ 30%, 3★ 10%, 2★ 4%, 1★ 1%). Seeded rows have `verified_purchase=false`, `seeded=true`, and `user_id=NULL` so production reviews are never touched and the unique index is not triggered.

## Order emails

- Four templates live in `artifacts/api-server/src/lib/email.ts`. The `OrderEmailKind` union is `received | confirmation | shipped | delivered`; `ORDER_EMAIL_KINDS` exports the same list for the admin UI.
- Lifecycle:
  - **received** — fired automatically from `POST /api/checkout/submit` the moment the order row is inserted, so the customer always gets an immediate receipt with line items, totals, and shipping address.
  - **confirmation** — fired when admin moves an order from `new → packed` (status transition in `PATCH /api/admin/orders/:id`). Reads as "your order is confirmed and being packed", not as a duplicate receipt.
  - **shipped** / **delivered** — fired on the matching status transition. Lighter templates (line items + total, no breakdown / address).
- All sends go through one helper (`sendOrderEmail`) that:
  - Uses an HTML wrapper with `<meta name="color-scheme" content="light">` + explicit hex colours so Gmail / Apple Mail / Outlook web don't invert the palette in dark mode.
  - Records every attempt to `order_email_events` (status `sent | failed | skipped`, with status code + error message). `kind` is `varchar(24)` so the new `received` value fits without a migration.
  - Retries once with a 500 ms backoff on transient failures (5xx HTTP responses or network errors). Permanent failures (4xx) are not retried.
- Admin order detail (`/admin/orders/:id`) shows one row per kind via `EmailEventsCard` with status pill, error detail, and a per-kind **Resend** button that calls `POST /api/admin/orders/:id/resend-email { kind }`. A red "one or more emails didn't send" banner appears at the top when any event for that order is `failed` or `skipped` so staff don't have to scan the list.
- Sender / Reply-To branding still comes from `siteSettingsTable` (`emailFromAddress`, `emailFromName`, `emailReplyTo`). When `RESEND_API_KEY` is unset, sends are recorded as `skipped` with an explanatory message rather than throwing — keeps checkout / admin actions working in environments without an email provider.
