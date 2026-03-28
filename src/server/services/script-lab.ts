import "server-only";

import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import OpenAI from "openai";
import { z } from "zod";

import { getEnv, requireEnv } from "@/server/config/env";
import { getDb } from "@/server/db/client";
import { clipLibrary, scriptLabRuns, transcriptCache } from "@/server/db/schema";
import {
  type ScriptCritique,
  type ScriptDraft,
  type ScriptEvidenceQuote,
  type ScriptLabGenerateResponse,
  type ScriptLabRequest,
  type ScriptLabResponse,
  type ScriptOutlineStage,
  type ScriptResearchStage,
  type ScriptRetentionStage,
  type ScriptSectionDraftsStage,
  type ScriptSectionPlanStage,
  type ScriptLabSavedRun,
  type ScriptStoryboardStage,
  type ScriptQuotePlacementStage,
  type ScriptQuoteSelectionStage,
  scriptCritiqueSchema,
  scriptDraftSchema,
  scriptOutlineStageSchema,
  scriptQuotePlacementStageSchema,
  scriptQuoteSelectionStageSchema,
  scriptRetentionStageSchema,
  scriptSectionDraftItemSchema,
  scriptSectionDraftsStageSchema,
  scriptSectionPlanStageSchema,
  scriptLabResponseSchema,
} from "@/lib/script-lab";
import { findRelevantQuotes } from "@/server/providers/openai";
import {
  getMoonEditorialStyleGuide,
  scoreTextAgainstMoonCorpus,
} from "@/server/services/moon-corpus";
import {
  formatMoonRetentionPatternGuide,
  getMoonRetentionPatternGuide,
} from "@/server/services/moon-retention-guide";
import { and, desc, eq, inArray } from "drizzle-orm";

const require = createRequire(import.meta.url);
const json5 = require("json5") as { parse: (text: string) => unknown };

async function writeJsonFailureDebugFile(payload: Record<string, unknown>) {
  try {
    const dir = path.resolve(process.cwd(), "research", "json-debug");
    await mkdir(dir, { recursive: true });
    const filePath = path.join(
      dir,
      `anthropic-json-failure-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`
    );
    await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    console.error(`[script-lab] Wrote JSON debug payload to ${filePath}`);
  } catch (error) {
    console.error("[script-lab] Failed to write JSON debug payload:", error);
  }
}

function getAnthropicHeaders() {
  return {
    "content-type": "application/json",
    "x-api-key": requireEnv("ANTHROPIC_API_KEY"),
    "anthropic-version": "2023-06-01",
  };
}

let jsonRepairClient: OpenAI | undefined;

function getJsonRepairClient() {
  if (!jsonRepairClient) {
    jsonRepairClient = new OpenAI({
      apiKey: requireEnv("OPENAI_API_KEY"),
    });
  }

  return jsonRepairClient;
}

export function getAnthropicPlanningModel() {
  const requested = getEnv().ANTHROPIC_PLANNING_MODEL || getEnv().ANTHROPIC_MODEL;
  return /opus/i.test(requested) ? "claude-sonnet-4-6" : requested;
}

export function getAnthropicWritingModel() {
  const requested = getEnv().ANTHROPIC_WRITING_MODEL || getEnv().ANTHROPIC_MODEL;
  return /opus/i.test(requested) ? "claude-sonnet-4-6" : requested;
}

const SCRIPT_STYLE_SYSTEM_PROMPT = `You write high-retention documentary YouTube scripts for a modern internet-culture, power, tech, and scandal channel.

Your scripts should feel transcript-derived rather than blog-like:
- strong cold open built around tension, contradiction, or a disturbing implication
- short spoken paragraphs, not essay prose
- skeptical, precise, controlled tone
- escalation from weird detail to broader system to real consequence
- concrete nouns over vague abstractions
- smooth pivots that keep momentum without sounding theatrical
- cinematic phrasing only when earned by the evidence

Do not imitate any single creator verbatim. Do not copy recognizable phrases, catchphrases, or sentence patterns from any transcript. Infer structure, pacing, framing, and topic fit, then write something new.

Rules:
1. Every paragraph must move the story forward.
2. Start with the sharpest unsettling fact, contradiction, or image, not background.
3. Delay full explanation slightly; create curiosity, then cash it out.
4. Prefer specific examples, names, dates, numbers, institutions, products, policies, and consequences.
5. Treat the story like a system, not just an incident.
6. Never use filler like "In this video", "Let's dive in", "It's important to note", or "In today's world".
7. Never overstate facts. If evidence is partial or disputed, say so.
8. Return valid JSON only.
9. Use the Moon corpus signals for structure and fit, not for copying phrasing.
10. Recent Moon analogs matter more than older ones. Weight the last 3 months most heavily when deciding framing and emphasis.
11. Avoid canned contrast templates like "this isn't X, it's Y", "it wasn't X, it was Y", "it's not just X", or "the real story is". If a sentence sounds like AI scaffolding, rewrite it.
12. Avoid calendar date narration in the opener of a fresh story unless chronology is the point. If the story just broke, prefer natural phrasing like "last week", "this week", or "yesterday".
13. Avoid essay-signpost transitions like "but here's the thing", "the truth is", or "this is where it gets worse" unless truly necessary. Let the evidence create the transition.
14. First-sentence anomalies, contradiction-led openings, direct address, and hard numbers are useful Moon tools when earned by the evidence. Use them precisely, not as gimmicks.
15. Quotes should puncture or verify a beat, not take over whole paragraphs unless the material is extraordinarily strong.
16. Prefer causal connective tissue like "because", "but", and "so" over theatrical signposts.`;

const CRITIQUE_RUBRIC = [
  "factual grounding in the provided research",
  "spoken-word rhythm rather than essay prose",
  "strength of the cold open",
  "clarity of escalation from detail to system to consequence",
  "originality without generic YouTube slop",
  "whether the script actually sounds like a strong Moon-adjacent documentary piece",
  "whether the strongest information is front-loaded",
  "whether any lines overclaim or dramatize beyond the evidence",
  "absence of canned AI-sounding contrast templates and weak signpost transitions",
  "whether fresh stories are narrated naturally instead of with stiff calendar-date phrasing",
].join("; ");

const STYLE_LINT_RULES = [
  {
    code: "contrast:this-isnt-it-is",
    description: 'Remove "this isn\'t X, it\'s Y" style contrast scaffolding',
    pattern:
      /\bthis\s+(?:isn't|is not|wasn't|was not)\b[^.?!]{0,120}\b(?:it|this)\s+(?:is|was)\b/gi,
  },
  {
    code: "contrast:it-wasnt-it-was",
    description: 'Remove "it wasn\'t X, it was Y" style contrast scaffolding',
    pattern: /\bit\s+(?:wasn't|was not)\b[^.?!]{0,120}\bit\s+was\b/gi,
  },
  {
    code: "transition:real-story",
    description: 'Avoid stock transition "the real story is"',
    pattern: /\bthe real story (?:is|was)\b/gi,
  },
  {
    code: "transition:truth-is",
    description: 'Avoid stock transition "the truth is"',
    pattern: /\bthe truth is\b/gi,
  },
  {
    code: "transition:heres-the-thing",
    description: 'Avoid stock transition "here\'s the thing"',
    pattern: /\bhere'?s the thing\b/gi,
  },
  {
    code: "contrast:not-just",
    description: 'Avoid repetitive "it\'s not just..." framing',
    pattern: /\bit'?s not just\b/gi,
  },
  {
    code: "transition:this-is-where",
    description: 'Avoid stock transition "this is where it gets..."',
    pattern: /\bthis is where it gets\b/gi,
  },
];

const OPENER_CALENDAR_DATE_PATTERN =
  /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2}(?:,\s+\d{4})?|\b20\d{2}\b/gi;

const scriptResearchSummarySchema = z.object({
  summary: z.string().trim().min(1),
  thesis: z.string().trim().min(1),
  keyClaims: z.array(z.string().trim().min(1)).min(3).max(8),
  riskyClaims: z.array(z.string().trim().min(1)).max(6).default([]),
});

const scriptDraftMetadataSchema = z.object({
  title: z.string().trim().min(1),
  deck: z.string().trim().min(1),
  beats: z.array(z.string().trim().min(1)).min(3).max(10),
  angle: z.string().trim().min(1),
  warnings: z.array(z.string().trim().min(1)).max(10).default([]),
});

type ScriptLabPipelineContext = {
  input: ScriptLabRequest;
  moonAnalysis: Awaited<ReturnType<typeof scoreTextAgainstMoonCorpus>>;
  moonStyleGuide: Awaited<ReturnType<typeof getMoonEditorialStyleGuide>>;
  moonRetentionGuide: Awaited<ReturnType<typeof getMoonRetentionPatternGuide>> | null;
  researchPacket: string;
  targetWordRange: ReturnType<typeof getTargetWordRange>;
};

function extractJsonObject(raw: string) {
  const trimmed = raw.trim();
  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidateText = fencedMatch?.[1]?.trim() || trimmed;
  const firstBrace = candidateText.indexOf("{");

  if (firstBrace === -1) {
    throw new Error("Model did not return JSON");
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = firstBrace; index < candidateText.length; index += 1) {
    const char = candidateText[index];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    if (char === "\"") {
      inString = !inString;
      continue;
    }

    if (inString) {
      continue;
    }

    if (char === "{") {
      depth += 1;
      continue;
    }

    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return candidateText.slice(firstBrace, index + 1);
      }
    }
  }

  throw new Error("Model did not return a complete JSON object");
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}

function parseModelJsonText(raw: string) {
  const candidate = extractJsonObject(raw);

  try {
    return JSON.parse(candidate);
  } catch (parseError) {
    let sanitized = "";
    let inString = false;
    let escaped = false;

    for (const char of candidate) {
      if (escaped) {
        sanitized += char;
        escaped = false;
        continue;
      }

      if (char === "\\") {
        sanitized += char;
        escaped = true;
        continue;
      }

      if (char === "\"") {
        sanitized += char;
        inString = !inString;
        continue;
      }

      if (inString) {
        if (char === "\n") {
          sanitized += "\\n";
          continue;
        }
        if (char === "\r") {
          sanitized += "\\r";
          continue;
        }
        if (char === "\t") {
          sanitized += "\\t";
          continue;
        }
        if (char >= "\u0000" && char <= "\u001f") {
          sanitized += " ";
          continue;
        }
      }

      sanitized += char;
    }

    try {
      return JSON.parse(sanitized);
    } catch {
      const normalizedForJson5 = sanitized
        .replace(/[“”]/g, "\"")
        .replace(/[‘’]/g, "'")
        .replace(/,\s*([}\]])/g, "$1");

      try {
        return json5.parse(normalizedForJson5);
      } catch {
        throw parseError;
      }
    }
  }
}

function normalizeModelJson(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }

  const record = { ...(value as Record<string, unknown>) };
  const normalizeUsePriority = (value: unknown) => {
    if (typeof value !== "string") {
      return "strong_optional";
    }

    const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
    if (normalized === "must_use" || normalized.includes("must")) {
      return "must_use";
    }
    if (normalized === "context_only" || normalized.includes("context")) {
      return "context_only";
    }
    if (
      normalized === "strong_optional" ||
      normalized.includes("optional") ||
      normalized.includes("support")
    ) {
      return "strong_optional";
    }

    return "strong_optional";
  };

  const trimStringArray = (key: string, maxItems: number) => {
    const current = record[key];
    if (!Array.isArray(current)) {
      return;
    }

    record[key] = current
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, maxItems);
  };

  trimStringArray("beats", 10);
  trimStringArray("warnings", 10);
  trimStringArray("strengths", 8);
  trimStringArray("weaknesses", 8);
  trimStringArray("mustFix", 8);
  trimStringArray("keep", 8);
  trimStringArray("backupAngles", 6);
  trimStringArray("keyClaims", 8);
  trimStringArray("riskyClaims", 6);
  trimStringArray("tensions", 8);
  trimStringArray("runwayBeats", 8);
  trimStringArray("turningPoints", 8);
  trimStringArray("stakeShifters", 8);
  trimStringArray("openQuestions", 8);
  trimStringArray("globalSearchThemes", 10);
  trimStringArray("skip", 8);
  trimStringArray("keepWatchingMoments", 8);
  trimStringArray("deadZones", 6);
  trimStringArray("pacingNotes", 6);

  if (Array.isArray(record.risks)) {
    record.risks = record.risks
      .map((item) => {
        if (typeof item === "string") {
          return item.trim();
        }
        if (!item || typeof item !== "object" || Array.isArray(item)) {
          return null;
        }

        const risk = item as Record<string, unknown>;
        const riskText = typeof risk.risk === "string" ? risk.risk.trim() : "";
        const mitigationText =
          typeof risk.mitigation === "string" ? risk.mitigation.trim() : "";
        return [riskText, mitigationText].filter(Boolean).join(" — ");
      })
      .filter((item): item is string => Boolean(item))
      .slice(0, 8);
  }

  if (Array.isArray(record.sections)) {
    record.sections = record.sections
      .slice(0, 10)
      .map((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) {
          return item;
        }

        const section = { ...(item as Record<string, unknown>) };
        if (
          typeof section.sectionHeading !== "string" &&
          typeof section.section_title === "string"
        ) {
          section.sectionHeading = section.section_title.trim();
        }
        if (
          typeof section.heading !== "string" &&
          typeof section.sectionHeading === "string"
        ) {
          section.heading = section.sectionHeading;
        }
        if (
          typeof section.sectionTitle !== "string" &&
          typeof section.section_title === "string"
        ) {
          section.sectionTitle = section.section_title.trim();
        }
        if (
          !Array.isArray(section.articleQueries)
          && section.queries
          && typeof section.queries === "object"
          && !Array.isArray(section.queries)
        ) {
          const queries = section.queries as Record<string, unknown>;
          if (Array.isArray(queries.article)) {
            section.articleQueries = queries.article;
          }
          if (Array.isArray(queries.media)) {
            section.mediaQueries = queries.media;
          }
          if (Array.isArray(queries.social)) {
            section.socialQueries = queries.social;
          }
        }
        const trimSectionQueries = (key: string, maxItems: number) => {
          const current = section[key];
          if (!Array.isArray(current)) {
            return;
          }
          section[key] = current
            .filter((entry): entry is string => typeof entry === "string")
            .map((entry) => entry.trim())
            .filter(Boolean)
            .slice(0, maxItems);
        };
        trimSectionQueries("articleQueries", 6);
        trimSectionQueries("mediaQueries", 6);
        trimSectionQueries("socialQueries", 4);
        if (Array.isArray(section.evidenceSlots)) {
          section.evidenceSlots = section.evidenceSlots
            .filter((entry): entry is string => typeof entry === "string")
            .map((entry) => entry.trim())
            .filter(Boolean)
            .slice(0, 4);
        }
        return section;
      });
  }

  if (Array.isArray(record.videoStructure)) {
    record.videoStructure = record.videoStructure
      .slice(0, 8)
      .map((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) {
          return item;
        }

        const section = { ...(item as Record<string, unknown>) };
        if (Array.isArray(section.evidenceNeeded)) {
          section.evidenceNeeded = section.evidenceNeeded
            .filter((entry): entry is string => typeof entry === "string")
            .map((entry) => entry.trim())
            .filter(Boolean)
            .slice(0, 8);
        }
        if (Array.isArray(section.searchPriorities)) {
          section.searchPriorities = section.searchPriorities
            .filter((entry): entry is string => typeof entry === "string")
            .map((entry) => entry.trim())
            .filter(Boolean)
            .slice(0, 8);
        }
        if (typeof section.targetWordCount === "number") {
          section.targetWordCount = Math.max(
            120,
            Math.min(900, Math.round(section.targetWordCount))
          );
        }
        return section;
      });
  }

  if (Array.isArray(record.beats)) {
    record.beats = record.beats
      .slice(0, 10)
      .map((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) {
          return item;
        }

        const beat = { ...(item as Record<string, unknown>) };
        if (Array.isArray(beat.visualNotes)) {
          beat.visualNotes = beat.visualNotes
            .filter((entry): entry is string => typeof entry === "string")
            .map((entry) => entry.trim())
            .filter(Boolean)
            .slice(0, 5);
        }
        if (Array.isArray(beat.suggestedAssets)) {
          beat.suggestedAssets = beat.suggestedAssets
            .filter((entry): entry is string => typeof entry === "string")
            .map((entry) => entry.trim())
            .filter(Boolean)
            .slice(0, 5);
        }
        return beat;
      });
  }

  if (Array.isArray(record.selectedQuotes)) {
    record.selectedQuotes = record.selectedQuotes
      .slice(0, 10)
      .map((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) {
          return item;
        }

        const quote = { ...(item as Record<string, unknown>) };
        quote.usePriority = normalizeUsePriority(quote.usePriority);
        return quote;
      });
  }

  return record;
}

export async function createAnthropicJson<T>(args: {
  schema: { parse: (value: unknown) => T };
  system: string;
  user: string;
  temperature: number;
  maxTokens?: number;
  model?: string;
}) {
  const requestedModel = args.model ?? getEnv().ANTHROPIC_MODEL;
  const model = /opus/i.test(requestedModel)
    ? "claude-sonnet-4-6"
    : requestedModel;
  const requestAnthropicText = async (maxTokens: number) => {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: getAnthropicHeaders(),
        body: JSON.stringify({
          model,
          max_tokens: maxTokens,
          temperature: args.temperature,
          system: args.system,
          messages: [
            {
              role: "user",
              content: args.user,
            },
          ],
        }),
      });

      if (!response.ok) {
        const body = await response.text();
        const shouldRetry =
          attempt < 3 && (response.status === 429 || response.status === 529 || response.status >= 500);
        if (shouldRetry) {
          await new Promise((resolve) => setTimeout(resolve, attempt * 1500));
          continue;
        }
        throw new Error(`Anthropic request failed (${response.status}): ${body}`);
      }

      const payload = (await response.json()) as {
        stop_reason?: string | null;
        content?: Array<{ type?: string; text?: string }>;
      };

      return {
        stopReason: payload.stop_reason ?? null,
        text:
          payload.content
            ?.filter((block) => block.type === "text" && typeof block.text === "string")
            .map((block) => block.text ?? "")
            .join("\n") ?? "",
      };
    }

    throw new Error("Anthropic request failed after retries.");
  };

  const requestJsonRepairWithOpenAi = async (malformedText: string, parseError: string) => {
    const response = await getJsonRepairClient().responses.create({
      model: "gpt-4.1-mini",
      input: [
        {
          role: "system",
          content:
            "You repair malformed JSON. Return strict JSON only. Preserve the intended structure and content. Do not add commentary.",
        },
        {
          role: "user",
          content: [
            "The following text was intended to be valid JSON, but it failed to parse.",
            `Parser error: ${parseError}`,
            "Return a JSON object with one field, repaired_json, whose value is the repaired JSON as a string.",
            "",
            "Malformed output:",
            malformedText.slice(0, 50000),
          ].join("\n"),
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "json_repair",
          strict: true,
          schema: {
            type: "object",
            properties: {
              repaired_json: {
                type: "string",
              },
            },
            required: ["repaired_json"],
            additionalProperties: false,
          },
        },
      },
    });

    const parsed = JSON.parse(response.output_text) as { repaired_json?: string };
    if (!parsed.repaired_json) {
      throw new Error(`OpenAI JSON repair did not return repaired_json. Parse error: ${parseError}`);
    }
    return parsed.repaired_json;
  };

  const requestJsonRepair = async (malformedText: string, parseError: string) => {
    const repairResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: getAnthropicHeaders(),
      body: JSON.stringify({
        model,
        max_tokens: Math.min(args.maxTokens ?? 7200, 4000),
        temperature: 0,
        system:
          "You repair malformed JSON. Return only valid JSON with the same intended structure and content. Do not add commentary or markdown.",
        messages: [
          {
            role: "user",
            content: [
              "The previous model output was intended to be valid JSON for a structured script-writing pipeline, but it failed to parse.",
              `Parser error: ${parseError}`,
              "Repair it into strict JSON only.",
              "",
              "Malformed output:",
              malformedText.slice(0, 50000),
            ].join("\n"),
          },
        ],
      }),
    });

    if (!repairResponse.ok) {
      const body = await repairResponse.text();
      throw new Error(
        `Anthropic JSON repair failed (${repairResponse.status}): ${body}. Original parse error: ${parseError}`
      );
    }

    const repairedPayload = (await repairResponse.json()) as {
      content?: Array<{ type?: string; text?: string }>;
    };
    return (
      repairedPayload.content
        ?.filter((block) => block.type === "text" && typeof block.text === "string")
        .map((block) => block.text ?? "")
        .join("\n") ?? ""
    );
  };

  const requestedMaxTokens = args.maxTokens ?? 7200;
  let { text, stopReason } = await requestAnthropicText(requestedMaxTokens);
  if (stopReason === "max_tokens" && requestedMaxTokens < 12000) {
    const retryMaxTokens = Math.min(Math.max(requestedMaxTokens + 2000, requestedMaxTokens * 2), 12000);
    const retried = await requestAnthropicText(retryMaxTokens);
    text = retried.text;
    stopReason = retried.stopReason;
  }
  let repairedText: string | null = null;
  let secondPassText: string | null = null;
  let openAiRepairedText: string | null = null;
  let finalRepairText: string | null = null;

  try {
    return args.schema.parse(normalizeModelJson(parseModelJsonText(text)));
  } catch (error) {
    const firstParseError = error instanceof Error ? error.message : "Unknown parse error";
    repairedText = await requestJsonRepair(text, firstParseError);

    try {
      return args.schema.parse(normalizeModelJson(parseModelJsonText(repairedText)));
    } catch (repairError) {
      const secondParseError =
        repairError instanceof Error ? repairError.message : "Unknown repair parse error";
      secondPassText = await requestJsonRepair(repairedText, secondParseError);

      try {
        return args.schema.parse(normalizeModelJson(parseModelJsonText(secondPassText)));
      } catch (secondRepairError) {
        const thirdParseError =
          secondRepairError instanceof Error
            ? secondRepairError.message
            : "Unknown second repair parse error";
        try {
          openAiRepairedText = await requestJsonRepairWithOpenAi(secondPassText, thirdParseError);
          return args.schema.parse(normalizeModelJson(parseModelJsonText(openAiRepairedText)));
        } catch (openAiRepairError) {
          finalRepairText = await requestJsonRepair(
            secondPassText,
            `${thirdParseError}. The external JSON repair fallback was unavailable, so perform one final strict self-repair.`
          );

          try {
            return args.schema.parse(normalizeModelJson(parseModelJsonText(finalRepairText)));
          } catch (finalRepairError) {
            await writeJsonFailureDebugFile({
              firstParseError,
              secondParseError,
              thirdParseError,
              openAiRepairError:
                openAiRepairError instanceof Error
                  ? openAiRepairError.message
                  : "Unknown OpenAI repair error",
              finalRepairError:
                finalRepairError instanceof Error
                  ? finalRepairError.message
                  : "Unknown final repair error",
              request: {
                model,
                system: args.system,
                user: args.user.slice(0, 50000),
                maxTokens: args.maxTokens ?? 7200,
                temperature: args.temperature,
              },
              rawText: text,
              repairedText,
              secondPassText,
              openAiRepairedText,
              finalRepairText,
            });
            throw finalRepairError;
          }
        }
      }
    }
  }
}

function normalizeQuoteText(text: string) {
  return text
    .replace(/\s+/g, " ")
    .replace(/[“”]/g, "\"")
    .trim();
}

function formatTimestamp(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function buildInlineSourceNote(args: {
  sourceTitle: string;
  sourceUrl?: string | null;
  startMs?: number | null;
}) {
  const label =
    typeof args.startMs === "number"
      ? `${args.sourceTitle} @ ${formatTimestamp(args.startMs)}`
      : args.sourceTitle;
  const parts = [label, args.sourceUrl ?? null].filter(Boolean);
  return `[Source: ${parts.join(" | ")}]`;
}

function buildSourceNoteGuidance() {
  return [
    "Source-note requirements:",
    "- Treat every [Source: ...] marker as a silent editorial annotation, not words for the narrator to read aloud.",
    "- Every direct quote must be followed immediately by its source note.",
    "- Every paragraph that uses sourced reporting or a specific factual claim must include at least one source note tied to that evidence.",
    "- Use this exact bracket format: [Source: Outlet / title @ mm:ss | https://example.com]. If a source URL is available in the research packet or section context, you must include it. Only omit the URL when the source truly has none.",
    "- Never invent timestamps. Only include @ mm:ss when the exact source note, quote evidence, or transcript context already provides that timestamp.",
    "- If the provided source note has no timestamp, keep it that way.",
    "- If one paragraph uses multiple sources, combine them inside one bracket separated by semicolons.",
    "- Never delete, rewrite, or smooth away an existing [Source: ...] marker during revision, polish, or expansion.",
  ].join("\n");
}

function trimToLength(text: string, maxChars: number) {
  if (text.length <= maxChars) {
    return text;
  }

  return `${text.slice(0, maxChars - 3).trimEnd()}...`;
}

function formatQuoteEvidence(quotes: ScriptEvidenceQuote[]) {
  if (quotes.length === 0) {
    return "No transcript-backed or pasted quotes were extracted.";
  }

  return quotes
    .map((quote, index) => {
      const timecode =
        typeof quote.startMs === "number"
          ? ` @ ${Math.floor(quote.startMs / 60000)}:${String(Math.floor((quote.startMs % 60000) / 1000)).padStart(2, "0")}`
          : "";

      return [
        `[Q${index + 1}] ${quote.sourceType} | ${quote.sourceTitle}${timecode}`,
        `quote: "${quote.quoteText}"`,
        quote.speaker ? `speaker: ${quote.speaker}` : null,
        quote.context ? `why it matters: ${quote.context}` : null,
        quote.sourceUrl ? `source: ${quote.sourceUrl}` : null,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");
}

function dedupeQuoteEvidence(quotes: ScriptEvidenceQuote[], limit = 12) {
  const seen = new Set<string>();
  const deduped: ScriptEvidenceQuote[] = [];

  for (const quote of quotes) {
    const key = normalizeQuoteText(quote.quoteText).toLowerCase();
    if (!key || seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push({
      ...quote,
      quoteText: normalizeQuoteText(quote.quoteText),
    });

    if (deduped.length >= limit) {
      break;
    }
  }

  return deduped;
}

function isUsableTranscriptQuote(text: string) {
  const normalized = normalizeQuoteText(text);
  if (normalized.length < 32 || normalized.length > 260) {
    return false;
  }

  if (normalized.includes("...")) {
    return false;
  }

  if (!/[.!?"]$/.test(normalized)) {
    return false;
  }

  if (!/[A-Z]/.test(normalized.charAt(0) || "")) {
    return false;
  }

  const wordCount = normalized.split(/\s+/).filter(Boolean).length;
  return wordCount >= 6;
}

function formatSelectedQuotes(stage: ScriptQuoteSelectionStage) {
  if (stage.selectedQuotes.length === 0) {
    return "No strong quotes were selected.";
  }

  return stage.selectedQuotes
    .map((quote) =>
      [
        `${quote.quoteId} | ${quote.usePriority} | ${quote.sourceTitle}`,
        `quote: "${quote.quoteText}"`,
        `usage role: ${quote.usageRole}`,
        `source note: ${buildInlineSourceNote(quote)}`,
        quote.sectionHint ? `section hint: ${quote.sectionHint}` : null,
        quote.qualityNotes ? `quality notes: ${quote.qualityNotes}` : null,
      ]
        .filter(Boolean)
        .join("\n")
    )
    .join("\n\n");
}

function formatQuotePlacementStage(stage: ScriptQuotePlacementStage) {
  return stage.placements
    .map((placement, index) =>
      [
        `${index + 1}. ${placement.sectionHeading}`,
        `placement goal: ${placement.placementGoal}`,
        placement.requiredQuoteIds.length > 0
          ? `required quotes: ${placement.requiredQuoteIds.join(" | ")}`
          : null,
        placement.optionalQuoteIds.length > 0
          ? `optional quotes: ${placement.optionalQuoteIds.join(" | ")}`
          : null,
      ]
        .filter(Boolean)
        .join("\n")
    )
    .join("\n\n");
}

function extractResearchQuotes(researchText: string, limit = 6): ScriptEvidenceQuote[] {
  const paragraphs = researchText
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const quotes: ScriptEvidenceQuote[] = [];
  const quotePattern = /["“]([^"\n”]{24,280})["”]/g;

  for (const paragraph of paragraphs) {
    const matches = Array.from(paragraph.matchAll(quotePattern));
    for (const match of matches) {
      const quoteText = normalizeQuoteText(match[1] ?? "");
      if (quoteText.length < 24) {
        continue;
      }

      const dedupeKey = quoteText.toLowerCase();
      if (seen.has(dedupeKey)) {
        continue;
      }

      seen.add(dedupeKey);
      quotes.push({
        sourceType: "research_text",
        sourceTitle: "Research dossier",
        sourceUrl: null,
        quoteText,
        speaker: null,
        context: paragraph.slice(0, 260),
        relevanceScore: 60,
        startMs: null,
        endMs: null,
      });
    }
  }

  return quotes.slice(0, limit);
}

async function collectTranscriptBackedQuotes(args: {
  input: ScriptLabRequest;
  analogClipIds: string[];
}): Promise<ScriptEvidenceQuote[]> {
  if (args.analogClipIds.length === 0) {
    return [];
  }

  const db = getDb();
  const rows = await db
    .select({
      clipId: clipLibrary.id,
      title: clipLibrary.title,
      sourceUrl: clipLibrary.sourceUrl,
      channelOrContributor: clipLibrary.channelOrContributor,
      segmentsJson: transcriptCache.segmentsJson,
    })
    .from(clipLibrary)
    .innerJoin(
      transcriptCache,
      and(eq(transcriptCache.clipId, clipLibrary.id), eq(transcriptCache.language, "en"))
    )
    .where(inArray(clipLibrary.id, args.analogClipIds.slice(0, 5)));

  const collected: ScriptEvidenceQuote[] = [];

  for (const row of rows.slice(0, 3)) {
    const transcript =
      (row.segmentsJson as Array<{ text: string; startMs: number; durationMs: number }> | null) ?? [];
    if (transcript.length === 0) {
      continue;
    }

    try {
      const quotes = await findRelevantQuotes({
        lineText: args.input.storyTitle,
        scriptContext: args.input.notes,
        transcript,
        videoTitle: row.title,
        maxQuotes: 3,
      });

      for (const quote of quotes) {
        const normalizedQuoteText = normalizeQuoteText(quote.quoteText);
        if (!isUsableTranscriptQuote(normalizedQuoteText)) {
          continue;
        }

        collected.push({
          sourceType: "clip_transcript",
          sourceTitle: row.title,
          sourceUrl: row.sourceUrl,
          quoteText: normalizedQuoteText,
          speaker: quote.speaker,
          context: quote.context || `Transcript-backed quote from ${row.title}`,
          relevanceScore: quote.relevanceScore,
          startMs: quote.startMs,
          endMs: quote.endMs,
        });
      }
    } catch {
      // Best-effort quote mining from transcript-backed analog clips.
    }
  }

  return collected
    .sort((left, right) => right.relevanceScore - left.relevanceScore)
    .slice(0, 6);
}

export async function prepareScriptLabPipelineContext(
  input: ScriptLabRequest
): Promise<ScriptLabPipelineContext> {
  const moonAnalysis = await scoreTextAgainstMoonCorpus({
    title: input.storyTitle,
    text: input.researchText,
    maxAnalogs: 5,
  });
  const moonStyleGuide = await getMoonEditorialStyleGuide({
    analogClipIds: moonAnalysis.analogs.map((analog) => analog.clipId),
    coverageMode: moonAnalysis.coverageMode,
  });
  let moonRetentionGuide: Awaited<ReturnType<typeof getMoonRetentionPatternGuide>> | null = null;

  try {
    moonRetentionGuide = await getMoonRetentionPatternGuide({
      preferredCoverageMode: moonAnalysis.coverageMode,
    });
  } catch (error) {
    console.error("[script-lab] Moon retention guide unavailable:", error);
  }

  return {
    input,
    moonAnalysis,
    moonStyleGuide,
    moonRetentionGuide,
    researchPacket: buildResearchPacket(
      input,
      moonAnalysis,
      moonStyleGuide,
      moonRetentionGuide
    ),
    targetWordRange: getTargetWordRange(input.targetRuntimeMinutes),
  };
}

export async function generateResearchStage(args: {
  input: ScriptLabRequest;
  moonAnalysis: Awaited<ReturnType<typeof scoreTextAgainstMoonCorpus>>;
  researchPacket: string;
  seedQuoteEvidence?: ScriptEvidenceQuote[];
}): Promise<ScriptResearchStage> {
  const transcriptQuotes = await collectTranscriptBackedQuotes({
    input: args.input,
    analogClipIds: args.moonAnalysis.analogs.map((analog) => analog.clipId),
  });
  const pastedQuotes = extractResearchQuotes(args.input.researchText);
  const quoteEvidence = dedupeQuoteEvidence([
    ...(args.seedQuoteEvidence ?? []),
    ...transcriptQuotes,
    ...pastedQuotes,
  ]);

  const summary = await createAnthropicJson({
    schema: scriptResearchSummarySchema,
    model: getAnthropicWritingModel(),
    system:
      "You are the research stage of a documentary script agent. Distill the pasted dossier into a sharp thesis, key claims, and risky claims. Return JSON only.",
    user: `${args.researchPacket}

Quote evidence already extracted:
${formatQuoteEvidence(quoteEvidence)}

Return JSON with:
{
  "summary": "1 compact paragraph",
  "thesis": "1 sharp thesis sentence",
  "keyClaims": ["claim 1", "claim 2", "claim 3"],
  "riskyClaims": ["claims that need careful framing"]
}`,
    temperature: 0.35,
    maxTokens: 2200,
  });

  return {
    ...summary,
    quoteEvidence,
  };
}

function buildQuoteSelectionPrompt(args: {
  researchPacket: string;
  researchStage: ScriptResearchStage;
}) {
  return `${args.researchPacket}

Research stage:
${JSON.stringify(args.researchStage, null, 2)}

Choose the strongest direct quotes for the final script.

Rules:
- reject transcript fragments, broken sentences, and weak ASR scraps
- prefer quotes that sound clean enough to read aloud on YouTube
- treat the Moon style packet as binding: pick short, high-impact quote beats, not long quote walls
- if clean transcript-backed quotes exist, prefer at least one of them over weaker article copy
- mark only the most essential quotes as must_use
- if a quote is weak but useful for background, mark it context_only
- sectionHint should reference a likely outline section heading when obvious

Return JSON with:
{
  "selectedQuotes": [
    {
      "quoteId": "Q1",
      "sourceType": "clip_transcript",
      "sourceTitle": "source",
      "sourceUrl": "https://...",
      "quoteText": "exact quote",
      "speaker": null,
      "context": "why this matters",
      "relevanceScore": 88,
      "startMs": 1234,
      "endMs": 2345,
      "usePriority": "must_use",
      "usageRole": "what this quote proves",
      "sectionHint": "section heading or null",
      "qualityNotes": "optional note"
    }
  ],
  "rejectedQuotes": [
    {
      "quoteText": "quote text",
      "reason": "why it was rejected"
    }
  ]
}`;
}

export async function generateQuoteSelectionStage(args: {
  researchPacket: string;
  researchStage: ScriptResearchStage;
}): Promise<ScriptQuoteSelectionStage> {
  return createAnthropicJson({
    schema: scriptQuoteSelectionStageSchema,
    model: getAnthropicWritingModel(),
    system:
      "You are the quote-selection stage of a documentary script agent. Pick only the quotes that are clean, strong, and worth actually using on screen or in narration. Return JSON only.",
    user: buildQuoteSelectionPrompt(args),
    temperature: 0.2,
    maxTokens: 2400,
  });
}

function buildQuotePlacementPrompt(args: {
  researchPacket: string;
  researchStage: ScriptResearchStage;
  outlineStage: ScriptOutlineStage;
  quoteSelectionStage: ScriptQuoteSelectionStage;
}) {
  return `${args.researchPacket}

Research stage:
${JSON.stringify(
    {
      thesis: args.researchStage.thesis,
      keyClaims: args.researchStage.keyClaims,
      riskyClaims: args.researchStage.riskyClaims,
    },
    null,
    2
  )}

Outline stage:
${formatOutlineStage(args.outlineStage)}

Selected quotes:
${formatSelectedQuotes(args.quoteSelectionStage)}

Assign quotes to the outline sections.
Every must_use quote should be attached to a section unless it is clearly unusable after all.
Do not overload sections with too many quotes.
Use quotes where Moon scripts typically spike pressure: an early receipt, a mid-script turn, or a consequence beat.

Return JSON with:
{
  "placements": [
    {
      "sectionHeading": "section heading",
      "placementGoal": "what the quote beat should accomplish",
      "requiredQuoteIds": ["Q1"],
      "optionalQuoteIds": ["Q3"]
    }
  ]
}`;
}

export async function generateQuotePlacementStage(args: {
  researchPacket: string;
  researchStage: ScriptResearchStage;
  outlineStage: ScriptOutlineStage;
  quoteSelectionStage: ScriptQuoteSelectionStage;
}): Promise<ScriptQuotePlacementStage> {
  return createAnthropicJson({
    schema: scriptQuotePlacementStageSchema,
    model: getAnthropicWritingModel(),
    system:
      "You are the quote-placement stage of a documentary script agent. Map selected quotes onto specific sections of the outline. Return JSON only.",
    user: buildQuotePlacementPrompt(args),
    temperature: 0.2,
    maxTokens: 2200,
  });
}

function formatOutlineStage(stage: ScriptOutlineStage) {
  return stage.sections
    .map((section, index) =>
      [
        `${index + 1}. ${section.heading}`,
        `purpose: ${section.purpose}`,
        `beat goal: ${section.beatGoal}`,
        `target words: ${section.targetWordCount}`,
        section.evidenceSlots.length > 0 ? `evidence: ${section.evidenceSlots.join(" | ")}` : null,
      ]
        .filter(Boolean)
        .join("\n")
    )
    .join("\n\n");
}

function formatStoryboardStage(stage: ScriptStoryboardStage) {
  return stage.beats
    .map((beat, index) =>
      [
        `${index + 1}. ${beat.sectionHeading}`,
        `visual approach: ${beat.visualApproach}`,
        beat.visualNotes.length > 0 ? `visual notes: ${beat.visualNotes.join(" | ")}` : null,
        beat.suggestedAssets.length > 0 ? `suggested assets: ${beat.suggestedAssets.join(" | ")}` : null,
      ]
        .filter(Boolean)
        .join("\n")
    )
    .join("\n\n");
}

export function generateStoryboardStage(args: {
  outlineStage: ScriptOutlineStage;
  researchStage: ScriptResearchStage;
}): ScriptStoryboardStage {
  const quoteSources = args.researchStage.quoteEvidence
    .map((quote) => quote.sourceTitle)
    .filter(Boolean)
    .slice(0, 4);

  return {
    beats: args.outlineStage.sections.map((section, index) => {
      const lower = `${section.heading} ${section.purpose} ${section.beatGoal}`.toLowerCase();
      const usesQuotes =
        section.evidenceSlots.some((slot) => /^q\d+/i.test(slot)) && args.researchStage.quoteEvidence.length > 0;

      let visualApproach = "Documentary collage: screenshots, article pull quotes, interface footage, and clean text callouts.";
      const visualNotes: string[] = [];
      const suggestedAssets: string[] = [];

      if (index === 0) {
        visualApproach = "Fast cold-open montage that front-loads the contradiction and makes the audience feel the problem immediately.";
        visualNotes.push("Open on the most unsettling image or claim, not generic setup.");
      } else if (lower.includes("why it matters") || lower.includes("consequence")) {
        visualApproach = "System-level explainer visuals that widen from the incident into incentives, institutions, and fallout.";
      } else if (lower.includes("turn") || lower.includes("reframe")) {
        visualApproach = "Pivot visuals that reveal the hidden layer and reframe the audience's understanding.";
      }

      if (usesQuotes) {
        visualNotes.push("Make room for an on-screen quote beat with attribution and timestamp.");
        suggestedAssets.push(...quoteSources.slice(0, 2));
      }

      if (lower.includes("history") || lower.includes("pattern")) {
        visualNotes.push("Use timeline or precedent montage to show this is a recurring pattern.");
      }

      if (lower.includes("marketing") || lower.includes("rollout")) {
        suggestedAssets.push("social posts", "comment screenshots", "trailer fragments");
      } else if (lower.includes("labor") || lower.includes("vfx")) {
        suggestedAssets.push("behind-the-scenes stills", "trade headlines", "worker quotes");
      } else {
        suggestedAssets.push("headlines", "archival screenshots", "interface footage");
      }

      return {
        sectionHeading: section.heading,
        visualApproach,
        visualNotes: Array.from(new Set(visualNotes)).slice(0, 5),
        suggestedAssets: Array.from(new Set(suggestedAssets)).slice(0, 5),
      };
    }),
  };
}

function buildResearchPacket(
  input: ScriptLabRequest,
  moonAnalysis: Awaited<ReturnType<typeof scoreTextAgainstMoonCorpus>>,
  moonStyleGuide: Awaited<ReturnType<typeof getMoonEditorialStyleGuide>>,
  moonRetentionGuide: Awaited<ReturnType<typeof getMoonRetentionPatternGuide>> | null
) {
  const targetWordRange = getTargetWordRange(input.targetRuntimeMinutes);
  const notesBlock = input.notes ? `\nAdditional notes:\n${input.notes}` : "";

  return [
    `Story title: ${input.storyTitle}`,
    `Target runtime: ${input.targetRuntimeMinutes} minutes`,
    `Ideal script length: about ${targetWordRange.targetWords} words`,
    `Target script length: ${targetWordRange.minWords}-${targetWordRange.maxWords} words`,
    `Moon fit: ${moonAnalysis.moonFitScore} (${moonAnalysis.moonFitBand})`,
    moonAnalysis.clusterLabel ? `Moon cluster: ${moonAnalysis.clusterLabel}` : null,
    moonAnalysis.coverageMode ? `Coverage mode: ${moonAnalysis.coverageMode}` : null,
    moonAnalysis.analogs.length > 0
      ? `Closest Moon analogs: ${moonAnalysis.analogs.slice(0, 4).map((analog) => analog.title).join(" | ")}`
      : null,
    moonAnalysis.reasonCodes.length > 0
      ? `Moon fit reasons: ${moonAnalysis.reasonCodes.join(" | ")}`
      : null,
    "",
    formatMoonStyleGuide(moonStyleGuide),
    moonRetentionGuide ? "" : null,
    moonRetentionGuide ? formatMoonRetentionPatternGuide(moonRetentionGuide) : null,
    notesBlock.trim() ? notesBlock.trim() : null,
    "",
    "Research dossier:",
    input.researchText,
  ]
    .filter(Boolean)
    .join("\n");
}

function formatMoonStyleGuide(
  styleGuide: Awaited<ReturnType<typeof getMoonEditorialStyleGuide>>
) {
  return [
    "Moon style packet (binding for every stage):",
    `- Reference sample: ${styleGuide.sampleSize} Moon transcripts weighted toward the closest analogs and current coverage mode.`,
    styleGuide.medianWordCount && styleGuide.medianDurationMinutes && styleGuide.medianWordsPerMinute
      ? `- Typical script heft: about ${styleGuide.medianWordCount} words over ${styleGuide.medianDurationMinutes} minutes, roughly ${styleGuide.medianWordsPerMinute} spoken words per minute.`
      : null,
    styleGuide.dominantCoverageModes.length > 0
      ? `- Coverage gravity: ${styleGuide.dominantCoverageModes.join(" | ")}`
      : null,
    styleGuide.referenceTitles.length > 0
      ? `- Reference titles: ${styleGuide.referenceTitles.slice(0, 6).join(" | ")}`
      : null,
    styleGuide.storySpecificNotes.length > 0 ? "- Story-specific analog opener modes:" : null,
    ...styleGuide.storySpecificNotes.slice(0, 4).map((item) => `  - ${item}`),
    "- Opener habits:",
    ...styleGuide.openerPatterns.map((item) => `  - ${item}`),
    "- Phrasing habits:",
    ...styleGuide.phrasingPatterns.map((item) => `  - ${item}`),
    "- Pacing habits:",
    ...styleGuide.pacingPatterns.map((item) => `  - ${item}`),
    "- Quote habits:",
    ...styleGuide.quotePatterns.map((item) => `  - ${item}`),
    "- Structure habits:",
    ...styleGuide.structurePatterns.map((item) => `  - ${item}`),
    "- Transition habits:",
    ...styleGuide.transitionPatterns.map((item) => `  - ${item}`),
    "- Avoid:",
    ...styleGuide.antiPatterns.map((item) => `  - ${item}`),
  ]
    .filter(Boolean)
    .join("\n");
}

function buildStagePacket(args: {
  researchStage: ScriptResearchStage;
  quoteSelectionStage?: ScriptQuoteSelectionStage;
  outlineStage: ScriptOutlineStage;
  quotePlacementStage?: ScriptQuotePlacementStage;
  storyboardStage: ScriptStoryboardStage;
}) {
  return [
    "Structured research stage:",
    `summary: ${args.researchStage.summary}`,
    `thesis: ${args.researchStage.thesis}`,
    `key claims: ${args.researchStage.keyClaims.join(" | ")}`,
    args.researchStage.riskyClaims.length > 0
      ? `risky claims: ${args.researchStage.riskyClaims.join(" | ")}`
      : null,
    "",
    "Quote evidence:",
    formatQuoteEvidence(args.researchStage.quoteEvidence),
    args.quoteSelectionStage
      ? ["", "Selected quotes:", formatSelectedQuotes(args.quoteSelectionStage)].join("\n")
      : null,
    "",
    "Outline stage:",
    formatOutlineStage(args.outlineStage),
    args.quotePlacementStage
      ? ["", "Quote placements:", formatQuotePlacementStage(args.quotePlacementStage)].join("\n")
      : null,
    "",
    "Storyboard stage:",
    formatStoryboardStage(args.storyboardStage),
  ]
    .filter(Boolean)
    .join("\n");
}

function buildSectionContextPacket(args: {
  researchStage: ScriptResearchStage;
  quoteSelectionStage?: ScriptQuoteSelectionStage;
  outlineStage: ScriptOutlineStage;
  quotePlacementStage?: ScriptQuotePlacementStage;
  storyboardStage: ScriptStoryboardStage;
  sectionHeading: string;
}) {
  const outlineSection = args.outlineStage.sections.find(
    (section) => section.heading === args.sectionHeading
  );
  const storyboardBeat = args.storyboardStage.beats.find(
    (beat) => beat.sectionHeading === args.sectionHeading
  );
  const quotePlacement = args.quotePlacementStage?.placements.find(
    (placement) => placement.sectionHeading === args.sectionHeading
  );
  const selectedQuotesById = new Map(
    (args.quoteSelectionStage?.selectedQuotes ?? []).map((quote) => [quote.quoteId, quote])
  );
  const requiredQuoteDetails = (quotePlacement?.requiredQuoteIds ?? [])
    .map((quoteId) => selectedQuotesById.get(quoteId))
    .filter(Boolean)
    .map((quote) =>
      [
        `${quote!.quoteId}: "${quote!.quoteText}"`,
        quote!.speaker ? `speaker: ${quote!.speaker}` : null,
        `source note: ${buildInlineSourceNote(quote!)}`,
        `usage role: ${quote!.usageRole}`,
        quote!.context ? `context: ${quote!.context}` : null,
      ]
        .filter(Boolean)
        .join(" | ")
    );
  const optionalQuoteDetails = (quotePlacement?.optionalQuoteIds ?? [])
    .map((quoteId) => selectedQuotesById.get(quoteId))
    .filter(Boolean)
    .map((quote) =>
      [
        `${quote!.quoteId}: "${quote!.quoteText}"`,
        quote!.speaker ? `speaker: ${quote!.speaker}` : null,
        `source note: ${buildInlineSourceNote(quote!)}`,
        `usage role: ${quote!.usageRole}`,
        quote!.context ? `context: ${quote!.context}` : null,
      ]
        .filter(Boolean)
        .join(" | ")
    );

  return [
    `Section heading: ${args.sectionHeading}`,
    outlineSection ? `purpose: ${outlineSection.purpose}` : null,
    outlineSection ? `beat goal: ${outlineSection.beatGoal}` : null,
    outlineSection ? `target words: ${outlineSection.targetWordCount}` : null,
    outlineSection && outlineSection.evidenceSlots.length > 0
      ? `evidence slots: ${outlineSection.evidenceSlots.join(" | ")}`
      : null,
    storyboardBeat ? `visual approach: ${storyboardBeat.visualApproach}` : null,
    storyboardBeat && storyboardBeat.visualNotes.length > 0
      ? `visual notes: ${storyboardBeat.visualNotes.join(" | ")}`
      : null,
    storyboardBeat && storyboardBeat.suggestedAssets.length > 0
      ? `suggested assets: ${storyboardBeat.suggestedAssets.join(" | ")}`
      : null,
    quotePlacement ? `quote placement goal: ${quotePlacement.placementGoal}` : null,
    requiredQuoteDetails.length > 0 ? `required quotes: ${requiredQuoteDetails.join(" | ")}` : null,
    optionalQuoteDetails.length > 0 ? `optional quotes: ${optionalQuoteDetails.join(" | ")}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

function getTargetWordRange(targetRuntimeMinutes: number) {
  const targetWords = targetRuntimeMinutes >= 10
    ? Math.max(2500, Math.round(targetRuntimeMinutes * 205))
    : Math.round(targetRuntimeMinutes * 185);
  const minWords = Math.max(600, targetWords - (targetRuntimeMinutes >= 10 ? 200 : 120));
  const maxWords = Math.max(minWords + 220, targetWords + (targetRuntimeMinutes >= 10 ? 200 : 150));
  return {
    targetWords,
    minWords,
    maxWords,
  };
}

function countWords(text: string) {
  return text
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function buildOutlinePrompt(args: {
  researchPacket: string;
  researchStage: ScriptResearchStage;
  targetWordRange: { targetWords: number; minWords: number; maxWords: number };
}) {
  return `${args.researchPacket}

Structured research stage:
${JSON.stringify(args.researchStage, null, 2)}

Build the outline for the full script.
Aim for about ${args.targetWordRange.targetWords} words total.
The final script must land in the ${args.targetWordRange.minWords}-${args.targetWordRange.maxWords} word range.
Follow the Moon pacing packet above: anomaly -> mechanism -> system -> turn -> consequence.
Return JSON with:
{
  "sections": [
    {
      "heading": "section name",
      "purpose": "what this section does",
      "beatGoal": "what the viewer should feel/learn",
      "targetWordCount": 250,
      "evidenceSlots": ["Q1", "Q2"]
    }
  ]
}`;
}

function buildSectionPlanPrompt(args: {
  researchPacket: string;
  researchStage: ScriptResearchStage;
  quoteSelectionStage: ScriptQuoteSelectionStage;
  outlineStage: ScriptOutlineStage;
  quotePlacementStage: ScriptQuotePlacementStage;
  storyboardStage: ScriptStoryboardStage;
}) {
  return `${args.researchPacket}

${buildStagePacket({
  researchStage: args.researchStage,
  quoteSelectionStage: args.quoteSelectionStage,
  outlineStage: args.outlineStage,
  quotePlacementStage: args.quotePlacementStage,
  storyboardStage: args.storyboardStage,
})}

Turn the outline into a section-by-section writing plan for a spoken documentary script.
Each section should specify its job, how it opens, how it closes, and which evidence matters most.
The plan should be practical for sequential writing, where each section will be written in its own model call.
If a section has required quotes, keep them in requiredEvidence so the writing stage cannot ignore them.
Section openings and closings should keep the Moon pressure curve moving rather than flattening into recap.

Return JSON with:
{
  "sections": [
    {
      "sectionHeading": "section name",
      "narrativeRole": "what this section contributes to the larger story",
      "targetWordCount": 320,
      "requiredEvidence": ["Q1", "timeline beat"],
      "openingMove": "how the section should begin",
      "closingMove": "how the section should hand off to the next section"
    }
  ]
}`;
}

function buildWriteSectionPrompt(args: {
  researchPacket: string;
  researchStage: ScriptResearchStage;
  quoteSelectionStage: ScriptQuoteSelectionStage;
  outlineStage: ScriptOutlineStage;
  quotePlacementStage: ScriptQuotePlacementStage;
  storyboardStage: ScriptStoryboardStage;
  sectionPlan: ScriptSectionPlanStage["sections"][number];
  sectionResearchBrief?: string | null;
  sectionIndex: number;
  totalSections: number;
  previousSectionsText: string;
  nextSectionHeading: string | null;
}) {
  const priorContext = args.previousSectionsText.trim()
    ? `Previous approved script context:\n${trimToLength(args.previousSectionsText, 6000)}`
    : "Previous approved script context:\nNone. This is the first section.";

  return `${args.researchPacket}

Research summary:
${JSON.stringify(
    {
      thesis: args.researchStage.thesis,
      keyClaims: args.researchStage.keyClaims,
      riskyClaims: args.researchStage.riskyClaims,
    },
    null,
    2
  )}

Relevant quote evidence:
${formatQuoteEvidence(args.researchStage.quoteEvidence)}

Section context:
${buildSectionContextPacket({
  researchStage: args.researchStage,
  quoteSelectionStage: args.quoteSelectionStage,
  outlineStage: args.outlineStage,
  quotePlacementStage: args.quotePlacementStage,
  storyboardStage: args.storyboardStage,
  sectionHeading: args.sectionPlan.sectionHeading,
})}

Section-specific follow-up research:
${args.sectionResearchBrief?.trim() ? args.sectionResearchBrief : "No extra section-specific follow-up research was attached beyond the global research packet."}

Section plan:
${JSON.stringify(args.sectionPlan, null, 2)}

${priorContext}

You are writing section ${args.sectionIndex + 1} of ${args.totalSections}.
Write only this section. Do not rewrite previous sections.
Keep the voice spoken, skeptical, and documentary-driven.
Treat the Moon style packet in the research block as binding, especially for opener pressure, causal transitions, and quote restraint.
Use the evidence and quote bank where it improves specificity.
If required quotes are listed for this section, work in at least one of them directly. Prefer exact wording over paraphrase when it still sounds natural aloud.
Target ${args.sectionPlan.targetWordCount} words for this section.
End in a way that naturally points toward ${args.nextSectionHeading ?? "the ending"}.

Return JSON with:
{
  "sectionHeading": "${args.sectionPlan.sectionHeading}",
  "script": "the full section text with paragraph breaks",
  "targetWordCount": ${args.sectionPlan.targetWordCount},
  "actualWordCount": 320,
  "evidenceUsed": ["Q1", "timeline beat"],
  "transitionOut": "one short sentence describing how this section hands off"
}`;
}

function buildReviseSectionPrompt(args: {
  researchPacket: string;
  researchStage: ScriptResearchStage;
  quoteSelectionStage: ScriptQuoteSelectionStage;
  outlineStage: ScriptOutlineStage;
  quotePlacementStage: ScriptQuotePlacementStage;
  storyboardStage: ScriptStoryboardStage;
  sectionPlan: ScriptSectionPlanStage["sections"][number];
  sectionResearchBrief?: string | null;
  currentSection: ScriptSectionDraftsStage["sections"][number];
  sectionIndex: number;
  totalSections: number;
  previousSectionsText: string;
  nextSectionHeading: string | null;
  critique: ScriptCritique;
  retentionStage: ScriptRetentionStage;
}) {
  const priorContext = args.previousSectionsText.trim()
    ? `Previous revised script context:\n${trimToLength(args.previousSectionsText, 6000)}`
    : "Previous revised script context:\nNone. This is the first section.";

  return `${args.researchPacket}

Research summary:
${JSON.stringify(
    {
      thesis: args.researchStage.thesis,
      keyClaims: args.researchStage.keyClaims,
      riskyClaims: args.researchStage.riskyClaims,
    },
    null,
    2
  )}

Section context:
${buildSectionContextPacket({
  researchStage: args.researchStage,
  quoteSelectionStage: args.quoteSelectionStage,
  outlineStage: args.outlineStage,
  quotePlacementStage: args.quotePlacementStage,
  storyboardStage: args.storyboardStage,
  sectionHeading: args.sectionPlan.sectionHeading,
})}

Section-specific follow-up research:
${args.sectionResearchBrief?.trim() ? args.sectionResearchBrief : "No extra section-specific follow-up research was attached beyond the global research packet."}

Current section draft:
${JSON.stringify(args.currentSection, null, 2)}

Editorial critique:
${JSON.stringify(args.critique, null, 2)}

Retention notes:
${JSON.stringify(args.retentionStage, null, 2)}

${priorContext}

Revise only this section.
Keep continuity with the previous revised sections.
Preserve the strongest lines, sharpen weak phrasing, and fix issues that apply to this section.
Keep the Moon pacing packet intact: the section should either raise pressure, cash out a mechanism, or widen the consequence.
Preserve required quotes for this section unless they are clearly unusable, and if you drop one, replace it with another required or optional quote from the same section context.
Target ${args.sectionPlan.targetWordCount} words.
End in a way that naturally points toward ${args.nextSectionHeading ?? "the ending"}.
Treat the Moon retention packet in the research block as binding evidence about what recent Moon openings, middles, and payoffs actually hold.

Return JSON with:
{
  "sectionHeading": "${args.sectionPlan.sectionHeading}",
  "script": "the revised section text with paragraph breaks",
  "targetWordCount": ${args.sectionPlan.targetWordCount},
  "actualWordCount": 320,
  "evidenceUsed": ["Q1", "timeline beat"],
  "transitionOut": "one short sentence describing how this section hands off"
}`;
}

function buildDraftPrompt(args: {
  researchPacket: string;
  researchStage: ScriptResearchStage;
  outlineStage: ScriptOutlineStage;
  storyboardStage: ScriptStoryboardStage;
}) {
  return `${args.researchPacket}

${buildStagePacket({
  researchStage: args.researchStage,
  outlineStage: args.outlineStage,
  storyboardStage: args.storyboardStage,
})}

Write a full original video script in this structure:
1. Cold open
2. Expansion
3. Why it matters
4. Escalation
5. Turn
6. Landing / next-beat transition

Aim for a spoken documentary voice that would actually be recordable. Avoid section labels in the script body itself.
Prioritize clean spoken rhythm over essay transitions. Avoid canned contrast templates, and if this is a fresh story, avoid putting precise calendar dates in the opener unless the exact date is the point.
Hard requirement: the script body must land inside the requested word range. Do not hand in a short draft. If you are under length, deepen the evidence, consequences, and connective tissue without padding or recap.
Follow the Moon style packet and the Moon retention packet in the research block, especially the opener, structure, pacing, and quote rules.
Aim near the requested target length, not the top of the range, unless the material genuinely needs the extra room.

Return JSON with this schema:
{
  "title": "working internal title",
  "deck": "1-sentence framing line",
  "script": "the full script with paragraph breaks",
  "beats": ["beat 1", "beat 2", "beat 3"],
  "angle": "main editorial angle",
  "warnings": ["weak-evidence note if needed"]
}`;
}

function buildMetadataPrompt(args: {
  researchPacket: string;
  researchStage: ScriptResearchStage;
  outlineStage: ScriptOutlineStage;
  sectionDrafts: ScriptSectionDraftsStage;
  scriptText: string;
}) {
  return `${args.researchPacket}

Research summary:
${JSON.stringify(
    {
      thesis: args.researchStage.thesis,
      keyClaims: args.researchStage.keyClaims,
      riskyClaims: args.researchStage.riskyClaims,
    },
    null,
    2
  )}

Outline:
${JSON.stringify(args.outlineStage, null, 2)}

Completed section drafts:
${JSON.stringify(args.sectionDrafts, null, 2)}

Assembled script:
${args.scriptText}

Return JSON with only the script metadata:
{
  "title": "working internal title",
  "deck": "1-sentence framing line",
  "beats": ["beat 1", "beat 2", "beat 3"],
  "angle": "main editorial angle",
  "warnings": ["weak-evidence note if needed"]
}`;
}

export async function generateOutlineStage(args: {
  researchPacket: string;
  researchStage: ScriptResearchStage;
  targetWordRange: { targetWords: number; minWords: number; maxWords: number };
}): Promise<ScriptOutlineStage> {
  return createAnthropicJson({
    schema: scriptOutlineStageSchema,
    model: getAnthropicWritingModel(),
    system:
      "You are the outline stage of a documentary script agent. Build a section-level beat map that is tight, evidentiary, and paced for YouTube retention. Return JSON only.",
    user: buildOutlinePrompt(args),
    temperature: 0.35,
    maxTokens: 2600,
  });
}

export async function generateSectionPlanStage(args: {
  researchPacket: string;
  researchStage: ScriptResearchStage;
  quoteSelectionStage: ScriptQuoteSelectionStage;
  outlineStage: ScriptOutlineStage;
  quotePlacementStage: ScriptQuotePlacementStage;
  storyboardStage: ScriptStoryboardStage;
}): Promise<ScriptSectionPlanStage> {
  const buildFallbackPlan = (): ScriptSectionPlanStage => ({
    sections: args.outlineStage.sections.map((section, index) => {
      const placement = args.quotePlacementStage.placements.find(
        (item) => item.sectionHeading === section.heading
      );
      const storyboardBeat = args.storyboardStage.beats.find(
        (beat) => beat.sectionHeading === section.heading
      );
      const nextSection = args.outlineStage.sections[index + 1];
      const mergedEvidence = Array.from(
        new Set([
          ...(section.evidenceSlots ?? []),
          ...(placement?.requiredQuoteIds ?? []),
          ...(placement?.optionalQuoteIds ?? []),
        ])
      ).slice(0, 6);

      return {
        sectionHeading: section.heading,
        narrativeRole: section.purpose,
        targetWordCount: section.targetWordCount,
        requiredEvidence: mergedEvidence,
        openingMove:
          placement?.placementGoal ??
          storyboardBeat?.visualApproach ??
          section.beatGoal,
        closingMove: nextSection
          ? `Pivot cleanly into ${nextSection.heading.toLowerCase()}.`
          : "Land the section with a clean, forward-driving final beat.",
      };
    }),
  });

  let generatedPlan: ScriptSectionPlanStage;

  try {
    generatedPlan = await createAnthropicJson({
      schema: scriptSectionPlanStageSchema,
      model: getAnthropicWritingModel(),
      system:
        "You are the section-planning stage of a documentary script agent. Turn an outline into a practical sequential writing plan. Return JSON only.",
      user: buildSectionPlanPrompt(args),
      temperature: 0.3,
      maxTokens: 2600,
    });
  } catch {
    generatedPlan = buildFallbackPlan();
  }

  return {
    sections: generatedPlan.sections.map((section) => {
      const placement = args.quotePlacementStage.placements.find(
        (item) => item.sectionHeading === section.sectionHeading
      );
      const mergedEvidence = Array.from(
        new Set([
          ...(section.requiredEvidence ?? []),
          ...(placement?.requiredQuoteIds ?? []),
          ...(placement?.optionalQuoteIds ?? []),
        ])
      ).slice(0, 6);

      return {
        ...section,
        requiredEvidence: mergedEvidence,
      };
    }),
  };
}

export async function writeSectionDraftsStage(args: {
  context: ScriptLabPipelineContext;
  researchStage: ScriptResearchStage;
  quoteSelectionStage: ScriptQuoteSelectionStage;
  outlineStage: ScriptOutlineStage;
  quotePlacementStage: ScriptQuotePlacementStage;
  storyboardStage: ScriptStoryboardStage;
  sectionPlanStage: ScriptSectionPlanStage;
  sectionResearchBriefs?: Record<string, string>;
}): Promise<ScriptSectionDraftsStage> {
  const sections: ScriptSectionDraftsStage["sections"] = [];
  let previousSectionsText = "";

  for (const [index, sectionPlan] of args.sectionPlanStage.sections.entries()) {
    const nextSectionHeading = args.sectionPlanStage.sections[index + 1]?.sectionHeading ?? null;
    const sectionDraft = await createAnthropicJson({
      schema: scriptSectionDraftItemSchema,
      model: getAnthropicWritingModel(),
      system:
        `${SCRIPT_STYLE_SYSTEM_PROMPT}\n` +
        "You are writing one section of a documentary script at a time. Return JSON only.",
      user: buildWriteSectionPrompt({
        researchPacket: args.context.researchPacket,
        researchStage: args.researchStage,
        quoteSelectionStage: args.quoteSelectionStage,
        outlineStage: args.outlineStage,
        quotePlacementStage: args.quotePlacementStage,
        storyboardStage: args.storyboardStage,
        sectionPlan,
        sectionResearchBrief: args.sectionResearchBriefs?.[sectionPlan.sectionHeading] ?? null,
        sectionIndex: index,
        totalSections: args.sectionPlanStage.sections.length,
        previousSectionsText,
        nextSectionHeading,
      }),
      temperature: 0.7,
      maxTokens: 3200,
    });

    const normalizedSection = {
      ...sectionDraft,
      actualWordCount: countWords(sectionDraft.script),
    };

    sections.push(normalizedSection);
    previousSectionsText = `${previousSectionsText}\n\n${normalizedSection.script}`.trim();
  }

  return { sections };
}

export async function assembleScriptDraftFromSections(args: {
  researchPacket: string;
  researchStage: ScriptResearchStage;
  outlineStage: ScriptOutlineStage;
  sectionDrafts: ScriptSectionDraftsStage;
}): Promise<ScriptDraft> {
  const script = args.sectionDrafts.sections.map((section) => section.script.trim()).join("\n\n");
  const metadata = await createAnthropicJson({
    schema: scriptDraftMetadataSchema,
    model: getAnthropicWritingModel(),
    system:
      "You are assembling script metadata for a documentary script that has already been written section by section. Return JSON only.",
    user: buildMetadataPrompt({
      researchPacket: args.researchPacket,
      researchStage: args.researchStage,
      outlineStage: args.outlineStage,
      sectionDrafts: args.sectionDrafts,
      scriptText: script,
    }),
    temperature: 0.25,
    maxTokens: 1800,
  });

  return {
    ...metadata,
    script,
  };
}

export async function critiqueScriptDraft(args: {
  researchPacket: string;
  otherLabel: string;
  otherDraft: ScriptDraft;
}): Promise<ScriptCritique> {
  return createAnthropicJson({
    schema: scriptCritiqueSchema,
    model: getAnthropicWritingModel(),
    system: "You are a ruthless documentary script editor. Be concrete, unsentimental, and useful. Return JSON only.",
    user: buildCritiquePrompt(args),
    temperature: 0.3,
    maxTokens: 2200,
  });
}

export async function analyzeRetentionStage(args: {
  researchPacket: string;
  researchStage: ScriptResearchStage;
  outlineStage: ScriptOutlineStage;
  claudeDraft: ScriptDraft;
}): Promise<ScriptRetentionStage> {
  return createAnthropicJson({
    schema: scriptRetentionStageSchema,
    model: getAnthropicWritingModel(),
    system:
      "You are the retention-analysis stage of a documentary YouTube writing agent. Diagnose hook strength, dead zones, and pacing issues with zero fluff. Return JSON only.",
    user: buildRetentionPrompt(args),
    temperature: 0.25,
    maxTokens: 2200,
  });
}

export async function reviseSectionDraftsStage(args: {
  context: ScriptLabPipelineContext;
  researchStage: ScriptResearchStage;
  quoteSelectionStage: ScriptQuoteSelectionStage;
  outlineStage: ScriptOutlineStage;
  quotePlacementStage: ScriptQuotePlacementStage;
  storyboardStage: ScriptStoryboardStage;
  sectionPlanStage: ScriptSectionPlanStage;
  sectionDrafts: ScriptSectionDraftsStage;
  critique: ScriptCritique;
  retentionStage: ScriptRetentionStage;
  sectionResearchBriefs?: Record<string, string>;
}): Promise<ScriptSectionDraftsStage> {
  const sections: ScriptSectionDraftsStage["sections"] = [];
  let previousSectionsText = "";

  for (const [index, sectionPlan] of args.sectionPlanStage.sections.entries()) {
    const currentSection = args.sectionDrafts.sections[index];
    const nextSectionHeading = args.sectionPlanStage.sections[index + 1]?.sectionHeading ?? null;
    const revisedSection = await createAnthropicJson({
      schema: scriptSectionDraftItemSchema,
      model: getAnthropicWritingModel(),
      system:
        `${SCRIPT_STYLE_SYSTEM_PROMPT}\n` +
        "You are revising one section of a documentary script at a time. Return JSON only.",
      user: buildReviseSectionPrompt({
        researchPacket: args.context.researchPacket,
        researchStage: args.researchStage,
        quoteSelectionStage: args.quoteSelectionStage,
        outlineStage: args.outlineStage,
        quotePlacementStage: args.quotePlacementStage,
        storyboardStage: args.storyboardStage,
        sectionPlan,
        sectionResearchBrief: args.sectionResearchBriefs?.[sectionPlan.sectionHeading] ?? null,
        currentSection,
        sectionIndex: index,
        totalSections: args.sectionPlanStage.sections.length,
        previousSectionsText,
        nextSectionHeading,
        critique: args.critique,
        retentionStage: args.retentionStage,
      }),
      temperature: 0.5,
      maxTokens: 3200,
    });

    const normalizedSection = {
      ...revisedSection,
      actualWordCount: countWords(revisedSection.script),
    };

    sections.push(normalizedSection);
    previousSectionsText = `${previousSectionsText}\n\n${normalizedSection.script}`.trim();
  }

  return { sections };
}

export async function polishScriptDraft(args: {
  researchPacket: string;
  draft: ScriptDraft;
  styleFlags: string[];
}): Promise<ScriptDraft> {
  const polishedDraft = await createAnthropicJson({
    schema: scriptDraftSchema,
    model: getAnthropicWritingModel(),
    system:
      `${SCRIPT_STYLE_SYSTEM_PROMPT}\n` +
      "You are now the final voice pass. Remove canned AI-sounding phrasing, keep the reporting intact, and return JSON only.",
    user: buildPolishPrompt(args),
    temperature: 0.35,
    maxTokens: 9000,
  });

  return ensureDraftHasSourceNotes({
    researchPacket: args.researchPacket,
    draft: polishedDraft,
  });
}

function buildCritiquePrompt(args: {
  researchPacket: string;
  otherLabel: string;
  otherDraft: ScriptDraft;
}) {
  return `${args.researchPacket}

You are reviewing a script draft written by ${args.otherLabel}.
Critique it against this rubric: ${CRITIQUE_RUBRIC}.
Use the Moon style packet in the research block as the standard, not generic documentary prose.

Draft to critique:
Title: ${args.otherDraft.title}
Deck: ${args.otherDraft.deck}
Angle: ${args.otherDraft.angle}
Beats: ${args.otherDraft.beats.join(" | ")}

Script:
${args.otherDraft.script}

Return JSON with:
{
  "strengths": ["..."],
  "weaknesses": ["..."],
  "mustFix": ["..."],
  "keep": ["..."],
  "verdict": "1 short paragraph"
}`;
}

function buildFinalPrompt(args: {
  researchPacket: string;
  researchStage: ScriptResearchStage;
  outlineStage: ScriptOutlineStage;
  storyboardStage: ScriptStoryboardStage;
  retentionStage: ScriptRetentionStage;
  claudeDraft: ScriptDraft;
  claudeCritique: ScriptCritique;
}) {
  return `${args.researchPacket}

${buildStagePacket({
  researchStage: args.researchStage,
  outlineStage: args.outlineStage,
  storyboardStage: args.storyboardStage,
})}

Retention stage:
${JSON.stringify(args.retentionStage, null, 2)}

You are rewriting a first-pass Claude draft into the strongest final version.
Obey the critique notes. Fix weak openings, generic phrasing, overclaiming, dead sections, canned AI-style contrast templates, and date-heavy narration that sounds unnatural for a fresh story. Work actual quote evidence into the script where it improves specificity and credibility. Keep what is specific, sharp, and actually supported.
Keep the Moon style packet and the Moon retention packet in the research block fully intact while rewriting.

Claude draft:
${JSON.stringify(args.claudeDraft, null, 2)}

Editorial critique of the Claude draft:
${JSON.stringify(args.claudeCritique, null, 2)}

Return the best final script as JSON with:
{
  "title": "working internal title",
  "deck": "1-sentence framing line",
  "script": "the final script with paragraph breaks",
  "beats": ["beat 1", "beat 2", "beat 3"],
  "angle": "main editorial angle",
  "warnings": ["weak-evidence note if needed"]
}`;
}

function buildRetentionPrompt(args: {
  researchPacket: string;
  researchStage: ScriptResearchStage;
  outlineStage: ScriptOutlineStage;
  claudeDraft: ScriptDraft;
}) {
  return `${args.researchPacket}

Structured research stage:
${JSON.stringify(args.researchStage, null, 2)}

Outline stage:
${JSON.stringify(args.outlineStage, null, 2)}

Draft to audit:
${JSON.stringify(args.claudeDraft, null, 2)}

You are the retention analysis stage for a documentary YouTube script.
Identify whether the hook is strong, where the script drags, what curiosity loops keep the viewer moving, and what absolutely has to change before final.
Judge the draft against the Moon style packet and the Moon retention packet in the research block, especially the opener pressure curve and the anomaly -> mechanism -> system -> consequence structure.

Return JSON with:
{
  "hookAssessment": "1 paragraph",
  "keepWatchingMoments": ["moment 1", "moment 2"],
  "deadZones": ["dead zone 1"],
  "mustFix": ["fix 1", "fix 2"],
  "pacingNotes": ["note 1", "note 2"]
}`;
}

function buildExpansionPrompt(args: {
  researchPacket: string;
  draft: ScriptDraft;
  currentWords: number;
  minWords: number;
  maxWords: number;
}) {
  return `${args.researchPacket}

The current script is too short.
Current word count: ${args.currentWords}
Required word range: ${args.minWords}-${args.maxWords}
Aim for the middle of that range unless the evidence truly needs more room.

Expand the script by adding:
- more concrete evidence and examples
- stronger causal links between beats
- deeper consequence and system analysis
- smoother connective tissue between sections

Do not pad with recap, throat-clearing, or generic hype.
Do not add fake facts.
Keep the tone natural and spoken.
Preserve the Moon pacing packet while expanding: add depth without flattening the hook or the later turn.

Current draft:
${JSON.stringify(args.draft, null, 2)}

Return the improved script as JSON with:
{
  "title": "working internal title",
  "deck": "1-sentence framing line",
  "script": "the expanded script with paragraph breaks",
  "beats": ["beat 1", "beat 2", "beat 3"],
  "angle": "main editorial angle",
  "warnings": ["weak-evidence note if needed"]
}`;
}

function lintDraftStyle(args: { input: ScriptLabRequest; draft: ScriptDraft }) {
  const flags: string[] = [];
  const script = args.draft.script;

  for (const rule of STYLE_LINT_RULES) {
    const matches = Array.from(script.matchAll(rule.pattern));
    if (matches.length > 0) {
      flags.push(`${rule.code} x${matches.length}: ${rule.description}`);
    }
  }

  const researchLower = args.input.researchText.toLowerCase();
  const opener = script.slice(0, 900);
  const openerMatches = Array.from(opener.matchAll(OPENER_CALENDAR_DATE_PATTERN));
  const recentStorySignals = [
    /\btoday\b/,
    /\byesterday\b/,
    /\bthis week\b/,
    /\blast week\b/,
    /\bjust broke\b/,
    /\brecently\b/,
    new RegExp(`\\b${new Date().getFullYear()}\\b`),
  ];
  const looksRecent = recentStorySignals.some((pattern) => pattern.test(researchLower));

  if (looksRecent && openerMatches.length > 0) {
    flags.push(
      `opener:calendar-dates x${openerMatches.length}: avoid stiff calendar-date narration in the opening of a fresh story unless chronology is the point`
    );
  }

  return flags.slice(0, 10);
}

function countSourceNotes(text: string) {
  return Array.from(text.matchAll(/\[Source:/g)).length;
}

function getMinimumSourceNoteCount(text: string) {
  const wordCount = countWords(text);
  return Math.max(4, Math.min(12, Math.ceil(wordCount / 300)));
}

function buildSourceNoteRepairPrompt(args: {
  researchPacket: string;
  draft: ScriptDraft;
  minSourceNotes: number;
}) {
  return `${args.researchPacket}

You are repairing a documentary script draft so the sourcing is visible inline for editors.
Keep the structure, angle, and voice intact. Make the smallest necessary wording changes.
Preserve the Moon cadence and pressure curve while adding source notes.

${buildSourceNoteGuidance()}

Additional rules:
- Preserve the current script order and paragraphing.
- Add or preserve at least ${args.minSourceNotes} source notes across the draft.
- Reuse only sources that actually appear in the research packet or existing draft.
- Do not invent URLs, outlets, titles, or timestamps.
- If a matching source URL exists in the research packet, include it in the [Source: ...] note.
- If a matching source note does not include a timestamp, do not add one.
- If a paragraph already has a correct [Source: ...] note, keep it.

Current draft:
${JSON.stringify(args.draft, null, 2)}

Return JSON with:
{
  "title": "working internal title",
  "deck": "1-sentence framing line",
  "script": "the same script with inline source notes added or repaired",
  "beats": ["beat 1", "beat 2", "beat 3"],
  "angle": "main editorial angle",
  "warnings": ["weak-evidence note if needed"]
}`;
}

async function ensureDraftHasSourceNotes(args: {
  researchPacket: string;
  draft: ScriptDraft;
  minSourceNotes?: number;
}) {
  const minSourceNotes = args.minSourceNotes ?? getMinimumSourceNoteCount(args.draft.script);
  if (countSourceNotes(args.draft.script) >= minSourceNotes) {
    return args.draft;
  }

  return createAnthropicJson({
    schema: scriptDraftSchema,
    model: getAnthropicWritingModel(),
    system:
      `${SCRIPT_STYLE_SYSTEM_PROMPT}\n` +
      "You are adding missing inline source notes to a documentary script. Return JSON only.",
    user: buildSourceNoteRepairPrompt({
      researchPacket: args.researchPacket,
      draft: args.draft,
      minSourceNotes,
    }),
    temperature: 0.2,
    maxTokens: 9000,
  });
}

function buildPolishPrompt(args: {
  researchPacket: string;
  draft: ScriptDraft;
  styleFlags: string[];
}) {
  const flagBlock =
    args.styleFlags.length > 0
      ? args.styleFlags.map((flag) => `- ${flag}`).join("\n")
      : "- No explicit lint flags, but still tighten voice and rhythm.";

  return `${args.researchPacket}

You are doing the final voice pass on a documentary YouTube script.
Preserve the core reporting, argument, and strongest lines, but rewrite wherever the prose sounds canned, overly essay-like, or machine-written.

Primary goals:
- remove canned contrast scaffolding
- remove stock transitions and weak signposting
- make every paragraph sound spoken aloud
- keep the tone skeptical, sharp, and natural
- for fresh stories, avoid calendar-date narration in the opener unless the date itself matters
- keep the strongest information up front
- preserve the Moon pacing packet rather than polishing the script into generic explainer prose

Detected style issues:
${flagBlock}

Current draft:
${JSON.stringify(args.draft, null, 2)}

Return the improved final script as JSON with:
{
  "title": "working internal title",
  "deck": "1-sentence framing line",
  "script": "the final script with paragraph breaks",
  "beats": ["beat 1", "beat 2", "beat 3"],
  "angle": "main editorial angle",
  "warnings": ["weak-evidence note if needed"]
}`;
}

export async function expandDraftToMinimumLength(args: {
  input: ScriptLabRequest;
  researchPacket: string;
  draft: ScriptDraft;
}) {
  const targetWordRange = getTargetWordRange(args.input.targetRuntimeMinutes);
  let currentDraft = args.draft;
  let currentWordCount = countWords(currentDraft.script);
  const expansionNotes: string[] = [];

  for (let attempt = 0; attempt < 2 && currentWordCount < targetWordRange.minWords; attempt += 1) {
    currentDraft = await createAnthropicJson({
      schema: scriptDraftSchema,
      model: getAnthropicWritingModel(),
      system:
        `${SCRIPT_STYLE_SYSTEM_PROMPT}\n` +
        "You are expanding a script to the required length while keeping it tight, concrete, and spoken. Return JSON only.",
      user: buildExpansionPrompt({
        researchPacket: args.researchPacket,
        draft: currentDraft,
        currentWords: currentWordCount,
        minWords: targetWordRange.minWords,
        maxWords: targetWordRange.maxWords,
      }),
      temperature: 0.45,
      maxTokens: 9000,
    });
    currentWordCount = countWords(currentDraft.script);
    expansionNotes.push(`word_count:${currentWordCount}`);
  }

  currentDraft = await ensureDraftHasSourceNotes({
    researchPacket: args.researchPacket,
    draft: currentDraft,
  });
  currentWordCount = countWords(currentDraft.script);

  return {
    draft: currentDraft,
    wordCount: currentWordCount,
    notes: expansionNotes,
    targetWordRange,
  };
}

export async function generateScriptLabOutputs(
  input: ScriptLabRequest
): Promise<ScriptLabResponse> {
  const context = await prepareScriptLabPipelineContext(input);
  const researchStage = await generateResearchStage({
    input,
    moonAnalysis: context.moonAnalysis,
    researchPacket: context.researchPacket,
  });
  const quoteSelectionStage = await generateQuoteSelectionStage({
    researchPacket: context.researchPacket,
    researchStage,
  });
  const outlineStage = await generateOutlineStage({
    researchPacket: context.researchPacket,
    researchStage,
    targetWordRange: context.targetWordRange,
  });
  const quotePlacementStage = await generateQuotePlacementStage({
    researchPacket: context.researchPacket,
    researchStage,
    outlineStage,
    quoteSelectionStage,
  });
  const storyboardStage = generateStoryboardStage({
    outlineStage,
    researchStage,
  });
  const sectionPlanStage = await generateSectionPlanStage({
    researchPacket: context.researchPacket,
    researchStage,
    quoteSelectionStage,
    outlineStage,
    quotePlacementStage,
    storyboardStage,
  });
  const sectionDraftsStage = await writeSectionDraftsStage({
    context,
    researchStage,
    quoteSelectionStage,
    outlineStage,
    quotePlacementStage,
    storyboardStage,
    sectionPlanStage,
  });
  const claudeDraft = await assembleScriptDraftFromSections({
    researchPacket: context.researchPacket,
    researchStage,
    outlineStage,
    sectionDrafts: sectionDraftsStage,
  });

  const claudeCritique = await critiqueScriptDraft({
    researchPacket: context.researchPacket,
    otherLabel: "Claude first pass",
    otherDraft: claudeDraft,
  });
  const retentionStage = await analyzeRetentionStage({
    researchPacket: context.researchPacket,
    researchStage,
    outlineStage,
    claudeDraft,
  });
  const finalSectionDraftsStage = await reviseSectionDraftsStage({
    context,
    researchStage,
    quoteSelectionStage,
    outlineStage,
    quotePlacementStage,
    storyboardStage,
    sectionPlanStage,
    sectionDrafts: sectionDraftsStage,
    critique: claudeCritique,
    retentionStage,
  });
  const revisedClaudeDraft = await assembleScriptDraftFromSections({
    researchPacket: context.researchPacket,
    researchStage,
    outlineStage,
    sectionDrafts: finalSectionDraftsStage,
  });
  const revisedStyleFlags = lintDraftStyle({ input, draft: revisedClaudeDraft });
  const polishedClaudeDraft = await polishScriptDraft({
    researchPacket: context.researchPacket,
    draft: revisedClaudeDraft,
    styleFlags: revisedStyleFlags,
  });
  const expandedClaudeDraft = await expandDraftToMinimumLength({
    input,
    researchPacket: context.researchPacket,
    draft: polishedClaudeDraft,
  });
  const finalStyleFlags = lintDraftStyle({ input, draft: expandedClaudeDraft.draft });
  const finalWordCount = countWords(expandedClaudeDraft.draft.script);

  return {
    generationMode: "claude_only",
    input,
    moonAnalysis: {
      moonFitScore: context.moonAnalysis.moonFitScore,
      moonFitBand: context.moonAnalysis.moonFitBand,
      clusterLabel: context.moonAnalysis.clusterLabel,
      coverageMode: context.moonAnalysis.coverageMode,
      reasonCodes: context.moonAnalysis.reasonCodes,
      analogTitles: context.moonAnalysis.analogs.map((analog) => analog.title),
    },
    variants: {
      claude: {
        model: getAnthropicWritingModel(),
        draft: claudeDraft,
        editorialNotes: [
          `first_pass_word_count:${countWords(claudeDraft.script)}`,
          `quote_evidence_count:${researchStage.quoteEvidence.length}`,
          ...claudeCritique.mustFix,
        ].slice(0, 10),
      },
      final: {
        model: getAnthropicWritingModel(),
        draft: expandedClaudeDraft.draft,
        editorialNotes: [
          `final_word_count:${finalWordCount}`,
          `target_word_range:${expandedClaudeDraft.targetWordRange.minWords}-${expandedClaudeDraft.targetWordRange.maxWords}`,
          ...claudeCritique.mustFix.slice(0, 4),
          ...expandedClaudeDraft.notes,
          ...finalStyleFlags,
        ].slice(0, 12),
      },
    },
    stages: {
      research: researchStage,
      quoteSelection: quoteSelectionStage,
      outline: outlineStage,
      quotePlacement: quotePlacementStage,
      storyboard: storyboardStage,
      sectionPlan: sectionPlanStage,
      sectionDrafts: sectionDraftsStage,
      finalSectionDrafts: finalSectionDraftsStage,
      retention: retentionStage,
    },
  };
}

function serializeRun(row: typeof scriptLabRuns.$inferSelect): ScriptLabSavedRun {
  return {
    id: row.id,
    storyTitle: row.storyTitle,
    result: scriptLabResponseSchema.parse(row.resultJson),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function isMissingRelationError(error: unknown) {
  return Boolean(
    error
    && typeof error === "object"
    && "cause" in error
    && (error as { cause?: { code?: string } }).cause?.code === "42P01"
  );
}

export async function saveScriptLabRun(args: {
  input: ScriptLabRequest;
  result: ScriptLabResponse;
}): Promise<ScriptLabSavedRun> {
  const db = getDb();
  const [row] = await db
    .insert(scriptLabRuns)
    .values({
      storyTitle: args.input.storyTitle,
      requestJson: args.input,
      resultJson: args.result,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning();

  return serializeRun(row);
}

export async function generateAndSaveScriptLabRun(
  input: ScriptLabRequest
): Promise<ScriptLabGenerateResponse> {
  const result = await generateScriptLabOutputs(input);
  const saved = await saveScriptLabRun({ input, result });

  return {
    runId: saved.id,
    permalink: `/script-lab/${saved.id}`,
    result: saved.result,
  };
}

export async function getScriptLabRun(runId: string): Promise<ScriptLabSavedRun | null> {
  if (!isUuid(runId)) {
    return null;
  }

  const db = getDb();
  try {
    const row = await db
      .select()
      .from(scriptLabRuns)
      .where(eq(scriptLabRuns.id, runId))
      .limit(1)
      .then((rows) => rows[0] ?? null);

    return row ? serializeRun(row) : null;
  } catch (error) {
    if (isMissingRelationError(error)) {
      return null;
    }
    throw error;
  }
}

export async function listRecentScriptLabRuns(limit = 10): Promise<ScriptLabSavedRun[]> {
  const db = getDb();
  try {
    const rows = await db
      .select()
      .from(scriptLabRuns)
      .orderBy(desc(scriptLabRuns.createdAt))
      .limit(limit);

    return rows.map(serializeRun);
  } catch (error) {
    if (isMissingRelationError(error)) {
      return [];
    }
    throw error;
  }
}
