CREATE TABLE "script_lab_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"story_title" text NOT NULL,
	"request_json" jsonb NOT NULL,
	"result_json" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "script_lab_runs_story_title_index" ON "script_lab_runs" USING btree ("story_title");--> statement-breakpoint
CREATE INDEX "script_lab_runs_created_at_index" ON "script_lab_runs" USING btree ("created_at");