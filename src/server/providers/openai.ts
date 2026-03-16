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
  scriptContext?: string;
}): Promise<LineClassification> {
  const contextBlock = input.scriptContext
    ? `\n\nFull script context (the line marked >>> is the one to classify):\n${input.scriptContext}`
    : "";

  const response = await getOpenAIClient().responses.create({
    model: "gpt-4.1-mini",
    input: [
      {
        role: "system",
        content: `You classify documentary script lines for visual research. You will be given a single line to classify, along with surrounding script context so you understand what this section of the documentary is about.

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
- Include specific names, events, dates from the line AND surrounding context
- temporal_context should be a date range or era if detectable, null otherwise
- ai_generation_recommended should be true for: sample_story (always), abstract_concept (usually), transition (never needs visuals)
- ai_generation_reason explains WHY ai generation is recommended (null if not recommended)`,
      },
      {
        role: "user",
        content: `Project: "${input.projectTitle}"\nLine type: ${input.lineType}\nLine: "${input.lineText}"${contextBlock}`,
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
  scriptContext?: string;
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
        content: `Script line: "${input.lineText}"${input.scriptContext ? `\n\nScript context:\n${input.scriptContext}` : ""}\n\nResults:\n${resultsText}\n\nReturn ONLY a JSON array of integers, one score per result. Example: [45, 30, 5, 40, 12]`,
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

// ─── Transcript Quote Extraction ───

export interface ExtractedQuote {
  quoteText: string;
  speaker: string | null;
  startMs: number;
  endMs: number;
  relevanceScore: number;
  context: string;
}

export async function findRelevantQuotes(input: {
  lineText: string;
  transcript: Array<{ text: string; startMs: number; durationMs: number }>;
  videoTitle: string;
  maxQuotes?: number;
  scriptContext?: string;
}): Promise<ExtractedQuote[]> {
  if (input.transcript.length === 0) return [];

  // Build condensed transcript with timestamps
  const transcriptText = input.transcript
    .map((s) => {
      const mins = Math.floor(s.startMs / 60000);
      const secs = Math.floor((s.startMs % 60000) / 1000);
      return `[${mins}:${String(secs).padStart(2, "0")}] ${s.text}`;
    })
    .join("\n")
    .slice(0, 12000); // Cap at ~12K chars to stay within context

  const maxQuotes = input.maxQuotes ?? 5;

  const response = await getOpenAIClient().responses.create({
    model: "gpt-4.1-mini",
    input: [
      {
        role: "system",
        content: `You extract the most relevant quotes from interview/video transcripts for a documentary editor. You'll be given a specific script line, surrounding script context, and a timestamped transcript. Find quotes that:
- Directly support, illustrate, or provide evidence for the script line's claim
- Are spoken clearly and would work as a clip in a documentary
- Have strong emotional or factual weight
- Connect to the broader documentary thesis shown in the script context

Return ONLY a JSON array of objects with:
- quoteText: the exact quote (clean up filler words but keep the meaning)
- speaker: who is speaking (name if identifiable from context, null if unclear)
- startMs: timestamp in milliseconds where the quote starts
- endMs: timestamp where it ends (startMs + estimated duration)
- relevanceScore: 0-100 how relevant to the script line
- context: one sentence explaining why this quote matters for the documentary

Return at most ${maxQuotes} quotes, sorted by relevance. If nothing relevant, return [].`,
      },
      {
        role: "user",
        content: `Script line: "${input.lineText}"${input.scriptContext ? `\n\nScript context:\n${input.scriptContext}` : ""}\n\nVideo: "${input.videoTitle}"\n\nTranscript:\n${transcriptText}`,
      },
    ],
  });

  try {
    const jsonMatch = response.output_text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];

    const parsed = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter(
        (q: Record<string, unknown>) =>
          q.quoteText && typeof q.startMs === "number"
      )
      .map((q: Record<string, unknown>) => ({
        quoteText: String(q.quoteText),
        speaker: q.speaker ? String(q.speaker) : null,
        startMs: Number(q.startMs),
        endMs: Number(q.endMs ?? Number(q.startMs) + 10000),
        relevanceScore: Math.max(0, Math.min(100, Number(q.relevanceScore ?? 50))),
        context: String(q.context ?? ""),
      }))
      .slice(0, maxQuotes);
  } catch {
    return [];
  }
}

// ─── Video Transcription (Whisper) ───

export interface WhisperSegment {
  text: string;
  startMs: number;
  durationMs: number;
}

/**
 * Transcribes a video/audio file URL using OpenAI Whisper.
 * Downloads the media, sends to Whisper API, returns timestamped segments.
 */
export async function transcribeVideoUrl(
  videoUrl: string
): Promise<WhisperSegment[]> {
  // Download the video/audio
  const mediaResponse = await fetch(videoUrl);
  if (!mediaResponse.ok) {
    throw new Error(`Failed to download media: ${mediaResponse.status}`);
  }

  const buffer = Buffer.from(await mediaResponse.arrayBuffer());
  const blob = new Blob([buffer]);
  const file = new File([blob], "video.mp4", { type: "video/mp4" });

  const response = await getOpenAIClient().audio.transcriptions.create({
    model: "whisper-1",
    file,
    response_format: "verbose_json",
    timestamp_granularities: ["segment"],
  });

  const segments = (response as unknown as {
    segments?: Array<{ text: string; start: number; end: number }>;
  }).segments ?? [];

  return segments.map((s) => ({
    text: s.text.trim(),
    startMs: Math.round(s.start * 1000),
    durationMs: Math.round((s.end - s.start) * 1000),
  }));
}

// ─── Ask AI about a video transcript ───

export async function askAboutTranscript(input: {
  question: string;
  transcript: Array<{ text: string; startMs: number; durationMs: number }>;
  videoTitle: string;
}): Promise<{
  answer: string;
  moments: Array<{ text: string; startMs: number; timestamp: string }>;
}> {
  const transcriptText = input.transcript
    .map((s) => {
      const mins = Math.floor(s.startMs / 60000);
      const secs = Math.floor((s.startMs % 60000) / 1000);
      return `[${mins}:${String(secs).padStart(2, "0")}] ${s.text}`;
    })
    .join("\n")
    .slice(0, 15000);

  const response = await getOpenAIClient().responses.create({
    model: "gpt-4.1-mini",
    input: [
      {
        role: "system",
        content: `You answer questions about a video based on its transcript. Be specific and cite exact timestamps.

Return JSON with:
- answer: A clear, concise answer to the question
- moments: Array of relevant moments, each with:
  - text: The exact quote or what's said (cleaned up but faithful)
  - startMs: Timestamp in milliseconds
  - timestamp: Human readable like "3:42"

If the answer is "no" or the topic isn't discussed, say so clearly and return empty moments.
Always ground your answer in what's actually in the transcript.`,
      },
      {
        role: "user",
        content: `Video: "${input.videoTitle}"\n\nQuestion: ${input.question}\n\nTranscript:\n${transcriptText}`,
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "transcript_answer",
        strict: true,
        schema: {
          type: "object",
          properties: {
            answer: { type: "string" },
            moments: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  text: { type: "string" },
                  startMs: { type: "number" },
                  timestamp: { type: "string" },
                },
                required: ["text", "startMs", "timestamp"],
                additionalProperties: false,
              },
            },
          },
          required: ["answer", "moments"],
          additionalProperties: false,
        },
      },
    },
  });

  return JSON.parse(response.output_text);
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
