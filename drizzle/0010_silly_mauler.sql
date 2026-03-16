CREATE TYPE "public"."board_competitor_alert_level" AS ENUM('none', 'watch', 'hot');--> statement-breakpoint
CREATE TYPE "public"."board_competitor_tier" AS ENUM('tier1', 'tier2');--> statement-breakpoint
CREATE TABLE "board_competitor_channels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"platform" text DEFAULT 'youtube' NOT NULL,
	"tier" "board_competitor_tier" DEFAULT 'tier2' NOT NULL,
	"handle" text,
	"channel_url" text,
	"subscribers_label" text,
	"poll_interval_minutes" integer DEFAULT 15 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"metadata_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "board_competitor_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"title" text NOT NULL,
	"url" text,
	"published_at" timestamp with time zone,
	"views_label" text,
	"engagement_json" jsonb,
	"topic_match_score" integer DEFAULT 0 NOT NULL,
	"alert_level" "board_competitor_alert_level" DEFAULT 'none' NOT NULL,
	"metadata_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "board_competitor_posts" ADD CONSTRAINT "board_competitor_posts_channel_id_board_competitor_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."board_competitor_channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "board_competitor_channels_name_platform_unique" ON "board_competitor_channels" USING btree ("name","platform");--> statement-breakpoint
CREATE INDEX "board_competitor_channels_tier_index" ON "board_competitor_channels" USING btree ("tier");--> statement-breakpoint
CREATE INDEX "board_competitor_channels_enabled_index" ON "board_competitor_channels" USING btree ("enabled");--> statement-breakpoint
CREATE UNIQUE INDEX "board_competitor_posts_channel_external_unique" ON "board_competitor_posts" USING btree ("channel_id","external_id");--> statement-breakpoint
CREATE INDEX "board_competitor_posts_channel_id_index" ON "board_competitor_posts" USING btree ("channel_id");--> statement-breakpoint
CREATE INDEX "board_competitor_posts_alert_level_index" ON "board_competitor_posts" USING btree ("alert_level");--> statement-breakpoint
CREATE INDEX "board_competitor_posts_published_at_index" ON "board_competitor_posts" USING btree ("published_at");