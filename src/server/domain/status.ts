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

export type ProjectStatus = (typeof projectStatuses)[number];
export type ScriptLineType = (typeof scriptLineTypes)[number];
export type ProcessingStatus = (typeof processingStatuses)[number];
export type ResearchSourceType = (typeof researchSourceTypes)[number];
