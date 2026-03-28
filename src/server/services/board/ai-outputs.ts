import "server-only";

import OpenAI from "openai";

import { getEnv, requireEnv } from "@/server/config/env";

import type { BoardFormatRecommendation } from "./format-recommendation";

export type BoardAiGenerationKind = "brief" | "script_starter" | "titles";

export interface BoardAiGenerationStoryContext {
  canonicalTitle: string;
  vertical: string | null;
  storyType: string;
  controversyScore: number;
  sentimentScore: number;
  surgeScore: number;
  itemsCount: number;
  sourcesCount: number;
  correction: boolean;
  metadataJson: Record<string, unknown> | null;
}

export interface BoardAiGenerationSourceContext {
  name: string;
  title: string;
  url: string;
  publishedAt: string | null;
  sourceWeight: number;
  sourceType: string | null;
  summary?: string | null;
}

export interface BoardAiGenerationMoonContext {
  moonFitScore: number;
  moonFitBand: string;
  clusterLabel: string | null;
  coverageMode: string | null;
  analogTitles: string[];
  dominantCoverageModes: string[];
  exemplarTitles: string[];
  storySpecificNotes: string[];
}

export interface GeneratedBoardAiOutput {
  kind: BoardAiGenerationKind;
  content: string;
  items: string[];
  model: string;
  promptVersion: string;
  expiresAt: string;
  metadataJson: Record<string, unknown>;
}

const BOARD_AI_PROMPT_VERSION: Record<BoardAiGenerationKind, string> = {
  brief: "v3-brief",
  script_starter: "v3-script-starter",
  titles: "v3-titles",
};

const BOARD_AI_TTL_MS: Record<BoardAiGenerationKind, number> = {
  brief: 4 * 60 * 60 * 1000,
  script_starter: 12 * 60 * 60 * 1000,
  titles: 12 * 60 * 60 * 1000,
};

export function getBoardAiPromptVersion(kind: BoardAiGenerationKind) {
  return BOARD_AI_PROMPT_VERSION[kind];
}

let openaiClient: OpenAI | undefined;

function getOpenAIClient() {
  if (!openaiClient) {
    openaiClient = new OpenAI({
      apiKey: requireEnv("OPENAI_API_KEY"),
    });
  }

  return openaiClient;
}

function buildStoryContextBlock(args: {
  story: BoardAiGenerationStoryContext;
  sources: BoardAiGenerationSourceContext[];
  recommendation: BoardFormatRecommendation;
  moonContext?: BoardAiGenerationMoonContext | null;
}) {
  const sources = args.sources
    .slice(0, 6)
    .map((source, index) => {
      const publishedAt = source.publishedAt ? ` | ${source.publishedAt}` : "";
      const summary = source.summary ? `\n${source.summary}` : "";
      return `${index + 1}. ${source.name} (${source.sourceType ?? "source"}, weight ${source.sourceWeight})${publishedAt}\n${source.title}\n${source.url}${summary}`;
    })
    .join("\n\n");

  const moonContextBlock = args.moonContext
    ? [
        "",
        "Moon Performance Weighting:",
        `Moon fit: ${Math.round(args.moonContext.moonFitScore)}/100 (${args.moonContext.moonFitBand})`,
        args.moonContext.clusterLabel
          ? `Likely Moon cluster: ${args.moonContext.clusterLabel}`
          : null,
        args.moonContext.coverageMode
          ? `Likely Moon winner lane: ${args.moonContext.coverageMode}`
          : null,
        args.moonContext.dominantCoverageModes.length > 0
          ? `Top Moon winner lanes: ${args.moonContext.dominantCoverageModes.join(" | ")}`
          : null,
        args.moonContext.analogTitles.length > 0
          ? `Closest Moon analogs: ${args.moonContext.analogTitles.join(" | ")}`
          : null,
        args.moonContext.exemplarTitles.length > 0
          ? `Reference Moon winners: ${args.moonContext.exemplarTitles.join(" | ")}`
          : null,
        args.moonContext.storySpecificNotes.length > 0
          ? `Analog notes: ${args.moonContext.storySpecificNotes.join(" | ")}`
          : null,
        "Weight the output toward the strongest Moon-performing lane and the closest analogs above. Reuse framing logic and category fit, not exact wording.",
      ]
        .filter(Boolean)
        .join("\n")
    : null;

  return [
    `Story: ${args.story.canonicalTitle}`,
    args.story.vertical ? `Vertical: ${args.story.vertical}` : null,
    `Type: ${args.story.storyType}`,
    `Controversy: ${args.story.controversyScore}/100`,
    `Sentiment: ${args.story.sentimentScore.toFixed(2)}`,
    `Surge: ${args.story.surgeScore}/100`,
    `Evidence: ${args.story.sourcesCount} sources / ${args.story.itemsCount} items`,
    `Correction flag: ${args.story.correction ? "yes" : "no"}`,
    `Recommended package: ${args.recommendation.packageLabel} (${args.recommendation.urgency} urgency, ${args.recommendation.confidence}% confidence)`,
    `Recommendation reasons: ${args.recommendation.reasons.join("; ")}`,
    moonContextBlock,
    "",
    "Sources:",
    sources || "No sources available.",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildInstruction(kind: BoardAiGenerationKind) {
  switch (kind) {
    case "brief":
      return {
        instruction:
          "Write a grounded editorial brief in Moon News voice. Be precise, skeptical, and concise. Weight the angle toward the Moon winner lanes and closest analogs provided in the prompt, but do not force a mismatch if the fit is weak. Return JSON with `content` as 2-3 short paragraphs and `items` as 4-6 key editorial beats.",
        temperature: 0.5,
      };
    case "script_starter":
      return {
        instruction:
          "Write a documentary-style opening hook for this story. Use the provided Moon winner lanes and analogs to bias the framing toward what historically works on Moon. Return JSON with `content` as 2-3 paragraphs and `items` as 3-5 hook beats used to build it.",
        temperature: 0.75,
      };
    case "titles":
      return {
        instruction:
          "Generate 6 YouTube title options tuned for Moon News. Weight the set toward the top-performing Moon lanes and closest analog titles supplied in the prompt. Mix safer and more aggressive options, avoid generic slop, keep them grounded in the actual evidence, and never copy a reference title verbatim. Return JSON with `content` as newline-separated titles and `items` as an array of the same titles.",
        temperature: 0.9,
      };
  }
}

function sanitizeItems(items: unknown): string[] {
  if (!Array.isArray(items)) {
    return [];
  }

  return items
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 10);
}

function parseGeneratedOutput(
  kind: BoardAiGenerationKind,
  raw: string
): Pick<GeneratedBoardAiOutput, "content" | "items"> {
  try {
    const parsed = JSON.parse(raw) as {
      content?: string;
      items?: unknown;
    };
    const content = parsed.content?.trim() ?? "";
    const items = sanitizeItems(parsed.items);

    if (content.length > 0 || items.length > 0) {
      const normalizedItems =
        items.length > 0
          ? items
          : kind === "titles"
            ? content
                .split("\n")
                .map((item) => item.trim())
                .filter(Boolean)
            : [];

      return {
        content,
        items: normalizedItems,
      };
    }
  } catch {
    // fall through to best-effort parsing
  }

  const fallbackItems =
    kind === "titles"
      ? raw
          .split("\n")
          .map((item) => item.trim())
          .filter(Boolean)
          .slice(0, 10)
      : [];

  return {
    content: raw.trim(),
    items: fallbackItems,
  };
}

export async function generateBoardAiOutput(args: {
  kind: BoardAiGenerationKind;
  story: BoardAiGenerationStoryContext;
  sources: BoardAiGenerationSourceContext[];
  recommendation: BoardFormatRecommendation;
  moonContext?: BoardAiGenerationMoonContext | null;
}): Promise<GeneratedBoardAiOutput> {
  const ai = getOpenAIClient();
  const model = getEnv().OPENAI_RESEARCH_MODEL;
  const promptVersion = BOARD_AI_PROMPT_VERSION[args.kind];
  const expiresAt = new Date(Date.now() + BOARD_AI_TTL_MS[args.kind]).toISOString();
  const instruction = buildInstruction(args.kind);
  const storyContext = buildStoryContextBlock(args);

  const response = await ai.chat.completions.create({
    model,
    temperature: instruction.temperature,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          `${instruction.instruction}\n` +
          "Return valid JSON only. Do not fabricate facts beyond the supplied source context.",
      },
      {
        role: "user",
        content: storyContext,
      },
    ],
  });

  const raw = response.choices[0]?.message?.content ?? "";
  const parsed = parseGeneratedOutput(args.kind, raw);
  const items =
    parsed.items.length > 0
      ? parsed.items
      : args.kind === "titles"
        ? parsed.content
            .split("\n")
            .map((item) => item.trim())
            .filter(Boolean)
            .slice(0, 10)
        : [];

  return {
    kind: args.kind,
    content:
      parsed.content.length > 0
        ? parsed.content
        : items.join("\n"),
    items,
    model,
    promptVersion,
    expiresAt,
      metadataJson: {
      items,
      expiresAt,
      generatedFrom: "openai",
      recommendation: {
        primaryFormat: args.recommendation.primaryFormat,
        packageLabel: args.recommendation.packageLabel,
        urgency: args.recommendation.urgency,
      },
      sourceCount: args.sources.length,
      moonContext: args.moonContext
        ? {
            moonFitScore: Math.round(args.moonContext.moonFitScore),
            moonFitBand: args.moonContext.moonFitBand,
            clusterLabel: args.moonContext.clusterLabel,
            coverageMode: args.moonContext.coverageMode,
            analogTitles: args.moonContext.analogTitles.slice(0, 5),
            dominantCoverageModes: args.moonContext.dominantCoverageModes.slice(0, 4),
          }
        : null,
    },
  };
}
