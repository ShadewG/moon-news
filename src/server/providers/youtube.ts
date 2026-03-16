import "server-only";

import { getEnv } from "@/server/config/env";
import { getDb } from "@/server/db/client";
import { footageSearchRuns } from "@/server/db/schema";
import { eq, and, gte, sql } from "drizzle-orm";

export interface YouTubeResult {
  videoId: string;
  title: string;
  description: string;
  channelTitle: string;
  publishedAt: string;
  thumbnailUrl: string;
  durationMs: number;
  viewCount: number;
}

const DAILY_QUOTA_LIMIT = 100;
const QUOTA_SAFETY_MARGIN = 0.9;

async function getTodayYouTubeSearchCount(): Promise<number> {
  const db = getDb();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [result] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(footageSearchRuns)
    .where(
      and(
        eq(footageSearchRuns.provider, "youtube"),
        gte(footageSearchRuns.createdAt, today)
      )
    );

  return result?.count ?? 0;
}

function isQuotaAvailable(currentCount: number): boolean {
  return currentCount < DAILY_QUOTA_LIMIT * QUOTA_SAFETY_MARGIN;
}

function parseDuration(iso8601: string): number {
  const match = iso8601.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;
  const hours = parseInt(match[1] || "0", 10);
  const minutes = parseInt(match[2] || "0", 10);
  const seconds = parseInt(match[3] || "0", 10);
  return (hours * 3600 + minutes * 60 + seconds) * 1000;
}

export async function searchYouTube(input: {
  keywords: string[];
  temporalContext: string | null;
  maxResults?: number;
}): Promise<{ results: YouTubeResult[]; quotaUsed: number; quotaRemaining: number }> {
  const env = getEnv();
  const apiKey = env.YOUTUBE_API_KEY;

  if (!apiKey) {
    return { results: [], quotaUsed: 0, quotaRemaining: DAILY_QUOTA_LIMIT };
  }

  const currentCount = await getTodayYouTubeSearchCount();
  if (!isQuotaAvailable(currentCount)) {
    return {
      results: [],
      quotaUsed: currentCount,
      quotaRemaining: Math.max(0, DAILY_QUOTA_LIMIT - currentCount),
    };
  }

  const query = input.keywords.join(" ");
  const maxResults = Math.min(input.maxResults ?? 10, 25);

  const searchParams = new URLSearchParams({
    part: "snippet",
    q: query,
    type: "video",
    maxResults: String(maxResults),
    order: "relevance",
    videoEmbeddable: "true",
    key: apiKey,
  });

  if (input.temporalContext) {
    const yearMatch = input.temporalContext.match(/\b(19|20)\d{2}\b/);
    if (yearMatch) {
      searchParams.set("publishedAfter", `${yearMatch[0]}-01-01T00:00:00Z`);
    }
  }

  const searchResponse = await fetch(
    `https://www.googleapis.com/youtube/v3/search?${searchParams}`
  );

  if (!searchResponse.ok) {
    const errorText = await searchResponse.text();
    throw new Error(`YouTube search failed: ${searchResponse.status} ${errorText}`);
  }

  const searchData = await searchResponse.json() as {
    items?: Array<{
      id: { videoId: string };
      snippet: {
        title: string;
        description: string;
        channelTitle: string;
        publishedAt: string;
        thumbnails: { medium?: { url: string }; default?: { url: string } };
      };
    }>;
  };

  const items = searchData.items ?? [];
  if (items.length === 0) {
    return {
      results: [],
      quotaUsed: currentCount + 1,
      quotaRemaining: Math.max(0, DAILY_QUOTA_LIMIT - currentCount - 1),
    };
  }

  const videoIds = items.map((item) => item.id.videoId).join(",");

  const detailParams = new URLSearchParams({
    part: "contentDetails,statistics",
    id: videoIds,
    key: apiKey,
  });

  const detailResponse = await fetch(
    `https://www.googleapis.com/youtube/v3/videos?${detailParams}`
  );

  const detailMap: Record<string, { durationMs: number; viewCount: number }> = {};

  if (detailResponse.ok) {
    const detailData = await detailResponse.json() as {
      items?: Array<{
        id: string;
        contentDetails: { duration: string };
        statistics: { viewCount?: string };
      }>;
    };

    for (const item of detailData.items ?? []) {
      detailMap[item.id] = {
        durationMs: parseDuration(item.contentDetails.duration),
        viewCount: parseInt(item.statistics.viewCount ?? "0", 10),
      };
    }
  }

  const results: YouTubeResult[] = items.map((item) => {
    const detail = detailMap[item.id.videoId];
    return {
      videoId: item.id.videoId,
      title: item.snippet.title,
      description: item.snippet.description,
      channelTitle: item.snippet.channelTitle,
      publishedAt: item.snippet.publishedAt,
      thumbnailUrl:
        item.snippet.thumbnails.medium?.url ??
        item.snippet.thumbnails.default?.url ??
        "",
      durationMs: detail?.durationMs ?? 0,
      viewCount: detail?.viewCount ?? 0,
    };
  });

  return {
    results,
    quotaUsed: currentCount + 1,
    quotaRemaining: Math.max(0, DAILY_QUOTA_LIMIT - currentCount - 1),
  };
}
