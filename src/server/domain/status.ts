import "server-only";

export const projectStatuses = ["draft", "active", "archived"] as const;
export const scriptLineTypes = [
  "narration",
  "quote",
  "transition",
  "headline",
] as const;
export const processingStatuses = [
  "pending",
  "queued",
  "running",
  "complete",
  "failed",
  "needs_review",
] as const;
export const researchSourceTypes = [
  "article",
  "document",
  "book",
  "video",
  "academic",
  "unknown",
] as const;
export const lineContentCategories = [
  "concrete_event",
  "named_person",
  "abstract_concept",
  "quote_claim",
  "historical_period",
  "transition",
  "sample_story",
] as const;
export const mediaTypes = [
  "video",
  "image",
  "stock_video",
  "stock_image",
  "article",
] as const;
export const recommendationTypes = [
  "ai_video",
  "ai_image",
  "stock_fallback",
] as const;

export type ProjectStatus = (typeof projectStatuses)[number];
export type ScriptLineType = (typeof scriptLineTypes)[number];
export type ProcessingStatus = (typeof processingStatuses)[number];
export type ResearchSourceType = (typeof researchSourceTypes)[number];
export type LineContentCategory = (typeof lineContentCategories)[number];
export type MediaType = (typeof mediaTypes)[number];
export type RecommendationType = (typeof recommendationTypes)[number];
