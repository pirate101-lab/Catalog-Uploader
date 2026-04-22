CREATE TABLE "recategorisation_rules_meta" (
	"id" integer PRIMARY KEY NOT NULL,
	"seeded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recategorisation_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"pattern" text NOT NULL,
	"target_category" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
