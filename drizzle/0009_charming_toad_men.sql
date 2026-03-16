CREATE TYPE "public"."board_ai_output_kind" AS ENUM('brief', 'script_starter', 'titles');--> statement-breakpoint
CREATE TYPE "public"."board_queue_status" AS ENUM('watching', 'researching', 'scripting', 'filming', 'editing', 'published');--> statement-breakpoint
CREATE TYPE "public"."board_source_kind" AS ENUM('rss', 'youtube_channel', 'x_account', 'document_watch', 'government_feed', 'legal_watch', 'archive_collection');--> statement-breakpoint
CREATE TYPE "public"."board_story_status" AS ENUM('developing', 'watching', 'peaked', 'queued', 'archived');--> statement-breakpoint
CREATE TYPE "public"."board_story_type" AS ENUM('normal', 'trending', 'controversy', 'competitor', 'correction');--> statement-breakpoint
CREATE TABLE "board_feed_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"title" text NOT NULL,
	"url" text NOT NULL,
	"author" text,
	"published_at" timestamp with time zone,
	"summary" text,
	"content_hash" text,
	"metadata_json" jsonb,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "board_queue_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"story_id" uuid NOT NULL,
	"position" integer DEFAULT 1 NOT NULL,
	"status" "board_queue_status" DEFAULT 'watching' NOT NULL,
	"format" text,
	"target_publish_at" timestamp with time zone,
	"assigned_to" text,
	"notes" text,
	"linked_project_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "board_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"kind" "board_source_kind" NOT NULL,
	"provider" "provider" DEFAULT 'internal' NOT NULL,
	"poll_interval_minutes" integer DEFAULT 15 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"config_json" jsonb,
	"last_polled_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "board_story_ai_outputs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"story_id" uuid NOT NULL,
	"kind" "board_ai_output_kind" NOT NULL,
	"prompt_version" text DEFAULT 'v1' NOT NULL,
	"model" text DEFAULT 'gpt-4.1-mini' NOT NULL,
	"content" text NOT NULL,
	"metadata_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "board_story_candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"canonical_title" text NOT NULL,
	"vertical" text,
	"status" "board_story_status" DEFAULT 'developing' NOT NULL,
	"story_type" "board_story_type" DEFAULT 'normal' NOT NULL,
	"surge_score" integer DEFAULT 0 NOT NULL,
	"controversy_score" integer DEFAULT 0 NOT NULL,
	"sentiment_score" real DEFAULT 0 NOT NULL,
	"items_count" integer DEFAULT 0 NOT NULL,
	"sources_count" integer DEFAULT 0 NOT NULL,
	"correction" boolean DEFAULT false NOT NULL,
	"formats_json" jsonb,
	"first_seen_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone,
	"score_json" jsonb,
	"metadata_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "board_story_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"story_id" uuid NOT NULL,
	"feed_item_id" uuid NOT NULL,
	"source_weight" integer DEFAULT 0 NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"evidence_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "board_ticker_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"story_id" uuid,
	"label" text NOT NULL,
	"text" text NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"starts_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "board_feed_items" ADD CONSTRAINT "board_feed_items_source_id_board_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."board_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_queue_items" ADD CONSTRAINT "board_queue_items_story_id_board_story_candidates_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."board_story_candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_queue_items" ADD CONSTRAINT "board_queue_items_linked_project_id_projects_id_fk" FOREIGN KEY ("linked_project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_story_ai_outputs" ADD CONSTRAINT "board_story_ai_outputs_story_id_board_story_candidates_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."board_story_candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_story_sources" ADD CONSTRAINT "board_story_sources_story_id_board_story_candidates_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."board_story_candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_story_sources" ADD CONSTRAINT "board_story_sources_feed_item_id_board_feed_items_id_fk" FOREIGN KEY ("feed_item_id") REFERENCES "public"."board_feed_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_ticker_events" ADD CONSTRAINT "board_ticker_events_story_id_board_story_candidates_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."board_story_candidates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "board_feed_items_source_external_unique" ON "board_feed_items" USING btree ("source_id","external_id");--> statement-breakpoint
CREATE INDEX "board_feed_items_source_id_index" ON "board_feed_items" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "board_feed_items_published_at_index" ON "board_feed_items" USING btree ("published_at");--> statement-breakpoint
CREATE INDEX "board_feed_items_ingested_at_index" ON "board_feed_items" USING btree ("ingested_at");--> statement-breakpoint
CREATE UNIQUE INDEX "board_queue_items_story_id_unique" ON "board_queue_items" USING btree ("story_id");--> statement-breakpoint
CREATE INDEX "board_queue_items_position_index" ON "board_queue_items" USING btree ("position");--> statement-breakpoint
CREATE INDEX "board_queue_items_status_index" ON "board_queue_items" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "board_sources_name_kind_unique" ON "board_sources" USING btree ("name","kind");--> statement-breakpoint
CREATE INDEX "board_sources_provider_index" ON "board_sources" USING btree ("provider");--> statement-breakpoint
CREATE INDEX "board_sources_enabled_index" ON "board_sources" USING btree ("enabled");--> statement-breakpoint
CREATE UNIQUE INDEX "board_story_ai_outputs_story_kind_prompt_unique" ON "board_story_ai_outputs" USING btree ("story_id","kind","prompt_version");--> statement-breakpoint
CREATE INDEX "board_story_ai_outputs_story_id_index" ON "board_story_ai_outputs" USING btree ("story_id");--> statement-breakpoint
CREATE UNIQUE INDEX "board_story_candidates_slug_unique" ON "board_story_candidates" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "board_story_candidates_status_index" ON "board_story_candidates" USING btree ("status");--> statement-breakpoint
CREATE INDEX "board_story_candidates_type_index" ON "board_story_candidates" USING btree ("story_type");--> statement-breakpoint
CREATE INDEX "board_story_candidates_surge_score_index" ON "board_story_candidates" USING btree ("surge_score");--> statement-breakpoint
CREATE INDEX "board_story_candidates_controversy_score_index" ON "board_story_candidates" USING btree ("controversy_score");--> statement-breakpoint
CREATE INDEX "board_story_candidates_last_seen_at_index" ON "board_story_candidates" USING btree ("last_seen_at");--> statement-breakpoint
CREATE UNIQUE INDEX "board_story_sources_story_feed_unique" ON "board_story_sources" USING btree ("story_id","feed_item_id");--> statement-breakpoint
CREATE INDEX "board_story_sources_story_id_index" ON "board_story_sources" USING btree ("story_id");--> statement-breakpoint
CREATE INDEX "board_story_sources_feed_item_id_index" ON "board_story_sources" USING btree ("feed_item_id");--> statement-breakpoint
CREATE INDEX "board_ticker_events_priority_index" ON "board_ticker_events" USING btree ("priority");--> statement-breakpoint
CREATE INDEX "board_ticker_events_starts_at_index" ON "board_ticker_events" USING btree ("starts_at");--> statement-breakpoint
CREATE INDEX "board_ticker_events_expires_at_index" ON "board_ticker_events" USING btree ("expires_at");