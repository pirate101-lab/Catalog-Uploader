import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

/**
 * Customer-facing delivery addresses. `userId` stores the Clerk user id
 * (a string like `user_2abc...`) so we don't need a foreign key into the
 * existing Replit-Auth `users` table — Clerk owns the user identity for
 * the storefront.
 */
export const addressesTable = pgTable(
  "addresses",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: varchar("user_id", { length: 191 }).notNull(),
    label: varchar("label", { length: 64 }),
    fullName: varchar("full_name", { length: 191 }).notNull(),
    phone: varchar("phone", { length: 32 }),
    countryCode: varchar("country_code", { length: 4 }),
    line1: text("line1").notNull(),
    line2: text("line2"),
    city: varchar("city", { length: 128 }).notNull(),
    region: varchar("region", { length: 128 }),
    postalCode: varchar("postal_code", { length: 32 }),
    country: varchar("country", { length: 64 }).notNull(),
    isDefault: boolean("is_default").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [index("IDX_addresses_user").on(table.userId)],
);

export type Address = typeof addressesTable.$inferSelect;
export type NewAddress = typeof addressesTable.$inferInsert;
