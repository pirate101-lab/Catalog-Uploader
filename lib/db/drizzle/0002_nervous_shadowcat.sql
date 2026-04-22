CREATE TABLE "reclassification_events" (
	"product_id" varchar PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"gender" varchar(8) NOT NULL,
	"original_category" text NOT NULL,
	"new_category" text NOT NULL,
	"matched_hint" text,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "CK_reclassification_events_gender" CHECK (gender IN ('men','women'))
);
--> statement-breakpoint
CREATE INDEX "IDX_reclassification_events_last_observed" ON "reclassification_events" USING btree ("last_observed_at");