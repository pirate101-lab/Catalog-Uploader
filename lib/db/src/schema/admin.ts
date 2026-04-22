import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

export const heroSlidesTable = pgTable("hero_slides", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  subtitle: text("subtitle"),
  kicker: text("kicker"),
  ctaLabel: text("cta_label"),
  ctaHref: text("cta_href"),
  imageUrl: text("image_url").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  active: boolean("active").notNull().default(true),
  // Targeting tag so admins can ship gender-specific hero sets. "all"
  // means the slide is shown regardless of which gender the shopper is
  // browsing — that's the back-compat default for any pre-existing rows.
  gender: varchar("gender", { length: 8 }).notNull().default("all"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
}, (table) => [
  check("CK_hero_slides_gender", sql`gender IN ('all','men','women')`),
]);

export type HeroSlide = typeof heroSlidesTable.$inferSelect;
export type InsertHeroSlide = typeof heroSlidesTable.$inferInsert;

export const productOverridesTable = pgTable("product_overrides", {
  productId: varchar("product_id").primaryKey(),
  featured: boolean("featured").notNull().default(false),
  hidden: boolean("hidden").notNull().default(false),
  priceOverride: numeric("price_override", { precision: 10, scale: 2 }),
  badge: text("badge"),
  stockLevel: integer("stock_level"),
  // T26 catalog management — admins can edit JSON catalog rows without
  // touching the file. Each *_override column shadows the corresponding
  // JSON field when set; null means "use the JSON value".
  categoryOverride: text("category_override"),
  subCategoryOverride: text("sub_category_override"),
  titleOverride: text("title_override"),
  imageUrlOverride: text("image_url_override"),
  sizesOverride: jsonb("sizes_override").$type<string[] | null>(),
  colorsOverride: jsonb("colors_override").$type<
    { name: string; hex: string; image?: string }[] | null
  >(),
  genderOverride: varchar("gender_override", { length: 8 }),
  // Soft-delete tombstone — rows with deleted_at set are filtered out
  // of the storefront entirely and only appear in the admin when the
  // operator toggles "include deleted". Restoring sets it back to NULL.
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type ProductOverride = typeof productOverridesTable.$inferSelect;
export type InsertProductOverride = typeof productOverridesTable.$inferInsert;

/**
 * Admin-authored products that live entirely in the database. Mirrors
 * the JSON catalog row shape so the storefront merge layer can union
 * them in without special-casing. IDs always carry a `cust_` prefix so
 * they cannot collide with the numeric Trendsi ids in the JSON catalog.
 */
export const customProductsTable = pgTable(
  "custom_products",
  {
    id: varchar("id").primaryKey(),
    title: text("title").notNull(),
    category: text("category").notNull(),
    subCategory: text("sub_category"),
    price: numeric("price", { precision: 10, scale: 2 }).notNull(),
    imageUrls: jsonb("image_urls")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    sizes: jsonb("sizes")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    colors: jsonb("colors")
      .$type<{ name: string; hex: string; image?: string }[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    gender: varchar("gender", { length: 8 }).notNull().default("women"),
    badge: text("badge"),
    featured: boolean("featured").notNull().default(false),
    hidden: boolean("hidden").notNull().default(false),
    stockLevel: integer("stock_level"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    check("CK_custom_products_gender", sql`gender IN ('men','women')`),
    check("CK_custom_products_id_prefix", sql`id LIKE 'cust_%'`),
  ],
);

export type CustomProduct = typeof customProductsTable.$inferSelect;
export type InsertCustomProduct = typeof customProductsTable.$inferInsert;

export const ordersTable = pgTable("orders", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  email: text("email").notNull(),
  customerName: text("customer_name"),
  shippingAddress: jsonb("shipping_address").notNull(),
  items: jsonb("items").notNull(),
  // The "charge" amounts — what we actually billed the customer in
  // `currency`. For Paystack orders charged in KES this is in KES
  // cents; for legacy/bank orders it matches displayCurrency 1:1.
  // Reconciliation against Paystack's verified amount uses these.
  subtotalCents: integer("subtotal_cents").notNull(),
  shippingCents: integer("shipping_cents").notNull(),
  taxCents: integer("tax_cents").notNull(),
  totalCents: integer("total_cents").notNull(),
  currency: varchar("currency", { length: 8 }).notNull().default("USD"),
  // Display amounts — what the shopper saw on the storefront, in
  // `displayCurrency` (USD today). Equal to the charge amounts when
  // the FX rate is 1.0 (no conversion). Nullable for legacy rows;
  // helpers fall back to subtotalCents/etc + currency when null.
  displayCurrency: varchar("display_currency", { length: 8 }),
  displaySubtotalCents: integer("display_subtotal_cents"),
  displayShippingCents: integer("display_shipping_cents"),
  displayTaxCents: integer("display_tax_cents"),
  displayTotalCents: integer("display_total_cents"),
  // The locked FX rate (display→charge) used for this order; null when
  // no conversion happened. Stored at high precision so refunds can be
  // computed against the same rate.
  fxRate: numeric("fx_rate", { precision: 14, scale: 6 }),
  fxRateLockedAt: timestamp("fx_rate_locked_at", { withTimezone: true }),
  status: varchar("status", { length: 24 }).notNull().default("new"),
  paymentProvider: varchar("payment_provider", { length: 24 }),
  paymentReference: text("payment_reference"),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type Order = typeof ordersTable.$inferSelect;
export type InsertOrder = typeof ordersTable.$inferInsert;

export const siteSettingsTable = pgTable("site_settings", {
  id: integer("id").primaryKey().default(1),
  announcementText: text("announcement_text").default(""),
  announcementActive: boolean("announcement_active").notNull().default(false),
  defaultSort: varchar("default_sort", { length: 32 }).notNull().default("featured"),
  freeShippingThresholdCents: integer("free_shipping_threshold_cents")
    .notNull()
    .default(15000),
  currencySymbol: varchar("currency_symbol", { length: 8 }).notNull().default("$"),
  // ISO currency code that drives the storefront price formatting AND
  // the currency we send to Paystack on charge initialization. Must be
  // one of Paystack's supported codes; the symbol above is derived
  // server-side from this whenever it is updated.
  currencyCode: varchar("currency_code", { length: 8 }).notNull().default("USD"),
  maintenanceMode: boolean("maintenance_mode").notNull().default(false),
  storeName: text("store_name").notNull().default("VELOUR"),
  tagline: text("tagline").default("Women's Fashion Store"),
  logoUrl: text("logo_url"),
  emailFromAddress: text("email_from_address"),
  emailFromName: text("email_from_name"),
  emailReplyTo: text("email_reply_to"),
  heroAutoAdvance: boolean("hero_auto_advance").notNull().default(true),
  allowGuestReviews: boolean("allow_guest_reviews").notNull().default(false),
  paystackEnabled: boolean("paystack_enabled").notNull().default(false),
  paystackTestMode: boolean("paystack_test_mode").notNull().default(false),
  paystackLivePublicKey: text("paystack_live_public_key"),
  paystackLiveSecretKey: text("paystack_live_secret_key"),
  paystackTestPublicKey: text("paystack_test_public_key"),
  paystackTestSecretKey: text("paystack_test_secret_key"),
  bankName: text("bank_name"),
  bankAccountName: text("bank_account_name"),
  bankAccountNumber: text("bank_account_number"),
  bankSwiftCode: text("bank_swift_code"),
  bankRoutingNumber: text("bank_routing_number"),
  bankInstructions: text("bank_instructions"),
  // Operator alert email settings — operators receive notifications when
  // high-severity Paystack events fire (amount/currency mismatch,
  // verification_failed, order_not_found). "off" disables, "instant"
  // sends immediately, "hourly" buffers and emits a digest at most once
  // per hour. Recipients is a comma-separated list of email addresses.
  paymentAlertMode: varchar("payment_alert_mode", { length: 16 })
    .notNull()
    .default("off"),
  paymentAlertRecipients: text("payment_alert_recipients"),
  // Local admin credentials. Bootstrapped to a random username/password
  // on first server boot (logged once to the server console) so the
  // operator can sign in without configuring SSO. The hash is stored
  // with bcrypt; the operator can rotate both fields from the admin UI.
  adminUsername: text("admin_username"),
  adminPasswordHash: text("admin_password_hash"),
  // Outbound SMTP — when configured, order/test emails go through this
  // mailbox (e.g. Titan Email) instead of the Resend HTTP API. The
  // password is write-only via the admin UI (masked on read).
  smtpHost: text("smtp_host"),
  smtpPort: integer("smtp_port"),
  smtpSecure: boolean("smtp_secure").notNull().default(true),
  smtpUsername: text("smtp_username"),
  smtpPassword: text("smtp_password"),
  // FX (display→charge) configuration. The merchant Paystack account
  // is locked to KES, so storefront prices are quoted in USD and we
  // multiply by `usdToKesRate` at checkout time. Operators can edit
  // the rate manually or refresh it from the admin Settings page.
  usdToKesRate: numeric("usd_to_kes_rate", { precision: 14, scale: 6 })
    .notNull()
    .default("130.000000"),
  fxRateUpdatedAt: timestamp("fx_rate_updated_at", { withTimezone: true }),
  // When on, the server periodically refreshes usd_to_kes_rate from a
  // free FX provider (open.er-api.com first, then exchangerate.host).
  // Operators can still type a manual rate at any time — the next auto
  // refresh will overwrite it.
  fxAutoRefresh: boolean("fx_auto_refresh").notNull().default(true),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type SiteSettings = typeof siteSettingsTable.$inferSelect;
export type InsertSiteSettings = typeof siteSettingsTable.$inferInsert;

export const wishlistSignalsTable = pgTable("wishlist_signals", {
  id: serial("id").primaryKey(),
  productId: varchar("product_id").notNull(),
  email: text("email"),
  sessionId: varchar("session_id", { length: 64 }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type WishlistSignal = typeof wishlistSignalsTable.$inferSelect;
export type InsertWishlistSignal = typeof wishlistSignalsTable.$inferInsert;

export const orderEmailEventsTable = pgTable("order_email_events", {
  id: serial("id").primaryKey(),
  orderId: varchar("order_id")
    .notNull()
    .references(() => ordersTable.id, { onDelete: "cascade" }),
  kind: varchar("kind", { length: 24 }).notNull(),
  status: varchar("status", { length: 16 }).notNull(),
  toAddress: text("to_address"),
  fromAddress: text("from_address"),
  errorMessage: text("error_message"),
  statusCode: integer("status_code"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type OrderEmailEvent = typeof orderEmailEventsTable.$inferSelect;
export type InsertOrderEmailEvent = typeof orderEmailEventsTable.$inferInsert;

/**
 * Audit log of every Paystack payment outcome we observe — both via the
 * server-to-server webhook and the browser callback redirect. Captures
 * successes alongside failures (verification rejected, amount/currency
 * mismatch, unknown order reference, abandoned by customer) so the
 * admin Payments tab can surface problems that previously only showed
 * up in the server log.
 */
export const paymentEventsTable = pgTable(
  "payment_events",
  {
    id: serial("id").primaryKey(),
    /** Linked order, when we could resolve one. May be null for forged
     *  references or pruned orders. No FK so a deleted order doesn't
     *  wipe the audit trail. */
    orderId: varchar("order_id"),
    /** Paystack `reference` (= our order id for outbound charges). */
    reference: text("reference"),
    /** "success" | "failed" | "abandoned" — coarse grouping for UI badges. */
    kind: varchar("kind", { length: 16 }).notNull(),
    /** "webhook" | "callback" — which Paystack channel reported it. */
    source: varchar("source", { length: 16 }).notNull(),
    /** Short machine-readable code: "charge_success", "amount_mismatch",
     *  "currency_mismatch", "verification_failed", "order_not_found",
     *  "missing_reference", "already_paid". */
    code: varchar("code", { length: 48 }).notNull(),
    /** Human-readable detail for the admin row. */
    message: text("message"),
    amountCents: integer("amount_cents"),
    currency: varchar("currency", { length: 8 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("IDX_payment_events_created").on(table.createdAt),
    check(
      "CK_payment_events_kind",
      sql`kind IN ('success','failed','abandoned')`,
    ),
  ],
);

export type PaymentEvent = typeof paymentEventsTable.$inferSelect;
export type InsertPaymentEvent = typeof paymentEventsTable.$inferInsert;

export const reviewsTable = pgTable(
  "reviews",
  {
    id: serial("id").primaryKey(),
    productId: varchar("product_id").notNull(),
    userId: varchar("user_id"),
    // FK to the qualifying order that unlocked this review (null for
    // seeded rows). `set null` keeps the review if an order is later
    // hard-deleted, but the verified link is removed.
    orderId: varchar("order_id").references(() => ordersTable.id, {
      onDelete: "set null",
    }),
    email: text("email"),
    name: text("name").notNull(),
    rating: integer("rating").notNull(),
    title: text("title"),
    body: text("body").notNull(),
    verifiedPurchase: boolean("verified_purchase").notNull().default(false),
    seeded: boolean("seeded").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("IDX_reviews_product").on(table.productId),
    // One review per (real) user per product. Seeded rows have userId=NULL
    // and are excluded from the constraint via the partial WHERE clause.
    uniqueIndex("UX_reviews_user_product")
      .on(table.productId, table.userId)
      .where(sql`user_id IS NOT NULL`),
    // Defence-in-depth: API also validates with zod, but enforcing the
    // 1–5 range at the DB level guards against any future code path.
    check("CK_reviews_rating_range", sql`rating BETWEEN 1 AND 5`),
  ],
);

export type Review = typeof reviewsTable.$inferSelect;
export type InsertReview = typeof reviewsTable.$inferInsert;

export const productReviewSummaryTable = pgTable("product_review_summary", {
  productId: varchar("product_id").primaryKey(),
  count: integer("count").notNull().default(0),
  average: numeric("average", { precision: 4, scale: 2 }).notNull().default("0"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type ProductReviewSummary = typeof productReviewSummaryTable.$inferSelect;
export type InsertProductReviewSummary = typeof productReviewSummaryTable.$inferInsert;

/**
 * Local admin user accounts. Replaces the single
 * site_settings.admin_username/admin_password_hash pair so we can have
 * multiple operators with distinct sign-ins and a role split:
 *   - super_admin: full access including credentials/secrets and
 *     management of other admins.
 *   - admin: day-to-day operations only; cannot view secrets or manage
 *     other admins.
 *
 * Username uniqueness is enforced case-insensitively via a unique index
 * on lower(username), so "Texas99" and "texas99" cannot both exist.
 */
export const adminUsersTable = pgTable(
  "admin_users",
  {
    id: serial("id").primaryKey(),
    username: text("username").notNull(),
    passwordHash: text("password_hash").notNull(),
    role: varchar("role", { length: 16 }).notNull().default("admin"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    createdById: integer("created_by_id"),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("UX_admin_users_username_lower").on(sql`lower(${table.username})`),
    check("CK_admin_users_role", sql`role IN ('admin','super_admin')`),
  ],
);

export type AdminUser = typeof adminUsersTable.$inferSelect;
export type InsertAdminUser = typeof adminUsersTable.$inferInsert;
