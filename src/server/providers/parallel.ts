import "server-only";

import Parallel from "parallel-web";

import { getEnv, requireEnv } from "@/server/config/env";

export interface ParallelResearchResult {
  url: string;
  title: string;
  snippet: string;
  publishedAt: string | null;
  relevanceScore: number;
}

let client: Parallel | undefined;

function getParallelClient() {
  if (!client) {
    client = new Parallel({
      apiKey: requireEnv("PARALLEL_API_KEY"),
    });
  }

  return client;
}

export async function searchLineResearch(input: {
  projectTitle: string;
  lineText: string;
}): Promise<{
  query: string;
  searchId: string;
  results: ParallelResearchResult[];
}> {
  const env = getEnv();
  const query = `Find reliable primary sources and strong secondary coverage for this documentary line: "${input.lineText}"`;

  const response = await getParallelClient().beta.search({
    objective: `${query} Prefer reputable journalism, academic sources, government documents, and direct evidence when available. Project title: ${input.projectTitle}.`,
    search_queries: [input.lineText],
    mode: "one-shot",
    max_results: env.MAX_RESEARCH_SOURCES_PER_LINE,
    excerpts: {
      max_chars_per_result: 1200,
      max_chars_total: 4000,
    },
  });

  return {
    query,
    searchId: response.search_id,
    results: response.results.map((result, index) => ({
      url: result.url,
      title: result.title ?? result.url,
      snippet: (result.excerpts ?? []).join("\n\n").trim(),
      publishedAt: result.publish_date ?? null,
      relevanceScore: Math.max(100 - index * 7, 50),
    })),
  };
}
