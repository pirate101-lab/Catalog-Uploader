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
- **`artifacts/api-server`** — Express API for storefront (`src/routes/storefront.ts`) and checkout stubs (`src/routes/checkout.ts`). Reads from `data/catalog_lite.json` (5 MB, 18,302 products) via `src/lib/catalog.ts`. Service binds `PORT=8080`, paths `/api`.
- **`artifacts/mockup-sandbox`** — design canvas (untouched).

## Catalog images (Cloudflare R2)

- 18,302 webp images uploaded to R2 bucket `velour-catalog` under prefix `catalog/replit_lite/images/<category>/<id>.webp`.
- Public CDN base: `R2_PUBLIC_BASE_URL=https://pub-4ad1632e283f4eecafd71b3d7d6c4318.r2.dev` (managed public access).
- API server rewrites image paths to absolute R2 URLs in `artifacts/api-server/src/lib/catalog.ts` (no client-side env needed).
- Re-upload script: `pnpm --filter @workspace/api-server exec node scripts/upload-r2.mjs <source-dir>` (idempotent, skip-if-exists, concurrency 80, immutable cache).
- Public, non-sensitive config in shared env vars: `R2_BUCKET`, `R2_PUBLIC_BASE_URL`.
- The S3 credentials needed only by `scripts/upload-r2.mjs` (`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_S3_ENDPOINT`, `R2_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`) are NOT stored in the repo. To re-run the upload, add them as Replit Secrets via the Secrets tab and they will be injected at runtime. The runtime API server does not need them — only the public base URL.
