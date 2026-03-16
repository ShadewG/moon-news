CREATE TYPE "public"."board_alert_type" AS ENUM('surge', 'controversy', 'correction');--> statement-breakpoint
CREATE TABLE "board_surge_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"story_id" uuid NOT NULL,
	"alert_type" "board_alert_type" NOT NULL,
	"headline" text NOT NULL,
	"text" text NOT NULL,
	"surge_score" real DEFAULT 0 NOT NULL,
	"baseline_avg" real DEFAULT 0 NOT NULL,
	"current_count" integer DEFAULT 0 NOT NULL,
	"window_minutes" integer DEFAULT 120 NOT NULL,
	"metadata_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dismissed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "board_surge_alerts" ADD CONSTRAINT "board_surge_alerts_story_id_board_story_candidates_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."board_story_candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "board_surge_alerts_story_id_index" ON "board_surge_alerts" USING btree ("story_id");--> statement-breakpoint
CREATE INDEX "board_surge_alerts_alert_type_index" ON "board_surge_alerts" USING btree ("alert_type");--> statement-breakpoint
CREATE INDEX "board_surge_alerts_created_at_index" ON "board_surge_alerts" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "board_surge_alerts_dismissed_at_index" ON "board_surge_alerts" USING btree ("dismissed_at");