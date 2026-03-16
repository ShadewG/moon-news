CREATE TABLE "board_feed_item_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"feed_item_id" uuid NOT NULL,
	"content_hash" text,
	"title" text NOT NULL,
	"content" text,
	"diff_summary" text,
	"is_correction" boolean DEFAULT false NOT NULL,
	"version_number" integer DEFAULT 1 NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "extracted_content_cache" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"url_hash" text NOT NULL,
	"url" text NOT NULL,
	"title" text,
	"content" text NOT NULL,
	"author" text,
	"published_at" text,
	"site_name" text,
	"word_count" integer DEFAULT 0 NOT NULL,
	"extracted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "extracted_content_cache_url_hash_unique" UNIQUE("url_hash")
);
--> statement-breakpoint
CREATE TABLE "research_progress" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"story_id" uuid NOT NULL,
	"task_type" text DEFAULT 'deep_research' NOT NULL,
	"step" text DEFAULT 'pending' NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"message" text,
	"metadata_json" jsonb,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "board_feed_item_versions" ADD CONSTRAINT "board_feed_item_versions_feed_item_id_board_feed_items_id_fk" FOREIGN KEY ("feed_item_id") REFERENCES "public"."board_feed_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_progress" ADD CONSTRAINT "research_progress_story_id_board_story_candidates_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."board_story_candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "board_feed_item_versions_feed_version_unique" ON "board_feed_item_versions" USING btree ("feed_item_id","version_number");--> statement-breakpoint
CREATE INDEX "board_feed_item_versions_feed_item_id_index" ON "board_feed_item_versions" USING btree ("feed_item_id");--> statement-breakpoint
CREATE INDEX "board_feed_item_versions_captured_at_index" ON "board_feed_item_versions" USING btree ("captured_at");--> statement-breakpoint
CREATE INDEX "board_feed_item_versions_is_correction_index" ON "board_feed_item_versions" USING btree ("is_correction");--> statement-breakpoint
CREATE INDEX "extracted_content_cache_url_hash_index" ON "extracted_content_cache" USING btree ("url_hash");--> statement-breakpoint
CREATE INDEX "research_progress_story_id_index" ON "research_progress" USING btree ("story_id");