import { sql } from "drizzle-orm";
import {
  boolean,
  integer,
  jsonb,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
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
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

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
