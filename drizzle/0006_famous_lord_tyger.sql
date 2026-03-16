CREATE TABLE "clip_search_quotes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"search_id" uuid NOT NULL,
	"clip_id" uuid NOT NULL,
	"quote_text" text NOT NULL,
	"speaker" text,
	"start_ms" integer DEFAULT 0 NOT NULL,
	"end_ms" integer DEFAULT 0 NOT NULL,
	"relevance_score" integer DEFAULT 0 NOT NULL,
	"context" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "clip_search_quotes" ADD CONSTRAINT "clip_search_quotes_search_id_clip_searches_id_fk" FOREIGN KEY ("search_id") REFERENCES "public"."clip_searches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clip_search_quotes" ADD CONSTRAINT "clip_search_quotes_clip_id_clip_library_id_fk" FOREIGN KEY ("clip_id") REFERENCES "public"."clip_library"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "clip_search_quotes_search_id_index" ON "clip_search_quotes" USING btree ("search_id");