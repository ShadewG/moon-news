import "server-only";

import OpenAI from "openai";
import { z } from "zod";

import { getEnv, requireEnv } from "@/server/config/env";
import type { LineContentCategory } from "@/server/domain/status";

let client: OpenAI | undefined;

function getOpenAIClient() {
  if (!client) {
    client = new OpenAI({
      apiKey: requireEnv("OPENAI_API_KEY"),
    });
  }

  return client;
}

// ─── Line Classification ───

export const classificationSchema = z.object({
  category: z.enum([
    "concrete_event",
    "named_person",
    "abstract_concept",
    "quote_claim",
    "historical_period",
    "transition",
    "sample_story",
  ]),
  search_keywords: z.array(z.string()),
  temporal_context: z.string().nullable(),
  ai_generation_recommended: z.boolean(),
  ai_generation_reason: z.string().nullable(),
});

export type LineClassification = z.infer<typeof classificationSchema>;

export async function classifyLine(input: {
  lineText: string;
  lineType: string;
  projectTitle: string;
}): Promise<LineClassification> {
  const response = await getOpenAIClient().responses.create({
    model: "gpt-4.1-mini",
    input: [
      {
        role: "system",
        content: `You classify documentary script lines for visual research. Given a script line, determine its category and generate video-optimized search keywords.

Categories:
- concrete_event: A specific, dateable event (vote, attack, meeting, announcement)
- named_person: References a specific real person by name or title
- abstract_concept: Discusses patterns, trends, ideas without specific events
- quote_claim: Cites a specific document, memo, statement, or claim
- historical_period: References a broad historical era or timespan
- transition: Connective language between topics ("but the story doesn't end there")
- sample_story: Fictional or illustrative anecdote about a non-real person

Rules:
- search_keywords should be optimized for YouTube/video search (2-5 keywords)
- temporal_context should be a date range or era if detectable, null otherwise
- ai_generation_recommended should be true for: sample_story (always), abstract_concept (usually), transition (never needs visuals)
- ai_generation_reason explains WHY ai generation is recommended (null if not recommended)`,
      },
      {
        role: "user",
        content: `Project: "${input.projectTitle}"\nLine type: ${input.lineType}\nLine: "${input.lineText}"`,
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "line_classification",
        strict: true,
        schema: {
          type: "object",
          properties: {
            category: {
              type: "string",
              enum: [
                "concrete_event",
                "named_person",
                "abstract_concept",
                "quote_claim",
                "historical_period",
                "transition",
                "sample_story",
              ],
            },
            search_keywords: {
              type: "array",
              items: { type: "string" },
            },
            temporal_context: {
              type: ["string", "null"],
            },
            ai_generation_recommended: {
              type: "boolean",
            },
            ai_generation_reason: {
              type: ["string", "null"],
            },
          },
          required: [
            "category",
            "search_keywords",
            "temporal_context",
            "ai_generation_recommended",
            "ai_generation_reason",
          ],
          additionalProperties: false,
        },
      },
    },
  });

  const parsed = classificationSchema.parse(JSON.parse(response.output_text));
  return parsed;
}

// ─── AI Relevance Scoring ───

export async function scoreResultRelevance(input: {
  lineText: string;
  results: Array<{
    title: string;
    description: string;
    provider: string;
  }>;
}): Promise<number[]> {
  if (input.results.length === 0) return [];

  const resultsText = input.results
    .map((r, i) => `${i + 1}. [${r.provider}] "${r.title}" — ${r.description.slice(0, 150)}`)
    .join("\n");

  const response = await getOpenAIClient().responses.create({
    model: "gpt-4.1-mini",
    input: [
      {
        role: "system",
        content: `You score search results for relevance to a documentary script line. For each result, return a relevance score 0-50 where:
- 40-50: Directly about the specific topic, event, or person mentioned
- 25-39: Related to the topic but not specifically about it
- 10-24: Tangentially related, could work as B-roll
- 0-9: Irrelevant, wrong topic, spam, or AI-generated filler

Be strict. A result about "CIA and media" is NOT relevant to "Operation Mockingbird" unless it specifically discusses Mockingbird. A random conspiracy video is NOT relevant just because it mentions the CIA.`,
      },
      {
        role: "user",
        content: `Script line: "${input.lineText}"\n\nResults:\n${resultsText}\n\nReturn ONLY a JSON array of integers, one score per result. Example: [45, 30, 5, 40, 12]`,
      },
    ],
  });

  try {
    const scores = JSON.parse(response.output_text.trim());
    if (Array.isArray(scores) && scores.length === input.results.length) {
      return scores.map((s: unknown) => Math.max(0, Math.min(50, Number(s) || 0)));
    }
  } catch {
    // Fall through to default
  }

  // Default: position-based fallback
  return input.results.map((_, i) =>
    Math.max(20, 40 - Math.floor((i / input.results.length) * 20))
  );
}

// ─── Research Summarization ───

export async function summarizeResearch(input: {
  lineText: string;
  sources: Array<{
    title: string;
    url: string;
    snippet: string;
    extractedMarkdown?: string;
  }>;
}): Promise<{ summary: string; model: string; confidenceScore: number }> {
  const env = getEnv();

  const response = await getOpenAIClient().responses.create({
    model: env.OPENAI_RESEARCH_MODEL,
    input: [
      {
        role: "system",
        content:
          "You are summarizing documentary research. Be concise, factual, and grounded in the supplied sources only. Mention ambiguity when evidence is weak.",
      },
      {
        role: "user",
        content: [
          `Script line: ${input.lineText}`,
          "",
          "Sources:",
          ...input.sources.map((source, index) =>
            [
              `${index + 1}. ${source.title}`,
              `URL: ${source.url}`,
              `Snippet: ${source.snippet || "No snippet available."}`,
              source.extractedMarkdown
                ? `Extracted content: ${source.extractedMarkdown.slice(0, 3000)}`
                : "Extracted content: unavailable",
            ].join("\n")
          ),
          "",
          "Return a short synthesis of the strongest facts and caveats for an editor.",
        ].join("\n"),
      },
    ],
  });

  return {
    summary: response.output_text.trim(),
    model: env.OPENAI_RESEARCH_MODEL,
    confidenceScore: Math.min(95, 65 + input.sources.length * 5),
  };
}
