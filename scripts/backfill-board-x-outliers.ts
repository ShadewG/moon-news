import path from "node:path";

import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { config as loadDotenv } from "dotenv";

import { getDb } from "../src/server/db/client";
import { boardFeedItems, boardSources, boardStorySources } from "../src/server/db/schema";
import { scoreStory } from "../src/server/services/board/story-scorer";

loadDotenv({ path: path.resolve(process.cwd(), ".env") });
loadDotenv({ path: path.resolve(process.cwd(), ".env.local"), override: true });

const LOOKBACK_HOURS = 24;
const BASELINE_SAMPLE_SIZE = 40;
const MIN_BASELINE_POSTS = 8;
const MIN_POSITIVE_METRIC_POSTS = 5;
const STORY_RESCORE_LIMIT = 80;

function coerceObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function coerceMetricCount(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value.replace(/[,_]/g, ""));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function computeMedian(values: number[]) {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 0) {
    return Math.round((sorted[middle - 1]! + sorted[middle]!) / 2);
  }

  return Math.round(sorted[middle]!);
}

function computeBaseline(rows: Array<{ metadataJson: unknown }>) {
  if (rows.length < MIN_BASELINE_POSTS) {
    return null;
  }

  const viewCounts: number[] = [];
  const likeCounts: number[] = [];
  const retweetCounts: number[] = [];

  for (const row of rows) {
    const metadata = coerceObject(row.metadataJson);
    const viewCount = coerceMetricCount(metadata?.viewCount);
    const likeCount = coerceMetricCount(metadata?.likeCount);
    const retweetCount = coerceMetricCount(metadata?.retweetCount);

    if (viewCount > 0) {
      viewCounts.push(viewCount);
    }
    if (likeCount > 0) {
      likeCounts.push(likeCount);
    }
    if (retweetCount > 0) {
      retweetCounts.push(retweetCount);
    }
  }

  if (
    viewCounts.length < MIN_POSITIVE_METRIC_POSTS &&
    likeCounts.length < MIN_POSITIVE_METRIC_POSTS &&
    retweetCounts.length < MIN_POSITIVE_METRIC_POSTS
  ) {
    return null;
  }

  return {
    sampleSize: rows.length,
    medianViewCount:
      viewCounts.length >= MIN_POSITIVE_METRIC_POSTS ? computeMedian(viewCounts) : 0,
    medianLikeCount:
      likeCounts.length >= MIN_POSITIVE_METRIC_POSTS ? computeMedian(likeCounts) : 0,
    medianRetweetCount:
      retweetCounts.length >= MIN_POSITIVE_METRIC_POSTS ? computeMedian(retweetCounts) : 0,
  };
}

function enrichMetadata(
  metadataJson: Record<string, unknown>,
  baseline: ReturnType<typeof computeBaseline>
) {
  if (!baseline) {
    return metadataJson;
  }

  const viewCount = coerceMetricCount(metadataJson.viewCount);
  const likeCount = coerceMetricCount(metadataJson.likeCount);
  const retweetCount = coerceMetricCount(metadataJson.retweetCount);
  const viewOutlierRatio =
    baseline.medianViewCount > 0 && viewCount > 0
      ? Number((viewCount / baseline.medianViewCount).toFixed(2))
      : null;
  const likeOutlierRatio =
    baseline.medianLikeCount > 0 && likeCount > 0
      ? Number((likeCount / baseline.medianLikeCount).toFixed(2))
      : null;
  const retweetOutlierRatio =
    baseline.medianRetweetCount > 0 && retweetCount > 0
      ? Number((retweetCount / baseline.medianRetweetCount).toFixed(2))
      : null;
  const ratios = [viewOutlierRatio, likeOutlierRatio, retweetOutlierRatio].filter(
    (value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0
  );
  const maxOutlierRatio = ratios.length > 0 ? Math.max(...ratios) : null;

  return {
    ...metadataJson,
    accountHistoricalPostCount: baseline.sampleSize,
    accountTypicalViewCount: baseline.medianViewCount || null,
    accountTypicalLikeCount: baseline.medianLikeCount || null,
    accountTypicalRetweetCount: baseline.medianRetweetCount || null,
    viewOutlierRatio,
    likeOutlierRatio,
    retweetOutlierRatio,
    maxOutlierRatio,
    isEngagementOutlier: maxOutlierRatio !== null && maxOutlierRatio >= 3,
    isStrongEngagementOutlier: maxOutlierRatio !== null && maxOutlierRatio >= 5,
  };
}

async function main() {
  const db = getDb();
  const since = new Date(Date.now() - LOOKBACK_HOURS * 60 * 60 * 1000);
  const recentItems = await db
    .select({
      id: boardFeedItems.id,
      sourceId: boardFeedItems.sourceId,
      metadataJson: boardFeedItems.metadataJson,
    })
    .from(boardFeedItems)
    .innerJoin(boardSources, eq(boardSources.id, boardFeedItems.sourceId))
    .where(and(eq(boardSources.kind, "x_account"), gte(boardFeedItems.ingestedAt, since)))
    .orderBy(desc(boardFeedItems.ingestedAt));

  const baselineCache = new Map<string, ReturnType<typeof computeBaseline>>();
  const updatedItemIds: string[] = [];
  const outlierItemIds: string[] = [];
  let updatedFeedItems = 0;
  let outlierFeedItems = 0;

  for (const item of recentItems) {
    let baseline = baselineCache.get(item.sourceId);
    if (baseline === undefined) {
      const sourceRows = await db
        .select({
          metadataJson: boardFeedItems.metadataJson,
        })
        .from(boardFeedItems)
        .where(eq(boardFeedItems.sourceId, item.sourceId))
        .orderBy(desc(boardFeedItems.publishedAt), desc(boardFeedItems.ingestedAt))
        .limit(BASELINE_SAMPLE_SIZE);
      baseline = computeBaseline(sourceRows);
      baselineCache.set(item.sourceId, baseline);
    }

    const existingMetadata = coerceObject(item.metadataJson) ?? {};
    const nextMetadata = enrichMetadata(existingMetadata, baseline);
    if (JSON.stringify(existingMetadata) === JSON.stringify(nextMetadata)) {
      continue;
    }

    await db
      .update(boardFeedItems)
      .set({ metadataJson: nextMetadata })
      .where(eq(boardFeedItems.id, item.id));
    updatedFeedItems += 1;
    updatedItemIds.push(item.id);

    if (nextMetadata.isEngagementOutlier === true) {
      outlierFeedItems += 1;
      outlierItemIds.push(item.id);
    }
  }

  const storyIds: string[] = [];
  const targetItemIds = outlierItemIds.length > 0 ? outlierItemIds : updatedItemIds;

  for (let index = 0; index < targetItemIds.length; index += 500) {
    const chunk = targetItemIds.slice(index, index + 500);
    if (chunk.length === 0) {
      continue;
    }

    const links = await db
      .select({
        storyId: boardStorySources.storyId,
      })
      .from(boardStorySources)
      .where(inArray(boardStorySources.feedItemId, chunk));

    for (const link of links) {
      if (!storyIds.includes(link.storyId)) {
        storyIds.push(link.storyId);
      }
    }
  }

  const rescoredStoryIds = storyIds.slice(0, STORY_RESCORE_LIMIT);
  for (const storyId of rescoredStoryIds) {
    await scoreStory(storyId);
  }

  console.log(
    JSON.stringify(
      {
        lookbackHours: LOOKBACK_HOURS,
        recentXItems: recentItems.length,
        updatedFeedItems,
        outlierFeedItems,
        affectedStories: storyIds.length,
        rescoredStories: rescoredStoryIds.length,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
