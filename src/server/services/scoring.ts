import "server-only";

import type { MediaType } from "@/server/domain/status";

export interface ScoreBreakdown {
  relevanceScore: number;
  mediaTypeBonus: number;
  provenanceBonus: number;
  dateBonus: number;
  repostPenalty: number;
  totalScore: number;
}

const MEDIA_TYPE_BONUSES: Record<MediaType, number> = {
  video: 30,
  image: 20,
  stock_video: 10,
  stock_image: 10,
  article: 0,
};

const PROVIDER_PROVENANCE: Record<string, number> = {
  internet_archive: 20,
  getty: 15,
  youtube: 10,
  google_images: 8,
  storyblocks: 5,
  artlist: 5,
  parallel: 0,
  firecrawl: 0,
  openai: 0,
  gemini: 0,
  elevenlabs: 0,
  internal: 0,
};

const REPOST_INDICATORS = [
  "reupload",
  "re-upload",
  "compilation",
  "best of",
  "top 10",
  "montage",
];

const AGGREGATOR_CHANNELS = [
  "viral",
  "trending",
  "daily dose",
  "best clips",
  "top moments",
];

function computeRepostPenalty(
  title: string,
  channelOrContributor: string | null
): number {
  const lowerTitle = title.toLowerCase();
  const lowerChannel = (channelOrContributor ?? "").toLowerCase();

  let penalty = 0;

  for (const indicator of REPOST_INDICATORS) {
    if (lowerTitle.includes(indicator)) {
      penalty -= 15;
      break;
    }
  }

  for (const aggregator of AGGREGATOR_CHANNELS) {
    if (lowerChannel.includes(aggregator)) {
      penalty -= 15;
      break;
    }
  }

  return Math.max(-30, penalty);
}

function computeDateBonus(uploadDate: string | null): number {
  if (!uploadDate) return 0;

  try {
    const date = new Date(uploadDate);
    const now = new Date();
    const yearsDiff =
      (now.getTime() - date.getTime()) / (365.25 * 24 * 60 * 60 * 1000);

    // Older uploads get higher bonus (primary sources tend to be uploaded earlier)
    if (yearsDiff > 10) return 10;
    if (yearsDiff > 5) return 7;
    if (yearsDiff > 2) return 4;
    if (yearsDiff > 1) return 2;
    return 0;
  } catch {
    return 0;
  }
}

export function computeMatchScore(input: {
  relevanceRank: number;
  totalResults: number;
  mediaType: MediaType;
  provider: string;
  title: string;
  channelOrContributor: string | null;
  uploadDate: string | null;
}): ScoreBreakdown {
  // Relevance from provider ranking: 50 down to ~25 based on position
  const relevanceScore = Math.max(
    25,
    50 - Math.floor((input.relevanceRank / Math.max(input.totalResults, 1)) * 25)
  );

  const mediaTypeBonus = MEDIA_TYPE_BONUSES[input.mediaType] ?? 0;
  const provenanceBonus = PROVIDER_PROVENANCE[input.provider] ?? 0;
  const dateBonus = computeDateBonus(input.uploadDate);
  const repostPenalty = computeRepostPenalty(
    input.title,
    input.channelOrContributor
  );

  const totalScore = Math.max(
    0,
    Math.min(
      100,
      relevanceScore + mediaTypeBonus + provenanceBonus + dateBonus + repostPenalty
    )
  );

  return {
    relevanceScore,
    mediaTypeBonus,
    provenanceBonus,
    dateBonus,
    repostPenalty,
    totalScore,
  };
}
