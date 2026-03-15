import "server-only";

import { getEnv } from "@/server/config/env";

export interface GoogleImageResult {
  title: string;
  link: string;
  displayLink: string;
  snippet: string;
  thumbnailUrl: string;
  contextLink: string;
  width: number;
  height: number;
}

export async function searchGoogleImages(input: {
  keywords: string[];
  temporalContext: string | null;
  maxResults?: number;
}): Promise<{ results: GoogleImageResult[] }> {
  const env = getEnv();
  const apiKey = env.GOOGLE_CSE_API_KEY;
  const cx = env.GOOGLE_CSE_CX;

  if (!apiKey || !cx) {
    return { results: [] };
  }

  const query = input.keywords.join(" ");
  const maxResults = Math.min(input.maxResults ?? 10, 10); // CSE limit

  const params = new URLSearchParams({
    key: apiKey,
    cx,
    q: query,
    searchType: "image",
    num: String(maxResults),
    imgType: "photo",
    safe: "active",
  });

  if (input.temporalContext) {
    const yearMatch = input.temporalContext.match(/\b(19|20)\d{2}\b/);
    if (yearMatch) {
      params.set("sort", `date:r:${yearMatch[0]}0101:${yearMatch[0]}1231`);
    }
  }

  const response = await fetch(
    `https://www.googleapis.com/customsearch/v1?${params}`
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Google Images search failed: ${response.status} ${errorText}`);
  }

  const data = await response.json() as {
    items?: Array<{
      title: string;
      link: string;
      displayLink: string;
      snippet: string;
      image?: {
        contextLink?: string;
        thumbnailLink?: string;
        width?: number;
        height?: number;
      };
    }>;
  };

  const results: GoogleImageResult[] = (data.items ?? []).map((item) => ({
    title: item.title,
    link: item.link,
    displayLink: item.displayLink,
    snippet: item.snippet,
    thumbnailUrl: item.image?.thumbnailLink ?? "",
    contextLink: item.image?.contextLink ?? "",
    width: item.image?.width ?? 0,
    height: item.image?.height ?? 0,
  }));

  return { results };
}
