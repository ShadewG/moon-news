ALTER TABLE "script_agent_runs" ALTER COLUMN "current_stage" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "script_agent_sources" ALTER COLUMN "stage_key" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "script_agent_stages" ALTER COLUMN "stage_key" SET DATA TYPE text;--> statement-breakpoint
UPDATE "script_agent_runs" SET "current_stage" = 'assemble_draft' WHERE "current_stage" = 'draft_script';--> statement-breakpoint
UPDATE "script_agent_stages" SET "stage_key" = 'assemble_draft' WHERE "stage_key" = 'draft_script';--> statement-breakpoint
DROP TYPE "public"."script_agent_stage";--> statement-breakpoint
CREATE TYPE "public"."script_agent_stage" AS ENUM('discover_sources', 'ingest_sources', 'extract_evidence', 'synthesize_research', 'build_outline', 'build_storyboard', 'plan_sections', 'write_sections', 'assemble_draft', 'critique_script', 'revise_sections', 'analyze_retention', 'polish_script', 'expand_script', 'finalize_script');--> statement-breakpoint
ALTER TABLE "script_agent_runs" ALTER COLUMN "current_stage" SET DATA TYPE "public"."script_agent_stage" USING "current_stage"::"public"."script_agent_stage";--> statement-breakpoint
ALTER TABLE "script_agent_sources" ALTER COLUMN "stage_key" SET DATA TYPE "public"."script_agent_stage" USING "stage_key"::"public"."script_agent_stage";--> statement-breakpoint
ALTER TABLE "script_agent_stages" ALTER COLUMN "stage_key" SET DATA TYPE "public"."script_agent_stage" USING "stage_key"::"public"."script_agent_stage";
