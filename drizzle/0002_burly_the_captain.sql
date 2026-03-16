ALTER TABLE "footage_assets" ADD COLUMN "filtered" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "footage_assets" ADD COLUMN "filter_reason" text;