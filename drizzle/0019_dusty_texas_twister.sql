CREATE TYPE "public"."script_edit_status" AS ENUM('draft', 'in_review', 'approved', 'needs_revision', 'final');--> statement-breakpoint
CREATE TABLE "script_edits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"run_kind" text DEFAULT 'agent' NOT NULL,
	"edited_title" text,
	"edited_script" text,
	"edited_deck" text,
	"edit_status" "script_edit_status" DEFAULT 'draft' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "script_feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"run_kind" text DEFAULT 'agent' NOT NULL,
	"anchor" text,
	"body" text NOT NULL,
	"resolved" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "script_agent_runs" ALTER COLUMN "current_stage" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "script_agent_sources" ALTER COLUMN "stage_key" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "script_agent_stages" ALTER COLUMN "stage_key" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."script_agent_stage";--> statement-breakpoint
CREATE TYPE "public"."script_agent_stage" AS ENUM('plan_research', 'discover_sources', 'ingest_sources', 'extract_evidence', 'synthesize_research', 'build_outline', 'followup_research', 'select_quotes', 'place_quotes', 'build_storyboard', 'plan_sections', 'write_sections', 'assemble_draft', 'critique_script', 'revise_sections', 'analyze_retention', 'polish_script', 'expand_script', 'finalize_script');--> statement-breakpoint
ALTER TABLE "script_agent_runs" ALTER COLUMN "current_stage" SET DATA TYPE "public"."script_agent_stage" USING "current_stage"::"public"."script_agent_stage";--> statement-breakpoint
ALTER TABLE "script_agent_sources" ALTER COLUMN "stage_key" SET DATA TYPE "public"."script_agent_stage" USING "stage_key"::"public"."script_agent_stage";--> statement-breakpoint
ALTER TABLE "script_agent_stages" ALTER COLUMN "stage_key" SET DATA TYPE "public"."script_agent_stage" USING "stage_key"::"public"."script_agent_stage";--> statement-breakpoint
CREATE INDEX "script_edits_run_id_index" ON "script_edits" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "script_edits_edit_status_index" ON "script_edits" USING btree ("edit_status");--> statement-breakpoint
CREATE INDEX "script_feedback_run_id_index" ON "script_feedback" USING btree ("run_id");