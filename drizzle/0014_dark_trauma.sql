CREATE TABLE "moon_corpus_clusters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cluster_key" text NOT NULL,
	"label" text NOT NULL,
	"coverage_mode" text,
	"keywords_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"entity_keys_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"example_clip_ids_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"profile_version" integer DEFAULT 1 NOT NULL,
	"analyzed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "moon_corpus_terms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"term" text NOT NULL,
	"term_type" text DEFAULT 'keyword' NOT NULL,
	"document_frequency" integer DEFAULT 0 NOT NULL,
	"weighted_document_frequency" real DEFAULT 0 NOT NULL,
	"weight" real DEFAULT 0 NOT NULL,
	"lift" real DEFAULT 0 NOT NULL,
	"example_clip_ids_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"profile_version" integer DEFAULT 1 NOT NULL,
	"analyzed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "moon_story_scores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"story_id" uuid NOT NULL,
	"moon_fit_score" integer DEFAULT 0 NOT NULL,
	"moon_fit_band" text DEFAULT 'low' NOT NULL,
	"cluster_key" text,
	"cluster_label" text,
	"coverage_mode" text,
	"analog_clip_ids_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"analog_titles_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"analog_median_views" integer,
	"analog_median_duration_minutes" real,
	"reason_codes_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"disqualifier_codes_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"profile_version" integer DEFAULT 1 NOT NULL,
	"scored_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "moon_video_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clip_id" uuid NOT NULL,
	"cluster_key" text,
	"cluster_label" text,
	"coverage_mode" text,
	"vertical_guess" text,
	"title_terms_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"transcript_terms_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"named_entities_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"hook_terms_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"style_terms_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"duration_bucket" text,
	"view_percentile" real DEFAULT 0 NOT NULL,
	"recency_weight" real DEFAULT 1 NOT NULL,
	"word_count" integer DEFAULT 0 NOT NULL,
	"source_published_at" timestamp with time zone,
	"profile_version" integer DEFAULT 1 NOT NULL,
	"analyzed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "moon_story_scores" ADD CONSTRAINT "moon_story_scores_story_id_board_story_candidates_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."board_story_candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moon_video_profiles" ADD CONSTRAINT "moon_video_profiles_clip_id_clip_library_id_fk" FOREIGN KEY ("clip_id") REFERENCES "public"."clip_library"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "moon_corpus_clusters_key_version_unique" ON "moon_corpus_clusters" USING btree ("cluster_key","profile_version");--> statement-breakpoint
CREATE INDEX "moon_corpus_clusters_coverage_mode_index" ON "moon_corpus_clusters" USING btree ("coverage_mode");--> statement-breakpoint
CREATE UNIQUE INDEX "moon_corpus_terms_term_type_version_unique" ON "moon_corpus_terms" USING btree ("term","term_type","profile_version");--> statement-breakpoint
CREATE INDEX "moon_corpus_terms_weight_index" ON "moon_corpus_terms" USING btree ("weight");--> statement-breakpoint
CREATE INDEX "moon_corpus_terms_profile_version_index" ON "moon_corpus_terms" USING btree ("profile_version");--> statement-breakpoint
CREATE UNIQUE INDEX "moon_story_scores_story_id_unique" ON "moon_story_scores" USING btree ("story_id");--> statement-breakpoint
CREATE INDEX "moon_story_scores_fit_band_index" ON "moon_story_scores" USING btree ("moon_fit_band");--> statement-breakpoint
CREATE INDEX "moon_story_scores_cluster_key_index" ON "moon_story_scores" USING btree ("cluster_key");--> statement-breakpoint
CREATE INDEX "moon_story_scores_coverage_mode_index" ON "moon_story_scores" USING btree ("coverage_mode");--> statement-breakpoint
CREATE INDEX "moon_story_scores_score_index" ON "moon_story_scores" USING btree ("moon_fit_score");--> statement-breakpoint
CREATE UNIQUE INDEX "moon_video_profiles_clip_id_unique" ON "moon_video_profiles" USING btree ("clip_id");--> statement-breakpoint
CREATE INDEX "moon_video_profiles_cluster_key_index" ON "moon_video_profiles" USING btree ("cluster_key");--> statement-breakpoint
CREATE INDEX "moon_video_profiles_coverage_mode_index" ON "moon_video_profiles" USING btree ("coverage_mode");--> statement-breakpoint
CREATE INDEX "moon_video_profiles_profile_version_index" ON "moon_video_profiles" USING btree ("profile_version");