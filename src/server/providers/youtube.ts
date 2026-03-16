import "server-only";

import { getEnv } from "@/server/config/env";
import { getDb } from "@/server/db/client";
import { footageSearchRuns } from "@/server/db/schema";
import { eq, and, gte, sql } from "drizzle-orm";

interface YouTubeThumbnailSet {
  default?: { url?: string };
  medium?: { url?: string };
  high?: { url?: string };
  standard?: { url?: string };
  maxres?: { url?: string };
}

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

export interface YouTubeChannelSummary {
  channelId: string;
  title: string;
  channelUrl: string;
  customUrl: string | null;
  uploadsPlaylistId: string | null;
  subscriberCount: number | null;
}

export interface YouTubeChannelUpload {
  videoId: string;
  channelId: string;
  channelTitle: string;
  title: string;
  description: string;
  publishedAt: string;
  thumbnailUrl: string;
  durationMs: number;
  viewCount: number;
  url: string;
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

function pickThumbnailUrl(thumbnails?: YouTubeThumbnailSet): string {
  return (
    thumbnails?.maxres?.url ??
    thumbnails?.standard?.url ??
    thumbnails?.high?.url ??
    thumbnails?.medium?.url ??
    thumbnails?.default?.url ??
    ""
  );
}

async function fetchYouTubeJson<T>(
  path: string,
  params: Record<string, string>
): Promise<T> {
  const env = getEnv();
  const apiKey = env.YOUTUBE_API_KEY;

  if (!apiKey) {
    throw new Error("YOUTUBE_API_KEY is not configured");
  }

  const searchParams = new URLSearchParams({
    ...params,
    key: apiKey,
  });
  const response = await fetch(`https://www.googleapis.com/youtube/v3/${path}?${searchParams}`);

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`YouTube ${path} failed: ${response.status} ${errorText}`);
  }

  return (await response.json()) as T;
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

export async function fetchYouTubeChannelUploads(input: {
  channelId: string;
  uploadsPlaylistId: string;
  maxResults?: number;
}): Promise<{
  channel: YouTubeChannelSummary | null;
  items: YouTubeChannelUpload[];
}> {
  const maxResults = Math.max(1, Math.min(input.maxResults ?? 8, 20));

  const [channelResponse, playlistResponse] = await Promise.all([
    fetchYouTubeJson<{
      items?: Array<{
        id: string;
        snippet?: {
          title?: string;
          customUrl?: string;
        };
        statistics?: {
          subscriberCount?: string;
        };
        contentDetails?: {
          relatedPlaylists?: {
            uploads?: string;
          };
        };
      }>;
    }>("channels", {
      part: "snippet,statistics,contentDetails",
      id: input.channelId,
    }),
    fetchYouTubeJson<{
      items?: Array<{
        snippet?: {
          title?: string;
          publishedAt?: string;
          channelTitle?: string;
          description?: string;
          thumbnails?: YouTubeThumbnailSet;
          resourceId?: {
            videoId?: string;
          };
        };
        contentDetails?: {
          videoId?: string;
          videoPublishedAt?: string;
        };
      }>;
    }>("playlistItems", {
      part: "snippet,contentDetails",
      playlistId: input.uploadsPlaylistId,
      maxResults: String(maxResults),
    }),
  ]);

  const channelRecord = channelResponse.items?.[0];
  const channel: YouTubeChannelSummary | null = channelRecord
    ? {
        channelId: channelRecord.id,
        title: channelRecord.snippet?.title ?? "",
        channelUrl: `https://www.youtube.com/channel/${channelRecord.id}`,
        customUrl: channelRecord.snippet?.customUrl ?? null,
        uploadsPlaylistId:
          channelRecord.contentDetails?.relatedPlaylists?.uploads ?? input.uploadsPlaylistId,
        subscriberCount: channelRecord.statistics?.subscriberCount
          ? parseInt(channelRecord.statistics.subscriberCount, 10)
          : null,
      }
    : null;

  const playlistItems = (playlistResponse.items ?? []).filter((item) => {
    const videoId = item.contentDetails?.videoId ?? item.snippet?.resourceId?.videoId;
    const title = item.snippet?.title ?? "";
    return Boolean(videoId) && title !== "Private video" && title !== "Deleted video";
  });

  if (playlistItems.length === 0) {
    return { channel, items: [] };
  }

  const videoIds = playlistItems
    .map((item) => item.contentDetails?.videoId ?? item.snippet?.resourceId?.videoId)
    .filter((value): value is string => typeof value === "string" && value.length > 0);

  const videoResponse = await fetchYouTubeJson<{
    items?: Array<{
      id: string;
      snippet?: {
        title?: string;
        description?: string;
        channelId?: string;
        channelTitle?: string;
        publishedAt?: string;
        thumbnails?: YouTubeThumbnailSet;
      };
      contentDetails?: {
        duration?: string;
      };
      statistics?: {
        viewCount?: string;
      };
    }>;
    }>("videos", {
      part: "snippet,contentDetails,statistics",
      id: videoIds.join(","),
    });

  const detailsById = new Map(
    (videoResponse.items ?? []).map((item) => [
      item.id,
      {
        title: item.snippet?.title ?? "",
        description: item.snippet?.description ?? "",
        channelId: item.snippet?.channelId ?? input.channelId,
        channelTitle: item.snippet?.channelTitle ?? channel?.title ?? "",
        publishedAt: item.snippet?.publishedAt ?? "",
        thumbnailUrl: pickThumbnailUrl(item.snippet?.thumbnails),
        durationMs: parseDuration(item.contentDetails?.duration ?? ""),
        viewCount: item.statistics?.viewCount ? parseInt(item.statistics.viewCount, 10) : 0,
      },
    ])
  );

  const items: YouTubeChannelUpload[] = videoIds
    .map((videoId) => {
      const detail = detailsById.get(videoId);
      if (!detail) {
        return null;
      }

      return {
        videoId,
        channelId: detail.channelId,
        channelTitle: detail.channelTitle,
        title: detail.title,
        description: detail.description,
        publishedAt: detail.publishedAt,
        thumbnailUrl: detail.thumbnailUrl,
        durationMs: detail.durationMs,
        viewCount: detail.viewCount,
        url: `https://www.youtube.com/watch?v=${videoId}`,
      };
    })
    .filter((item): item is YouTubeChannelUpload => item !== null)
    .sort((left, right) => Date.parse(right.publishedAt) - Date.parse(left.publishedAt));

  return { channel, items };
}
