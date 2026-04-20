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
- All four templates include a "Visit the shop" CTA button + footer link back to the storefront. The URL comes from `PUBLIC_SITE_URL` (preferred, set in production), falls back to `REPLIT_DEV_DOMAIN` for previews, and finally to `https://shopthelook.page`.

## Admin dashboard

- Pages live in `artifacts/fashion/src/admin/` and are routed in `App.tsx`. `AdminShell` provides the left-rail nav and the shared `requireAdmin` shell.
- Tabs: **Overview** (Dashboard), **Hero Slides**, **Products**, **Orders**, **Customers**, **Reviews**, **Emails**, **Settings**.
- Endpoints (all behind `requireAdmin`):
  - `GET /api/admin/overview` — single-roundtrip aggregate: orders + revenue + AOV for today / 7d / 30d windows, full status funnel (`new | packed | shipped | delivered | cancelled`), top 5 best-selling products (qty + revenue, by unnesting `orders.items` JSONB), and the 10 most recent orders. Used by the Overview tab.
  - `GET /api/admin/email-events?status=&limit=&offset=` — paginated tail of `order_email_events` for the Emails tab. Optional `status` filter (`sent | failed | skipped`).
  - `GET /api/admin/reviews?productId=&limit=&offset=` and `DELETE /api/admin/reviews/:id` (existing) power the Reviews moderation tab.
- New site settings columns (`siteSettingsTable` in `lib/db/src/schema/admin.ts`):
  - `hero_auto_advance` (bool, default true) — surfaced in the storefront via `GET /storefront/settings.heroAutoAdvance`. The home page reads it and passes `intervalMs={0|6000}` to `<HeroSlider>` so disabling it stops the timer (arrow keys still navigate).
  - `allow_guest_reviews` (bool, default false) — placeholder for a future moderation rule; persisted today, not yet enforced (reviews still require a signed-in buyer with a delivered order).
- After schema edits run `pnpm --filter @workspace/db run push` so the new columns land before the API restarts.

### Testing the email pipeline end-to-end

1. **Sender / config sanity** — in the admin under *Settings → Email*, click **Send test email** to confirm Resend accepts the From / Reply-To headers without placing a real order.
2. **Received** — submit any checkout from the storefront (`POST /api/checkout/submit`). Inbox should receive *"We received your order #XXXXXXXX"* within seconds.
3. **Confirmation** — open the resulting order in `/admin/orders/:id` and click the **Packed** status button. Inbox should receive *"Your order #XXXXXXXX is confirmed"*.
4. **Shipped / Delivered** — click **Shipped** and then **Delivered** on the same order; one email per transition.
5. **Resend** — on the same admin order detail, hit the **Resend** button next to any kind. The corresponding template should arrive again, and the timestamp + status pill in the Emails card should refresh in place.
6. **Failure surface** — temporarily unset `RESEND_API_KEY` (or send to an invalid address via the test endpoint) to confirm the red "one or more emails didn't send" banner appears with the provider error and that the latest event for the affected kind shows `failed` / `skipped`.

## Site audit (Task #19)

Pragmatic perf + correctness pass; no behaviour changes other than what's listed.

- **Storefront bundle (code-split admin)**: in `App.tsx`, all eight admin pages (`Dashboard`, `HeroAdmin`, `ProductsAdmin`, `OrdersAdmin` + `OrderDetailAdmin`, `CustomersAdmin`, `ReviewsAdmin`, `EmailsAdmin`, `SettingsAdmin`) are loaded via `React.lazy`. A single `<Suspense fallback={<AdminFallback/>}>` wraps the top-level `<Switch>` so the original flat route list (`/admin`, `/admin/orders/:id`, etc.) keeps matching exactly the same paths it did before — only the chunk fetch is deferred until first admin navigation. Storefront visitors no longer download the moderation UIs.
- **Grid re-render cost**: `ProductCard` is wrapped in `React.memo` with a custom comparator `(prev.product === next.product)`. Filter / hover state in `Shop.tsx` and `Home.tsx` no longer rerun every tile in 24+ card grids; only the cards whose product object changes render. Product object identity is already stable across pages — `ProductsContext.search()` returns fresh arrays only when results change.
- **Footer dead links**: the four `href="#"` anchors (Contact, Terms, Privacy, Cookies) were replaced with buttons that show a placeholder toast (Contact → email address, legal → "coming soon"). This eliminates the "click → SPA bounces to homepage" misbehaviour without preempting the dedicated legal-pages task.

### Audit verifications (no code change required)

- **Image pipeline already optimal**: `ProductImage` (`src/components/ProductImage.tsx`) emits a real width-descriptor `srcSet` (400 / 800 / 1600 webp variants from R2) plus the caller-supplied `sizes`, sets `decoding="async"`, and toggles `loading`/`fetchPriority` based on `priority`. `ProductDetail.tsx` and `HeroSlider.tsx` issue an explicit `<link rel="preload" as="image">` for the LCP frame using the matching srcset/sizes, so no further work needed.
- **Fonts**: `index.html` already preconnects to `fonts.googleapis.com` + `fonts.gstatic.com` (with `crossorigin`) and uses `display=swap` on the Google Fonts URL.
- **Backend hot endpoints — p95 benchmark**: 80 sequential requests per endpoint after a 5-request warm-up, measured against the local API server (`:8080`) with the reproducible `node artifacts/api-server/scripts/bench-storefront.mjs` script (env: `API_URL`, `BENCH_N`, `BENCH_WARMUP`). Target was p95 < 200 ms; actual results are an order of magnitude under that:

  | Endpoint | min | p50 | **p95** | max |
  |---|---|---|---|---|
  | `GET /api/storefront/products?limit=24` | 2.0 ms | 2.5 ms | **3.4 ms** | 3.7 ms |
  | `GET /api/storefront/products?limit=24&category=Dresses&gender=women&sort=price-asc` | 4.3 ms | 5.0 ms | **7.9 ms** | 9.5 ms |
  | `GET /api/storefront/products/:id/reviews?limit=20` | 1.4 ms | 1.9 ms | **2.5 ms** | 3.3 ms |

  Catalog is read from JSON into memory at server boot and filtered/sorted in-process, so no DB index work is needed for the products paths. The reviews endpoint hits Postgres but reads `reviewsTable` via the `product_id` index plus the cached `productReviewSummaryTable` aggregate. The DB-backed admin endpoints (`/admin/overview`, `/admin/orders`, `/admin/email-events`) already use `Promise.all` parallelism and indexed columns (`orders.created_at`, `order_email_events.created_at`).

- **Mobile tap targets**: bumped `ProductCard` wishlist + quick-add buttons from `w-9 h-9` (36 px) to `w-10 h-10` (40 px). Footer Contact + legal placeholder buttons gain `min-h-[40px]` so they meet the 40 px guideline without changing the visible label height.

### Known residual issues (not addressed in this audit)

- Terms / Privacy / Cookies and Contact still need real pages — placeholder toasts are a stopgap until the dedicated legal-pages task ships.
- Newsletter subscribe form in the footer toasts success but does not yet POST to a backend endpoint (separate "newsletter capture wiring" task).
- Search overlay's `initialQuery` `useEffect` deliberately omits `initialQuery` from deps; behaviour is intentional (snapshot at open) but lints with a comment override.
