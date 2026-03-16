import "server-only";

import type { MediaType } from "@/server/domain/status";

export interface ScoreBreakdown {
  relevanceScore: number;
  mediaTypeBonus: number;
  provenanceBonus: number;
  qualitySignal: number;
  repostPenalty: number;
  totalScore: number;
}

const MEDIA_TYPE_BONUSES: Record<MediaType, number> = {
  video: 20,
  image: 12,
  stock_video: 6,
  stock_image: 6,
  article: 0,
};

const PROVIDER_PROVENANCE: Record<string, number> = {
  internet_archive: 10,
  getty: 10,
  youtube: 5,
  twitter: 5,
  google_images: 3,
  storyblocks: 2,
  artlist: 2,
  parallel: 0,
  firecrawl: 0,
  openai: 0,
  gemini: 0,
  elevenlabs: 0,
  internal: 0,
};

// Channels known to produce high-quality documentary/news content
const QUALITY_CHANNELS = [
  "c-span", "cspan", "al jazeera", "bbc", "pbs", "frontline",
  "nyt", "new york times", "washington post", "the guardian",
  "60 minutes", "vice news", "reuters", "associated press", "ap archive",
  "abc news", "cbs news", "nbc news", "cnn", "msnbc",
  "democracy now", "the intercept", "propublica",
  "national geographic", "history channel", "smithsonian",
  "jre clips", "powerfuljre", "lex fridman",
];

const JUNK_CHANNEL_INDICATORS = [
  "ai story", "ai narrat", "ai generat", "ai visual", "ai history",
  "wikitubia", "#shorts", "story telling", "golden history",
  "minor profundity", "covert tales", "alterno archivo", "prompt voyager",
  "facts about", "amazing facts", "cinematicai", "ai facts",
  "proven conspiracies", "stateless standard",
];

const MIN_VIEW_COUNT = 5000; // Minimum views for YouTube/Twitter

const REPOST_INDICATORS = [
  "reupload", "re-upload", "compilation", "best of", "top 10",
  "montage", "#shorts",
];

const AGGREGATOR_CHANNELS = [
  "viral", "trending", "daily dose", "best clips", "top moments",
];

const MIN_VIDEO_DURATION_MS = 60_000; // Skip shorts under 60s

function computeQualitySignal(input: {
  channelOrContributor: string | null;
  viewCount: number;
  durationMs: number | null;
}): number {
  let signal = 0;
  const lowerChannel = (input.channelOrContributor ?? "").toLowerCase();

  // Quality channel boost
  for (const qc of QUALITY_CHANNELS) {
    if (lowerChannel.includes(qc)) {
      signal += 15;
      break;
    }
  }

  // Junk channel penalty
  for (const jc of JUNK_CHANNEL_INDICATORS) {
    if (lowerChannel.includes(jc)) {
      signal -= 20;
      break;
    }
  }

  // View count signal (log scale — 1K=+2, 10K=+5, 100K=+8, 1M=+10)
  if (input.viewCount > 0) {
    signal += Math.min(10, Math.floor(Math.log10(input.viewCount)));
  }

  // Duration signal — longer substantive content is better
  if (input.durationMs) {
    if (input.durationMs >= 600_000) signal += 5;       // 10+ min
    else if (input.durationMs >= 180_000) signal += 3;  // 3+ min
    else if (input.durationMs >= 60_000) signal += 1;   // 1+ min
  }

  return Math.max(-20, Math.min(20, signal));
}

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

  // Junk title indicators
  if (lowerTitle.includes("#shorts")) penalty -= 10;
  if (lowerTitle.includes("#facts")) penalty -= 5;
  if (lowerTitle.includes("&quot;")) {
    // Lots of HTML entities = often auto-generated
  }

  for (const aggregator of AGGREGATOR_CHANNELS) {
    if (lowerChannel.includes(aggregator)) {
      penalty -= 15;
      break;
    }
  }

  return Math.max(-30, penalty);
}

export function computeMatchScore(input: {
  relevanceRank: number;
  totalResults: number;
  mediaType: MediaType;
  provider: string;
  title: string;
  channelOrContributor: string | null;
  uploadDate: string | null;
  viewCount?: number;
  durationMs?: number | null;
}): ScoreBreakdown {
  // Relevance from provider ranking: 40 down to ~20 based on position
  // (reduced weight — AI relevance scoring will take over the real relevance)
  const relevanceScore = Math.max(
    20,
    40 - Math.floor((input.relevanceRank / Math.max(input.totalResults, 1)) * 20)
  );

  const mediaTypeBonus = MEDIA_TYPE_BONUSES[input.mediaType] ?? 0;
  const provenanceBonus = PROVIDER_PROVENANCE[input.provider] ?? 0;
  const qualitySignal = computeQualitySignal({
    channelOrContributor: input.channelOrContributor,
    viewCount: input.viewCount ?? 0,
    durationMs: input.durationMs ?? null,
  });
  const repostPenalty = computeRepostPenalty(
    input.title,
    input.channelOrContributor
  );

  const totalScore = Math.max(
    0,
    Math.min(
      100,
      relevanceScore + mediaTypeBonus + provenanceBonus + qualitySignal + repostPenalty
    )
  );

  return {
    relevanceScore,
    mediaTypeBonus,
    provenanceBonus,
    qualitySignal,
    repostPenalty,
    totalScore,
  };
}

/**
 * Filter out low-quality results before scoring.
 * Returns true if the result should be KEPT.
 */
export function passesQualityGate(input: {
  provider: string;
  title: string;
  durationMs: number | null;
  channelOrContributor: string | null;
  viewCount: number;
}): { passes: boolean; reason: string | null } {
  const lowerTitle = input.title.toLowerCase();
  const lowerChannel = (input.channelOrContributor ?? "").toLowerCase();

  // Filter YouTube Shorts (< 60s)
  if (input.provider === "youtube" && input.durationMs && input.durationMs < MIN_VIDEO_DURATION_MS) {
    return { passes: false, reason: "Too short (<60s)" };
  }

  // Minimum view count for YouTube and Twitter
  if (
    (input.provider === "youtube" || input.provider === "twitter") &&
    input.viewCount > 0 &&
    input.viewCount < MIN_VIEW_COUNT
  ) {
    return { passes: false, reason: `Low views (<${MIN_VIEW_COUNT.toLocaleString()})` };
  }

  // Filter obviously AI-generated/bot content
  for (const jc of JUNK_CHANNEL_INDICATORS) {
    if (lowerChannel.includes(jc) || lowerTitle.includes(jc)) {
      return { passes: false, reason: "AI-generated or low quality channel" };
    }
  }

  // Title-level AI detection
  if (
    (lowerTitle.includes("#aivisual") || lowerTitle.includes("cinematicai") || lowerTitle.includes("ai-generated")) &&
    !lowerTitle.includes("about ai")
  ) {
    return { passes: false, reason: "AI-generated content" };
  }

  return { passes: true, reason: null };
}
