import "server-only";

import OpenAI from "openai";

import { getEnv, requireEnv } from "@/server/config/env";

let client: OpenAI | undefined;

function getOpenAIClient() {
  if (!client) {
    client = new OpenAI({
      apiKey: requireEnv("OPENAI_API_KEY"),
    });
  }

  return client;
}

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
