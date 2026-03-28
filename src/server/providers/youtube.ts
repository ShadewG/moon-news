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

export interface YouTubeChannelFeedSummary {
  channelId: string;
  feedUrl: string;
  channelHandle: string | null;
  channelUrl: string | null;
  title: string | null;
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

export interface YouTubeCommentResult {
  commentId: string;
  authorDisplayName: string;
  textDisplay: string;
  likeCount: number;
  publishedAt: string | null;
  updatedAt: string | null;
  url: string;
}

const DAILY_QUOTA_LIMIT = 100;
const QUOTA_SAFETY_MARGIN = 0.9;
let youtubeApiQuotaExhausted = false;

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

export function buildYouTubeChannelFeedUrl(channelId: string): string {
  return `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
}

function normalizeYouTubeHandle(handle: string | null | undefined): string | null {
  const normalized = handle?.trim().replace(/^@+/, "");
  return normalized ? `@${normalized}` : null;
}

function extractYouTubeHandleFromUrl(url: string | null | undefined): string | null {
  if (!url) {
    return null;
  }

  const match = url.match(/youtube\.com\/@([^/?#]+)/i);
  return normalizeYouTubeHandle(match?.[1] ?? null);
}

function extractYouTubeChannelIdFromUrl(url: string | null | undefined): string | null {
  if (!url) {
    return null;
  }

  const match =
    url.match(/feeds\/videos\.xml\?channel_id=([A-Za-z0-9_-]+)/i) ??
    url.match(/youtube\.com\/channel\/([A-Za-z0-9_-]+)/i);

  return match?.[1] ?? null;
}

function buildYouTubeHandleUrl(handle: string): string {
  return `https://www.youtube.com/${normalizeYouTubeHandle(handle) ?? handle}`;
}

function extractHtmlAttribute(html: string, pattern: RegExp): string | null {
  const match = html.match(pattern);
  return match?.[1]?.trim() ?? null;
}

function extractYouTubeChannelFeedFromHtml(html: string): YouTubeChannelFeedSummary | null {
  const feedChannelId =
    extractHtmlAttribute(
      html,
      /https:\/\/www\.youtube\.com\/feeds\/videos\.xml\?channel_id=([A-Za-z0-9_-]+)/i
    ) ??
    extractHtmlAttribute(
      html,
      /feeds\/videos\.xml\?channel_id=([A-Za-z0-9_-]+)/i
    );

  const canonicalUrl =
    extractHtmlAttribute(html, /<link[^>]+rel="canonical"[^>]+href="([^"]+)"/i) ??
    extractHtmlAttribute(html, /<meta[^>]+property="og:url"[^>]+content="([^"]+)"/i);
  const canonicalChannelId = extractYouTubeChannelIdFromUrl(canonicalUrl);
  const channelId = feedChannelId ?? canonicalChannelId;

  if (!channelId) {
    return null;
  }

  const title =
    extractHtmlAttribute(html, /<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i) ??
    extractHtmlAttribute(html, /<title>([^<]+)<\/title>/i);

  return {
    channelId,
    feedUrl: buildYouTubeChannelFeedUrl(channelId),
    channelHandle: extractYouTubeHandleFromUrl(canonicalUrl),
    channelUrl: canonicalUrl ?? `https://www.youtube.com/channel/${channelId}`,
    title,
  };
}

async function fetchYouTubeChannelPage(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "User-Agent": "Mozilla/5.0 (MoonNews YouTube Resolver)",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    throw new Error(`YouTube channel page failed: ${response.status} ${response.statusText}`);
  }

  return response.text();
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

  if (youtubeApiQuotaExhausted) {
    throw new Error("YouTube API quota exhausted for this process");
  }

  const searchParams = new URLSearchParams({
    ...params,
    key: apiKey,
  });
  const response = await fetch(`https://www.googleapis.com/youtube/v3/${path}?${searchParams}`);

  if (!response.ok) {
    const errorText = await response.text();
    if (errorText.includes("quotaExceeded")) {
      youtubeApiQuotaExhausted = true;
    }
    throw new Error(`YouTube ${path} failed: ${response.status} ${errorText}`);
  }

  return (await response.json()) as T;
}

async function fetchYouTubeChannelByHandle(handle: string) {
  const normalizedHandle = handle.replace(/^@+/, "").trim();
  if (!normalizedHandle) {
    return null;
  }

  const response = await fetchYouTubeJson<{
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
    forHandle: normalizedHandle,
  });

  return response.items?.[0] ?? null;
}

async function searchYouTubeChannelByName(channelName: string) {
  const response = await fetchYouTubeJson<{
    items?: Array<{
      id?: {
        channelId?: string;
      };
    }>;
  }>("search", {
    part: "snippet",
    q: channelName,
    type: "channel",
    maxResults: "1",
  });

  const channelId = response.items?.[0]?.id?.channelId;
  if (!channelId) {
    return null;
  }

  const detailResponse = await fetchYouTubeJson<{
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
    id: channelId,
  });

  return detailResponse.items?.[0] ?? null;
}

async function resolveYouTubeChannel(input: {
  channelId?: string;
  uploadsPlaylistId?: string;
  channelHandle?: string;
  channelUrl?: string;
  channelName?: string;
}) {
  const handleFromUrl =
    input.channelUrl?.match(/youtube\.com\/@([^/?]+)/i)?.[1] ?? undefined;
  const channelRecord =
    (input.channelId
      ? (
          await fetchYouTubeJson<{
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
          })
        ).items?.[0]
      : null) ??
    (input.channelHandle ? await fetchYouTubeChannelByHandle(input.channelHandle) : null) ??
    (handleFromUrl ? await fetchYouTubeChannelByHandle(handleFromUrl) : null) ??
    (input.channelName ? await searchYouTubeChannelByName(input.channelName) : null);

  if (!channelRecord) {
    return null;
  }

  return {
    channelId: channelRecord.id,
    title: channelRecord.snippet?.title ?? "",
    channelUrl:
      channelRecord.snippet?.customUrl
        ? `https://www.youtube.com/${channelRecord.snippet.customUrl}`
        : `https://www.youtube.com/channel/${channelRecord.id}`,
    customUrl: channelRecord.snippet?.customUrl ?? null,
    uploadsPlaylistId:
      channelRecord.contentDetails?.relatedPlaylists?.uploads ??
      input.uploadsPlaylistId ??
      null,
    subscriberCount: channelRecord.statistics?.subscriberCount
      ? parseInt(channelRecord.statistics.subscriberCount, 10)
      : null,
  };
}

export async function resolveYouTubeChannelFeed(input: {
  channelId?: string;
  channelHandle?: string;
  channelUrl?: string;
  channelName?: string;
  allowApiFallback?: boolean;
}): Promise<YouTubeChannelFeedSummary | null> {
  const directChannelId =
    input.channelId ?? extractYouTubeChannelIdFromUrl(input.channelUrl);
  const directHandle =
    normalizeYouTubeHandle(input.channelHandle) ?? extractYouTubeHandleFromUrl(input.channelUrl);

  if (directChannelId) {
    return {
      channelId: directChannelId,
      feedUrl: buildYouTubeChannelFeedUrl(directChannelId),
      channelHandle: directHandle,
      channelUrl: input.channelUrl ?? `https://www.youtube.com/channel/${directChannelId}`,
      title: null,
    };
  }

  const publicPageUrl =
    input.channelUrl ??
    (directHandle ? buildYouTubeHandleUrl(directHandle) : null);

  if (publicPageUrl) {
    try {
      const html = await fetchYouTubeChannelPage(publicPageUrl);
      const resolved = extractYouTubeChannelFeedFromHtml(html);
      if (resolved) {
        return {
          ...resolved,
          channelHandle: directHandle ?? resolved.channelHandle,
          channelUrl: resolved.channelUrl ?? publicPageUrl,
        };
      }
    } catch {
      // Fall back to the API only when the public page path fails.
    }
  }

  if (!input.allowApiFallback) {
    return null;
  }

  const channel = await resolveYouTubeChannel(input);
  if (!channel) {
    return null;
  }

  return {
    channelId: channel.channelId,
    feedUrl: buildYouTubeChannelFeedUrl(channel.channelId),
    channelHandle: directHandle ?? normalizeYouTubeHandle(channel.customUrl),
    channelUrl: channel.channelUrl,
    title: channel.title,
  };
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

  if (youtubeApiQuotaExhausted) {
    return { results: [], quotaUsed: DAILY_QUOTA_LIMIT, quotaRemaining: 0 };
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
    if (errorText.includes("quotaExceeded")) {
      youtubeApiQuotaExhausted = true;
    }
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
  channelId?: string;
  uploadsPlaylistId?: string;
  channelHandle?: string;
  channelUrl?: string;
  channelName?: string;
  maxResults?: number;
}): Promise<{
  channel: YouTubeChannelSummary | null;
  items: YouTubeChannelUpload[];
}> {
  const maxResults = Math.max(1, Math.min(input.maxResults ?? 8, 20));
  const channel = await resolveYouTubeChannel(input);

  if (!channel?.uploadsPlaylistId) {
    return { channel, items: [] };
  }

  const playlistResponse = await fetchYouTubeJson<{
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
    playlistId: channel.uploadsPlaylistId,
    maxResults: String(maxResults),
  });

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
        channelId: item.snippet?.channelId ?? channel.channelId,
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

export async function fetchYouTubeComments(input: {
  videoId: string;
  maxResults?: number;
}): Promise<YouTubeCommentResult[]> {
  const env = getEnv();
  if (!env.YOUTUBE_API_KEY) {
    return [];
  }

  try {
    const response = await fetchYouTubeJson<{
      items?: Array<{
        id?: string;
        snippet?: {
          topLevelComment?: {
            id?: string;
            snippet?: {
              authorDisplayName?: string;
              textDisplay?: string;
              likeCount?: number;
              publishedAt?: string;
              updatedAt?: string;
            };
          };
        };
      }>;
    }>("commentThreads", {
      part: "snippet",
      videoId: input.videoId,
      order: "relevance",
      textFormat: "plainText",
      maxResults: String(Math.max(1, Math.min(input.maxResults ?? 8, 20))),
    });

    return (response.items ?? [])
      .map((item) => {
        const commentId = item.snippet?.topLevelComment?.id ?? item.id ?? "";
        const snippet = item.snippet?.topLevelComment?.snippet;
        const textDisplay = snippet?.textDisplay?.replace(/\s+/g, " ").trim() ?? "";

        if (!commentId || !textDisplay) {
          return null;
        }

        return {
          commentId,
          authorDisplayName: snippet?.authorDisplayName?.trim() || "Unknown",
          textDisplay,
          likeCount: Number(snippet?.likeCount ?? 0),
          publishedAt: snippet?.publishedAt ?? null,
          updatedAt: snippet?.updatedAt ?? null,
          url: `https://www.youtube.com/watch?v=${input.videoId}&lc=${commentId}`,
        } satisfies YouTubeCommentResult;
      })
      .filter((comment): comment is YouTubeCommentResult => Boolean(comment));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/commentsDisabled|processingFailure|videoNotFound/i.test(message)) {
      return [];
    }
    throw error;
  }
}
