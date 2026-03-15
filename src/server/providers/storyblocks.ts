import "server-only";

import { getEnv } from "@/server/config/env";

export interface StoryblocksResult {
  assetId: string;
  title: string;
  previewUrl: string;
  sourceUrl: string;
  thumbnailUrl: string;
  durationMs: number;
  width: number;
  height: number;
  keywords: string[];
}

export async function searchStoryblocks(input: {
  keywords: string[];
  temporalContext: string | null;
  maxResults?: number;
}): Promise<{ results: StoryblocksResult[] }> {
  const env = getEnv();
  const apiKey = env.STORYBLOCKS_API_KEY;

  if (!apiKey) {
    return { results: [] };
  }

  // Storyblocks API integration
  // Using their search endpoint for stock video
  const query = input.keywords.join(" ");
  const maxResults = input.maxResults ?? 10;

  const params = new URLSearchParams({
    project_id: apiKey,
    user_id: "moon-news",
    keywords: query,
    page: "1",
    num_results: String(maxResults),
    content_type: "footage",
  });

  try {
    const response = await fetch(
      `https://api.storyblocks.com/api/v2/videos/search?${params}`,
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      }
    );

    if (!response.ok) {
      return { results: [] };
    }

    const data = await response.json() as {
      results?: Array<{
        id: string;
        title: string;
        preview_url?: string;
        thumbnail_url?: string;
        duration?: number;
        keywords?: string[];
      }>;
    };

    const results: StoryblocksResult[] = (data.results ?? []).map((item) => ({
      assetId: String(item.id),
      title: item.title,
      previewUrl: item.preview_url ?? "",
      sourceUrl: `https://www.storyblocks.com/video/${item.id}`,
      thumbnailUrl: item.thumbnail_url ?? "",
      durationMs: (item.duration ?? 0) * 1000,
      width: 1920,
      height: 1080,
      keywords: item.keywords ?? [],
    }));

    return { results };
  } catch {
    return { results: [] };
  }
}
