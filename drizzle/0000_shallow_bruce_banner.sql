CREATE TYPE "public"."processing_status" AS ENUM('pending', 'queued', 'running', 'complete', 'failed', 'needs_review');--> statement-breakpoint
CREATE TYPE "public"."project_status" AS ENUM('draft', 'active', 'archived');--> statement-breakpoint
CREATE TYPE "public"."provider" AS ENUM('parallel', 'firecrawl', 'openai', 'gemini', 'storyblocks', 'artlist', 'elevenlabs', 'internal');--> statement-breakpoint
CREATE TYPE "public"."research_source_type" AS ENUM('article', 'document', 'book', 'video', 'academic', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."script_line_type" AS ENUM('narration', 'quote', 'transition', 'headline');--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"slug" text NOT NULL,
	"status" "project_status" DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "research_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"script_line_id" uuid NOT NULL,
	"provider" "provider" DEFAULT 'parallel' NOT NULL,
	"status" "processing_status" DEFAULT 'pending' NOT NULL,
	"query" text,
	"trigger_run_id" text,
	"parallel_search_id" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "research_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"research_run_id" uuid NOT NULL,
	"script_line_id" uuid NOT NULL,
	"title" text NOT NULL,
	"source_name" text NOT NULL,
	"source_url" text NOT NULL,
	"published_at" text,
	"snippet" text,
	"extracted_text_path" text,
	"relevance_score" integer DEFAULT 0 NOT NULL,
	"source_type" "research_source_type" DEFAULT 'unknown' NOT NULL,
	"citation_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "research_summaries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"research_run_id" uuid NOT NULL,
	"script_line_id" uuid NOT NULL,
	"summary" text NOT NULL,
	"confidence_score" integer DEFAULT 0 NOT NULL,
	"model" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "script_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"script_version_id" uuid NOT NULL,
	"line_key" text NOT NULL,
	"line_index" integer NOT NULL,
	"timestamp_start_ms" integer DEFAULT 0 NOT NULL,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"text" text NOT NULL,
	"line_type" "script_line_type" NOT NULL,
	"research_status" "processing_status" DEFAULT 'pending' NOT NULL,
	"footage_status" "processing_status" DEFAULT 'pending' NOT NULL,
	"image_status" "processing_status" DEFAULT 'pending' NOT NULL,
	"video_status" "processing_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "script_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"version_number" integer DEFAULT 1 NOT NULL,
	"raw_script" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "research_runs" ADD CONSTRAINT "research_runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_runs" ADD CONSTRAINT "research_runs_script_line_id_script_lines_id_fk" FOREIGN KEY ("script_line_id") REFERENCES "public"."script_lines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_sources" ADD CONSTRAINT "research_sources_research_run_id_research_runs_id_fk" FOREIGN KEY ("research_run_id") REFERENCES "public"."research_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_sources" ADD CONSTRAINT "research_sources_script_line_id_script_lines_id_fk" FOREIGN KEY ("script_line_id") REFERENCES "public"."script_lines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_summaries" ADD CONSTRAINT "research_summaries_research_run_id_research_runs_id_fk" FOREIGN KEY ("research_run_id") REFERENCES "public"."research_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_summaries" ADD CONSTRAINT "research_summaries_script_line_id_script_lines_id_fk" FOREIGN KEY ("script_line_id") REFERENCES "public"."script_lines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "script_lines" ADD CONSTRAINT "script_lines_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "script_lines" ADD CONSTRAINT "script_lines_script_version_id_script_versions_id_fk" FOREIGN KEY ("script_version_id") REFERENCES "public"."script_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "script_versions" ADD CONSTRAINT "script_versions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "projects_slug_unique" ON "projects" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "research_runs_script_line_id_index" ON "research_runs" USING btree ("script_line_id");--> statement-breakpoint
CREATE INDEX "research_runs_trigger_run_id_index" ON "research_runs" USING btree ("trigger_run_id");--> statement-breakpoint
CREATE INDEX "research_sources_run_id_index" ON "research_sources" USING btree ("research_run_id");--> statement-breakpoint
CREATE INDEX "research_sources_line_id_index" ON "research_sources" USING btree ("script_line_id");--> statement-breakpoint
CREATE UNIQUE INDEX "research_summaries_run_id_unique" ON "research_summaries" USING btree ("research_run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "script_lines_project_line_key_unique" ON "script_lines" USING btree ("project_id","line_key");--> statement-breakpoint
CREATE INDEX "script_lines_project_id_index" ON "script_lines" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "script_versions_project_version_unique" ON "script_versions" USING btree ("project_id","version_number");