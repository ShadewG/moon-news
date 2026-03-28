import "server-only";

import { createHash } from "node:crypto";

import { and, desc, eq, gte, sql } from "drizzle-orm";

import { getEnv } from "@/server/config/env";
import { getDb } from "@/server/db/client";
import {
  boardCompetitorPosts,
  boardFeedItems,
  boardSources,
  boardStoryCandidates,
  boardStorySources,
  clipLibrary,
} from "@/server/db/schema";
import { scoreBoardStoryWithMoonCorpus } from "@/server/services/moon-corpus";
import { assessBoardStory, type BoardStoryAssessment } from "@/server/providers/openai";
import { scoreMoonRelevance } from "./moon-relevance";

// ─── Types ───

export interface ScoreBreakdown {
  sourceScore: number;
  controversyScore: number;
  timelinessScore: number;
  competitorOverlap: number;
  visualEvidence: number;
  moonRelevance: number;
}

export type StoryTier = "S" | "A" | "B" | "C" | "D";

export interface StoryScoreResult {
  totalScore: number;
  breakdown: ScoreBreakdown;
  tier: StoryTier;
  surgeActive: boolean;
}

// ─── Tier-1 source detection ───

const TIER1_SOURCES = [
  "nytimes.com",
  "reuters.com",
  "apnews.com",
  "bbc.com",
  "bbc.co.uk",
  "washingtonpost.com",
  "theguardian.com",
  "wsj.com",
  "cnn.com",
  "bloomberg.com",
];

const BOARD_AI_SCORING_PROMPT_PROFILE = getEnv().BOARD_AI_SCORING_PROFILE;
const BOARD_AI_SCORING_PROMPT_VERSION =
  BOARD_AI_SCORING_PROMPT_PROFILE === "online_culture"
    ? "v25-online-culture-terminally-online-4"
    : BOARD_AI_SCORING_PROMPT_PROFILE === "mens"
      ? "v20-mens-1"
      : "v20";
const BOARD_AI_SCORING_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const BOARD_AI_SCORING_MAX_STORY_AGE_HOURS = 72;

const NEWSWIRE_OR_INSTITUTIONAL_X_SOURCE_NAMES = [
  "ap",
  "associated press",
  "reuters",
  "bbc",
  "npr",
  "open secrets",
  "opensecrets",
  "guardian",
  "new york times",
  "washington post",
  "bloomberg",
  "wall street journal",
  "cnn",
  "fox news",
];

interface CachedBoardAiAssessment extends BoardStoryAssessment {
  model: string;
  promptVersion: string;
  inputHash: string;
  computedAt: string;
}

interface BoardAttentionSignals {
  hasXDiscourse: boolean;
  hasTikTokPickup: boolean;
  hasYouTubePickup: boolean;
  hasRedditPickup: boolean;
  hasMultipleSources: boolean;
  competitorOverlap: number;
  visualEvidence: number;
  xPostCount: number;
  xHighEngagementPostCount: number;
  xVideoPostCount: number;
  xHighEngagementVideoPostCount: number;
  xOutlierPostCount: number;
  xStrongOutlierPostCount: number;
  maxXOutlierRatio: number;
  tiktokPostCount: number;
  tiktokHighEngagementPostCount: number;
  tiktokVideoPostCount: number;
  tiktokOutlierPostCount: number;
  tiktokStrongOutlierPostCount: number;
  maxTikTokOutlierRatio: number;
  aggregateViewCount: number;
  maxViewCount: number;
  aggregateLikeCount: number;
  aggregateRetweetCount: number;
  aggregateCommentCount: number;
  maxCommentCount: number;
  xCommentHeavyPostCount: number;
  tiktokCommentHeavyPostCount: number;
  highCommentSourceCount: number;
  backlashSourceCount: number;
  reactionSourceCount: number;
  institutionalSpectacleSourceCount: number;
}

interface BoardAudienceReactionSummary {
  intensity: "quiet" | "active" | "loud" | "frenzy";
  mode: "watching" | "breakout" | "debate" | "backlash" | "spectacle";
  summary: string;
}

function isTier1Source(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    return TIER1_SOURCES.some(
      (s) => hostname === s || hostname.endsWith(`.${s}`)
    );
  } catch {
    return false;
  }
}

function getTier(score: number): StoryTier {
  if (score >= 90) return "S";
  if (score >= 80) return "A";
  if (score >= 70) return "B";
  if (score >= 60) return "C";
  return "D";
}

function hasLowQualityCanonicalTitle(title: string): boolean {
  const cleaned = title.trim().replace(/\s+/g, " ");
  if (!cleaned) return true;

  const words = cleaned
    .split(/\s+/)
    .map((word) => word.replace(/^[^a-z0-9]+|[^a-z0-9]+$/gi, ""))
    .filter(Boolean);

  return words.length <= 2 && cleaned.length <= 30;
}

function isSignalOnlySourceKind(kind: string): boolean {
  return kind === "google_trends" || kind === "twitter_trending";
}

function getStoryFreshnessReferenceAt(args: {
  storyLastSeenAt: Date | null;
  feedItems: Array<{
    sourceKind: string;
    publishedAt: Date | null;
  }>;
}) {
  const nonSignalDates = args.feedItems
    .filter((item) => !isSignalOnlySourceKind(item.sourceKind))
    .map((item) => item.publishedAt)
    .filter((value): value is Date => Boolean(value));

  if (nonSignalDates.length > 0) {
    return new Date(Math.max(...nonSignalDates.map((date) => date.getTime())));
  }

  const anyDates = args.feedItems
    .map((item) => item.publishedAt)
    .filter((value): value is Date => Boolean(value));

  if (anyDates.length > 0) {
    return new Date(Math.max(...anyDates.map((date) => date.getTime())));
  }

  return args.storyLastSeenAt;
}

function buildEffectiveSourceSummary(item: {
  sourceKind: string;
  summary: string | null;
  metadataJson?: unknown;
}) {
  const metadata = coerceScoreJson(item.metadataJson);
  const transcriptSummary =
    typeof metadata.transcriptSummary === "string"
      ? metadata.transcriptSummary.replace(/\s+/g, " ").trim()
      : "";
  const videoDescription =
    typeof metadata.videoDescription === "string"
      ? metadata.videoDescription.replace(/\s+/g, " ").trim()
      : "";
  const baseSummary = item.summary?.trim() ?? "";
  const transcriptBackedSummary =
    transcriptSummary.length > 0
      ? `Transcript-backed summary: ${transcriptSummary}`
      : "";

  if (item.sourceKind === "x_account" || isTikTokBoardSourceKind(item.sourceKind)) {
    const parts: string[] = [];
    if (baseSummary) {
      parts.push(baseSummary);
    }
    if (
      transcriptBackedSummary &&
      !parts.some((part) => part.toLowerCase().includes(transcriptSummary.toLowerCase()))
    ) {
      parts.push(transcriptBackedSummary);
    }
    if (
      videoDescription &&
      !parts.some((part) => part.toLowerCase().includes(videoDescription.toLowerCase()))
    ) {
      parts.push(`Clip: ${videoDescription}`);
    }

    if (parts.length > 0) {
      const combined = parts.join("\n");
      if (combined.length <= 900) {
        return combined;
      }
      return combined.slice(0, 897).trimEnd() + "...";
    }

    return null;
  }

  if (baseSummary) {
    return baseSummary;
  }

  if (item.sourceKind !== "youtube_channel") {
    return null;
  }

  const normalizedDescription =
    typeof metadata.normalizedDescription === "string"
      ? metadata.normalizedDescription.trim()
      : "";
  if (normalizedDescription.length > 0) {
    return normalizedDescription;
  }

  const rawDescription =
    typeof metadata.rawDescription === "string"
      ? metadata.rawDescription.replace(/\s+/g, " ").trim()
      : "";
  return rawDescription.length > 0 ? rawDescription.slice(0, 500) : null;
}

function coerceBoardMetricCount(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return 0;
  }

  return Math.round(numeric);
}

function coerceBoardRatio(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return 0;
  }

  return numeric;
}

function formatBoardMetricCount(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return "0";
  }

  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
  }

  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(value >= 100_000 ? 0 : 1)}K`;
  }

  return String(Math.round(value));
}

function hasBacklashEvidenceText(text: string): boolean {
  return /\b(backlash|hated?|hate train|fans react|fan backlash|mocked|mocking|roasted|ratioed|dragged|clowned|panned|review bomb|review bombing|death threats?|threats over|controversy|outrage|slammed)\b/i.test(
    text
  );
}

function hasReactionWaveText(text: string): boolean {
  return /\b(reacts?|reaction|fans react|internet reacts|viral|memes?|discourse|debate|quote tweet|quote-tweet|dogpile|pile-on|mocked|roasted|ratioed|dragged|clowned)\b/i.test(
    text
  );
}

function hasInstitutionalSpectacleCue(args: {
  title: string;
  feedItems: Array<{
    sourceKind: string;
    title: string;
    summary: string | null;
    metadataJson?: unknown;
  }>;
}) {
  const text = [
    args.title,
    ...args.feedItems.flatMap((item) => [
      item.title,
      buildEffectiveSourceSummary({
        sourceKind: item.sourceKind,
        summary: item.summary,
        metadataJson: item.metadataJson,
      }) ?? "",
    ]),
  ]
    .join(" ")
    .toLowerCase();

  const officialInstitutionCue =
    /\b(white house|official social media|social media accounts?|official account|government account|press secretary|melania trump)\b/.test(
      text
    );
  const bizarreArtifactCue =
    /\b(robot|humanoid|ai-powered robot|figure 3|cryptic videos?|mysterious videos?|weird videos?|odd videos?|bizarre videos?)\b/.test(
      text
    );

  return officialInstitutionCue && bizarreArtifactCue;
}

function hasConcreteInternetStoryCue(args: {
  title: string;
  feedItems: Array<{
    sourceKind: string;
    title: string;
    summary: string | null;
    metadataJson?: unknown;
  }>;
}) {
  const text = [
    args.title,
    ...args.feedItems.flatMap((item) => [
      item.title,
      buildEffectiveSourceSummary({
        sourceKind: item.sourceKind,
        summary: item.summary,
        metadataJson: item.metadataJson,
      }) ?? "",
    ]),
  ]
    .join(" ")
    .toLowerCase();

  const internetNativeTopic =
    /\b(twitch|youtube|youtuber|streamer|creator|podcaster|kick|rumble|tiktok|discord|reddit|subreddit|twitter|x com|x account|platform|algorithm|moderation|mod|moderator|dmca|copyright|ai slop|ai video|ai generated video|chatgpt|openai|grok|sora|runway|veo|meta|instagram|facebook|google|apple|microsoft|steam|epic games|nintendo|xbox|playstation|dlss|marvel rivals|movie trailer|teaser trailer|live action remake|remake|cgi|coffeezilla|logan paul|pokimane|asmongold|turkey tom|internet anarchist)\b/.test(
      text
    );
  const concreteArtifact =
    /\b(body\s?cam|lawsuit|sued|ban|banned|controversy|backlash|leak|leaked|scam|fraud|fired|exposed|caught|arrest|trial|docs|receipts|footage released|security footage|discord logs|dmca|copyright|review bomb|review bombing|ratioed|mocked|clowned|roasted|panned|ugly cgi)\b/.test(
      text
    );
  const institutionalSpectacle = hasInstitutionalSpectacleCue(args);

  return (internetNativeTopic && concreteArtifact) || institutionalSpectacle;
}

function hasStrongAttentionSignals(signals: BoardAttentionSignals): boolean {
  return (
    signals.hasXDiscourse ||
    signals.hasTikTokPickup ||
    signals.hasYouTubePickup ||
    signals.hasRedditPickup ||
    signals.hasMultipleSources ||
    signals.xHighEngagementPostCount >= 1 ||
    signals.xStrongOutlierPostCount >= 1 ||
    signals.xOutlierPostCount >= 2 ||
    signals.maxXOutlierRatio >= 5 ||
    signals.tiktokHighEngagementPostCount >= 1 ||
    signals.tiktokStrongOutlierPostCount >= 1 ||
    signals.tiktokOutlierPostCount >= 1 ||
    signals.maxTikTokOutlierRatio >= 5 ||
    signals.aggregateCommentCount >= 2_000 ||
    signals.maxCommentCount >= 500 ||
    signals.highCommentSourceCount >= 2 ||
    signals.maxViewCount >= 250_000 ||
    signals.aggregateViewCount >= 500_000 ||
    signals.backlashSourceCount >= 2 ||
    signals.institutionalSpectacleSourceCount >= 2
  );
}

function isNewswireOrInstitutionalXSourceName(sourceName: string): boolean {
  const lower = sourceName.trim().toLowerCase();
  return NEWSWIRE_OR_INSTITUTIONAL_X_SOURCE_NAMES.some(
    (name) => lower === name || lower.includes(name)
  );
}

function hasBroadAttentionSignals(signals: BoardAttentionSignals): boolean {
  return (
    signals.hasXDiscourse ||
    signals.hasTikTokPickup ||
    signals.hasRedditPickup ||
    (signals.hasYouTubePickup && signals.hasMultipleSources) ||
    signals.xHighEngagementPostCount >= 2 ||
    signals.xStrongOutlierPostCount >= 1 ||
    signals.xOutlierPostCount >= 2 ||
    signals.maxXOutlierRatio >= 6 ||
    signals.tiktokHighEngagementPostCount >= 2 ||
    signals.tiktokStrongOutlierPostCount >= 1 ||
    signals.tiktokOutlierPostCount >= 2 ||
    signals.maxTikTokOutlierRatio >= 6 ||
    signals.aggregateCommentCount >= 5_000 ||
    signals.maxCommentCount >= 1_000 ||
    signals.highCommentSourceCount >= 3 ||
    signals.maxViewCount >= 1_000_000 ||
    signals.aggregateViewCount >= 1_500_000 ||
    signals.backlashSourceCount >= 3 ||
    signals.reactionSourceCount >= 4 ||
    signals.institutionalSpectacleSourceCount >= 2
  );
}

function hasRssOnlyAttention(signals: BoardAttentionSignals): boolean {
  return (
    !signals.hasXDiscourse &&
    !signals.hasTikTokPickup &&
    !signals.hasYouTubePickup &&
    !signals.hasRedditPickup
  );
}

function isSpeculativeProcessPoliticsTitle(title: string): boolean {
  const lower = title.toLowerCase();
  const politics =
    /\b(trump|senate|house|congress|gop|republican|democrat|dhs|deportation|immigration|border|campaign|primary|endorsement|nomination|hearing|vote)\b/.test(
      lower
    );
  const speculative =
    /\b(how will|what happens if|what would|could decide|could doom|could change|might change|would change|under shadow of|campaign change|becomes)\b/.test(
      lower
    );

  return politics && speculative;
}

function isFollowUpMaintenanceTitle(title: string): boolean {
  const lower = title.toLowerCase();
  return (
    /\b(addresses|reacts?|breaks silence|speaks out|responds?|statement|denies|admits|files?|filed|hearing|live|grilled|pulls|pulled|cancels?|cancelled|paused?|renam(?:e|es|ing)|moves to rename)\b/.test(
      lower
    ) ||
    /\b(why .* talking|explained|for obvious reasons|the internet .*|people are sharing)\b/.test(
      lower
    )
  );
}

function isRealityFranchiseChurnTitle(title: string): boolean {
  const lower = title.toLowerCase();
  return /\b(bachelorette|bachelor|love island|housewives|real housewives|mormon wives|secret lives|bravo|tlc|reality tv|reality show|19 kids and counting)\b/.test(
    lower
  );
}

function isTabloidCelebrityGossipTitle(title: string): boolean {
  const lower = title.toLowerCase();
  const celebrity = /\b(justin bieber|usher|tom brady|joe burrow|alix earle|celebrity|hollywood|oscars|tmz|page six)\b/.test(
    lower
  );
  const gossip =
    /\b(after-party|after party|heated exchange|shade|throws shade|spotted|dating|split|romance|boyfriend|girlfriend|tattoo|bikini|heartthrob|partying)\b/.test(
      lower
    );

  return celebrity && gossip;
}

function isOpinionatedPackagingTitle(title: string): boolean {
  const lower = title.toLowerCase();
  return /\b(the left|the right|history lesson|they.re ignoring|obvious reasons|warns you|can.t stop cringing|mega viral)\b/.test(
    lower
  );
}

function isGeopoliticalSpectacleTitle(title: string): boolean {
  const lower = title.toLowerCase();
  return /\b(missile|airstrike|strike|war|lebanon|iran|israel|troops|battlefield)\b/.test(
    lower
  );
}

function isMainstreamCriminalJusticeOrCivicBreakingTitle(title: string): boolean {
  const lower = title.toLowerCase();
  const civicBreaking =
    /\b(prosecutors?|federal prosecutors?|officers?|police|warrant|court|judge|charges?|charged|dismiss|civil rights|lawsuit against officers|falsifying|hospitalized|sent to hospital|mass casualty|stab|bus driver)\b/.test(
      lower
    );
  const exemptBecauseItTouchesMoonCore =
    /\b(ai|youtube|tiktok|meta|instagram|reddit|xai|openai|streamer|youtuber|podcast|podcaster|manosphere|celebrity|hollywood|movie|internet|platform|surveillance|privacy|crypto|tesla|cybertruck|spider-man|epstein|diddy)\b/.test(
      lower
    );

  return civicBreaking && !exemptBecauseItTouchesMoonCore;
}

function isRoutinePoliticsOrPolicyTitle(title: string): boolean {
  const lower = title.toLowerCase();
  const politicalProcess =
    /\b(trump|senate|house|congress|committee|nominee|nomination|hearing|gop|democrat|republican|tax|income tax|campaign|midterms|secretary|allies|white house|administration)\b/.test(
      lower
    );
  const exemptBecauseItTouchesMoonCore =
    /\b(data|database|surveillance|privacy|broker|platform|social media|internet|ai|crypto|tiktok|censorship|tech)\b/.test(
      lower
    );

  return politicalProcess && !exemptBecauseItTouchesMoonCore;
}

function isShoppingOrServiceTitle(title: string): boolean {
  const lower = title.toLowerCase();
  return /\b(% off|sale|deals?|tickets cost|what do the cheapest|products with one goal|bringing joy|beauty routine|amazon spring sale|price history|actually good prices|gift|shopping|mascara|odor neutralizers|killers)\b/.test(
    lower
  );
}

function isRoutineSportsTitle(title: string): boolean {
  const lower = title.toLowerCase();
  const sportsTerms =
    /\b(march madness|round of 64|prediction|odds|best bet|opener|jersey number|dominates|vs\.?|nba|nfl|mlb|f1|football|basketball|baseball|soccer|tournament)\b/.test(
      lower
    );
  const exemptBecauseItIsDrama =
    /\b(arrest|lawsuit|probe|ban|backlash|controversy|feud|scandal|dead|death|died|abuse)\b/.test(
      lower
    );

  return sportsTerms && !exemptBecauseItIsDrama;
}

function isEntertainmentListicleOrReleaseFillerTitle(title: string): boolean {
  const lower = title.toLowerCase();
  return /\b(songs? you must hear|all the songs in|soundtrack|return with new episodes|cast for|adds .* season|episode guide|tickets cost)\b/.test(
    lower
  );
}

function isGenericCreatorDiscussionTitle(title: string): boolean {
  const lower = title.toLowerCase();
  const genericPodcastOrDebate =
    /\b(whatever podcast|dating talk|podcast|episode \d+|stream highlights?|reacts? to|reaction|debate|panel|clip channel|live stream|livestream)\b/.test(
      lower
    );
  const genericWrapper =
    /^(does this|is this|is the .+ done|this guy|this girl|this woman|this man|he'?s|she'?s|they'?re|trash$|wow$|wtf$|how is this real|there'?s been a situation|we need to talk about)\b/.test(
      lower
    ) || /\bnothing ever happens\b/.test(lower);
  const concreteEvent =
    /\b(arrest|lawsuit|sued|trial|body\s?cam|ban|banned|backlash|controversy|leak|leaked|discord|tiktok|streamer|youtuber|creator|scam|fraud|fired|exposed|caught|dmca|copyright|moderator|mod|docs|bodycam|police footage|footage released)\b/.test(
      lower
    );

  return (genericPodcastOrDebate || genericWrapper) && !concreteEvent;
}

function isPackagedCultureWarOutrageTitle(title: string): boolean {
  const lower = title.toLowerCase();
  const ideologicalPackaging =
    /\b(groomer|woke|dei|cancelled|cancels|massive backlash|pastor put it|libs? of tiktok|drag queen|book ban|trans agenda|culture war)\b/.test(
      lower
    );
  const weakNewsWrapper =
    /\b(here'?s what we know|breaking:|this pastor|put it perfectly|goes viral)\b/.test(
      lower
    );

  return ideologicalPackaging || weakNewsWrapper;
}

function isMainstreamCelebrityPersonalDramaTitle(args: {
  title: string;
  vertical: string | null;
}) {
  if (!args.vertical?.toLowerCase().includes("celebrity")) {
    return false;
  }

  const lower = args.title.toLowerCase();
  const personalOrLegalDrama =
    /\b(dui|body\s?cam|arrest|footage|abuse|abuse of how i look|security battle|security guard|banned from performing|fans|backed out|says .* no longer wants to|wants to go outside|battle with)\b/.test(
      lower
    );
  const internetNativeSubject =
    /\b(creator|streamer|youtuber|podcast|podcaster|twitch|youtube|tiktok|discord|reddit|coffeezilla|logan paul|pokimane)\b/.test(
      lower
    );

  return personalOrLegalDrama && !internetNativeSubject;
}

function isObituaryOrDeathNoticeTitle(title: string): boolean {
  const lower = title.toLowerCase();
  const deathNotice =
    /\b(died|dies|dead at|death of|obituary|remembering|tribute to|passes away|passed away)\b/.test(
      lower
    );
  const internetNativeEscape =
    /\b(backlash|meme|memes|creator|streamer|youtuber|twitch|youtube|reddit|discord|tiktok|platform|viral clip|viral video|ai video|ai slop|openai|sora|runway|veo|trailer|cgi|review bomb|review bombing|onlyfans)\b/.test(
      lower
    );

  return deathNotice && !internetNativeEscape;
}

function isGenericPlatformLegalOrBusinessTitle(title: string): boolean {
  const lower = title.toLowerCase();
  const platformOrTechSubject =
    /\b(meta|facebook|instagram|reddit|twitter|x money|openai|chatgpt|youtube|tiktok|discord|google|apple|microsoft|steam|tesla|onlyfans)\b/.test(
      lower
    );
  const dryLegalOrBusinessAngle =
    /\b(found liable|liable|shareholders?|investors?|acquisition|antitrust|earnings|revenue|settlement|sues?|sued|lawsuit|court|judge|trial|merger|probe|regulator|ftc|sec)\b/.test(
      lower
    );
  const onlineCultureEscape =
    /\b(backlash|hate|hating|mocked|mocking|roasted|ratioed|review bomb|review bombing|ban|banned|creator|streamer|youtuber|discord|reddit|moderation|algorithm|bot|verification|ai slop|ai video|deepfake|viral clip|viral video|leak|leaked|dmca|copyright)\b/.test(
      lower
    );

  return platformOrTechSubject && dryLegalOrBusinessAngle && !onlineCultureEscape;
}

function tokenizeClusterTitle(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(
      (token) =>
        token.length >= 3 &&
        ![
          "the",
          "and",
          "for",
          "with",
          "that",
          "this",
          "from",
          "into",
          "after",
          "over",
          "under",
          "about",
          "their",
          "they",
          "them",
          "says",
          "amid",
          "new",
          "video",
          "story",
          "news",
          "today",
          "just",
        ].includes(token)
    );
}

function hasSuspiciousClusterTitleMix(args: {
  title: string;
  feedItems: Array<{
    title: string;
  }>;
}): boolean {
  if (args.feedItems.length < 12) {
    return false;
  }

  const canonicalTokens = new Set(tokenizeClusterTitle(args.title));
  if (canonicalTokens.size < 2) {
    return false;
  }

  let alignedCount = 0;
  for (const item of args.feedItems) {
    const itemTokens = new Set(tokenizeClusterTitle(item.title));
    let overlap = 0;
    for (const token of itemTokens) {
      if (canonicalTokens.has(token)) {
        overlap += 1;
      }
    }

    if (overlap >= 2 || (canonicalTokens.size <= 3 && overlap >= 1)) {
      alignedCount += 1;
    }
  }

  return alignedCount / args.feedItems.length < 0.45;
}

function clampBoardAssessment(
  assessment: BoardStoryAssessment,
  limits: {
    boardVisibilityScore: number;
    moonFitScore?: number;
    explanation: string;
  }
): BoardStoryAssessment {
  return {
    ...assessment,
    boardVisibilityScore: Math.min(
      assessment.boardVisibilityScore,
      limits.boardVisibilityScore
    ),
    moonFitScore: Math.min(
      assessment.moonFitScore,
      limits.moonFitScore ?? assessment.moonFitScore
    ),
    explanation: limits.explanation,
  };
}

function applyBoardAssessmentGuards(args: {
  title: string;
  vertical: string | null;
  attentionSignals: BoardAttentionSignals;
  feedItems: Array<{
    sourceKind: string;
    title: string;
    summary: string | null;
    metadataJson?: unknown;
  }>;
  assessment: BoardStoryAssessment;
}): BoardStoryAssessment {
  const strongAttention = hasStrongAttentionSignals(args.attentionSignals);
  const broadAttention = hasBroadAttentionSignals(args.attentionSignals);
  const rssOnlyAttention = hasRssOnlyAttention(args.attentionSignals);
  const followUpMaintenance = isFollowUpMaintenanceTitle(args.title);
  const realityFranchiseChurn = isRealityFranchiseChurnTitle(args.title);
  const opinionatedPackaging = isOpinionatedPackagingTitle(args.title);
  const geopoliticalSpectacle = isGeopoliticalSpectacleTitle(args.title);
  const mainstreamCivicBreaking =
    isMainstreamCriminalJusticeOrCivicBreakingTitle(args.title);
  const routinePoliticsOrPolicy = isRoutinePoliticsOrPolicyTitle(args.title);
  const tabloidCelebrityGossip = isTabloidCelebrityGossipTitle(args.title);
  const shoppingOrService = isShoppingOrServiceTitle(args.title);
  const routineSports = isRoutineSportsTitle(args.title);
  const entertainmentReleaseFiller =
    isEntertainmentListicleOrReleaseFillerTitle(args.title);
  const genericCreatorDiscussion = isGenericCreatorDiscussionTitle(args.title);
  const packagedCultureWarOutrage = isPackagedCultureWarOutrageTitle(args.title);
  const mainstreamCelebrityPersonalDrama = isMainstreamCelebrityPersonalDramaTitle({
    title: args.title,
    vertical: args.vertical,
  });
  const obituaryOrDeathNotice = isObituaryOrDeathNoticeTitle(args.title);
  const genericPlatformLegalOrBusiness =
    isGenericPlatformLegalOrBusinessTitle(args.title);
  const suspiciousClusterTitleMix = hasSuspiciousClusterTitleMix({
    title: args.title,
    feedItems: args.feedItems.map((item) => ({ title: item.title })),
  });
  const singleSourceCommentary =
    args.feedItems.length === 1 &&
    args.feedItems[0]?.sourceKind === "x_account";
  const concreteInternetStoryCue = hasConcreteInternetStoryCue({
    title: args.title,
    feedItems: args.feedItems.map((item) => ({
      sourceKind: item.sourceKind,
      title: item.title,
      summary: item.summary,
      metadataJson: item.metadataJson,
    })),
  });
  const institutionalSpectacleCue = hasInstitutionalSpectacleCue({
    title: args.title,
    feedItems: args.feedItems.map((item) => ({
      sourceKind: item.sourceKind,
      title: item.title,
      summary: item.summary,
      metadataJson: item.metadataJson,
    })),
  });

  if (shoppingOrService) {
    return clampBoardAssessment(args.assessment, {
      boardVisibilityScore: 15,
      moonFitScore: 18,
      explanation:
        "Shopping or service-journalism packaging with weak Moon fit; not a strong board story.",
    });
  }

  if (obituaryOrDeathNotice && !concreteInternetStoryCue) {
    return clampBoardAssessment(args.assessment, {
      boardVisibilityScore: broadAttention ? 24 : 18,
      moonFitScore: 22,
      explanation:
        "Death or remembrance coverage without a sharper internet-native backlash, meme, or creator angle; weak board story for Moon.",
    });
  }

  if (suspiciousClusterTitleMix) {
    return clampBoardAssessment(args.assessment, {
      boardVisibilityScore: 20,
      moonFitScore: 24,
      explanation:
        "Story cluster looks semantically mixed or overmerged; weak board story until the underlying event is cleaner.",
    });
  }

  if (routineSports) {
    return clampBoardAssessment(args.assessment, {
      boardVisibilityScore: 15,
      moonFitScore: 18,
      explanation:
        "Routine sports coverage without a broader scandal or cultural angle; weak board story for Moon.",
    });
  }

  if (genericCreatorDiscussion) {
    return clampBoardAssessment(args.assessment, {
      boardVisibilityScore: 18,
      moonFitScore: 20,
      explanation:
        "Generic creator discussion or debate wrapper without a clear concrete event; weak board story for Moon.",
    });
  }

  if (
    packagedCultureWarOutrage &&
    !args.attentionSignals.hasYouTubePickup &&
    !args.attentionSignals.hasRedditPickup
  ) {
    return clampBoardAssessment(args.assessment, {
      boardVisibilityScore: 18,
      moonFitScore: 20,
      explanation:
        "Packaged culture-war outrage without broader creator or platform discourse; weak board story for Moon.",
    });
  }

  if (genericPlatformLegalOrBusiness && !concreteInternetStoryCue) {
    return clampBoardAssessment(args.assessment, {
      boardVisibilityScore: broadAttention ? 35 : 22,
      moonFitScore: 30,
      explanation:
        "Dry platform or tech legal-business coverage without a vivid internet-culture reaction wave; weak board story for Moon.",
    });
  }

  if (mainstreamCelebrityPersonalDrama && !concreteInternetStoryCue) {
    return clampBoardAssessment(args.assessment, {
      boardVisibilityScore: 30,
      moonFitScore: 28,
      explanation:
        "Mainstream celebrity personal or legal drama without a stronger internet-native angle; weak board story for Moon.",
    });
  }

  if (rssOnlyAttention && !broadAttention && entertainmentReleaseFiller) {
    return clampBoardAssessment(args.assessment, {
      boardVisibilityScore: 18,
      moonFitScore: 24,
      explanation:
        "Entertainment filler or release-packaging without a real cultural conflict or broader discourse.",
    });
  }

  if (isSpeculativeProcessPoliticsTitle(args.title) && !strongAttention) {
    return clampBoardAssessment(args.assessment, {
      boardVisibilityScore: 25,
      moonFitScore: 40,
      explanation:
        "Speculative process politics without major public reaction; weak board story despite topic overlap.",
    });
  }

  if (singleSourceCommentary && !broadAttention && !concreteInternetStoryCue) {
    return clampBoardAssessment(args.assessment, {
      boardVisibilityScore: 30,
      moonFitScore: 45,
      explanation:
        "Single-source commentary without corroborating pickup; weak board story unless it clearly breaks into broader online discourse.",
    });
  }

  if (singleSourceCommentary && !broadAttention && concreteInternetStoryCue) {
    return clampBoardAssessment(args.assessment, {
      boardVisibilityScore: 45,
      moonFitScore: 55,
      explanation:
        "Concrete creator-led internet story with limited pickup so far; worth watching even before it breaks into broader coverage.",
    });
  }

  if (tabloidCelebrityGossip && !concreteInternetStoryCue) {
    return clampBoardAssessment(args.assessment, {
      boardVisibilityScore: broadAttention ? 40 : 30,
      moonFitScore: 42,
      explanation:
        "Tabloid celebrity gossip or party-scene chatter without a sharper internet or cultural angle; weak board story despite surface attention.",
    });
  }

  if (
    rssOnlyAttention &&
    !broadAttention &&
    followUpMaintenance &&
    (realityFranchiseChurn || opinionatedPackaging)
  ) {
    return clampBoardAssessment(args.assessment, {
      boardVisibilityScore: 28,
      moonFitScore: 42,
      explanation:
        "Closed-loop follow-up coverage inside a narrow media bubble; weak board story without broader public traction.",
    });
  }

  if (rssOnlyAttention && !broadAttention && realityFranchiseChurn) {
    return clampBoardAssessment(args.assessment, {
      boardVisibilityScore: 35,
      moonFitScore: 45,
      explanation:
        "Reality-franchise scandal without broader online escape velocity; weak board story despite tabloid or trade coverage.",
    });
  }

  if (rssOnlyAttention && !broadAttention && followUpMaintenance) {
    return clampBoardAssessment(args.assessment, {
      boardVisibilityScore: 35,
      moonFitScore: 48,
      explanation:
        "Follow-up maintenance coverage without real cross-platform pickup; weak board story despite surface controversy.",
    });
  }

  if (rssOnlyAttention && !broadAttention && opinionatedPackaging) {
    return clampBoardAssessment(args.assessment, {
      boardVisibilityScore: 30,
      moonFitScore: 45,
      explanation:
        "Packaged outrage or reaction coverage without broader pickup; weak board story unless the underlying event is independently hot.",
    });
  }

  if (
    rssOnlyAttention &&
    !broadAttention &&
    routinePoliticsOrPolicy &&
    !institutionalSpectacleCue
  ) {
    return clampBoardAssessment(args.assessment, {
      boardVisibilityScore: 30,
      moonFitScore: 40,
      explanation:
        "Routine politics or policy spectacle without broader pickup; weak board story for Moon despite surface controversy.",
    });
  }

  if (rssOnlyAttention && !broadAttention && mainstreamCivicBreaking) {
    return clampBoardAssessment(args.assessment, {
      boardVisibilityScore: 28,
      moonFitScore: 35,
      explanation:
        "Mainstream criminal-justice or civic breaking news without clear internet escape velocity; weak board story for Moon.",
    });
  }

  if (rssOnlyAttention && !broadAttention && geopoliticalSpectacle) {
    return clampBoardAssessment(args.assessment, {
      boardVisibilityScore: 30,
      moonFitScore: 40,
      explanation:
        "Foreign-conflict spectacle without broader cultural or everyday-life traction; weak board story for Moon.",
    });
  }

  return args.assessment;
}

function coerceScoreJson(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function coerceCachedBoardAiAssessment(
  value: unknown
): CachedBoardAiAssessment | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const boardVisibilityScore = Number(record.boardVisibilityScore);
  const moonFitScore = Number(record.moonFitScore);
  const controversyScore = Number(record.controversyScore);
  const confidence = Number(record.confidence);
  const suggestedStoryType = record.suggestedStoryType;
  const explanation = record.explanation;
  const model = record.model;
  const promptVersion = record.promptVersion;
  const inputHash = record.inputHash;
  const computedAt = record.computedAt;

  if (
    !Number.isFinite(boardVisibilityScore) ||
    !Number.isFinite(moonFitScore) ||
    !Number.isFinite(controversyScore) ||
    !Number.isFinite(confidence) ||
    typeof suggestedStoryType !== "string" ||
    typeof explanation !== "string" ||
    typeof model !== "string" ||
    typeof promptVersion !== "string" ||
    typeof inputHash !== "string" ||
    typeof computedAt !== "string"
  ) {
    return null;
  }

  if (
    suggestedStoryType !== "normal" &&
    suggestedStoryType !== "trending" &&
    suggestedStoryType !== "controversy"
  ) {
    return null;
  }

  return {
    boardVisibilityScore: Math.max(0, Math.min(100, Math.round(boardVisibilityScore))),
    moonFitScore: Math.max(0, Math.min(100, Math.round(moonFitScore))),
    suggestedStoryType,
    controversyScore: Math.max(0, Math.min(100, Math.round(controversyScore))),
    confidence: Math.max(0, Math.min(100, Math.round(confidence))),
    explanation,
    model,
    promptVersion,
    inputHash,
    computedAt,
  };
}

function getFeedItemEngagementMetrics(item: {
  metadataJson?: unknown;
}) {
  const metadata = coerceScoreJson(item.metadataJson);
  return {
    viewCount: coerceBoardMetricCount(metadata.viewCount),
    likeCount: coerceBoardMetricCount(metadata.likeCount),
    retweetCount: coerceBoardMetricCount(metadata.retweetCount),
    commentCount: coerceBoardMetricCount(metadata.commentCount),
  };
}

function getFeedItemVideoMetadata(item: {
  metadataJson?: unknown;
}) {
  const metadata = coerceScoreJson(item.metadataJson);
  const transcriptSummary =
    typeof metadata.transcriptSummary === "string"
      ? metadata.transcriptSummary.replace(/\s+/g, " ").trim()
      : "";
  const videoDescription =
    typeof metadata.videoDescription === "string"
      ? metadata.videoDescription.replace(/\s+/g, " ").trim()
      : "";
  const clipDetailParts = Array.from(
    new Set([transcriptSummary, videoDescription].filter((value) => value.length > 0))
  );
  const clipDetails = clipDetailParts.join(" | ");
  return {
    hasVideo: metadata.hasVideo === true || clipDetails.length > 0,
    videoDescription: clipDetails.length > 0 ? clipDetails.slice(0, 500) : null,
  };
}

function getFeedItemOutlierMetrics(item: {
  metadataJson?: unknown;
}) {
  const metadata = coerceScoreJson(item.metadataJson);
  const viewOutlierRatio = coerceBoardRatio(metadata.viewOutlierRatio);
  const likeOutlierRatio = coerceBoardRatio(metadata.likeOutlierRatio);
  const retweetOutlierRatio = coerceBoardRatio(metadata.retweetOutlierRatio);
  const maxOutlierRatio =
    coerceBoardRatio(metadata.maxOutlierRatio) ||
    Math.max(viewOutlierRatio, likeOutlierRatio, retweetOutlierRatio);

  return {
    viewOutlierRatio,
    likeOutlierRatio,
    retweetOutlierRatio,
    maxOutlierRatio,
    isEngagementOutlier: maxOutlierRatio >= 3,
    isStrongEngagementOutlier: maxOutlierRatio >= 5,
  };
}

function isTikTokBoardSourceKind(kind: string) {
  return kind === "tiktok_query" || kind === "tiktok_fyp_profile";
}

function getBoardAssessmentFeedItemPriority(item: {
  sourceKind: string;
  title: string;
  summary: string | null;
  publishedAt: Date | null;
  metadataJson?: unknown;
}) {
  const summary = buildEffectiveSourceSummary(item) ?? "";
  const text = `${item.title} ${summary}`.trim();
  const { viewCount, likeCount, retweetCount } = getFeedItemEngagementMetrics(item);
  const { hasVideo } = getFeedItemVideoMetadata(item);
  const { maxOutlierRatio, viewOutlierRatio } = getFeedItemOutlierMetrics(item);
  let priority = 0;

  if (hasBacklashEvidenceText(text)) {
    priority += 90;
  }
  if (hasReactionWaveText(text)) {
    priority += 45;
  }
  if (hasInstitutionalSpectacleCue({ title: item.title, feedItems: [item] })) {
    priority += 55;
  }
  if (item.sourceKind === "x_account") {
    priority += 30;
  }
  if (isTikTokBoardSourceKind(item.sourceKind)) {
    priority += 55;
  }
  if (item.sourceKind === "x_account" && hasVideo) {
    priority += 70;
  } else if (isTikTokBoardSourceKind(item.sourceKind) && hasVideo) {
    priority += 95;
  } else if (hasVideo) {
    priority += 20;
  }
  if (item.sourceKind === "x_account" || isTikTokBoardSourceKind(item.sourceKind)) {
    if (maxOutlierRatio >= 50) {
      priority += 320;
    } else if (maxOutlierRatio >= 20) {
      priority += 240;
    } else if (maxOutlierRatio >= 10) {
      priority += 180;
    } else if (maxOutlierRatio >= 5) {
      priority += 120;
    } else if (maxOutlierRatio >= 3) {
      priority += 65;
    }

    if (viewOutlierRatio >= 3) {
      priority += hasVideo ? 40 : 20;
    }
  }
  if (viewCount >= 1_000_000) {
    priority += 120;
  } else if (viewCount >= 250_000) {
    priority += 80;
  } else if (viewCount >= 50_000) {
    priority += 40;
  }
  if (likeCount >= 20_000) {
    priority += 40;
  } else if (likeCount >= 5_000) {
    priority += 20;
  }
  if (retweetCount >= 2_500) {
    priority += 35;
  } else if (retweetCount >= 500) {
    priority += 15;
  }
  if (item.publishedAt) {
    const ageHours = (Date.now() - item.publishedAt.getTime()) / (1000 * 60 * 60);
    if (ageHours <= 12) {
      priority += 20;
    } else if (ageHours <= 24) {
      priority += 10;
    }
  }

  return priority;
}

function prioritizeFeedItemsForBoardAssessment<T extends {
  sourceKind: string;
  title: string;
  summary: string | null;
  publishedAt: Date | null;
  metadataJson?: unknown;
}>(feedItems: T[]): T[] {
  return [...feedItems].sort((left, right) => {
    const priorityDiff =
      getBoardAssessmentFeedItemPriority(right) -
      getBoardAssessmentFeedItemPriority(left);
    if (priorityDiff !== 0) {
      return priorityDiff;
    }

    const leftPublishedAt = left.publishedAt?.getTime() ?? 0;
    const rightPublishedAt = right.publishedAt?.getTime() ?? 0;
    return rightPublishedAt - leftPublishedAt;
  });
}

function buildBoardAttentionSignals(args: {
  feedItems: Array<{
    sourceName: string;
    sourceKind: string;
    title: string;
    summary: string | null;
    metadataJson?: unknown;
  }>;
  hasOrganicXDiscourse: boolean;
  sourcesCount: number;
  competitorOverlap: number;
  visualEvidence: number;
}): BoardAttentionSignals {
  let aggregateViewCount = 0;
  let maxViewCount = 0;
  let aggregateLikeCount = 0;
  let aggregateRetweetCount = 0;
  let aggregateCommentCount = 0;
  let maxCommentCount = 0;
  let xPostCount = 0;
  let xHighEngagementPostCount = 0;
  let xVideoPostCount = 0;
  let xHighEngagementVideoPostCount = 0;
  let xOutlierPostCount = 0;
  let xStrongOutlierPostCount = 0;
  let xCommentHeavyPostCount = 0;
  let maxXOutlierRatio = 0;
  let tiktokPostCount = 0;
  let tiktokHighEngagementPostCount = 0;
  let tiktokVideoPostCount = 0;
  let tiktokOutlierPostCount = 0;
  let tiktokStrongOutlierPostCount = 0;
  let tiktokCommentHeavyPostCount = 0;
  let maxTikTokOutlierRatio = 0;
  let highCommentSourceCount = 0;
  let backlashSourceCount = 0;
  let reactionSourceCount = 0;
  let institutionalSpectacleSourceCount = 0;

  for (const item of args.feedItems) {
    const summary = buildEffectiveSourceSummary(item) ?? "";
    const text = `${item.title} ${summary}`.trim();
    const { viewCount, likeCount, retweetCount, commentCount } =
      getFeedItemEngagementMetrics(item);
    const { hasVideo } = getFeedItemVideoMetadata(item);
    const { maxOutlierRatio, isEngagementOutlier, isStrongEngagementOutlier } =
      getFeedItemOutlierMetrics(item);
    const commentHeavy = commentCount >= 250;

    aggregateViewCount += viewCount;
    maxViewCount = Math.max(maxViewCount, viewCount);
    aggregateLikeCount += likeCount;
    aggregateRetweetCount += retweetCount;
    aggregateCommentCount += commentCount;
    maxCommentCount = Math.max(maxCommentCount, commentCount);
    if (commentHeavy) {
      highCommentSourceCount += 1;
    }

    if (item.sourceKind === "x_account") {
      xPostCount += 1;
      const highEngagement =
        viewCount >= 250_000 ||
        likeCount >= 10_000 ||
        retweetCount >= 1_000;
      if (highEngagement) {
        xHighEngagementPostCount += 1;
      }
      maxXOutlierRatio = Math.max(maxXOutlierRatio, maxOutlierRatio);
      if (isEngagementOutlier) {
        xOutlierPostCount += 1;
      }
      if (isStrongEngagementOutlier) {
        xStrongOutlierPostCount += 1;
      }
      if (commentHeavy) {
        xCommentHeavyPostCount += 1;
      }
      if (hasVideo) {
        xVideoPostCount += 1;
        if (highEngagement || viewCount >= 100_000) {
          xHighEngagementVideoPostCount += 1;
        }
      }
    } else if (isTikTokBoardSourceKind(item.sourceKind)) {
      tiktokPostCount += 1;
      const highEngagement =
        viewCount >= 250_000 ||
        likeCount >= 10_000 ||
        retweetCount >= 1_000;
      if (highEngagement) {
        tiktokHighEngagementPostCount += 1;
      }
      maxTikTokOutlierRatio = Math.max(maxTikTokOutlierRatio, maxOutlierRatio);
      if (isEngagementOutlier) {
        tiktokOutlierPostCount += 1;
      }
      if (isStrongEngagementOutlier) {
        tiktokStrongOutlierPostCount += 1;
      }
      if (commentHeavy) {
        tiktokCommentHeavyPostCount += 1;
      }
      if (hasVideo) {
        tiktokVideoPostCount += 1;
      }
    }

    if (hasBacklashEvidenceText(text)) {
      backlashSourceCount += 1;
    }
    if (hasReactionWaveText(text)) {
      reactionSourceCount += 1;
    }
    if (hasInstitutionalSpectacleCue({ title: item.title, feedItems: [item] })) {
      institutionalSpectacleSourceCount += 1;
    }
  }

  return {
    hasXDiscourse: args.hasOrganicXDiscourse,
    hasTikTokPickup: tiktokPostCount > 0,
    hasYouTubePickup: false,
    hasRedditPickup: args.feedItems.some((item) =>
      item.sourceName.toLowerCase().includes("reddit")
    ),
    hasMultipleSources: args.sourcesCount >= 2,
    competitorOverlap: args.competitorOverlap,
    visualEvidence: args.visualEvidence,
    xPostCount,
    xHighEngagementPostCount,
    xVideoPostCount,
    xHighEngagementVideoPostCount,
    xOutlierPostCount,
    xStrongOutlierPostCount,
    maxXOutlierRatio,
    tiktokPostCount,
    tiktokHighEngagementPostCount,
    tiktokVideoPostCount,
    tiktokOutlierPostCount,
    tiktokStrongOutlierPostCount,
    maxTikTokOutlierRatio,
    aggregateViewCount,
    maxViewCount,
    aggregateLikeCount,
    aggregateRetweetCount,
    aggregateCommentCount,
    maxCommentCount,
    xCommentHeavyPostCount,
    tiktokCommentHeavyPostCount,
    highCommentSourceCount,
    backlashSourceCount,
    reactionSourceCount,
    institutionalSpectacleSourceCount,
  };
}

function buildAudienceReactionSummary(
  signals: BoardAttentionSignals
): BoardAudienceReactionSummary {
  const totalOutliers =
    signals.xOutlierPostCount + signals.tiktokOutlierPostCount;
  const strongOutliers =
    signals.xStrongOutlierPostCount + signals.tiktokStrongOutlierPostCount;
  const maxOutlierRatio = Math.max(
    signals.maxXOutlierRatio,
    signals.maxTikTokOutlierRatio
  );

  let intensity: BoardAudienceReactionSummary["intensity"] = "quiet";
  if (
    signals.aggregateCommentCount >= 20_000 ||
    signals.maxCommentCount >= 5_000 ||
    strongOutliers >= 2 ||
    maxOutlierRatio >= 12
  ) {
    intensity = "frenzy";
  } else if (
    signals.aggregateCommentCount >= 5_000 ||
    signals.maxCommentCount >= 1_000 ||
    strongOutliers >= 1 ||
    totalOutliers >= 3 ||
    signals.aggregateLikeCount >= 50_000
  ) {
    intensity = "loud";
  } else if (
    signals.aggregateCommentCount >= 1_000 ||
    signals.highCommentSourceCount >= 2 ||
    totalOutliers >= 1 ||
    signals.aggregateLikeCount >= 10_000 ||
    signals.reactionSourceCount >= 2
  ) {
    intensity = "active";
  }

  let mode: BoardAudienceReactionSummary["mode"] = "watching";
  if (signals.backlashSourceCount >= 2) {
    mode = "backlash";
  } else if (signals.institutionalSpectacleSourceCount >= 1) {
    mode = "spectacle";
  } else if (signals.reactionSourceCount >= 2) {
    mode = "debate";
  } else if (totalOutliers >= 1 || signals.aggregateViewCount >= 250_000) {
    mode = "breakout";
  }

  const summaryParts = [
    signals.aggregateCommentCount > 0
      ? `${formatBoardMetricCount(signals.aggregateCommentCount)} comments`
      : null,
    signals.aggregateLikeCount > 0
      ? `${formatBoardMetricCount(signals.aggregateLikeCount)} likes`
      : null,
    totalOutliers > 0
      ? `${totalOutliers} outlier ${totalOutliers === 1 ? "post" : "posts"}`
      : null,
    signals.backlashSourceCount >= 2
      ? "backlash-heavy"
      : signals.reactionSourceCount >= 2
        ? "reaction-heavy"
        : signals.institutionalSpectacleSourceCount >= 1
          ? "spectacle-driven"
          : null,
  ].filter(Boolean);

  const modeLabel =
    mode === "backlash"
      ? "backlash"
      : mode === "spectacle"
        ? "spectacle"
        : mode === "debate"
          ? "debate"
          : mode === "breakout"
            ? "breakout"
            : "watching";

  return {
    intensity,
    mode,
    summary:
      summaryParts.length > 0
        ? `${intensity} ${modeLabel}: ${summaryParts.join(" · ")}`
        : `${intensity} ${modeLabel}`,
  };
}

function buildBoardAiAssessmentInputHash(args: {
  canonicalTitle: string;
  vertical: string | null;
  storyType: string;
  freshnessAt: Date | null;
  itemsCount: number;
  sourcesCount: number;
  observedControversyScore: number | null;
  attentionSignals: BoardAttentionSignals;
  moonContext: {
    clusterLabel: string | null;
    coverageMode: string | null;
    analogMedianViews: number | null;
    analogs: Array<{
      title: string;
      viewCount: number | null;
      similarityScore: number;
    }>;
  } | null;
  feedItems: Array<{
    sourceName: string;
    sourceKind: string;
    title: string;
    summary: string | null;
    publishedAt: Date | null;
    viewCount?: number | null;
    likeCount?: number | null;
    retweetCount?: number | null;
    metadataJson?: unknown;
  }>;
}) {
  return createHash("sha1")
    .update(
      JSON.stringify({
        canonicalTitle: args.canonicalTitle,
        vertical: args.vertical,
        storyType: args.storyType,
        freshnessAt: args.freshnessAt?.toISOString() ?? null,
        itemsCount: args.itemsCount,
        sourcesCount: args.sourcesCount,
        observedControversyScore: args.observedControversyScore,
        attentionSignals: args.attentionSignals,
        moonContext: args.moonContext
          ? {
              clusterLabel: args.moonContext.clusterLabel,
              coverageMode: args.moonContext.coverageMode,
              analogMedianViews: args.moonContext.analogMedianViews,
              analogs: args.moonContext.analogs.slice(0, 3).map((analog) => ({
                title: analog.title,
                viewCount: analog.viewCount,
                similarityScore: analog.similarityScore,
              })),
            }
          : null,
        feedItems: args.feedItems.slice(0, 6).map((item) => ({
          sourceName: item.sourceName,
          sourceKind: item.sourceKind,
          title: item.title,
          summary: buildEffectiveSourceSummary(item),
          hasVideo: getFeedItemVideoMetadata(item).hasVideo,
          viewOutlierRatio: getFeedItemOutlierMetrics(item).viewOutlierRatio || null,
          maxOutlierRatio: getFeedItemOutlierMetrics(item).maxOutlierRatio || null,
          publishedAt: item.publishedAt?.toISOString() ?? null,
          viewCount: item.viewCount ?? null,
          likeCount: item.likeCount ?? null,
          retweetCount: item.retweetCount ?? null,
        })),
      })
    )
    .digest("hex");
}

async function getBoardAiAssessment(args: {
  story: typeof boardStoryCandidates.$inferSelect;
  feedItems: Array<{
    sourceName: string;
    sourceKind: string;
    title: string;
    summary: string | null;
    publishedAt: Date | null;
    viewCount?: number | null;
    likeCount?: number | null;
    retweetCount?: number | null;
    metadataJson?: unknown;
  }>;
  moonContext: Awaited<ReturnType<typeof scoreBoardStoryWithMoonCorpus>>;
  attentionSignals: {
    competitorOverlap: number;
    visualEvidence: number;
  };
}): Promise<CachedBoardAiAssessment | null> {
  if (!process.env.OPENAI_API_KEY) {
    return null;
  }

  const lastSeenAt = args.story.lastSeenAt ? new Date(args.story.lastSeenAt) : null;
  const freshnessAt = getStoryFreshnessReferenceAt({
    storyLastSeenAt: lastSeenAt,
    feedItems: args.feedItems.map((item) => ({
      sourceKind: item.sourceKind,
      publishedAt: item.publishedAt,
    })),
  });
  const ageHours = freshnessAt
    ? (Date.now() - freshnessAt.getTime()) / (1000 * 60 * 60)
    : Number.POSITIVE_INFINITY;

  if (ageHours > BOARD_AI_SCORING_MAX_STORY_AGE_HOURS) {
    return null;
  }

  const scoreJson = coerceScoreJson(args.story.scoreJson);
  const hasOrganicXDiscourse = args.feedItems.some(
    (item) =>
      item.sourceKind === "x_account" &&
      !isNewswireOrInstitutionalXSourceName(item.sourceName)
  );
  const prioritizedFeedItems = prioritizeFeedItemsForBoardAssessment(args.feedItems);
  const attentionSignals = buildBoardAttentionSignals({
    feedItems: prioritizedFeedItems,
    hasOrganicXDiscourse,
    sourcesCount: args.story.sourcesCount,
    competitorOverlap: args.attentionSignals.competitorOverlap,
    visualEvidence: args.attentionSignals.visualEvidence,
  });
  const moonContext = args.moonContext
    ? {
        clusterLabel: args.moonContext.clusterLabel,
        coverageMode: args.moonContext.coverageMode,
        analogMedianViews: args.moonContext.analogMedianViews,
        analogs: args.moonContext.analogs.slice(0, 3).map((analog) => ({
          title: analog.title,
          viewCount: analog.viewCount,
          similarityScore: analog.similarityScore,
        })),
      }
    : null;
  const inputHash = buildBoardAiAssessmentInputHash({
    canonicalTitle: args.story.canonicalTitle,
    vertical: args.story.vertical,
    storyType: args.story.storyType,
    freshnessAt,
    itemsCount: args.story.itemsCount,
    sourcesCount: args.story.sourcesCount,
    observedControversyScore: args.story.controversyScore,
    attentionSignals,
    moonContext,
    feedItems: prioritizedFeedItems,
  });
  const cached = coerceCachedBoardAiAssessment(scoreJson.aiBoardAssessment);

  if (cached) {
    const computedAt = new Date(cached.computedAt);
    const cacheFresh =
      !Number.isNaN(computedAt.getTime()) &&
      Date.now() - computedAt.getTime() <= BOARD_AI_SCORING_CACHE_TTL_MS;
    if (
      cacheFresh &&
      cached.promptVersion === BOARD_AI_SCORING_PROMPT_VERSION &&
      cached.inputHash === inputHash
    ) {
      return cached;
    }
  }

  try {
    const assessment = await assessBoardStory({
      canonicalTitle: args.story.canonicalTitle,
      vertical: args.story.vertical,
      currentStoryType: args.story.storyType,
      lastSeenAt: freshnessAt?.toISOString() ?? null,
      itemsCount: args.story.itemsCount,
      sourcesCount: args.story.sourcesCount,
      observedControversyScore: args.story.controversyScore,
      attentionSignals,
      moonContext,
      sources: prioritizedFeedItems.slice(0, 6).map((item) => ({
        sourceName: item.sourceName,
        sourceKind: item.sourceKind,
        title: item.title,
        summary: buildEffectiveSourceSummary(item),
        hasVideo: getFeedItemVideoMetadata(item).hasVideo,
        videoDescription: getFeedItemVideoMetadata(item).videoDescription,
        viewOutlierRatio: getFeedItemOutlierMetrics(item).viewOutlierRatio || null,
        maxOutlierRatio: getFeedItemOutlierMetrics(item).maxOutlierRatio || null,
        publishedAt: item.publishedAt?.toISOString() ?? null,
        viewCount: item.viewCount ?? null,
        likeCount: item.likeCount ?? null,
        retweetCount: item.retweetCount ?? null,
      })),
      promptProfile: BOARD_AI_SCORING_PROMPT_PROFILE,
    });

    const guardedAssessment = applyBoardAssessmentGuards({
      title: args.story.canonicalTitle,
      vertical: args.story.vertical,
      attentionSignals,
      feedItems: prioritizedFeedItems.map((item) => ({
        sourceKind: item.sourceKind,
        title: item.title,
        summary: buildEffectiveSourceSummary(item),
        metadataJson: item.metadataJson,
      })),
      assessment,
    });

    return {
      ...guardedAssessment,
      model: process.env.OPENAI_RESEARCH_MODEL ?? "gpt-4.1-mini",
      promptVersion: BOARD_AI_SCORING_PROMPT_VERSION,
      inputHash,
      computedAt: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

// ─── Score computation ───

export async function scoreStory(
  storyId: string
): Promise<StoryScoreResult> {
  const db = getDb();

  // Get the story
  const story = await db
    .select()
    .from(boardStoryCandidates)
    .where(eq(boardStoryCandidates.id, storyId))
    .limit(1)
    .then((rows) => rows[0]);

  if (!story) {
    return {
      totalScore: 0,
      breakdown: {
        sourceScore: 0,
        controversyScore: 0,
        timelinessScore: 0,
        competitorOverlap: 0,
        visualEvidence: 0,
        moonRelevance: 0,
      },
      tier: "D",
      surgeActive: false,
    };
  }

  const existingScoreJson = coerceScoreJson(story.scoreJson);
  const existingAiAssessment = coerceCachedBoardAiAssessment(
    existingScoreJson.aiBoardAssessment
  );
  const existingBoardVisibilityScoreValue =
    typeof existingScoreJson.boardVisibilityScore === "number"
      ? existingScoreJson.boardVisibilityScore
      : typeof existingScoreJson.boardVisibilityScore === "string"
        ? Number(existingScoreJson.boardVisibilityScore)
        : null;
  const existingBoardVisibilityScore = Number.isFinite(
    existingBoardVisibilityScoreValue
  )
    ? Math.max(
        0,
        Math.min(100, Math.round(Number(existingBoardVisibilityScoreValue)))
      )
    : null;

  // Get linked feed items for tier-1 check
  const feedItems = await db
    .select({
      url: boardFeedItems.url,
      title: boardFeedItems.title,
      summary: boardFeedItems.summary,
      publishedAt: boardFeedItems.publishedAt,
      metadataJson: boardFeedItems.metadataJson,
      sourceName: boardSources.name,
      sourceKind: boardSources.kind,
    })
    .from(boardStorySources)
    .innerJoin(boardFeedItems, eq(boardStorySources.feedItemId, boardFeedItems.id))
    .innerJoin(boardSources, eq(boardFeedItems.sourceId, boardSources.id))
    .where(eq(boardStorySources.storyId, storyId))
    .orderBy(
      desc(boardStorySources.sourceWeight),
      desc(boardFeedItems.publishedAt),
      desc(boardFeedItems.ingestedAt)
    );
  const freshnessReferenceAt = getStoryFreshnessReferenceAt({
    storyLastSeenAt: story.lastSeenAt ? new Date(story.lastSeenAt) : null,
    feedItems: feedItems.map((item) => ({
      sourceKind: item.sourceKind,
      publishedAt: item.publishedAt,
    })),
  });
  const hasOrganicXDiscourse = feedItems.some(
    (item) =>
      item.sourceKind === "x_account" &&
      !isNewswireOrInstitutionalXSourceName(item.sourceName)
  );

  // 1. Source Score (30pts): min(sourceCount * 3, 30) + tier-1 bonus
  const sourceCount = story.sourcesCount;
  let sourceScore = Math.min(sourceCount * 3, 30);
  const hasTier1 = feedItems.some((fi) => isTier1Source(fi.url));
  if (hasTier1) {
    sourceScore = Math.min(sourceScore + 5, 30);
  }

  const moonResult = await scoreBoardStoryWithMoonCorpus(storyId);

  // 3. Timeliness — this is now a MULTIPLIER not just points
  // Recent stories get full score, old ones decay hard
  let timelinessScore = 20;
  let agePenaltyMultiplier = 1.0; // applied to total score at the end
  if (freshnessReferenceAt) {
    const ageMs = Date.now() - freshnessReferenceAt.getTime();
    const ageHours = ageMs / (1000 * 60 * 60);
    const ageDays = ageHours / 24;

    // Timeliness points
    if (ageHours < 6) timelinessScore = 20;
    else if (ageHours < 24) timelinessScore = 18;
    else if (ageHours < 72) timelinessScore = 15; // 3 days
    else if (ageDays < 7) timelinessScore = 10;
    else if (ageDays < 14) timelinessScore = 5;
    else timelinessScore = 0;

    // Age penalty multiplier — stale stories should fall out of the live board fast
    // unless they are genuinely resurging.
    if (ageDays > 30) agePenaltyMultiplier = 0.08;      // 1+ month = 8% of score
    else if (ageDays > 14) agePenaltyMultiplier = 0.15; // 2+ weeks = 15%
    else if (ageDays > 7) agePenaltyMultiplier = 0.25;  // 1+ week = 25%
    else if (ageDays > 3) agePenaltyMultiplier = 0.45;  // 3+ days = 45%
    else if (ageHours > 48) agePenaltyMultiplier = 0.7; // 2-3 days = 70%
    else agePenaltyMultiplier = 1.0;                    // fresh = full score

    // Surge override: if story has 3+ sources in last 24h, it's resurgent
    // (handled below in surge detection)
  }

  // 4. Competitor Overlap (15pts): disabled until the signal is story-specific.
  // The previous implementation was effectively global and inflated unrelated stories.
  const competitorOverlap = 0;
  let aiCompetitorContextSignal = 0;
  try {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const competitorMatches = await db
      .select({ count: sql<number>`count(*)` })
      .from(boardCompetitorPosts)
      .where(
        and(
          gte(boardCompetitorPosts.topicMatchScore, 50),
          gte(boardCompetitorPosts.publishedAt, oneDayAgo)
        )
      )
      .then((rows) => Number(rows[0]?.count ?? 0));

    if (competitorMatches > 0) aiCompetitorContextSignal = 15;
  } catch {
    // Competitor context is best-effort
  }

  // 5. Visual Evidence (10pts): check if video clips exist
  let visualEvidence = 0;
  try {
    const storyTitle = story.canonicalTitle.toLowerCase();
    // Check if any clips in the library match the story topic (basic keyword match)
    const keywords = storyTitle
      .split(/\s+/)
      .filter((w) => w.length > 3)
      .slice(0, 3);

    if (keywords.length > 0) {
      const clipCount = await db
        .select({ count: sql<number>`count(*)` })
        .from(clipLibrary)
        .where(
          sql`lower(${clipLibrary.title}) LIKE ${"%" + keywords[0] + "%"}`
        )
        .then((rows) => Number(rows[0]?.count ?? 0));

      if (clipCount > 0) visualEvidence = 10;
    }
  } catch {
    // Visual check is best-effort
  }

  const scoredFeedItems = feedItems.map((item) => ({
    sourceName: item.sourceName,
    sourceKind: item.sourceKind,
    title: item.title,
    summary: item.summary,
    publishedAt: item.publishedAt,
    viewCount: getFeedItemEngagementMetrics(item).viewCount,
    likeCount: getFeedItemEngagementMetrics(item).likeCount,
    retweetCount: getFeedItemEngagementMetrics(item).retweetCount,
    metadataJson: item.metadataJson,
  }));
  const persistedAttentionSignals = buildBoardAttentionSignals({
    feedItems: prioritizeFeedItemsForBoardAssessment(scoredFeedItems),
    hasOrganicXDiscourse,
    sourcesCount: story.sourcesCount,
    competitorOverlap: aiCompetitorContextSignal,
    visualEvidence,
  });

  // 2. Controversy Score (25pts): controversyScore * 0.25
  const freshAiAssessment = await getBoardAiAssessment({
    story,
    feedItems: scoredFeedItems,
    moonContext: moonResult,
    attentionSignals: {
      competitorOverlap: aiCompetitorContextSignal,
      visualEvidence,
    },
  });
  const aiAssessment = freshAiAssessment ?? existingAiAssessment;
  const effectiveStoryType =
    story.storyType === "competitor" || story.storyType === "correction"
      ? story.storyType
      : aiAssessment && aiAssessment.confidence >= 65
        ? aiAssessment.suggestedStoryType
        : story.storyType;
  const effectiveControversyScore = Math.max(
    story.controversyScore,
    aiAssessment?.controversyScore ?? 0
  );

  const controversyScore = Math.min(
    Math.round(effectiveControversyScore * 0.25),
    25
  );

  // 6. Moon relevance — use BOTH corpus scoring AND keyword-based scoring.
  // The corpus scorer finds topic overlap with Moon's 1.45M word library but
  // is too generous (gives 70+ to product news). The keyword scorer is strict
  // about what Moon actually makes videos about. Both must agree.
  const corpusScore = moonResult?.moonFitScore ?? 0;
  const combinedSummary = feedItems
    .map((item) =>
      buildEffectiveSourceSummary({
        sourceKind: item.sourceKind,
        summary: item.summary,
        metadataJson: item.metadataJson,
      })
    )
    .filter((value): value is string => Boolean(value))
    .slice(0, 3)
    .join(" ");
  const keywordResult = scoreMoonRelevance(
    story.canonicalTitle,
    combinedSummary.length > 0 ? combinedSummary : null,
    {
      sourceCount: story.sourcesCount,
      controversyScore: story.controversyScore,
      sentimentMagnitude: Math.abs(story.sentimentScore),
      hasTwitterDiscourse: hasOrganicXDiscourse,
      hasYouTubeContent: false,
      hasMultipleSources: story.sourcesCount >= 2,
    }
  );
  const keywordScore = keywordResult.combinedScore;
  const moonRelevance = aiAssessment
    ? Math.round(aiAssessment.moonFitScore * 0.7 + corpusScore * 0.3)
    : Math.min(corpusScore, keywordScore > 0 ? corpusScore : 20);
  const boardVisibilityScore =
    aiAssessment?.boardVisibilityScore ?? existingBoardVisibilityScore;
  const relevanceAttentionSignals = persistedAttentionSignals;
  const concreteInternetStoryCue = hasConcreteInternetStoryCue({
    title: story.canonicalTitle,
    feedItems: feedItems.map((item) => ({
      sourceKind: item.sourceKind,
      title: item.title,
      summary: buildEffectiveSourceSummary({
        sourceKind: item.sourceKind,
        summary: item.summary,
        metadataJson: item.metadataJson,
      }),
      metadataJson: item.metadataJson,
    })),
  });
  const creatorLedInternetStory =
    feedItems.some((item) => item.sourceKind === "x_account") &&
    concreteInternetStoryCue &&
    !isGenericCreatorDiscussionTitle(story.canonicalTitle) &&
    !isRealityFranchiseChurnTitle(story.canonicalTitle) &&
    !isTabloidCelebrityGossipTitle(story.canonicalTitle) &&
    !isRoutinePoliticsOrPolicyTitle(story.canonicalTitle);

  // Total — apply both Moon relevance AND age penalty
  // STRICT: if it's not Moon content, it should not score high regardless
  // of how many sources or how recent it is.
  const hasDisqualifiers = (moonResult?.disqualifierCodes?.length ?? 0) > 0;
  const lowQualityTitle = hasLowQualityCanonicalTitle(story.canonicalTitle);
  const singleSourceCommentaryFallback =
    !aiAssessment &&
    feedItems.length === 1 &&
    feedItems[0]?.sourceKind === "x_account";
  const keywordFilterFailed = boardVisibilityScore !== null
    ? boardVisibilityScore < 20
    : keywordScore < 8;
  let relevanceMultiplier = hasDisqualifiers || lowQualityTitle ? 0.1
    : singleSourceCommentaryFallback ? 0.04
    : boardVisibilityScore !== null
      ? boardVisibilityScore >= 80 ? 1.0
      : boardVisibilityScore >= 65 ? 0.9
      : boardVisibilityScore >= 55 ? 0.75
      : boardVisibilityScore >= 45 ? 0.55
      : boardVisibilityScore >= 35 ? 0.4
      : boardVisibilityScore >= 25 ? 0.28
      : boardVisibilityScore >= 20 ? 0.18
      : 0.08
    : keywordFilterFailed ? 0.1
    : moonRelevance >= 70 ? 1.0
    : moonRelevance >= 55 ? 0.7
    : moonRelevance >= 40 ? 0.4
    : 0.08;

  if (
    creatorLedInternetStory &&
    boardVisibilityScore !== null &&
    boardVisibilityScore >= 25 &&
    !hasBroadAttentionSignals(relevanceAttentionSignals)
  ) {
    relevanceMultiplier = Math.max(
      relevanceMultiplier,
      boardVisibilityScore >= 45 ? 0.55 : 0.3
    );
  }

  const rawTotal =
    sourceScore +
    controversyScore +
    timelinessScore +
    competitorOverlap +
    visualEvidence;

  // Apply both multipliers: relevance × age
  const totalScore = Math.round(rawTotal * relevanceMultiplier * agePenaltyMultiplier);

  // Surge detection: items_count increased by 3+ in last hour
  let surgeActive = false;
  try {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const recentItems = await db
      .select({ count: sql<number>`count(*)` })
      .from(boardStorySources)
      .innerJoin(boardFeedItems, eq(boardStorySources.feedItemId, boardFeedItems.id))
      .where(
        and(
          eq(boardStorySources.storyId, storyId),
          gte(boardFeedItems.ingestedAt, oneHourAgo)
        )
      )
      .then((rows) => Number(rows[0]?.count ?? 0));

    surgeActive = recentItems >= 3;

    // Surge override: if actively surging, cancel age penalty
    // Old story resurfacing = worth covering
    if (surgeActive && agePenaltyMultiplier < 1.0) {
      agePenaltyMultiplier = 0.9; // slight penalty but mostly restored
    }
  } catch {
    // Surge check is best-effort
  }

  // Recalculate total with surge override
  const finalScore = surgeActive && agePenaltyMultiplier < 1.0
    ? Math.round(rawTotal * relevanceMultiplier * 0.9)
    : totalScore;
  const effectiveBoardScore = boardVisibilityScore ?? 0;

  const breakdown: ScoreBreakdown = {
    sourceScore,
    controversyScore,
    timelinessScore,
    competitorOverlap,
    visualEvidence,
    moonRelevance,
  };
  const audienceReaction = buildAudienceReactionSummary(persistedAttentionSignals);

  // Persist score to story
  await db
    .update(boardStoryCandidates)
    .set({
      surgeScore: finalScore,
      scoreJson: {
        ...existingScoreJson,
        ...breakdown,
        overall: effectiveBoardScore,
        compositeScore: finalScore,
        tier: getTier(finalScore),
        surgeActive,
        aiBoardAssessment: aiAssessment ?? existingScoreJson.aiBoardAssessment ?? null,
        moonFitScore: moonResult?.moonFitScore ?? 0,
        moonFitBand: moonResult?.moonFitBand ?? "low",
        moonCluster: moonResult?.clusterLabel ?? null,
        coverageMode: moonResult?.coverageMode ?? null,
        analogTitles: moonResult?.analogs.map((analog) => analog.title) ?? [],
        reasonCodes: moonResult?.reasonCodes ?? [],
        boardVisibilityScore,
        attentionSignals: persistedAttentionSignals,
        aggregateViewCount: persistedAttentionSignals.aggregateViewCount,
        maxViewCount: persistedAttentionSignals.maxViewCount,
        aggregateLikeCount: persistedAttentionSignals.aggregateLikeCount,
        aggregateRetweetCount: persistedAttentionSignals.aggregateRetweetCount,
        aggregateCommentCount: persistedAttentionSignals.aggregateCommentCount,
        maxCommentCount: persistedAttentionSignals.maxCommentCount,
        xPostCount: persistedAttentionSignals.xPostCount,
        xHighEngagementPostCount: persistedAttentionSignals.xHighEngagementPostCount,
        xVideoPostCount: persistedAttentionSignals.xVideoPostCount,
        xHighEngagementVideoPostCount:
          persistedAttentionSignals.xHighEngagementVideoPostCount,
        xCommentHeavyPostCount: persistedAttentionSignals.xCommentHeavyPostCount,
        tiktokPostCount: persistedAttentionSignals.tiktokPostCount,
        tiktokHighEngagementPostCount:
          persistedAttentionSignals.tiktokHighEngagementPostCount,
        tiktokVideoPostCount: persistedAttentionSignals.tiktokVideoPostCount,
        tiktokOutlierPostCount: persistedAttentionSignals.tiktokOutlierPostCount,
        tiktokStrongOutlierPostCount:
          persistedAttentionSignals.tiktokStrongOutlierPostCount,
        tiktokCommentHeavyPostCount:
          persistedAttentionSignals.tiktokCommentHeavyPostCount,
        maxTikTokOutlierRatio: persistedAttentionSignals.maxTikTokOutlierRatio,
        highCommentSourceCount: persistedAttentionSignals.highCommentSourceCount,
        backlashSourceCount: persistedAttentionSignals.backlashSourceCount,
        reactionSourceCount: persistedAttentionSignals.reactionSourceCount,
        institutionalSpectacleSourceCount:
          persistedAttentionSignals.institutionalSpectacleSourceCount,
        audienceReaction,
        lastScoredAt: new Date().toISOString(),
      },
      storyType: effectiveStoryType,
      controversyScore: effectiveControversyScore,
      updatedAt: new Date(),
    })
    .where(eq(boardStoryCandidates.id, storyId));

  return {
    totalScore: finalScore,
    breakdown,
    tier: getTier(finalScore),
    surgeActive,
  };
}
