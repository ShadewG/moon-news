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
import { scoreResultRelevance } from "@/server/providers/openai";
import { computeMatchScore, passesQualityGate, type ScoreBreakdown } from "./scoring";

interface ProviderResult {
  provider: string;
  mediaType: MediaType;
  externalAssetId: string;
  title: string;
  description: string;
  previewUrl: string | null;
  sourceUrl: string;
  licenseType: string | null;
  durationMs: number | null;
  width: number | null;
  height: number | null;
  isPrimarySource: boolean;
  uploadDate: string | null;
  channelOrContributor: string | null;
  viewCount: number;
  metadataJson: Record<string, unknown> | null;
}

type TierProvider = "youtube" | "internet_archive" | "google_images" | "getty" | "storyblocks";

// Every category searches ALL its tiers — no early stopping.
// Tiers are searched in parallel within each tier group for speed.
const CATEGORY_TIERS: Record<string, TierProvider[][]> = {
  concrete_event: [
    ["youtube", "internet_archive"],
    ["google_images", "getty"],
    ["storyblocks"],
  ],
  named_person: [
    ["youtube"],
    ["google_images", "getty"],
    ["storyblocks"],
  ],
  abstract_concept: [
    ["youtube"],
    ["google_images"],
    ["storyblocks"],
  ],
  quote_claim: [
    ["youtube"],
    ["google_images"],
    ["storyblocks"],
  ],
  historical_period: [
    ["internet_archive", "youtube"],
    ["google_images", "getty"],
    ["storyblocks"],
  ],
  transition: [],
  sample_story: [
    ["storyblocks"],
    ["google_images"],
  ],
};

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
        description: r.description,
        previewUrl: r.thumbnailUrl,
        sourceUrl: `https://www.youtube.com/watch?v=${r.videoId}`,
        licenseType: "YouTube Standard",
        durationMs: r.durationMs,
        width: 1920,
        height: 1080,
        isPrimarySource: false,
        uploadDate: r.publishedAt,
        channelOrContributor: r.channelTitle,
        viewCount: r.viewCount,
        metadataJson: { viewCount: r.viewCount, description: r.description },
      }));
    }

    case "internet_archive": {
      const { results } = await searchInternetArchive({ keywords, temporalContext });
      return results.map((r) => ({
        provider: "internet_archive",
        mediaType: (r.mediaType === "movies" ? "video" : "image") as MediaType,
        externalAssetId: r.identifier,
        title: r.title,
        description: r.description,
        previewUrl: r.thumbnailUrl,
        sourceUrl: r.sourceUrl,
        licenseType: "Public Domain / Open",
        durationMs: r.durationMs || null,
        width: null,
        height: null,
        isPrimarySource: true,
        uploadDate: r.year,
        channelOrContributor: r.creator,
        viewCount: 0,
        metadataJson: { collection: r.collection, description: r.description },
      }));
    }

    case "google_images": {
      const { results } = await searchGoogleImages({ keywords, temporalContext });
      return results.map((r) => ({
        provider: "google_images",
        mediaType: "image" as MediaType,
        externalAssetId: r.link,
        title: r.title,
        description: r.snippet,
        previewUrl: r.thumbnailUrl,
        sourceUrl: r.link,
        licenseType: null,
        durationMs: null,
        width: r.width,
        height: r.height,
        isPrimarySource: false,
        uploadDate: null,
        channelOrContributor: r.displayLink,
        viewCount: 0,
        metadataJson: { snippet: r.snippet, contextLink: r.contextLink },
      }));
    }

    case "getty": {
      const { results } = await searchGetty({ keywords, temporalContext });
      return results.map((r) => ({
        provider: "getty",
        mediaType: "image" as MediaType,
        externalAssetId: r.assetId,
        title: r.title,
        description: r.caption,
        previewUrl: r.previewUrl,
        sourceUrl: r.sourceUrl,
        licenseType: "Getty Editorial",
        durationMs: null,
        width: r.width,
        height: r.height,
        isPrimarySource: false,
        uploadDate: r.dateCreated,
        channelOrContributor: r.artist,
        viewCount: 0,
        metadataJson: { collection: r.collection, caption: r.caption },
      }));
    }

    case "storyblocks": {
      const { results } = await searchStoryblocks({ keywords, temporalContext });
      return results.map((r) => ({
        provider: "storyblocks",
        mediaType: "stock_video" as MediaType,
        externalAssetId: r.assetId,
        title: r.title,
        description: r.keywords.join(", "),
        previewUrl: r.thumbnailUrl,
        sourceUrl: r.sourceUrl,
        licenseType: "Storyblocks License",
        durationMs: r.durationMs,
        width: r.width,
        height: r.height,
        isPrimarySource: false,
        uploadDate: null,
        channelOrContributor: null,
        viewCount: 0,
        metadataJson: { keywords: r.keywords },
      }));
    }
  }
}

interface ScoredResult extends ProviderResult {
  score: ScoreBreakdown;
  runId: string;
  filtered: boolean;
  filterReason: string | null;
}

export async function runVisualSearchTask(input: {
  projectId: string;
  scriptLineId: string;
  lineText: string;
  category: string;
  searchKeywords: string[];
  temporalContext: string | null;
}): Promise<{ totalAssets: number; tiersSearched: number }> {
  const db = getDb();
  const tiers = CATEGORY_TIERS[input.category] ?? [];

  if (tiers.length === 0) {
    return { totalAssets: 0, tiersSearched: 0 };
  }

  const allResults: ScoredResult[] = [];

  // Search ALL tiers — no early stopping. Doc editors need variety.
  for (const tierProviders of tiers) {
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
          const rawResults = await searchProvider(
            provider,
            input.searchKeywords,
            input.temporalContext
          );

          // Quality gate — mark failures but still store them
          const withQuality = rawResults.map((r) => {
            const passes = passesQualityGate({
              provider: r.provider,
              title: r.title,
              durationMs: r.durationMs,
              channelOrContributor: r.channelOrContributor,
              viewCount: r.viewCount,
            });
            let filterReason: string | null = null;
            if (!passes) {
              if (r.durationMs && r.durationMs < 60_000) filterReason = "Too short (<60s)";
              else filterReason = "Low quality channel";
            }
            return { ...r, qualityPasses: passes, filterReason };
          });

          // AI relevance scoring on all results (even filtered ones get scored)
          let relevanceScores: number[];
          try {
            relevanceScores = await scoreResultRelevance({
              lineText: input.lineText,
              results: withQuality.map((r) => ({
                title: r.title,
                description: r.description,
                provider: r.provider,
              })),
            });
          } catch {
            relevanceScores = withQuality.map((_, i) =>
              Math.max(20, 40 - Math.floor((i / withQuality.length) * 20))
            );
          }

          await db
            .update(footageSearchRuns)
            .set({
              status: "complete",
              resultsCount: rawResults.length,
              completedAt: new Date(),
              updatedAt: new Date(),
            })
            .where(eq(footageSearchRuns.id, run.id));

          return withQuality.map((r, i): ScoredResult => {
            const aiRelevance = relevanceScores[i] ?? 20;
            const isFiltered = !r.qualityPasses || aiRelevance < 5;
            const filterReason = r.filterReason
              ?? (aiRelevance < 5 ? "Irrelevant to script line" : null);

            const baseScore = computeMatchScore({
              relevanceRank: i,
              totalResults: withQuality.length,
              mediaType: r.mediaType,
              provider: r.provider,
              title: r.title,
              channelOrContributor: r.channelOrContributor,
              uploadDate: r.uploadDate,
              viewCount: r.viewCount,
              durationMs: r.durationMs,
            });

            const totalScore = Math.max(
              0,
              Math.min(
                100,
                aiRelevance +
                  baseScore.mediaTypeBonus +
                  baseScore.provenanceBonus +
                  baseScore.qualitySignal +
                  baseScore.repostPenalty
              )
            );

            return {
              ...r,
              runId: run.id,
              filtered: isFiltered,
              filterReason: isFiltered ? filterReason : null,
              score: {
                ...baseScore,
                relevanceScore: aiRelevance,
                totalScore,
              },
            };
          });
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

    allResults.push(...tierResults.flat());
  }

  // Sort: non-filtered first by score, then filtered by score
  allResults.sort((a, b) => {
    if (a.filtered !== b.filtered) return a.filtered ? 1 : -1;
    return b.score.totalScore - a.score.totalScore;
  });

  // Insert ALL results into DB (including filtered ones)
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
        filtered: r.filtered,
        filterReason: r.filterReason,
      }))
    );
  }

  const visibleCount = allResults.filter((r) => !r.filtered).length;

  await db
    .update(scriptLines)
    .set({
      footageStatus: visibleCount > 0 ? "complete" : "needs_review",
      updatedAt: new Date(),
    })
    .where(eq(scriptLines.id, input.scriptLineId));

  return {
    totalAssets: allResults.length,
    tiersSearched: tiers.length,
  };
}
