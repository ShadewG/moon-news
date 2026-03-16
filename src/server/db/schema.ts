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
