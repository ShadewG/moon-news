import "server-only";

import { Firecrawl } from "firecrawl";

import { requireEnv } from "@/server/config/env";

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
