import { performance } from "node:perf_hooks";

import { Firecrawl } from "firecrawl";
import Parallel from "parallel-web";

function summarizeResults(results: Array<Record<string, unknown>>) {
  return results.slice(0, 5).map((item, index) => ({
    index: index + 1,
    title:
      (typeof item.title === "string" && item.title) ||
      (typeof item.url === "string" && item.url) ||
      null,
    url: typeof item.url === "string" ? item.url : null,
    snippet: String(
      item.snippet ??
        item.description ??
        item.markdown ??
        ""
    ).slice(0, 220),
    publishedAt:
      (typeof item.publishedAt === "string" && item.publishedAt) ||
      (typeof item.publish_date === "string" && item.publish_date) ||
      (typeof item.metadata === "object" &&
      item.metadata &&
      "publishedTime" in item.metadata &&
      typeof item.metadata.publishedTime === "string"
        ? item.metadata.publishedTime
        : null),
  }));
}

async function main() {
  const args = process.argv.slice(2);
  const skipDeepResearch = args.includes("--skip-deep");
  const query = args.filter((arg) => arg !== "--skip-deep").join(" ").trim();

  if (!query) {
    throw new Error("Usage: tsx scripts/compare-research-providers.ts \"query\"");
  }

  if (!process.env.FIRECRAWL_API_KEY) {
    throw new Error("FIRECRAWL_API_KEY is required");
  }

  if (!process.env.PARALLEL_API_KEY) {
    throw new Error("PARALLEL_API_KEY is required");
  }

  const firecrawl = new Firecrawl({
    apiKey: process.env.FIRECRAWL_API_KEY,
  });
  const parallel = new Parallel({
    apiKey: process.env.PARALLEL_API_KEY,
  });

  const output: Record<string, unknown> = { query };

  const firecrawlStartedAt = performance.now();
  try {
    const searchResult = await firecrawl.search(query, {
      limit: 8,
      sources: ["web", "news"],
    });

    output.firecrawlSearch = {
      durationMs: Math.round(performance.now() - firecrawlStartedAt),
      webCount: searchResult.web?.length ?? 0,
      newsCount: searchResult.news?.length ?? 0,
      webTop: summarizeResults((searchResult.web ?? []) as Array<Record<string, unknown>>),
      newsTop: summarizeResults((searchResult.news ?? []) as Array<Record<string, unknown>>),
    };
  } catch (error) {
    output.firecrawlSearch = {
      error: error instanceof Error ? error.message : String(error),
    };
  }

  const parallelSearchStartedAt = performance.now();
  try {
    const searchResult = await parallel.beta.search({
      objective:
        `Find reliable primary sources and strong secondary coverage for this Moon documentary topic: ${query}. ` +
        "Prefer authoritative reporting and direct evidence.",
      search_queries: [query],
      mode: "one-shot",
      max_results: 8,
      excerpts: {
        max_chars_per_result: 900,
        max_chars_total: 4000,
      },
    });

    output.parallelSearch = {
      durationMs: Math.round(performance.now() - parallelSearchStartedAt),
      searchId: searchResult.search_id,
      resultCount: searchResult.results.length,
      top: summarizeResults(searchResult.results as Array<Record<string, unknown>>),
    };
  } catch (error) {
    output.parallelSearch = {
      error: error instanceof Error ? error.message : String(error),
    };
  }

  if (!skipDeepResearch) {
    const parallelDeepResearchStartedAt = performance.now();
    try {
      const taskRun = await parallel.taskRun.create({
        input:
          `Create a concise research brief on this Moon documentary topic: ${query}. ` +
          "Focus on what happened, why it matters, the key actors, the strongest evidence, and the best section-worthy subtopics.",
        processor: "pro-fast",
        task_spec: {
          output_schema: {
            type: "text",
            description:
              "A concise markdown research brief with inline citations and a short list of section-worthy angles.",
          },
        },
      });

      const result = await parallel.taskRun.result(taskRun.run_id, { timeout: 120 });
      const content =
        result.output && typeof result.output === "object" && "content" in result.output
          ? String(result.output.content ?? "")
          : "";
      const basis =
        result.output && typeof result.output === "object" && "basis" in result.output
          ? result.output.basis
          : null;

      output.parallelDeepResearch = {
        durationMs: Math.round(performance.now() - parallelDeepResearchStartedAt),
        runId: taskRun.run_id,
        status:
          result.output && typeof result.output === "object" && "status" in result.output
            ? result.output.status
            : null,
        contentPreview: content.slice(0, 1800),
        basisCount: Array.isArray(basis) ? basis.length : null,
      };
    } catch (error) {
      output.parallelDeepResearch = {
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  console.log(JSON.stringify(output, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
