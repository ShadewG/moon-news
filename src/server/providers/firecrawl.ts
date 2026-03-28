import "server-only";

import { Firecrawl } from "firecrawl";

import { requireEnv } from "@/server/config/env";
import { getEnv } from "@/server/config/env";

let client: Firecrawl | undefined;

function getFirecrawlClient() {
  if (!client) {
    client = new Firecrawl({
      apiKey: requireEnv("FIRECRAWL_API_KEY"),
    });
  }

  return client;
}

export async function scrapeResearchSource(url: string): Promise<{
  markdown: string;
  title: string | null;
  sourceName: string | null;
}> {
  const document = await getFirecrawlClient().scrape(url, {
    formats: ["markdown"],
    onlyMainContent: true,
  });

  return {
    markdown: document.markdown?.trim() ?? "",
    title: document.metadata?.title ?? null,
    sourceName: (document.metadata?.siteName as string) ?? null,
  };
}

export type FirecrawlSearchResult = {
  title: string;
  url: string;
  snippet: string;
  publishedAt: string | null;
  source: "firecrawl";
};

export async function searchResearchSources(
  query: string,
  limit = 5
): Promise<FirecrawlSearchResult[]> {
  const apiKey = getEnv().FIRECRAWL_API_KEY;
  if (!apiKey) {
    return [];
  }

  const response = await fetch("https://api.firecrawl.dev/v2/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      query,
      limit,
      sources: ["web", "news"],
    }),
  });

  const payload = (await response.json().catch(() => ({}))) as {
    data?: {
      web?: Array<{
        title?: string;
        url?: string;
        description?: string;
      }>;
      news?: Array<{
        title?: string;
        url?: string;
        snippet?: string;
        date?: string | null;
      }>;
    };
  };

  if (!response.ok) {
    throw new Error(`Firecrawl search failed (${response.status}): ${JSON.stringify(payload)}`);
  }

  const webResults =
    payload.data?.web?.map((item) => ({
      title: item.title ?? "",
      url: item.url ?? "",
      snippet: item.description ?? "",
      publishedAt: null,
      source: "firecrawl" as const,
    })) ?? [];
  const newsResults =
    payload.data?.news?.map((item) => ({
      title: item.title ?? "",
      url: item.url ?? "",
      snippet: item.snippet ?? "",
      publishedAt: item.date ?? null,
      source: "firecrawl" as const,
    })) ?? [];

  return [...webResults, ...newsResults].filter((item) => item.url);
}
