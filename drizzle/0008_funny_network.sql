CREATE TABLE "clip_ai_queries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clip_id" uuid NOT NULL,
	"question" text NOT NULL,
	"answer" text NOT NULL,
	"moments_json" jsonb NOT NULL,
	"model" text DEFAULT 'gpt-4.1-mini' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "clip_ai_queries" ADD CONSTRAINT "clip_ai_queries_clip_id_clip_library_id_fk" FOREIGN KEY ("clip_id") REFERENCES "public"."clip_library"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "clip_ai_queries_clip_id_index" ON "clip_ai_queries" USING btree ("clip_id");--> statement-breakpoint
CREATE INDEX "clip_ai_queries_created_at_index" ON "clip_ai_queries" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "clip_library_created_at_index" ON "clip_library" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "clip_library_has_transcript_index" ON "clip_library" USING btree ("has_transcript");--> statement-breakpoint
CREATE INDEX "clip_library_view_count_index" ON "clip_library" USING btree ("view_count");