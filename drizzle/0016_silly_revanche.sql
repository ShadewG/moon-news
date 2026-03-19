CREATE TYPE "public"."script_agent_source_kind" AS ENUM('research_dossier', 'article', 'video', 'social_post', 'library_clip', 'generated_note');--> statement-breakpoint
CREATE TYPE "public"."script_agent_stage" AS ENUM('discover_sources', 'ingest_sources', 'extract_evidence', 'synthesize_research', 'build_outline', 'build_storyboard', 'draft_script', 'critique_script', 'analyze_retention', 'finalize_script');--> statement-breakpoint
CREATE TABLE "script_agent_claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"claim_text" text NOT NULL,
	"support_level" integer DEFAULT 50 NOT NULL,
	"risk_level" integer DEFAULT 0 NOT NULL,
	"evidence_refs_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "script_agent_quotes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"source_id" uuid,
	"source_label" text NOT NULL,
	"source_url" text,
	"quote_text" text NOT NULL,
	"speaker" text,
	"context" text,
	"relevance_score" integer DEFAULT 0 NOT NULL,
	"start_ms" integer,
	"end_ms" integer,
	"metadata_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "script_agent_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"story_title" text NOT NULL,
	"status" "processing_status" DEFAULT 'pending' NOT NULL,
	"current_stage" "script_agent_stage",
	"research_depth" text DEFAULT 'deep' NOT NULL,
	"trigger_run_id" text,
	"request_json" jsonb NOT NULL,
	"result_json" jsonb,
	"error_text" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "script_agent_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"stage_key" "script_agent_stage",
	"source_kind" "script_agent_source_kind" NOT NULL,
	"provider_name" text DEFAULT 'internal' NOT NULL,
	"title" text NOT NULL,
	"url" text,
	"snippet" text,
	"published_at" text,
	"clip_id" uuid,
	"content_status" "processing_status" DEFAULT 'pending' NOT NULL,
	"transcript_status" "processing_status" DEFAULT 'pending' NOT NULL,
	"content_json" jsonb,
	"metadata_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "script_agent_stages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"stage_key" "script_agent_stage" NOT NULL,
	"stage_order" integer DEFAULT 0 NOT NULL,
	"status" "processing_status" DEFAULT 'pending' NOT NULL,
	"input_json" jsonb,
	"output_json" jsonb,
	"error_text" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "script_agent_claims" ADD CONSTRAINT "script_agent_claims_run_id_script_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."script_agent_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "script_agent_quotes" ADD CONSTRAINT "script_agent_quotes_run_id_script_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."script_agent_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "script_agent_quotes" ADD CONSTRAINT "script_agent_quotes_source_id_script_agent_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."script_agent_sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "script_agent_sources" ADD CONSTRAINT "script_agent_sources_run_id_script_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."script_agent_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "script_agent_sources" ADD CONSTRAINT "script_agent_sources_clip_id_clip_library_id_fk" FOREIGN KEY ("clip_id") REFERENCES "public"."clip_library"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "script_agent_stages" ADD CONSTRAINT "script_agent_stages_run_id_script_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."script_agent_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "script_agent_claims_run_id_index" ON "script_agent_claims" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "script_agent_claims_support_level_index" ON "script_agent_claims" USING btree ("support_level");--> statement-breakpoint
CREATE INDEX "script_agent_claims_risk_level_index" ON "script_agent_claims" USING btree ("risk_level");--> statement-breakpoint
CREATE INDEX "script_agent_quotes_run_id_index" ON "script_agent_quotes" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "script_agent_quotes_source_id_index" ON "script_agent_quotes" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "script_agent_quotes_relevance_score_index" ON "script_agent_quotes" USING btree ("relevance_score");--> statement-breakpoint
CREATE INDEX "script_agent_runs_story_title_index" ON "script_agent_runs" USING btree ("story_title");--> statement-breakpoint
CREATE INDEX "script_agent_runs_status_index" ON "script_agent_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "script_agent_runs_created_at_index" ON "script_agent_runs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "script_agent_sources_run_id_index" ON "script_agent_sources" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "script_agent_sources_source_kind_index" ON "script_agent_sources" USING btree ("source_kind");--> statement-breakpoint
CREATE INDEX "script_agent_sources_provider_name_index" ON "script_agent_sources" USING btree ("provider_name");--> statement-breakpoint
CREATE INDEX "script_agent_sources_clip_id_index" ON "script_agent_sources" USING btree ("clip_id");--> statement-breakpoint
CREATE UNIQUE INDEX "script_agent_stages_run_stage_unique" ON "script_agent_stages" USING btree ("run_id","stage_key");--> statement-breakpoint
CREATE INDEX "script_agent_stages_run_id_index" ON "script_agent_stages" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "script_agent_stages_status_index" ON "script_agent_stages" USING btree ("status");