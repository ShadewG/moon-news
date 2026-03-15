CREATE TYPE "public"."line_content_category" AS ENUM('concrete_event', 'named_person', 'abstract_concept', 'quote_claim', 'historical_period', 'transition', 'sample_story');--> statement-breakpoint
CREATE TYPE "public"."media_type" AS ENUM('video', 'image', 'stock_video', 'stock_image', 'article');--> statement-breakpoint
CREATE TYPE "public"."recommendation_type" AS ENUM('ai_video', 'ai_image', 'stock_fallback');--> statement-breakpoint
ALTER TYPE "public"."provider" ADD VALUE 'youtube';--> statement-breakpoint
ALTER TYPE "public"."provider" ADD VALUE 'internet_archive';--> statement-breakpoint
ALTER TYPE "public"."provider" ADD VALUE 'getty';--> statement-breakpoint
ALTER TYPE "public"."provider" ADD VALUE 'google_images';--> statement-breakpoint
CREATE TABLE "footage_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"footage_search_run_id" uuid NOT NULL,
	"script_line_id" uuid NOT NULL,
	"provider" "provider" NOT NULL,
	"media_type" "media_type" NOT NULL,
	"external_asset_id" text NOT NULL,
	"title" text NOT NULL,
	"preview_url" text,
	"source_url" text NOT NULL,
	"license_type" text,
	"duration_ms" integer,
	"width" integer,
	"height" integer,
	"match_score" integer DEFAULT 0 NOT NULL,
	"is_primary_source" boolean DEFAULT false NOT NULL,
	"upload_date" text,
	"channel_or_contributor" text,
	"score_breakdown_json" jsonb,
	"metadata_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "footage_search_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"script_line_id" uuid NOT NULL,
	"provider" "provider" NOT NULL,
	"status" "processing_status" DEFAULT 'pending' NOT NULL,
	"query" text,
	"results_count" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "visual_recommendations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"script_line_id" uuid NOT NULL,
	"recommendation_type" "recommendation_type" NOT NULL,
	"reason" text NOT NULL,
	"suggested_prompt" text,
	"suggested_style" text,
	"confidence" real DEFAULT 0 NOT NULL,
	"dismissed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "script_lines" ADD COLUMN "line_content_category" "line_content_category";--> statement-breakpoint
ALTER TABLE "script_lines" ADD COLUMN "classification_json" jsonb;--> statement-breakpoint
ALTER TABLE "footage_assets" ADD CONSTRAINT "footage_assets_footage_search_run_id_footage_search_runs_id_fk" FOREIGN KEY ("footage_search_run_id") REFERENCES "public"."footage_search_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "footage_assets" ADD CONSTRAINT "footage_assets_script_line_id_script_lines_id_fk" FOREIGN KEY ("script_line_id") REFERENCES "public"."script_lines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "footage_search_runs" ADD CONSTRAINT "footage_search_runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "footage_search_runs" ADD CONSTRAINT "footage_search_runs_script_line_id_script_lines_id_fk" FOREIGN KEY ("script_line_id") REFERENCES "public"."script_lines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visual_recommendations" ADD CONSTRAINT "visual_recommendations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visual_recommendations" ADD CONSTRAINT "visual_recommendations_script_line_id_script_lines_id_fk" FOREIGN KEY ("script_line_id") REFERENCES "public"."script_lines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "footage_assets_run_id_index" ON "footage_assets" USING btree ("footage_search_run_id");--> statement-breakpoint
CREATE INDEX "footage_assets_line_id_index" ON "footage_assets" USING btree ("script_line_id");--> statement-breakpoint
CREATE INDEX "footage_search_runs_line_id_index" ON "footage_search_runs" USING btree ("script_line_id");--> statement-breakpoint
CREATE INDEX "footage_search_runs_project_id_index" ON "footage_search_runs" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "visual_recommendations_line_id_index" ON "visual_recommendations" USING btree ("script_line_id");--> statement-breakpoint
CREATE INDEX "visual_recommendations_project_id_index" ON "visual_recommendations" USING btree ("project_id");