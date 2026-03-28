CREATE TYPE "public"."moon_analysis_scope" AS ENUM('video', 'weekly', 'monthly');--> statement-breakpoint
CREATE TABLE "moon_analysis_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" "processing_status" DEFAULT 'pending' NOT NULL,
	"scope_type" "moon_analysis_scope" NOT NULL,
	"scope_start_date" text NOT NULL,
	"scope_end_date" text NOT NULL,
	"youtube_video_id" text,
	"youtube_video_title" text,
	"label" text,
	"request_json" jsonb NOT NULL,
	"result_json" jsonb,
	"report_html" text,
	"artifact_dir" text,
	"error_text" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "moon_analysis_runs_status_index" ON "moon_analysis_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "moon_analysis_runs_scope_type_index" ON "moon_analysis_runs" USING btree ("scope_type");--> statement-breakpoint
CREATE INDEX "moon_analysis_runs_created_at_index" ON "moon_analysis_runs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "moon_analysis_runs_youtube_video_id_index" ON "moon_analysis_runs" USING btree ("youtube_video_id");