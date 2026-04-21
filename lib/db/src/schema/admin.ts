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
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type ProductOverride = typeof productOverridesTable.$inferSelect;
export type InsertProductOverride = typeof productOverridesTable.$inferInsert;

export const ordersTable = pgTable("orders", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  email: text("email").notNull(),
  customerName: text("customer_name"),
  shippingAddress: jsonb("shipping_address").notNull(),
  items: jsonb("items").notNull(),
  subtotalCents: integer("subtotal_cents").notNull(),
  shippingCents: integer("shipping_cents").notNull(),
  taxCents: integer("tax_cents").notNull(),
  totalCents: integer("total_cents").notNull(),
  currency: varchar("currency", { length: 8 }).notNull().default("USD"),
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
  maintenanceMode: boolean("maintenance_mode").notNull().default(false),
  storeName: text("store_name").notNull().default("VELOUR"),
  tagline: text("tagline").default("Women's Fashion Store"),
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
  // Local admin credentials. Bootstrapped to a random username/password
  // on first server boot (logged once to the server console) so the
  // operator can sign in without configuring SSO. The hash is stored
  // with bcrypt; the operator can rotate both fields from the admin UI.
  adminUsername: text("admin_username"),
  adminPasswordHash: text("admin_password_hash"),
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
