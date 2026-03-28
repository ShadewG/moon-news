/**
 * YouTube Outlier Detection
 *
 * Fetches video statistics from YouTube Data API and detects videos
 * that are performing significantly above their channel's average.
 * An "outlier" is a video with 3x+ the channel's median views.
 */

import "server-only";

import { getDb } from "@/server/db/client";
import { boardFeedItems, boardSources, boardStoryCandidates, boardStorySources } from "@/server/db/schema";
import { eq, inArray, sql, desc, and, isNotNull } from "drizzle-orm";

const YOUTUBE_API_BASE = "https://www.googleapis.com/youtube/v3";
const OUTLIER_THRESHOLD = 3.0; // 3x median = outlier
const SURGE_BOOST_OUTLIER = 15; // bonus points for outlier videos

/**
 * Extract YouTube video ID from URL or external_id.
 */
function extractVideoId(url: string, externalId: string): string | null {
  // external_id often is the video ID
  if (/^[a-zA-Z0-9_-]{11}$/.test(externalId)) return externalId;
  // Try URL
  const match = url.match(/(?:v=|\/shorts\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  return match ? match[1] : null;
}

/**
 * Batch-fetch video statistics from YouTube Data API.
 * Returns a map of videoId → { viewCount, likeCount, commentCount }.
 */
async function fetchVideoStats(
  videoIds: string[],
  apiKey: string
): Promise<Map<string, { viewCount: number; likeCount: number; commentCount: number }>> {
  const results = new Map<string, { viewCount: number; likeCount: number; commentCount: number }>();
  if (videoIds.length === 0 || !apiKey) return results;

  // YouTube API allows up to 50 video IDs per call
  const chunks: string[][] = [];
  for (let i = 0; i < videoIds.length; i += 50) {
    chunks.push(videoIds.slice(i, i + 50));
  }

  for (const chunk of chunks) {
    try {
      const params = new URLSearchParams({
        part: "statistics",
        id: chunk.join(","),
        key: apiKey,
      });

      const res = await fetch(`${YOUTUBE_API_BASE}/videos?${params}`);
      if (!res.ok) {
        console.error(`[yt-outlier] YouTube API ${res.status}: ${await res.text().catch(() => "")}`);
        continue;
      }

      const data = (await res.json()) as {
        items?: Array<{
          id: string;
          statistics?: {
            viewCount?: string;
            likeCount?: string;
            commentCount?: string;
          };
        }>;
      };

      for (const item of data.items ?? []) {
        results.set(item.id, {
          viewCount: parseInt(item.statistics?.viewCount ?? "0", 10),
          likeCount: parseInt(item.statistics?.likeCount ?? "0", 10),
          commentCount: parseInt(item.statistics?.commentCount ?? "0", 10),
        });
      }
    } catch (err) {
      console.error("[yt-outlier] Failed to fetch video stats:", err);
    }
  }

  return results;
}

/**
 * Get historical median view count for a channel (from board_feed_items).
 */
async function getChannelMedianViews(sourceId: string): Promise<number> {
  const db = getDb();

  const rows = await db
    .select({
      viewCount: sql<number>`(${boardFeedItems.metadataJson}->>'viewCount')::bigint`,
    })
    .from(boardFeedItems)
    .where(
      and(
        eq(boardFeedItems.sourceId, sourceId),
        isNotNull(sql`${boardFeedItems.metadataJson}->>'viewCount'`),
        sql`(${boardFeedItems.metadataJson}->>'viewCount')::bigint > 0`
      )
    )
    .orderBy(sql`(${boardFeedItems.metadataJson}->>'viewCount')::bigint`)
    .limit(100);

  if (rows.length < 3) return 0; // not enough data

  const midIndex = Math.floor(rows.length / 2);
  return rows[midIndex].viewCount;
}

/**
 * Run outlier detection for recently ingested YouTube items.
 *
 * 1. Find YouTube feed items from the last hour that don't have viewCount
 * 2. Batch-fetch their stats from YouTube Data API
 * 3. Update the metadata_json with stats
 * 4. Detect outliers (3x+ channel median)
 * 5. Boost the linked story's surge_score for outliers
 *
 * Returns the number of outliers detected.
 */
export async function detectYouTubeOutliers(): Promise<{
  videosChecked: number;
  statsUpdated: number;
  outliersDetected: number;
}> {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    console.warn("[yt-outlier] YOUTUBE_API_KEY not set, skipping");
    return { videosChecked: 0, statsUpdated: 0, outliersDetected: 0 };
  }

  const db = getDb();

  // Find recent YouTube items without viewCount
  const recentItems = await db
    .select({
      id: boardFeedItems.id,
      url: boardFeedItems.url,
      externalId: boardFeedItems.externalId,
      sourceId: boardFeedItems.sourceId,
      title: boardFeedItems.title,
      metadataJson: boardFeedItems.metadataJson,
    })
    .from(boardFeedItems)
    .innerJoin(boardSources, eq(boardSources.id, boardFeedItems.sourceId))
    .where(
      and(
        eq(boardSources.kind, "youtube_channel"),
        sql`${boardFeedItems.ingestedAt} > NOW() - INTERVAL '2 hours'`,
        sql`(${boardFeedItems.metadataJson}->>'viewCount') IS NULL OR (${boardFeedItems.metadataJson}->>'viewCount')::bigint = 0`
      )
    )
    .limit(200);

  if (recentItems.length === 0) {
    return { videosChecked: 0, statsUpdated: 0, outliersDetected: 0 };
  }

  // Extract video IDs
  const videoIdMap = new Map<string, typeof recentItems[0]>();
  for (const item of recentItems) {
    const videoId = extractVideoId(item.url, item.externalId);
    if (videoId) videoIdMap.set(videoId, item);
  }

  // Fetch stats
  const stats = await fetchVideoStats(Array.from(videoIdMap.keys()), apiKey);

  let statsUpdated = 0;
  let outliersDetected = 0;

  // Update each item and check for outliers
  for (const [videoId, statData] of stats) {
    const item = videoIdMap.get(videoId);
    if (!item) continue;

    // Update metadata_json with stats
    const existingMeta = (item.metadataJson ?? {}) as Record<string, unknown>;
    const updatedMeta = {
      ...existingMeta,
      viewCount: statData.viewCount,
      likeCount: statData.likeCount,
      commentCount: statData.commentCount,
      statsUpdatedAt: new Date().toISOString(),
    };

    await db
      .update(boardFeedItems)
      .set({ metadataJson: updatedMeta })
      .where(eq(boardFeedItems.id, item.id));
    statsUpdated++;

    // Check for outlier
    if (statData.viewCount > 0) {
      const channelMedian = await getChannelMedianViews(item.sourceId);

      if (channelMedian > 0) {
        const ratio = statData.viewCount / channelMedian;
        const isOutlier = ratio >= OUTLIER_THRESHOLD;

        if (isOutlier) {
          outliersDetected++;
          console.log(
            `[yt-outlier] OUTLIER: "${item.title}" — ${statData.viewCount.toLocaleString()} views (${ratio.toFixed(1)}x channel median of ${channelMedian.toLocaleString()})`
          );

          // Update metadata with outlier flag
          await db
            .update(boardFeedItems)
            .set({
              metadataJson: {
                ...updatedMeta,
                isOutlier: true,
                outlierRatio: Number(ratio.toFixed(2)),
                channelMedianViews: channelMedian,
              },
            })
            .where(eq(boardFeedItems.id, item.id));

          // Boost linked story's surge_score
          const storyLinks = await db
            .select({ storyId: boardStorySources.storyId })
            .from(boardStorySources)
            .where(eq(boardStorySources.feedItemId, item.id));

          for (const link of storyLinks) {
            await db
              .update(boardStoryCandidates)
              .set({
                surgeScore: sql`LEAST(${boardStoryCandidates.surgeScore} + ${SURGE_BOOST_OUTLIER}, 100)`,
                updatedAt: new Date(),
              })
              .where(eq(boardStoryCandidates.id, link.storyId));
          }
        }
      }
    }
  }

  return { videosChecked: videoIdMap.size, statsUpdated, outliersDetected };
}
