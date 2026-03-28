import "server-only";

import path from "node:path";
import { spawn } from "node:child_process";

import { tasks } from "@trigger.dev/sdk/v3";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import {
  type ScriptAgentRequest,
  type ScriptAgentRun,
  type ScriptAgentStageKey,
  scriptAgentRunSchema,
} from "@/lib/script-agent";
import type { ScriptEvidenceQuote } from "@/lib/script-lab";
import { getEnv, isTriggerConfigured, requireEnv } from "@/server/config/env";
import { getDb } from "@/server/db/client";
import {
  clipLibrary,
  scriptAgentClaims,
  scriptAgentQuotes,
  scriptAgentRuns,
  scriptAgentSources,
  scriptAgentStages,
  transcriptCache,
} from "@/server/db/schema";
import {
  articleFactExtractSchema,
  extractArticleFactsFromMarkdown,
  findRelevantQuotes,
} from "@/server/providers/openai";
import {
  runDeepResearchMemo,
  searchResearchSources,
} from "@/server/providers/parallel";
import { ingestLocalMediaArtifacts } from "@/server/providers/local-media";
import { fetchYouTubeComments } from "@/server/providers/youtube";
import { extractContent } from "@/server/services/board/content-extractor";
import { searchNewsStory } from "@/server/services/board/news-search";
import {
  cacheTranscriptSegments,
  ensureYouTubeTranscript,
  upsertClipInLibrary,
} from "@/server/services/clip-library";
import {
  analyzeRetentionStage,
  assembleScriptDraftFromSections,
  createAnthropicJson,
  critiqueScriptDraft,
  expandDraftToMinimumLength,
  generateOutlineStage,
  generateQuotePlacementStage,
  generateQuoteSelectionStage,
  generateResearchStage,
  generateSectionPlanStage,
  generateStoryboardStage,
  getAnthropicPlanningModel,
  getAnthropicWritingModel,
  polishScriptDraft,
  prepareScriptLabPipelineContext,
  reviseSectionDraftsStage,
  writeSectionDraftsStage,
} from "@/server/services/script-lab";
import { searchTopic } from "@/server/services/topic-search";
import { isMoonVideoCandidate } from "@/server/services/moon-video-exclusion";

export const SCRIPT_AGENT_TASK_ID = "run-script-agent";

const SCRIPT_AGENT_STAGE_ORDER: ScriptAgentStageKey[] = [
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
];

function serializeDate(value: Date | null | undefined) {
  return value ? value.toISOString() : null;
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}

function ensureScriptAgentEnvironment() {
  requireEnv("ANTHROPIC_API_KEY");
}

function spawnLocalScriptAgentWorker(runId: string) {
  const cwd = process.cwd();
  const child = spawn(
    process.execPath,
    [
      "--conditions=react-server",
      `--env-file=${path.resolve(cwd, ".env")}`,
      "--import",
      "tsx",
      path.resolve(cwd, "scripts/run-script-agent-local.ts"),
      runId,
    ],
    {
      cwd,
      detached: true,
      stdio: "ignore",
    }
  );

  if (!child.pid) {
    throw new Error(`Failed to spawn local script-agent worker for run ${runId}`);
  }

  child.unref();
}

function extractDirectQuotes(text: string) {
  const pattern = /["“]([^"\n”]{24,280})["”]/g;
  const seen = new Set<string>();
  const quotes: Array<{
    quoteText: string;
    context: string;
  }> = [];

  for (const block of text.split(/\n{2,}/).map((entry) => entry.trim()).filter(Boolean)) {
    for (const match of block.matchAll(pattern)) {
      const quoteText = (match[1] ?? "").replace(/\s+/g, " ").trim();
      if (quoteText.length < 24) {
        continue;
      }
      const key = quoteText.toLowerCase();
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      quotes.push({
        quoteText,
        context: block.slice(0, 260),
      });
    }
  }

  return quotes.slice(0, 8);
}

function mapResearchDepthToSearchMode(depth: ScriptAgentRequest["researchDepth"]) {
  return depth === "quick" ? "quick" : "full";
}

function trimToLength(text: string, maxChars: number) {
  if (text.length <= maxChars) {
    return text;
  }

  return `${text.slice(0, maxChars - 3).trimEnd()}...`;
}

const YOUTUBE_VIDEO_ID_PATTERN = /^[a-zA-Z0-9_-]{11}$/;
const TRANSCRIPT_KEYWORD_STOPWORDS = new Set([
  "brand",
  "about",
  "after",
  "again",
  "against",
  "argues",
  "around",
  "audiences",
  "because",
  "before",
  "being",
  "build",
  "collapse",
  "could",
  "dead",
  "everything",
  "explains",
  "focus",
  "franchise",
  "from",
  "have",
  "hollywood",
  "into",
  "make",
  "modern",
  "movie",
  "not",
  "piece",
  "should",
  "story",
  "system",
  "that",
  "their",
  "them",
  "there",
  "these",
  "this",
  "trains",
  "trailer",
  "trust",
  "use",
  "uses",
  "video",
  "with",
  "wrong",
  "youtube",
  "day",
  "official",
  "peter",
  "spider-man",
  "spiderman",
]);

function normalizeTranscriptQuoteText(text: string) {
  return text
    .replace(/\s+/g, " ")
    .replace(/[“”]/g, "\"")
    .trim();
}

function isUsableTranscriptQuoteText(text: string) {
  const normalized = normalizeTranscriptQuoteText(text);
  if (normalized.length < 32 || normalized.length > 260) {
    return false;
  }

  if (normalized.includes("...")) {
    return false;
  }

  if (!/[.!?"]$/.test(normalized)) {
    return false;
  }

  if (!/[A-Z0-9]/.test(normalized.charAt(0) || "")) {
    return false;
  }

  return normalized.split(/\s+/).filter(Boolean).length >= 6;
}

function extractYouTubeVideoIdFromUrl(rawUrl: string) {
  try {
    const url = new URL(rawUrl);
    const hostname = url.hostname.replace(/^www\./i, "").toLowerCase();

    if (hostname === "youtu.be") {
      const candidate = url.pathname.split("/").filter(Boolean)[0] ?? "";
      return YOUTUBE_VIDEO_ID_PATTERN.test(candidate) ? candidate : null;
    }

    if (
      hostname === "youtube.com" ||
      hostname === "m.youtube.com" ||
      hostname === "music.youtube.com" ||
      hostname === "youtube-nocookie.com"
    ) {
      const directId = url.searchParams.get("v");
      if (directId && YOUTUBE_VIDEO_ID_PATTERN.test(directId)) {
        return directId;
      }

      const parts = url.pathname.split("/").filter(Boolean);
      const candidate =
        parts[0] === "embed" || parts[0] === "shorts" || parts[0] === "live"
          ? parts[1] ?? null
          : null;

      if (candidate && YOUTUBE_VIDEO_ID_PATTERN.test(candidate)) {
        return candidate;
      }
    }
  } catch {
    // Fall back to regex parsing below.
  }

  const fallbackMatch = rawUrl.match(
    /(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/(?:watch\?(?:[^#\s]*&)?v=|embed\/|shorts\/|live\/))([A-Za-z0-9_-]{11})/i
  );
  return fallbackMatch?.[1] ?? null;
}

function buildTranscriptQuoteKey(sourceExternalId: string, startMs: number, quoteText: string) {
  return `${sourceExternalId}:${startMs}:${normalizeTranscriptQuoteText(quoteText).toLowerCase()}`;
}

function extractTranscriptKeywords(text: string, limit: number) {
  const seen = new Set<string>();
  const matches = text.toLowerCase().match(/[a-z0-9][a-z0-9-]{1,}/g) ?? [];
  const keywords: string[] = [];

  for (const match of matches) {
    const normalized = match.replace(/^-+|-+$/g, "");
    if (!normalized) {
      continue;
    }

    const isShortAcronym = normalized === "ai" || normalized === "vfx" || normalized === "cgi" || normalized === "mcu";
    if (!isShortAcronym && normalized.length < 4) {
      continue;
    }

    if (TRANSCRIPT_KEYWORD_STOPWORDS.has(normalized) || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    keywords.push(normalized);
    if (keywords.length >= limit) {
      break;
    }
  }

  return keywords;
}

function looksLikeEditorialStoryTitle(title: string) {
  const normalized = title.trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  return (
    /\byou\b/.test(normalized) ||
    /\bthis\b/.test(normalized) ||
    /\bthe truth\b/.test(normalized) ||
    /\btried to warn\b/.test(normalized) ||
    /\bwarn(?:ed|ing)?\b/.test(normalized) ||
    /^\s*(why|how|what)\b/.test(normalized)
  );
}

function buildStorySearchAnchor(args: {
  storyTitle: string;
  objective?: string | null;
  preferredAngle?: string | null;
  notes?: string | null;
  strategy?: ResearchStrategy | null;
  broadResearch?: InitialBroadResearch | null;
  extraText?: string | null;
  limit?: number;
}) {
  if (!looksLikeEditorialStoryTitle(args.storyTitle)) {
    return args.storyTitle.trim();
  }

  const keywordText = [
    args.objective,
    args.preferredAngle,
    args.notes,
    args.strategy?.primaryAngle,
    args.strategy?.hookIdea,
    args.broadResearch?.factualOverview,
    args.broadResearch?.originPremise,
    args.broadResearch?.broaderSystem,
    args.broadResearch?.resolutionMechanism,
    ...(args.broadResearch?.keyFacts ?? []).map((fact) => fact.fact),
    ...(args.broadResearch?.turningPoints ?? []),
    ...(args.broadResearch?.runwayBeats ?? []),
    ...(args.broadResearch?.stakeShifters ?? []),
    ...(args.strategy?.globalSearchThemes ?? []),
    ...(args.strategy?.videoStructure ?? []).flatMap((section) => [
      section.title,
      section.purpose,
      ...section.searchPriorities.slice(0, 2),
    ]),
    args.extraText,
  ]
    .filter(Boolean)
    .join(" ");

  const keywords = dedupeStringList(
    extractTranscriptKeywords(keywordText, args.limit ?? 7),
    args.limit ?? 7
  );

  return keywords.join(" ").trim() || args.storyTitle.trim();
}

function splitTranscriptIntoBlocks(transcript: Array<{ text: string; startMs: number; durationMs: number }>) {
  const blocks: Array<{ text: string; startMs: number; endMs: number }> = [];
  let currentSegments: Array<{ text: string; startMs: number; durationMs: number }> = [];

  for (const segment of transcript) {
    if (
      currentSegments.length > 0 &&
      segment.startMs - currentSegments[0].startMs >= 25000
    ) {
      const last = currentSegments[currentSegments.length - 1];
      blocks.push({
        text: currentSegments.map((entry) => entry.text).join(" ").replace(/\s+/g, " ").trim(),
        startMs: currentSegments[0].startMs,
        endMs: last.startMs + (last.durationMs || 5000),
      });
      currentSegments = [];
    }

    currentSegments.push(segment);
  }

  if (currentSegments.length > 0) {
    const last = currentSegments[currentSegments.length - 1];
    blocks.push({
      text: currentSegments.map((entry) => entry.text).join(" ").replace(/\s+/g, " ").trim(),
      startMs: currentSegments[0].startMs,
      endMs: last.startMs + (last.durationMs || 5000),
    });
  }

  return blocks;
}

function selectFallbackQuoteCandidate(args: {
  blockText: string;
  primaryKeywords: string[];
  secondaryKeywords: string[];
}) {
  const sentences = args.blockText
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => normalizeTranscriptQuoteText(sentence))
    .filter(Boolean);
  const candidateTexts = new Set<string>();

  for (let index = 0; index < sentences.length; index += 1) {
    candidateTexts.add(sentences[index]);
    if (index < sentences.length - 1) {
      candidateTexts.add(`${sentences[index]} ${sentences[index + 1]}`.trim());
    }
  }

  const scoredCandidates = [...candidateTexts]
    .map((candidateText) => {
      const normalized = normalizeTranscriptQuoteText(candidateText);
      if (!isUsableTranscriptQuoteText(normalized)) {
        return null;
      }

      const lower = normalized.toLowerCase();
      const primaryHits = args.primaryKeywords.filter((keyword) => lower.includes(keyword));
      const secondaryHits = args.secondaryKeywords.filter((keyword) => lower.includes(keyword));
      const score = primaryHits.length * 5 + secondaryHits.length * 2;

      return {
        quoteText: normalized,
        primaryHits,
        secondaryHits,
        score,
      };
    })
    .filter(
      (candidate): candidate is {
        quoteText: string;
        primaryHits: string[];
        secondaryHits: string[];
        score: number;
      } => Boolean(candidate)
    )
    .filter((candidate) => candidate.primaryHits.length > 0 || candidate.secondaryHits.length >= 2)
    .sort((left, right) => right.score - left.score);

  if (scoredCandidates.length > 0) {
    return scoredCandidates[0];
  }

  const normalizedBlock = normalizeTranscriptQuoteText(args.blockText);
  if (!isUsableTranscriptQuoteText(normalizedBlock)) {
    return null;
  }

  const lower = normalizedBlock.toLowerCase();
  const primaryHits = args.primaryKeywords.filter((keyword) => lower.includes(keyword));
  const secondaryHits = args.secondaryKeywords.filter((keyword) => lower.includes(keyword));
  const score = primaryHits.length * 5 + secondaryHits.length * 2;
  if (primaryHits.length === 0 && secondaryHits.length < 2) {
    return null;
  }

  return {
    quoteText: normalizedBlock,
    primaryHits,
    secondaryHits,
    score,
  };
}

function extractFallbackTranscriptQuotes(args: {
  input: ScriptAgentRequest;
  transcript: Array<{ text: string; startMs: number; durationMs: number }>;
  videoTitle: string;
  maxQuotes: number;
}) {
  const primaryKeywords = extractTranscriptKeywords(
    [args.input.preferredAngle, args.input.notes].join(" "),
    12
  );
  const secondaryKeywords = extractTranscriptKeywords(
    [args.input.objective, args.input.storyTitle].join(" "),
    12
  ).filter((keyword) => !primaryKeywords.includes(keyword));
  const blocks = splitTranscriptIntoBlocks(args.transcript);
  const seen = new Set<string>();

  return blocks
    .map((block) => {
      const candidate = selectFallbackQuoteCandidate({
        blockText: block.text,
        primaryKeywords,
        secondaryKeywords,
      });

      return {
        block,
        candidate,
      };
    })
    .filter(
      (
        candidate
      ): candidate is {
        block: { text: string; startMs: number; endMs: number };
        candidate: {
          quoteText: string;
          primaryHits: string[];
          secondaryHits: string[];
          score: number;
        };
      } => Boolean(candidate.candidate && candidate.candidate.score > 0)
    )
    .sort((left, right) => right.candidate.score - left.candidate.score)
    .flatMap((candidate) => {
      const quoteText = candidate.candidate.quoteText;
      const dedupeKey = quoteText.toLowerCase();
      if (seen.has(dedupeKey)) {
        return [];
      }

      seen.add(dedupeKey);
      return [
        {
          quoteText,
          speaker: null,
          startMs: candidate.block.startMs,
          endMs: candidate.block.endMs,
          relevanceScore: Math.min(88, 42 + candidate.candidate.score * 6),
          context: `Transcript fallback from ${args.videoTitle} touching ${[
            ...candidate.candidate.primaryHits,
            ...candidate.candidate.secondaryHits,
          ]
            .slice(0, 3)
            .join(", ")}`,
        },
      ];
    })
    .slice(0, args.maxQuotes);
}

type ScriptAgentResearchBeamSearchMode = "news_web" | "social_web" | "video_topic";

type ScriptAgentResearchBeam = {
  beamId: string;
  phase: "initial" | "section_followup";
  label: string;
  objective: string;
  query: string;
  searchMode: ScriptAgentResearchBeamSearchMode;
  sectionHeading: string | null;
};

type ScriptAgentSeedUrl = {
  url: string;
  label: string;
  reason: string;
  sectionHeading: string | null;
};

type ScriptAgentResearchPlan = {
  summary: string;
  globalBeams: ScriptAgentResearchBeam[];
  sectionBeams: ScriptAgentResearchBeam[];
  seedUrls: ScriptAgentSeedUrl[];
};

const initialBroadResearchFactSchema = z.object({
  fact: z.string().trim().min(1),
  sourceLabel: z.string().trim().min(1),
  url: z.string().trim().min(1).nullable().optional(),
  confidence: z.enum(["high", "medium", "low"]).default("medium"),
});

const initialBroadResearchSectionSchema = z.object({
  title: z.string().trim().min(1),
  whyItMatters: z.string().trim().min(1),
});

const initialBroadResearchSourceGroupSchema = z.object({
  label: z.string().trim().min(1),
  reason: z.string().trim().min(1),
  urls: z.array(z.string().trim().min(1)).max(10).default([]),
});

const initialBroadResearchSchema = z.object({
  factualOverview: z.string().trim().min(1),
  originPremise: z.string().trim().min(1),
  keyFacts: z.array(initialBroadResearchFactSchema).min(3).max(12),
  tensions: z.array(z.string().trim().min(1)).min(2).max(8),
  broaderSystem: z.string().trim().min(1),
  runwayBeats: z.array(z.string().trim().min(1)).min(2).max(8),
  turningPoints: z.array(z.string().trim().min(1)).min(2).max(8),
  stakeShifters: z.array(z.string().trim().min(1)).min(1).max(8),
  resolutionMechanism: z.string().trim().min(1),
  openQuestions: z.array(z.string().trim().min(1)).min(1).max(8),
  sectionCandidates: z.array(initialBroadResearchSectionSchema).min(3).max(8),
  sourceGroups: z.array(initialBroadResearchSourceGroupSchema).max(8).default([]),
});

const planningEvidenceBeatSchema = z.object({
  beatId: z.string().trim().min(1),
  category: z.enum([
    "origin",
    "escalation",
    "operational_detail",
    "relationship_turn",
    "motive_frame",
    "deterrent",
    "resolution",
  ]),
  detail: z.string().trim().min(1),
  sourceTitle: z.string().trim().min(1),
  url: z.string().trim().min(1).nullable().optional(),
  priority: z.enum(["high", "medium"]).default("medium"),
});

const researchStrategyBeatDecisionSchema = z.object({
  beatId: z.string().trim().min(1),
  beat: z.string().trim().min(1),
  decision: z.enum(["core", "supporting", "skip"]),
  reason: z.string().trim().min(1),
  targetSectionId: z.string().trim().min(1).nullable().optional(),
});

const planningArticleQuerySchema = z.object({
  queries: z.array(z.string().trim().min(1)).max(6).default([]),
});

const researchStrategyBeatPlanSchema = z.object({
  mustPreserveBeats: z.array(z.string().trim().min(1)).max(12).default([]),
  beatDecisions: z.array(researchStrategyBeatDecisionSchema).max(12).default([]),
});

const initialBroadResearchJsonSchema = {
  type: "object",
  properties: {
    factualOverview: { type: "string" },
    originPremise: { type: "string" },
    keyFacts: {
      type: "array",
      minItems: 3,
      maxItems: 12,
      items: {
        type: "object",
        properties: {
          fact: { type: "string" },
          sourceLabel: { type: "string" },
          url: { type: "string" },
          confidence: {
            type: "string",
            enum: ["high", "medium", "low"],
          },
        },
        required: ["fact", "sourceLabel", "url", "confidence"],
        additionalProperties: false,
      },
    },
    tensions: {
      type: "array",
      minItems: 2,
      maxItems: 8,
      items: { type: "string" },
    },
    broaderSystem: { type: "string" },
    runwayBeats: {
      type: "array",
      minItems: 2,
      maxItems: 8,
      items: { type: "string" },
    },
    turningPoints: {
      type: "array",
      minItems: 2,
      maxItems: 8,
      items: { type: "string" },
    },
    stakeShifters: {
      type: "array",
      minItems: 1,
      maxItems: 8,
      items: { type: "string" },
    },
    resolutionMechanism: { type: "string" },
    openQuestions: {
      type: "array",
      minItems: 1,
      maxItems: 8,
      items: { type: "string" },
    },
    sectionCandidates: {
      type: "array",
      minItems: 3,
      maxItems: 8,
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          whyItMatters: { type: "string" },
        },
        required: ["title", "whyItMatters"],
        additionalProperties: false,
      },
    },
    sourceGroups: {
      type: "array",
      maxItems: 8,
      items: {
        type: "object",
        properties: {
          label: { type: "string" },
          reason: { type: "string" },
          urls: {
            type: "array",
            maxItems: 10,
            items: { type: "string" },
          },
        },
        required: ["label", "reason", "urls"],
        additionalProperties: false,
      },
    },
  },
  required: [
    "factualOverview",
    "originPremise",
    "keyFacts",
    "tensions",
    "broaderSystem",
    "runwayBeats",
    "turningPoints",
    "stakeShifters",
    "resolutionMechanism",
    "openQuestions",
    "sectionCandidates",
    "sourceGroups",
  ],
  additionalProperties: false,
} as const;

const researchStrategySectionSchema = z.object({
  sectionId: z.string().trim().min(1),
  title: z.string().trim().min(1),
  purpose: z.string().trim().min(1),
  whyItMatters: z.string().trim().min(1),
  evidenceNeeded: z.array(z.string().trim().min(1)).max(8).default([]),
  searchPriorities: z.array(z.string().trim().min(1)).max(8).default([]),
  targetWordCount: z.number().int().min(120).max(900),
});

const baseResearchStrategySchema = z.object({
  primaryAngle: z.string().trim().min(1),
  backupAngles: z.array(z.string().trim().min(1)).max(6).default([]),
  hookIdea: z.string().trim().min(1),
  storyType: z.string().trim().min(1),
  videoStructure: z.array(researchStrategySectionSchema).min(4).max(8),
  globalSearchThemes: z.array(z.string().trim().min(1)).max(10).default([]),
  risks: z.array(z.string().trim().min(1)).max(8).default([]),
  skip: z.array(z.string().trim().min(1)).max(8).default([]),
});

const researchStrategySchema = z.object({
  primaryAngle: z.string().trim().min(1),
  backupAngles: z.array(z.string().trim().min(1)).max(6).default([]),
  hookIdea: z.string().trim().min(1),
  storyType: z.string().trim().min(1),
  mustPreserveBeats: z.array(z.string().trim().min(1)).max(12).default([]),
  beatDecisions: z.array(researchStrategyBeatDecisionSchema).max(12).default([]),
  videoStructure: z.array(researchStrategySectionSchema).min(4).max(8),
  globalSearchThemes: z.array(z.string().trim().min(1)).max(10).default([]),
  risks: z.array(z.string().trim().min(1)).max(8).default([]),
  skip: z.array(z.string().trim().min(1)).max(8).default([]),
});

const sectionQueryPlanningGlobalQuerySchema = z.object({
  label: z.string().trim().min(1),
  objective: z.string().trim().min(1),
  searchMode: z.enum(["news_web", "social_web", "video_topic"]),
  query: z.string().trim().min(1),
});

const sectionQueryPlanningSectionQuerySchema = z.object({
  sectionId: z.string().trim().min(1),
  articleQueries: z.array(z.string().trim().min(1)).max(4).default([]),
  videoQueries: z.array(z.string().trim().min(1)).max(4).default([]),
  socialQueries: z.array(z.string().trim().min(1)).max(4).default([]),
  podcastQueries: z.array(z.string().trim().min(1)).max(3).default([]),
});

const sectionQueryPlanningSchema = z.object({
  globalQueries: z.array(sectionQueryPlanningGlobalQuerySchema).max(8).default([]),
  sectionQueries: z.array(sectionQueryPlanningSectionQuerySchema).min(1).max(8),
});

const moonAnalogStructureSchema = z.object({
  analogs: z
    .array(
      z.object({
        title: z.string().trim().min(1),
        sectionFlow: z.array(z.string().trim().min(1)).min(3).max(8),
        notableCoverageChoices: z.array(z.string().trim().min(1)).max(6).default([]),
      })
    )
    .max(3)
    .default([]),
  takeaways: z.array(z.string().trim().min(1)).min(2).max(8),
});

type InitialBroadResearch = z.infer<typeof initialBroadResearchSchema>;
type PlanningEvidenceBeat = z.infer<typeof planningEvidenceBeatSchema>;
type BaseResearchStrategy = z.infer<typeof baseResearchStrategySchema>;
type ResearchStrategy = z.infer<typeof researchStrategySchema>;
type SectionQueryPlanning = z.infer<typeof sectionQueryPlanningSchema>;

type PlanResearchStageOutput = {
  planningMode: "perplexity_then_claude" | "web_fallback_then_claude";
  broadResearchProvider: "perplexity" | "openai_web_fallback" | "anthropic_web_fallback";
  broadResearchModel: string;
  broadResearch: InitialBroadResearch;
  broadResearchMemo: string;
  parallelDeepResearch: {
    runId: string;
    processor: string;
    status: string | null;
    content: string;
  } | null;
  planningBeats: PlanningEvidenceBeat[];
  researchStrategyModel: string;
  researchStrategy: ResearchStrategy;
  sectionQueryPlanningModel: string;
  sectionQueryPlanning: SectionQueryPlanning;
  researchPlan: ScriptAgentResearchPlan;
};

type SectionResearchPackage = {
  sectionHeading: string;
  purpose: string;
  beatGoal: string;
  sourceCount: number;
  quoteCount: number;
  articleCount: number;
  clipCount: number;
  socialCount: number;
  keyClipsToWatch: Array<{
    sourceId: string;
    title: string;
    url: string | null;
    clipId: string | null;
    transcriptStatus: string;
    topQuote: string | null;
    topQuoteStartMs: number | null;
  }>;
  relatedArticles: Array<{
    sourceId: string;
    title: string;
    url: string | null;
    publishedAt: string | null;
    keyPoints: string[];
    summary: string | null;
  }>;
  relatedSocialPosts: Array<{
    sourceId: string;
    title: string;
    url: string | null;
    providerName: string;
    snippet: string | null;
    socialLane: string | null;
  }>;
  exactQuotes: Array<{
    sourceId: string | null;
    sourceLabel: string;
    sourceUrl: string | null;
    quoteText: string;
    speaker: string | null;
    context: string | null;
    startMs: number | null;
    endMs: number | null;
    relevanceScore: number;
  }>;
  briefText: string;
};

type DiscoveryState = {
  urlScopeKeys: Set<string>;
  clipScopeKeys: Set<string>;
  quoteKeys: Set<string>;
  sourceIdByUrlScopeKey: Map<string, string>;
  sourceIdByClipScopeKey: Map<string, string>;
};

function normalizeSourceUrl(rawUrl: string) {
  try {
    const url = new URL(rawUrl);
    url.hostname = url.hostname.toLowerCase();
    for (const key of [...url.searchParams.keys()]) {
      if (
        key.startsWith("utm_") ||
        key === "fbclid" ||
        key === "gclid" ||
        key === "ref" ||
        key === "mc_cid" ||
        key === "mc_eid"
      ) {
        url.searchParams.delete(key);
      }
    }
    url.hash = "";
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    return url.toString();
  } catch {
    return rawUrl.trim();
  }
}

function parseLooseJson(text: string) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] ?? text;
  const trimmed = fenced.trim();

  const candidates = [
    trimmed,
    trimmed.replace(/,\s*([}\]])/g, "$1"),
  ];

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      const objectStart = candidate.indexOf("{");
      const arrayStart = candidate.indexOf("[");
      const startCandidates = [objectStart, arrayStart].filter((index) => index >= 0);
      const start = startCandidates.length > 0 ? Math.min(...startCandidates) : -1;
      const end = Math.max(candidate.lastIndexOf("}"), candidate.lastIndexOf("]"));

      if (start >= 0 && end > start) {
        const sliced = candidate.slice(start, end + 1);
        try {
          return JSON.parse(sliced);
        } catch {
          try {
            return JSON.parse(sliced.replace(/,\s*([}\]])/g, "$1"));
          } catch {
            // Fall through to next candidate.
          }
        }
      }
    }
  }

  throw new Error(`Model response did not contain parseable JSON. Preview: ${trimmed.slice(0, 1200)}`);
}

function dedupeStringList(values: Array<string | null | undefined>, limit?: number) {
  const seen = new Set<string>();
  const collected: string[] = [];

  for (const value of values) {
    const normalized = value?.replace(/\s+/g, " ").trim();
    if (!normalized) {
      continue;
    }

    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    collected.push(normalized);

    if (limit && collected.length >= limit) {
      break;
    }
  }

  return collected;
}

function formatNewsSearchResults(results: Array<{
  title: string;
  url: string;
  source: string;
  snippet: string;
  publishedAt: string | null;
}>) {
  return results
    .map((result, index) =>
      [
        `${index + 1}. ${result.title || result.url}`,
        `url: ${result.url}`,
        `provider: ${result.source}`,
        result.publishedAt ? `publishedAt: ${result.publishedAt}` : null,
        result.snippet ? `snippet: ${trimToLength(result.snippet, 280)}` : null,
      ]
        .filter(Boolean)
        .join("\n")
    )
    .join("\n\n");
}

function buildMoonEditorialPhilosophy(input: ScriptAgentRequest) {
  const customNotes = mergeNotes(input);

  return [
    "Moon editorial philosophy:",
    "- Look for the real system behind the incident, not just the surface event.",
    "- Prefer contradiction, power, incentives, incompetence, image-management, institutional drift, and hidden consequences.",
    "- Find the angle that feels slightly against the obvious framing when the evidence supports it.",
    "- Separate confirmed facts from rumor, speculation, and commentary.",
    "- Pull in reporting, reaction, social discussion, commentary video, and context only when it sharpens the argument.",
    "- Do not over-compress a long-running story into only the scandal peak if Moon would naturally need the runway first.",
    "- When a story depends on a long buildup, prefer a structure that naturally covers: why this person or institution mattered, how pressure escalated, the trap/confinement or pressure-cooker setup, the trigger event, the operational climax, how the system actually got what it wanted, and the unresolved consequence.",
    "- Capture the political or institutional turning points that changed who hated the subject, what the stakes were, or why the system escalated.",
    "- Capture the stake-shifting moves that changed the board: asylum, alliances, leaks, countermeasures, legal maneuvers, diplomatic shifts, dead-man switches, inside sources, or other moves that altered what each side could do.",
    "- Keep the concrete causal beats that moved the subject into a new threat category: named leaks, linked figures, leadership changes, or diplomatic ruptures.",
    "- If the subject created the platform, idea, company, or persona that later became threatening, capture that founding premise explicitly.",
    "- If the story seed implies someone warned, exposed, testified, predicted, or tried to tell people something, search for the original statements and the later events that seem to validate or falsify them.",
    "- When the thesis depends on what the subject actually said, prioritize direct statements from interviews, podcasts, press conferences, courtroom remarks, or other transcript-backed sources.",
    "- Keep deterrents and protection mechanisms when they explain why the system escalated or hesitated.",
    "- Do not promote a supporting mechanism into its own full section unless it actually changes the direction of the story.",
    "- Do not let a late epilogue hijack the main arc. If a later development is real but not structurally central, use it as a coda rather than the spine.",
    "- Do not skip backstory if it explains motive, makes the climax legible, or sets up the real ending.",
    "- Do not skip the actual resolution mechanism. If the system failed at the dramatic option but won through a softer route, include that route explicitly.",
    "- Do not over-intellectualize a story that is already outrageous. Moon can be structural, but the structure should intensify the outrage, not replace it.",
    "- Think in terms of a 10 to 12 minute video targeting roughly 2,500 words.",
    customNotes ? `Editorial steer from the team:\n${customNotes}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

function formatInitialBroadResearchMemo(result: InitialBroadResearch) {
  return [
    "Initial broad research memo",
    "",
    `Overview: ${result.factualOverview}`,
    `Origin premise: ${result.originPremise}`,
    "",
    "Key facts:",
    ...result.keyFacts.map((item) =>
      [
        `- ${item.fact}`,
        `  source: ${item.sourceLabel}`,
        item.url ? `  url: ${item.url}` : null,
        `  confidence: ${item.confidence}`,
      ]
        .filter(Boolean)
        .join("\n")
    ),
    "",
    "Tensions and contradictions:",
    ...result.tensions.map((item) => `- ${item}`),
    "",
    `Broader system: ${result.broaderSystem}`,
    "",
    "Runway beats that make the headline legible:",
    ...result.runwayBeats.map((item) => `- ${item}`),
    "",
    "Turning points that changed the incentives or coalition:",
    ...result.turningPoints.map((item) => `- ${item}`),
    "",
    "Stake-shifting moves and countermeasures:",
    ...result.stakeShifters.map((item) => `- ${item}`),
    "",
    `Actual resolution mechanism: ${result.resolutionMechanism}`,
    "",
    "Open questions:",
    ...result.openQuestions.map((item) => `- ${item}`),
    "",
    "Section-worthy subtopics:",
    ...result.sectionCandidates.map((item) => `- ${item.title}: ${item.whyItMatters}`),
    result.sourceGroups.length > 0 ? "" : null,
    result.sourceGroups.length > 0 ? "High-value source clusters:" : null,
    ...result.sourceGroups.map((group) =>
      [
        `- ${group.label}: ${group.reason}`,
        ...group.urls.slice(0, 4).map((url) => `  - ${url}`),
      ].join("\n")
    ),
  ]
    .filter(Boolean)
    .join("\n");
}

function formatResearchStrategySummary(strategy: ResearchStrategy) {
  return [
    "Research strategy",
    "",
    `Primary angle: ${strategy.primaryAngle}`,
    `Hook idea: ${strategy.hookIdea}`,
    `Story type: ${strategy.storyType}`,
    strategy.backupAngles.length > 0 ? `Backup angles: ${strategy.backupAngles.join(" | ")}` : null,
    strategy.mustPreserveBeats.length > 0
      ? `Must preserve beats: ${strategy.mustPreserveBeats.join(" | ")}`
      : null,
    strategy.globalSearchThemes.length > 0
      ? `Global search themes: ${strategy.globalSearchThemes.join(" | ")}`
      : null,
    "",
    "Proposed section order:",
    ...strategy.videoStructure.map((section, index) =>
      [
        `${index + 1}. ${section.title}`,
        `  purpose: ${section.purpose}`,
        `  why it matters: ${section.whyItMatters}`,
        section.evidenceNeeded.length > 0
          ? `  evidence needed: ${section.evidenceNeeded.join(" | ")}`
          : null,
        section.searchPriorities.length > 0
          ? `  search priorities: ${section.searchPriorities.join(" | ")}`
          : null,
      ]
        .filter(Boolean)
        .join("\n")
    ),
    strategy.beatDecisions.length > 0 ? "" : null,
    strategy.beatDecisions.length > 0 ? "Beat decisions:" : null,
    ...strategy.beatDecisions.map((beat) =>
      [
        `- ${beat.beatId} [${beat.decision}] ${beat.beat}`,
        `  reason: ${beat.reason}`,
        beat.targetSectionId ? `  target section: ${beat.targetSectionId}` : null,
      ]
        .filter(Boolean)
        .join("\n")
    ),
    strategy.risks.length > 0 ? "" : null,
    strategy.risks.length > 0 ? `Risks: ${strategy.risks.join(" | ")}` : null,
    strategy.skip.length > 0 ? `Skip: ${strategy.skip.join(" | ")}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

function formatBaseResearchStrategySummary(strategy: BaseResearchStrategy) {
  return [
    `Primary angle: ${strategy.primaryAngle}`,
    `Hook idea: ${strategy.hookIdea}`,
    `Story type: ${strategy.storyType}`,
    strategy.backupAngles.length > 0 ? `Backup angles: ${strategy.backupAngles.join(" | ")}` : null,
    strategy.globalSearchThemes.length > 0
      ? `Global search themes: ${strategy.globalSearchThemes.join(" | ")}`
      : null,
    "",
    "Section architecture:",
    ...strategy.videoStructure.map((section, index) =>
      [
        `${index + 1}. ${section.sectionId} — ${section.title}`,
        `  purpose: ${section.purpose}`,
        `  why it matters: ${section.whyItMatters}`,
      ]
        .filter(Boolean)
        .join("\n")
    ),
  ]
    .filter(Boolean)
    .join("\n");
}

async function buildMoonAnalogStructurePacket(analogClipIds: string[]) {
  if (analogClipIds.length === 0) {
    return null;
  }

  const db = getDb();
  const rows = await db
    .select({
      clipId: clipLibrary.id,
      title: clipLibrary.title,
      transcript: transcriptCache.fullText,
    })
    .from(clipLibrary)
    .innerJoin(
      transcriptCache,
      and(eq(transcriptCache.clipId, clipLibrary.id), eq(transcriptCache.language, "en"))
    )
    .where(inArray(clipLibrary.id, analogClipIds.slice(0, 3)));

  if (rows.length === 0) {
    return null;
  }

  const analogStructure = await createAnthropicJson({
    schema: moonAnalogStructureSchema,
    model: getAnthropicPlanningModel(),
    system:
      "You are summarizing the planning-relevant section flow of Moon documentary transcripts. Focus on story architecture and editorial choices, not prose style. Return JSON only.",
    user: `Summarize the structural arc of these Moon transcripts so a planner can borrow the right kind of section progression.

${rows
  .map(
    (row, index) => `Analog ${index + 1}: ${row.title}

Transcript:
${row.transcript.slice(0, 22000)}`
  )
  .join("\n\n---\n\n")}

Return JSON:
{
  "analogs": [
    {
      "title": "",
      "sectionFlow": ["section 1 purpose", "section 2 purpose"],
      "notableCoverageChoices": ["choice 1", "choice 2"]
    }
  ],
  "takeaways": ["shared structural lesson 1", "shared structural lesson 2"]
}`,
    temperature: 0.2,
    maxTokens: 2400,
  });

  return [
    "Moon analog structure hints:",
    ...analogStructure.analogs.map((analog) =>
      [
        `- ${analog.title}`,
        ...analog.sectionFlow.map((item) => `  - flow: ${item}`),
        ...analog.notableCoverageChoices.map((item) => `  - choice: ${item}`),
      ].join("\n")
    ),
    "- Shared takeaways:",
    ...analogStructure.takeaways.map((item) => `  - ${item}`),
  ].join("\n");
}

function formatSectionQueryPlanningSummary(
  planning: SectionQueryPlanning,
  strategy: ResearchStrategy
) {
  const sectionTitleById = new Map(
    strategy.videoStructure.map((section) => [section.sectionId, section.title])
  );

  return [
    "Section query planning",
    "",
    "Global discovery queries:",
    ...planning.globalQueries.map(
      (query) => `- [${query.searchMode}] ${query.label}: ${query.query}`
    ),
    "",
    "Section-specific queries:",
    ...planning.sectionQueries.flatMap((section) => {
      const label = sectionTitleById.get(section.sectionId) ?? section.sectionId;
      return [
        `- ${label}`,
        ...section.articleQueries.map((query) => `  article: ${query}`),
        ...section.videoQueries.map((query) => `  video: ${query}`),
        ...section.socialQueries.map((query) => `  social: ${query}`),
        ...section.podcastQueries.map((query) => `  podcast: ${query}`),
      ];
    }),
  ].join("\n");
}

function buildPlanningNotes(planOutput: PlanResearchStageOutput | null) {
  if (!planOutput) {
    return "";
  }

  return trimToLength(
    [
      `Planning mode: ${planOutput.planningMode}`,
      `Broad research provider: ${planOutput.broadResearchProvider} (${planOutput.broadResearchModel})`,
      planOutput.parallelDeepResearch
        ? `Parallel deep research: ${planOutput.parallelDeepResearch.processor} (${planOutput.parallelDeepResearch.runId})`
        : null,
      formatResearchStrategySummary(planOutput.researchStrategy),
      "",
      formatSectionQueryPlanningSummary(
        planOutput.sectionQueryPlanning,
        planOutput.researchStrategy
      ),
      "",
      "Broad research highlights:",
      `- ${planOutput.broadResearch.factualOverview}`,
      ...planOutput.broadResearch.tensions.slice(0, 3).map((item) => `- ${item}`),
    ]
      .filter(Boolean)
      .join("\n"),
    3600
  );
}

function readPlanResearchStageOutput(output: unknown): PlanResearchStageOutput | null {
  if (!output || typeof output !== "object" || Array.isArray(output)) {
    return null;
  }

  const record = output as Record<string, unknown>;
  const broadResearchMemo =
    typeof record.broadResearchMemo === "string" ? record.broadResearchMemo : null;

  const broadResearchResult = initialBroadResearchSchema.safeParse(record.broadResearch);
  const researchStrategyResult = researchStrategySchema.safeParse(record.researchStrategy);
  const planningBeatsResult = z.array(planningEvidenceBeatSchema).safeParse(record.planningBeats);
  const sectionQueryPlanningResult = sectionQueryPlanningSchema.safeParse(
    record.sectionQueryPlanning
  );

  if (
    !broadResearchMemo ||
    !broadResearchResult.success ||
    !researchStrategyResult.success ||
    !sectionQueryPlanningResult.success
  ) {
    return null;
  }

  const planRecord = asObjectRecord(record.researchPlan);
  const globalBeams = Array.isArray(planRecord?.globalBeams)
    ? (planRecord.globalBeams as ScriptAgentResearchBeam[])
    : [];
  const sectionBeams = Array.isArray(planRecord?.sectionBeams)
    ? (planRecord.sectionBeams as ScriptAgentResearchBeam[])
    : [];
  const seedUrls = Array.isArray(planRecord?.seedUrls)
    ? (planRecord.seedUrls as ScriptAgentSeedUrl[])
    : [];

  return {
    planningMode:
      record.planningMode === "web_fallback_then_claude"
        ? "web_fallback_then_claude"
        : "perplexity_then_claude",
    broadResearchProvider:
      record.broadResearchProvider === "anthropic_web_fallback"
        ? "anthropic_web_fallback"
        : record.broadResearchProvider === "openai_web_fallback"
          ? "openai_web_fallback"
          : "perplexity",
    broadResearchModel:
      typeof record.broadResearchModel === "string" ? record.broadResearchModel : "unknown",
    broadResearch: broadResearchResult.data,
    broadResearchMemo,
    parallelDeepResearch:
      record.parallelDeepResearch &&
      typeof record.parallelDeepResearch === "object" &&
      !Array.isArray(record.parallelDeepResearch)
        ? {
            runId:
              typeof (record.parallelDeepResearch as Record<string, unknown>).runId === "string"
                ? String((record.parallelDeepResearch as Record<string, unknown>).runId)
                : "",
            processor:
              typeof (record.parallelDeepResearch as Record<string, unknown>).processor === "string"
                ? String((record.parallelDeepResearch as Record<string, unknown>).processor)
                : "unknown",
            status:
              typeof (record.parallelDeepResearch as Record<string, unknown>).status === "string"
                ? String((record.parallelDeepResearch as Record<string, unknown>).status)
                : null,
            content:
              typeof (record.parallelDeepResearch as Record<string, unknown>).content === "string"
                ? String((record.parallelDeepResearch as Record<string, unknown>).content)
                : "",
          }
        : null,
    planningBeats: planningBeatsResult.success ? planningBeatsResult.data : [],
    researchStrategyModel:
      typeof record.researchStrategyModel === "string" ? record.researchStrategyModel : "unknown",
    researchStrategy: researchStrategyResult.data,
    sectionQueryPlanningModel:
      typeof record.sectionQueryPlanningModel === "string"
        ? record.sectionQueryPlanningModel
        : "unknown",
    sectionQueryPlanning: sectionQueryPlanningResult.data,
    researchPlan: {
      summary:
        typeof planRecord?.summary === "string"
          ? planRecord.summary
          : "AI-generated research plan",
      globalBeams,
      sectionBeams,
      seedUrls,
    },
  };
}

async function createPerplexityJson<T>(args: {
  schema: { parse: (value: unknown) => T };
  system: string;
  user: string;
  maxTokens?: number;
}) {
  const apiKey = getEnv().PERPLEXITY_API_KEY;
  if (!apiKey) {
    return null;
  }

  const models = dedupeStringList(
    [getEnv().PERPLEXITY_RESEARCH_MODEL, getEnv().PERPLEXITY_FALLBACK_MODEL],
    2
  );
  let lastError: Error | null = null;

  for (const model of models) {
    try {
      const response = await fetch("https://api.perplexity.ai/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          temperature: 0.2,
          max_tokens: args.maxTokens ?? 2600,
          messages: [
            {
              role: "system",
              content: args.system,
            },
            {
              role: "user",
              content: args.user,
            },
          ],
        }),
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Perplexity request failed for model ${model} (${response.status}): ${body}`);
      }

      const payload = (await response.json()) as {
        choices?: Array<{
          message?: {
            content?: string;
          };
        }>;
      };
      const text = payload.choices?.[0]?.message?.content ?? "";
      return {
        model,
        value: args.schema.parse(parseLooseJson(text)),
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  if (lastError) {
    throw lastError;
  }

  return null;
}

async function createOpenAiJson<T>(args: {
  schema: { parse: (value: unknown) => T };
  jsonSchema: Record<string, unknown>;
  system: string;
  user: string;
  model?: string;
  maxTokens?: number;
}) {
  const apiKey = getEnv().OPENAI_API_KEY;
  if (!apiKey) {
    return null;
  }

  const model = args.model ?? getEnv().OPENAI_RESEARCH_MODEL;
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      max_output_tokens: args.maxTokens ?? 2400,
      input: [
        {
          role: "system",
          content: args.system,
        },
        {
          role: "user",
          content: args.user,
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "structured_research_output",
          strict: true,
          schema: args.jsonSchema,
        },
      },
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenAI request failed for model ${model} (${response.status}): ${body}`);
  }

  const payload = (await response.json()) as {
    status?: string;
    incomplete_details?: unknown;
    output_text?: string;
    output?: Array<{
      content?: Array<{
        type?: string;
        text?: string;
      }>;
    }>;
  };
  const outputText =
    payload.output_text ??
    payload.output
      ?.flatMap((item) => item.content ?? [])
      .filter((item) => typeof item.text === "string")
      .map((item) => item.text ?? "")
      .join("\n") ??
    "";

  if (payload.status && payload.status !== "completed") {
    throw new Error(
      `OpenAI response did not complete (status=${payload.status}): ${JSON.stringify(payload.incomplete_details ?? null)}`
    );
  }

  let parsed: unknown;
  try {
    parsed = parseLooseJson(outputText || "{}");
  } catch (error) {
    throw new Error(
      `OpenAI structured JSON parse failed: ${
        error instanceof Error ? error.message : "unknown parse error"
      }. Output preview: ${outputText.slice(0, 1200)}`
    );
  }

  return {
    model,
    value: args.schema.parse(parsed),
  };
}

function extractUrlsFromText(text: string) {
  return [...new Set(text.match(/https?:\/\/[^\s<>"')\]]+/gi) ?? [])];
}

function getHostname(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return "";
  }
}

const DIRECT_MEDIA_EXTENSION_PATTERN =
  /\.(?:mp3|m4a|wav|aac|ogg|opus|flac|mp4|m4v|mov|webm)(?:$|[?#])/i;

function isLikelyDirectMediaUrl(url: string) {
  return DIRECT_MEDIA_EXTENSION_PATTERN.test(url);
}

function inferProviderNameFromUrl(url: string) {
  const hostname = getHostname(url);
  if (!hostname) return "web";
  if (hostname === "x.com" || hostname.endsWith(".x.com")) return "x";
  if (hostname === "twitter.com" || hostname.endsWith(".twitter.com")) return "twitter";
  if (hostname.includes("reddit.com")) return "reddit";
  if (hostname.includes("tiktok.com")) return "tiktok";
  if (hostname.includes("instagram.com")) return "instagram";
  if (hostname.includes("facebook.com")) return "facebook";
  if (hostname.includes("threads.net")) return "threads";
  if (hostname.includes("linkedin.com")) return "linkedin";
  if (hostname === "github.com" || hostname === "raw.githubusercontent.com") return "github";
  if (hostname.includes("youtube.com") || hostname === "youtu.be" || hostname.includes("youtube-nocookie.com")) return "youtube";
  if (hostname.includes("archive.org")) return "internet_archive";
  if (hostname.includes("vimeo.com")) return "vimeo";
  if (hostname.includes("soundcloud.com")) return "soundcloud";
  if (hostname.includes("spotify.com")) return "spotify";
  if (hostname.includes("podcasts.apple.com")) return "apple_podcasts";
  if (hostname.includes("omny.fm")) return "omny";
  if (hostname.includes("megaphone.fm")) return "megaphone";
  if (hostname.includes("simplecast.com")) return "simplecast";
  if (hostname.includes("buzzsprout.com")) return "buzzsprout";
  if (hostname.includes("podbean.com")) return "podbean";
  return hostname;
}

function inferSourceKindFromUrl(url: string): "article" | "social_post" | "video" | "library_clip" {
  const provider = inferProviderNameFromUrl(url);
  if (provider === "youtube") {
    return "library_clip";
  }
  if (isLikelyDirectMediaUrl(url)) {
    return "video";
  }
  if (
    provider === "x" ||
    provider === "twitter" ||
    provider === "reddit" ||
    provider === "tiktok" ||
    provider === "instagram" ||
    provider === "facebook" ||
    provider === "threads" ||
    provider === "linkedin"
  ) {
    return "social_post";
  }
  if (
    provider === "spotify" ||
    provider === "apple_podcasts" ||
    provider === "omny" ||
    provider === "megaphone" ||
    provider === "simplecast" ||
    provider === "buzzsprout" ||
    provider === "podbean" ||
    provider === "internet_archive" ||
    provider === "vimeo" ||
    provider === "soundcloud"
  ) {
    return "video";
  }
  return "article";
}

function shouldAttemptLocalMediaIngest(args: {
  sourceKind: string;
  providerName: string;
  url: string | null;
}) {
  if (!args.url) {
    return false;
  }

  return (
    args.sourceKind === "social_post" ||
    args.sourceKind === "video" ||
    args.providerName === "internet_archive" ||
    isLikelyDirectMediaUrl(args.url)
  );
}

function buildBeamId(parts: Array<string | null | undefined>) {
  return parts
    .filter(Boolean)
    .map((part) => String(part).trim().toLowerCase().replace(/[^a-z0-9]+/g, "-"))
    .filter(Boolean)
    .join("--");
}

function buildSourceScopeKey(
  stageKey: ScriptAgentStageKey,
  sectionHeading: string | null,
  canonicalKey: string
) {
  return [stageKey, sectionHeading?.trim().toLowerCase() ?? "global", canonicalKey].join("::");
}

function asObjectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readStringField(
  value: Record<string, unknown> | null,
  ...keys: string[]
) {
  for (const key of keys) {
    const candidate = value?.[key];
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  return null;
}

function getSectionHeadingFromMetadata(metadataJson: unknown) {
  const metadata = asObjectRecord(metadataJson);
  const sectionHeading = readStringField(metadata, "sectionHeading");
  return sectionHeading ?? null;
}

function formatSourceTitleFromUrl(url: string) {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.replace(/^www\./i, "");
    const slug = parsed.pathname
      .split("/")
      .filter(Boolean)
      .slice(-1)[0]
      ?.replace(/[-_]+/g, " ")
      .trim();

    if (slug) {
      return `${hostname}: ${decodeURIComponent(slug).slice(0, 90)}`;
    }

    return hostname;
  } catch {
    return url;
  }
}

function extractSourceContentText(source: {
  snippet: string | null;
  contentJson: unknown;
  metadataJson: unknown;
}) {
  const content = asObjectRecord(source.contentJson);
  const metadata = asObjectRecord(source.metadataJson);
  const candidate =
    readStringField(content, "content", "markdown", "text", "description", "summary", "transcript", "fullText") ??
    readStringField(metadata, "text", "videoDescription", "description", "snippet") ??
    source.snippet;

  if (!candidate) {
    return null;
  }

  return candidate.replace(/\s+/g, " ").trim();
}

function readArticleFactExtract(contentJson: unknown) {
  const content = asObjectRecord(contentJson);
  const parsed = articleFactExtractSchema.safeParse(content?.articleFactExtract);
  return parsed.success ? parsed.data : null;
}

function formatArticleFactExtract(
  facts: ReturnType<typeof readArticleFactExtract>,
  maxItemsPerGroup = 3
) {
  if (!facts) {
    return null;
  }

  const lines = [
    ...facts.keyFacts.slice(0, maxItemsPerGroup).map((item) => `  key fact: ${item}`),
    ...facts.namedActors.slice(0, maxItemsPerGroup).map((item) => `  actor: ${item}`),
    ...facts.operationalDetails
      .slice(0, maxItemsPerGroup)
      .map((item) => `  operational detail: ${item}`),
    ...facts.motiveFrames.slice(0, maxItemsPerGroup).map((item) => `  motive: ${item}`),
    ...facts.relationshipTurns
      .slice(0, maxItemsPerGroup)
      .map((item) => `  relationship turn: ${item}`),
    ...facts.deterrents.slice(0, maxItemsPerGroup).map((item) => `  deterrent: ${item}`),
    ...facts.exactQuotes.slice(0, 2).map((item) => `  quote: "${item}"`),
  ];

  return lines.length > 0 ? lines.join("\n") : null;
}

function normalizePlanningBeatDetail(detail: string) {
  return detail
    .toLowerCase()
    .replace(/["'`“”‘’]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function getPlanningBeatPriorityScore(category: PlanningEvidenceBeat["category"]) {
  switch (category) {
    case "operational_detail":
      return 70;
    case "relationship_turn":
      return 62;
    case "motive_frame":
      return 58;
    case "deterrent":
      return 54;
    case "escalation":
      return 50;
    case "origin":
      return 46;
    case "resolution":
      return 42;
  }
}

function getPlanningBeatSharpnessBonus(detail: string) {
  let score = 0;
  if (/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}\b/.test(detail)) {
    score += 6;
  }
  if (/\d/.test(detail)) {
    score += 3;
  }
  if (/['"“”]/.test(detail)) {
    score += 2;
  }
  if (detail.length >= 48 && detail.length <= 200) {
    score += 3;
  }
  return score;
}

function makePlanningBeatRecord(args: {
  category: PlanningEvidenceBeat["category"];
  detail: string;
  sourceTitle: string;
  url?: string | null;
  priority?: PlanningEvidenceBeat["priority"];
}) {
  const detail = args.detail.replace(/\s+/g, " ").trim();
  if (detail.length < 18) {
    return null;
  }

  return {
    category: args.category,
    detail,
    sourceTitle: args.sourceTitle.trim(),
    url: args.url ?? null,
    priority: args.priority ?? "medium",
  };
}

function finalizePlanningBeats(
  candidates: Array<ReturnType<typeof makePlanningBeatRecord>>,
  limit = 12
): PlanningEvidenceBeat[] {
  const deduped = new Map<string, NonNullable<ReturnType<typeof makePlanningBeatRecord>>>();

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }

    const key = normalizePlanningBeatDetail(candidate.detail);
    const existing = deduped.get(key);
    if (!existing) {
      deduped.set(key, candidate);
      continue;
    }

    const existingScore =
      getPlanningBeatPriorityScore(existing.category) +
      getPlanningBeatSharpnessBonus(existing.detail) +
      (existing.priority === "high" ? 8 : 0);
    const nextScore =
      getPlanningBeatPriorityScore(candidate.category) +
      getPlanningBeatSharpnessBonus(candidate.detail) +
      (candidate.priority === "high" ? 8 : 0);

    if (nextScore > existingScore) {
      deduped.set(key, candidate);
    }
  }

  const sorted = [...deduped.values()].sort((left, right) => {
    const leftScore =
      getPlanningBeatPriorityScore(left.category) +
      getPlanningBeatSharpnessBonus(left.detail) +
      (left.priority === "high" ? 8 : 0);
    const rightScore =
      getPlanningBeatPriorityScore(right.category) +
      getPlanningBeatSharpnessBonus(right.detail) +
      (right.priority === "high" ? 8 : 0);
    return rightScore - leftScore;
  });
  const categoryMinimums: Partial<Record<PlanningEvidenceBeat["category"], number>> = {
    origin: 1,
    escalation: 2,
    operational_detail: 2,
    relationship_turn: 2,
    motive_frame: 1,
    deterrent: 1,
    resolution: 1,
  };
  const categoryMaximums: Partial<Record<PlanningEvidenceBeat["category"], number>> = {
    origin: 2,
    escalation: 3,
    operational_detail: 4,
    relationship_turn: 2,
    motive_frame: 2,
    deterrent: 2,
    resolution: 1,
  };
  const sourceMaximum = 2;
  const picked: Array<NonNullable<ReturnType<typeof makePlanningBeatRecord>>> = [];
  const pickedKeys = new Set<string>();
  const categoryCounts = new Map<PlanningEvidenceBeat["category"], number>();
  const sourceCounts = new Map<string, number>();
  const tryPick = (beat: NonNullable<ReturnType<typeof makePlanningBeatRecord>>) => {
    const key = normalizePlanningBeatDetail(beat.detail);
    if (pickedKeys.has(key)) {
      return false;
    }
    const categoryCount = categoryCounts.get(beat.category) ?? 0;
    const sourceKey = beat.url ?? beat.sourceTitle;
    const sourceCount = sourceCounts.get(sourceKey) ?? 0;
    if (categoryCount >= (categoryMaximums[beat.category] ?? limit)) {
      return false;
    }
    if (sourceCount >= sourceMaximum) {
      return false;
    }
    picked.push(beat);
    pickedKeys.add(key);
    categoryCounts.set(beat.category, categoryCount + 1);
    sourceCounts.set(sourceKey, sourceCount + 1);
    return true;
  };

  for (const [category, minimum] of Object.entries(categoryMinimums) as Array<
    [PlanningEvidenceBeat["category"], number]
  >) {
    for (const beat of sorted) {
      if (picked.length >= limit) {
        break;
      }
      if (beat.category !== category) {
        continue;
      }
      if ((categoryCounts.get(category) ?? 0) >= minimum) {
        break;
      }
      tryPick(beat);
    }
  }

  for (const beat of sorted) {
    if (picked.length >= limit) {
      break;
    }
    tryPick(beat);
  }

  return picked.map((beat, index) =>
    planningEvidenceBeatSchema.parse({
      beatId: `beat_${String(index + 1).padStart(2, "0")}`,
      ...beat,
    })
  );
}

function formatPlanningBeatPacket(beats: PlanningEvidenceBeat[]) {
  if (beats.length === 0) {
    return "";
  }

  return [
    "Structured preserved beat ledger:",
    ...beats.map((beat) =>
      [
        `- ${beat.beatId} [${beat.category}] [${beat.priority}] ${beat.detail}`,
        `  source: ${beat.sourceTitle}`,
        beat.url ? `  url: ${beat.url}` : null,
      ]
        .filter(Boolean)
        .join("\n")
    ),
  ].join("\n");
}

function deriveLiteralEvidenceQuote(text: string | null) {
  if (!text) {
    return null;
  }

  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length < 24) {
    return null;
  }

  const sentences = normalized
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  const candidates = [normalized];

  for (let index = 0; index < sentences.length; index += 1) {
    candidates.push(sentences[index]);
    if (index < sentences.length - 1) {
      candidates.push(`${sentences[index]} ${sentences[index + 1]}`.trim());
    }
  }

  for (const candidate of candidates) {
    const cleaned = candidate.replace(/\s+/g, " ").trim();
    if (cleaned.length >= 24 && cleaned.length <= 280) {
      return cleaned;
    }
  }

  return trimToLength(normalized, 260);
}

function getBeamResultLimit(
  depth: ScriptAgentRequest["researchDepth"],
  beam: ScriptAgentResearchBeam
) {
  if (beam.searchMode === "video_topic") {
    if (beam.phase === "section_followup") {
      return depth === "quick" ? 2 : depth === "standard" ? 3 : 4;
    }

    return depth === "quick" ? 3 : depth === "standard" ? 5 : 6;
  }

  if (beam.phase === "section_followup") {
    return depth === "quick" ? 2 : depth === "standard" ? 3 : 4;
  }

  return depth === "quick" ? 4 : depth === "standard" ? 6 : 8;
}

function getTranscriptMiningLimit(
  depth: ScriptAgentRequest["researchDepth"],
  stageKey: ScriptAgentStageKey | undefined
) {
  if (stageKey === "followup_research") {
    return depth === "quick" ? 2 : depth === "standard" ? 4 : 6;
  }

  return depth === "quick" ? 3 : depth === "standard" ? 5 : 8;
}

export async function generateInitialBroadResearchStage(input: ScriptAgentRequest) {
  const editorialPhilosophy = buildMoonEditorialPhilosophy(input);
  const storySearchAnchor = buildStorySearchAnchor({
    storyTitle: input.storyTitle,
    objective: input.objective,
    preferredAngle: input.preferredAngle,
    notes: input.notes,
    limit: 8,
  });
  const storySeed = [
    `Story seed: ${input.storyTitle}`,
    storySearchAnchor !== input.storyTitle ? `Search anchor: ${storySearchAnchor}` : null,
    input.objective ? `Objective: ${input.objective}` : null,
    input.preferredAngle ? `Preferred angle: ${input.preferredAngle}` : null,
    input.notes ? `Notes: ${input.notes}` : null,
    `Requested research depth: ${input.researchDepth}`,
    `Target runtime: ${input.targetRuntimeMinutes} minutes`,
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const perplexity = await createPerplexityJson({
      schema: initialBroadResearchSchema,
      system:
        "You are doing the first broad research pass for a Moon documentary YouTube script. Think like a strong research editor, not a scriptwriter yet. Return strict JSON only.",
      user: `${storySeed}

${editorialPhilosophy}

Return JSON with:
{
  "factualOverview": "1 compact paragraph",
  "originPremise": "what the subject originally built, proposed, or represented that made them matter later",
  "keyFacts": [
    {
      "fact": "",
      "sourceLabel": "",
      "url": "https://...",
      "confidence": "high"
    }
  ],
  "tensions": ["contradiction 1", "contradiction 2"],
  "broaderSystem": "what broader system this belongs to",
  "runwayBeats": ["why this person or institution mattered before the headline", "key escalation beat", "pressure-cooker setup"],
  "turningPoints": ["major turning point 1", "major turning point 2"],
  "stakeShifters": ["move, alliance, countermeasure, or diplomatic shift that changed the board"],
  "resolutionMechanism": "if the headline action failed, how the system actually got leverage or got what it wanted",
  "openQuestions": ["open question 1"],
  "sectionCandidates": [
    {
      "title": "",
      "whyItMatters": ""
    }
  ],
  "sourceGroups": [
    {
      "label": "",
      "reason": "",
      "urls": ["https://..."]
    }
  ]
}

Requirements:
- emphasize the real system behind the story
- identify the founding premise when the subject created the platform, idea, institution, or persona that later became threatening
- surface the strongest contradictions and hidden incentives
- separate confirmed facts from reaction and speculation
- include the minimum prehistory and escalation beats needed to make the headline event legible
- identify the turning points that changed the coalition, incentive structure, or institutional response
- identify the stake-shifting moves that changed what each side could do, including countermeasures, diplomatic shifts, legal moves, or alliances
- prefer named turning points over vague summaries: specific leaks, linked figures, leadership changes, diplomatic breaks, countermeasures, or protection mechanisms
- keep deterrents and protection mechanisms when they materially explain why the system escalated or hesitated
- identify the actual resolution route if it is quieter than the headline event
- include direct URLs whenever you have them
- propose section-worthy subtopics for a 10 to 12 minute Moon video`,
      maxTokens: 3000,
    });

    if (perplexity) {
      const broadResearchMemo = formatInitialBroadResearchMemo(perplexity.value);
      return {
        provider: "perplexity" as const,
        modelUsed: perplexity.model,
        broadResearch: perplexity.value,
        broadResearchMemo,
      };
    }
  } catch (error) {
    console.error("[script-agent] Initial broad research via Perplexity failed:", error);
  }

  const fallbackQueries = dedupeStringList(
    [
      storySearchAnchor,
      [storySearchAnchor, input.preferredAngle].filter(Boolean).join(" "),
      [storySearchAnchor, input.objective].filter(Boolean).join(" "),
      `${storySearchAnchor} controversy analysis reaction`,
    ],
    4
  );
  const fallbackResults = dedupeStringList(
    (
      await Promise.all(
        fallbackQueries.map((query) => searchNewsStory(query, "full").catch(() => []))
      )
    )
      .flat()
      .map((result) =>
        JSON.stringify({
          ...result,
          url: normalizeSourceUrl(result.url),
        })
      ),
    14
  ).map((item) => JSON.parse(item) as Awaited<ReturnType<typeof searchNewsStory>>[number]);

  const fallbackPrompt = `${storySeed}

${editorialPhilosophy}

Available search results:
${fallbackResults.length > 0 ? formatNewsSearchResults(fallbackResults) : trimToLength(input.researchText, 12000)}

Return the same JSON shape described below:
{
  "factualOverview": "1 compact paragraph",
  "originPremise": "what the subject originally built, proposed, or represented that made them matter later",
  "keyFacts": [
    {
      "fact": "",
      "sourceLabel": "",
      "url": "https://...",
      "confidence": "high"
    }
  ],
  "tensions": ["contradiction 1", "contradiction 2"],
  "broaderSystem": "what broader system this belongs to",
  "runwayBeats": ["why this person or institution mattered before the headline", "key escalation beat", "pressure-cooker setup"],
  "turningPoints": ["major turning point 1", "major turning point 2"],
  "stakeShifters": ["move, alliance, countermeasure, or diplomatic shift that changed the board"],
  "resolutionMechanism": "if the headline action failed, how the system actually got leverage or got what it wanted",
  "openQuestions": ["open question 1"],
  "sectionCandidates": [
    {
      "title": "",
      "whyItMatters": ""
    }
  ],
  "sourceGroups": [
    {
      "label": "",
      "reason": "",
      "urls": ["https://..."]
    }
  ]
}

Requirements:
- emphasize the real system behind the story
- identify the founding premise when the subject created the platform, idea, institution, or persona that later became threatening
- surface the strongest contradictions and hidden incentives
- separate confirmed facts from reaction and speculation
- include the minimum prehistory and escalation beats needed to make the headline event legible
- identify the turning points that changed the coalition, incentive structure, or institutional response
- identify the stake-shifting moves that changed what each side could do, including countermeasures, diplomatic shifts, legal moves, or alliances
- prefer named turning points over vague summaries: specific leaks, linked figures, leadership changes, diplomatic breaks, countermeasures, or protection mechanisms
- keep deterrents and protection mechanisms when they materially explain why the system escalated or hesitated
- identify the actual resolution route if it is quieter than the headline event
- include direct URLs whenever you have them
- propose section-worthy subtopics for a 10 to 12 minute Moon video`;

  try {
    const openAiFallback = await createOpenAiJson({
      schema: initialBroadResearchSchema,
      jsonSchema: initialBroadResearchJsonSchema,
      system:
        "You are the first broad research pass for a Moon documentary script. You are working from web-search results because the preferred external research pass is unavailable. Distill the story into structured research.",
      user: fallbackPrompt,
      model: getEnv().OPENAI_RESEARCH_MODEL,
      maxTokens: 4200,
    });

    if (openAiFallback) {
      const broadResearchMemo = formatInitialBroadResearchMemo(openAiFallback.value);
      return {
        provider: "openai_web_fallback" as const,
        modelUsed: openAiFallback.model,
        broadResearch: openAiFallback.value,
        broadResearchMemo,
      };
    }
  } catch (error) {
    console.error("[script-agent] Initial broad research via OpenAI fallback failed:", error);
  }

  const fallbackResearch = await createAnthropicJson({
    schema: initialBroadResearchSchema,
    model: getAnthropicPlanningModel(),
    system:
      "You are the first broad research pass for a Moon documentary script. You are working from web-search results because the preferred external research pass is unavailable. Distill the story into structured research. Return JSON only.",
    user: fallbackPrompt,
    temperature: 0.35,
    maxTokens: 2800,
  });

  return {
    provider: "anthropic_web_fallback" as const,
    modelUsed: getAnthropicPlanningModel(),
    broadResearch: fallbackResearch,
    broadResearchMemo: formatInitialBroadResearchMemo(fallbackResearch),
  };
}

export async function generateResearchStrategyStage(args: {
  input: ScriptAgentRequest;
  broadResearchMemo: string;
  planningBeats?: PlanningEvidenceBeat[];
}) {
  const planningContext = await prepareScriptLabPipelineContext({
    storyTitle: args.input.storyTitle,
    targetRuntimeMinutes: args.input.targetRuntimeMinutes,
    notes: mergeNotes(args.input),
    researchText: trimToLength(
      [args.input.researchText, args.broadResearchMemo].filter(Boolean).join("\n\n"),
      48000
    ),
  });
  let analogStructurePacket: string | null = null;
  try {
    analogStructurePacket = await buildMoonAnalogStructurePacket(
      planningContext.moonAnalysis.analogs.map((analog) => analog.clipId)
    );
  } catch (error) {
    console.error("[script-agent] Moon analog structure packet unavailable:", error);
  }

  const researchStrategyDraft = await createAnthropicJson({
    schema: baseResearchStrategySchema,
    model: getAnthropicPlanningModel(),
    system:
      "You are planning research for a Moon documentary script. Your job is to find the strongest Moon angle and turn the broad research into a section plan before source discovery expands. Return JSON only.",
    user: `${planningContext.researchPacket}

${analogStructurePacket ?? ""}

Initial broad research memo:
${args.broadResearchMemo}

${formatPlanningBeatPacket(args.planningBeats ?? [])}

Your job:
1. Identify the strongest Moon angle for this story.
2. Explain what the hook should be.
3. Decide what kind of story this is.
4. Propose the best section order for a 10 to 12 minute video targeting roughly 2,500 words.
5. Identify what evidence each section still needs.
6. Identify what searches and source types matter most for each section.
7. Flag likely false leads, low-value sections, and sections to skip.

Planning rules:
- If the current headline is the climax of a longer arc, include the minimum necessary prehistory so the climax feels inevitable rather than random.
- If the subject created the platform, institution, or idea that later triggered the conflict, include that founding premise explicitly rather than treating it as disposable backstory.
- If the story ends through a quieter mechanism than the headline promises, include that resolution beat explicitly.
- Prefer a Moon documentary arc over a narrow think-piece when the underlying topic clearly has origin, escalation, trigger, climax, and resolution phases.
- Do not mark origin, escalation, or resolution beats as "skip" if the actual stakes depend on them.
- Include the turning points that changed who hated the subject, why the institution escalated, or why a new coalition formed against them.
- Include the stake-shifting moves that changed what was operationally possible: asylum, leaks, alliances, diplomatic shifts, dead-man switches, inside sources, legal maneuvers, or similar moves.
- When a linked figure, leak, or countermeasure changed the subject's threat profile, keep it. Do not flatten it into generic backstory.
- Keep deterrents and protection mechanisms when they explain why the institution escalated, hesitated, or changed tactics.
- Do not skip politically messy but causal beats just because they are controversial. If they changed the institution's posture, they belong in the architecture.
- Do not over-promote a supporting mechanism into a full section unless it actually redirects the story.
- Do not let a later epilogue replace the main arc. If a later development matters but does not drive the original story, keep it as a closing consequence or coda.
- Do not replace a blunt, outrageous story with an over-clever thesis. The angle can be structural, but it still has to feel like a Moon video rather than a think-piece.
- Section plans should feel like a natural Moon documentary, not a compressed analytical memo.

Return JSON:
{
  "primaryAngle": "",
  "backupAngles": [],
  "hookIdea": "",
  "storyType": "",
  "videoStructure": [
    {
      "sectionId": "s1",
      "title": "",
      "purpose": "",
      "whyItMatters": "",
      "evidenceNeeded": [],
      "searchPriorities": [],
      "targetWordCount": 0
    }
  ],
  "globalSearchThemes": [],
  "risks": [],
  "skip": []
}`,
    temperature: 0.3,
    maxTokens: 3200,
  });

  const refinedResearchStrategy = await createAnthropicJson({
    schema: baseResearchStrategySchema,
    model: getAnthropicPlanningModel(),
    system:
      "You are refining a Moon documentary research strategy. Your job is to preserve the strongest angle while repairing narrow or incomplete story architecture. Return JSON only.",
    user: `${planningContext.researchPacket}

${analogStructurePacket ?? ""}

Initial broad research memo:
${args.broadResearchMemo}

${formatPlanningBeatPacket(args.planningBeats ?? [])}

Current strategy draft:
${JSON.stringify(researchStrategyDraft, null, 2)}

Refinement rules:
- The final strategy must still have a strong Moon angle and hook.
- But a Moon plan is incomplete if it does not explain why the target mattered before the headline event.
- A Moon plan is incomplete if it skips the founding premise of the thing that later made the target dangerous or symbolically important.
- A Moon plan is incomplete if it does not include the key escalation beats that make the extreme response legible.
- A Moon plan is incomplete if it skips the turning points that changed the political or institutional coalition against the subject.
- A Moon plan is incomplete if it skips the stake-shifting moves or countermoves that explain why urgency, paranoia, or operational planning escalated.
- A Moon plan is incomplete if it loses named causal beats and replaces them with vague summaries. Keep the concrete leak, linked figure, or protection mechanism when it materially explains the escalation.
- A Moon plan is incomplete if it drops the deterrents or protection mechanisms that explain why the system hesitated or changed tactics.
- A Moon plan is incomplete if it does not show how the system actually got leverage when the dramatic option failed.
- If the story has a long runway, keep the hook on the scandal peak but then rewind to the minimum backstory needed for the climax to feel inevitable.
- Prefer 6 to 8 sections that move through origin/context, escalation, trap or pressure-cooker setup, trigger, operational climax, real resolution, and unresolved consequence when those phases are clearly present.
- Do not skip origin, escalation, or resolution beats if they materially explain motive, stakes, or outcome.
- Do not skip politically messy but causal turning points. If a leak, alliance, or public controversy changed institutional posture, include it.
- Do not promote a supporting mechanism to its own section unless the story actually turns on it.
- Do not spend a full structural section on a late epilogue if it works better as a closing consequence.
- Avoid forcing a clever thesis that outruns the story's actual payoff. If a quieter diplomatic or legal route is the real ending, include it explicitly.
- Avoid abstracting the story so much that you lose Moon's emotional directness. Structural analysis should sharpen the outrage, not flatten it.

Return repaired JSON in the same schema:
{
  "primaryAngle": "",
  "backupAngles": [],
  "hookIdea": "",
  "storyType": "",
  "videoStructure": [
    {
      "sectionId": "s1",
      "title": "",
      "purpose": "",
      "whyItMatters": "",
      "evidenceNeeded": [],
      "searchPriorities": [],
      "targetWordCount": 0
    }
  ],
  "globalSearchThemes": [],
  "risks": [],
  "skip": []
}`,
    temperature: 0.2,
    maxTokens: 3600,
  });

  const beatStrategyPlan =
    args.planningBeats && args.planningBeats.length > 0
      ? await createAnthropicJson({
          schema: researchStrategyBeatPlanSchema,
          model: getAnthropicPlanningModel(),
          system:
            "You are classifying preserved research beats for a Moon documentary planning stack. Decide which beats are core, supporting, or skippable given the chosen section architecture. Return JSON only.",
          user: `Final strategy architecture:
${formatBaseResearchStrategySummary(refinedResearchStrategy)}

Preserved beat ledger:
${formatPlanningBeatPacket(args.planningBeats)}

Your job:
1. Review each preserved beat.
2. Mark it as core, supporting, or skip.
3. Give a concrete reason.
4. Assign a targetSectionId when the beat belongs in a section.
5. Return mustPreserveBeats as the beat IDs that should survive into writing.

Rules:
- Do not silently discard named actors, operational methods, founding incidents, relationship turns, deterrents, or resolution beats.
- A beat should be skip only if it is redundant, weakly sourced, off-arc, or clearly too minor for a 10 to 12 minute structure.
- Prefer section IDs that already exist in the final architecture.
- Keep the response compact. You are classifying beats, not rewriting the outline.

Return JSON:
{
  "mustPreserveBeats": ["beat_01"],
  "beatDecisions": [
    {
      "beatId": "beat_01",
      "beat": "",
      "decision": "core",
      "reason": "",
      "targetSectionId": "s1"
    }
  ]
}`,
          temperature: 0.1,
          maxTokens: 1800,
        })
      : {
          mustPreserveBeats: [],
          beatDecisions: [],
        };

  return {
    modelUsed: getAnthropicPlanningModel(),
    planningContext,
    researchStrategy: researchStrategySchema.parse({
      ...refinedResearchStrategy,
      ...beatStrategyPlan,
    }),
  };
}

export async function generateSectionQueryPlanningStage(args: {
  input: ScriptAgentRequest;
  broadResearchMemo: string;
  planningContext: Awaited<ReturnType<typeof prepareScriptLabPipelineContext>>;
  researchStrategy: ResearchStrategy;
  planningBeats?: PlanningEvidenceBeat[];
}) {
  const preservedBeatSummary = args.researchStrategy.beatDecisions
    .filter((beat) => beat.decision !== "skip")
    .map((beat) =>
      [
        `- ${beat.beatId} [${beat.decision}] ${beat.beat}`,
        beat.targetSectionId ? `  target section: ${beat.targetSectionId}` : null,
      ]
        .filter(Boolean)
        .join("\n")
    )
    .join("\n");
  const sectionQueryPlanning = await createAnthropicJson({
    schema: sectionQueryPlanningSchema,
    model: getAnthropicPlanningModel(),
    system:
      "You are planning follow-up research queries for a Moon documentary script. Generate the minimum high-value searches needed to get strong evidence without wasting quota. Return JSON only.",
    user: `${args.planningContext.researchPacket}

Initial broad research memo:
${args.broadResearchMemo}

${formatPlanningBeatPacket(args.planningBeats ?? [])}

Research strategy:
${JSON.stringify(args.researchStrategy, null, 2)}

Preserved beats that survived strategy:
${preservedBeatSummary || "None."}

Generate conservative but strong research queries.

Rules:
- Prefer 2 to 4 strong queries per source type, not a giant list.
- Use aliases, names, dates, products, institutions, and events when useful.
- If a source type is unlikely to help a section, omit it.
- Global queries should help the story as a whole.
- Section queries should sharpen that section's specific argument.
- Keep YouTube/video queries phrased like something that could find reactions, explainers, interviews, or podcasts.
- Keep social queries phrased to surface X posts, Reddit threads, TikToks, Instagram posts, LinkedIn posts, or similar direct discussion.
- Make sure the query plan covers the turning points and stake-shifting moves from the broad research memo, not just the scandal peak.
- Add targeted queries when a named leak, linked figure, protection mechanism, or diplomatic rupture clearly drives the section.
- If a beat was marked core or supporting, make sure the queries leave a realistic path to confirming it. Do not leave preserved beats unsupported.

Return JSON:
{
  "globalQueries": [
    {
      "label": "",
      "objective": "",
      "searchMode": "news_web",
      "query": ""
    }
  ],
  "sectionQueries": [
    {
      "sectionId": "s1",
      "articleQueries": [],
      "videoQueries": [],
      "socialQueries": [],
      "podcastQueries": []
    }
  ]
}`,
    temperature: 0.25,
    maxTokens: 3200,
  });

  return {
    modelUsed: getAnthropicPlanningModel(),
    sectionQueryPlanning,
  };
}

function getInitialSectionQueryBeamLimit(depth: ScriptAgentRequest["researchDepth"]) {
  return depth === "quick" ? 3 : depth === "standard" ? 6 : 10;
}

function getInitialSectionQueryTakeCount(depth: ScriptAgentRequest["researchDepth"]) {
  if (depth === "quick") {
    return {
      article: 1,
      video: 1,
      social: 1,
      podcast: 0,
    };
  }

  if (depth === "standard") {
    return {
      article: 2,
      video: 1,
      social: 1,
      podcast: 1,
    };
  }

  return {
    article: 2,
    video: 2,
    social: 2,
    podcast: 1,
  };
}

function buildInitialSectionQueryBeams(args: {
  input: ScriptAgentRequest;
  strategy: ResearchStrategy;
  sectionQueryPlanning: SectionQueryPlanning;
}) {
  const beams: ScriptAgentResearchBeam[] = [];
  const maxInitialSectionBeams = getInitialSectionQueryBeamLimit(args.input.researchDepth);
  const queryTakeCount = getInitialSectionQueryTakeCount(args.input.researchDepth);

  for (const section of args.strategy.videoStructure) {
    const sectionQueries = args.sectionQueryPlanning.sectionQueries.find(
      (candidate) => candidate.sectionId === section.sectionId
    );
    if (!sectionQueries) {
      continue;
    }

    const pushBeam = (
      searchMode: ScriptAgentResearchBeamSearchMode,
      query: string | undefined,
      suffix: string,
      objective: string
    ) => {
      const normalizedQuery = query?.trim();
      if (!normalizedQuery || beams.length >= maxInitialSectionBeams) {
        return;
      }

      beams.push({
        beamId: buildBeamId(["initial", suffix, section.title, normalizedQuery]),
        phase: "initial",
        label: `${section.title} ${suffix}`,
        objective,
        query: normalizedQuery,
        searchMode,
        sectionHeading: section.title,
      });
    };

    sectionQueries.articleQueries.slice(0, queryTakeCount.article).forEach((query, index) => {
      pushBeam(
        "news_web",
        query,
        `article focus ${index + 1}`,
        `Find section-specific reporting and direct evidence for ${section.title}.`
      );
    });

    sectionQueries.videoQueries.slice(0, queryTakeCount.video).forEach((query, index) => {
      pushBeam(
        "video_topic",
        query,
        `video focus ${index + 1}`,
        `Find commentary videos, interviews, and explainers for ${section.title}.`
      );
    });

    sectionQueries.podcastQueries.slice(0, queryTakeCount.podcast).forEach((query, index) => {
      pushBeam(
        "video_topic",
        query,
        `podcast focus ${index + 1}`,
        `Find podcasts, long-form interviews, and discussions for ${section.title}.`
      );
    });

    sectionQueries.socialQueries.slice(0, queryTakeCount.social).forEach((query, index) => {
      pushBeam(
        "social_web",
        query,
        `social focus ${index + 1}`,
        `Find direct social posts and discussion that sharpen ${section.title}.`
      );
    });

    if (beams.length >= maxInitialSectionBeams) {
      break;
    }
  }

  return beams;
}

function buildInitialResearchPlan(
  input: ScriptAgentRequest,
  strategy?: ResearchStrategy | null,
  broadResearch?: InitialBroadResearch | null,
  sectionQueryPlanning?: SectionQueryPlanning | null
): ScriptAgentResearchPlan {
  const storySearchAnchor = buildStorySearchAnchor({
    storyTitle: input.storyTitle,
    objective: input.objective,
    preferredAngle: input.preferredAngle,
    notes: input.notes,
    strategy,
    broadResearch,
  });
  const angleKeywords = extractTranscriptKeywords(
    [
      input.objective,
      input.preferredAngle,
      input.notes,
      strategy?.primaryAngle,
      strategy?.hookIdea,
      broadResearch?.originPremise,
      broadResearch?.broaderSystem,
      broadResearch?.resolutionMechanism,
      ...(broadResearch?.runwayBeats ?? []),
      ...(broadResearch?.turningPoints ?? []),
      ...(broadResearch?.stakeShifters ?? []),
      ...(strategy?.globalSearchThemes ?? []),
      ...(strategy?.videoStructure ?? []).flatMap((section) => [
        section.title,
        section.purpose,
        ...section.searchPriorities.slice(0, 3),
      ]),
      ...(broadResearch?.tensions ?? []),
    ].join(" "),
    8
  );
  const anglePhrase = angleKeywords.slice(0, 4).join(" ");
  const socialSuffix = angleKeywords.slice(0, 3).join(" ");
  const systemicKeywords = extractTranscriptKeywords(
    [
      strategy?.primaryAngle,
      broadResearch?.originPremise,
      broadResearch?.broaderSystem,
      broadResearch?.resolutionMechanism,
      ...(broadResearch?.runwayBeats ?? []),
      ...(broadResearch?.turningPoints ?? []),
      ...(broadResearch?.stakeShifters ?? []),
      ...(strategy?.globalSearchThemes ?? []),
    ].join(" "),
    6
  );
  const contradictionKeywords = extractTranscriptKeywords(
    [...(broadResearch?.tensions ?? []), strategy?.hookIdea].join(" "),
    5
  );
  const videoKeywords = extractTranscriptKeywords(
    [
      strategy?.hookIdea,
      broadResearch?.originPremise,
      broadResearch?.resolutionMechanism,
      ...(broadResearch?.runwayBeats ?? []),
      ...(broadResearch?.turningPoints ?? []),
      ...(broadResearch?.stakeShifters ?? []),
      ...(strategy?.videoStructure ?? []).flatMap((section) => [
        section.title,
        ...section.searchPriorities.slice(0, 2),
      ]),
    ].join(" "),
    6
  );
  const originKeywords = extractTranscriptKeywords(
    [
      broadResearch?.originPremise,
      ...(broadResearch?.runwayBeats ?? []).slice(0, 2),
      ...(broadResearch?.keyFacts ?? []).slice(0, 3).map((fact) => fact.fact),
    ].join(" "),
    6
  );
  const turningPointKeywords = extractTranscriptKeywords(
    [
      ...(broadResearch?.turningPoints ?? []),
      ...(broadResearch?.stakeShifters ?? []),
      ...(broadResearch?.keyFacts ?? []).slice(0, 4).map((fact) => fact.fact),
    ].join(" "),
    6
  );
  const fallbackGlobalBeams: ScriptAgentResearchBeam[] = [
    {
      beamId: "initial-core-web",
      phase: "initial",
      label: "Core factual coverage",
      objective: "Find the main reporting and explain what happened.",
      query: storySearchAnchor,
      searchMode: "news_web",
      sectionHeading: null,
    },
    {
      beamId: "initial-backlash-web",
      phase: "initial",
      label: "Backlash and reaction coverage",
      objective: "Find audience backlash, reaction writeups, and controversy framing.",
      query:
        contradictionKeywords.length > 0
          ? `${storySearchAnchor} ${contradictionKeywords.join(" ")} reactions controversy`
          : `${storySearchAnchor} backlash controversy reactions`,
      searchMode: "news_web",
      sectionHeading: null,
    },
    {
      beamId: "initial-angle-web",
      phase: "initial",
      label: "Systemic angle coverage",
      objective: "Find reporting that supports the preferred systemic angle, not just the surface event.",
      query:
        systemicKeywords.length > 0
          ? `${storySearchAnchor} ${systemicKeywords.join(" ")}`
          : anglePhrase
            ? `${storySearchAnchor} ${anglePhrase}`
            : `${storySearchAnchor} analysis`,
      searchMode: "news_web",
      sectionHeading: null,
    },
    {
      beamId: "initial-social-web",
      phase: "initial",
      label: "Social posts and discussion",
      objective: "Find direct social posts, Reddit threads, and platform discussion.",
      query: `${storySearchAnchor} ${socialSuffix} (site:reddit.com OR site:x.com OR site:twitter.com OR site:tiktok.com OR site:instagram.com OR site:linkedin.com)`,
      searchMode: "social_web",
      sectionHeading: null,
    },
    {
      beamId: "initial-tweets-web",
      phase: "initial",
      label: "Tweets and X posts",
      objective: "Find original tweets, X posts, quote-tweets, and thread receipts that matter to the story.",
      query: `${storySearchAnchor} ${socialSuffix} (site:x.com OR site:twitter.com)`,
      searchMode: "social_web",
      sectionHeading: null,
    },
    {
      beamId: "initial-video-topic",
      phase: "initial",
      label: "Commentary videos and reactions",
      objective: "Find commentary videos, reactions, breakdowns, and news videos worth mining for quotes.",
      query:
        videoKeywords.length > 0
          ? `${storySearchAnchor} ${videoKeywords.join(" ")} breakdown reaction commentary`
          : `${storySearchAnchor} breakdown reaction commentary`,
      searchMode: "video_topic",
      sectionHeading: null,
    },
    {
      beamId: "initial-podcast-web",
      phase: "initial",
      label: "Podcasts and long-form discussion",
      objective: "Find podcasts, interviews, and long-form discussion pages tied to the story.",
      query: `${storySearchAnchor} podcast interview discussion`,
      searchMode: "news_web",
      sectionHeading: null,
    },
  ];
  const broadResearchDerivedBeams: ScriptAgentResearchBeam[] = broadResearch
    ? [
        {
          beamId: "initial-origin-web",
          phase: "initial",
          label: "Origin and early escalation",
          objective:
            "Find origin reporting, early history, and the first escalation beats that made the story legible.",
          query:
            originKeywords.length > 0
              ? `${storySearchAnchor} ${originKeywords.join(" ")} history origin timeline`
              : `${storySearchAnchor} history origin timeline`,
          searchMode: "news_web",
          sectionHeading: null,
        },
        {
          beamId: "initial-turning-points-web",
          phase: "initial",
          label: "Turning points and timeline",
          objective:
            "Find the major turning points, timeline shifts, and stake-changing moves across the story.",
          query:
            turningPointKeywords.length > 0
              ? `${storySearchAnchor} ${turningPointKeywords.join(" ")} timeline turning point`
              : `${storySearchAnchor} timeline turning point`,
          searchMode: "news_web",
          sectionHeading: null,
        },
        {
          beamId: "initial-context-video",
          phase: "initial",
          label: "Context videos and explainers",
          objective:
            "Find explainers, retrospectives, and timeline videos that cover the full arc rather than only the scandal peak.",
          query:
            originKeywords.length > 0
              ? `${storySearchAnchor} ${originKeywords.join(" ")} timeline documentary explainer`
              : `${storySearchAnchor} timeline documentary explainer`,
          searchMode: "video_topic",
          sectionHeading: null,
        },
      ]
    : [];
  const plannerGlobalBeams = (sectionQueryPlanning?.globalQueries ?? []).map((query, index) => ({
    beamId: buildBeamId(["initial-global", String(index + 1), query.label, query.query]),
    phase: "initial" as const,
    label: query.label,
    objective: query.objective,
    query: query.query,
    searchMode: query.searchMode,
    sectionHeading: null,
  }));
  const plannerSectionBeams =
    strategy && sectionQueryPlanning
      ? buildInitialSectionQueryBeams({
          input,
          strategy,
          sectionQueryPlanning,
        })
      : [];
  const combinedGlobalBeams = dedupeStringList(
    [
      ...plannerGlobalBeams,
      ...plannerSectionBeams,
      ...broadResearchDerivedBeams,
      ...fallbackGlobalBeams,
    ].map((beam) => JSON.stringify(beam)),
    input.researchDepth === "quick" ? 8 : input.researchDepth === "standard" ? 14 : 22
  ).map((beam) => JSON.parse(beam) as ScriptAgentResearchBeam);
  const seedUrls =
    broadResearch
      ? [
          ...broadResearch.sourceGroups.flatMap((group) =>
            group.urls.map((url) => ({
              url: normalizeSourceUrl(url),
              label: group.label,
              reason: group.reason,
              sectionHeading: null,
            }))
          ),
          ...broadResearch.keyFacts.flatMap((fact) =>
            fact.url
              ? [
                  {
                    url: normalizeSourceUrl(fact.url),
                    label: fact.sourceLabel,
                    reason: fact.fact,
                    sectionHeading: null,
                  },
                ]
              : []
          ),
        ]
      .filter((seed) => seed.url.length > 0)
      .filter((seed, index, seeds) => seeds.findIndex((item) => item.url === seed.url) === index)
      .slice(0, 36)
      : [];

  return {
    summary:
      strategy
        ? `AI-generated initial plan around the angle "${strategy.primaryAngle}" with hook "${strategy.hookIdea}".`
        : "Initial plan fans out across factual coverage, backlash, systemic angle reporting, social discourse, commentary video, and podcast/interview discussion.",
    globalBeams: combinedGlobalBeams,
    sectionBeams: [],
    seedUrls,
  };
}

function findBestStrategySectionMatch(
  heading: string,
  strategySections: ResearchStrategy["videoStructure"]
) {
  const headingKeywords = new Set(extractTranscriptKeywords(heading, 8));
  let bestMatch: ResearchStrategy["videoStructure"][number] | null = null;
  let bestScore = -1;

  for (const section of strategySections) {
    const candidateKeywords = new Set(
      extractTranscriptKeywords(
        [section.title, section.purpose, section.whyItMatters].join(" "),
        10
      )
    );
    const overlap = [...headingKeywords].filter((keyword) => candidateKeywords.has(keyword)).length;
    if (overlap > bestScore) {
      bestScore = overlap;
      bestMatch = section;
    }
  }

  return bestScore > 0 ? bestMatch : null;
}

function buildSectionFollowupResearchPlan(args: {
  input: ScriptAgentRequest;
  researchStage: { thesis: string; keyClaims: string[] };
  outlineStage: { sections: Array<{ heading: string; purpose: string; beatGoal: string }> };
  researchStrategy?: ResearchStrategy | null;
}): ScriptAgentResearchPlan {
  const sectionBeams: ScriptAgentResearchBeam[] = [];

  for (const section of args.outlineStage.sections) {
    const matchedStrategySection = args.researchStrategy
      ? findBestStrategySectionMatch(section.heading, args.researchStrategy.videoStructure)
      : null;
    const sectionSearchAnchor = buildStorySearchAnchor({
      storyTitle: args.input.storyTitle,
      objective: args.input.objective,
      preferredAngle: args.input.preferredAngle,
      notes: args.input.notes,
      strategy: args.researchStrategy ?? null,
      extraText: [
        args.researchStage.thesis,
        matchedStrategySection?.title,
        matchedStrategySection?.purpose,
        ...(matchedStrategySection?.searchPriorities ?? []),
        ...(matchedStrategySection?.evidenceNeeded ?? []),
      ]
        .filter(Boolean)
        .join(" "),
      limit: 8,
    });
    const sectionKeywords = extractTranscriptKeywords(
      [
        section.heading,
        section.purpose,
        section.beatGoal,
        args.researchStage.thesis,
        args.researchStage.keyClaims.join(" "),
        matchedStrategySection?.whyItMatters,
        ...(matchedStrategySection?.searchPriorities ?? []),
        ...(matchedStrategySection?.evidenceNeeded ?? []),
      ].join(" "),
      8
    );
    const queryTerms = sectionKeywords.slice(0, 5).join(" ");

    sectionBeams.push(
      {
        beamId: buildBeamId(["section-web", section.heading]),
        phase: "section_followup",
        label: `${section.heading} web follow-up`,
        objective: `Find section-specific reporting and direct evidence for ${section.heading}.`,
        query: queryTerms
          ? `${sectionSearchAnchor} ${queryTerms}`
          : `${sectionSearchAnchor} ${section.heading}`,
        searchMode: "news_web",
        sectionHeading: section.heading,
      },
      {
        beamId: buildBeamId(["section-social", section.heading]),
        phase: "section_followup",
        label: `${section.heading} social follow-up`,
        objective: `Find direct social posts, Reddit threads, and platform reactions that sharpen ${section.heading}.`,
        query: `${sectionSearchAnchor} ${queryTerms} (site:reddit.com OR site:x.com OR site:twitter.com OR site:tiktok.com OR site:instagram.com OR site:linkedin.com)`,
        searchMode: "social_web",
        sectionHeading: section.heading,
      },
      {
        beamId: buildBeamId(["section-tweets", section.heading]),
        phase: "section_followup",
        label: `${section.heading} tweets and X follow-up`,
        objective: `Find original tweets, X posts, and thread receipts that sharpen ${section.heading}.`,
        query: `${sectionSearchAnchor} ${queryTerms} (site:x.com OR site:twitter.com)`,
        searchMode: "social_web",
        sectionHeading: section.heading,
      },
      {
        beamId: buildBeamId(["section-video", section.heading]),
        phase: "section_followup",
        label: `${section.heading} video follow-up`,
        objective: `Find commentary videos, podcasts, and news clips that speak directly to ${section.heading}.`,
        query: `${sectionSearchAnchor} ${queryTerms} breakdown reaction podcast commentary`,
        searchMode: "video_topic",
        sectionHeading: section.heading,
      }
    );
  }

  return {
    summary:
      "Section follow-up plan searches each outline section separately across web, social posts, and commentary video so later writing stages get beat-specific evidence instead of one static packet.",
    globalBeams: [],
    sectionBeams,
    seedUrls: [],
  };
}

async function loadDiscoveryState(runId: string): Promise<DiscoveryState> {
  const db = getDb();
  const [sourceRows, quoteRows] = await Promise.all([
    db.select().from(scriptAgentSources).where(eq(scriptAgentSources.runId, runId)),
    db.select().from(scriptAgentQuotes).where(eq(scriptAgentQuotes.runId, runId)),
  ]);

  const urlScopeKeys = new Set<string>();
  const clipScopeKeys = new Set<string>();
  const quoteKeys = new Set<string>();
  const sourceIdByUrlScopeKey = new Map<string, string>();
  const sourceIdByClipScopeKey = new Map<string, string>();

  for (const source of sourceRows) {
    const stageKey = (source.stageKey ?? "discover_sources") as ScriptAgentStageKey;
    const sectionHeading = getSectionHeadingFromMetadata(source.metadataJson);

    if (source.url) {
      const key = buildSourceScopeKey(stageKey, sectionHeading, normalizeSourceUrl(source.url));
      urlScopeKeys.add(key);
      sourceIdByUrlScopeKey.set(key, source.id);
    }
    if (source.clipId) {
      const key = buildSourceScopeKey(stageKey, sectionHeading, source.clipId);
      clipScopeKeys.add(key);
      sourceIdByClipScopeKey.set(key, source.id);
    }
  }

  for (const quote of quoteRows) {
    if (quote.startMs !== null && quote.sourceUrl) {
      const provider =
        quote.metadataJson && typeof quote.metadataJson === "object"
          ? String((quote.metadataJson as Record<string, unknown>).externalId ?? quote.sourceUrl)
          : quote.sourceUrl;
      quoteKeys.add(buildTranscriptQuoteKey(provider, quote.startMs, quote.quoteText));
    } else {
      quoteKeys.add(quote.quoteText.trim().toLowerCase());
    }
  }

  return {
    urlScopeKeys,
    clipScopeKeys,
    quoteKeys,
    sourceIdByUrlScopeKey,
    sourceIdByClipScopeKey,
  };
}

function buildCompiledResearchText(args: {
  input: ScriptAgentRequest;
  documentSources: Array<{
    sourceKind: string;
    providerName: string;
    title: string;
    url: string | null;
    snippet: string | null;
    metadataJson: unknown;
    contentJson: unknown;
  }>;
  quoteRows: Array<{
    sourceLabel: string;
    sourceUrl: string | null;
    quoteText: string;
    speaker: string | null;
    context: string | null;
  }>;
}) {
  const sections = [
    "Primary research dossier:",
    args.input.researchText.trim(),
  ];

  if (args.documentSources.length > 0) {
    sections.push("", "Discovered reporting and platform evidence:");

    for (const source of args.documentSources.slice(0, 18)) {
      const content = asObjectRecord(source.contentJson);
      const metadata = asObjectRecord(source.metadataJson);
      const sectionHeading = getSectionHeadingFromMetadata(source.metadataJson);
      const extractedText = extractSourceContentText(source);
      const articleFacts = readArticleFactExtract(source.contentJson);

      sections.push(
        [
          `Source: ${source.title}`,
          `Kind: ${source.sourceKind}`,
          `Provider: ${source.providerName}`,
          sectionHeading ? `Section: ${sectionHeading}` : null,
          source.url ? `URL: ${source.url}` : null,
          source.snippet ? `Snippet: ${source.snippet}` : null,
          readStringField(content, "siteName") ? `Site: ${readStringField(content, "siteName")}` : null,
          readStringField(content, "publishedAt") ? `Published: ${readStringField(content, "publishedAt")}` : null,
          readStringField(metadata, "searchQuery") ? `Search query: ${readStringField(metadata, "searchQuery")}` : null,
          articleFacts
            ? ["Structured facts:", formatArticleFactExtract(articleFacts, 2)]
                .filter(Boolean)
                .join("\n")
            : null,
          extractedText ? `Extract: ${trimToLength(extractedText, 2200)}` : null,
        ]
          .filter(Boolean)
          .join("\n")
      );
    }
  }

  if (args.quoteRows.length > 0) {
    sections.push("", "Quote bank:");

    for (const quote of args.quoteRows.slice(0, 12)) {
      sections.push(
        [
          `Source: ${quote.sourceLabel}`,
          quote.sourceUrl ? `URL: ${quote.sourceUrl}` : null,
          quote.speaker ? `Speaker: ${quote.speaker}` : null,
          `Quote: "${quote.quoteText}"`,
          quote.context ? `Context: ${quote.context}` : null,
        ]
          .filter(Boolean)
          .join("\n")
      );
    }
  }

  return trimToLength(sections.join("\n\n"), 48000);
}

function mapQuoteRowsToEvidence(
  quoteRows: Array<{
    sourceLabel: string;
    sourceUrl: string | null;
    quoteText: string;
    speaker: string | null;
    context: string | null;
    relevanceScore: number;
    startMs: number | null;
    endMs: number | null;
    metadataJson: unknown;
  }>
): ScriptEvidenceQuote[] {
  return quoteRows.map((quote) => ({
    sourceType: (() => {
      const metadata = asObjectRecord(quote.metadataJson);
      const sourceType = readStringField(metadata, "sourceType");
      if (sourceType === "clip_transcript") {
        return "clip_transcript";
      }
      if (
        sourceType === "research_text" ||
        sourceType === "article" ||
        sourceType === "social_post" ||
        sourceType === "video"
      ) {
        return "research_text";
      }
      return quote.startMs !== null ? "clip_transcript" : "research_text";
    })(),
    sourceTitle: quote.sourceLabel,
    sourceUrl: quote.sourceUrl,
    quoteText: quote.quoteText,
    speaker: quote.speaker,
    context: quote.context ?? "",
    relevanceScore: quote.relevanceScore,
    startMs: quote.startMs,
    endMs: quote.endMs,
  }));
}

function buildSectionResearchPackages(args: {
  outlineStage: {
    sections: Array<{ heading: string; purpose: string; beatGoal: string }>;
  };
  sourceRows: Array<typeof scriptAgentSources.$inferSelect>;
  quoteRows: Array<typeof scriptAgentQuotes.$inferSelect>;
}): SectionResearchPackage[] {
  const quoteRowsBySourceId = new Map<string, Array<typeof scriptAgentQuotes.$inferSelect>>();

  for (const quote of args.quoteRows) {
    if (!quote.sourceId) {
      continue;
    }
    const list = quoteRowsBySourceId.get(quote.sourceId) ?? [];
    list.push(quote);
    quoteRowsBySourceId.set(quote.sourceId, list);
  }

  return args.outlineStage.sections.map((section) => {
    const sectionSources = args.sourceRows.filter(
      (source) =>
        source.sourceKind !== "generated_note" &&
        getSectionHeadingFromMetadata(source.metadataJson) === section.heading
    );
    const sectionQuotes = args.quoteRows
      .filter((quote) => getSectionHeadingFromMetadata(quote.metadataJson) === section.heading)
      .sort((left, right) => right.relevanceScore - left.relevanceScore);
    const articleSources = sectionSources.filter((source) => source.sourceKind === "article");
    const clipSources = sectionSources.filter(
      (source) => source.sourceKind === "library_clip" || source.sourceKind === "video"
    );
    const socialSources = sectionSources.filter((source) => source.sourceKind === "social_post");

    const keyClipsToWatch = clipSources
      .map((source) => {
        const topQuote =
          (quoteRowsBySourceId.get(source.id) ?? [])
            .slice()
            .sort((left, right) => right.relevanceScore - left.relevanceScore)[0] ?? null;

        return {
          sourceId: source.id,
          title: source.title,
          url: source.url,
          clipId: source.clipId,
          transcriptStatus: source.transcriptStatus,
          topQuote: topQuote?.quoteText ?? null,
          topQuoteStartMs: topQuote?.startMs ?? null,
        };
      })
      .slice(0, 6);

    const relatedArticles = articleSources
      .map((source) => {
        const facts = readArticleFactExtract(source.contentJson);
        const content = asObjectRecord(source.contentJson);
        const summary =
          readStringField(content, "summary", "description") ??
          (trimToLength(extractSourceContentText(source) ?? "", 320) || null);
        const keyPoints = dedupeStringList(
          [
            ...(facts?.keyFacts ?? []),
            ...(facts?.operationalDetails ?? []),
            ...(facts?.motiveFrames ?? []),
          ],
          5
        );

        return {
          sourceId: source.id,
          title: source.title,
          url: source.url,
          publishedAt: source.publishedAt,
          keyPoints,
          summary,
        };
      })
      .slice(0, 6);

    const relatedSocialPosts = socialSources
      .map((source) => {
        const metadata = asObjectRecord(source.metadataJson);
        return {
          sourceId: source.id,
          title: source.title,
          url: source.url,
          providerName: source.providerName,
          snippet: trimToLength(extractSourceContentText(source) ?? source.snippet ?? "", 320) || null,
          socialLane:
            readStringField(metadata, "socialLane", "commentPlatform", "discoverySource") ?? null,
        };
      })
      .slice(0, 8);

    const exactQuotes = sectionQuotes.slice(0, 8).map((quote) => ({
      sourceId: quote.sourceId,
      sourceLabel: quote.sourceLabel,
      sourceUrl: quote.sourceUrl,
      quoteText: quote.quoteText,
      speaker: quote.speaker,
      context: quote.context,
      startMs: quote.startMs,
      endMs: quote.endMs,
      relevanceScore: quote.relevanceScore,
    }));

    const blocks = [
      `Section-specific follow-up evidence for "${section.heading}"`,
      `Purpose: ${section.purpose}`,
      `Beat goal: ${section.beatGoal}`,
    ];

    if (keyClipsToWatch.length > 0) {
      blocks.push("", "Key clips to watch:");

      for (const clip of keyClipsToWatch) {
        blocks.push(
          [
            `- ${clip.title}`,
            clip.url ? `  url: ${clip.url}` : null,
            `  transcript: ${clip.transcriptStatus}`,
            clip.topQuote ? `  key quote: "${trimToLength(clip.topQuote, 420)}"` : null,
            clip.topQuoteStartMs !== null ? `  timestamp: ${clip.topQuoteStartMs}ms` : null,
          ]
            .filter(Boolean)
            .join("\n")
        );
      }
    }

    if (relatedArticles.length > 0) {
      blocks.push("", "Related articles:");

      for (const article of relatedArticles) {
        blocks.push(
          [
            `- ${article.title}`,
            article.url ? `  url: ${article.url}` : null,
            article.publishedAt ? `  published: ${article.publishedAt}` : null,
            article.keyPoints.length > 0 ? `  key points: ${article.keyPoints.join(" | ")}` : null,
            article.summary ? `  summary: ${trimToLength(article.summary, 420)}` : null,
          ]
            .filter(Boolean)
            .join("\n")
        );
      }
    }

    if (relatedSocialPosts.length > 0) {
      blocks.push("", "Tweets, posts, and comments:");

      for (const post of relatedSocialPosts) {
        blocks.push(
          [
            `- ${post.title}`,
            post.url ? `  url: ${post.url}` : null,
            `  provider: ${post.providerName}`,
            post.socialLane ? `  lane: ${post.socialLane}` : null,
            post.snippet ? `  text: ${trimToLength(post.snippet, 360)}` : null,
          ]
            .filter(Boolean)
            .join("\n")
        );
      }
    }

    if (exactQuotes.length > 0) {
      blocks.push("", "Quotes and direct receipts:");

      for (const quote of exactQuotes) {
        blocks.push(
          [
            `- ${quote.sourceLabel}`,
            quote.sourceUrl ? `  url: ${quote.sourceUrl}` : null,
            quote.speaker ? `  speaker: ${quote.speaker}` : null,
            quote.startMs !== null ? `  startMs: ${quote.startMs}` : null,
            `  quote: "${trimToLength(quote.quoteText, 600)}"`,
            quote.context ? `  context: ${trimToLength(quote.context, 280)}` : null,
          ]
            .filter(Boolean)
            .join("\n")
        );
      }
    }

    return {
      sectionHeading: section.heading,
      purpose: section.purpose,
      beatGoal: section.beatGoal,
      sourceCount: sectionSources.length,
      quoteCount: sectionQuotes.length,
      articleCount: relatedArticles.length,
      clipCount: keyClipsToWatch.length,
      socialCount: relatedSocialPosts.length,
      keyClipsToWatch,
      relatedArticles,
      relatedSocialPosts,
      exactQuotes,
      briefText: trimToLength(blocks.join("\n"), 4000),
    } satisfies SectionResearchPackage;
  });
}

function buildSectionResearchBriefsFromPackages(packages: SectionResearchPackage[]) {
  return Object.fromEntries(
    packages.map((pkg) => [pkg.sectionHeading, pkg.briefText] as const)
  );
}

async function persistSectionResearchPackages(args: {
  runId: string;
  stageKey: ScriptAgentStageKey;
  packages: SectionResearchPackage[];
}) {
  const db = getDb();

  await db
    .delete(scriptAgentSources)
    .where(
      and(
        eq(scriptAgentSources.runId, args.runId),
        eq(scriptAgentSources.stageKey, args.stageKey),
        eq(scriptAgentSources.sourceKind, "generated_note")
      )
    );

  if (args.packages.length === 0) {
    return 0;
  }

  await db.insert(scriptAgentSources).values(
    args.packages.map((pkg): typeof scriptAgentSources.$inferInsert => ({
      runId: args.runId,
      stageKey: args.stageKey,
      sourceKind: "generated_note",
      providerName: "internal",
      title: `Section research brief: ${pkg.sectionHeading}`,
      url: null,
      snippet: trimToLength(pkg.briefText, 480),
      contentStatus: "complete",
      transcriptStatus: "complete",
      contentJson: pkg,
      metadataJson: {
        sectionHeading: pkg.sectionHeading,
        sourceCount: pkg.sourceCount,
        quoteCount: pkg.quoteCount,
        articleCount: pkg.articleCount,
        clipCount: pkg.clipCount,
        socialCount: pkg.socialCount,
        generatedFrom: "section_research_package",
      },
    }))
  );

  return args.packages.length;
}

async function fetchRedditThreadComments(args: {
  threadUrl: string;
  maxComments?: number;
}): Promise<
  Array<{
    id: string;
    author: string;
    text: string;
    score: number;
    createdAt: string | null;
    url: string;
  }>
> {
  let url: URL;

  try {
    url = new URL(args.threadUrl);
  } catch {
    return [];
  }

  if (!/reddit\.com$/i.test(url.hostname) && !/reddit\.com$/i.test(url.hostname.replace(/^www\./, ""))) {
    return [];
  }

  url.hash = "";
  url.search = "";
  const jsonUrl = `${url.toString().replace(/\/+$/, "")}.json?sort=top&limit=${Math.max(
    1,
    Math.min(args.maxComments ?? 6, 12)
  )}`;
  const response = await fetch(jsonUrl, {
    headers: {
      "User-Agent": "MoonNewsResearch/1.0",
      Accept: "application/json",
    },
  }).catch(() => null);

  if (!response?.ok) {
    return [];
  }

  const data = (await response.json().catch(() => null)) as
    | Array<{
        data?: {
          children?: Array<{
            data?: {
              id?: string;
              author?: string;
              body?: string;
              score?: number;
              created_utc?: number;
              permalink?: string;
            };
          }>;
        };
      }>
    | null;
  const commentChildren = data?.[1]?.data?.children ?? [];

  return commentChildren
    .map((child) => {
      const comment = child.data;
      const text = comment?.body?.replace(/\s+/g, " ").trim() ?? "";
      const id = comment?.id?.trim() ?? "";
      if (!id || !text || text === "[deleted]" || text === "[removed]") {
        return null;
      }

      return {
        id,
        author: comment?.author?.trim() || "reddit_user",
        text,
        score: Number(comment?.score ?? 0),
        createdAt:
          typeof comment?.created_utc === "number"
            ? new Date(comment.created_utc * 1000).toISOString()
            : null,
        url: comment?.permalink ? `https://www.reddit.com${comment.permalink}` : args.threadUrl,
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .slice(0, args.maxComments ?? 6);
}

async function enrichSectionCommentEvidenceForRun(args: {
  runId: string;
  input: ScriptAgentRequest;
  stageKey: ScriptAgentStageKey;
  outlineStage: {
    sections: Array<{ heading: string; purpose: string; beatGoal: string }>;
  };
}) {
  const db = getDb();
  const state = await loadDiscoveryState(args.runId);
  const sources = await db
    .select()
    .from(scriptAgentSources)
    .where(eq(scriptAgentSources.runId, args.runId))
    .orderBy(desc(scriptAgentSources.createdAt));

  const stageSources = sources.filter((source) => source.stageKey === args.stageKey);
  const perSectionVideoLimit =
    args.input.researchDepth === "quick" ? 1 : args.input.researchDepth === "standard" ? 2 : 3;
  const perSectionRedditLimit = args.input.researchDepth === "quick" ? 1 : 2;
  const perSourceCommentLimit = args.input.researchDepth === "quick" ? 3 : args.input.researchDepth === "standard" ? 4 : 6;

  let youtubeCommentsInserted = 0;
  let redditCommentsInserted = 0;

  for (const section of args.outlineStage.sections) {
    const sectionSources = stageSources.filter(
      (source) => getSectionHeadingFromMetadata(source.metadataJson) === section.heading
    );
    const youtubeSources = sectionSources
      .filter((source) => source.providerName === "youtube" && Boolean(source.url))
      .slice(0, perSectionVideoLimit);
    const redditSources = sectionSources
      .filter(
        (source) =>
          source.providerName === "reddit" &&
          Boolean(source.url) &&
          source.sourceKind === "social_post"
      )
      .slice(0, perSectionRedditLimit);

    for (const source of youtubeSources) {
      const externalId =
        readStringField(asObjectRecord(source.metadataJson), "externalId") ??
        (source.url ? extractYouTubeVideoIdFromUrl(source.url) : null);
      if (!externalId) {
        continue;
      }

      const comments = await fetchYouTubeComments({
        videoId: externalId,
        maxResults: perSourceCommentLimit,
      }).catch(() => []);

      for (const comment of comments) {
        const { inserted } = await upsertScopedSourceRow({
          db,
          state,
          runId: args.runId,
          stageKey: args.stageKey,
          sourceKind: "social_post",
          providerName: "youtube",
          title: `YouTube comment on ${source.title}`,
          url: comment.url,
          snippet: trimToLength(comment.textDisplay, 260),
          publishedAt: comment.publishedAt,
          contentStatus: "complete",
          transcriptStatus: "complete",
          contentJson: {
            text: comment.textDisplay,
            author: comment.authorDisplayName,
            likeCount: comment.likeCount,
            publishedAt: comment.publishedAt,
            parentTitle: source.title,
            parentUrl: source.url,
          },
          metadataJson: buildDiscoveryMetadata({
            discoverySource: "youtube_comment",
            sectionHeading: section.heading,
            externalId: comment.commentId,
            extra: {
              socialLane: "youtube_comment",
              parentSourceId: source.id,
              parentTitle: source.title,
              parentUrl: source.url,
              commentAuthor: comment.authorDisplayName,
              likeCount: comment.likeCount,
            },
          }),
        });

        if (inserted) {
          youtubeCommentsInserted += 1;
        }
      }
    }

    for (const source of redditSources) {
      const comments = await fetchRedditThreadComments({
        threadUrl: source.url!,
        maxComments: perSourceCommentLimit,
      }).catch(() => []);

      for (const comment of comments) {
        const { inserted } = await upsertScopedSourceRow({
          db,
          state,
          runId: args.runId,
          stageKey: args.stageKey,
          sourceKind: "social_post",
          providerName: "reddit",
          title: `Reddit comment on ${source.title}`,
          url: comment.url,
          snippet: trimToLength(comment.text, 260),
          publishedAt: comment.createdAt,
          contentStatus: "complete",
          transcriptStatus: "complete",
          contentJson: {
            text: comment.text,
            author: comment.author,
            score: comment.score,
            publishedAt: comment.createdAt,
            parentTitle: source.title,
            parentUrl: source.url,
          },
          metadataJson: buildDiscoveryMetadata({
            discoverySource: "reddit_comment",
            sectionHeading: section.heading,
            externalId: comment.id,
            extra: {
              socialLane: "reddit_comment",
              parentSourceId: source.id,
              parentTitle: source.title,
              parentUrl: source.url,
              commentAuthor: comment.author,
              score: comment.score,
            },
          }),
        });

        if (inserted) {
          redditCommentsInserted += 1;
        }
      }
    }
  }

  return {
    youtubeCommentsInserted,
    redditCommentsInserted,
    totalCommentsInserted: youtubeCommentsInserted + redditCommentsInserted,
  };
}

function mergeNotes(input: ScriptAgentRequest) {
  return [input.objective, input.preferredAngle, input.notes]
    .map((value) => value.trim())
    .filter(Boolean)
    .join("\n\n");
}

async function buildPlanningArticleExpansionQueries(args: {
  storyTitle: string;
  broadResearch: InitialBroadResearch;
  broadResearchMemo: string;
}) {
  const storySearchAnchor = buildStorySearchAnchor({
    storyTitle: args.storyTitle,
    broadResearch: args.broadResearch,
    extraText: args.broadResearchMemo,
    limit: 8,
  });
  const deterministicQueries = dedupeStringList(
    [
      ...args.broadResearch.openQuestions
        .slice(0, 3)
        .map((question) => `${storySearchAnchor} ${question}`),
      ...args.broadResearch.sectionCandidates
        .slice(0, 4)
        .map((section) => `${storySearchAnchor} ${section.title}`),
      ...args.broadResearch.turningPoints
        .slice(0, 2)
        .map((turningPoint) => `${storySearchAnchor} ${turningPoint}`),
      ...args.broadResearch.runwayBeats
        .slice(0, 2)
        .map((runwayBeat) => `${storySearchAnchor} ${runwayBeat}`),
      `${storySearchAnchor} origin timeline early history`,
    ],
    8
  );

  try {
    const plannedQueries = await createOpenAiJson({
      schema: planningArticleQuerySchema,
      jsonSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          queries: {
            type: "array",
            maxItems: 6,
            items: { type: "string" },
          },
        },
        required: ["queries"],
      },
      system:
        "You plan follow-up article search queries for documentary research. Generate targeted article-focused web/news queries that recover missing named actors, operational methods, relationship turns, deterrents, and origin beats from the current research memo. Keep queries concrete and search-engine friendly.",
      user: `Story: ${args.storyTitle}
Search anchor: ${storySearchAnchor}

Broad research memo:
${trimToLength(args.broadResearchMemo, 12000)}

Return 4 to 6 article search queries that are likely to uncover:
- missing named actors
- specific operational methods
- relationship-turn details
- early origin/history beats

Avoid generic commentary queries and avoid video/social phrasing.`,
      model: getEnv().OPENAI_RESEARCH_MODEL,
      maxTokens: 700,
    });

    return dedupeStringList(
      [...deterministicQueries, ...(plannedQueries?.value.queries ?? [])],
      10
    );
  } catch (error) {
    console.error("[script-agent] Planning article query generation failed:", error);
    return deterministicQueries;
  }
}

function inferPlanningBeatCategoryFromQuote(quoteText: string): PlanningEvidenceBeat["category"] {
  const normalized = quoteText.toLowerCase();

  if (
    /(can't let|they said|deal with|warning|warned|warning you|survive|survival|what was going on|what he saw|what she saw|what they saw|banality|system|industry|town|elites|protect)/i.test(
      normalized
    )
  ) {
    return "motive_frame";
  }

  if (
    /(producer|studio|police|report|arrest|lawsuit|tape|recording|interview|podcast|press conference|academy|oscar|meeting|letter|quote)/i.test(
      normalized
    )
  ) {
    return "operational_detail";
  }

  return "operational_detail";
}

function isPlanningClipLeadUseful(title: string) {
  if (/\breaction\b/i.test(title)) {
    return false;
  }

  return /(interview|podcast|joe rogan|press conference|quote|playboy|expose|warning|warn|survival|survive|dark minds|holds back|resistance|speaks out|talks about)/i.test(
    title
  );
}

function inferPlanningBeatCategoryFromClipTitle(
  title: string
): PlanningEvidenceBeat["category"] {
  if (/(expose|warning|warn|survival|survive|dark minds|holds back|speaks out|talks about)/i.test(title)) {
    return "motive_frame";
  }

  if (/(interview|podcast|joe rogan|press conference|playboy|quote)/i.test(title)) {
    return "operational_detail";
  }

  return "escalation";
}

function isSelfReferentialPlanningClip(args: { storyTitle: string; videoTitle: string }) {
  const story = normalizePlanningBeatDetail(args.storyTitle);
  const video = normalizePlanningBeatDetail(args.videoTitle);
  return video === story || video.includes(story) || story.includes(video);
}

async function buildPlanningVideoExpansionQueries(args: {
  storyTitle: string;
  broadResearch: InitialBroadResearch;
  broadResearchMemo: string;
}) {
  const storySearchAnchor = buildStorySearchAnchor({
    storyTitle: args.storyTitle,
    broadResearch: args.broadResearch,
    extraText: args.broadResearchMemo,
    limit: 8,
  });
  const deterministicQueries = dedupeStringList(
    [
      `${storySearchAnchor} interview podcast`,
      `${storySearchAnchor} press conference quote`,
      `${storySearchAnchor} reaction commentary`,
      ...args.broadResearch.sectionCandidates
        .slice(0, 3)
        .map((section) => `${storySearchAnchor} ${section.title} interview`),
      ...args.broadResearch.openQuestions
        .slice(0, 2)
        .map((question) => `${storySearchAnchor} ${question} interview`),
    ],
    6
  );

  try {
    const plannedQueries = await createOpenAiJson({
      schema: planningArticleQuerySchema,
      jsonSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          queries: {
            type: "array",
            maxItems: 6,
            items: { type: "string" },
          },
        },
        required: ["queries"],
      },
      system:
        "You plan video, podcast, and interview search queries for documentary research. Generate targeted queries that surface direct statements, contemporaneous interviews, archival clips, podcasts, and later validation or debunking. Avoid generic explainer phrasing.",
      user: `Story: ${args.storyTitle}
Search anchor: ${storySearchAnchor}

Broad research memo:
${trimToLength(args.broadResearchMemo, 12000)}

Return 4 to 6 search queries likely to uncover:
- the subject's own direct statements
- transcript-backed interviews, podcasts, or press appearances
- contemporaneous commentary clips
- later validating, debunking, or contrast-case clips

Rules:
- Prefer names, events, institutions, quotes, and dates over vague phrasing.
- If the story seed implies someone warned, exposed, testified, or predicted something, include at least one query for the original statement and one for later validation or debunking.
- Do not rely on the exact documentary title as a phrase if a cleaner entity/event query would work better.`,
      model: getEnv().OPENAI_RESEARCH_MODEL,
      maxTokens: 700,
    });

    return dedupeStringList(
      [...deterministicQueries, ...(plannedQueries?.value.queries ?? [])],
      8
    );
  } catch (error) {
    console.error("[script-agent] Planning video query generation failed:", error);
    return deterministicQueries;
  }
}

export async function buildPlanningArticleFactMemo(args: {
  storyTitle: string;
  broadResearch: InitialBroadResearch;
}): Promise<{
  memo: string;
  beats: PlanningEvidenceBeat[];
}> {
  const broadResearchMemo = formatInitialBroadResearchMemo(args.broadResearch);
  const articleBlocks: string[] = [];
  const transcriptBlocks: string[] = [];
  const directUrls = args.broadResearch.sourceGroups
    .flatMap((group) => group.urls)
    .filter((url) => inferSourceKindFromUrl(url) === "article")
    .filter((url) => !/wikipedia\.org/i.test(url));
  const discoveredUrls: string[] = [];

  for (const query of await buildPlanningArticleExpansionQueries({
    ...args,
    broadResearchMemo,
  })) {
    try {
      const results = await searchResearchSources({
        query,
        limit: 4,
        mode: "fast",
        objective: [
          `Find article-style reporting that fills factual gaps for: ${query}.`,
          "Prioritize reputable reporting, named-actor details, origin history, turning points, and relationship-turn facts.",
          "Do not prioritize generic reaction videos for this search; article pages are the target here.",
        ].join(" "),
        maxCharsPerResult: 900,
        maxCharsTotal: 3600,
      });
      for (const result of results) {
        if (
          inferSourceKindFromUrl(result.url) === "article" &&
          !/wikipedia\.org/i.test(result.url)
        ) {
          discoveredUrls.push(result.url);
        }
      }
    } catch (error) {
      console.error("[script-agent] Supplemental planning article search failed:", error);
    }
  }

  const urls = dedupeStringList(
    [...directUrls, ...discoveredUrls].map((url) => normalizeSourceUrl(url)),
    8
  );
  const beatCandidates: Array<ReturnType<typeof makePlanningBeatRecord>> = [
    makePlanningBeatRecord({
      category: "origin",
      detail: args.broadResearch.originPremise,
      sourceTitle: "Broad research synthesis",
      priority: "high",
    }),
    ...args.broadResearch.keyFacts.map((fact) =>
      makePlanningBeatRecord({
        category: "escalation",
        detail: fact.fact,
        sourceTitle: fact.sourceLabel,
        url: fact.url ?? null,
        priority: fact.confidence === "high" ? "high" : "medium",
      })
    ),
    ...args.broadResearch.runwayBeats.map((detail) =>
      makePlanningBeatRecord({
        category: "origin",
        detail,
        sourceTitle: "Broad research runway beat",
      })
    ),
    ...args.broadResearch.turningPoints.map((detail) =>
      makePlanningBeatRecord({
        category: "escalation",
        detail,
        sourceTitle: "Broad research turning point",
        priority: "high",
      })
    ),
    ...args.broadResearch.stakeShifters.map((detail) =>
      makePlanningBeatRecord({
        category: "deterrent",
        detail,
        sourceTitle: "Broad research stake-shifter",
      })
    ),
    makePlanningBeatRecord({
      category: "resolution",
      detail: args.broadResearch.resolutionMechanism,
      sourceTitle: "Broad research resolution",
      priority: "high",
    }),
  ];

  for (const url of urls) {
    try {
      const extracted = await extractContent(url);
      if (!extracted.content || extracted.wordCount < 180) {
        continue;
      }

      const factExtract = await extractArticleFactsFromMarkdown({
        sourceUrl: url,
        title: extracted.title ?? formatSourceTitleFromUrl(url),
        siteName: extracted.siteName,
        markdown: extracted.content,
      });

      const facts = factExtract.facts;
      const formattedFacts = formatArticleFactExtract(facts, 2);
      if (formattedFacts) {
        articleBlocks.push(
          [
            `Source: ${facts.sourceTitle || extracted.title || formatSourceTitleFromUrl(url)}`,
            `URL: ${url}`,
            formattedFacts,
          ].join("\n")
        );
      }

      beatCandidates.push(
        ...facts.keyFacts.slice(0, 2).map((detail) =>
          makePlanningBeatRecord({
            category: "escalation",
            detail,
            sourceTitle: facts.sourceTitle,
            url,
            priority: "high",
          })
        ),
        ...facts.operationalDetails.slice(0, 2).map((detail) =>
          makePlanningBeatRecord({
            category: "operational_detail",
            detail,
            sourceTitle: facts.sourceTitle,
            url,
            priority: "high",
          })
        ),
        ...facts.relationshipTurns.slice(0, 2).map((detail) =>
          makePlanningBeatRecord({
            category: "relationship_turn",
            detail,
            sourceTitle: facts.sourceTitle,
            url,
            priority: "high",
          })
        ),
        ...facts.motiveFrames.slice(0, 2).map((detail) =>
          makePlanningBeatRecord({
            category: "motive_frame",
            detail,
            sourceTitle: facts.sourceTitle,
            url,
          })
        ),
        ...facts.deterrents.slice(0, 2).map((detail) =>
          makePlanningBeatRecord({
            category: "deterrent",
            detail,
            sourceTitle: facts.sourceTitle,
            url,
          })
        )
      );
    } catch (error) {
      console.error("[script-agent] Supplemental planning article fact extraction failed:", error);
    }
  }

  const videoQueries = await buildPlanningVideoExpansionQueries({
    ...args,
    broadResearchMemo,
  });
  const videoLeadCandidates = new Map<
    string,
    {
      title: string;
      url: string;
      provider: string;
      relevanceScore: number;
    }
  >();
  const transcriptCandidates = new Map<
    string,
    {
      title: string;
      url: string;
      provider: string;
      quotes: Array<{
        quoteText: string;
        startMs: number;
        relevanceScore: number;
        context: string;
      }>;
      maxScore: number;
    }
  >();

  const videoSearches = await Promise.allSettled(
    videoQueries
      .slice(0, 4)
      .map((query) =>
        searchTopic(query, {
          includeLocalTranscriptFallback: true,
          includeAiQuotes: false,
        })
      )
  );

  for (const result of videoSearches) {
    if (result.status !== "fulfilled") {
      console.error("[script-agent] Supplemental planning video search failed:", result.reason);
      continue;
    }

    const clipsByUrl = new Map(
      result.value.clips.map((clip) => [normalizeSourceUrl(clip.sourceUrl), clip] as const)
    );
    for (const clip of result.value.clips.slice(0, 4)) {
      const url = normalizeSourceUrl(clip.sourceUrl);
      if (!url || !clip.title || isSelfReferentialPlanningClip({ storyTitle: args.storyTitle, videoTitle: clip.title })) {
        continue;
      }
      const existing = videoLeadCandidates.get(url);
      if (!existing || clip.relevanceScore > existing.relevanceScore) {
        videoLeadCandidates.set(url, {
          title: clip.title,
          url,
          provider: clip.provider,
          relevanceScore: clip.relevanceScore,
        });
      }
    }

    for (const quote of result.value.quotes) {
      const url = normalizeSourceUrl(quote.sourceUrl);
      const clip = clipsByUrl.get(url);
      const title = clip?.title ?? quote.videoTitle;
      if (!url || !title || isSelfReferentialPlanningClip({ storyTitle: args.storyTitle, videoTitle: title })) {
        continue;
      }

      const existing = transcriptCandidates.get(url);
      const quoteEntry = {
        quoteText: trimToLength(quote.quoteText, 260),
        startMs: quote.startMs,
        relevanceScore: quote.relevanceScore,
        context: trimToLength(quote.context, 220),
      };

      if (!existing) {
        transcriptCandidates.set(url, {
          title,
          url,
          provider: clip?.provider ?? "video",
          quotes: [quoteEntry],
          maxScore: quote.relevanceScore,
        });
        continue;
      }

      const dedupeKey = normalizePlanningBeatDetail(quoteEntry.quoteText);
      const hasQuote = existing.quotes.some(
        (item) => normalizePlanningBeatDetail(item.quoteText) === dedupeKey
      );
      if (!hasQuote && existing.quotes.length < 2) {
        existing.quotes.push(quoteEntry);
      }
      existing.maxScore = Math.max(existing.maxScore, quote.relevanceScore);
    }
  }

  const transcriptSources = [...transcriptCandidates.values()]
    .sort((left, right) => right.maxScore - left.maxScore)
    .slice(0, 6);

  for (const source of transcriptSources) {
    transcriptBlocks.push(
      [
        `Source: ${source.title}`,
        `URL: ${source.url}`,
        `Provider: ${source.provider}`,
        ...source.quotes.map((quote) =>
          [
            `- transcript quote @ ${quote.startMs}ms (relevance ${(quote.relevanceScore * 100).toFixed(0)}%)`,
            `  "${quote.quoteText}"`,
            quote.context ? `  context: ${quote.context}` : null,
          ]
            .filter(Boolean)
            .join("\n")
        ),
      ].join("\n")
    );

    for (const quote of source.quotes) {
      beatCandidates.push(
        makePlanningBeatRecord({
          category: inferPlanningBeatCategoryFromQuote(quote.quoteText),
          detail: `Direct statement: "${quote.quoteText}"`,
          sourceTitle: source.title,
          url: source.url,
          priority: quote.relevanceScore >= 0.72 ? "high" : "medium",
        })
      );
    }
  }

  const transcriptSourceUrls = new Set(transcriptSources.map((source) => source.url));
  const videoLeadSources = [...videoLeadCandidates.values()]
    .filter((source) => !transcriptSourceUrls.has(source.url))
    .sort((left, right) => right.relevanceScore - left.relevanceScore)
    .slice(0, 4);

  for (const source of videoLeadSources) {
    transcriptBlocks.push(
      [
        `Source lead: ${source.title}`,
        `URL: ${source.url}`,
        `Provider: ${source.provider}`,
        `Signal: transcript unavailable on this host, but this clip/interview title looks relevant to the story angle.`,
      ].join("\n")
    );

    if (!isPlanningClipLeadUseful(source.title)) {
      continue;
    }

    beatCandidates.push(
      makePlanningBeatRecord({
        category: inferPlanningBeatCategoryFromClipTitle(source.title),
        detail: `Video lead: ${source.title}`,
        sourceTitle: source.title,
        url: source.url,
        priority: source.relevanceScore >= 40 ? "high" : "medium",
      })
    );
  }

  const beats = finalizePlanningBeats(beatCandidates, 12);
  const sections = [
    formatPlanningBeatPacket(beats),
    transcriptBlocks.length > 0
      ? trimToLength(
          ["Supplemental video, interview, and direct-statement leads:", ...transcriptBlocks].join(
            "\n\n"
          ),
          4500
        )
      : "",
    articleBlocks.length > 0
      ? trimToLength(
          ["Supplemental article facts from scraped reporting:", ...articleBlocks].join("\n\n"),
          7000
        )
      : "",
  ].filter(Boolean);

  return {
    memo: sections.join("\n\n"),
    beats,
  };
}

function serializeRunRecord(args: {
  run: typeof scriptAgentRuns.$inferSelect;
  stages: Array<typeof scriptAgentStages.$inferSelect>;
  sources: Array<typeof scriptAgentSources.$inferSelect>;
  quotes: Array<typeof scriptAgentQuotes.$inferSelect>;
  claims: Array<typeof scriptAgentClaims.$inferSelect>;
}): ScriptAgentRun {
  return scriptAgentRunSchema.parse({
    id: args.run.id,
    storyTitle: args.run.storyTitle,
    status: args.run.status,
    currentStage: args.run.currentStage,
    researchDepth: args.run.researchDepth,
    triggerRunId: args.run.triggerRunId,
    request: args.run.requestJson,
    result: args.run.resultJson ?? null,
    errorText: args.run.errorText,
    startedAt: serializeDate(args.run.startedAt),
    completedAt: serializeDate(args.run.completedAt),
    createdAt: args.run.createdAt.toISOString(),
    updatedAt: args.run.updatedAt.toISOString(),
    stages: args.stages.map((stage) => ({
      id: stage.id,
      stageKey: stage.stageKey,
      stageOrder: stage.stageOrder,
      status: stage.status,
      inputJson: stage.inputJson ?? null,
      outputJson: stage.outputJson ?? null,
      errorText: stage.errorText,
      startedAt: serializeDate(stage.startedAt),
      completedAt: serializeDate(stage.completedAt),
      updatedAt: stage.updatedAt.toISOString(),
    })),
    sources: args.sources.map((source) => ({
      id: source.id,
      sourceKind: source.sourceKind,
      providerName: source.providerName,
      title: source.title,
      url: source.url,
      snippet: source.snippet,
      publishedAt: source.publishedAt,
      clipId: source.clipId,
      contentStatus: source.contentStatus,
      transcriptStatus: source.transcriptStatus,
      contentJson: source.contentJson ?? null,
      metadataJson: source.metadataJson ?? null,
    })),
    quotes: args.quotes.map((quote) => ({
      id: quote.id,
      sourceId: quote.sourceId,
      sourceLabel: quote.sourceLabel,
      sourceUrl: quote.sourceUrl,
      quoteText: quote.quoteText,
      speaker: quote.speaker,
      context: quote.context,
      relevanceScore: quote.relevanceScore,
      startMs: quote.startMs,
      endMs: quote.endMs,
      metadataJson: quote.metadataJson ?? null,
    })),
    claims: args.claims.map((claim) => ({
      id: claim.id,
      claimText: claim.claimText,
      supportLevel: claim.supportLevel,
      riskLevel: claim.riskLevel,
      evidenceRefsJson: claim.evidenceRefsJson,
      notes: claim.notes,
    })),
  });
}

async function updateStage(
  runId: string,
  stageKey: ScriptAgentStageKey,
  values: Partial<typeof scriptAgentStages.$inferInsert>
) {
  const db = getDb();
  await db
    .update(scriptAgentStages)
    .set({
      ...values,
      updatedAt: new Date(),
    })
    .where(and(eq(scriptAgentStages.runId, runId), eq(scriptAgentStages.stageKey, stageKey)));
}

async function markStageRunning(runId: string, stageKey: ScriptAgentStageKey, inputJson?: unknown) {
  await updateStage(runId, stageKey, {
    status: "running",
    inputJson: inputJson ?? null,
    errorText: null,
    startedAt: new Date(),
    completedAt: null,
  });

  const db = getDb();
  await db
    .update(scriptAgentRuns)
    .set({
      status: "running",
      currentStage: stageKey,
      startedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(scriptAgentRuns.id, runId));
}

async function markStageComplete(runId: string, stageKey: ScriptAgentStageKey, outputJson?: unknown) {
  await updateStage(runId, stageKey, {
    status: "complete",
    outputJson: outputJson ?? null,
    completedAt: new Date(),
  });
}

async function markStageFailed(runId: string, stageKey: ScriptAgentStageKey, errorText: string) {
  await updateStage(runId, stageKey, {
    status: "failed",
    errorText,
    completedAt: new Date(),
  });
}

async function runStage<T>(
  runId: string,
  stageKey: ScriptAgentStageKey,
  inputJson: unknown,
  fn: () => Promise<T>
) {
  await markStageRunning(runId, stageKey, inputJson);

  try {
    const output = await fn();
    await markStageComplete(runId, stageKey, output);
    return output;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown stage error";
    await markStageFailed(runId, stageKey, message);
    throw error;
  }
}

function buildDiscoveryMetadata(args: {
  beam?: ScriptAgentResearchBeam | null;
  discoverySource: string;
  sectionHeading?: string | null;
  externalId?: string | null;
  searchProvider?: string | null;
  extra?: Record<string, unknown>;
}) {
  return {
    discoverySource: args.discoverySource,
    researchPhase: args.beam?.phase ?? null,
    beamId: args.beam?.beamId ?? null,
    beamLabel: args.beam?.label ?? null,
    beamObjective: args.beam?.objective ?? null,
    searchQuery: args.beam?.query ?? null,
    searchProvider: args.searchProvider ?? null,
    sectionHeading: args.sectionHeading ?? args.beam?.sectionHeading ?? null,
    externalId: args.externalId ?? null,
    ...(args.extra ?? {}),
  };
}

function scoreWebSearchResultForBeam(args: {
  storyTitle: string;
  beam: ScriptAgentResearchBeam;
  title: string;
  snippet?: string | null;
  url: string;
}) {
  const haystack = [args.title, args.snippet ?? "", args.url].join(" ").toLowerCase();
  const storyKeywords = dedupeStringList(extractTranscriptKeywords(args.storyTitle, 8), 8);
  const beamKeywords = dedupeStringList(extractTranscriptKeywords(args.beam.query, 10), 10);
  const sectionKeywords = args.beam.sectionHeading
    ? dedupeStringList(extractTranscriptKeywords(args.beam.sectionHeading, 6), 6)
    : [];

  const countMatches = (keywords: string[]) =>
    keywords.filter((keyword) => keyword.length > 2 && haystack.includes(keyword)).length;

  const storyMatches = countMatches(storyKeywords);
  const beamMatches = countMatches(beamKeywords);
  const sectionMatches = countMatches(sectionKeywords);
  const looksSocial =
    /(reddit|substack|x\.com|twitter|tiktok|instagram|threads|linkedin)/i.test(args.title) ||
    /(reddit\.com|x\.com|twitter\.com|tiktok\.com|instagram\.com|threads\.net|linkedin\.com)/i.test(
      args.url
    );

  let score = storyMatches * 4 + beamMatches * 2 + sectionMatches * 3;

  if (
    storyKeywords.length > 0 &&
    storyKeywords.slice(0, 2).every((keyword) => haystack.includes(keyword))
  ) {
    score += 3;
  }

  if (args.beam.searchMode === "news_web" && looksSocial) {
    score -= 5;
  }

  if (args.beam.searchMode === "social_web" && !looksSocial) {
    score -= 2;
  }

  return score;
}

async function upsertScopedSourceRow(args: {
  db: ReturnType<typeof getDb>;
  state: DiscoveryState;
  runId: string;
  stageKey: ScriptAgentStageKey;
  sourceKind: (typeof scriptAgentSources.$inferInsert)["sourceKind"];
  providerName: string;
  title: string;
  url: string | null;
  snippet?: string | null;
  publishedAt?: string | null;
  clipId?: string | null;
  contentStatus?: (typeof scriptAgentSources.$inferInsert)["contentStatus"];
  transcriptStatus?: (typeof scriptAgentSources.$inferInsert)["transcriptStatus"];
  contentJson?: unknown;
  metadataJson?: unknown;
}) {
  const sectionHeading = getSectionHeadingFromMetadata(args.metadataJson);
  const clipScopeKey = args.clipId
    ? buildSourceScopeKey(args.stageKey, sectionHeading, args.clipId)
    : null;
  const urlScopeKey = args.url
    ? buildSourceScopeKey(args.stageKey, sectionHeading, normalizeSourceUrl(args.url))
    : null;
  const existingSourceId =
    (clipScopeKey ? args.state.sourceIdByClipScopeKey.get(clipScopeKey) : null) ??
    (urlScopeKey ? args.state.sourceIdByUrlScopeKey.get(urlScopeKey) : null) ??
    null;

  if (existingSourceId) {
    return {
      sourceId: existingSourceId,
      inserted: false,
    };
  }

  const [inserted] = await args.db
    .insert(scriptAgentSources)
    .values({
      runId: args.runId,
      stageKey: args.stageKey,
      sourceKind: args.sourceKind,
      providerName: args.providerName,
      title: args.title,
      url: args.url,
      snippet: args.snippet ?? null,
      publishedAt: args.publishedAt ?? null,
      clipId: args.clipId ?? null,
      contentStatus: args.contentStatus ?? "pending",
      transcriptStatus: args.transcriptStatus ?? "pending",
      contentJson: args.contentJson ?? null,
      metadataJson: args.metadataJson ?? null,
    })
    .returning({ id: scriptAgentSources.id });

  if (clipScopeKey) {
    args.state.clipScopeKeys.add(clipScopeKey);
    args.state.sourceIdByClipScopeKey.set(clipScopeKey, inserted.id);
  }
  if (urlScopeKey) {
    args.state.urlScopeKeys.add(urlScopeKey);
    args.state.sourceIdByUrlScopeKey.set(urlScopeKey, inserted.id);
  }

  return {
    sourceId: inserted.id,
    inserted: true,
  };
}

async function insertQuoteRowIfNew(args: {
  db: ReturnType<typeof getDb>;
  state: DiscoveryState;
  row: typeof scriptAgentQuotes.$inferInsert;
  dedupeKey: string;
}) {
  if (args.state.quoteKeys.has(args.dedupeKey)) {
    return false;
  }

  await args.db.insert(scriptAgentQuotes).values(args.row);
  args.state.quoteKeys.add(args.dedupeKey);
  return true;
}

async function promoteUrlIntoRun(args: {
  db: ReturnType<typeof getDb>;
  state: DiscoveryState;
  runId: string;
  stageKey: ScriptAgentStageKey;
  url: string;
  snippet: string;
  metadataJson: Record<string, unknown>;
  title?: string | null;
  contentJson?: unknown;
}) {
  const normalizedUrl = normalizeSourceUrl(args.url);
  if (!normalizedUrl) {
    return false;
  }

  const sourceKind = inferSourceKindFromUrl(normalizedUrl);
  const providerName = inferProviderNameFromUrl(normalizedUrl);
  const title = args.title?.trim() || formatSourceTitleFromUrl(normalizedUrl);
  const externalId =
    sourceKind === "library_clip" ? extractYouTubeVideoIdFromUrl(normalizedUrl) : null;

  if (
    await isMoonVideoCandidate({
      provider: providerName,
      externalId,
      sourceUrl: normalizedUrl,
      metadataJson: args.metadataJson,
    })
  ) {
    return false;
  }

  if (sourceKind === "library_clip") {
    const videoId = externalId;
    if (!videoId) {
      return false;
    }

    const clipId = await upsertClipInLibrary({
      provider: "youtube",
      externalId: videoId,
      title,
      sourceUrl: normalizedUrl,
      previewUrl: null,
      channelOrContributor: null,
      durationMs: null,
      viewCount: 0,
      uploadDate: null,
      metadataJson: args.metadataJson,
    });

    const { inserted } = await upsertScopedSourceRow({
      db: args.db,
      state: args.state,
      runId: args.runId,
      stageKey: args.stageKey,
      sourceKind: "library_clip",
      providerName: "youtube",
      title,
      url: normalizedUrl,
      snippet: args.snippet,
      clipId,
      contentStatus: "complete",
      transcriptStatus: "pending",
      contentJson: args.contentJson ?? {
        title,
      },
      metadataJson: {
        ...args.metadataJson,
        externalId: videoId,
      },
    });

    return inserted;
  }

  const { inserted } = await upsertScopedSourceRow({
    db: args.db,
    state: args.state,
    runId: args.runId,
    stageKey: args.stageKey,
    sourceKind,
    providerName,
    title,
    url: normalizedUrl,
    snippet: args.snippet,
    contentStatus: "pending",
    transcriptStatus: "pending",
    contentJson: args.contentJson ?? null,
    metadataJson: args.metadataJson,
  });

  return inserted;
}

async function discoverSourcesForRun(
  runId: string,
  input: ScriptAgentRequest,
  options?: {
    stageKey?: ScriptAgentStageKey;
    researchPlan?: ScriptAgentResearchPlan;
  }
) {
  const db = getDb();
  const stageKey = options?.stageKey ?? "discover_sources";
  const researchPlan = options?.researchPlan ?? buildInitialResearchPlan(input);
  const beams =
    stageKey === "followup_research" ? researchPlan.sectionBeams : researchPlan.globalBeams;
  const state = await loadDiscoveryState(runId);

  let insertedSourceCount = 0;
  let insertedQuoteCount = 0;
  let promotedUrlCount = 0;
  let searchedBeamCount = 0;
  let searchedResultCount = 0;

  if (stageKey === "discover_sources") {
    const existingDossier = await db
      .select({ id: scriptAgentSources.id })
      .from(scriptAgentSources)
      .where(and(eq(scriptAgentSources.runId, runId), eq(scriptAgentSources.sourceKind, "research_dossier")))
      .limit(1)
      .then((rows) => rows[0] ?? null);

    if (!existingDossier) {
      await db.insert(scriptAgentSources).values({
        runId,
        stageKey,
        sourceKind: "research_dossier",
        providerName: "internal",
        title: "Research dossier",
        url: null,
        snippet: trimToLength(input.researchText, 500),
        contentStatus: "complete",
        transcriptStatus: "complete",
        contentJson: {
          objective: input.objective,
          preferredAngle: input.preferredAngle,
          researchText: input.researchText,
        },
      });
      insertedSourceCount += 1;
    }

    for (const rawUrl of extractUrlsFromText(input.researchText)) {
      const normalizedUrl = normalizeSourceUrl(rawUrl);
      const metadata = buildDiscoveryMetadata({
        discoverySource: "research_dossier_url",
        sectionHeading: null,
        extra: {
          promotedFrom: "research_dossier",
        },
      });

      const inserted = await promoteUrlIntoRun({
        db,
        state,
        runId,
        stageKey,
        url: normalizedUrl,
        snippet: "Promoted from research dossier",
        metadataJson: metadata,
      });

      if (inserted) {
        insertedSourceCount += 1;
        promotedUrlCount += 1;
      }
    }

    for (const seed of researchPlan.seedUrls) {
      const metadata = buildDiscoveryMetadata({
        discoverySource: "plan_seed_url",
        sectionHeading: seed.sectionHeading,
        extra: {
          seedLabel: seed.label,
          seedReason: seed.reason,
          promotedFrom: "broad_research_source_group",
        },
      });

      const inserted = await promoteUrlIntoRun({
        db,
        state,
        runId,
        stageKey,
        url: seed.url,
        title: seed.label,
        snippet: `Promoted from AI research seed: ${seed.reason}`,
        contentJson: {
          seedLabel: seed.label,
          seedReason: seed.reason,
        },
        metadataJson: metadata,
      });

      if (inserted) {
        insertedSourceCount += 1;
        promotedUrlCount += 1;
      }
    }
  }

  for (const beam of beams) {
    searchedBeamCount += 1;

    if (beam.searchMode === "video_topic") {
      const topicResult = await searchTopic(beam.query, {
        includeAiQuotes: false,
      }).catch(() => null);
      if (!topicResult) {
        continue;
      }

      const clipLimit = getBeamResultLimit(input.researchDepth, beam);
      const selectedClips = topicResult.clips.slice(0, clipLimit);
      searchedResultCount += selectedClips.length;

      for (const clip of selectedClips) {
        if (
          await isMoonVideoCandidate({
            provider: clip.provider,
            externalId: clip.externalId,
            sourceUrl: clip.sourceUrl,
            channelOrContributor: clip.channelOrContributor,
          })
        ) {
          continue;
        }

        const sourceKind =
          clip.provider === "youtube"
            ? "library_clip"
            : clip.provider === "twitter"
              ? "social_post"
              : "video";
        const metadata = buildDiscoveryMetadata({
          beam,
          discoverySource: "topic_search",
          sectionHeading: beam.sectionHeading,
          externalId: clip.externalId,
          extra: {
            provider: clip.provider,
            relevanceScore: clip.relevanceScore,
            channelOrContributor: clip.channelOrContributor,
            previewUrl: clip.previewUrl,
            viewCount: clip.viewCount,
            uploadDate: clip.uploadDate,
          },
        });

        const { inserted } = await upsertScopedSourceRow({
          db,
          state,
          runId,
          stageKey,
          sourceKind,
          providerName: clip.provider,
          title: clip.title,
          url: clip.sourceUrl,
          snippet: clip.channelOrContributor,
          publishedAt: clip.uploadDate,
          clipId: clip.clipId,
          contentStatus: sourceKind === "library_clip" ? "complete" : "pending",
          transcriptStatus: clip.provider === "youtube" ? "pending" : "pending",
          contentJson:
            sourceKind === "library_clip"
              ? {
                  title: clip.title,
                  description: clip.channelOrContributor,
                }
              : {
                  title: clip.title,
                  text: clip.title,
                  description: clip.channelOrContributor,
                },
          metadataJson: metadata,
        });

        if (inserted) {
          insertedSourceCount += 1;
        }
      }

      for (const quote of topicResult.quotes.slice(0, clipLimit * 2)) {
        const clip = topicResult.clips.find((item) => item.externalId === quote.videoId);
        const quoteText = normalizeTranscriptQuoteText(quote.quoteText);
        if (!clip || !isUsableTranscriptQuoteText(quoteText)) {
          continue;
        }

        const sourceId =
          state.sourceIdByClipScopeKey.get(
            buildSourceScopeKey(stageKey, beam.sectionHeading, clip.clipId)
          ) ?? null;
        const dedupeKey = buildTranscriptQuoteKey(quote.videoId, quote.startMs, quoteText);
        const inserted = await insertQuoteRowIfNew({
          db,
          state,
          dedupeKey,
          row: {
            runId,
            sourceId,
            sourceLabel: quote.videoTitle,
            sourceUrl: clip.sourceUrl,
            quoteText,
            speaker: quote.speaker,
            context: quote.context,
            relevanceScore: quote.relevanceScore,
            startMs: quote.startMs,
            endMs: quote.startMs + 10000,
            metadataJson: {
              ...buildDiscoveryMetadata({
                beam,
                discoverySource: "topic_search_quote",
                sectionHeading: beam.sectionHeading,
                externalId: quote.videoId,
              }),
              sourceType: "clip_transcript",
              provider: "youtube",
            },
          },
        });

        if (inserted) {
          insertedQuoteCount += 1;
        }
      }

      continue;
    }

    const newsResults = await searchNewsStory(
      beam.query,
      beam.phase === "section_followup" ? "full" : mapResearchDepthToSearchMode(input.researchDepth)
    ).catch(() => []);
    const scoredResults = newsResults
      .map((result) => ({
        result,
        relevanceScore: scoreWebSearchResultForBeam({
          storyTitle: input.storyTitle,
          beam,
          title: result.title ?? "",
          snippet: result.snippet,
          url: result.url,
        }),
      }))
      .filter((candidate) => candidate.relevanceScore >= (beam.searchMode === "social_web" ? 2 : 3))
      .sort((left, right) => right.relevanceScore - left.relevanceScore)
      .map((candidate) => candidate.result);
    const limitedResults = scoredResults.slice(0, getBeamResultLimit(input.researchDepth, beam));
    searchedResultCount += limitedResults.length;

    for (const result of limitedResults) {
      const normalizedUrl = normalizeSourceUrl(result.url);
      const externalId = extractYouTubeVideoIdFromUrl(normalizedUrl);
      if (
        await isMoonVideoCandidate({
          provider: inferProviderNameFromUrl(normalizedUrl) || result.source,
          externalId,
          sourceUrl: normalizedUrl,
        })
      ) {
        continue;
      }
      const inferredKind = inferSourceKindFromUrl(normalizedUrl);
      const sourceKind =
        result.source === "reddit" && inferredKind !== "library_clip"
          ? "social_post"
          : inferredKind;
      const providerName = inferProviderNameFromUrl(normalizedUrl) || result.source;
      const metadata = buildDiscoveryMetadata({
        beam,
        discoverySource: "web_search",
        sectionHeading: beam.sectionHeading,
        searchProvider: result.source,
        extra: {
          snippet: result.snippet,
          publishedAt: result.publishedAt,
        },
      });

      if (sourceKind === "library_clip") {
        const videoId = extractYouTubeVideoIdFromUrl(normalizedUrl);
        if (!videoId) {
          continue;
        }

        const clipId = await upsertClipInLibrary({
          provider: "youtube",
          externalId: videoId,
          title: result.title || formatSourceTitleFromUrl(normalizedUrl),
          sourceUrl: normalizedUrl,
          previewUrl: null,
          channelOrContributor: null,
          durationMs: null,
          viewCount: 0,
          uploadDate: result.publishedAt,
          metadataJson: metadata,
        });

        const { inserted } = await upsertScopedSourceRow({
          db,
          state,
          runId,
          stageKey,
          sourceKind: "library_clip",
          providerName: "youtube",
          title: result.title || formatSourceTitleFromUrl(normalizedUrl),
          url: normalizedUrl,
          snippet: result.snippet,
          publishedAt: result.publishedAt,
          clipId,
          contentStatus: "complete",
          transcriptStatus: "pending",
          contentJson: {
            title: result.title || formatSourceTitleFromUrl(normalizedUrl),
            description: result.snippet,
          },
          metadataJson: {
            ...metadata,
            externalId: videoId,
          },
        });

        if (inserted) {
          insertedSourceCount += 1;
        }

        continue;
      }

      const { inserted } = await upsertScopedSourceRow({
        db,
        state,
        runId,
        stageKey,
        sourceKind,
        providerName,
        title: result.title || formatSourceTitleFromUrl(normalizedUrl),
        url: normalizedUrl,
        snippet: result.snippet,
        publishedAt: result.publishedAt,
        contentStatus: "pending",
        transcriptStatus: "pending",
        contentJson:
          sourceKind === "social_post" || sourceKind === "video"
            ? {
                title: result.title || formatSourceTitleFromUrl(normalizedUrl),
                text: result.snippet || result.title,
                description: result.snippet || null,
                publishedAt: result.publishedAt,
                siteName: providerName,
              }
            : null,
        metadataJson: metadata,
      });

      if (inserted) {
        insertedSourceCount += 1;
      }
    }
  }

  return {
    planSummary: researchPlan.summary,
    beamCount: beams.length,
    searchedBeamCount,
    searchedResultCount,
    insertedSourceCount,
    insertedQuoteCount,
    promotedUrlCount,
  };
}

async function ingestSourcesForRun(
  runId: string,
  input: ScriptAgentRequest,
  options?: {
    stageKey?: ScriptAgentStageKey;
  }
) {
  const db = getDb();
  const sources = await db
    .select()
    .from(scriptAgentSources)
    .where(eq(scriptAgentSources.runId, runId))
    .orderBy(desc(scriptAgentSources.createdAt));

  const relevantSources = options?.stageKey
    ? sources.filter((source) => source.stageKey === options.stageKey)
    : sources;
  const documentLimit =
    input.researchDepth === "quick" ? 8 : input.researchDepth === "standard" ? 16 : 24;
  const articleFactLimit =
    input.researchDepth === "quick" ? 4 : input.researchDepth === "standard" ? 8 : 12;
  const documentSources = relevantSources
    .filter(
      (source) =>
        Boolean(source.url) &&
        (source.sourceKind === "article" ||
          source.sourceKind === "social_post" ||
          source.sourceKind === "video") &&
        source.contentStatus !== "complete"
    )
    .slice(0, documentLimit);

  let processedDocumentCount = 0;
  let completedDocumentCount = 0;
  let articleFactProcessed = 0;
  let articleFactCompleted = 0;

  for (const source of documentSources) {
    let clipId = source.clipId;
    let transcriptStatus = source.transcriptStatus;
    let localMediaDescription: string | null = null;
    let localTranscriptText: string | null = null;
    let localMediaMetadata: Record<string, unknown> | null = null;

    if (
      shouldAttemptLocalMediaIngest({
        sourceKind: source.sourceKind,
        providerName: source.providerName,
        url: source.url,
      })
    ) {
      const localMedia = await ingestLocalMediaArtifacts({
        sourceUrl: source.url!,
        providerName: source.providerName,
        title: source.title,
      }).catch(() => null);

      if (localMedia) {
        clipId = await upsertClipInLibrary({
          provider: localMedia.clipProvider,
          externalId: localMedia.externalId,
          title: localMedia.title,
          sourceUrl: localMedia.pageUrl,
          previewUrl: localMedia.previewUrl,
          channelOrContributor: localMedia.channelOrContributor,
          durationMs: localMedia.durationMs,
          viewCount: localMedia.viewCount,
          uploadDate: localMedia.uploadDate,
          metadataJson: {
            ...localMedia.metadataJson,
            sourceProviderName: localMedia.providerName,
          },
        });

        localMediaDescription = localMedia.description;
        localTranscriptText = localMedia.transcriptText || null;
        localMediaMetadata = {
          ...localMedia.metadataJson,
          clipProvider: localMedia.clipProvider,
          externalId: localMedia.externalId,
          sourceProviderName: localMedia.providerName,
        };

        if (localMedia.transcript.length > 0) {
          await cacheTranscriptSegments(clipId, localMedia.transcript);
          transcriptStatus = "complete";
        } else {
          transcriptStatus = "failed";
        }
      }
    }

    const extracted =
      isLikelyDirectMediaUrl(source.url!) || Boolean(localMediaMetadata)
        ? {
            title: null,
            content: "",
            author: null,
            publishedAt: null,
            siteName: null,
            wordCount: 0,
          }
        : await extractContent(source.url!).catch(() => ({
            title: null,
            content: "",
            author: null,
            publishedAt: null,
            siteName: null,
            wordCount: 0,
          }));
    const existingText = extractSourceContentText(source);
    const hasFreshContent = Boolean(extracted.content);
    const contentBase = hasFreshContent
      ? {
          ...(asObjectRecord(source.contentJson) ?? {}),
          ...extracted,
        }
      : {
          ...(asObjectRecord(source.contentJson) ?? {}),
          title: source.title,
          content:
            readStringField(asObjectRecord(source.contentJson), "content") ??
            source.snippet ??
            "",
          siteName: source.providerName,
          publishedAt: source.publishedAt,
        };
    let articleFactExtract = readArticleFactExtract(source.contentJson);
    let articleFactExtractModel =
      readStringField(asObjectRecord(source.contentJson), "articleFactExtractModel") ?? null;

    if (
      !articleFactExtract &&
      articleFactProcessed < articleFactLimit &&
      source.sourceKind === "article"
    ) {
      const articleMarkdown =
        readStringField(asObjectRecord(contentBase), "content", "markdown", "text") ?? "";

      if (articleMarkdown.trim().length >= 1200) {
        articleFactProcessed += 1;

        try {
          const extractedFacts = await extractArticleFactsFromMarkdown({
            sourceUrl: source.url!,
            title: extracted.title ?? source.title,
            siteName: extracted.siteName ?? source.providerName,
            markdown: articleMarkdown,
          });
          articleFactExtract = extractedFacts.facts;
          articleFactExtractModel = extractedFacts.model;
          articleFactCompleted += 1;
        } catch (error) {
          console.error("[script-agent] Article fact extraction failed:", error);
        }
      }
    }

    let nextContentJson: Record<string, unknown> =
      localMediaMetadata || localMediaDescription || localTranscriptText
        ? {
            ...contentBase,
            title: source.title,
            description:
              localMediaDescription ??
              readStringField(asObjectRecord(contentBase), "description") ??
              source.snippet ??
              null,
            text:
              readStringField(asObjectRecord(contentBase), "text") ??
              localMediaDescription ??
              source.snippet ??
              source.title,
            transcript:
              localTranscriptText
                ? trimToLength(localTranscriptText, 12000)
                : readStringField(asObjectRecord(contentBase), "transcript"),
            fullText:
              localTranscriptText
                ? trimToLength(localTranscriptText, 16000)
                : readStringField(asObjectRecord(contentBase), "fullText"),
            localMedia: localMediaMetadata,
          }
        : { ...contentBase };

    if (articleFactExtract) {
      nextContentJson = {
        ...nextContentJson,
        articleFactExtract,
        articleFactExtractModel,
        articleFactExtractedAt: new Date().toISOString(),
      };
    }
    const status =
      hasFreshContent || existingText || Boolean(localMediaDescription) || Boolean(localTranscriptText)
        ? "complete"
        : "failed";
    const nextMetadataJson =
      localMediaMetadata && asObjectRecord(source.metadataJson)
        ? {
            ...asObjectRecord(source.metadataJson),
            ...localMediaMetadata,
          }
        : localMediaMetadata
          ? localMediaMetadata
          : source.metadataJson;

    await db
      .update(scriptAgentSources)
      .set({
        providerName:
          typeof localMediaMetadata?.sourceProviderName === "string"
            ? localMediaMetadata.sourceProviderName
            : source.providerName,
        contentStatus: status,
        contentJson: nextContentJson,
        clipId,
        transcriptStatus,
        metadataJson: nextMetadataJson,
        updatedAt: new Date(),
      })
      .where(eq(scriptAgentSources.id, source.id));

    processedDocumentCount += 1;
    if (status === "complete") {
      completedDocumentCount += 1;
    }
  }

  const refreshedSources = await db
    .select()
    .from(scriptAgentSources)
    .where(eq(scriptAgentSources.runId, runId))
    .orderBy(desc(scriptAgentSources.createdAt));
  const refreshedRelevantSources = options?.stageKey
    ? refreshedSources.filter((source) => source.stageKey === options.stageKey)
    : refreshedSources;
  const transcriptSources = refreshedRelevantSources.filter((source) => source.clipId);
  let transcriptChecks = 0;
  let transcriptCompleted = 0;

  for (const source of transcriptSources) {
    const metadata = asObjectRecord(source.metadataJson);
    const externalId = readStringField(metadata, "externalId");
    let hasTranscript = false;

    if (source.providerName === "youtube" && source.clipId && externalId) {
      let segments = await ensureYouTubeTranscript(source.clipId, externalId).catch(() => null);
      if (!segments?.length && source.url) {
        const localMedia = await ingestLocalMediaArtifacts({
          sourceUrl: source.url,
          providerName: "youtube",
          title: source.title,
        }).catch(() => null);

        if (localMedia?.transcript?.length) {
          segments = await cacheTranscriptSegments(source.clipId, localMedia.transcript);

          const nextContentJson = {
            ...(asObjectRecord(source.contentJson) ?? {}),
            transcript: trimToLength(localMedia.transcriptText, 12000),
            fullText: trimToLength(localMedia.transcriptText, 16000),
            localMedia: {
              ...localMedia.metadataJson,
              clipProvider: localMedia.clipProvider,
              externalId: localMedia.externalId,
              sourceProviderName: localMedia.providerName,
            },
          };

          await db
            .update(scriptAgentSources)
            .set({
              contentJson: nextContentJson,
              metadataJson: {
                ...(asObjectRecord(source.metadataJson) ?? {}),
                ...localMedia.metadataJson,
                clipProvider: localMedia.clipProvider,
                externalId: localMedia.externalId,
                sourceProviderName: localMedia.providerName,
              },
              updatedAt: new Date(),
            })
            .where(eq(scriptAgentSources.id, source.id));
        }
      }
      hasTranscript = Boolean(segments?.length);
    } else if (source.clipId) {
      hasTranscript = await db
        .select({ clipId: transcriptCache.clipId })
        .from(transcriptCache)
        .where(and(eq(transcriptCache.clipId, source.clipId), eq(transcriptCache.language, "en")))
        .limit(1)
        .then((rows) => rows.length > 0);
    }

    await db
      .update(scriptAgentSources)
      .set({
        transcriptStatus: hasTranscript ? "complete" : source.providerName === "youtube" ? "failed" : "pending",
        updatedAt: new Date(),
      })
      .where(eq(scriptAgentSources.id, source.id));

    transcriptChecks += 1;
    if (hasTranscript) {
      transcriptCompleted += 1;
    }
  }

  return {
    stageKey: options?.stageKey ?? null,
    processedDocumentCount,
    completedDocumentCount,
    articleFactProcessed,
    articleFactCompleted,
    transcriptChecks,
    transcriptCompleted,
  };
}

async function extractEvidenceForRun(
  runId: string,
  input: ScriptAgentRequest,
  options?: {
    stageKey?: ScriptAgentStageKey;
    includeDossierQuotes?: boolean;
  }
) {
  const db = getDb();
  const state = await loadDiscoveryState(runId);
  const sources = await db
    .select()
    .from(scriptAgentSources)
    .where(eq(scriptAgentSources.runId, runId))
    .orderBy(desc(scriptAgentSources.createdAt));

  const relevantSources = options?.stageKey
    ? sources.filter((source) => source.stageKey === options.stageKey)
    : sources;

  let addedResearchQuotes = 0;
  let addedDocumentQuotes = 0;
  let addedTranscriptQuotes = 0;

  if (options?.includeDossierQuotes !== false) {
    const researchQuotes = extractDirectQuotes(input.researchText);
    if (researchQuotes.length > 0) {
      const dossierSource = await db
        .select()
        .from(scriptAgentSources)
        .where(and(eq(scriptAgentSources.runId, runId), eq(scriptAgentSources.sourceKind, "research_dossier")))
        .limit(1)
        .then((rows) => rows[0] ?? null);

      for (const quote of researchQuotes) {
        const inserted = await insertQuoteRowIfNew({
          db,
          state,
          dedupeKey: quote.quoteText.trim().toLowerCase(),
          row: {
            runId,
            sourceId: dossierSource?.id ?? null,
            sourceLabel: "Research dossier",
            sourceUrl: null,
            quoteText: quote.quoteText,
            speaker: null,
            context: quote.context,
            relevanceScore: 60,
            startMs: null,
            endMs: null,
            metadataJson: {
              sourceType: "research_text",
            },
          },
        });

        if (inserted) {
          addedResearchQuotes += 1;
        }
      }
    }
  }

  const documentSources = relevantSources.filter(
    (source) =>
      source.sourceKind !== "research_dossier" &&
      source.sourceKind !== "library_clip" &&
      source.sourceKind !== "generated_note"
  );

  for (const source of documentSources) {
    const sourceText = extractSourceContentText(source);
    if (!sourceText) {
      continue;
    }

    const sectionHeading = getSectionHeadingFromMetadata(source.metadataJson);
    const directQuotes = extractDirectQuotes(sourceText).slice(
      0,
      source.sourceKind === "article" ? 4 : 2
    );
    const literalQuoteText =
      directQuotes.length === 0
        ? deriveLiteralEvidenceQuote(
            readStringField(asObjectRecord(source.contentJson), "text", "description") ??
              readStringField(asObjectRecord(source.metadataJson), "text", "videoDescription") ??
              source.snippet ??
              sourceText
          )
        : null;
    const quoteCandidates =
      directQuotes.length > 0
        ? directQuotes.map((quote) => ({
            quoteText: quote.quoteText,
            context: quote.context,
          }))
        : literalQuoteText
          ? [
              {
                quoteText: literalQuoteText,
                context: `Direct text from ${source.title}`,
              },
            ]
          : [];

    for (const quote of quoteCandidates) {
      const inserted = await insertQuoteRowIfNew({
        db,
        state,
        dedupeKey: quote.quoteText.trim().toLowerCase(),
        row: {
          runId,
          sourceId: source.id,
          sourceLabel: source.title,
          sourceUrl: source.url,
          quoteText: quote.quoteText,
          speaker: null,
          context: quote.context,
          relevanceScore: source.sourceKind === "article" ? 68 : 72,
          startMs: null,
          endMs: null,
          metadataJson: {
            sourceType: source.sourceKind,
            sectionHeading,
            provider: source.providerName,
          },
        },
      });

      if (inserted) {
        addedDocumentQuotes += 1;
      }
    }
  }

  const transcriptClipSources = relevantSources
    .filter((source) => source.clipId && source.transcriptStatus === "complete")
    .slice(0, getTranscriptMiningLimit(input.researchDepth, options?.stageKey));
  const transcriptClipIds = transcriptClipSources
    .map((source) => source.clipId)
    .filter((clipId): clipId is string => Boolean(clipId));
  const transcriptRows = transcriptClipIds.length
    ? await db
        .select({
          clipId: transcriptCache.clipId,
          segmentsJson: transcriptCache.segmentsJson,
        })
        .from(transcriptCache)
        .where(and(inArray(transcriptCache.clipId, transcriptClipIds), eq(transcriptCache.language, "en")))
    : [];
  const transcriptByClipId = new Map<
    string,
    Array<{ text: string; startMs: number; durationMs: number }>
  >();

  for (const row of transcriptRows) {
    if (Array.isArray(row.segmentsJson)) {
      transcriptByClipId.set(
        row.clipId,
        row.segmentsJson as Array<{ text: string; startMs: number; durationMs: number }>
      );
    }
  }

  for (const source of transcriptClipSources) {
    const transcript = source.clipId ? transcriptByClipId.get(source.clipId) : null;
    if (!transcript?.length) {
      continue;
    }

    const metadata = asObjectRecord(source.metadataJson);
    const externalId = readStringField(metadata, "externalId") ?? source.url ?? source.clipId!;
    const sectionHeading = getSectionHeadingFromMetadata(source.metadataJson);
    const scriptContext = trimToLength(
      [input.storyTitle, mergeNotes(input), sectionHeading].filter(Boolean).join("\n\n"),
      2400
    );

    let extractedQuotes: Array<{
      quoteText: string;
      speaker: string | null;
      startMs: number;
      endMs: number;
      relevanceScore: number;
      context: string;
    }> = [];

    try {
      const aiQuotes = await findRelevantQuotes({
        lineText: [input.storyTitle, sectionHeading].filter(Boolean).join(" "),
        scriptContext,
        transcript,
        videoTitle: source.title,
        maxQuotes: options?.stageKey === "followup_research" ? 2 : 1,
      });

      extractedQuotes = aiQuotes
        .map((quote) => ({
          quoteText: quote.quoteText,
          speaker: quote.speaker,
          startMs: quote.startMs,
          endMs: quote.startMs + 10000,
          relevanceScore: quote.relevanceScore,
          context: quote.context,
        }))
        .filter((quote) => isUsableTranscriptQuoteText(normalizeTranscriptQuoteText(quote.quoteText)));
    } catch {
      // Best effort below.
    }

    if (extractedQuotes.length === 0) {
      extractedQuotes = extractFallbackTranscriptQuotes({
        input,
        transcript,
        videoTitle: source.title,
        maxQuotes: options?.stageKey === "followup_research" ? 2 : 1,
      });
    }

    for (const quote of extractedQuotes) {
      const quoteText = normalizeTranscriptQuoteText(quote.quoteText);
      if (!isUsableTranscriptQuoteText(quoteText)) {
        continue;
      }

      const inserted = await insertQuoteRowIfNew({
        db,
        state,
        dedupeKey: buildTranscriptQuoteKey(externalId, quote.startMs, quoteText),
        row: {
          runId,
          sourceId: source.id,
          sourceLabel: source.title,
          sourceUrl: source.url,
          quoteText,
          speaker: quote.speaker,
          context: quote.context || `Transcript-backed quote from ${source.title}`,
          relevanceScore: quote.relevanceScore,
          startMs: quote.startMs,
          endMs: quote.endMs,
          metadataJson: {
            sourceType: "clip_transcript",
            provider: source.providerName,
            externalId,
            sectionHeading,
            discoverySource:
              readStringField(metadata, "discoverySource") ?? "transcript_mining",
          },
        },
      });

      if (inserted) {
        addedTranscriptQuotes += 1;
      }
    }
  }

  const totalQuotes = await db
    .select()
    .from(scriptAgentQuotes)
    .where(eq(scriptAgentQuotes.runId, runId))
    .then((rows) => rows.length);

  return {
    stageKey: options?.stageKey ?? null,
    addedResearchQuotes,
    addedDocumentQuotes,
    addedTranscriptQuotes,
    totalQuotes,
  };
}

async function prepareScriptContextForRun(runId: string, input: ScriptAgentRequest) {
  const db = getDb();
  const [sourceRows, quoteRows, planStage] = await Promise.all([
    db
      .select()
      .from(scriptAgentSources)
      .where(eq(scriptAgentSources.runId, runId))
      .orderBy(desc(scriptAgentSources.createdAt)),
    db
      .select()
      .from(scriptAgentQuotes)
      .where(eq(scriptAgentQuotes.runId, runId))
      .orderBy(desc(scriptAgentQuotes.relevanceScore)),
    db
      .select({ outputJson: scriptAgentStages.outputJson })
      .from(scriptAgentStages)
      .where(and(eq(scriptAgentStages.runId, runId), eq(scriptAgentStages.stageKey, "plan_research")))
      .limit(1)
      .then((rows) => rows[0] ?? null),
  ]);

  const compiledResearchText = buildCompiledResearchText({
    input,
    documentSources: sourceRows
      .filter(
        (source) =>
          source.sourceKind !== "research_dossier" &&
          source.sourceKind !== "generated_note" &&
          Boolean(extractSourceContentText(source))
      )
      .map((source) => ({
        sourceKind: source.sourceKind,
        providerName: source.providerName,
        title: source.title,
        url: source.url,
        snippet: source.snippet,
        metadataJson: source.metadataJson,
        contentJson: source.contentJson,
      })),
    quoteRows: quoteRows.map((quote) => ({
      sourceLabel: quote.sourceLabel,
      sourceUrl: quote.sourceUrl,
      quoteText: quote.quoteText,
      speaker: quote.speaker,
      context: quote.context,
    })),
  });

  const enrichedInput: ScriptAgentRequest = {
    ...input,
    notes: trimToLength(
      [mergeNotes(input), buildPlanningNotes(readPlanResearchStageOutput(planStage?.outputJson ?? null))]
        .filter(Boolean)
        .join("\n\n"),
      3900
    ),
    researchText: compiledResearchText,
  };

  const context = await prepareScriptLabPipelineContext(enrichedInput);
  const quoteEvidence = mapQuoteRowsToEvidence(
    quoteRows.map((quote) => ({
      sourceLabel: quote.sourceLabel,
      sourceUrl: quote.sourceUrl,
      quoteText: quote.quoteText,
      speaker: quote.speaker,
      context: quote.context,
      relevanceScore: quote.relevanceScore,
      startMs: quote.startMs,
      endMs: quote.endMs,
      metadataJson: quote.metadataJson,
    }))
  );

  return {
    context,
    sourceRows,
    quoteRows,
    quoteEvidence,
    compiledResearchText,
  };
}

async function persistResearchClaims(runId: string, researchStage: {
  keyClaims: string[];
  riskyClaims: string[];
  quoteEvidence: Array<{ sourceTitle: string }>;
}) {
  const db = getDb();
  await db.delete(scriptAgentClaims).where(eq(scriptAgentClaims.runId, runId));
  if (researchStage.keyClaims.length) {
    const evidenceRefs = researchStage.quoteEvidence
      .slice(0, 4)
      .map((quote) => quote.sourceTitle);

    await db.insert(scriptAgentClaims).values(
      researchStage.keyClaims.map((claimText) => ({
        runId,
        claimText,
        supportLevel: 75,
        riskLevel: researchStage.riskyClaims.includes(claimText) ? 75 : 20,
        evidenceRefsJson: evidenceRefs,
        notes: researchStage.riskyClaims.includes(claimText)
          ? "Flagged during research synthesis as a risky or high-context claim."
          : null,
      }))
    );
  }
}

export async function generatePlanResearchStageOutput(
  input: ScriptAgentRequest
): Promise<PlanResearchStageOutput> {
  const broadResearchStage = await generateInitialBroadResearchStage(input);
  const parallelDeepResearch = await runDeepResearchMemo({
    query: input.storyTitle,
    briefText: mergeNotes(input) || null,
    timeoutSeconds: input.researchDepth === "quick" ? 180 : input.researchDepth === "standard" ? 300 : 420,
  }).catch((error) => {
    console.error("[script-agent] Parallel deep research memo failed:", error);
    return null;
  });
  const supplementalPlanningSupport = await buildPlanningArticleFactMemo({
    storyTitle: input.storyTitle,
    broadResearch: broadResearchStage.broadResearch,
  });
  const broadResearchMemo = trimToLength(
    [
      broadResearchStage.broadResearchMemo,
      parallelDeepResearch?.content
        ? `Parallel deep research memo:\n${trimToLength(parallelDeepResearch.content, 10000)}`
        : null,
      supplementalPlanningSupport.memo,
    ]
      .filter(Boolean)
      .join("\n\n"),
    18000
  );
  const researchStrategyStage = await generateResearchStrategyStage({
    input,
    broadResearchMemo,
    planningBeats: supplementalPlanningSupport.beats,
  });
  const sectionQueryPlanningStage = await generateSectionQueryPlanningStage({
    input,
    broadResearchMemo,
    planningContext: researchStrategyStage.planningContext,
    researchStrategy: researchStrategyStage.researchStrategy,
    planningBeats: supplementalPlanningSupport.beats,
  });
  const researchPlan = buildInitialResearchPlan(
    input,
    researchStrategyStage.researchStrategy,
    broadResearchStage.broadResearch,
    sectionQueryPlanningStage.sectionQueryPlanning
  );

  return {
    planningMode:
      broadResearchStage.provider === "perplexity"
        ? "perplexity_then_claude"
        : "web_fallback_then_claude",
    broadResearchProvider: broadResearchStage.provider,
    broadResearchModel: broadResearchStage.modelUsed,
    broadResearch: broadResearchStage.broadResearch,
    broadResearchMemo,
    parallelDeepResearch: parallelDeepResearch
      ? {
          runId: parallelDeepResearch.runId,
          processor: parallelDeepResearch.processor,
          status: parallelDeepResearch.status,
          content: parallelDeepResearch.content,
        }
      : null,
    planningBeats: supplementalPlanningSupport.beats,
    researchStrategyModel: researchStrategyStage.modelUsed,
    researchStrategy: researchStrategyStage.researchStrategy,
    sectionQueryPlanningModel: sectionQueryPlanningStage.modelUsed,
    sectionQueryPlanning: sectionQueryPlanningStage.sectionQueryPlanning,
    researchPlan,
  };
}

export async function createScriptAgentRun(input: ScriptAgentRequest) {
  const db = getDb();
  const [run] = await db
    .insert(scriptAgentRuns)
    .values({
      storyTitle: input.storyTitle,
      status: "pending",
      researchDepth: input.researchDepth,
      requestJson: input,
    })
    .returning();

  await db.insert(scriptAgentStages).values(
    SCRIPT_AGENT_STAGE_ORDER.map((stageKey, index): typeof scriptAgentStages.$inferInsert => ({
      runId: run.id,
      stageKey,
      stageOrder: index + 1,
      status: "pending",
    }))
  );

  return run;
}

async function runSectionResearchStageForRun(args: {
  runId: string;
  input: ScriptAgentRequest;
  outlineStage: Awaited<ReturnType<typeof generateOutlineStage>>;
  researchStage: { thesis: string; keyClaims: string[] };
  researchStrategy?: ResearchStrategy | null;
}) {
  const sectionResearchPlan = buildSectionFollowupResearchPlan({
    input: args.input,
    researchStage: args.researchStage,
    outlineStage: args.outlineStage,
    researchStrategy: args.researchStrategy,
  });

  const followupResearchStage = await runStage(
    args.runId,
    "followup_research",
    {
      sectionCount: args.outlineStage.sections.length,
      beamCount: sectionResearchPlan.sectionBeams.length,
    },
    async () => {
      if (sectionResearchPlan.sectionBeams.length === 0) {
        return {
          planSummary: sectionResearchPlan.summary,
          beamCount: 0,
          searchedBeamCount: 0,
          searchedResultCount: 0,
          insertedSourceCount: 0,
          insertedQuoteCount: 0,
          promotedUrlCount: 0,
          processedDocumentCount: 0,
          completedDocumentCount: 0,
          transcriptChecks: 0,
          transcriptCompleted: 0,
          addedResearchQuotes: 0,
          addedDocumentQuotes: 0,
          addedTranscriptQuotes: 0,
          totalQuotes: 0,
          youtubeCommentsInserted: 0,
          redditCommentsInserted: 0,
          generatedNoteCount: 0,
          sectionPackages: [],
        };
      }

      const discovered = await discoverSourcesForRun(args.runId, args.input, {
        stageKey: "followup_research",
        researchPlan: sectionResearchPlan,
      });
      const ingested = await ingestSourcesForRun(args.runId, args.input, {
        stageKey: "followup_research",
      });
      const commentEnrichment = await enrichSectionCommentEvidenceForRun({
        runId: args.runId,
        input: args.input,
        stageKey: "followup_research",
        outlineStage: args.outlineStage,
      });
      const extracted = await extractEvidenceForRun(args.runId, args.input, {
        stageKey: "followup_research",
        includeDossierQuotes: false,
      });

      const db = getDb();
      const [sourceRows, quoteRows] = await Promise.all([
        db
          .select()
          .from(scriptAgentSources)
          .where(eq(scriptAgentSources.runId, args.runId))
          .orderBy(desc(scriptAgentSources.createdAt)),
        db
          .select()
          .from(scriptAgentQuotes)
          .where(eq(scriptAgentQuotes.runId, args.runId))
          .orderBy(desc(scriptAgentQuotes.relevanceScore), desc(scriptAgentQuotes.createdAt)),
      ]);
      const stageSourceRows = sourceRows.filter((source) => source.stageKey === "followup_research");
      const stageSourceIds = new Set(stageSourceRows.map((source) => source.id));

      const sectionPackages = buildSectionResearchPackages({
        outlineStage: args.outlineStage,
        sourceRows: stageSourceRows,
        quoteRows: quoteRows.filter(
          (quote) =>
            (quote.sourceId && stageSourceIds.has(quote.sourceId)) ||
            getSectionHeadingFromMetadata(quote.metadataJson) !== null
        ),
      });
      const generatedNoteCount = await persistSectionResearchPackages({
        runId: args.runId,
        stageKey: "followup_research",
        packages: sectionPackages,
      });
      const thinSections = sectionPackages
        .filter(
          (pkg) =>
            pkg.clipCount === 0 ||
            pkg.quoteCount < 2 ||
            pkg.articleCount === 0
        )
        .map((pkg) => pkg.sectionHeading);

      return {
        ...discovered,
        ...ingested,
        ...extracted,
        ...commentEnrichment,
        summary:
          "Section research persisted section-specific clips, articles, social posts, comments, and quotes into the run database for later writing stages.",
        generatedNoteCount,
        thinSections,
        sectionPackages: sectionPackages.map((pkg) => ({
          sectionHeading: pkg.sectionHeading,
          sourceCount: pkg.sourceCount,
          quoteCount: pkg.quoteCount,
          articleCount: pkg.articleCount,
          clipCount: pkg.clipCount,
          socialCount: pkg.socialCount,
          briefText: pkg.briefText,
        })),
      };
    }
  );

  return {
    sectionResearchPlan,
    sectionResearchStage: followupResearchStage,
    followupResearchStage,
  };
}

export async function runScriptAgentResearchStagesForEvaluation(input: ScriptAgentRequest) {
  const run = await createScriptAgentRun(input);

  const planResearchStage = await runStage(
    run.id,
    "plan_research",
    {
      storyTitle: input.storyTitle,
      researchDepth: input.researchDepth,
      targetRuntimeMinutes: input.targetRuntimeMinutes,
    },
    async () => generatePlanResearchStageOutput(input)
  );

  const discoverSourcesStage = await runStage(
    run.id,
    "discover_sources",
    {
      storyTitle: input.storyTitle,
      beamCount: planResearchStage.researchPlan.globalBeams.length,
    },
    () =>
      discoverSourcesForRun(run.id, input, {
        stageKey: "discover_sources",
        researchPlan: planResearchStage.researchPlan,
      })
  );

  const ingestSourcesStage = await runStage(
    run.id,
    "ingest_sources",
    {
      researchDepth: input.researchDepth,
      stageKey: "discover_sources",
    },
    () =>
      ingestSourcesForRun(run.id, input, {
        stageKey: "discover_sources",
      })
  );

  const extractEvidenceStage = await runStage(
    run.id,
    "extract_evidence",
    {
      storyTitle: input.storyTitle,
      stageKey: "discover_sources",
    },
    () =>
      extractEvidenceForRun(run.id, input, {
        stageKey: "discover_sources",
        includeDossierQuotes: true,
      })
  );

  const initialPrepared = await prepareScriptContextForRun(run.id, input);
  const synthesizeResearchStage = await runStage(
    run.id,
    "synthesize_research",
    {
      storyTitle: input.storyTitle,
      researchDepth: input.researchDepth,
      compiledResearchTextLength: initialPrepared.compiledResearchText.length,
    },
    () =>
      generateResearchStage({
        input: initialPrepared.context.input,
        moonAnalysis: initialPrepared.context.moonAnalysis,
        researchPacket: initialPrepared.context.researchPacket,
        seedQuoteEvidence: initialPrepared.quoteEvidence,
      })
  );

  const outlineStage = await runStage(
    run.id,
    "build_outline",
    {
      thesis: synthesizeResearchStage.thesis,
      targetWordRange: initialPrepared.context.targetWordRange,
    },
    () =>
      generateOutlineStage({
        researchPacket: initialPrepared.context.researchPacket,
        researchStage: synthesizeResearchStage,
        targetWordRange: initialPrepared.context.targetWordRange,
        })
  );

  const { sectionResearchStage, followupResearchStage } = await runSectionResearchStageForRun({
    runId: run.id,
    input,
    outlineStage,
    researchStage: {
      thesis: synthesizeResearchStage.thesis,
      keyClaims: synthesizeResearchStage.keyClaims,
    },
    researchStrategy: planResearchStage.researchStrategy,
  });

  return {
    runId: run.id,
    planResearchStage,
    discoverSourcesStage,
    ingestSourcesStage,
    extractEvidenceStage,
    synthesizeResearchStage,
    outlineStage,
    sectionResearchStage,
    followupResearchStage,
  };
}

export async function enqueueScriptAgentRun(runId: string) {
  const db = getDb();
  ensureScriptAgentEnvironment();

  if (isTriggerConfigured()) {
    const handle = await tasks.trigger(SCRIPT_AGENT_TASK_ID, {
      runId,
    });

    await db
      .update(scriptAgentRuns)
      .set({
        status: "queued",
        triggerRunId: handle.id,
        updatedAt: new Date(),
      })
      .where(eq(scriptAgentRuns.id, runId));

    return {
      mode: "trigger" as const,
      triggerRunId: handle.id,
      status: "queued" as const,
    };
  }

  spawnLocalScriptAgentWorker(runId);

  await db
    .update(scriptAgentRuns)
    .set({
      status: "queued",
      updatedAt: new Date(),
      errorText: null,
    })
    .where(eq(scriptAgentRuns.id, runId));

  return {
    mode: "inline" as const,
    triggerRunId: null,
    status: "queued" as const,
  };
}

export async function runScriptAgentTask(input: { runId: string }) {
  const db = getDb();
  const run = await db
    .select()
    .from(scriptAgentRuns)
    .where(eq(scriptAgentRuns.id, input.runId))
    .limit(1)
    .then((rows) => rows[0] ?? null);

  if (!run) {
    throw new Error(`Script agent run not found: ${input.runId}`);
  }

  const request = run.requestJson as ScriptAgentRequest;

  try {
    const planResearchStage = await runStage(
      input.runId,
      "plan_research",
      {
        storyTitle: request.storyTitle,
        researchDepth: request.researchDepth,
        targetRuntimeMinutes: request.targetRuntimeMinutes,
      },
      async () => generatePlanResearchStageOutput(request)
    );

    await runStage(
      input.runId,
      "discover_sources",
      {
        storyTitle: request.storyTitle,
        beamCount: planResearchStage.researchPlan.globalBeams.length,
      },
      () =>
        discoverSourcesForRun(input.runId, request, {
          stageKey: "discover_sources",
          researchPlan: planResearchStage.researchPlan,
        })
    );
    await runStage(
      input.runId,
      "ingest_sources",
      {
        researchDepth: request.researchDepth,
        stageKey: "discover_sources",
      },
      () =>
        ingestSourcesForRun(input.runId, request, {
          stageKey: "discover_sources",
        })
    );
    await runStage(
      input.runId,
      "extract_evidence",
      {
        storyTitle: request.storyTitle,
        stageKey: "discover_sources",
      },
      () =>
        extractEvidenceForRun(input.runId, request, {
          stageKey: "discover_sources",
          includeDossierQuotes: true,
        })
    );
    const initialPrepared = await prepareScriptContextForRun(input.runId, request);
    const initialResearchStage = await runStage(
      input.runId,
      "synthesize_research",
      {
        storyTitle: request.storyTitle,
        researchDepth: request.researchDepth,
        compiledResearchTextLength: initialPrepared.compiledResearchText.length,
      },
      () =>
        generateResearchStage({
          input: initialPrepared.context.input,
          moonAnalysis: initialPrepared.context.moonAnalysis,
          researchPacket: initialPrepared.context.researchPacket,
          seedQuoteEvidence: initialPrepared.quoteEvidence,
        })
    );

    const outlineStage = await runStage(
      input.runId,
      "build_outline",
      {
        thesis: initialResearchStage.thesis,
        targetWordRange: initialPrepared.context.targetWordRange,
      },
      () =>
        generateOutlineStage({
          researchPacket: initialPrepared.context.researchPacket,
          researchStage: initialResearchStage,
          targetWordRange: initialPrepared.context.targetWordRange,
        })
    );

    const { sectionResearchStage } = await runSectionResearchStageForRun({
      runId: input.runId,
      input: request,
      outlineStage,
      researchStage: {
        thesis: initialResearchStage.thesis,
        keyClaims: initialResearchStage.keyClaims,
      },
      researchStrategy: planResearchStage.researchStrategy,
    });

    const prepared = await prepareScriptContextForRun(input.runId, request);
    const researchStage = {
      ...initialResearchStage,
      quoteEvidence: prepared.quoteEvidence.slice(0, 12),
    };
    await persistResearchClaims(input.runId, researchStage);
    const sectionResearchBriefs = buildSectionResearchBriefsFromPackages(
      Array.isArray(sectionResearchStage.sectionPackages)
        ? (sectionResearchStage.sectionPackages as SectionResearchPackage[])
        : buildSectionResearchPackages({
            outlineStage,
            sourceRows: prepared.sourceRows,
            quoteRows: prepared.quoteRows,
          })
    );

    const quoteSelectionStage = await runStage(
      input.runId,
      "select_quotes",
      {
        availableQuoteCount: researchStage.quoteEvidence.length,
      },
      () =>
        generateQuoteSelectionStage({
          researchPacket: prepared.context.researchPacket,
          researchStage,
        })
    );

    const quotePlacementStage = await runStage(
      input.runId,
      "place_quotes",
      {
        sectionCount: outlineStage.sections.length,
        selectedQuoteCount: quoteSelectionStage.selectedQuotes.length,
      },
      () =>
        generateQuotePlacementStage({
          researchPacket: prepared.context.researchPacket,
          researchStage,
          outlineStage,
          quoteSelectionStage,
        })
    );

    const storyboardStage = await runStage(
      input.runId,
      "build_storyboard",
      {
        sectionCount: outlineStage.sections.length,
      },
      async () =>
        generateStoryboardStage({
          outlineStage,
          researchStage,
        })
    );

    const sectionPlanStage = await runStage(
      input.runId,
      "plan_sections",
      {
        sectionCount: outlineStage.sections.length,
      },
      () =>
        generateSectionPlanStage({
          researchPacket: prepared.context.researchPacket,
          researchStage,
          quoteSelectionStage,
          outlineStage,
          quotePlacementStage,
          storyboardStage,
        })
    );

    const sectionDraftsStage = await runStage(
      input.runId,
      "write_sections",
      {
        sectionCount: sectionPlanStage.sections.length,
      },
      () =>
        writeSectionDraftsStage({
          context: prepared.context,
          researchStage,
          quoteSelectionStage,
          outlineStage,
          quotePlacementStage,
          storyboardStage,
          sectionPlanStage,
          sectionResearchBriefs,
        })
    );

    const claudeDraft = await runStage(
      input.runId,
      "assemble_draft",
      {
        sectionCount: sectionDraftsStage.sections.length,
      },
      () =>
        assembleScriptDraftFromSections({
          researchPacket: prepared.context.researchPacket,
          researchStage,
          outlineStage,
          sectionDrafts: sectionDraftsStage,
        })
    );

    const critique = await runStage(
      input.runId,
      "critique_script",
      {
        draftWordCount: claudeDraft.script.split(/\\s+/).filter(Boolean).length,
      },
      () =>
        critiqueScriptDraft({
          researchPacket: prepared.context.researchPacket,
          otherLabel: "Claude first pass",
          otherDraft: claudeDraft,
        })
    );

    const retentionStage = await runStage(
      input.runId,
      "analyze_retention",
      {
        draftWordCount: claudeDraft.script.split(/\\s+/).filter(Boolean).length,
      },
      () =>
        analyzeRetentionStage({
          researchPacket: prepared.context.researchPacket,
          researchStage,
          outlineStage,
          claudeDraft,
        })
    );

    const finalSectionDraftsStage = await runStage(
      input.runId,
      "revise_sections",
      {
        sectionCount: sectionDraftsStage.sections.length,
      },
      () =>
        reviseSectionDraftsStage({
          context: prepared.context,
          researchStage,
          quoteSelectionStage,
          outlineStage,
          quotePlacementStage,
          storyboardStage,
          sectionPlanStage,
          sectionDrafts: sectionDraftsStage,
          critique,
          retentionStage,
          sectionResearchBriefs,
        })
    );

    const polishedDraft = await runStage(
      input.runId,
      "polish_script",
      {
        sectionCount: finalSectionDraftsStage.sections.length,
      },
      async () => {
        const revisedDraft = await assembleScriptDraftFromSections({
          researchPacket: prepared.context.researchPacket,
          sectionDrafts: finalSectionDraftsStage,
          researchStage,
          outlineStage,
        });

        return polishScriptDraft({
          researchPacket: prepared.context.researchPacket,
          draft: revisedDraft,
          styleFlags: [...critique.mustFix, ...retentionStage.mustFix].slice(0, 10),
        });
      }
    );

    const expandedDraft = await runStage(
      input.runId,
      "expand_script",
      {
        currentWordCount: polishedDraft.script.split(/\\s+/).filter(Boolean).length,
      },
      () =>
        expandDraftToMinimumLength({
          input: prepared.context.input,
          researchPacket: prepared.context.researchPacket,
          draft: polishedDraft,
        })
    );

    await runStage(
      input.runId,
      "finalize_script",
      {
        finalWordCount: expandedDraft.draft.script.split(/\\s+/).filter(Boolean).length,
      },
      async () => ({
        draft: expandedDraft.draft,
        editorialNotes: expandedDraft.notes,
      })
    );

    await db
      .update(scriptAgentRuns)
      .set({
        status: "complete",
        currentStage: "finalize_script",
        resultJson: {
          stages: {
            research: researchStage,
            outline: outlineStage,
            quoteSelection: quoteSelectionStage,
            quotePlacement: quotePlacementStage,
            storyboard: storyboardStage,
            sectionPlan: sectionPlanStage,
            sectionDrafts: sectionDraftsStage,
            finalSectionDrafts: finalSectionDraftsStage,
            retention: retentionStage,
          },
          variants: {
            claude: { draft: claudeDraft, critique },
            final: { draft: expandedDraft.draft, editorialNotes: expandedDraft.notes },
          },
        },
        completedAt: new Date(),
        updatedAt: new Date(),
        errorText: null,
      })
      .where(eq(scriptAgentRuns.id, input.runId));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown script-agent failure";
    await db
      .update(scriptAgentRuns)
      .set({
        status: "failed",
        errorText: message,
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(scriptAgentRuns.id, input.runId));
    throw error;
  }
}

export async function getScriptAgentRun(runId: string): Promise<ScriptAgentRun | null> {
  if (!isUuid(runId)) {
    return null;
  }

  const db = getDb();
  const [run, stages, sources, quotes, claims] = await Promise.all([
    db
      .select()
      .from(scriptAgentRuns)
      .where(eq(scriptAgentRuns.id, runId))
      .limit(1)
      .then((rows) => rows[0] ?? null),
    db
      .select()
      .from(scriptAgentStages)
      .where(eq(scriptAgentStages.runId, runId))
      .orderBy(asc(scriptAgentStages.stageOrder)),
    db
      .select()
      .from(scriptAgentSources)
      .where(eq(scriptAgentSources.runId, runId))
      .orderBy(desc(scriptAgentSources.createdAt)),
    db
      .select()
      .from(scriptAgentQuotes)
      .where(eq(scriptAgentQuotes.runId, runId))
      .orderBy(desc(scriptAgentQuotes.relevanceScore), desc(scriptAgentQuotes.createdAt)),
    db
      .select()
      .from(scriptAgentClaims)
      .where(eq(scriptAgentClaims.runId, runId))
      .orderBy(desc(scriptAgentClaims.supportLevel), asc(scriptAgentClaims.riskLevel)),
  ]);

  if (!run) {
    return null;
  }

  return serializeRunRecord({
    run,
    stages,
    sources,
    quotes,
    claims,
  });
}

export async function listRecentScriptAgentRuns(limit = 10): Promise<ScriptAgentRun[]> {
  const db = getDb();
  const runs = await db
    .select()
    .from(scriptAgentRuns)
    .orderBy(desc(scriptAgentRuns.createdAt))
    .limit(limit);

  const result: ScriptAgentRun[] = [];
  for (const run of runs) {
    const hydrated = await getScriptAgentRun(run.id);
    if (hydrated) {
      result.push(hydrated);
    }
  }
  return result;
}
