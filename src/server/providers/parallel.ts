import "server-only";

import Parallel from "parallel-web";

import { getEnv, requireEnv } from "@/server/config/env";

export interface ParallelResearchResult {
  url: string;
  title: string;
  snippet: string;
  publishedAt: string | null;
  relevanceScore: number;
  source: "parallel";
}

export interface ParallelSearchInput {
  query: string;
  searchQueries?: string[];
  objective?: string;
  limit?: number;
  mode?: "one-shot" | "agentic" | "fast";
  maxCharsPerResult?: number;
  maxCharsTotal?: number;
}

export interface ParallelExtractResult {
  markdown: string;
  title: string | null;
  sourceName: string | null;
  publishedAt: string | null;
}

export interface ParallelDeepResearchResult {
  runId: string;
  interactionId: string | null;
  processor: string;
  status: string | null;
  content: string;
  basisCount: number | null;
}

let client: Parallel | undefined;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getParallelClient() {
  if (!client) {
    client = new Parallel({
      apiKey: requireEnv("PARALLEL_API_KEY"),
    });
  }

  return client;
}

function buildDefaultSearchObjective(query: string) {
  return [
    `Search the web for reliable, high-signal sources relevant to: ${query}.`,
    "Prefer primary sources, direct statements, reputable reporting, official documents, and transcript-backed pages when available.",
    "Include YouTube videos, podcast pages, interviews, commentary clips, and archival media pages when they materially help the story.",
    "Avoid spam, SEO farms, and low-information wrappers.",
  ].join(" ");
}

function normalizeSearchQueries(input: ParallelSearchInput) {
  const queries = [input.query, ...(input.searchQueries ?? [])]
    .map((query) => query.trim())
    .filter(Boolean);

  return [...new Set(queries)];
}

function getSourceName(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./i, "");
  } catch {
    return null;
  }
}

export async function searchResearchSources(
  input: ParallelSearchInput | string,
  limit = 5
): Promise<ParallelResearchResult[]> {
  const normalized =
    typeof input === "string"
      ? {
          query: input,
          searchQueries: [input],
          limit,
          mode: "fast" as const,
          maxCharsPerResult: 800,
          maxCharsTotal: 4000,
        }
      : {
          mode: "fast" as const,
          maxCharsPerResult: 800,
          maxCharsTotal: 4000,
          ...input,
          searchQueries: normalizeSearchQueries(input),
          limit: input.limit ?? limit,
        };

  const response = await getParallelClient().beta.search({
    objective: normalized.objective ?? buildDefaultSearchObjective(normalized.query),
    search_queries: normalized.searchQueries,
    mode: normalized.mode,
    max_results: normalized.limit,
    excerpts: {
      max_chars_per_result: normalized.maxCharsPerResult,
      max_chars_total: normalized.maxCharsTotal,
    },
  });

  return response.results.map((result, index) => ({
    url: result.url,
    title: result.title?.trim() || result.url,
    snippet: (result.excerpts ?? []).join("\n\n").trim(),
    publishedAt: result.publish_date ?? null,
    relevanceScore: Math.max(100 - index * 7, 50),
    source: "parallel" as const,
  }));
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
      source: "parallel" as const,
    })),
  };
}

export async function extractResearchSource(url: string): Promise<ParallelExtractResult> {
  const response = await getParallelClient().beta.extract({
    urls: [url],
    full_content: {
      max_chars_per_result: 50_000,
    },
    excerpts: {
      max_chars_per_result: 1200,
      max_chars_total: 1200,
    },
    fetch_policy: {
      max_age_seconds: 600,
      disable_cache_fallback: false,
      timeout_seconds: 30,
    },
  });

  const result = response.results.find((item) => item.url === url) ?? response.results[0];
  if (!result) {
    throw new Error(`Parallel extract returned no result for ${url}`);
  }

  return {
    markdown:
      result.full_content?.trim() ||
      (result.excerpts ?? []).join("\n\n").trim(),
    title: result.title?.trim() ?? null,
    sourceName: getSourceName(result.url),
    publishedAt: result.publish_date ?? null,
  };
}

export async function runDeepResearchMemo(input: {
  query: string;
  briefText?: string | null;
  processor?: string;
  timeoutSeconds?: number;
  previousInteractionId?: string | null;
}): Promise<ParallelDeepResearchResult> {
  const env = getEnv();
  const processor = input.processor ?? env.PARALLEL_DEEP_RESEARCH_PROCESSOR;
  const taskInput = [
    `Build a concise but high-signal research memo for this Moon documentary topic: ${input.query}.`,
    input.briefText ? `Editorial brief:\n${input.briefText}` : null,
    "Prioritize: what happened, the real underlying pattern, why it matters now, the strongest modern-day relevance, the most important direct clips/interviews to hunt, any famous tweets/posts to find, and the best section-worthy subtopics.",
    "Return markdown with inline citations and clear headers.",
  ]
    .filter(Boolean)
    .join("\n\n");

  const taskRun = await getParallelClient().taskRun.create({
    input: taskInput,
    processor,
    previous_interaction_id: input.previousInteractionId ?? undefined,
    task_spec: {
      output_schema: {
        type: "text",
        description:
          "A concise markdown research memo with sections for overview, why it matters now, likely sections, direct evidence to hunt, and social/tweet leads.",
      },
    },
  });

  const timeoutMs = Math.max(60, input.timeoutSeconds ?? 420) * 1000;
  const deadline = Date.now() + timeoutMs;
  let lastStatus = taskRun.status;

  while (Date.now() < deadline) {
    const status = await getParallelClient().taskRun.retrieve(taskRun.run_id);
    lastStatus = status.status;

    if (status.status === "completed") {
      break;
    }

    if (status.status === "failed" || status.status === "cancelled") {
      const errorMessage =
        status.error && typeof status.error === "object" && "message" in status.error
          ? String(status.error.message ?? status.status)
          : status.status;
      throw new Error(`Parallel deep research ${status.status}: ${errorMessage}`);
    }

    await sleep(5000);
  }

  if (lastStatus !== "completed") {
    throw new Error(
      `Parallel deep research timed out after ${Math.round(timeoutMs / 1000)}s (last status: ${lastStatus ?? "unknown"})`
    );
  }

  const result = await getParallelClient().taskRun.result(taskRun.run_id, {
    timeout: 30,
  });

  const content =
    result.output && typeof result.output === "object" && "content" in result.output
      ? String(result.output.content ?? "")
      : "";
  const basis =
    result.output && typeof result.output === "object" && "basis" in result.output
      ? result.output.basis
      : null;

  return {
    runId: taskRun.run_id,
    interactionId: "interaction_id" in taskRun ? taskRun.interaction_id ?? null : null,
    processor,
    status:
      result.output && typeof result.output === "object" && "status" in result.output
        ? String(result.output.status ?? "")
        : null,
    content,
    basisCount: Array.isArray(basis) ? basis.length : null,
  };
}
