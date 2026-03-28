import { z } from "zod";

import { scriptLabRequestSchema, scriptLabResponseSchema } from "@/lib/script-lab";

export const scriptAgentRequestSchema = scriptLabRequestSchema.extend({
  objective: z.string().trim().max(4000).optional().default(""),
  preferredAngle: z.string().trim().max(4000).optional().default(""),
  researchDepth: z.enum(["quick", "standard", "deep"]).optional().default("deep"),
});

export const scriptAgentStageKeySchema = z.enum([
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

export const scriptAgentStatusSchema = z.enum([
  "pending",
  "queued",
  "running",
  "complete",
  "failed",
  "needs_review",
]);

export const scriptAgentCreateResponseSchema = z.object({
  runId: z.string().uuid(),
  triggerRunId: z.string().nullable(),
  mode: z.enum(["trigger", "inline"]),
  status: scriptAgentStatusSchema,
});

export const scriptAgentStageRecordSchema = z.object({
  id: z.string().uuid(),
  stageKey: scriptAgentStageKeySchema,
  stageOrder: z.number().int(),
  status: scriptAgentStatusSchema,
  inputJson: z.unknown().nullable(),
  outputJson: z.unknown().nullable(),
  errorText: z.string().nullable(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  updatedAt: z.string(),
});

export const scriptAgentSourceRecordSchema = z.object({
  id: z.string().uuid(),
  sourceKind: z.enum([
    "research_dossier",
    "article",
    "video",
    "social_post",
    "library_clip",
    "generated_note",
  ]),
  providerName: z.string(),
  title: z.string(),
  url: z.string().nullable(),
  snippet: z.string().nullable(),
  publishedAt: z.string().nullable(),
  clipId: z.string().uuid().nullable(),
  contentStatus: scriptAgentStatusSchema,
  transcriptStatus: scriptAgentStatusSchema,
  contentJson: z.unknown().nullable(),
  metadataJson: z.unknown().nullable(),
});

export const scriptAgentQuoteRecordSchema = z.object({
  id: z.string().uuid(),
  sourceId: z.string().uuid().nullable(),
  sourceLabel: z.string(),
  sourceUrl: z.string().nullable(),
  quoteText: z.string(),
  speaker: z.string().nullable(),
  context: z.string().nullable(),
  relevanceScore: z.number().int(),
  startMs: z.number().int().nullable(),
  endMs: z.number().int().nullable(),
  metadataJson: z.unknown().nullable(),
});

export const scriptAgentClaimRecordSchema = z.object({
  id: z.string().uuid(),
  claimText: z.string(),
  supportLevel: z.number().int(),
  riskLevel: z.number().int(),
  evidenceRefsJson: z.unknown(),
  notes: z.string().nullable(),
});

export const scriptAgentRunSchema = z.object({
  id: z.string().uuid(),
  storyTitle: z.string(),
  status: scriptAgentStatusSchema,
  currentStage: scriptAgentStageKeySchema.nullable(),
  researchDepth: z.string(),
  triggerRunId: z.string().nullable(),
  request: scriptAgentRequestSchema,
  result: scriptLabResponseSchema.nullable(),
  errorText: z.string().nullable(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  stages: z.array(scriptAgentStageRecordSchema),
  sources: z.array(scriptAgentSourceRecordSchema),
  quotes: z.array(scriptAgentQuoteRecordSchema),
  claims: z.array(scriptAgentClaimRecordSchema),
});

export type ScriptAgentRequest = z.infer<typeof scriptAgentRequestSchema>;
export type ScriptAgentStageKey = z.infer<typeof scriptAgentStageKeySchema>;
export type ScriptAgentStatus = z.infer<typeof scriptAgentStatusSchema>;
export type ScriptAgentCreateResponse = z.infer<typeof scriptAgentCreateResponseSchema>;
export type ScriptAgentRun = z.infer<typeof scriptAgentRunSchema>;
