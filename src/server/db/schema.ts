import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const projectStatusEnum = pgEnum("project_status", [
  "draft",
  "active",
  "archived",
]);

export const scriptLineTypeEnum = pgEnum("script_line_type", [
  "narration",
  "quote",
  "transition",
  "headline",
]);

export const processingStatusEnum = pgEnum("processing_status", [
  "pending",
  "queued",
  "running",
  "complete",
  "failed",
  "needs_review",
]);

export const providerEnum = pgEnum("provider", [
  "parallel",
  "firecrawl",
  "openai",
  "gemini",
  "storyblocks",
  "artlist",
  "elevenlabs",
  "internal",
  "youtube",
  "internet_archive",
  "getty",
  "google_images",
  "twitter",
]);

export const researchSourceTypeEnum = pgEnum("research_source_type", [
  "article",
  "document",
  "book",
  "video",
  "academic",
  "unknown",
]);

export const lineContentCategoryEnum = pgEnum("line_content_category", [
  "concrete_event",
  "named_person",
  "abstract_concept",
  "quote_claim",
  "historical_period",
  "transition",
  "sample_story",
]);

export const mediaTypeEnum = pgEnum("media_type", [
  "video",
  "image",
  "stock_video",
  "stock_image",
  "article",
]);

export const recommendationTypeEnum = pgEnum("recommendation_type", [
  "ai_video",
  "ai_image",
  "stock_fallback",
]);

export const boardSourceKindEnum = pgEnum("board_source_kind", [
  "rss",
  "youtube_channel",
  "x_account",
  "tiktok_query",
  "tiktok_fyp_profile",
  "document_watch",
  "government_feed",
  "legal_watch",
  "archive_collection",
]);

export const boardStoryStatusEnum = pgEnum("board_story_status", [
  "developing",
  "watching",
  "peaked",
  "queued",
  "archived",
]);

export const boardStoryTypeEnum = pgEnum("board_story_type", [
  "normal",
  "trending",
  "controversy",
  "competitor",
  "correction",
]);

export const boardAiOutputKindEnum = pgEnum("board_ai_output_kind", [
  "brief",
  "script_starter",
  "titles",
]);

export const boardQueueStatusEnum = pgEnum("board_queue_status", [
  "watching",
  "researching",
  "scripting",
  "filming",
  "editing",
  "published",
]);

export const boardCompetitorTierEnum = pgEnum("board_competitor_tier", [
  "tier1",
  "tier2",
]);

export const boardCompetitorAlertLevelEnum = pgEnum(
  "board_competitor_alert_level",
  ["none", "watch", "hot"]
);

export const boardAlertTypeEnum = pgEnum("board_alert_type", [
  "surge",
  "controversy",
  "correction",
]);

export const scriptAgentStageEnum = pgEnum("script_agent_stage", [
  "plan_research",
  "discover_sources",
  "ingest_sources",
  "extract_evidence",
  "synthesize_research",
  "build_outline",
  "followup_research",
  "select_quotes",
  "place_quotes",
  "build_storyboard",
  "plan_sections",
  "write_sections",
  "assemble_draft",
  "critique_script",
  "revise_sections",
  "analyze_retention",
  "polish_script",
  "expand_script",
  "finalize_script",
]);

export const scriptAgentSourceKindEnum = pgEnum("script_agent_source_kind", [
  "research_dossier",
  "article",
  "video",
  "social_post",
  "library_clip",
  "generated_note",
]);

export const moonAnalysisScopeEnum = pgEnum("moon_analysis_scope", [
  "video",
  "weekly",
  "monthly",
]);

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    title: text("title").notNull(),
    slug: text("slug").notNull(),
    status: projectStatusEnum("status").notNull().default("draft"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [uniqueIndex("projects_slug_unique").on(table.slug)]
);

export const scriptVersions = pgTable(
  "script_versions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    versionNumber: integer("version_number").notNull().default(1),
    rawScript: text("raw_script").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("script_versions_project_version_unique").on(
      table.projectId,
      table.versionNumber
    ),
  ]
);

export const scriptLines = pgTable(
  "script_lines",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    scriptVersionId: uuid("script_version_id")
      .notNull()
      .references(() => scriptVersions.id, { onDelete: "cascade" }),
    lineKey: text("line_key").notNull(),
    lineIndex: integer("line_index").notNull(),
    timestampStartMs: integer("timestamp_start_ms").notNull().default(0),
    durationMs: integer("duration_ms").notNull().default(0),
    text: text("text").notNull(),
    lineType: scriptLineTypeEnum("line_type").notNull(),
    researchStatus: processingStatusEnum("research_status")
      .notNull()
      .default("pending"),
    footageStatus: processingStatusEnum("footage_status")
      .notNull()
      .default("pending"),
    imageStatus: processingStatusEnum("image_status")
      .notNull()
      .default("pending"),
    videoStatus: processingStatusEnum("video_status")
      .notNull()
      .default("pending"),
    lineContentCategory: lineContentCategoryEnum("line_content_category"),
    classificationJson: jsonb("classification_json"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("script_lines_project_line_key_unique").on(
      table.projectId,
      table.lineKey
    ),
    index("script_lines_project_id_index").on(table.projectId),
  ]
);

export const researchRuns = pgTable(
  "research_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    scriptLineId: uuid("script_line_id")
      .notNull()
      .references(() => scriptLines.id, { onDelete: "cascade" }),
    provider: providerEnum("provider").notNull().default("parallel"),
    status: processingStatusEnum("status").notNull().default("pending"),
    query: text("query"),
    triggerRunId: text("trigger_run_id"),
    parallelSearchId: text("parallel_search_id"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("research_runs_script_line_id_index").on(table.scriptLineId),
    index("research_runs_trigger_run_id_index").on(table.triggerRunId),
  ]
);

export const researchSources = pgTable(
  "research_sources",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    researchRunId: uuid("research_run_id")
      .notNull()
      .references(() => researchRuns.id, { onDelete: "cascade" }),
    scriptLineId: uuid("script_line_id")
      .notNull()
      .references(() => scriptLines.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    sourceName: text("source_name").notNull(),
    sourceUrl: text("source_url").notNull(),
    publishedAt: text("published_at"),
    snippet: text("snippet"),
    extractedTextPath: text("extracted_text_path"),
    relevanceScore: integer("relevance_score").notNull().default(0),
    sourceType: researchSourceTypeEnum("source_type")
      .notNull()
      .default("unknown"),
    citationJson: jsonb("citation_json"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("research_sources_run_id_index").on(table.researchRunId),
    index("research_sources_line_id_index").on(table.scriptLineId),
  ]
);

export const researchSummaries = pgTable(
  "research_summaries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    researchRunId: uuid("research_run_id")
      .notNull()
      .references(() => researchRuns.id, { onDelete: "cascade" }),
    scriptLineId: uuid("script_line_id")
      .notNull()
      .references(() => scriptLines.id, { onDelete: "cascade" }),
    summary: text("summary").notNull(),
    confidenceScore: integer("confidence_score").notNull().default(0),
    model: text("model").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("research_summaries_run_id_unique").on(table.researchRunId),
  ]
);

// ─── Visual Research Pipeline ───

export const footageSearchRuns = pgTable(
  "footage_search_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    scriptLineId: uuid("script_line_id")
      .notNull()
      .references(() => scriptLines.id, { onDelete: "cascade" }),
    provider: providerEnum("provider").notNull(),
    status: processingStatusEnum("status").notNull().default("pending"),
    query: text("query"),
    resultsCount: integer("results_count").notNull().default(0),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("footage_search_runs_line_id_index").on(table.scriptLineId),
    index("footage_search_runs_project_id_index").on(table.projectId),
  ]
);

export const footageAssets = pgTable(
  "footage_assets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    footageSearchRunId: uuid("footage_search_run_id")
      .notNull()
      .references(() => footageSearchRuns.id, { onDelete: "cascade" }),
    scriptLineId: uuid("script_line_id")
      .notNull()
      .references(() => scriptLines.id, { onDelete: "cascade" }),
    provider: providerEnum("provider").notNull(),
    mediaType: mediaTypeEnum("media_type").notNull(),
    externalAssetId: text("external_asset_id").notNull(),
    title: text("title").notNull(),
    previewUrl: text("preview_url"),
    sourceUrl: text("source_url").notNull(),
    licenseType: text("license_type"),
    durationMs: integer("duration_ms"),
    width: integer("width"),
    height: integer("height"),
    matchScore: integer("match_score").notNull().default(0),
    isPrimarySource: boolean("is_primary_source").notNull().default(false),
    uploadDate: text("upload_date"),
    channelOrContributor: text("channel_or_contributor"),
    scoreBreakdownJson: jsonb("score_breakdown_json"),
    metadataJson: jsonb("metadata_json"),
    filtered: boolean("filtered").notNull().default(false),
    filterReason: text("filter_reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("footage_assets_run_id_index").on(table.footageSearchRunId),
    index("footage_assets_line_id_index").on(table.scriptLineId),
  ]
);

export const footageQuotes = pgTable(
  "footage_quotes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    footageAssetId: uuid("footage_asset_id")
      .notNull()
      .references(() => footageAssets.id, { onDelete: "cascade" }),
    scriptLineId: uuid("script_line_id")
      .notNull()
      .references(() => scriptLines.id, { onDelete: "cascade" }),
    quoteText: text("quote_text").notNull(),
    speaker: text("speaker"),
    startMs: integer("start_ms").notNull(),
    endMs: integer("end_ms").notNull(),
    relevanceScore: integer("relevance_score").notNull().default(0),
    context: text("context"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("footage_quotes_asset_id_index").on(table.footageAssetId),
    index("footage_quotes_line_id_index").on(table.scriptLineId),
  ]
);

// ─── Global Clip Library & Transcript Cache ───

export const clipLibrary = pgTable(
  "clip_library",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    provider: providerEnum("provider").notNull(),
    externalId: text("external_id").notNull(),
    title: text("title").notNull(),
    sourceUrl: text("source_url").notNull(),
    previewUrl: text("preview_url"),
    channelOrContributor: text("channel_or_contributor"),
    durationMs: integer("duration_ms"),
    viewCount: integer("view_count"),
    uploadDate: text("upload_date"),
    metadataJson: jsonb("metadata_json"),
    hasTranscript: boolean("has_transcript").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("clip_library_provider_external_id_unique").on(
      table.provider,
      table.externalId
    ),
    index("clip_library_provider_index").on(table.provider),
    index("clip_library_created_at_index").on(table.createdAt),
    index("clip_library_has_transcript_index").on(table.hasTranscript),
    index("clip_library_view_count_index").on(table.viewCount),
  ]
);

export const transcriptCache = pgTable(
  "transcript_cache",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clipId: uuid("clip_id")
      .notNull()
      .references(() => clipLibrary.id, { onDelete: "cascade" }),
    language: text("language").notNull().default("en"),
    fullText: text("full_text").notNull(),
    segmentsJson: jsonb("segments_json").notNull(),
    wordCount: integer("word_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("transcript_cache_clip_language_unique").on(
      table.clipId,
      table.language
    ),
  ]
);

export const moonVideoProfiles = pgTable(
  "moon_video_profiles",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clipId: uuid("clip_id")
      .notNull()
      .references(() => clipLibrary.id, { onDelete: "cascade" }),
    clusterKey: text("cluster_key"),
    clusterLabel: text("cluster_label"),
    coverageMode: text("coverage_mode"),
    verticalGuess: text("vertical_guess"),
    titleTermsJson: jsonb("title_terms_json").notNull().default([]),
    transcriptTermsJson: jsonb("transcript_terms_json").notNull().default([]),
    namedEntitiesJson: jsonb("named_entities_json").notNull().default([]),
    hookTermsJson: jsonb("hook_terms_json").notNull().default([]),
    styleTermsJson: jsonb("style_terms_json").notNull().default([]),
    durationBucket: text("duration_bucket"),
    viewPercentile: real("view_percentile").notNull().default(0),
    recencyWeight: real("recency_weight").notNull().default(1),
    wordCount: integer("word_count").notNull().default(0),
    sourcePublishedAt: timestamp("source_published_at", { withTimezone: true }),
    profileVersion: integer("profile_version").notNull().default(1),
    analyzedAt: timestamp("analyzed_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("moon_video_profiles_clip_id_unique").on(table.clipId),
    index("moon_video_profiles_cluster_key_index").on(table.clusterKey),
    index("moon_video_profiles_coverage_mode_index").on(table.coverageMode),
    index("moon_video_profiles_profile_version_index").on(table.profileVersion),
  ]
);

export const moonCorpusTerms = pgTable(
  "moon_corpus_terms",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    term: text("term").notNull(),
    termType: text("term_type").notNull().default("keyword"),
    documentFrequency: integer("document_frequency").notNull().default(0),
    weightedDocumentFrequency: real("weighted_document_frequency").notNull().default(0),
    weight: real("weight").notNull().default(0),
    lift: real("lift").notNull().default(0),
    exampleClipIdsJson: jsonb("example_clip_ids_json").notNull().default([]),
    profileVersion: integer("profile_version").notNull().default(1),
    analyzedAt: timestamp("analyzed_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("moon_corpus_terms_term_type_version_unique").on(
      table.term,
      table.termType,
      table.profileVersion
    ),
    index("moon_corpus_terms_weight_index").on(table.weight),
    index("moon_corpus_terms_profile_version_index").on(table.profileVersion),
  ]
);

export const moonCorpusClusters = pgTable(
  "moon_corpus_clusters",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clusterKey: text("cluster_key").notNull(),
    label: text("label").notNull(),
    coverageMode: text("coverage_mode"),
    keywordsJson: jsonb("keywords_json").notNull().default([]),
    entityKeysJson: jsonb("entity_keys_json").notNull().default([]),
    exampleClipIdsJson: jsonb("example_clip_ids_json").notNull().default([]),
    profileVersion: integer("profile_version").notNull().default(1),
    analyzedAt: timestamp("analyzed_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("moon_corpus_clusters_key_version_unique").on(
      table.clusterKey,
      table.profileVersion
    ),
    index("moon_corpus_clusters_coverage_mode_index").on(table.coverageMode),
  ]
);

export const clipSearches = pgTable(
  "clip_searches",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    query: text("query").notNull(),
    resultsCount: integer("results_count").notNull().default(0),
    quotesCount: integer("quotes_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  }
);

export const clipSearchResults = pgTable(
  "clip_search_results",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    searchId: uuid("search_id")
      .notNull()
      .references(() => clipSearches.id, { onDelete: "cascade" }),
    clipId: uuid("clip_id")
      .notNull()
      .references(() => clipLibrary.id, { onDelete: "cascade" }),
    relevanceScore: integer("relevance_score").notNull().default(0),
  },
  (table) => [
    index("clip_search_results_search_id_index").on(table.searchId),
  ]
);

export const clipNotes = pgTable(
  "clip_notes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clipId: uuid("clip_id")
      .notNull()
      .references(() => clipLibrary.id, { onDelete: "cascade" }),
    text: text("text").notNull(),
    timestampMs: integer("timestamp_ms"),
    color: text("color").default("yellow"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("clip_notes_clip_id_index").on(table.clipId),
  ]
);

export const clipAiQueries = pgTable(
  "clip_ai_queries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clipId: uuid("clip_id")
      .notNull()
      .references(() => clipLibrary.id, { onDelete: "cascade" }),
    question: text("question").notNull(),
    answer: text("answer").notNull(),
    momentsJson: jsonb("moments_json").notNull(),
    model: text("model").notNull().default("gpt-4.1-mini"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("clip_ai_queries_clip_id_index").on(table.clipId),
    index("clip_ai_queries_created_at_index").on(table.createdAt),
  ]
);

export const clipSearchQuotes = pgTable(
  "clip_search_quotes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    searchId: uuid("search_id")
      .notNull()
      .references(() => clipSearches.id, { onDelete: "cascade" }),
    clipId: uuid("clip_id")
      .notNull()
      .references(() => clipLibrary.id, { onDelete: "cascade" }),
    quoteText: text("quote_text").notNull(),
    speaker: text("speaker"),
    startMs: integer("start_ms").notNull().default(0),
    endMs: integer("end_ms").notNull().default(0),
    relevanceScore: integer("relevance_score").notNull().default(0),
    context: text("context"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("clip_search_quotes_search_id_index").on(table.searchId),
  ]
);

export const visualRecommendations = pgTable(
  "visual_recommendations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    scriptLineId: uuid("script_line_id")
      .notNull()
      .references(() => scriptLines.id, { onDelete: "cascade" }),
    recommendationType: recommendationTypeEnum("recommendation_type").notNull(),
    reason: text("reason").notNull(),
    suggestedPrompt: text("suggested_prompt"),
    suggestedStyle: text("suggested_style"),
    confidence: real("confidence").notNull().default(0),
    dismissed: boolean("dismissed").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("visual_recommendations_line_id_index").on(table.scriptLineId),
    index("visual_recommendations_project_id_index").on(table.projectId),
  ]
);

export const boardSources = pgTable(
  "board_sources",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    kind: boardSourceKindEnum("kind").notNull(),
    provider: providerEnum("provider").notNull().default("internal"),
    pollIntervalMinutes: integer("poll_interval_minutes").notNull().default(15),
    enabled: boolean("enabled").notNull().default(true),
    configJson: jsonb("config_json"),
    lastPolledAt: timestamp("last_polled_at", { withTimezone: true }),
    lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("board_sources_name_kind_unique").on(table.name, table.kind),
    index("board_sources_provider_index").on(table.provider),
    index("board_sources_enabled_index").on(table.enabled),
  ]
);

export const boardFeedItems = pgTable(
  "board_feed_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => boardSources.id, { onDelete: "cascade" }),
    externalId: text("external_id").notNull(),
    title: text("title").notNull(),
    url: text("url").notNull(),
    author: text("author"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    summary: text("summary"),
    contentHash: text("content_hash"),
    sentimentScore: real("sentiment_score").notNull().default(0),
    controversyScore: integer("controversy_score").notNull().default(0),
    entityKeysJson: jsonb("entity_keys_json"),
    metadataJson: jsonb("metadata_json"),
    ingestedAt: timestamp("ingested_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("board_feed_items_source_external_unique").on(
      table.sourceId,
      table.externalId
    ),
    index("board_feed_items_source_id_index").on(table.sourceId),
    index("board_feed_items_published_at_index").on(table.publishedAt),
    index("board_feed_items_ingested_at_index").on(table.ingestedAt),
  ]
);

export const boardFeedItemVersions = pgTable(
  "board_feed_item_versions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    feedItemId: uuid("feed_item_id")
      .notNull()
      .references(() => boardFeedItems.id, { onDelete: "cascade" }),
    contentHash: text("content_hash"),
    title: text("title").notNull(),
    content: text("content"),
    diffSummary: text("diff_summary"),
    isCorrection: boolean("is_correction").notNull().default(false),
    versionNumber: integer("version_number").notNull().default(1),
    capturedAt: timestamp("captured_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("board_feed_item_versions_feed_version_unique").on(
      table.feedItemId,
      table.versionNumber
    ),
    index("board_feed_item_versions_feed_item_id_index").on(table.feedItemId),
    index("board_feed_item_versions_captured_at_index").on(table.capturedAt),
    index("board_feed_item_versions_is_correction_index").on(table.isCorrection),
  ]
);

export const boardStoryCandidates = pgTable(
  "board_story_candidates",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    slug: text("slug").notNull(),
    canonicalTitle: text("canonical_title").notNull(),
    vertical: text("vertical"),
    status: boardStoryStatusEnum("status").notNull().default("developing"),
    storyType: boardStoryTypeEnum("story_type").notNull().default("normal"),
    surgeScore: integer("surge_score").notNull().default(0),
    controversyScore: integer("controversy_score").notNull().default(0),
    sentimentScore: real("sentiment_score").notNull().default(0),
    itemsCount: integer("items_count").notNull().default(0),
    sourcesCount: integer("sources_count").notNull().default(0),
    correction: boolean("correction").notNull().default(false),
    formatsJson: jsonb("formats_json"),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    scoreJson: jsonb("score_json"),
    metadataJson: jsonb("metadata_json"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("board_story_candidates_slug_unique").on(table.slug),
    index("board_story_candidates_status_index").on(table.status),
    index("board_story_candidates_type_index").on(table.storyType),
    index("board_story_candidates_surge_score_index").on(table.surgeScore),
    index("board_story_candidates_controversy_score_index").on(
      table.controversyScore
    ),
    index("board_story_candidates_last_seen_at_index").on(table.lastSeenAt),
  ]
);

export const boardStorySources = pgTable(
  "board_story_sources",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    storyId: uuid("story_id")
      .notNull()
      .references(() => boardStoryCandidates.id, { onDelete: "cascade" }),
    feedItemId: uuid("feed_item_id")
      .notNull()
      .references(() => boardFeedItems.id, { onDelete: "cascade" }),
    sourceWeight: integer("source_weight").notNull().default(0),
    isPrimary: boolean("is_primary").notNull().default(false),
    evidenceJson: jsonb("evidence_json"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("board_story_sources_story_feed_unique").on(
      table.storyId,
      table.feedItemId
    ),
    index("board_story_sources_story_id_index").on(table.storyId),
    index("board_story_sources_feed_item_id_index").on(table.feedItemId),
  ]
);

export const moonStoryScores = pgTable(
  "moon_story_scores",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    storyId: uuid("story_id")
      .notNull()
      .references(() => boardStoryCandidates.id, { onDelete: "cascade" }),
    moonFitScore: integer("moon_fit_score").notNull().default(0),
    moonFitBand: text("moon_fit_band").notNull().default("low"),
    clusterKey: text("cluster_key"),
    clusterLabel: text("cluster_label"),
    coverageMode: text("coverage_mode"),
    analogClipIdsJson: jsonb("analog_clip_ids_json").notNull().default([]),
    analogTitlesJson: jsonb("analog_titles_json").notNull().default([]),
    analogMedianViews: integer("analog_median_views"),
    analogMedianDurationMinutes: real("analog_median_duration_minutes"),
    reasonCodesJson: jsonb("reason_codes_json").notNull().default([]),
    disqualifierCodesJson: jsonb("disqualifier_codes_json").notNull().default([]),
    profileVersion: integer("profile_version").notNull().default(1),
    scoredAt: timestamp("scored_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("moon_story_scores_story_id_unique").on(table.storyId),
    index("moon_story_scores_fit_band_index").on(table.moonFitBand),
    index("moon_story_scores_cluster_key_index").on(table.clusterKey),
    index("moon_story_scores_coverage_mode_index").on(table.coverageMode),
    index("moon_story_scores_score_index").on(table.moonFitScore),
  ]
);

export const boardStoryAiOutputs = pgTable(
  "board_story_ai_outputs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    storyId: uuid("story_id")
      .notNull()
      .references(() => boardStoryCandidates.id, { onDelete: "cascade" }),
    kind: boardAiOutputKindEnum("kind").notNull(),
    promptVersion: text("prompt_version").notNull().default("v1"),
    model: text("model").notNull().default("gpt-4.1-mini"),
    content: text("content").notNull(),
    metadataJson: jsonb("metadata_json"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("board_story_ai_outputs_story_kind_prompt_unique").on(
      table.storyId,
      table.kind,
      table.promptVersion
    ),
    index("board_story_ai_outputs_story_id_index").on(table.storyId),
  ]
);

export const boardCompetitorChannels = pgTable(
  "board_competitor_channels",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    platform: text("platform").notNull().default("youtube"),
    tier: boardCompetitorTierEnum("tier").notNull().default("tier2"),
    handle: text("handle"),
    channelUrl: text("channel_url"),
    subscribersLabel: text("subscribers_label"),
    pollIntervalMinutes: integer("poll_interval_minutes").notNull().default(15),
    enabled: boolean("enabled").notNull().default(true),
    metadataJson: jsonb("metadata_json"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("board_competitor_channels_name_platform_unique").on(
      table.name,
      table.platform
    ),
    index("board_competitor_channels_tier_index").on(table.tier),
    index("board_competitor_channels_enabled_index").on(table.enabled),
  ]
);

export const boardCompetitorPosts = pgTable(
  "board_competitor_posts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    channelId: uuid("channel_id")
      .notNull()
      .references(() => boardCompetitorChannels.id, { onDelete: "cascade" }),
    externalId: text("external_id").notNull(),
    title: text("title").notNull(),
    url: text("url"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    viewsLabel: text("views_label"),
    engagementJson: jsonb("engagement_json"),
    topicMatchScore: integer("topic_match_score").notNull().default(0),
    alertLevel: boardCompetitorAlertLevelEnum("alert_level")
      .notNull()
      .default("none"),
    metadataJson: jsonb("metadata_json"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("board_competitor_posts_channel_external_unique").on(
      table.channelId,
      table.externalId
    ),
    index("board_competitor_posts_channel_id_index").on(table.channelId),
    index("board_competitor_posts_alert_level_index").on(table.alertLevel),
    index("board_competitor_posts_published_at_index").on(table.publishedAt),
  ]
);

export const boardQueueItems = pgTable(
  "board_queue_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    storyId: uuid("story_id")
      .notNull()
      .references(() => boardStoryCandidates.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(1),
    status: boardQueueStatusEnum("status").notNull().default("watching"),
    format: text("format"),
    targetPublishAt: timestamp("target_publish_at", { withTimezone: true }),
    assignedTo: text("assigned_to"),
    notes: text("notes"),
    linkedProjectId: uuid("linked_project_id").references(() => projects.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("board_queue_items_story_id_unique").on(table.storyId),
    index("board_queue_items_position_index").on(table.position),
    index("board_queue_items_status_index").on(table.status),
  ]
);

export const boardTickerEvents = pgTable(
  "board_ticker_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    storyId: uuid("story_id").references(() => boardStoryCandidates.id, {
      onDelete: "set null",
    }),
    label: text("label").notNull(),
    text: text("text").notNull(),
    priority: integer("priority").notNull().default(0),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("board_ticker_events_priority_index").on(table.priority),
    index("board_ticker_events_starts_at_index").on(table.startsAt),
    index("board_ticker_events_expires_at_index").on(table.expiresAt),
  ]
);

export const boardSurgeAlerts = pgTable(
  "board_surge_alerts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    storyId: uuid("story_id")
      .notNull()
      .references(() => boardStoryCandidates.id, { onDelete: "cascade" }),
    alertType: boardAlertTypeEnum("alert_type").notNull(),
    headline: text("headline").notNull(),
    text: text("text").notNull(),
    surgeScore: real("surge_score").notNull().default(0),
    baselineAvg: real("baseline_avg").notNull().default(0),
    currentCount: integer("current_count").notNull().default(0),
    windowMinutes: integer("window_minutes").notNull().default(120),
    metadataJson: jsonb("metadata_json"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    dismissedAt: timestamp("dismissed_at", { withTimezone: true }),
  },
  (table) => [
    index("board_surge_alerts_story_id_index").on(table.storyId),
    index("board_surge_alerts_alert_type_index").on(table.alertType),
    index("board_surge_alerts_created_at_index").on(table.createdAt),
    index("board_surge_alerts_dismissed_at_index").on(table.dismissedAt),
  ]
);

export const scriptLabRuns = pgTable(
  "script_lab_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    storyTitle: text("story_title").notNull(),
    requestJson: jsonb("request_json").notNull(),
    resultJson: jsonb("result_json").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("script_lab_runs_story_title_index").on(table.storyTitle),
    index("script_lab_runs_created_at_index").on(table.createdAt),
  ]
);

export const moonAnalysisRuns = pgTable(
  "moon_analysis_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    status: processingStatusEnum("status").notNull().default("pending"),
    scopeType: moonAnalysisScopeEnum("scope_type").notNull(),
    scopeStartDate: text("scope_start_date").notNull(),
    scopeEndDate: text("scope_end_date").notNull(),
    youtubeVideoId: text("youtube_video_id"),
    youtubeVideoTitle: text("youtube_video_title"),
    label: text("label"),
    requestJson: jsonb("request_json").notNull(),
    resultJson: jsonb("result_json"),
    reportHtml: text("report_html"),
    artifactDir: text("artifact_dir"),
    errorText: text("error_text"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("moon_analysis_runs_status_index").on(table.status),
    index("moon_analysis_runs_scope_type_index").on(table.scopeType),
    index("moon_analysis_runs_created_at_index").on(table.createdAt),
    index("moon_analysis_runs_youtube_video_id_index").on(table.youtubeVideoId),
  ]
);

export const scriptAgentRuns = pgTable(
  "script_agent_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    storyTitle: text("story_title").notNull(),
    status: processingStatusEnum("status").notNull().default("pending"),
    currentStage: scriptAgentStageEnum("current_stage"),
    researchDepth: text("research_depth").notNull().default("deep"),
    triggerRunId: text("trigger_run_id"),
    requestJson: jsonb("request_json").notNull(),
    resultJson: jsonb("result_json"),
    errorText: text("error_text"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("script_agent_runs_story_title_index").on(table.storyTitle),
    index("script_agent_runs_status_index").on(table.status),
    index("script_agent_runs_created_at_index").on(table.createdAt),
  ]
);

export const scriptAgentStages = pgTable(
  "script_agent_stages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    runId: uuid("run_id")
      .notNull()
      .references(() => scriptAgentRuns.id, { onDelete: "cascade" }),
    stageKey: scriptAgentStageEnum("stage_key").notNull(),
    stageOrder: integer("stage_order").notNull().default(0),
    status: processingStatusEnum("status").notNull().default("pending"),
    inputJson: jsonb("input_json"),
    outputJson: jsonb("output_json"),
    errorText: text("error_text"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("script_agent_stages_run_stage_unique").on(table.runId, table.stageKey),
    index("script_agent_stages_run_id_index").on(table.runId),
    index("script_agent_stages_status_index").on(table.status),
  ]
);

export const scriptAgentSources = pgTable(
  "script_agent_sources",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    runId: uuid("run_id")
      .notNull()
      .references(() => scriptAgentRuns.id, { onDelete: "cascade" }),
    stageKey: scriptAgentStageEnum("stage_key"),
    sourceKind: scriptAgentSourceKindEnum("source_kind").notNull(),
    providerName: text("provider_name").notNull().default("internal"),
    title: text("title").notNull(),
    url: text("url"),
    snippet: text("snippet"),
    publishedAt: text("published_at"),
    clipId: uuid("clip_id").references(() => clipLibrary.id, {
      onDelete: "set null",
    }),
    contentStatus: processingStatusEnum("content_status")
      .notNull()
      .default("pending"),
    transcriptStatus: processingStatusEnum("transcript_status")
      .notNull()
      .default("pending"),
    contentJson: jsonb("content_json"),
    metadataJson: jsonb("metadata_json"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("script_agent_sources_run_id_index").on(table.runId),
    index("script_agent_sources_source_kind_index").on(table.sourceKind),
    index("script_agent_sources_provider_name_index").on(table.providerName),
    index("script_agent_sources_clip_id_index").on(table.clipId),
  ]
);

export const scriptAgentQuotes = pgTable(
  "script_agent_quotes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    runId: uuid("run_id")
      .notNull()
      .references(() => scriptAgentRuns.id, { onDelete: "cascade" }),
    sourceId: uuid("source_id").references(() => scriptAgentSources.id, {
      onDelete: "set null",
    }),
    sourceLabel: text("source_label").notNull(),
    sourceUrl: text("source_url"),
    quoteText: text("quote_text").notNull(),
    speaker: text("speaker"),
    context: text("context"),
    relevanceScore: integer("relevance_score").notNull().default(0),
    startMs: integer("start_ms"),
    endMs: integer("end_ms"),
    metadataJson: jsonb("metadata_json"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("script_agent_quotes_run_id_index").on(table.runId),
    index("script_agent_quotes_source_id_index").on(table.sourceId),
    index("script_agent_quotes_relevance_score_index").on(table.relevanceScore),
  ]
);

export const scriptAgentClaims = pgTable(
  "script_agent_claims",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    runId: uuid("run_id")
      .notNull()
      .references(() => scriptAgentRuns.id, { onDelete: "cascade" }),
    claimText: text("claim_text").notNull(),
    supportLevel: integer("support_level").notNull().default(50),
    riskLevel: integer("risk_level").notNull().default(0),
    evidenceRefsJson: jsonb("evidence_refs_json").notNull().default([]),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("script_agent_claims_run_id_index").on(table.runId),
    index("script_agent_claims_support_level_index").on(table.supportLevel),
    index("script_agent_claims_risk_level_index").on(table.riskLevel),
  ]
);

// ─── Script Edits & Feedback ───

export const scriptEditStatusEnum = pgEnum("script_edit_status", [
  "draft",
  "in_review",
  "approved",
  "needs_revision",
  "final",
]);

export const scriptEdits = pgTable(
  "script_edits",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    /** Can reference either a script_agent_runs or script_lab_runs id */
    runId: uuid("run_id").notNull(),
    runKind: text("run_kind").notNull().default("agent"), // "agent" | "lab"
    editedTitle: text("edited_title"),
    editedScript: text("edited_script"),
    editedDeck: text("edited_deck"),
    editStatus: scriptEditStatusEnum("edit_status").notNull().default("draft"),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("script_edits_run_id_index").on(table.runId),
    index("script_edits_edit_status_index").on(table.editStatus),
  ]
);

export const scriptFeedback = pgTable(
  "script_feedback",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    runId: uuid("run_id").notNull(),
    runKind: text("run_kind").notNull().default("agent"),
    /** null = overall feedback, otherwise references a section/beat */
    anchor: text("anchor"),
    body: text("body").notNull(),
    resolved: boolean("resolved").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("script_feedback_run_id_index").on(table.runId),
  ]
);

// ─── Extracted Content Cache ───

export const extractedContentCache = pgTable(
  "extracted_content_cache",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    urlHash: text("url_hash").notNull().unique(),
    url: text("url").notNull(),
    title: text("title"),
    content: text("content").notNull(),
    author: text("author"),
    publishedAt: text("published_at"),
    siteName: text("site_name"),
    wordCount: integer("word_count").notNull().default(0),
    extractedAt: timestamp("extracted_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("extracted_content_cache_url_hash_index").on(table.urlHash),
  ]
);

// ─── Research Progress Tracking ───

export const researchProgress = pgTable(
  "research_progress",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    storyId: uuid("story_id")
      .notNull()
      .references(() => boardStoryCandidates.id, { onDelete: "cascade" }),
    taskType: text("task_type").notNull().default("deep_research"),
    step: text("step").notNull().default("pending"),
    progress: integer("progress").notNull().default(0),
    message: text("message"),
    metadataJson: jsonb("metadata_json"),
    startedAt: timestamp("started_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("research_progress_story_id_index").on(table.storyId),
  ]
);
