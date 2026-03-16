CREATE TABLE "footage_quotes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"footage_asset_id" uuid NOT NULL,
	"script_line_id" uuid NOT NULL,
	"quote_text" text NOT NULL,
	"speaker" text,
	"start_ms" integer NOT NULL,
	"end_ms" integer NOT NULL,
	"relevance_score" integer DEFAULT 0 NOT NULL,
	"context" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "footage_quotes" ADD CONSTRAINT "footage_quotes_footage_asset_id_footage_assets_id_fk" FOREIGN KEY ("footage_asset_id") REFERENCES "public"."footage_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "footage_quotes" ADD CONSTRAINT "footage_quotes_script_line_id_script_lines_id_fk" FOREIGN KEY ("script_line_id") REFERENCES "public"."script_lines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "footage_quotes_asset_id_index" ON "footage_quotes" USING btree ("footage_asset_id");--> statement-breakpoint
CREATE INDEX "footage_quotes_line_id_index" ON "footage_quotes" USING btree ("script_line_id");