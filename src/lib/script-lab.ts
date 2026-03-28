import { z } from "zod";

export const scriptLabRequestSchema = z.object({
  storyTitle: z.string().trim().min(3).max(200),
  researchText: z.string().trim().min(200).max(50000),
  notes: z.string().trim().max(4000).optional().default(""),
  targetRuntimeMinutes: z.coerce.number().int().min(3).max(25).default(12),
});

export const scriptDraftSchema = z.object({
  title: z.string().trim().min(1),
  deck: z.string().trim().min(1),
  script: z.string().trim().min(1),
  beats: z.array(z.string().trim().min(1)).min(3).max(10),
  angle: z.string().trim().min(1),
  warnings: z.array(z.string().trim().min(1)).max(10).default([]),
});

export const scriptCritiqueSchema = z.object({
  strengths: z.array(z.string().trim().min(1)).min(1).max(8),
  weaknesses: z.array(z.string().trim().min(1)).min(1).max(8),
  mustFix: z.array(z.string().trim().min(1)).min(1).max(8),
  keep: z.array(z.string().trim().min(1)).min(1).max(8),
  verdict: z.string().trim().min(1),
});

export const scriptEvidenceQuoteSchema = z.object({
  sourceType: z.enum(["clip_transcript", "research_text"]),
  sourceTitle: z.string().trim().min(1),
  sourceUrl: z.string().trim().nullable().optional(),
  quoteText: z.string().trim().min(1),
  speaker: z.string().trim().nullable().optional(),
  context: z.string().trim().min(1),
  relevanceScore: z.number().int().min(0).max(100).default(50),
  startMs: z.number().int().min(0).nullable().optional(),
  endMs: z.number().int().min(0).nullable().optional(),
});

export const scriptResearchStageSchema = z.object({
  summary: z.string().trim().min(1),
  thesis: z.string().trim().min(1),
  keyClaims: z.array(z.string().trim().min(1)).min(3).max(8),
  riskyClaims: z.array(z.string().trim().min(1)).max(6).default([]),
  quoteEvidence: z.array(scriptEvidenceQuoteSchema).max(12).default([]),
});

export const scriptSelectedQuoteSchema = scriptEvidenceQuoteSchema.extend({
  quoteId: z.string().trim().min(1),
  usePriority: z.enum(["must_use", "strong_optional", "context_only"]),
  usageRole: z.string().trim().min(1),
  sectionHint: z.string().trim().nullable().optional(),
  qualityNotes: z.string().trim().nullable().optional(),
});

export const scriptRejectedQuoteSchema = z.object({
  quoteText: z.string().trim().min(1),
  reason: z.string().trim().min(1),
});

export const scriptQuoteSelectionStageSchema = z.object({
  selectedQuotes: z.array(scriptSelectedQuoteSchema).max(10).default([]),
  rejectedQuotes: z.array(scriptRejectedQuoteSchema).max(20).default([]),
});

export const scriptOutlineSectionSchema = z.object({
  heading: z.string().trim().min(1),
  purpose: z.string().trim().min(1),
  beatGoal: z.string().trim().min(1),
  targetWordCount: z.number().int().min(80).max(900),
  evidenceSlots: z.array(z.string().trim().min(1)).max(4).default([]),
});

export const scriptOutlineStageSchema = z.object({
  sections: z.array(scriptOutlineSectionSchema).min(4).max(10),
});

export const scriptQuotePlacementItemSchema = z.object({
  sectionHeading: z.string().trim().min(1),
  placementGoal: z.string().trim().min(1),
  requiredQuoteIds: z.array(z.string().trim().min(1)).max(3).default([]),
  optionalQuoteIds: z.array(z.string().trim().min(1)).max(4).default([]),
});

export const scriptQuotePlacementStageSchema = z.object({
  placements: z.array(scriptQuotePlacementItemSchema).min(1).max(10),
});

export const scriptStoryboardBeatSchema = z.object({
  sectionHeading: z.string().trim().min(1),
  visualApproach: z.string().trim().min(1),
  visualNotes: z.array(z.string().trim().min(1)).max(5).default([]),
  suggestedAssets: z.array(z.string().trim().min(1)).max(5).default([]),
});

export const scriptStoryboardStageSchema = z.object({
  beats: z.array(scriptStoryboardBeatSchema).min(1).max(10),
});

export const scriptSectionPlanItemSchema = z.object({
  sectionHeading: z.string().trim().min(1),
  narrativeRole: z.string().trim().min(1),
  targetWordCount: z.number().int().min(80).max(1200),
  requiredEvidence: z.array(z.string().trim().min(1)).max(6).default([]),
  openingMove: z.string().trim().min(1),
  closingMove: z.string().trim().min(1),
});

export const scriptSectionPlanStageSchema = z.object({
  sections: z.array(scriptSectionPlanItemSchema).min(4).max(10),
});

export const scriptSectionDraftItemSchema = z.object({
  sectionHeading: z.string().trim().min(1),
  script: z.string().trim().min(1),
  targetWordCount: z.number().int().min(80).max(1200),
  actualWordCount: z.number().int().min(1),
  evidenceUsed: z.array(z.string().trim().min(1)).max(8).default([]),
  transitionOut: z.string().trim().nullable().optional(),
});

export const scriptSectionDraftsStageSchema = z.object({
  sections: z.array(scriptSectionDraftItemSchema).min(1).max(10),
});

export const scriptRetentionStageSchema = z.object({
  hookAssessment: z.string().trim().min(1),
  keepWatchingMoments: z.array(z.string().trim().min(1)).min(2).max(8),
  deadZones: z.array(z.string().trim().min(1)).max(6).default([]),
  mustFix: z.array(z.string().trim().min(1)).min(1).max(8),
  pacingNotes: z.array(z.string().trim().min(1)).max(6).default([]),
});

const scriptLabClaudeVariantSchema = z.object({
  model: z.string(),
  draft: scriptDraftSchema,
  critiqueOfChatGPT: scriptCritiqueSchema.optional(),
  editorialNotes: z.array(z.string().trim().min(1)).min(1).max(12).optional(),
});

const scriptLabChatGptVariantSchema = z.object({
  model: z.string(),
  draft: scriptDraftSchema,
  critiqueOfClaude: scriptCritiqueSchema,
});

const scriptLabFinalVariantSchema = z.object({
  model: z.string(),
  draft: scriptDraftSchema,
  editorialNotes: z.array(z.string().trim().min(1)).min(1).max(12),
});

const scriptLabHybridVariantSchema = z.object({
  model: z.string(),
  draft: scriptDraftSchema,
  mediationNotes: z.array(z.string()).min(1).max(10),
});

export const scriptLabResponseSchema = z.object({
  generationMode: z.enum(["claude_only", "multi_model"]).default("claude_only"),
  input: scriptLabRequestSchema,
  moonAnalysis: z.object({
    moonFitScore: z.number(),
    moonFitBand: z.enum(["high", "medium", "low"]),
    clusterLabel: z.string().nullable(),
    coverageMode: z.string().nullable(),
    reasonCodes: z.array(z.string()),
    analogTitles: z.array(z.string()),
  }),
  variants: z.object({
    chatgpt: scriptLabChatGptVariantSchema.optional(),
    claude: scriptLabClaudeVariantSchema,
    final: scriptLabFinalVariantSchema.optional(),
    hybrid: scriptLabHybridVariantSchema.optional(),
  }),
  stages: z.object({
    research: scriptResearchStageSchema,
    quoteSelection: scriptQuoteSelectionStageSchema.optional(),
    outline: scriptOutlineStageSchema,
    quotePlacement: scriptQuotePlacementStageSchema.optional(),
    storyboard: scriptStoryboardStageSchema,
    sectionPlan: scriptSectionPlanStageSchema.optional(),
    sectionDrafts: scriptSectionDraftsStageSchema.optional(),
    finalSectionDrafts: scriptSectionDraftsStageSchema.optional(),
    retention: scriptRetentionStageSchema,
  }).optional(),
});

export const scriptLabSavedRunSchema = z.object({
  id: z.string().uuid(),
  storyTitle: z.string(),
  result: scriptLabResponseSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const scriptLabGenerateResponseSchema = z.object({
  runId: z.string().uuid(),
  permalink: z.string(),
  result: scriptLabResponseSchema,
});

export type ScriptLabRequest = z.infer<typeof scriptLabRequestSchema>;
export type ScriptDraft = z.infer<typeof scriptDraftSchema>;
export type ScriptCritique = z.infer<typeof scriptCritiqueSchema>;
export type ScriptEvidenceQuote = z.infer<typeof scriptEvidenceQuoteSchema>;
export type ScriptResearchStage = z.infer<typeof scriptResearchStageSchema>;
export type ScriptSelectedQuote = z.infer<typeof scriptSelectedQuoteSchema>;
export type ScriptQuoteSelectionStage = z.infer<typeof scriptQuoteSelectionStageSchema>;
export type ScriptOutlineStage = z.infer<typeof scriptOutlineStageSchema>;
export type ScriptQuotePlacementStage = z.infer<typeof scriptQuotePlacementStageSchema>;
export type ScriptStoryboardStage = z.infer<typeof scriptStoryboardStageSchema>;
export type ScriptSectionPlanStage = z.infer<typeof scriptSectionPlanStageSchema>;
export type ScriptSectionDraftsStage = z.infer<typeof scriptSectionDraftsStageSchema>;
export type ScriptRetentionStage = z.infer<typeof scriptRetentionStageSchema>;
export type ScriptLabResponse = z.infer<typeof scriptLabResponseSchema>;
export type ScriptLabSavedRun = z.infer<typeof scriptLabSavedRunSchema>;
export type ScriptLabGenerateResponse = z.infer<typeof scriptLabGenerateResponseSchema>;
