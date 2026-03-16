CREATE TABLE "clip_library" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" "provider" NOT NULL,
	"external_id" text NOT NULL,
	"title" text NOT NULL,
	"source_url" text NOT NULL,
	"preview_url" text,
	"channel_or_contributor" text,
	"duration_ms" integer,
	"view_count" integer,
	"upload_date" text,
	"metadata_json" jsonb,
	"has_transcript" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clip_search_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"search_id" uuid NOT NULL,
	"clip_id" uuid NOT NULL,
	"relevance_score" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clip_searches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"query" text NOT NULL,
	"results_count" integer DEFAULT 0 NOT NULL,
	"quotes_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transcript_cache" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clip_id" uuid NOT NULL,
	"language" text DEFAULT 'en' NOT NULL,
	"full_text" text NOT NULL,
	"segments_json" jsonb NOT NULL,
	"word_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "clip_search_results" ADD CONSTRAINT "clip_search_results_search_id_clip_searches_id_fk" FOREIGN KEY ("search_id") REFERENCES "public"."clip_searches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clip_search_results" ADD CONSTRAINT "clip_search_results_clip_id_clip_library_id_fk" FOREIGN KEY ("clip_id") REFERENCES "public"."clip_library"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transcript_cache" ADD CONSTRAINT "transcript_cache_clip_id_clip_library_id_fk" FOREIGN KEY ("clip_id") REFERENCES "public"."clip_library"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "clip_library_provider_external_id_unique" ON "clip_library" USING btree ("provider","external_id");--> statement-breakpoint
CREATE INDEX "clip_library_provider_index" ON "clip_library" USING btree ("provider");--> statement-breakpoint
CREATE INDEX "clip_search_results_search_id_index" ON "clip_search_results" USING btree ("search_id");--> statement-breakpoint
CREATE UNIQUE INDEX "transcript_cache_clip_language_unique" ON "transcript_cache" USING btree ("clip_id","language");