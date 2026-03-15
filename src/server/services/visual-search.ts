import "server-only";

import { eq } from "drizzle-orm";

import { getDb } from "@/server/db/client";
import {
  footageAssets,
  footageSearchRuns,
  scriptLines,
} from "@/server/db/schema";
import type { MediaType } from "@/server/domain/status";
import { searchYouTube } from "@/server/providers/youtube";
import { searchInternetArchive } from "@/server/providers/internet-archive";
import { searchGoogleImages } from "@/server/providers/google-images";
import { searchGetty } from "@/server/providers/getty";
import { searchStoryblocks } from "@/server/providers/storyblocks";
import { computeMatchScore, type ScoreBreakdown } from "./scoring";

interface ProviderResult {
  provider: string;
  mediaType: MediaType;
  externalAssetId: string;
  title: string;
  previewUrl: string | null;
  sourceUrl: string;
  licenseType: string | null;
  durationMs: number | null;
  width: number | null;
  height: number | null;
  isPrimarySource: boolean;
  uploadDate: string | null;
  channelOrContributor: string | null;
  metadataJson: Record<string, unknown> | null;
}

type TierProvider = "youtube" | "internet_archive" | "google_images" | "getty" | "storyblocks";

const CATEGORY_TIERS: Record<string, TierProvider[][]> = {
  concrete_event: [
    ["youtube", "internet_archive"],
    ["getty", "google_images"],
    ["storyblocks"],
  ],
  named_person: [
    ["youtube"],
    ["google_images", "getty"],
    ["storyblocks"],
  ],
  abstract_concept: [
    ["storyblocks"],
    ["google_images"],
  ],
  quote_claim: [
    ["youtube"],
    ["google_images"],
  ],
  historical_period: [
    ["internet_archive"],
    ["youtube"],
    ["getty"],
  ],
  transition: [],
  sample_story: [
    ["storyblocks"],
  ],
};

const MIN_GOOD_RESULTS = 3;
const MIN_GOOD_SCORE = 60;

async function searchProvider(
  provider: TierProvider,
  keywords: string[],
  temporalContext: string | null
): Promise<ProviderResult[]> {
  switch (provider) {
    case "youtube": {
      const { results } = await searchYouTube({ keywords, temporalContext });
      return results.map((r) => ({
        provider: "youtube",
        mediaType: "video" as MediaType,
        externalAssetId: r.videoId,
        title: r.title,
        previewUrl: r.thumbnailUrl,
        sourceUrl: `https://www.youtube.com/watch?v=${r.videoId}`,
        licenseType: "YouTube Standard",
        durationMs: r.durationMs,
        width: 1920,
        height: 1080,
        isPrimarySource: false,
        uploadDate: r.publishedAt,
        channelOrContributor: r.channelTitle,
        metadataJson: {
          viewCount: r.viewCount,
          description: r.description,
        },
      }));
    }

    case "internet_archive": {
      const { results } = await searchInternetArchive({ keywords, temporalContext });
      return results.map((r) => ({
        provider: "internet_archive",
        mediaType: (r.mediaType === "movies" ? "video" : "image") as MediaType,
        externalAssetId: r.identifier,
        title: r.title,
        previewUrl: r.thumbnailUrl,
        sourceUrl: r.sourceUrl,
        licenseType: "Public Domain / Open",
        durationMs: r.durationMs || null,
        width: null,
        height: null,
        isPrimarySource: true,
        uploadDate: r.year,
        channelOrContributor: r.creator,
        metadataJson: {
          collection: r.collection,
          description: r.description,
        },
      }));
    }

    case "google_images": {
      const { results } = await searchGoogleImages({ keywords, temporalContext });
      return results.map((r) => ({
        provider: "google_images",
        mediaType: "image" as MediaType,
        externalAssetId: r.link,
        title: r.title,
        previewUrl: r.thumbnailUrl,
        sourceUrl: r.link,
        licenseType: null,
        durationMs: null,
        width: r.width,
        height: r.height,
        isPrimarySource: false,
        uploadDate: null,
        channelOrContributor: r.displayLink,
        metadataJson: {
          snippet: r.snippet,
          contextLink: r.contextLink,
        },
      }));
    }

    case "getty": {
      const { results } = await searchGetty({ keywords, temporalContext });
      return results.map((r) => ({
        provider: "getty",
        mediaType: "image" as MediaType,
        externalAssetId: r.assetId,
        title: r.title,
        previewUrl: r.previewUrl,
        sourceUrl: r.sourceUrl,
        licenseType: "Getty Editorial",
        durationMs: null,
        width: r.width,
        height: r.height,
        isPrimarySource: false,
        uploadDate: r.dateCreated,
        channelOrContributor: r.artist,
        metadataJson: {
          collection: r.collection,
          caption: r.caption,
        },
      }));
    }

    case "storyblocks": {
      const { results } = await searchStoryblocks({ keywords, temporalContext });
      return results.map((r) => ({
        provider: "storyblocks",
        mediaType: "stock_video" as MediaType,
        externalAssetId: r.assetId,
        title: r.title,
        previewUrl: r.thumbnailUrl,
        sourceUrl: r.sourceUrl,
        licenseType: "Storyblocks License",
        durationMs: r.durationMs,
        width: r.width,
        height: r.height,
        isPrimarySource: false,
        uploadDate: null,
        channelOrContributor: null,
        metadataJson: { keywords: r.keywords },
      }));
    }
  }
}

export async function runVisualSearchTask(input: {
  projectId: string;
  scriptLineId: string;
  category: string;
  searchKeywords: string[];
  temporalContext: string | null;
}): Promise<{ totalAssets: number; tiersSearched: number }> {
  const db = getDb();
  const tiers = CATEGORY_TIERS[input.category] ?? [];

  if (tiers.length === 0) {
    return { totalAssets: 0, tiersSearched: 0 };
  }

  let allResults: Array<ProviderResult & { score: ScoreBreakdown; runId: string }> = [];
  let tiersSearched = 0;

  for (const tierProviders of tiers) {
    tiersSearched++;

    const tierResults = await Promise.all(
      tierProviders.map(async (provider) => {
        const [run] = await db
          .insert(footageSearchRuns)
          .values({
            projectId: input.projectId,
            scriptLineId: input.scriptLineId,
            provider,
            status: "running",
            query: input.searchKeywords.join(" "),
            startedAt: new Date(),
          })
          .returning();

        try {
          const results = await searchProvider(
            provider,
            input.searchKeywords,
            input.temporalContext
          );

          await db
            .update(footageSearchRuns)
            .set({
              status: "complete",
              resultsCount: results.length,
              completedAt: new Date(),
              updatedAt: new Date(),
            })
            .where(eq(footageSearchRuns.id, run.id));

          return results.map((r, i): ProviderResult & { score: ScoreBreakdown; runId: string } => ({
            ...r,
            runId: run.id,
            score: computeMatchScore({
              relevanceRank: i,
              totalResults: results.length,
              mediaType: r.mediaType,
              provider: r.provider,
              title: r.title,
              channelOrContributor: r.channelOrContributor,
              uploadDate: r.uploadDate,
            }),
          }));
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Unknown error";

          await db
            .update(footageSearchRuns)
            .set({
              status: "failed",
              errorMessage: message,
              completedAt: new Date(),
              updatedAt: new Date(),
            })
            .where(eq(footageSearchRuns.id, run.id));

          return [];
        }
      })
    );

    const flatResults = tierResults.flat();
    allResults = allResults.concat(flatResults);

    // Check if we have enough good results to stop
    const goodResults = allResults.filter(
      (r) => r.score.totalScore >= MIN_GOOD_SCORE
    );
    if (goodResults.length >= MIN_GOOD_RESULTS) {
      break;
    }
  }

  // Sort by score descending
  allResults.sort((a, b) => b.score.totalScore - a.score.totalScore);

  // Insert assets into DB
  if (allResults.length > 0) {
    await db.insert(footageAssets).values(
      allResults.map((r) => ({
        footageSearchRunId: r.runId,
        scriptLineId: input.scriptLineId,
        provider: r.provider as "youtube" | "internet_archive" | "getty" | "google_images" | "storyblocks",
        mediaType: r.mediaType,
        externalAssetId: r.externalAssetId,
        title: r.title,
        previewUrl: r.previewUrl,
        sourceUrl: r.sourceUrl,
        licenseType: r.licenseType,
        durationMs: r.durationMs,
        width: r.width,
        height: r.height,
        matchScore: r.score.totalScore,
        isPrimarySource: r.isPrimarySource,
        uploadDate: r.uploadDate,
        channelOrContributor: r.channelOrContributor,
        scoreBreakdownJson: r.score,
        metadataJson: r.metadataJson,
      }))
    );
  }

  // Update script line footage status
  await db
    .update(scriptLines)
    .set({
      footageStatus: allResults.length > 0 ? "complete" : "needs_review",
      updatedAt: new Date(),
    })
    .where(eq(scriptLines.id, input.scriptLineId));

  return {
    totalAssets: allResults.length,
    tiersSearched,
  };
}
