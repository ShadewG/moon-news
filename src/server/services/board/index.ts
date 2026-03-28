import "server-only";

import { createHash } from "node:crypto";

import {
  and,
  asc,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNull,
  or,
  sql,
} from "drizzle-orm";

import { getEnv } from "@/server/config/env";
import { getDb } from "@/server/db/client";
import { getAgentReachHealth } from "@/server/providers/agent-reach";
import { compareBoardLiveFeedStories } from "@/lib/board-live-feed";
import {
  boardAlertTypeEnum,
  boardAiOutputKindEnum,
  boardCompetitorChannels,
  boardCompetitorPosts,
  boardFeedItems,
  boardFeedItemVersions,
  boardQueueItems,
  boardSourceKindEnum,
  boardSources,
  boardStoryAiOutputs,
  boardStoryCandidates,
  boardStorySources,
  boardSurgeAlerts,
  moonStoryScores,
  boardTickerEvents,
  boardStoryStatusEnum,
  boardStoryTypeEnum,
} from "@/server/db/schema";
import { createProject } from "@/server/services/projects";

import {
  boardCompetitorChannelSeeds,
  boardQueueSeeds,
  boardSourceConfigSeeds,
  boardSourceCategorySeeds,
  boardStorySeeds,
  boardTickerSeeds,
  type BoardStorySeed,
} from "./sample-data";
import {
  buildYouTubeChannelFeedUrl,
  fetchYouTubeComments,
  fetchYouTubeChannelUploads,
  resolveYouTubeChannelFeed,
} from "@/server/providers/youtube";
import { sendDiscordChannelMessage, type DiscordEmbed } from "@/server/providers/discord";
import {
  analyzeBoardStoryComments,
  chooseMatchingBoardStory,
  summarizeShortVideoTranscript,
} from "@/server/providers/openai";
import { ingestLocalMediaArtifacts } from "@/server/providers/local-media";
import { loadTikTokFypVideos, searchTikTokVideos } from "@/server/providers/tiktok";
import { searchTwitterAccountPosts } from "@/server/providers/twitter";
import { fetchBoardRssItems, type BoardRssFeedItem } from "./rss";
import {
  buildBoardFormatRecommendation,
  type BoardFormatRecommendation,
} from "./format-recommendation";
import { generateBoardAiOutput, getBoardAiPromptVersion } from "./ai-outputs";
import { scoreStory } from "./story-scorer";
import {
  getMoonEditorialStyleGuide,
  getMoonStoryScoresByStoryIds,
  scoreBoardStoriesWithMoonCorpus,
  scoreBoardStoryWithMoonCorpus,
} from "@/server/services/moon-corpus";

export type BoardStoryStatus = (typeof boardStoryStatusEnum.enumValues)[number];
export type BoardStoryType = (typeof boardStoryTypeEnum.enumValues)[number];
export type BoardAiOutputKind = (typeof boardAiOutputKindEnum.enumValues)[number];
export type BoardAlertType = (typeof boardAlertTypeEnum.enumValues)[number];
export type BoardView = "board" | "controversy";
export type BoardTimeWindow = "today" | "week" | "month" | "all";

const SUPPORTED_BOARD_SOURCE_KINDS = new Set<string>([
  ...boardSourceKindEnum.enumValues,
  "subreddit",
]);
const DB_COMPATIBLE_BOARD_SOURCE_KINDS = new Set<string>([
  "rss",
  "youtube_channel",
  "x_account",
  "tiktok_query",
  "tiktok_fyp_profile",
]);
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
const BOARD_READ_MAINTENANCE_INTERVAL_MS = 10 * 60 * 1000;
const BOARD_DEFERRED_RESCORING_BATCH_SIZE = 12;
const BOARD_FEED_SIGNAL_BACKFILL_BATCH_SIZE = 200;
const BOARD_DISCORD_NOTIFICATION_METADATA_KEY = "discordBoardNotifications";
const BOARD_DISCORD_EMBED_COLOR = 0x6d4aff;
const BOARD_X_OUTLIER_BASELINE_SAMPLE_SIZE = 40;
const BOARD_X_OUTLIER_MIN_BASELINE_POSTS = 8;
const BOARD_X_OUTLIER_MIN_POSITIVE_METRIC_POSTS = 5;
const BOARD_TIKTOK_OUTLIER_BASELINE_SAMPLE_SIZE = 30;
const BOARD_TIKTOK_OUTLIER_MIN_BASELINE_POSTS = 6;
const BOARD_TIKTOK_OUTLIER_MIN_POSITIVE_METRIC_POSTS = 4;
const BOARD_COMMENT_REACTION_STORY_LIMIT = 12;
const BOARD_COMMENT_REACTION_SOURCE_LIMIT = 2;
const BOARD_COMMENT_REACTION_COMMENT_LIMIT = 8;
const BOARD_COMMENT_REACTION_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const BOARD_TIKTOK_TRANSCRIPT_RETRY_COOLDOWN_HOURS = 12;
const BOARD_TIKTOK_TRANSCRIPT_SUMMARY_MAX_CHARS = 500;
const BOARD_TIKTOK_TRANSCRIPT_EXCERPT_MAX_CHARS = 1200;

let boardSeedInitialized = false;
let boardSeedInitPromise: Promise<void> | null = null;
let boardReadMaintenancePromise: Promise<void> | null = null;
let lastBoardReadMaintenanceAt = 0;
let boardDeferredRescorePromise: Promise<void> | null = null;
let boardFeedSignalBackfillPromise: Promise<{ updatedFeedItems: number }> | null = null;
let boardFeedSignalsBackfilled = false;
const boardDeferredRescoreIds = new Set<string>();

function isSupportedBoardSourceKind(kind: string | null | undefined) {
  return typeof kind === "string" && SUPPORTED_BOARD_SOURCE_KINDS.has(kind);
}

function isLiveBoardSourceKind(kind: string | null | undefined) {
  return isSupportedBoardSourceKind(kind) && kind !== "youtube_channel";
}

function isVisibleBoardStorySourceKind(kind: string | null | undefined) {
  if (!isLiveBoardSourceKind(kind)) {
    return false;
  }

  if (kind === "x_account" && !getEnv().ENABLE_X_SEARCH) {
    return false;
  }

  return true;
}

function isConfiguredLivePollSourceKind(kind: string | null | undefined) {
  return (
    kind === "rss" ||
    kind === "youtube_channel" ||
    kind === "x_account" ||
    kind === "tiktok_query" ||
    kind === "tiktok_fyp_profile"
  );
}

function sourceConfigIsSignalOnly(
  configJson: unknown,
  sourceKind?: string | null,
  sourceName?: string | null
) {
  const config = coerceObject(configJson);
  const normalizedSourceName =
    typeof sourceName === "string" ? sourceName.trim().toLowerCase() : null;
  if (sourceKind === "google_trends" || sourceKind === "twitter_trending") {
    return true;
  }
  if (normalizedSourceName === "twitter_trending_default") {
    return true;
  }
  if (normalizedSourceName === "hacker news") {
    return true;
  }
  if (config?.signalOnly === true) {
    return true;
  }

  const tags = coerceStringArray(config?.tags).map((tag) => tag.toLowerCase());
  return tags.includes("google-trends") || tags.includes("twitter-trending");
}

function isNewswireOrInstitutionalXSourceName(sourceName: string) {
  const lower = sourceName.trim().toLowerCase();
  return NEWSWIRE_OR_INSTITUTIONAL_X_SOURCE_NAMES.some(
    (name) => lower === name || lower.includes(name)
  );
}

function storyHasPersistedScore(story: { scoreJson: unknown }) {
  const scoreJson = coerceObject(story.scoreJson);
  return (
    typeof scoreJson?.boardVisibilityScore === "number" &&
    typeof scoreJson?.lastScoredAt === "string" &&
    scoreJson.lastScoredAt.length > 0
  );
}

function scheduleBoardDeferredRescore(storyIds: string[]) {
  for (const storyId of storyIds) {
    if (storyId) {
      boardDeferredRescoreIds.add(storyId);
    }
  }

  if (boardDeferredRescoreIds.size === 0 || boardDeferredRescorePromise) {
    return;
  }

  boardDeferredRescorePromise = (async () => {
    while (boardDeferredRescoreIds.size > 0) {
      const batch = Array.from(boardDeferredRescoreIds).slice(
        0,
        BOARD_DEFERRED_RESCORING_BATCH_SIZE
      );

      for (const storyId of batch) {
        boardDeferredRescoreIds.delete(storyId);
      }

      try {
        await rescoreBoardStories(batch);
      } catch (error) {
        console.error("[board] deferred rescoring failed", error);
      }
    }
  })().finally(() => {
    boardDeferredRescorePromise = null;
    if (boardDeferredRescoreIds.size > 0) {
      scheduleBoardDeferredRescore([]);
    }
  });
}

function scheduleBoardReadMaintenance() {
  if (!getEnv().ENABLE_BOARD_READ_MAINTENANCE) {
    return;
  }

  if (boardReadMaintenancePromise) {
    return;
  }

  if (
    lastBoardReadMaintenanceAt > 0 &&
    Date.now() - lastBoardReadMaintenanceAt < BOARD_READ_MAINTENANCE_INTERVAL_MS
  ) {
    return;
  }

  boardReadMaintenancePromise = (async () => {
    await ensureBoardFeedItemVersionsBackfill();
    await syncBoardStoryCorrectionFlags();
    lastBoardReadMaintenanceAt = Date.now();
  })()
    .catch((error) => {
      console.error("[board] read-maintenance failed", error);
    })
    .finally(() => {
      boardReadMaintenancePromise = null;
    });
}

function logBoardPollDebug(stage: string, details: Record<string, unknown> = {}) {
  if (process.env.BOARD_POLL_DEBUG !== "true") {
    return;
  }

  const memory = process.memoryUsage();
  console.log(
    `[board-poll-debug] ${JSON.stringify({
      stage,
      ...details,
      rssMb: Math.round(memory.rss / 1024 / 1024),
      heapUsedMb: Math.round(memory.heapUsed / 1024 / 1024),
      heapTotalMb: Math.round(memory.heapTotal / 1024 / 1024),
      externalMb: Math.round(memory.external / 1024 / 1024),
    })}`
  );
}

function chunkBoardItems<T>(items: T[], size: number) {
  if (size <= 0) {
    return [items];
  }

  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

export interface BoardStorySummary {
  id: string;
  slug: string;
  canonicalTitle: string;
  vertical: string | null;
  status: BoardStoryStatus;
  storyType: BoardStoryType;
  surgeScore: number;
  controversyScore: number;
  sentimentScore: number;
  itemsCount: number;
  sourcesCount: number;
  correction: boolean;
  formats: string[];
  ageLabel: string;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  score: number;
  scoreJson: Record<string, unknown> | null;
  metadataJson: Record<string, unknown> | null;
  moonFitScore: number;
  moonFitBand: string;
  moonCluster: string | null;
  coverageMode: string | null;
  analogTitles: string[];
  analogMedianViews: number | null;
  analogMedianDurationMinutes: number | null;
  reasonCodes: string[];
  formatRecommendation: BoardFormatRecommendation;
  sourcePreviews: BoardStorySourcePreview[];
}

export interface BoardStorySourcePreview {
  id: string;
  feedItemId: string;
  name: string;
  kind: string;
  provider: string;
  signalOnly: boolean;
  title: string;
  url: string;
  publishedAt: string | null;
  sourceWeight: number;
  isPrimary: boolean;
  sourceType: string | null;
  versionCount: number;
  latestVersionNumber: number;
  latestDiffSummary: string | null;
  latestCapturedAt: string | null;
  hasCorrection: boolean;
  summary: string | null;
  hasVideo: boolean;
  videoDescription: string | null;
  tweetId: string | null;
  tweetUsername: string | null;
  embedUrl: string | null;
  thumbnailUrl: string | null;
  viewCount: number | null;
  likeCount: number | null;
  repostCount: number | null;
  commentCount: number | null;
  maxOutlierRatio: number | null;
}

export interface BoardStoryDetail {
  story: BoardStorySummary;
  sources: BoardStorySourcePreview[];
  versionHistory: BoardStoryVersionEntry[];
  moonAnalysis: {
    moonFitScore: number;
    moonFitBand: string;
    clusterKey: string | null;
    clusterLabel: string | null;
    coverageMode: string | null;
    analogs: Array<{
      clipId: string;
      title: string;
      sourceUrl: string | null;
      previewUrl: string | null;
      uploadDate: string | null;
      durationMs: number | null;
      viewCount: number | null;
      similarityScore: number;
    }>;
    analogMedianViews: number | null;
    analogMedianDurationMinutes: number | null;
    reasonCodes: string[];
    disqualifierCodes: string[];
  } | null;
  aiOutputs: Record<
    BoardAiOutputKind,
    {
      kind: BoardAiOutputKind;
      content: string;
      items: string[];
      model: string;
      promptVersion: string;
      updatedAt: string;
    } | null
  >;
  formatRecommendation: BoardFormatRecommendation;
  queueItem:
    | {
        id: string;
        position: number;
        status: string;
        format: string | null;
        targetPublishAt: string | null;
        assignedTo: string | null;
        notes: string | null;
        linkedProjectId: string | null;
      }
    | null;
}

export interface BoardStoryVersionEntry {
  id: string;
  feedItemId: string;
  sourceName: string;
  title: string;
  diffSummary: string | null;
  isCorrection: boolean;
  versionNumber: number;
  capturedAt: string;
}

export interface ListBoardStoriesInput {
  view?: BoardView;
  timeWindow?: BoardTimeWindow;
  status?: BoardStoryStatus;
  storyType?: BoardStoryType;
  platform?: "tiktok";
  search?: string;
  moonFitBand?: string;
  moonCluster?: string;
  coverageMode?: string;
  vertical?: string;
  hasAnalogs?: boolean;
  minMoonFitScore?: number;
  sort?: "live" | "moonFit" | "storyScore" | "controversy" | "recency" | "analogs" | "views";
  page?: number;
  limit?: number;
}

export interface ListBoardStoriesResult {
  stories: BoardStorySummary[];
  pageInfo: {
    page: number;
    limit: number;
    totalCount: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
  query: {
    view: BoardView;
    timeWindow: BoardTimeWindow;
    status: BoardStoryStatus | null;
    storyType: BoardStoryType | null;
    platform: string;
    search: string;
    moonFitBand: string;
    moonCluster: string;
    coverageMode: string;
    vertical: string;
    hasAnalogs: boolean | null;
    minMoonFitScore: number | null;
    sort: string;
  };
}

export interface BoardCompetitorChannelSummary {
  id: string;
  name: string;
  platform: string;
  tier: "tier1" | "tier2";
  handle: string | null;
  channelUrl: string | null;
  subscribersLabel: string | null;
  latestTitle: string | null;
  latestPublishedAt: string | null;
  latestTimeLabel: string;
  viewsLabel: string | null;
  topicMatchScore: number;
  alertLevel: "none" | "watch" | "hot";
}

export interface BoardSourceCategory {
  name: string;
  color: string;
  items: string[];
}

export interface BoardBootstrapPayload {
  stories: ListBoardStoriesResult;
  queue: Awaited<ReturnType<typeof listBoardQueue>>;
  competitors: Awaited<ReturnType<typeof listBoardCompetitors>>;
  sources: Awaited<ReturnType<typeof listBoardSources>>;
  health: Awaited<ReturnType<typeof getBoardHealth>>;
  ticker: Awaited<ReturnType<typeof listBoardTicker>>;
  alerts: Awaited<ReturnType<typeof listBoardAlerts>>;
}

export interface BoardAlertSummary {
  id: string;
  storyId: string;
  storySlug: string | null;
  alertType: BoardAlertType;
  headline: string;
  text: string;
  surgeScore: number;
  baselineAvg: number;
  currentCount: number;
  windowMinutes: number;
  createdAt: string;
  updatedAt: string;
  dismissedAt: string | null;
  metadataJson: Record<string, unknown> | null;
}

export interface MergeBoardStoriesResult {
  targetStory: BoardStoryDetail;
  mergedStoryIds: string[];
  mergedStorySlugs: string[];
  dedupedFeedItemCount: number;
  movedFeedItemCount: number;
}

export interface SplitBoardStoryResult {
  sourceStoryId: string;
  sourceStorySlug: string;
  newStory: BoardStoryDetail;
  movedFeedItemCount: number;
}

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 200;
const BOARD_RESCORING_LOOKBACK_DAYS = 3;
const BOARD_RESCORING_STORY_LIMIT = 150;
const BOARD_AI_STORY_DEDUP_SHORTLIST_LIMIT = 6;
const BOARD_AI_STORY_DEDUP_MIN_HEURISTIC_SCORE = 0.4;
const BOARD_AI_STORY_DEDUP_MIN_CONFIDENCE = 60;
const BOARD_HEURISTIC_MATCH_CLEAR_MARGIN = 0.12;
const BOARD_AI_KINDS: BoardAiOutputKind[] = ["brief", "script_starter", "titles"];
const BOARD_STORY_MATCH_LOOKBACK_DAYS = 45;
const BOARD_RSS_ITEM_LOOKBACK_DAYS = 21;
const BOARD_YOUTUBE_ITEM_LOOKBACK_DAYS = 45;
const BOARD_TIKTOK_ITEM_LOOKBACK_HOURS = 72;
const BOARD_ALERT_WINDOW_MINUTES = 120;
const BOARD_ALERT_BASELINE_DAYS = 7;
const BOARD_ALERT_RECENT_CONTROVERSY_HOURS = 24;
const BOARD_TITLE_STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "for",
  "from",
  "how",
  "in",
  "into",
  "is",
  "it",
  "its",
  "now",
  "of",
  "on",
  "or",
  "the",
  "their",
  "this",
  "to",
  "was",
  "what",
  "when",
  "where",
  "why",
  "with",
  "your",
]);

const BOARD_TITLE_MATCH_NOISE = new Set([
  "actor",
  "actress",
  "aged",
  "family",
  "film",
  "movie",
  "movies",
  "says",
  "show",
  "shows",
  "star",
  "stars",
  "singer",
  "rapper",
  "legendary",
  "week",
  "weeks",
  "year",
  "years",
  "old",
  "new",
  "latest",
]);

const BOARD_TITLE_MATCH_ALIASES: Record<string, string> = {
  arrested: "arrest",
  arrests: "arrest",
  charged: "charge",
  charges: "charge",
  deaths: "death",
  dead: "death",
  died: "death",
  dies: "death",
  killed: "death",
  killing: "death",
  allegations: "allegation",
  allegation: "allegation",
  accused: "accuse",
  accuses: "accuse",
  abusing: "abuse",
  abused: "abuse",
  bans: "ban",
  banned: "ban",
  backlash: "backlash",
  sued: "lawsuit",
  sues: "lawsuit",
  lawsuits: "lawsuit",
};

interface BoardRssSourceConfig {
  mode: "rss_feed";
  signalOnly?: boolean;
  feedUrl: string;
  siteUrl?: string;
  sourceType?: string;
  vertical?: string;
  authorityScore?: number;
  tags: string[];
}

interface BoardYouTubeSourceConfig {
  mode: "youtube_channel";
  channelId?: string;
  feedUrl?: string;
  uploadsPlaylistId?: string;
  channelHandle?: string;
  channelUrl?: string;
  channelName?: string;
  sourceType?: string;
  vertical?: string;
  authorityScore?: number;
  tags: string[];
  maxResults?: number;
}

interface BoardXSourceConfig {
  mode: "x_account";
  handle: string;
  queryTerms?: string[];
  sourceType?: string;
  vertical?: string;
  authorityScore?: number;
  tags: string[];
  maxResults?: number;
}

interface BoardTikTokQuerySourceConfig {
  mode: "tiktok_query";
  query: string;
  queries: string[];
  hashtags: string[];
  sourceType?: string;
  vertical?: string;
  authorityScore?: number;
  tags: string[];
  maxResults?: number;
}

interface BoardTikTokFypProfileSourceConfig {
  mode: "tiktok_fyp_profile";
  profileKey: string;
  sourceType?: string;
  vertical?: string;
  authorityScore?: number;
  tags: string[];
  maxResults?: number;
}

type BoardSourceConfig =
  | BoardRssSourceConfig
  | BoardYouTubeSourceConfig
  | BoardXSourceConfig
  | BoardTikTokQuerySourceConfig
  | BoardTikTokFypProfileSourceConfig;

interface BoardSourceFeedItem {
  externalId: string;
  title: string;
  url: string;
  author: string | null;
  publishedAt: Date | null;
  summary: string | null;
  contentHash: string;
  metadataJson?: Record<string, unknown> | null;
}

interface BoardStoryMatchRecord {
  id: string;
  slug: string;
  canonicalTitle: string;
  vertical: string | null;
  storyType: BoardStoryType;
  firstSeenAt: Date | null;
  lastSeenAt: Date | null;
  itemsCount: number;
  sourcesCount: number;
  tokens: string[];
  entityKeys: string[];
  eventKeys: string[];
}

interface RankedBoardStoryMatchRecord extends BoardStoryMatchRecord {
  heuristicScore: number;
  exactTitleMatch: boolean;
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeSearch(value?: string): string {
  return value?.trim().slice(0, 200) ?? "";
}

function normalizePage(value?: number): number {
  if (!value || !Number.isFinite(value)) {
    return 1;
  }

  return Math.max(1, Math.floor(value));
}

function normalizeLimit(value?: number): number {
  if (!value || !Number.isFinite(value)) {
    return DEFAULT_LIMIT;
  }

  return Math.max(1, Math.min(MAX_LIMIT, Math.floor(value)));
}

function coerceStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function coerceObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function coerceDate(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  return null;
}

function coercePositiveNumber(value: unknown): number | null {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return null;
  }

  return numeric;
}

function toIsoString(value: unknown): string | null {
  const date = coerceDate(value);
  return date ? date.toISOString() : null;
}

function truncateBoardDiscordText(value: string, maxLength: number) {
  const cleaned = value.replace(/\s+/g, " ").trim();
  if (cleaned.length <= maxLength) {
    return cleaned;
  }

  return `${cleaned.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function getBoardStoryVisibilityScore(story: Pick<BoardStorySummary, "scoreJson">) {
  const scoreJson = coerceObject(story.scoreJson);
  return typeof scoreJson?.boardVisibilityScore === "number"
    ? (scoreJson.boardVisibilityScore as number)
    : 0;
}

function getBoardStoryDiscordNotificationRecord(
  metadataJson: unknown,
  channelId: string
) {
  const metadata = coerceObject(metadataJson);
  const notifications = coerceObject(
    metadata?.[BOARD_DISCORD_NOTIFICATION_METADATA_KEY]
  );
  return coerceObject(notifications?.[channelId]);
}

function hasBoardStoryDiscordNotification(
  story: Pick<BoardStorySummary, "metadataJson">,
  channelId: string
) {
  const record = getBoardStoryDiscordNotificationRecord(
    story.metadataJson,
    channelId
  );
  return typeof record?.sentAt === "string" && record.sentAt.length > 0;
}

function formatBoardReasonCode(code: string) {
  const normalized = code.includes(":") ? code.split(":").slice(1).join(":") : code;
  return normalized.replace(/[_-]+/g, " ").trim();
}

function buildBoardDiscordWhyNow(story: BoardStorySummary) {
  const scoreJson = coerceObject(story.scoreJson);
  const aiAssessment = coerceObject(scoreJson?.aiBoardAssessment);
  if (typeof aiAssessment?.explanation === "string" && aiAssessment.explanation.length > 0) {
    return truncateBoardDiscordText(aiAssessment.explanation, 1024);
  }

  const reasonCodes = story.reasonCodes;
  if (reasonCodes.length > 0) {
    return truncateBoardDiscordText(
      reasonCodes.slice(0, 4).map((code) => `• ${formatBoardReasonCode(code)}`).join("\n"),
      1024
    );
  }

  const firstSummary = story.sourcePreviews.find((source) => source.summary)?.summary;
  if (firstSummary) {
    return truncateBoardDiscordText(firstSummary, 1024);
  }

  return "• New top board idea surfaced on the Moon board.";
}

function buildBoardDiscordSourceList(sources: BoardStorySourcePreview[]) {
  const lines = sources
    .slice(0, 4)
    .map((source) =>
      truncateBoardDiscordText(`• ${source.name} (${source.kind})`, 90)
    );

  if (lines.length === 0) {
    return "No linked sources yet.";
  }

  return truncateBoardDiscordText(lines.join("\n"), 1024);
}

function buildBoardDiscordEmbed(story: BoardStorySummary): DiscordEmbed {
  const env = getEnv();
  const primarySourceUrl =
    story.sourcePreviews[0]?.url ?? (env.APP_URL ? `${env.APP_URL}/board` : undefined);
  const scoreJson = coerceObject(story.scoreJson);
  const aiAssessment = coerceObject(scoreJson?.aiBoardAssessment);
  const description =
    (typeof aiAssessment?.explanation === "string" && aiAssessment.explanation.length > 0
      ? aiAssessment.explanation
      : story.sourcePreviews.find((source) => source.summary)?.summary) ??
    "New top board idea surfaced on the live board.";

  return {
    title: story.canonicalTitle,
    url: primarySourceUrl,
    color: BOARD_DISCORD_EMBED_COLOR,
    description: truncateBoardDiscordText(description, 4096),
    fields: [
      {
        name: "Board",
        value: [
          `Visibility ${getBoardStoryVisibilityScore(story)}/100`,
          `Moon ${story.moonFitScore}/100`,
          `Controversy ${story.controversyScore}/100`,
          `Type ${story.storyType}`,
        ].join("\n"),
        inline: true,
      },
      {
        name: "Format",
        value: [
          story.formatRecommendation.packageLabel,
          `Primary ${story.formatRecommendation.primaryFormat}`,
          `Urgency ${story.formatRecommendation.urgency}`,
        ].join("\n"),
        inline: true,
      },
      {
        name: "Why Now",
        value: buildBoardDiscordWhyNow(story),
      },
      {
        name: "Sources",
        value: buildBoardDiscordSourceList(story.sourcePreviews),
      },
    ],
    footer: {
      text: env.APP_URL ? `Moon board • ${env.APP_URL}/board` : "Moon board",
    },
    timestamp: story.lastSeenAt ?? new Date().toISOString(),
  };
}

async function markBoardStoryDiscordNotificationSent(
  storyId: string,
  channelId: string,
  story: BoardStorySummary
) {
  const db = getDb();
  const [existing] = await db
    .select({ metadataJson: boardStoryCandidates.metadataJson })
    .from(boardStoryCandidates)
    .where(eq(boardStoryCandidates.id, storyId))
    .limit(1);

  const metadata = coerceObject(existing?.metadataJson) ?? {};
  const notifications = coerceObject(
    metadata[BOARD_DISCORD_NOTIFICATION_METADATA_KEY]
  ) ?? {};

  await db
    .update(boardStoryCandidates)
    .set({
      metadataJson: {
        ...metadata,
        [BOARD_DISCORD_NOTIFICATION_METADATA_KEY]: {
          ...notifications,
          [channelId]: {
            sentAt: new Date().toISOString(),
            boardVisibilityScore: getBoardStoryVisibilityScore(story),
            lastSeenAt: story.lastSeenAt,
            storyType: story.storyType,
            title: story.canonicalTitle,
          },
        },
      },
      updatedAt: new Date(),
    })
    .where(eq(boardStoryCandidates.id, storyId));
}

function formatAgeLabel(date: Date | null): string {
  if (!date) {
    return "n/a";
  }

  const diffMs = Date.now() - date.getTime();
  const diffMinutes = Math.max(1, Math.floor(diffMs / (1000 * 60)));

  if (diffMinutes < 60) {
    return `${diffMinutes}m`;
  }

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours}h`;
  }

  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d`;
}

function formatCompactCount(value: number | null, suffix = "views") {
  if (value === null || Number.isNaN(value)) {
    return null;
  }

  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M ${suffix}`;
  }

  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(value >= 100_000 ? 0 : 1)}K ${suffix}`;
  }

  return `${Math.max(0, Math.round(value))} ${suffix}`;
}

function computeBoardCompetitorTopicMatchScore(
  title: string,
  stories: Array<{
    canonicalTitle: string;
    controversyScore: number;
    surgeScore: number;
    storyType: BoardStoryType;
  }>
) {
  const competitorTokens = tokenizeBoardTitle(title);
  let bestScore = 0;

  for (const story of stories) {
    const overlap = computeTokenOverlap(
      competitorTokens,
      tokenizeBoardTitle(story.canonicalTitle)
    );

    if (overlap <= 0) {
      continue;
    }

    let score = overlap * 100;
    score += Math.min(12, story.controversyScore * 0.1);
    score += Math.min(10, story.surgeScore * 0.08);
    if (story.storyType === "controversy" || story.storyType === "correction") {
      score += 8;
    }

    bestScore = Math.max(bestScore, clampBoardScore(score));
  }

  return bestScore;
}

function computeBoardCompetitorAlertLevel(args: {
  topicMatchScore: number;
  publishedAt: Date | null;
}) {
  const publishedAt = args.publishedAt;
  const ageHours = publishedAt
    ? (Date.now() - publishedAt.getTime()) / (1000 * 60 * 60)
    : Number.POSITIVE_INFINITY;

  if (args.topicMatchScore >= 80 && ageHours <= 168) {
    return "hot" as const;
  }

  if (
    args.topicMatchScore >= 60 ||
    (args.topicMatchScore >= 40 && ageHours <= 72)
  ) {
    return "watch" as const;
  }

  return "none" as const;
}

function buildBoardStoryOperationError(status: number, message: string) {
  const error = new Error(message) as Error & { status?: number };
  error.status = status;
  return error;
}

function getQueueStatusRank(status: string | null | undefined) {
  switch (status) {
    case "published":
      return 6;
    case "editing":
      return 5;
    case "filming":
      return 4;
    case "scripting":
      return 3;
    case "researching":
      return 2;
    case "watching":
      return 1;
    default:
      return 0;
  }
}

function mergeUniqueStrings(values: Array<string | null | undefined>) {
  return Array.from(
    new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))
  );
}

function chooseMergedQueueStatus(values: Array<string | null | undefined>) {
  return values.reduce<string | null>((best, current) => {
    if (!current) {
      return best;
    }

    if (!best || getQueueStatusRank(current) > getQueueStatusRank(best)) {
      return current;
    }

    return best;
  }, null);
}

function buildBoardFeedItemContent(item: {
  title: string;
  summary: string | null;
  url: string;
}) {
  return [item.title.trim(), item.summary?.trim() ?? "", item.url.trim()]
    .filter(Boolean)
    .join("\n\n");
}

function isSignalOnlySourceKind(kind: string | null | undefined) {
  return kind === "google_trends" || kind === "twitter_trending";
}

function normalizeYouTubeDescriptionSummary(summary: string | null | undefined) {
  if (!summary) {
    return null;
  }

  const lines = summary
    .split(/\r?\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter(
      (line) =>
        !/^https?:\/\//i.test(line) &&
        !/\b(use code|sponsor|sponsored|merch|patreon|follow me|follow us|discord server|gaming channel)\b/i.test(
          line
        ) &&
        !/^[A-Za-z0-9._-]+\s+https?:\/\//i.test(line)
    );

  const cleaned = lines
    .map((line) => line.replace(/https?:\/\/\S+/gi, "").replace(/\s+/g, " ").trim())
    .filter((line) => line.length >= 20);

  if (cleaned.length === 0) {
    const collapsed = summary
      .replace(/https?:\/\/\S+/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
    return collapsed.length > 0 ? collapsed.slice(0, 500) : null;
  }

  return cleaned.slice(0, 2).join(" ").slice(0, 500);
}

function decodeBoardHtmlEntities(value: string) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => {
      const parsed = Number(code);
      return Number.isFinite(parsed) ? String.fromCodePoint(parsed) : " ";
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => {
      const parsed = Number.parseInt(code, 16);
      return Number.isFinite(parsed) ? String.fromCodePoint(parsed) : " ";
    })
    .replace(/\s+/g, " ")
    .trim();
}

function hasLowInformationBoardTitle(title: string) {
  const decoded = decodeBoardHtmlEntities(title);
  const cleaned = decoded.replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();

  if (!cleaned || cleaned.length <= 3) {
    return true;
  }

  const tokens = tokenizeBoardTitle(decoded);
  if (tokens.length === 0) {
    return true;
  }

  if (
    tokens.length === 1 &&
    [
      "reminiscing",
      "thoughts",
      "watching",
      "update",
      "breaking",
      "wow",
      "crazy",
      "insane",
      "listen",
      "yikes",
    ].includes(tokens[0] ?? "")
  ) {
    return true;
  }

  return false;
}

function isDefaultRedditSourceName(name: string | null | undefined) {
  return typeof name === "string" && name.trim().toLowerCase() === "reddit_default";
}

function isDefaultTrendingSourceName(name: string | null | undefined) {
  return (
    typeof name === "string" && name.trim().toLowerCase() === "twitter_trending_default"
  );
}

function hasConcreteOnlineCultureCue(title: string) {
  return /\b(ai|ai video|ai generated video|gpt|chatgpt|openai|sora|midjourney|runway|veo|youtube|tiktok|reddit|discord|twitch|streamer|creator|windows(?:\s*11)?|dlss|steam|game|gaming|patch|review ring|fake review|review bomb|review bombing|capcom|kerbal|marvel rivals|x money|twitter|social media|bot problem|human verification|deepfake|onlyfans|crypto\.com|bitcoin|btc|trailer backlash|teaser backlash|cgi backlash|casting backlash|live action remake|remake backlash|box office bomb|robot|humanoid robot)\b/i.test(
    decodeBoardHtmlEntities(title)
  );
}

function hasPlatformOrInternetEntityCue(title: string) {
  return /\b(openai|chatgpt|sora|midjourney|runway|veo|youtube|tiktok|reddit|discord|twitch|streamer|creator|windows(?:\s*11)?|google search|steam|dlss|capcom|kerbal|marvel rivals|x money|twitter|social media|bot problem|human verification|review ring|review bomb|review bombing|fake review|deepfake|onlyfans|crypto\.com|trailer backlash|cgi backlash|casting backlash|live action remake|remake backlash|box office bomb|robot|humanoid robot)\b/i.test(
    decodeBoardHtmlEntities(title)
  );
}

function hasInternetReactionCultureCue(title: string) {
  return /\b(viral|meme|memes|internet reacts?|internet is losing it|internet's losing it|losing it over|skit|parody|satire|comedy sketch|fans react|reaction wave|quote[\s-]?tweet|dogpile|pile-on|clowned|clowning|mocked|mocking|roasted|ratioed|dragged|people online)\b/i.test(
    decodeBoardHtmlEntities(title)
  );
}

function hasGenericCivicCue(title: string) {
  return /\b(judge|court|lawsuit|press|pentagon|airport|senate|congress|police|military|immigration|deployed|iran|israel|palantir|facial recognition|infrastructure|energy|town|strike|bias|appeal|family|hospital|voter|election)\b/i.test(
    decodeBoardHtmlEntities(title)
  );
}

function hasRoutinePoliticsFigureCue(title: string) {
  return /\b(bernie sanders|aoc|alexandria ocasio-cortez|trump|senate|congress|white house|administration|gop|democrat|republican|governor|mayor)\b/i.test(
    decodeBoardHtmlEntities(title)
  );
}

function hasInstitutionalPolicyCue(title: string) {
  return /\b(ioc|olympics?|eligibility policy|female eligibility|executive order|new policy)\b/i.test(
    decodeBoardHtmlEntities(title)
  );
}

function hasMemeticArtifactCue(title: string) {
  return /\b(video|clip|robot|humanoid|deepfake|meme|viral|photo op|image|post|bodycam|trailer|teaser|captcha|patch|shutdown|leak|backlash)\b/i.test(
    decodeBoardHtmlEntities(title)
  );
}

function isLowPriorityDeathRemembranceBoardTitle(title: string) {
  const decoded = decodeBoardHtmlEntities(title);
  const deathNotice =
    /\b(died|dies|dead at|death of|obituary|remembering|tribute to|passes away|passed away)\b/i.test(
      decoded
    );
  const internetCultureEscape =
    /\b(backlash|meme|memes|creator|streamer|youtuber|youtube|twitch|reddit|discord|tiktok|viral clip|viral video|review bomb|review bombing|trailer|cgi|ai slop|ai video|deepfake)\b/i.test(
      decoded
    );

  return deathNotice && !internetCultureEscape;
}

function isDryPlatformBusinessBoardTitle(title: string) {
  const decoded = decodeBoardHtmlEntities(title);
  const platformOrTechSubject =
    /\b(meta|facebook|instagram|reddit|twitter|x money|openai|chatgpt|youtube|tiktok|discord|google|apple|microsoft|steam|tesla|ai)\b/i.test(
      decoded
    );
  const dryBusinessAngle =
    /\b(found liable|liable|shareholders?|investors?|acquisition|takeover|earnings|revenue|raise \$|raise \d|funding|manufacturing firms|merger|report)\b/i.test(
      decoded
    );
  const onlineCultureEscape =
    /\b(backlash|hate|hating|mocked|mocking|roasted|ratioed|review bomb|review bombing|creator|streamer|youtuber|reddit|discord|moderation|algorithm|bot|verification|ban|banned|deepfake|ai slop|ai video|leak|leaked|dmca|copyright)\b/i.test(
      decoded
    );

  return platformOrTechSubject && dryBusinessAngle && !onlineCultureEscape;
}

function isLowSignalDefaultRedditTitle(title: string) {
  const decoded = decodeBoardHtmlEntities(title).trim();
  const lower = decoded.toLowerCase();

  if (hasLowInformationBoardTitle(decoded)) {
    return true;
  }

  if (
    /^((has anyone|do a lot of us|looking back|online free tests|why arr|my roommate|i listed|uh based)\b|daily discussion thread\b)/i.test(
      lower
    )
  ) {
    return true;
  }

  if (
    /\b(anything goes|announcement trailer|launch teaser|discussion thread|ranked by difficulty)\b/i.test(
      lower
    )
  ) {
    return true;
  }

  if (/\?$/.test(decoded) && !hasConcreteOnlineCultureCue(decoded)) {
    return true;
  }

  if (hasGenericCivicCue(decoded) && !hasConcreteOnlineCultureCue(decoded)) {
    return true;
  }

  return !hasConcreteOnlineCultureCue(decoded);
}

function isCreatorWrapperTitle(title: string) {
  const decoded = decodeBoardHtmlEntities(title);
  const lower = decoded.toLowerCase();

  return (
    /\.\.\.$/.test(decoded) ||
    /\b(hit a new low|keeps getting crazier|is insane|was crazy|came out|beyond insane|endless hypocrisies|goes hard|is trash|is cooked)\b/.test(
      lower
    ) ||
    /^the\s.+\b(files|drama)\b/.test(lower)
  );
}

function cleanCanonicalTitleFragment(value: string) {
  return decodeBoardHtmlEntities(value)
    .replace(/^[\s"'`“”‘’]+|[\s"'`“”‘’]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function deriveCanonicalYouTubeTitle(item: BoardSourceFeedItem) {
  const originalTitle = cleanCanonicalTitleFragment(item.title);
  if (!originalTitle) {
    return originalTitle;
  }

  const normalizedDescription =
    typeof item.metadataJson?.normalizedDescription === "string"
      ? cleanCanonicalTitleFragment(item.metadataJson.normalizedDescription)
      : cleanCanonicalTitleFragment(item.summary ?? "");

  const wrapperPatterns: Array<{
    pattern: RegExp;
    build: (match: RegExpMatchArray) => string;
  }> = [
    {
      pattern: /^(.+?)\s+Bodycam\s+Came\s+Out$/i,
      build: (match) => `${cleanCanonicalTitleFragment(match[1] ?? "")} Bodycam Video Released`,
    },
    {
      pattern: /^(.+?)\s+Drama\s+Keeps\s+Getting\s+Crazier$/i,
      build: (match) => `${cleanCanonicalTitleFragment(match[1] ?? "")} Controversy Grows`,
    },
    {
      pattern: /^Newest\s+(.+?)\s+Controversy\s+is\s+Insane$/i,
      build: (match) => `${cleanCanonicalTitleFragment(match[1] ?? "")} Controversy Grows`,
    },
    {
      pattern: /^The\s+Endless\s+Hypocrisies\s+of\s+(.+)$/i,
      build: (match) => `${cleanCanonicalTitleFragment(match[1] ?? "")} Hypocrisy Backlash`,
    },
    {
      pattern: /^The\s+(.+?)\s+Hit\s+A\s+New\s+Low\s+\(([^)]+)\)$/i,
      build: (match) =>
        `${cleanCanonicalTitleFragment(match[2] ?? "")} ${cleanCanonicalTitleFragment(match[1] ?? "")} Controversy`,
    },
    {
      pattern: /^The\s+(.+?)\s+Files\s+\(([^)]+)\)$/i,
      build: (match) =>
        `${cleanCanonicalTitleFragment(match[2] ?? "")} ${cleanCanonicalTitleFragment(match[1] ?? "")} Controversy`,
    },
  ];

  for (const rule of wrapperPatterns) {
    const match = originalTitle.match(rule.pattern);
    if (!match) {
      continue;
    }

    const candidate = cleanCanonicalTitleFragment(rule.build(match));
    if (!hasLowInformationBoardTitle(candidate)) {
      return candidate;
    }
  }

  const topicMatch =
    normalizedDescription.match(/this is the greatest\s+(.+?)\s+of all time/i) ??
    normalizedDescription.match(/this is the greatest\s+(.+?)$/i);

  if (topicMatch?.[1]) {
    const topic = cleanCanonicalTitleFragment(topicMatch[1]);
    if (/\bbodycam\b/i.test(topic)) {
      return topic.replace(/\bbodycam\b/i, "Bodycam Video Released");
    }

    if (/\b(dlss|controversy|lawsuit|ban|backlash|arrest|scam|fraud)\b/i.test(topic)) {
      return topic;
    }
  }

  return originalTitle;
}

function deriveBoardCanonicalTitle(item: BoardSourceFeedItem, sourceKind: string) {
  const decodedTitle = cleanCanonicalTitleFragment(item.title);
  if (sourceKind === "youtube_channel") {
    return deriveCanonicalYouTubeTitle(item);
  }

  return decodedTitle;
}

function scoreCanonicalTitleQuality(args: {
  title: string;
  sourceKind: string;
}) {
  const decoded = cleanCanonicalTitleFragment(args.title);
  if (hasLowInformationBoardTitle(decoded)) {
    return 0;
  }

  let score = Math.min(tokenizeBoardTitle(decoded).length * 6, 36);

  if (!isCreatorWrapperTitle(decoded)) {
    score += 18;
  }

  if (args.sourceKind !== "youtube_channel") {
    score += 10;
  }

  if (
    /\b(controversy|backlash|lawsuit|bodycam|released|arrest|ban|banned|scam|fraud|discord|tiktok|youtube|creator|streamer|ai|windows|dlss)\b/i.test(
      decoded
    )
  ) {
    score += 8;
  }

  return score;
}

function choosePreferredCanonicalTitle(args: {
  existingTitle: string;
  candidates: Array<{
    title: string;
    sourceKind: string;
    publishedAt: Date | null;
  }>;
}) {
  const seededCandidates = [
    {
      title: cleanCanonicalTitleFragment(args.existingTitle),
      sourceKind: "existing",
      publishedAt: null,
    },
    ...args.candidates.map((candidate) => ({
      title: cleanCanonicalTitleFragment(candidate.title),
      sourceKind: candidate.sourceKind,
      publishedAt: candidate.publishedAt,
    })),
  ].filter((candidate) => candidate.title.length > 0);

  seededCandidates.sort((left, right) => {
    const rightScore = scoreCanonicalTitleQuality({
      title: right.title,
      sourceKind: right.sourceKind,
    });
    const leftScore = scoreCanonicalTitleQuality({
      title: left.title,
      sourceKind: left.sourceKind,
    });

    if (rightScore !== leftScore) {
      return rightScore - leftScore;
    }

    return (
      (right.publishedAt?.getTime() ?? 0) - (left.publishedAt?.getTime() ?? 0)
    );
  });

  return seededCandidates[0]?.title ?? cleanCanonicalTitleFragment(args.existingTitle);
}

function getStoryFreshnessDate(args: {
  previews: BoardStorySourcePreview[];
  fallbackLastSeenAt: Date | null;
}) {
  const supportedPreviews = args.previews.filter((preview) =>
    isLiveBoardSourceKind(preview.kind)
  );
  const nonSignalDates = supportedPreviews
    .filter((preview) => !preview.signalOnly)
    .map((preview) => coerceDate(preview.publishedAt))
    .filter((value): value is Date => Boolean(value));

  if (nonSignalDates.length > 0) {
    return new Date(Math.max(...nonSignalDates.map((date) => date.getTime())));
  }

  const anySupportedDates = supportedPreviews
    .map((preview) => coerceDate(preview.publishedAt))
    .filter((value): value is Date => Boolean(value));

  if (anySupportedDates.length > 0) {
    return new Date(Math.max(...anySupportedDates.map((date) => date.getTime())));
  }

  return args.fallbackLastSeenAt;
}

function normalizeBoardTextForComparison(value: string | null | undefined) {
  return value?.trim().replace(/\s+/g, " ") ?? "";
}

function inferBoardCorrectionSignal(args: {
  title: string;
  summary: string | null;
  diffSummary: string | null;
}) {
  const combined = [args.title, args.summary ?? "", args.diffSummary ?? ""].join(" ");
  return /\b(correction|clarif(?:y|ies|ied)|update[d]?|walks back|retraction)\b/i.test(
    combined
  );
}

function buildBoardFeedItemDiffSummary(args: {
  previous: {
    title: string;
    summary: string | null;
    url: string;
    contentHash: string | null;
  };
  next: {
    title: string;
    summary: string | null;
    url: string;
    contentHash: string | null;
  };
}) {
  const changes: string[] = [];

  if (
    normalizeBoardTextForComparison(args.previous.title) !==
    normalizeBoardTextForComparison(args.next.title)
  ) {
    changes.push("headline updated");
  }

  if (
    normalizeBoardTextForComparison(args.previous.summary) !==
    normalizeBoardTextForComparison(args.next.summary)
  ) {
    changes.push("summary changed");
  }

  if (
    normalizeBoardTextForComparison(args.previous.url) !==
    normalizeBoardTextForComparison(args.next.url)
  ) {
    changes.push("canonical URL changed");
  }

  if ((args.previous.contentHash ?? "") !== (args.next.contentHash ?? "")) {
    changes.push("content hash changed");
  }

  if (changes.length === 0) {
    return null;
  }

  return changes.join(", ");
}

function formatBoardBaselineValue(value: number): string {
  if (value <= 0) {
    return "0.0";
  }

  return value < 10 ? value.toFixed(1) : String(Math.round(value));
}

function buildBoardAlertText(args: {
  alertType: BoardAlertType;
  title: string;
  currentCount: number;
  baselineAvg: number;
  surgeScore: number;
  controversyScore: number;
}) {
  if (args.alertType === "controversy") {
    return `${args.title} is running hot with controversy ${args.controversyScore} and ${args.currentCount} recent source hits.`;
  }

  if (args.alertType === "correction") {
    return `${args.title} picked up a correction/update signal and needs a source check before queueing.`;
  }

  return `${args.title} is running ${args.surgeScore.toFixed(1)}x above baseline (${args.currentCount} recent hits vs ${formatBoardBaselineValue(args.baselineAvg)} normal).`;
}

function buildSourceKey(name: string, kind: string): string {
  return `${kind}:${name.toLowerCase()}`;
}

function buildFeedExternalId(story: BoardStorySeed, sourceName: string, index: number) {
  return `${story.slug}:${slugify(sourceName)}:${index}`;
}

function getPollIntervalMinutes(kind: string): number {
  switch (kind) {
    case "youtube_channel":
      return 30;
    case "x_account":
      return 15;
    case "tiktok_query":
      return 20;
    case "tiktok_fyp_profile":
      return 25;
    case "government_feed":
    case "legal_watch":
      return 60;
    default:
      return 20;
  }
}

function getBoardSourceSeedConfig(name: string, kind: string) {
  return (
    boardSourceConfigSeeds.find((config) => config.name === name && config.kind === kind) ?? null
  );
}

function parseBoardRssSourceConfig(value: unknown): BoardRssSourceConfig | null {
  const config = coerceObject(value);

  if (!config || config.mode !== "rss_feed" || typeof config.feedUrl !== "string") {
    return null;
  }

  return {
    mode: "rss_feed",
    signalOnly: config.signalOnly === true,
    feedUrl: config.feedUrl,
    siteUrl: typeof config.siteUrl === "string" ? config.siteUrl : undefined,
    sourceType: typeof config.sourceType === "string" ? config.sourceType : undefined,
    vertical: typeof config.vertical === "string" ? config.vertical : undefined,
    authorityScore:
      typeof config.authorityScore === "number" ? Math.round(config.authorityScore) : undefined,
    tags: coerceStringArray(config.tags),
  };
}

function parseBoardYouTubeSourceConfig(value: unknown): BoardYouTubeSourceConfig | null {
  const config = coerceObject(value);

  if (
    !config ||
    config.mode !== "youtube_channel"
  ) {
    return null;
  }

  const channelId = typeof config.channelId === "string" ? config.channelId : undefined;
  const feedUrl = typeof config.feedUrl === "string" ? config.feedUrl : undefined;
  const uploadsPlaylistId =
    typeof config.uploadsPlaylistId === "string" ? config.uploadsPlaylistId : undefined;
  const channelHandle =
    typeof config.channelHandle === "string" ? config.channelHandle : undefined;
  const channelUrl = typeof config.channelUrl === "string" ? config.channelUrl : undefined;
  const channelName = typeof config.channelName === "string" ? config.channelName : undefined;

  if (!channelId && !feedUrl && !channelHandle && !channelUrl && !channelName) {
    return null;
  }

  return {
    mode: "youtube_channel",
    channelId,
    feedUrl,
    uploadsPlaylistId,
    channelHandle,
    channelUrl,
    channelName,
    sourceType: typeof config.sourceType === "string" ? config.sourceType : undefined,
    vertical: typeof config.vertical === "string" ? config.vertical : undefined,
    authorityScore:
      typeof config.authorityScore === "number" ? Math.round(config.authorityScore) : undefined,
    tags: coerceStringArray(config.tags),
    maxResults: typeof config.maxResults === "number" ? Math.round(config.maxResults) : undefined,
  };
}

function parseBoardXSourceConfig(value: unknown): BoardXSourceConfig | null {
  const config = coerceObject(value);

  if (
    !config ||
    config.mode !== "x_account" ||
    typeof config.handle !== "string"
  ) {
    return null;
  }

  return {
    mode: "x_account",
    handle: config.handle,
    queryTerms: coerceStringArray(config.queryTerms),
    sourceType: typeof config.sourceType === "string" ? config.sourceType : undefined,
    vertical: typeof config.vertical === "string" ? config.vertical : undefined,
    authorityScore:
      typeof config.authorityScore === "number" ? Math.round(config.authorityScore) : undefined,
    tags: coerceStringArray(config.tags),
    maxResults: typeof config.maxResults === "number" ? Math.round(config.maxResults) : undefined,
  };
}

function parseBoardTikTokQuerySourceConfig(value: unknown): BoardTikTokQuerySourceConfig | null {
  const config = coerceObject(value);

  if (
    !config ||
    config.mode !== "tiktok_query" ||
    typeof config.query !== "string" ||
    config.query.trim().length === 0
  ) {
    return null;
  }

  return {
    mode: "tiktok_query",
    query: config.query.trim(),
    queries: mergeUniqueStrings([config.query.trim(), ...coerceStringArray(config.queries)]),
    hashtags: mergeUniqueStrings(coerceStringArray(config.hashtags)),
    sourceType: typeof config.sourceType === "string" ? config.sourceType : undefined,
    vertical: typeof config.vertical === "string" ? config.vertical : undefined,
    authorityScore:
      typeof config.authorityScore === "number" ? Math.round(config.authorityScore) : undefined,
    tags: coerceStringArray(config.tags),
    maxResults: typeof config.maxResults === "number" ? Math.round(config.maxResults) : undefined,
  };
}

function parseBoardTikTokFypProfileSourceConfig(
  value: unknown
): BoardTikTokFypProfileSourceConfig | null {
  const config = coerceObject(value);

  if (
    !config ||
    config.mode !== "tiktok_fyp_profile" ||
    typeof config.profileKey !== "string" ||
    config.profileKey.trim().length === 0
  ) {
    return null;
  }

  return {
    mode: "tiktok_fyp_profile",
    profileKey: config.profileKey.trim(),
    sourceType: typeof config.sourceType === "string" ? config.sourceType : undefined,
    vertical: typeof config.vertical === "string" ? config.vertical : undefined,
    authorityScore:
      typeof config.authorityScore === "number" ? Math.round(config.authorityScore) : undefined,
    tags: coerceStringArray(config.tags),
    maxResults: typeof config.maxResults === "number" ? Math.round(config.maxResults) : undefined,
  };
}

function parseBoardSourceConfig(
  source: Pick<typeof boardSources.$inferSelect, "kind" | "configJson">
): BoardSourceConfig | null {
  if (source.kind === "rss") {
    return parseBoardRssSourceConfig(source.configJson);
  }

  if (source.kind === "youtube_channel") {
    return parseBoardYouTubeSourceConfig(source.configJson);
  }

  if (source.kind === "x_account") {
    return parseBoardXSourceConfig(source.configJson);
  }

  if (source.kind === "tiktok_query") {
    return parseBoardTikTokQuerySourceConfig(source.configJson);
  }

  if (source.kind === "tiktok_fyp_profile") {
    return parseBoardTikTokFypProfileSourceConfig(source.configJson);
  }

  return null;
}

function getBoardCompetitorYouTubeConfig(
  channel: Pick<
    typeof boardCompetitorChannels.$inferSelect,
    "name" | "handle" | "channelUrl" | "metadataJson"
  >
) {
  const metadata = coerceObject(channel.metadataJson);
  const metadataConfig = parseBoardYouTubeSourceConfig({
    mode: "youtube_channel",
    channelId: metadata?.channelId,
    uploadsPlaylistId: metadata?.uploadsPlaylistId,
    channelHandle: metadata?.channelHandle ?? channel.handle,
    channelUrl: metadata?.channelUrl ?? channel.channelUrl,
    channelName: channel.name,
    sourceType: "yt",
    tags: Array.isArray(metadata?.tags) ? metadata.tags : ["competitor"],
    maxResults: typeof metadata?.maxResults === "number" ? metadata.maxResults : 6,
  });

  if (metadataConfig) {
    return metadataConfig;
  }

  const configuredSource = boardSourceConfigSeeds.find(
    (config) =>
      config.kind === "youtube_channel" &&
      (config.name === channel.name ||
        (channel.handle &&
          config.configJson.mode === "youtube_channel" &&
          config.configJson.channelHandle === channel.handle))
  );

  if (!configuredSource || configuredSource.configJson.mode !== "youtube_channel") {
    return parseBoardYouTubeSourceConfig({
      mode: "youtube_channel",
      channelHandle: channel.handle ?? undefined,
      channelUrl: channel.channelUrl ?? undefined,
      channelName: channel.name,
      sourceType: "yt",
      tags: ["competitor"],
      maxResults: 6,
    });
  }

  return parseBoardYouTubeSourceConfig(configuredSource.configJson);
}

function isBoardSourcePollable(source: typeof boardSources.$inferSelect): boolean {
  if (!source.enabled) {
    return false;
  }

  // The live board only polls news/social sources.
  // Other kinds (subreddit, twitter_trending, google_trends, tiktok_proxy, bluesky)
  // are polled by the external scheduler, not the board poll cycle.
  if (
    source.kind !== "rss" &&
    source.kind !== "x_account" &&
    source.kind !== "tiktok_query" &&
    source.kind !== "tiktok_fyp_profile"
  ) {
    return false;
  }

  if (source.kind === "x_account" && !getEnv().ENABLE_X_SEARCH) {
    return false;
  }

  return Boolean(parseBoardSourceConfig(source));
}

function needsBoardSourceConfigSync(source: typeof boardSources.$inferSelect): boolean {
  const configuredSource = getBoardSourceSeedConfig(source.name, source.kind);

  if (configuredSource) {
    if (source.kind === "rss" && configuredSource.configJson.mode === "rss_feed") {
      const config = parseBoardRssSourceConfig(source.configJson);
      return !config || config.feedUrl !== configuredSource.configJson.feedUrl;
    }

    if (
      source.kind === "youtube_channel" &&
      configuredSource.configJson.mode === "youtube_channel"
    ) {
      const config = parseBoardYouTubeSourceConfig(source.configJson);
      const mergedConfig = mergeBoardYouTubeSourceConfig(
        configuredSource.configJson,
        config
      );

      return (
        !config ||
        JSON.stringify(normalizeBoardYouTubeSourceConfig(config)) !==
          JSON.stringify(normalizeBoardYouTubeSourceConfig(mergedConfig))
      );
    }

    if (source.kind === "x_account" && configuredSource.configJson.mode === "x_account") {
      const config = parseBoardXSourceConfig(source.configJson);
      return (
        !config ||
        config.handle !== configuredSource.configJson.handle
      );
    }

    if (
      source.kind === "tiktok_query" &&
      configuredSource.configJson.mode === "tiktok_query"
    ) {
      const config = parseBoardTikTokQuerySourceConfig(source.configJson);
      const configuredQueries = configuredSource.configJson.queries ?? [
        configuredSource.configJson.query,
      ];
      const configuredHashtags = configuredSource.configJson.hashtags ?? [];

      return (
        !config ||
        config.query !== configuredSource.configJson.query ||
        JSON.stringify(config.queries) !== JSON.stringify(configuredQueries) ||
        JSON.stringify(config.hashtags) !== JSON.stringify(configuredHashtags)
      );
    }

    if (
      source.kind === "tiktok_fyp_profile" &&
      configuredSource.configJson.mode === "tiktok_fyp_profile"
    ) {
      const config = parseBoardTikTokFypProfileSourceConfig(source.configJson);
      return !config || config.profileKey !== configuredSource.configJson.profileKey;
    }
  }

  return isConfiguredLivePollSourceKind(source.kind) && source.enabled;
}

function normalizeBoardYouTubeSourceConfig(config: BoardYouTubeSourceConfig) {
  return {
    mode: "youtube_channel" as const,
    channelId: config.channelId ?? null,
    feedUrl:
      config.feedUrl ??
      (config.channelId ? buildYouTubeChannelFeedUrl(config.channelId) : null),
    uploadsPlaylistId: config.uploadsPlaylistId ?? null,
    channelHandle: config.channelHandle ?? null,
    channelUrl: config.channelUrl ?? null,
    channelName: config.channelName ?? null,
    sourceType: config.sourceType ?? null,
    vertical: config.vertical ?? null,
    authorityScore: config.authorityScore ?? null,
    tags: [...config.tags],
    maxResults: config.maxResults ?? null,
  };
}

function mergeBoardYouTubeSourceConfig(
  seedConfig: {
    mode: "youtube_channel";
    channelId?: string;
    feedUrl?: string;
    uploadsPlaylistId?: string;
    channelHandle?: string;
    channelUrl?: string;
    sourceType?: string;
    vertical?: string;
    authorityScore?: number;
    tags?: string[];
    maxResults?: number;
  },
  currentConfig: BoardYouTubeSourceConfig | null
): BoardYouTubeSourceConfig {
  const channelId = seedConfig.channelId ?? currentConfig?.channelId;
  const feedUrl =
    seedConfig.feedUrl ??
    currentConfig?.feedUrl ??
    (channelId ? buildYouTubeChannelFeedUrl(channelId) : undefined);

  return {
    mode: "youtube_channel",
    channelId,
    feedUrl,
    uploadsPlaylistId: seedConfig.uploadsPlaylistId ?? currentConfig?.uploadsPlaylistId,
    channelHandle: seedConfig.channelHandle ?? currentConfig?.channelHandle,
    channelUrl: seedConfig.channelUrl ?? currentConfig?.channelUrl,
    channelName: currentConfig?.channelName,
    sourceType: seedConfig.sourceType ?? currentConfig?.sourceType,
    vertical: seedConfig.vertical ?? currentConfig?.vertical,
    authorityScore: seedConfig.authorityScore ?? currentConfig?.authorityScore,
    tags: seedConfig.tags ?? currentConfig?.tags ?? [],
    maxResults: seedConfig.maxResults ?? currentConfig?.maxResults,
  };
}

function tokenizeBoardTitle(title: string): string[] {
  const uniqueTokens = new Set(
    title
      .toLowerCase()
      .replace(/['’]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .split(/\s+/)
      .map((token) => BOARD_TITLE_MATCH_ALIASES[token] ?? token)
      .filter(
        (token) =>
          token.length >= 3 &&
          !BOARD_TITLE_STOPWORDS.has(token) &&
          !BOARD_TITLE_MATCH_NOISE.has(token) &&
          !/^\d+$/.test(token)
      )
  );

  return Array.from(uniqueTokens);
}

function normalizeBoardMatchTitle(title: string) {
  return tokenizeBoardTitle(title).join(" ");
}

function extractTweetIdFromUrl(url: string | null | undefined) {
  if (typeof url !== "string") {
    return null;
  }

  const match = url.match(/\/status\/(\d+)/i);
  return match?.[1] ?? null;
}

function buildTwitterEmbedUrl(tweetId: string | null) {
  return tweetId ? `https://x.com/i/status/${tweetId}` : null;
}

function computeTokenOverlap(left: string[], right: string[]): number {
  if (left.length === 0 || right.length === 0) {
    return 0;
  }

  const rightSet = new Set(right);
  const overlapCount = left.filter((token) => rightSet.has(token)).length;

  return overlapCount / Math.max(left.length, right.length);
}

function countTokenOverlap(left: string[], right: string[]): number {
  if (left.length === 0 || right.length === 0) {
    return 0;
  }

  const rightSet = new Set(right);
  return left.filter((token) => rightSet.has(token)).length;
}

function computeFlexibleTokenOverlap(left: string[], right: string[]): number {
  if (left.length === 0 || right.length === 0) {
    return 0;
  }

  const overlapCount = countTokenOverlap(left, right);
  if (overlapCount === 0) {
    return 0;
  }

  const strictOverlap = overlapCount / Math.max(left.length, right.length);
  const containmentOverlap = overlapCount / Math.min(left.length, right.length);

  return strictOverlap * 0.6 + containmentOverlap * 0.4;
}

function clampBoardScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function computeBoardRecencyScore(date: Date | null): number {
  if (!date) {
    return 45;
  }

  const diffHours = Math.max(0, (Date.now() - date.getTime()) / (1000 * 60 * 60));
  if (diffHours <= 6) {
    return 95;
  }
  if (diffHours <= 24) {
    return 88;
  }
  if (diffHours <= 72) {
    return 74;
  }
  if (diffHours <= 7 * 24) {
    return 62;
  }

  return 45;
}

function inferBoardStoryType(title: string, summary?: string | null): BoardStoryType {
  const normalized = `${title} ${summary ?? ""}`.toLowerCase();

  if (/\b(correction|clarif(?:y|ies|ied)|update[d]?|walks back|retraction)\b/.test(normalized)) {
    return "correction";
  }

  if (
    /\b(lawsuit|sues|sued|probe|backlash|controversy|exposed|scam|fraud|killed|kills|ban|rollback|slammed|dragged|booed|roasted|diss(?:es|ed)?|walk(?:s|ed)?\s+off|storm(?:s|ed)?\s+(?:off|out)|getting hate|gets hate|got hate|hated|ai slop)\b/.test(
      normalized
    )
  ) {
    return "controversy";
  }

  if (/\b(viral|surge|rogue|boom|spike|record|explodes)\b/.test(normalized)) {
    return "trending";
  }

  return "normal";
}

function computeBoardControversyScore(title: string, summary: string | null): number {
  const normalized = `${title} ${summary ?? ""}`.toLowerCase();

  let score = 28;
  const strongMatches = [
    "lawsuit",
    "sues",
    "fraud",
    "scam",
    "backlash",
    "ai slop",
    "getting hate",
    "hated",
    "storms off",
    "storms out",
    "walk off",
    "walks off",
    "disses",
    "slammed",
    "dragged",
    "privacy",
    "rollback",
    "probe",
    "rogue",
    "surveillance",
    "sexual",
    "deepfake",
  ];

  for (const term of strongMatches) {
    if (normalized.includes(term)) {
      score += 8;
    }
  }

  return clampBoardScore(score);
}

const BOARD_FEED_SIGNAL_VERSION = 2;

const BOARD_POSITIVE_SENTIMENT_TERMS = [
  "wins",
  "win",
  "boost",
  "growth",
  "approved",
  "approval",
  "breakthrough",
  "launch",
  "launches",
  "restored",
  "protects",
  "protect",
  "safer",
  "improves",
  "improvement",
  "success",
  "successful",
];

const BOARD_NEGATIVE_SENTIMENT_TERMS = [
  "lawsuit",
  "sues",
  "scam",
  "fraud",
  "backlash",
  "rollback",
  "surveillance",
  "leak",
  "probe",
  "accused",
  "accuses",
  "ban",
  "banned",
  "death",
  "dead",
  "crash",
  "collapse",
  "outrage",
  "ai slop",
  "storms off",
  "storms out",
  "walks off",
  "disses",
  "dragged",
  "slammed",
  "hated",
  "exposed",
  "firestorm",
  "privacy",
  "killed",
  "kills",
];

const BOARD_ENTITY_STOPWORDS = new Set([
  "about",
  "after",
  "again",
  "also",
  "because",
  "being",
  "between",
  "could",
  "every",
  "first",
  "from",
  "have",
  "into",
  "latest",
  "maybe",
  "news",
  "over",
  "their",
  "there",
  "these",
  "they",
  "this",
  "those",
  "what",
  "when",
  "where",
  "will",
  "with",
  "would",
  "your",
]);

const BOARD_EVENT_KEY_ALIASES: Record<string, string> = {
  arrested: "arrest",
  arrests: "arrest",
  arresting: "arrest",
  assaulted: "assault",
  assaults: "assault",
  charges: "charge",
  charged: "charge",
  banning: "ban",
  banned: "ban",
  suspends: "ban",
  suspended: "ban",
  suspension: "ban",
  lawsuits: "lawsuit",
  sues: "lawsuit",
  sued: "lawsuit",
  suing: "lawsuit",
  backlashes: "backlash",
  hated: "hate",
  hating: "hate",
  leaks: "leak",
  leaked: "leak",
  exposing: "expose",
  exposed: "expose",
  apologizes: "apology",
  apologized: "apology",
  apologizing: "apology",
  fights: "fight",
  fighting: "fight",
  fought: "fight",
  beefing: "beef",
  scammed: "scam",
  scamming: "scam",
  trailers: "trailer",
  remakes: "remake",
  reboots: "reboot",
  deepfakes: "deepfake",
  captchas: "captcha",
  updates: "update",
  updated: "update",
  restoring: "restore",
  restored: "restore",
};

const BOARD_EVENT_KEYS = new Set([
  "arrest",
  "assault",
  "charge",
  "ban",
  "lawsuit",
  "backlash",
  "hate",
  "leak",
  "expose",
  "apology",
  "fight",
  "beef",
  "feud",
  "scam",
  "trailer",
  "casting",
  "remake",
  "reboot",
  "deepfake",
  "captcha",
  "update",
  "restore",
  "outrage",
  "controversy",
  "response",
  "meltdown",
  "boycott",
  "reviewbomb",
  "slop",
  "ai",
]);

function tokenizeBoardScoringText(value: string) {
  return value.toLowerCase().match(/[a-z0-9][a-z0-9'-]{2,}/g) ?? [];
}

function extractBoardEventKeys(title: string, summary: string | null) {
  const unique = new Set<string>();

  for (const token of tokenizeBoardScoringText(`${title} ${summary ?? ""}`)) {
    const normalized = BOARD_EVENT_KEY_ALIASES[token] ?? token;
    if (BOARD_EVENT_KEYS.has(normalized)) {
      unique.add(normalized);
    }
  }

  return Array.from(unique);
}

function coerceBoardMetricCount(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const normalized = Number(value.replace(/[,_]/g, ""));
    return Number.isFinite(normalized) ? normalized : 0;
  }

  return 0;
}

function computeBoardMetricMedian(values: number[]) {
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

interface BoardXEngagementBaseline {
  sampleSize: number;
  medianViewCount: number;
  medianLikeCount: number;
  medianRetweetCount: number;
}

interface BoardTikTokEngagementBaseline {
  sampleSize: number;
  medianViewCount: number;
  medianLikeCount: number;
  medianShareCount: number;
}

async function getBoardXSourceEngagementBaseline(
  sourceId: string
): Promise<BoardXEngagementBaseline | null> {
  const db = getDb();
  const rows = await db
    .select({
      metadataJson: boardFeedItems.metadataJson,
    })
    .from(boardFeedItems)
    .where(eq(boardFeedItems.sourceId, sourceId))
    .orderBy(desc(boardFeedItems.publishedAt), desc(boardFeedItems.ingestedAt))
    .limit(BOARD_X_OUTLIER_BASELINE_SAMPLE_SIZE);

  if (rows.length < BOARD_X_OUTLIER_MIN_BASELINE_POSTS) {
    return null;
  }

  const viewCounts: number[] = [];
  const likeCounts: number[] = [];
  const retweetCounts: number[] = [];

  for (const row of rows) {
    const metadata = coerceObject(row.metadataJson);
    const viewCount = coerceBoardMetricCount(metadata?.viewCount);
    const likeCount = coerceBoardMetricCount(metadata?.likeCount);
    const retweetCount = coerceBoardMetricCount(metadata?.retweetCount);

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
    viewCounts.length < BOARD_X_OUTLIER_MIN_POSITIVE_METRIC_POSTS &&
    likeCounts.length < BOARD_X_OUTLIER_MIN_POSITIVE_METRIC_POSTS &&
    retweetCounts.length < BOARD_X_OUTLIER_MIN_POSITIVE_METRIC_POSTS
  ) {
    return null;
  }

  return {
    sampleSize: rows.length,
    medianViewCount:
      viewCounts.length >= BOARD_X_OUTLIER_MIN_POSITIVE_METRIC_POSTS
        ? computeBoardMetricMedian(viewCounts)
        : 0,
    medianLikeCount:
      likeCounts.length >= BOARD_X_OUTLIER_MIN_POSITIVE_METRIC_POSTS
        ? computeBoardMetricMedian(likeCounts)
        : 0,
    medianRetweetCount:
      retweetCounts.length >= BOARD_X_OUTLIER_MIN_POSITIVE_METRIC_POSTS
        ? computeBoardMetricMedian(retweetCounts)
        : 0,
  };
}

function computeBoardXEngagementOutlierMetadata(args: {
  metadataJson: Record<string, unknown>;
  baseline: BoardXEngagementBaseline | null;
}) {
  if (!args.baseline) {
    return null;
  }

  const viewCount = coerceBoardMetricCount(args.metadataJson.viewCount);
  const likeCount = coerceBoardMetricCount(args.metadataJson.likeCount);
  const retweetCount = coerceBoardMetricCount(args.metadataJson.retweetCount);
  const viewOutlierRatio =
    args.baseline.medianViewCount > 0 && viewCount > 0
      ? Number((viewCount / args.baseline.medianViewCount).toFixed(2))
      : null;
  const likeOutlierRatio =
    args.baseline.medianLikeCount > 0 && likeCount > 0
      ? Number((likeCount / args.baseline.medianLikeCount).toFixed(2))
      : null;
  const retweetOutlierRatio =
    args.baseline.medianRetweetCount > 0 && retweetCount > 0
      ? Number((retweetCount / args.baseline.medianRetweetCount).toFixed(2))
      : null;
  const ratios = [viewOutlierRatio, likeOutlierRatio, retweetOutlierRatio].filter(
    (value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0
  );
  const maxOutlierRatio = ratios.length > 0 ? Math.max(...ratios) : null;

  return {
    accountHistoricalPostCount: args.baseline.sampleSize,
    accountTypicalViewCount: args.baseline.medianViewCount || null,
    accountTypicalLikeCount: args.baseline.medianLikeCount || null,
    accountTypicalRetweetCount: args.baseline.medianRetweetCount || null,
    viewOutlierRatio,
    likeOutlierRatio,
    retweetOutlierRatio,
    maxOutlierRatio,
    isEngagementOutlier: maxOutlierRatio !== null && maxOutlierRatio >= 3,
    isStrongEngagementOutlier: maxOutlierRatio !== null && maxOutlierRatio >= 5,
  };
}

async function getBoardTikTokCreatorEngagementBaseline(
  creatorHandle: string
): Promise<BoardTikTokEngagementBaseline | null> {
  const normalizedCreatorHandle = creatorHandle.trim().replace(/^@+/, "");
  if (!normalizedCreatorHandle) {
    return null;
  }

  const db = getDb();
  const rows = await db
    .select({
      metadataJson: boardFeedItems.metadataJson,
    })
    .from(boardFeedItems)
    .innerJoin(boardSources, eq(boardSources.id, boardFeedItems.sourceId))
    .where(
      and(
        inArray(boardSources.kind, ["tiktok_query", "tiktok_fyp_profile"]),
        sql`coalesce(${boardFeedItems.metadataJson}->>'creatorHandle', '') = ${normalizedCreatorHandle}`
      )
    )
    .orderBy(desc(boardFeedItems.publishedAt), desc(boardFeedItems.ingestedAt))
    .limit(BOARD_TIKTOK_OUTLIER_BASELINE_SAMPLE_SIZE);

  if (rows.length < BOARD_TIKTOK_OUTLIER_MIN_BASELINE_POSTS) {
    return null;
  }

  const viewCounts: number[] = [];
  const likeCounts: number[] = [];
  const shareCounts: number[] = [];

  for (const row of rows) {
    const metadata = coerceObject(row.metadataJson);
    const viewCount = coerceBoardMetricCount(metadata?.viewCount);
    const likeCount = coerceBoardMetricCount(metadata?.likeCount);
    const shareCount = Math.max(
      coerceBoardMetricCount(metadata?.shareCount),
      coerceBoardMetricCount(metadata?.retweetCount)
    );

    if (viewCount > 0) {
      viewCounts.push(viewCount);
    }
    if (likeCount > 0) {
      likeCounts.push(likeCount);
    }
    if (shareCount > 0) {
      shareCounts.push(shareCount);
    }
  }

  if (
    viewCounts.length < BOARD_TIKTOK_OUTLIER_MIN_POSITIVE_METRIC_POSTS &&
    likeCounts.length < BOARD_TIKTOK_OUTLIER_MIN_POSITIVE_METRIC_POSTS &&
    shareCounts.length < BOARD_TIKTOK_OUTLIER_MIN_POSITIVE_METRIC_POSTS
  ) {
    return null;
  }

  return {
    sampleSize: rows.length,
    medianViewCount:
      viewCounts.length >= BOARD_TIKTOK_OUTLIER_MIN_POSITIVE_METRIC_POSTS
        ? computeBoardMetricMedian(viewCounts)
        : 0,
    medianLikeCount:
      likeCounts.length >= BOARD_TIKTOK_OUTLIER_MIN_POSITIVE_METRIC_POSTS
        ? computeBoardMetricMedian(likeCounts)
        : 0,
    medianShareCount:
      shareCounts.length >= BOARD_TIKTOK_OUTLIER_MIN_POSITIVE_METRIC_POSTS
        ? computeBoardMetricMedian(shareCounts)
        : 0,
  };
}

function computeBoardTikTokEngagementOutlierMetadata(args: {
  metadataJson: Record<string, unknown>;
  baseline: BoardTikTokEngagementBaseline | null;
}) {
  if (!args.baseline) {
    return null;
  }

  const viewCount = coerceBoardMetricCount(args.metadataJson.viewCount);
  const likeCount = coerceBoardMetricCount(args.metadataJson.likeCount);
  const shareCount = Math.max(
    coerceBoardMetricCount(args.metadataJson.shareCount),
    coerceBoardMetricCount(args.metadataJson.retweetCount)
  );
  const viewOutlierRatio =
    args.baseline.medianViewCount > 0 && viewCount > 0
      ? Number((viewCount / args.baseline.medianViewCount).toFixed(2))
      : null;
  const likeOutlierRatio =
    args.baseline.medianLikeCount > 0 && likeCount > 0
      ? Number((likeCount / args.baseline.medianLikeCount).toFixed(2))
      : null;
  const shareOutlierRatio =
    args.baseline.medianShareCount > 0 && shareCount > 0
      ? Number((shareCount / args.baseline.medianShareCount).toFixed(2))
      : null;
  const ratios = [viewOutlierRatio, likeOutlierRatio, shareOutlierRatio].filter(
    (value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0
  );
  const maxOutlierRatio = ratios.length > 0 ? Math.max(...ratios) : null;

  return {
    accountHistoricalPostCount: args.baseline.sampleSize,
    accountTypicalViewCount: args.baseline.medianViewCount || null,
    accountTypicalLikeCount: args.baseline.medianLikeCount || null,
    accountTypicalRetweetCount: args.baseline.medianShareCount || null,
    viewOutlierRatio,
    likeOutlierRatio,
    retweetOutlierRatio: shareOutlierRatio,
    shareOutlierRatio,
    maxOutlierRatio,
    isEngagementOutlier: maxOutlierRatio !== null && maxOutlierRatio >= 3,
    isStrongEngagementOutlier: maxOutlierRatio !== null && maxOutlierRatio >= 5,
  };
}

function getBoardTikTokTranscriptAttemptAt(metadataJson: Record<string, unknown> | null) {
  return coerceDate(metadataJson?.transcriptAttemptedAt);
}

function getBoardTikTokTranscriptPriority(args: {
  publishedAt: Date | null;
  metadataJson: Record<string, unknown> | null;
  storyScore: number;
}) {
  const metadata = args.metadataJson ?? {};
  const viewCount = coerceBoardMetricCount(metadata.viewCount);
  const likeCount = coerceBoardMetricCount(metadata.likeCount);
  const shareCount = Math.max(
    coerceBoardMetricCount(metadata.shareCount),
    coerceBoardMetricCount(metadata.retweetCount)
  );
  const commentCount = coerceBoardMetricCount(metadata.commentCount);
  const maxOutlierRatio = Math.max(Number(metadata.maxOutlierRatio) || 0, 0);
  const ageHours = args.publishedAt
    ? Math.max(0, (Date.now() - args.publishedAt.getTime()) / (1000 * 60 * 60))
    : 999;
  const recencyBonus =
    ageHours <= 6 ? 250_000 : ageHours <= 12 ? 125_000 : ageHours <= 24 ? 60_000 : 0;

  return (
    args.storyScore * 250_000 +
    viewCount +
    likeCount * 10 +
    shareCount * 40 +
    commentCount * 12 +
    maxOutlierRatio * 150_000 +
    recencyBonus
  );
}

function shouldEnrichBoardTikTokTranscript(args: {
  metadataJson: Record<string, unknown> | null;
  publishedAt: Date | null;
  minViews: number;
  storyScore: number;
}) {
  const metadata = args.metadataJson ?? {};
  const transcriptStatus =
    typeof metadata.transcriptStatus === "string" ? metadata.transcriptStatus : "";
  if (transcriptStatus === "success") {
    return false;
  }

  const attemptedAt = getBoardTikTokTranscriptAttemptAt(metadata);
  if (
    attemptedAt &&
    Date.now() - attemptedAt.getTime() <
      BOARD_TIKTOK_TRANSCRIPT_RETRY_COOLDOWN_HOURS * 60 * 60 * 1000
  ) {
    return false;
  }

  const viewCount = coerceBoardMetricCount(metadata.viewCount);
  const likeCount = coerceBoardMetricCount(metadata.likeCount);
  const shareCount = Math.max(
    coerceBoardMetricCount(metadata.shareCount),
    coerceBoardMetricCount(metadata.retweetCount)
  );
  const maxOutlierRatio = Math.max(Number(metadata.maxOutlierRatio) || 0, 0);
  const ageHours = args.publishedAt
    ? (Date.now() - args.publishedAt.getTime()) / (1000 * 60 * 60)
    : Infinity;

  if (ageHours > getEnv().BOARD_TIKTOK_TRANSCRIPT_LOOKBACK_HOURS) {
    return false;
  }

  return (
    args.storyScore >= 30 ||
    viewCount >= args.minViews ||
    likeCount >= 15_000 ||
    shareCount >= 1_000 ||
    maxOutlierRatio >= 3
  );
}

async function enrichBoardTikTokTranscriptForFeedItem(args: {
  feedItemId: string;
  title: string;
  url: string;
  summary: string | null;
  publishedAt: Date | null;
  metadataJson: Record<string, unknown> | null;
}) {
  const db = getDb();
  const attemptedAt = new Date().toISOString();
  const metadata = args.metadataJson ?? {};

  try {
    const artifacts = await ingestLocalMediaArtifacts({
      sourceUrl: args.url,
      providerName: "tiktok",
      title: args.title,
    });

    if (!artifacts || artifacts.transcript.length === 0 || artifacts.transcriptText.trim().length === 0) {
      const nextMetadata = {
        ...metadata,
        transcriptStatus: "empty",
        transcriptAttemptedAt: attemptedAt,
      };

      await db
        .update(boardFeedItems)
        .set({
          metadataJson: nextMetadata,
          ingestedAt: new Date(),
        })
        .where(eq(boardFeedItems.id, args.feedItemId));

      return {
        status: "empty" as const,
        storyIds: [] as string[],
      };
    }

    const transcriptSummary = await summarizeShortVideoTranscript({
      videoTitle: args.title,
      existingDescription:
        (typeof metadata.videoDescription === "string" && metadata.videoDescription.trim().length > 0
          ? metadata.videoDescription
          : args.summary) ?? null,
      transcript: artifacts.transcript,
    });
    const baseline =
      artifacts.creatorHandle || typeof metadata.creatorHandle === "string"
        ? await getBoardTikTokCreatorEngagementBaseline(
            (artifacts.creatorHandle ??
              (typeof metadata.creatorHandle === "string" ? metadata.creatorHandle : "")) as string
          )
        : null;
    const nextMetadataBase: Record<string, unknown> = {
      ...metadata,
      creatorHandle:
        artifacts.creatorHandle ??
        (typeof metadata.creatorHandle === "string" ? metadata.creatorHandle : null),
      channelOrContributor:
        artifacts.channelOrContributor ??
        (typeof metadata.channelOrContributor === "string"
          ? metadata.channelOrContributor
          : null),
      viewCount: artifacts.viewCount ?? metadata.viewCount ?? null,
      likeCount: artifacts.likeCount ?? metadata.likeCount ?? null,
      commentCount: artifacts.commentCount ?? metadata.commentCount ?? null,
      shareCount: artifacts.shareCount ?? metadata.shareCount ?? metadata.retweetCount ?? null,
      retweetCount: artifacts.shareCount ?? metadata.retweetCount ?? metadata.shareCount ?? null,
      thumbnailUrl: artifacts.previewUrl ?? metadata.thumbnailUrl ?? null,
      publishedAt: artifacts.publishedAt ?? metadata.publishedAt ?? args.publishedAt?.toISOString() ?? null,
      videoDescription:
        (typeof metadata.videoDescription === "string" && metadata.videoDescription.trim().length > 0
          ? metadata.videoDescription.trim()
          : artifacts.description?.trim()) ||
        transcriptSummary.summary,
      transcriptStatus: "success",
      transcriptAttemptedAt: attemptedAt,
      transcriptEnrichedAt: attemptedAt,
      transcriptSummary: transcriptSummary.summary.slice(0, BOARD_TIKTOK_TRANSCRIPT_SUMMARY_MAX_CHARS),
      transcriptSummaryModel: transcriptSummary.model,
      transcriptTextExcerpt: artifacts.transcriptText
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, BOARD_TIKTOK_TRANSCRIPT_EXCERPT_MAX_CHARS),
      transcriptSegmentCount: artifacts.transcript.length,
      transcriptClipId: artifacts.clipId,
      transcriptSourceUrl: artifacts.sourceUrl,
      transcriptPageUrl: artifacts.pageUrl,
    };
    const nextMetadata = {
      ...nextMetadataBase,
      ...(computeBoardTikTokEngagementOutlierMetadata({
        metadataJson: nextMetadataBase,
        baseline,
      }) ?? {}),
    };
    const matchingRows = await db
      .select({
        id: boardFeedItems.id,
        metadataJson: boardFeedItems.metadataJson,
      })
      .from(boardFeedItems)
      .innerJoin(boardSources, eq(boardSources.id, boardFeedItems.sourceId))
      .where(
        and(
          inArray(boardSources.kind, ["tiktok_query", "tiktok_fyp_profile"]),
          eq(boardFeedItems.url, args.url)
        )
      );

    for (const row of matchingRows) {
      const rowMetadata = coerceObject(row.metadataJson) ?? {};
      const rowNextMetadataBase: Record<string, unknown> = {
        ...rowMetadata,
        creatorHandle:
          artifacts.creatorHandle ??
          (typeof rowMetadata.creatorHandle === "string" ? rowMetadata.creatorHandle : null),
        channelOrContributor:
          artifacts.channelOrContributor ??
          (typeof rowMetadata.channelOrContributor === "string"
            ? rowMetadata.channelOrContributor
            : null),
        viewCount: rowMetadata.viewCount ?? artifacts.viewCount ?? null,
        likeCount: rowMetadata.likeCount ?? artifacts.likeCount ?? null,
        commentCount: rowMetadata.commentCount ?? artifacts.commentCount ?? null,
        shareCount: rowMetadata.shareCount ?? rowMetadata.retweetCount ?? artifacts.shareCount ?? null,
        retweetCount:
          rowMetadata.retweetCount ?? rowMetadata.shareCount ?? artifacts.shareCount ?? null,
        thumbnailUrl: rowMetadata.thumbnailUrl ?? artifacts.previewUrl ?? null,
        publishedAt:
          rowMetadata.publishedAt ??
          artifacts.publishedAt ??
          args.publishedAt?.toISOString() ??
          null,
        videoDescription:
          (typeof rowMetadata.videoDescription === "string" &&
          rowMetadata.videoDescription.trim().length > 0
            ? rowMetadata.videoDescription.trim()
            : artifacts.description?.trim()) || transcriptSummary.summary,
        transcriptStatus: "success",
        transcriptAttemptedAt: attemptedAt,
        transcriptEnrichedAt: attemptedAt,
        transcriptSummary: transcriptSummary.summary.slice(0, BOARD_TIKTOK_TRANSCRIPT_SUMMARY_MAX_CHARS),
        transcriptSummaryModel: transcriptSummary.model,
        transcriptTextExcerpt: artifacts.transcriptText
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, BOARD_TIKTOK_TRANSCRIPT_EXCERPT_MAX_CHARS),
        transcriptSegmentCount: artifacts.transcript.length,
        transcriptClipId: artifacts.clipId,
        transcriptSourceUrl: artifacts.sourceUrl,
        transcriptPageUrl: artifacts.pageUrl,
      };
      const rowNextMetadata = {
        ...rowNextMetadataBase,
        ...(computeBoardTikTokEngagementOutlierMetadata({
          metadataJson: rowNextMetadataBase,
          baseline,
        }) ?? {}),
      };

      await db
        .update(boardFeedItems)
        .set({
          metadataJson: rowNextMetadata,
          ingestedAt: new Date(),
        })
        .where(eq(boardFeedItems.id, row.id));
    }

    const storyRows = await db
      .select({ storyId: boardStorySources.storyId })
      .from(boardStorySources)
      .innerJoin(boardFeedItems, eq(boardFeedItems.id, boardStorySources.feedItemId))
      .where(eq(boardFeedItems.url, args.url));

    return {
      status: "success" as const,
      storyIds: Array.from(new Set(storyRows.map((row) => row.storyId))),
    };
  } catch (error) {
    const nextMetadata = {
      ...metadata,
      transcriptStatus: "failed",
      transcriptAttemptedAt: attemptedAt,
      transcriptError:
        error instanceof Error
          ? error.message.slice(0, 300)
          : "Unknown TikTok transcript enrichment failure",
    };

    await db
      .update(boardFeedItems)
      .set({
        metadataJson: nextMetadata,
        ingestedAt: new Date(),
      })
      .where(eq(boardFeedItems.id, args.feedItemId));

    return {
      status: "failed" as const,
      storyIds: [] as string[],
    };
  }
}

export async function runBoardTikTokTranscriptEnrichmentCycle(options?: {
  maxItems?: number;
}) {
  await ensureBoardSeedData();

  const db = getDb();
  const env = getEnv();
  const limit = Math.max(
    1,
    Math.min(options?.maxItems ?? env.BOARD_TIKTOK_TRANSCRIPT_ENRICHMENT_LIMIT, 12)
  );
  const rows = await db
    .select({
      id: boardFeedItems.id,
      title: boardFeedItems.title,
      url: boardFeedItems.url,
      summary: boardFeedItems.summary,
      publishedAt: boardFeedItems.publishedAt,
      metadataJson: boardFeedItems.metadataJson,
    })
    .from(boardFeedItems)
    .innerJoin(boardSources, eq(boardSources.id, boardFeedItems.sourceId))
    .where(
      and(
        inArray(boardSources.kind, ["tiktok_query", "tiktok_fyp_profile"]),
        gte(
          boardFeedItems.ingestedAt,
          new Date(Date.now() - env.BOARD_TIKTOK_TRANSCRIPT_LOOKBACK_HOURS * 60 * 60 * 1000)
        )
      )
    )
    .orderBy(desc(boardFeedItems.publishedAt), desc(boardFeedItems.ingestedAt))
    .limit(Math.max(limit * 60, 200));

  const storyScoreRows =
    rows.length > 0
      ? await db
          .select({
            feedItemId: boardStorySources.feedItemId,
            scoreJson: boardStoryCandidates.scoreJson,
          })
          .from(boardStorySources)
          .innerJoin(boardStoryCandidates, eq(boardStoryCandidates.id, boardStorySources.storyId))
          .where(inArray(boardStorySources.feedItemId, rows.map((row) => row.id)))
      : [];
  const storyScoreByFeedItemId = new Map<string, number>();
  for (const row of storyScoreRows) {
    const scoreJson = coerceObject(row.scoreJson);
    const visibility =
      typeof scoreJson?.boardVisibilityScore === "number"
        ? scoreJson.boardVisibilityScore
        : Number(scoreJson?.boardVisibilityScore) || 0;
    if (visibility > (storyScoreByFeedItemId.get(row.feedItemId) ?? 0)) {
      storyScoreByFeedItemId.set(row.feedItemId, visibility);
    }
  }

  const candidates = rows
    .map((row) => ({
      ...row,
      metadataJson: coerceObject(row.metadataJson),
      storyScore: storyScoreByFeedItemId.get(row.id) ?? 0,
    }))
    .filter((row) =>
      shouldEnrichBoardTikTokTranscript({
        metadataJson: row.metadataJson,
        publishedAt: row.publishedAt,
        minViews: env.BOARD_TIKTOK_TRANSCRIPT_MIN_VIEWS,
        storyScore: row.storyScore,
      })
    )
    .sort((left, right) => {
      const priorityDiff =
        getBoardTikTokTranscriptPriority({
          publishedAt: right.publishedAt,
          metadataJson: right.metadataJson,
          storyScore: right.storyScore,
        }) -
        getBoardTikTokTranscriptPriority({
          publishedAt: left.publishedAt,
          metadataJson: left.metadataJson,
          storyScore: left.storyScore,
        });
      if (priorityDiff !== 0) {
        return priorityDiff;
      }

      return (right.publishedAt?.getTime() ?? 0) - (left.publishedAt?.getTime() ?? 0);
    })
    .filter((row, index, array) => array.findIndex((candidate) => candidate.url === row.url) === index)
    .slice(0, limit);

  const affectedStoryIds = new Set<string>();
  let enrichedCount = 0;
  let emptyCount = 0;
  let failedCount = 0;

  for (const candidate of candidates) {
    const result = await enrichBoardTikTokTranscriptForFeedItem({
      feedItemId: candidate.id,
      title: candidate.title,
      url: candidate.url,
      summary: candidate.summary,
      publishedAt: candidate.publishedAt,
      metadataJson: candidate.metadataJson,
    });

    if (result.status === "success") {
      enrichedCount += 1;
      for (const storyId of result.storyIds) {
        affectedStoryIds.add(storyId);
      }
    } else if (result.status === "empty") {
      emptyCount += 1;
    } else {
      failedCount += 1;
    }

    const gc = (globalThis as typeof globalThis & { gc?: () => void }).gc;
    if (typeof gc === "function") {
      gc();
    }
  }

  let rescoredStories = 0;
  if (affectedStoryIds.size > 0) {
    const rescoring = await rescoreBoardStories(Array.from(affectedStoryIds), {
      maxStories: affectedStoryIds.size,
    });
    rescoredStories = rescoring.rescoredStories;
  }

  return {
    candidatesConsidered: rows.length,
    candidatesSelected: candidates.length,
    enrichedCount,
    emptyCount,
    failedCount,
    rescoredStories,
  };
}

function extractBoardEntityKeys(title: string, summary: string | null) {
  const counts = new Map<string, number>();
  const tokens = tokenizeBoardScoringText(`${title} ${summary ?? ""}`);

  for (const token of tokens) {
    if (token.length < 4 || BOARD_ENTITY_STOPWORDS.has(token)) {
      continue;
    }

    counts.set(token, (counts.get(token) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .sort((left, right) => {
      if (right[1] !== left[1]) {
        return right[1] - left[1];
      }

      if (right[0].length !== left[0].length) {
        return right[0].length - left[0].length;
      }

      return left[0].localeCompare(right[0]);
    })
    .slice(0, 8)
    .map(([token]) => token);
}

function computeBoardFeedItemSignals(args: {
  title: string;
  summary: string | null;
  metadataJson: Record<string, unknown> | null;
}) {
  const text = `${args.title} ${args.summary ?? ""}`.trim();
  const normalized = text.toLowerCase();
  const positiveHits = BOARD_POSITIVE_SENTIMENT_TERMS.reduce(
    (count, term) => count + (normalized.includes(term) ? 1 : 0),
    0
  );
  const negativeHits = BOARD_NEGATIVE_SENTIMENT_TERMS.reduce(
    (count, term) => count + (normalized.includes(term) ? 1 : 0),
    0
  );
  const baseControversy = computeBoardControversyScore(args.title, args.summary);
  const viewCount = coerceBoardMetricCount(args.metadataJson?.viewCount);
  const likeCount = coerceBoardMetricCount(args.metadataJson?.likeCount);
  const retweetCount = coerceBoardMetricCount(args.metadataJson?.retweetCount);

  const engagementBonus =
    (viewCount >= 1_000_000 ? 8 : viewCount >= 250_000 ? 5 : viewCount >= 50_000 ? 2 : 0) +
    (likeCount >= 20_000 ? 4 : likeCount >= 5_000 ? 2 : 0) +
    (retweetCount >= 2_500 ? 4 : retweetCount >= 500 ? 2 : 0);

  const controversyScore = clampBoardScore(baseControversy + engagementBonus);
  const sentimentMagnitude = positiveHits + negativeHits;
  const sentimentScore =
    sentimentMagnitude > 0
      ? Math.max(
          -1,
          Math.min(1, (positiveHits - negativeHits) / (sentimentMagnitude + 1))
        )
      : controversyScore >= 75
        ? -0.28
        : controversyScore >= 55
          ? -0.14
          : 0;

  return {
    sentimentScore: Number(sentimentScore.toFixed(2)),
    controversyScore,
    entityKeys: extractBoardEntityKeys(args.title, args.summary),
  };
}

function computeBoardSentimentScore(storyType: BoardStoryType, controversyScore: number): number {
  if (storyType === "correction") {
    return -0.35;
  }

  if (storyType === "controversy") {
    return -Math.min(0.9, controversyScore / 100);
  }

  if (storyType === "trending") {
    return -0.18;
  }

  return -0.08;
}

function buildBoardStoryFormats(surgeScore: number, controversyScore: number): string[] {
  if (surgeScore >= 75 || controversyScore >= 75) {
    return ["Full Video", "Short"];
  }

  return ["Full Video"];
}

function buildBoardStorySlug(title: string, uniqueHint: string): string {
  const base = slugify(title).slice(0, 72) || "story";
  const suffix = createHash("sha1").update(uniqueHint).digest("hex").slice(0, 6);
  return `${base}-${suffix}`;
}

function buildBoardStoryMatchRecord(
  row: Pick<
    typeof boardStoryCandidates.$inferSelect,
    | "id"
    | "slug"
    | "canonicalTitle"
    | "vertical"
    | "storyType"
    | "firstSeenAt"
    | "lastSeenAt"
    | "itemsCount"
    | "sourcesCount"
    | "metadataJson"
  >
): BoardStoryMatchRecord {
  const metadataJson = coerceObject(row.metadataJson);
  const entityKeys = coerceStringArray(metadataJson?.entityKeys);

  return {
    id: row.id,
    slug: row.slug,
    canonicalTitle: row.canonicalTitle,
    vertical: row.vertical,
    storyType: row.storyType,
    firstSeenAt: coerceDate(row.firstSeenAt),
    lastSeenAt: coerceDate(row.lastSeenAt),
    itemsCount: row.itemsCount,
    sourcesCount: row.sourcesCount,
    tokens: tokenizeBoardTitle(row.canonicalTitle),
    entityKeys:
      entityKeys.length > 0
        ? entityKeys
        : extractBoardEntityKeys(row.canonicalTitle, null),
    eventKeys: extractBoardEventKeys(row.canonicalTitle, null),
  };
}

function rankMatchingBoardStories(
  stories: BoardStoryMatchRecord[],
  item: BoardSourceFeedItem,
  config: Pick<BoardSourceConfig, "vertical"> & {
    signalOnly?: boolean;
  }
): RankedBoardStoryMatchRecord[] {
  const itemTokens = tokenizeBoardTitle(`${item.title} ${item.summary ?? ""}`);
  const itemTitleTokens = tokenizeBoardTitle(item.title);
  const normalizedItemTitle = normalizeBoardMatchTitle(item.title);
  const itemEntityKeys = extractBoardEntityKeys(item.title, item.summary);
  const itemEventKeys = extractBoardEventKeys(item.title, item.summary);
  const itemNonEntityTokens = itemTokens.filter((token) => !itemEntityKeys.includes(token));
  if (itemTokens.length === 0) {
    return [];
  }

  const itemPublishedAt = item.publishedAt;
  const rankedMatches: RankedBoardStoryMatchRecord[] = [];

  for (const story of stories) {
    if (
      itemPublishedAt &&
      story.lastSeenAt &&
      Math.abs(itemPublishedAt.getTime() - story.lastSeenAt.getTime()) >
        BOARD_STORY_MATCH_LOOKBACK_DAYS * 24 * 60 * 60 * 1000
    ) {
      continue;
    }

    let score = Math.max(
      computeFlexibleTokenOverlap(itemTokens, story.tokens),
      computeFlexibleTokenOverlap(itemTitleTokens, story.tokens)
    );
    const entityOverlap = countTokenOverlap(itemEntityKeys, story.entityKeys);
    const eventOverlap = countTokenOverlap(itemEventKeys, story.eventKeys);
    const storyNonEntityTokens = story.tokens.filter(
      (token) => !story.entityKeys.includes(token)
    );
    const nonEntityOverlap = countTokenOverlap(itemNonEntityTokens, storyNonEntityTokens);
    const normalizedStoryTitle = normalizeBoardMatchTitle(story.canonicalTitle);
    let exactTitleMatch = false;

    if (
      normalizedItemTitle.length > 0 &&
      normalizedStoryTitle.length > 0 &&
      normalizedItemTitle === normalizedStoryTitle
    ) {
      exactTitleMatch = true;
      score = Math.max(score, 0.98);
    }

    if (
      story.canonicalTitle.toLowerCase().includes(item.title.toLowerCase()) ||
      item.title.toLowerCase().includes(story.canonicalTitle.toLowerCase())
    ) {
      score = Math.max(score, 0.82);
    }

    if (entityOverlap >= 3 && nonEntityOverlap >= 1) {
      score = Math.max(score, 0.9);
    } else if (
      entityOverlap >= 2 &&
      nonEntityOverlap >= 1 &&
      (computeFlexibleTokenOverlap(itemTitleTokens, story.tokens) >= 0.34 ||
        computeFlexibleTokenOverlap(itemTokens, story.tokens) >= 0.4)
    ) {
      score = Math.max(score, 0.78);
    }

    if (
      entityOverlap >= 1 &&
      eventOverlap >= 1 &&
      (nonEntityOverlap >= 1 || score >= 0.18)
    ) {
      score = Math.max(score, eventOverlap >= 2 ? 0.8 : 0.68);
    }

    if (config.vertical && story.vertical === config.vertical) {
      score += 0.05;
    }

    if (score > 0) {
      rankedMatches.push({
        ...story,
        heuristicScore: score,
        exactTitleMatch,
      });
    }
  }

  return rankedMatches.sort((left, right) => {
    if (right.heuristicScore !== left.heuristicScore) {
      return right.heuristicScore - left.heuristicScore;
    }

    if (right.sourcesCount !== left.sourcesCount) {
      return right.sourcesCount - left.sourcesCount;
    }

    if (right.itemsCount !== left.itemsCount) {
      return right.itemsCount - left.itemsCount;
    }

    return right.canonicalTitle.localeCompare(left.canonicalTitle);
  });
}

async function findMatchingBoardStory(
  stories: BoardStoryMatchRecord[],
  item: BoardSourceFeedItem,
  config: Pick<BoardSourceConfig, "vertical"> & {
    signalOnly?: boolean;
  }
): Promise<BoardStoryMatchRecord | null> {
  const env = getEnv();
  const rankedMatches = rankMatchingBoardStories(stories, item, config);
  const bestMatch = rankedMatches[0] ?? null;
  const secondBestMatch = rankedMatches[1] ?? null;
  const heuristicThreshold = config.signalOnly ? 0.78 : 0.62;

  if (
    bestMatch &&
    bestMatch.heuristicScore >= heuristicThreshold &&
    (bestMatch.exactTitleMatch ||
      bestMatch.heuristicScore >= 0.92 ||
      !secondBestMatch ||
      bestMatch.heuristicScore - secondBestMatch.heuristicScore >=
        BOARD_HEURISTIC_MATCH_CLEAR_MARGIN)
  ) {
    return bestMatch;
  }

  if (
    env.ENABLE_AI_STORY_DEDUP &&
    env.OPENAI_API_KEY &&
    rankedMatches.length > 0
  ) {
    const aiCandidates = rankedMatches
      .filter((candidate) => candidate.heuristicScore >= BOARD_AI_STORY_DEDUP_MIN_HEURISTIC_SCORE)
      .slice(0, BOARD_AI_STORY_DEDUP_SHORTLIST_LIMIT);

    if (aiCandidates.length > 0) {
      try {
        const aiDecision = await chooseMatchingBoardStory({
          item: {
            title: item.title,
            summary: item.summary,
            publishedAt: item.publishedAt?.toISOString() ?? null,
            url: item.url,
          },
          candidates: aiCandidates.map((candidate) => ({
            id: candidate.id,
            canonicalTitle: candidate.canonicalTitle,
            vertical: candidate.vertical,
            storyType: candidate.storyType,
            firstSeenAt: candidate.firstSeenAt?.toISOString() ?? null,
            lastSeenAt: candidate.lastSeenAt?.toISOString() ?? null,
            itemsCount: candidate.itemsCount,
            sourcesCount: candidate.sourcesCount,
            heuristicScore: candidate.heuristicScore,
          })),
        });
        if (
          aiDecision.sameStory &&
          aiDecision.matchStoryId &&
          aiDecision.confidence >= BOARD_AI_STORY_DEDUP_MIN_CONFIDENCE
        ) {
          const matchedCandidate =
            aiCandidates.find((candidate) => candidate.id === aiDecision.matchStoryId) ?? null;
          if (matchedCandidate) {
            return matchedCandidate;
          }
        }
      } catch (error) {
        console.error("[board] AI story dedup matching failed", error);
      }
    }
  }

  return bestMatch && bestMatch.heuristicScore >= heuristicThreshold ? bestMatch : null;
}

function buildBoardStoryMatchRecordFromSummary(story: BoardStorySummary): BoardStoryMatchRecord {
  const scoreJson = coerceObject(story.scoreJson);
  const metadataJson = coerceObject(story.metadataJson);
  const entityKeys = mergeUniqueStrings([
    ...coerceStringArray(scoreJson?.entityKeys),
    ...coerceStringArray(metadataJson?.entityKeys),
  ]);

  return {
    id: story.id,
    slug: story.slug,
    canonicalTitle: story.canonicalTitle,
    vertical: story.vertical,
    storyType: story.storyType,
    firstSeenAt: coerceDate(story.firstSeenAt),
    lastSeenAt: coerceDate(story.lastSeenAt),
    itemsCount: story.itemsCount,
    sourcesCount: story.sourcesCount,
    tokens: tokenizeBoardTitle(story.canonicalTitle),
    entityKeys: entityKeys.length > 0 ? entityKeys : tokenizeBoardTitle(story.canonicalTitle),
    eventKeys: extractBoardEventKeys(
      story.canonicalTitle,
      story.sourcePreviews.find((preview) => preview.summary && preview.summary.trim().length > 0)
        ?.summary ?? null
    ),
  };
}

function buildBoardStoryFeedItemForMatching(story: BoardStorySummary): BoardSourceFeedItem {
  const primaryPreview = story.sourcePreviews[0] ?? null;
  const summary =
    story.sourcePreviews.find((preview) => preview.summary && preview.summary.trim().length > 0)
      ?.summary ?? null;

  return {
    externalId: story.id,
    title: story.canonicalTitle,
    url: primaryPreview?.url ?? `story:${story.id}`,
    author: primaryPreview?.name ?? null,
    publishedAt: coerceDate(story.lastSeenAt) ?? coerceDate(story.firstSeenAt),
    summary,
    contentHash: story.id,
    metadataJson: null,
  };
}

async function dedupeDiscordBoardCandidates(candidates: BoardStorySummary[]) {
  const deduped: BoardStorySummary[] = [];

  for (const story of candidates) {
    if (deduped.length === 0) {
      deduped.push(story);
      continue;
    }

    const matchedStory = await findMatchingBoardStory(
      deduped.map((candidate) => buildBoardStoryMatchRecordFromSummary(candidate)),
      buildBoardStoryFeedItemForMatching(story),
      {
        vertical: story.vertical ?? undefined,
        signalOnly: false,
      }
    );

    if (!matchedStory) {
      deduped.push(story);
    }
  }

  return deduped;
}

async function findExistingStoryForFeedItem(feedItemId: string) {
  const db = getDb();
  const [row] = await db
    .select({
      id: boardStoryCandidates.id,
      slug: boardStoryCandidates.slug,
      canonicalTitle: boardStoryCandidates.canonicalTitle,
      vertical: boardStoryCandidates.vertical,
      storyType: boardStoryCandidates.storyType,
      firstSeenAt: boardStoryCandidates.firstSeenAt,
      lastSeenAt: boardStoryCandidates.lastSeenAt,
      itemsCount: boardStoryCandidates.itemsCount,
      sourcesCount: boardStoryCandidates.sourcesCount,
      metadataJson: boardStoryCandidates.metadataJson,
    })
    .from(boardStorySources)
    .innerJoin(
      boardStoryCandidates,
      eq(boardStoryCandidates.id, boardStorySources.storyId)
    )
    .where(eq(boardStorySources.feedItemId, feedItemId))
    .orderBy(
      desc(boardStoryCandidates.sourcesCount),
      desc(boardStoryCandidates.itemsCount),
      desc(boardStoryCandidates.lastSeenAt),
      asc(boardStoryCandidates.createdAt)
    )
    .limit(1);

  return row ? buildBoardStoryMatchRecord(row) : null;
}

function looksLikeUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}

async function resolveStoryRecord(storyIdOrSlug: string) {
  const db = getDb();
  const predicate = looksLikeUuid(storyIdOrSlug)
    ? eq(boardStoryCandidates.id, storyIdOrSlug)
    : eq(boardStoryCandidates.slug, storyIdOrSlug);

  const [story] = await db
    .select()
    .from(boardStoryCandidates)
    .where(predicate)
    .limit(1);

  return story ?? null;
}

async function ensureBoardFeedItemVersionsBackfill() {
  const db = getDb();

  // Fast DB-side check first — avoid loading any rows into JS if nothing is missing
  const [countRow] = await db
    .select({ missing: sql<number>`count(*)::int` })
    .from(boardFeedItems)
    .where(
      sql`not exists (select 1 from ${boardFeedItemVersions} where ${boardFeedItemVersions.feedItemId} = ${boardFeedItems.id})`
    );

  const missing = countRow?.missing ?? 0;
  if (missing === 0) {
    return { inserted: 0 };
  }

  // Process in small batches to avoid large memory spikes
  const BATCH_SIZE = 200;
  let inserted = 0;

  while (true) {
    const batch = await db
      .select({
        id: boardFeedItems.id,
        contentHash: boardFeedItems.contentHash,
        title: boardFeedItems.title,
        summary: boardFeedItems.summary,
        url: boardFeedItems.url,
        ingestedAt: boardFeedItems.ingestedAt,
      })
      .from(boardFeedItems)
      .where(
        sql`not exists (select 1 from ${boardFeedItemVersions} where ${boardFeedItemVersions.feedItemId} = ${boardFeedItems.id})`
      )
      .limit(BATCH_SIZE);

    if (batch.length === 0) break;

    await db
      .insert(boardFeedItemVersions)
      .values(
        batch.map((item) => ({
          feedItemId: item.id,
          contentHash: item.contentHash,
          title: item.title,
          content: buildBoardFeedItemContent({
            title: item.title,
            summary: item.summary,
            url: item.url,
          }),
          diffSummary: "initial capture",
          isCorrection: inferBoardCorrectionSignal({
            title: item.title,
            summary: item.summary,
            diffSummary: null,
          }),
          versionNumber: 1,
          capturedAt: item.ingestedAt,
        }))
      )
      .onConflictDoNothing({
        target: [
          boardFeedItemVersions.feedItemId,
          boardFeedItemVersions.versionNumber,
        ],
      });

    inserted += batch.length;
  }

  return { inserted };
}

async function syncBoardStoryCorrectionFlags(storyIds?: string[]) {
  const db = getDb();
  // Without explicit storyIds, only sync recently-active stories to avoid full-table scans
  const storyWhere = storyIds?.length
    ? inArray(boardStoryCandidates.id, Array.from(new Set(storyIds)))
    : gte(boardStoryCandidates.lastSeenAt, new Date(Date.now() - 48 * 60 * 60 * 1000));

  const storyRows = await db
    .select({
      id: boardStoryCandidates.id,
      storyType: boardStoryCandidates.storyType,
      metadataJson: boardStoryCandidates.metadataJson,
    })
    .from(boardStoryCandidates)
    .where(storyWhere);

  if (storyRows.length === 0) {
    return { updated: 0 };
  }

  const correctionRows = await db
    .select({
      storyId: boardStorySources.storyId,
      capturedAt: boardFeedItemVersions.capturedAt,
      isCorrection: boardFeedItemVersions.isCorrection,
    })
    .from(boardStorySources)
    .innerJoin(
      boardFeedItemVersions,
      eq(boardFeedItemVersions.feedItemId, boardStorySources.feedItemId)
    )
    .where(
      and(
        storyIds?.length ? inArray(boardStorySources.storyId, storyIds) : sql`true`,
        eq(boardFeedItemVersions.isCorrection, true)
      )
    )
    .orderBy(desc(boardFeedItemVersions.capturedAt));

  const correctionStateByStory = new Map<
    string,
    { correctionCount: number; latestCorrectionAt: Date | null }
  >();

  for (const row of correctionRows) {
    const existing = correctionStateByStory.get(row.storyId) ?? {
      correctionCount: 0,
      latestCorrectionAt: null,
    };
    existing.correctionCount += 1;
    const capturedAt = coerceDate(row.capturedAt);
    if (
      capturedAt &&
      (!existing.latestCorrectionAt || capturedAt > existing.latestCorrectionAt)
    ) {
      existing.latestCorrectionAt = capturedAt;
    }
    correctionStateByStory.set(row.storyId, existing);
  }

  // Process updates in serial batches to avoid flooding the DB connection pool
  const BATCH_SIZE = 50;
  for (let i = 0; i < storyRows.length; i += BATCH_SIZE) {
    const batch = storyRows.slice(i, i + BATCH_SIZE);
    await Promise.all(
      batch.map((story) => {
        const correctionState = correctionStateByStory.get(story.id);
        const metadataJson = {
          ...(coerceObject(story.metadataJson) ?? {}),
          correctionCount: correctionState?.correctionCount ?? 0,
          latestCorrectionAt: toIsoString(correctionState?.latestCorrectionAt ?? null),
        };

        return db
          .update(boardStoryCandidates)
          .set({
            correction:
              Boolean(correctionState && correctionState.correctionCount > 0) ||
              story.storyType === "correction",
            metadataJson,
            updatedAt: new Date(),
          })
          .where(eq(boardStoryCandidates.id, story.id));
      })
    );
  }

  return { updated: storyRows.length };
}

async function getSourcePreviewsForStories(storyIds: string[], options: { skipVersions?: boolean } = {}) {
  if (storyIds.length === 0) {
    return new Map<string, BoardStorySourcePreview[]>();
  }

  const db = getDb();
  const rows = await db
    .select({
      storyId: boardStorySources.storyId,
      feedItemId: boardStorySources.feedItemId,
      sourceId: boardSources.id,
      sourceName: boardSources.name,
      sourceKind: boardSources.kind,
      sourceProvider: boardSources.provider,
      sourceConfigJson: boardSources.configJson,
      title: boardFeedItems.title,
      url: boardFeedItems.url,
      summary: boardFeedItems.summary,
      publishedAt: boardFeedItems.publishedAt,
      metadataJson: boardFeedItems.metadataJson,
      sourceWeight: boardStorySources.sourceWeight,
      isPrimary: boardStorySources.isPrimary,
      evidenceJson: boardStorySources.evidenceJson,
    })
    .from(boardStorySources)
    .innerJoin(boardFeedItems, eq(boardFeedItems.id, boardStorySources.feedItemId))
    .innerJoin(boardSources, eq(boardSources.id, boardFeedItems.sourceId))
    .where(inArray(boardStorySources.storyId, storyIds))
    .orderBy(
      desc(boardStorySources.sourceWeight),
      desc(boardFeedItems.publishedAt),
      asc(boardSources.name)
    );

  const feedItemIds = Array.from(new Set(rows.map((row) => row.feedItemId)));
  // Skip loading 57K version rows when caller only needs the list view
  const versionRows =
    !options.skipVersions && feedItemIds.length > 0
      ? await db
          .select({
            feedItemId: boardFeedItemVersions.feedItemId,
            versionNumber: boardFeedItemVersions.versionNumber,
            diffSummary: boardFeedItemVersions.diffSummary,
            capturedAt: boardFeedItemVersions.capturedAt,
            isCorrection: boardFeedItemVersions.isCorrection,
          })
          .from(boardFeedItemVersions)
          .where(inArray(boardFeedItemVersions.feedItemId, feedItemIds))
          .orderBy(
            desc(boardFeedItemVersions.versionNumber),
            desc(boardFeedItemVersions.capturedAt)
          )
      : [];

  const versionSummaryByFeedItemId = new Map<
    string,
    {
      versionCount: number;
      latestVersionNumber: number;
      latestDiffSummary: string | null;
      latestCapturedAt: string | null;
      hasCorrection: boolean;
    }
  >();

  for (const row of versionRows) {
    const existing = versionSummaryByFeedItemId.get(row.feedItemId);
    if (!existing) {
      versionSummaryByFeedItemId.set(row.feedItemId, {
        versionCount: 1,
        latestVersionNumber: row.versionNumber,
        latestDiffSummary: row.diffSummary,
        latestCapturedAt: toIsoString(row.capturedAt),
        hasCorrection: row.isCorrection,
      });
      continue;
    }

    existing.versionCount += 1;
    existing.hasCorrection = existing.hasCorrection || row.isCorrection;
  }

  const previews = new Map<string, BoardStorySourcePreview[]>();

  for (const row of rows) {
    const versionSummary = versionSummaryByFeedItemId.get(row.feedItemId);
    const metadata = coerceObject(row.metadataJson);
    const tweetId =
      typeof metadata?.tweetId === "string"
        ? (metadata.tweetId as string)
        : extractTweetIdFromUrl(row.url);
    const transcriptSummary =
      typeof metadata?.transcriptSummary === "string" &&
      metadata.transcriptSummary.trim().length > 0
        ? metadata.transcriptSummary.trim()
        : null;
    const hasVideo =
      metadata?.hasVideo === true ||
      Boolean(transcriptSummary) ||
      (typeof metadata?.videoDescription === "string" &&
        metadata.videoDescription.trim().length > 0);
    const viewOutlierRatio = coercePositiveNumber(metadata?.viewOutlierRatio);
    const likeOutlierRatio = coercePositiveNumber(metadata?.likeOutlierRatio);
    const repostOutlierRatio = coercePositiveNumber(metadata?.retweetOutlierRatio);
    const maxOutlierRatio = Math.max(
      coercePositiveNumber(metadata?.maxOutlierRatio) ?? 0,
      viewOutlierRatio ?? 0,
      likeOutlierRatio ?? 0,
      repostOutlierRatio ?? 0,
    );
    const preview: BoardStorySourcePreview = {
      id: row.sourceId,
      feedItemId: row.feedItemId,
      name: row.sourceName,
      kind: row.sourceKind,
      provider: row.sourceProvider,
      signalOnly: sourceConfigIsSignalOnly(
        row.sourceConfigJson,
        row.sourceKind,
        row.sourceName
      ),
      title: row.title,
      url: row.url,
      publishedAt: toIsoString(row.publishedAt),
      sourceWeight: row.sourceWeight,
      isPrimary: row.isPrimary,
      sourceType:
        coerceObject(row.evidenceJson)?.sourceType &&
        typeof coerceObject(row.evidenceJson)?.sourceType === "string"
          ? (coerceObject(row.evidenceJson)?.sourceType as string)
          : null,
      versionCount: versionSummary?.versionCount ?? 0,
      latestVersionNumber: versionSummary?.latestVersionNumber ?? 0,
      latestDiffSummary: versionSummary?.latestDiffSummary ?? null,
      latestCapturedAt: versionSummary?.latestCapturedAt ?? null,
      hasCorrection: versionSummary?.hasCorrection ?? false,
      summary: transcriptSummary ?? row.summary ?? null,
      hasVideo,
      videoDescription:
        transcriptSummary ??
        (typeof metadata?.videoDescription === "string"
          ? (metadata.videoDescription as string)
          : null),
      tweetId,
      tweetUsername:
        typeof metadata?.username === "string" ? (metadata.username as string) : null,
      embedUrl:
        typeof metadata?.embedUrl === "string"
          ? (metadata.embedUrl as string)
          : buildTwitterEmbedUrl(tweetId),
      thumbnailUrl:
        typeof metadata?.thumbnailUrl === "string"
          ? (metadata.thumbnailUrl as string)
          : null,
      viewCount: coercePositiveNumber(metadata?.viewCount),
      likeCount: coercePositiveNumber(metadata?.likeCount),
      repostCount:
        coercePositiveNumber(metadata?.retweetCount) ??
        coercePositiveNumber(metadata?.shareCount),
      commentCount: coercePositiveNumber(metadata?.commentCount),
      maxOutlierRatio: maxOutlierRatio > 0 ? maxOutlierRatio : null,
    };

    const existing = previews.get(row.storyId) ?? [];
    existing.push(preview);
    previews.set(row.storyId, existing);
  }

  for (const [storyId, storyPreviews] of previews.entries()) {
    previews.set(storyId, dedupeBoardStorySourcePreviews(storyPreviews));
  }

  return previews;
}

function mapStorySummary(
  story: typeof boardStoryCandidates.$inferSelect,
  previews: BoardStorySourcePreview[],
  moonScore?: typeof moonStoryScores.$inferSelect | null
): BoardStorySummary {
  const metadataJson = coerceObject(story.metadataJson);
  const scoreJson = coerceObject(story.scoreJson);
  const hasPersistedScore =
    typeof scoreJson?.boardVisibilityScore === "number" &&
    typeof scoreJson?.lastScoredAt === "string" &&
    scoreJson.lastScoredAt.length > 0;
  const score = hasPersistedScore ? (scoreJson.boardVisibilityScore as number) : 0;
  const moonFitScore =
    moonScore?.moonFitScore ??
    (typeof scoreJson?.moonFitScore === "number" ? (scoreJson.moonFitScore as number) : 0);
  const moonFitBand =
    moonScore?.moonFitBand ??
    (typeof scoreJson?.moonFitBand === "string" ? (scoreJson.moonFitBand as string) : "low");
  const moonCluster =
    moonScore?.clusterLabel ??
    (typeof scoreJson?.moonCluster === "string" ? (scoreJson.moonCluster as string) : null);
  const coverageMode =
    moonScore?.coverageMode ??
    (typeof scoreJson?.coverageMode === "string" ? (scoreJson.coverageMode as string) : null);
  const analogTitles =
    moonScore?.analogTitlesJson && Array.isArray(moonScore.analogTitlesJson)
      ? coerceStringArray(moonScore.analogTitlesJson)
      : coerceStringArray(scoreJson?.analogTitles);
  const analogMedianViews = moonScore?.analogMedianViews ?? null;
  const analogMedianDurationMinutes = moonScore?.analogMedianDurationMinutes ?? null;
  const reasonCodes =
    moonScore?.reasonCodesJson && Array.isArray(moonScore.reasonCodesJson)
      ? coerceStringArray(moonScore.reasonCodesJson)
      : coerceStringArray(scoreJson?.reasonCodes);
  const freshnessDate = getStoryFreshnessDate({
    previews,
    fallbackLastSeenAt: coerceDate(story.lastSeenAt),
  });
  const formatRecommendation = buildBoardFormatRecommendation({
    story: {
      storyType: story.storyType,
      surgeScore: story.surgeScore,
      controversyScore: story.controversyScore,
      itemsCount: story.itemsCount,
      sourcesCount: story.sourcesCount,
      correction: story.correction,
      lastSeenAt: toIsoString(story.lastSeenAt),
      vertical: story.vertical,
    },
    sources: previews.map((preview) => ({
      kind: preview.kind,
      provider: preview.provider,
      sourceType: preview.sourceType,
      sourceWeight: preview.sourceWeight,
      isPrimary: preview.isPrimary,
    })),
    fallbackFormats: coerceStringArray(story.formatsJson),
  });

  return {
    id: story.id,
    slug: story.slug,
    canonicalTitle: decodeBoardHtmlEntities(story.canonicalTitle),
    vertical: story.vertical,
    status: story.status,
    storyType: story.storyType,
    surgeScore: story.surgeScore,
    controversyScore: story.controversyScore,
    sentimentScore: story.sentimentScore,
    itemsCount: story.itemsCount,
    sourcesCount: story.sourcesCount,
    correction: story.correction,
    formats: coerceStringArray(story.formatsJson),
    ageLabel: formatAgeLabel(freshnessDate),
    firstSeenAt: toIsoString(story.firstSeenAt),
    lastSeenAt: toIsoString(freshnessDate),
    score,
    scoreJson,
    metadataJson,
    moonFitScore,
    moonFitBand,
    moonCluster,
    coverageMode,
    analogTitles,
    analogMedianViews,
    analogMedianDurationMinutes,
    reasonCodes,
    formatRecommendation,
    sourcePreviews: previews,
  };
}

function shouldHideSignalOnlyStory(
  story: typeof boardStoryCandidates.$inferSelect,
  previews: BoardStorySourcePreview[]
) {
  if (previews.length === 0 || !previews.every((preview) => preview.signalOnly)) {
    return false;
  }

  if (!storyHasPersistedScore(story)) {
    return true;
  }

  return true;
}

function shouldHideLowSignalDefaultCommunityStory(story: BoardStorySummary) {
  if (story.sourcePreviews.length === 0) {
    return false;
  }

  if (story.sourcePreviews.every((preview) => isDefaultTrendingSourceName(preview.name))) {
    return true;
  }

  if (story.sourcePreviews.every((preview) => isDefaultRedditSourceName(preview.name))) {
    return isLowSignalDefaultRedditTitle(story.canonicalTitle);
  }

  return false;
}

function shouldHideCorrectionHeavyStory(story: BoardStorySummary) {
  const metadata = coerceObject(story.metadataJson);
  const scoreJson = coerceObject(story.scoreJson);
  const boardVisibilityScore =
    typeof scoreJson?.boardVisibilityScore === "number"
      ? (scoreJson.boardVisibilityScore as number)
      : 0;
  const hasRealNonSignalSource = story.sourcePreviews.some((preview) => !preview.signalOnly);
  const nonSignalSourceCount = new Set(
    story.sourcePreviews
      .filter((preview) => !preview.signalOnly)
      .map((preview) => `${preview.kind}:${preview.name.trim().toLowerCase()}`)
  ).size;
  const title = decodeBoardHtmlEntities(story.canonicalTitle);
  const hasOnlineCultureTopicCue =
    hasConcreteOnlineCultureCue(title) ||
    hasPlatformOrInternetEntityCue(title) ||
    hasMemeticArtifactCue(title) ||
    hasInternetReactionCultureCue(title);
  const correctionCountValue =
    typeof metadata?.correctionCount === "number"
      ? metadata.correctionCount
      : typeof metadata?.correctionCount === "string"
        ? Number(metadata.correctionCount)
        : 0;
  const correctionCount = Number.isFinite(correctionCountValue)
    ? Number(correctionCountValue)
    : 0;

  if (
    boardVisibilityScore >= 30 &&
    hasRealNonSignalSource &&
    hasInternetReactionCultureCue(title)
  ) {
    return false;
  }

  if (
    boardVisibilityScore >= 45 &&
    hasRealNonSignalSource &&
    nonSignalSourceCount >= 3 &&
    hasOnlineCultureTopicCue
  ) {
    return false;
  }

  if (
    correctionCount >= Math.max(6, nonSignalSourceCount * 3) &&
    boardVisibilityScore < 55
  ) {
    return true;
  }

  if ((story.correction || story.storyType === "correction") && boardVisibilityScore < 50) {
    return true;
  }

  return false;
}

function shouldHideGenericNonOnlineCultureStory(story: BoardStorySummary) {
  const title = decodeBoardHtmlEntities(story.canonicalTitle);
  const scoreJson = coerceObject(story.scoreJson);
  const boardVisibilityScore =
    typeof scoreJson?.boardVisibilityScore === "number"
      ? (scoreJson.boardVisibilityScore as number)
      : 0;
  const hasCreatorLedSource = story.sourcePreviews.some(
    (preview) =>
      ((preview.kind === "x_account" &&
        getEnv().ENABLE_X_SEARCH &&
        !isNewswireOrInstitutionalXSourceName(preview.name)) ||
        preview.kind === "tiktok_query" ||
        preview.kind === "tiktok_fyp_profile")
  );
  const hasOnlyMainstreamOrCommunitySources = story.sourcePreviews.every(
    (preview) =>
      preview.kind === "rss" ||
      preview.kind === "subreddit" ||
      preview.kind === "government_feed" ||
      preview.kind === "legal_watch"
  );

  if (
    hasConcreteOnlineCultureCue(title) &&
    !hasGenericCivicCue(title) &&
    !hasRoutinePoliticsFigureCue(title) &&
    !hasInstitutionalPolicyCue(title)
  ) {
    return false;
  }

  if (hasGenericCivicCue(title) && !hasPlatformOrInternetEntityCue(title)) {
    return true;
  }

  if (
    hasRoutinePoliticsFigureCue(title) &&
    !hasMemeticArtifactCue(title) &&
    !hasCreatorLedSource
  ) {
    return true;
  }

  if (hasInstitutionalPolicyCue(title) && !hasMemeticArtifactCue(title)) {
    return true;
  }

  if (boardVisibilityScore >= 30 && hasInternetReactionCultureCue(title)) {
    return false;
  }

  if (hasCreatorLedSource) {
    return false;
  }

  if (
    hasOnlyMainstreamOrCommunitySources &&
    !hasPlatformOrInternetEntityCue(title) &&
    !hasInternetReactionCultureCue(title)
  ) {
    return true;
  }

  return false;
}

function dedupeExactBoardStoryTitles(stories: BoardStorySummary[]) {
  const deduped: BoardStorySummary[] = [];
  const seenTitles = new Set<string>();

  for (const story of stories) {
    const normalizedTitle = normalizeBoardMatchTitle(story.canonicalTitle);
    if (normalizedTitle.length === 0) {
      deduped.push(story);
      continue;
    }

    if (seenTitles.has(normalizedTitle)) {
      continue;
    }

    seenTitles.add(normalizedTitle);
    deduped.push(story);
  }

  return deduped;
}

function getBoardStoryPreviewDedupScore(preview: BoardStorySourcePreview) {
  const publishedAt = Date.parse(preview.publishedAt ?? "") || 0;

  return (
    (preview.isPrimary ? 10_000_000 : 0) +
    preview.sourceWeight * 10_000 +
    (preview.hasVideo ? 250_000 : 0) +
    Math.round((preview.maxOutlierRatio ?? 0) * 10_000) +
    (preview.commentCount ?? 0) * 10 +
    (preview.repostCount ?? 0) * 5 +
    (preview.likeCount ?? 0) +
    Math.round((preview.viewCount ?? 0) / 10) +
    Math.round(publishedAt / 1000)
  );
}

function dedupeBoardStorySourcePreviews(previews: BoardStorySourcePreview[]) {
  const deduped = new Map<string, BoardStorySourcePreview>();

  for (const preview of previews) {
    const key = `${preview.id}:${preview.kind}:${preview.name}`.toLowerCase();
    const existing = deduped.get(key);

    if (!existing || getBoardStoryPreviewDedupScore(preview) > getBoardStoryPreviewDedupScore(existing)) {
      deduped.set(key, preview);
    }
  }

  return Array.from(deduped.values()).sort(
    (left, right) =>
      getBoardStoryPreviewDedupScore(right) -
      getBoardStoryPreviewDedupScore(left)
  );
}

function dedupeHeuristicBoardStories(stories: BoardStorySummary[]) {
  const deduped: BoardStorySummary[] = [];

  for (const story of stories) {
    const matchedStory = deduped.length
      ? rankMatchingBoardStories(
          deduped.map((candidate) => buildBoardStoryMatchRecordFromSummary(candidate)),
          buildBoardStoryFeedItemForMatching(story),
          {
            vertical: story.vertical ?? undefined,
            signalOnly: false,
          }
        )[0] ?? null
      : null;

    if (!matchedStory || matchedStory.heuristicScore < 0.68) {
      deduped.push(story);
    }
  }

  return deduped;
}

function passesCoreLiveBoardStoryFilters(args: {
  story: BoardStorySummary;
  sourceRow: typeof boardStoryCandidates.$inferSelect | null | undefined;
  minFreshnessDate?: Date | null;
  sort?: ListBoardStoriesInput["sort"];
}) {
  const { story, sourceRow, minFreshnessDate = null, sort } = args;
  const env = getEnv();
  const freshnessDate = coerceDate(story.lastSeenAt);
  const scoreJson = coerceObject(story.scoreJson);
  const hasPersistedScore =
    typeof scoreJson?.lastScoredAt === "string" &&
    scoreJson.lastScoredAt.length > 0;
  const hasBoardVisibilityScore =
    typeof scoreJson?.boardVisibilityScore === "number";
  const boardVisibilityScore = hasBoardVisibilityScore
    ? (scoreJson?.boardVisibilityScore as number)
    : 0;
  const allowModeratelyRatedLiveStories = sort === "live" && boardVisibilityScore >= 20;

  if (minFreshnessDate) {
    const storyOriginDate = coerceDate(story.firstSeenAt) ?? freshnessDate;
    if (!storyOriginDate || storyOriginDate < minFreshnessDate) {
      return false;
    }
  }

  if (story.sourcePreviews.some((preview) => preview.kind === "youtube_channel")) {
    return false;
  }

  if (
    story.sourcePreviews.length > 0 &&
    story.sourcePreviews.every((preview) => preview.kind === "x_account") &&
    !env.ENABLE_X_SEARCH
  ) {
    return false;
  }

  if (hasLowInformationBoardTitle(story.canonicalTitle)) {
    return false;
  }

  if (isLowPriorityDeathRemembranceBoardTitle(story.canonicalTitle)) {
    return false;
  }

  if (isDryPlatformBusinessBoardTitle(story.canonicalTitle)) {
    return false;
  }

  if (!hasPersistedScore || !hasBoardVisibilityScore) {
    return false;
  }

  if (sort === "live" && boardVisibilityScore < 20) {
    return false;
  }

  if (
    story.sourcePreviews.length > 0 &&
    !story.sourcePreviews.some((preview) => isVisibleBoardStorySourceKind(preview.kind))
  ) {
    return false;
  }

  if (!sourceRow) {
    return false;
  }

  if (shouldHideSignalOnlyStory(sourceRow, story.sourcePreviews)) {
    return false;
  }

  if (allowModeratelyRatedLiveStories) {
    return true;
  }

  if (shouldHideCorrectionHeavyStory(story)) {
    return false;
  }

  if (shouldHideLowSignalDefaultCommunityStory(story)) {
    return false;
  }

  if (shouldHideGenericNonOnlineCultureStory(story)) {
    return false;
  }

  return true;
}

function getBoardTimeWindowStart(timeWindow: BoardTimeWindow) {
  const now = new Date();

  if (timeWindow === "today") {
    return new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0)
    );
  }

  if (timeWindow === "week") {
    return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  }

  if (timeWindow === "month") {
    return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  }

  return null;
}

async function insertBoardSeedData() {
  const db = getDb();

  await db.transaction(async (tx) => {
    const now = new Date();
    const uniqueSources = new Map<
      string,
      {
        name: string;
        kind: string;
        provider: string;
        lastSuccessAt: Date;
      }
    >();

    for (const story of boardStorySeeds) {
      for (const source of story.sources) {
        const key = buildSourceKey(source.name, source.kind);
        const existing = uniqueSources.get(key);

        if (!existing || source.publishedAt > existing.lastSuccessAt) {
          uniqueSources.set(key, {
            name: source.name,
            kind: source.kind,
            provider: source.provider,
            lastSuccessAt: source.publishedAt,
          });
        }
      }
    }

    const sourceSeedValues = Array.from(uniqueSources.values()).map((source) => {
      const configuredSource = getBoardSourceSeedConfig(source.name, source.kind);
      const isConfiguredPollable = isConfiguredLivePollSourceKind(source.kind)
        ? Boolean(configuredSource)
        : true;

      return {
        name: source.name,
        kind: source.kind as (typeof boardSources.$inferInsert)["kind"],
        provider: (configuredSource?.provider ?? source.provider) as (typeof boardSources.$inferInsert)["provider"],
        pollIntervalMinutes:
          configuredSource?.pollIntervalMinutes ?? getPollIntervalMinutes(source.kind),
        enabled: isConfiguredPollable,
        configJson:
          configuredSource?.configJson ??
          ({
            mode: "seed_reference",
            discovery: "html-board-spec",
            pollable: !isConfiguredLivePollSourceKind(source.kind),
          } as Record<string, unknown>),
        lastPolledAt: isConfiguredPollable ? now : null,
        lastSuccessAt: source.lastSuccessAt,
        updatedAt: now,
      };
    });

    await tx.insert(boardSources).values(sourceSeedValues).onConflictDoNothing();

    const insertedSources = await tx
      .select({
        id: boardSources.id,
        name: boardSources.name,
        kind: boardSources.kind,
      })
      .from(boardSources)
      .where(
        or(
          ...sourceSeedValues.map((source) =>
            and(eq(boardSources.name, source.name), eq(boardSources.kind, source.kind))
          )
        )
      );

    const sourceIdByKey = new Map(
      insertedSources.map((source) => [buildSourceKey(source.name, source.kind), source.id])
    );

    const storySeedValues = boardStorySeeds.map((story) => ({
      slug: story.slug,
      canonicalTitle: story.canonicalTitle,
      vertical: story.vertical,
      status: story.status,
      storyType: story.storyType,
      surgeScore: story.surgeScore,
      controversyScore: story.controversyScore,
      sentimentScore: story.sentimentScore,
      itemsCount: story.itemsCount,
      sourcesCount: story.sourcesCount,
      correction: story.correction,
      formatsJson: story.formats,
      firstSeenAt: story.firstSeenAt,
      lastSeenAt: story.lastSeenAt,
      scoreJson: story.scoreJson,
      metadataJson: story.metadataJson ?? null,
      updatedAt: now,
    }));

    await tx
      .insert(boardStoryCandidates)
      .values(storySeedValues)
      .onConflictDoNothing();

    const insertedStories = await tx
      .select({ id: boardStoryCandidates.id, slug: boardStoryCandidates.slug })
      .from(boardStoryCandidates)
      .where(inArray(boardStoryCandidates.slug, boardStorySeeds.map((story) => story.slug)));

    const storyIdBySlug = new Map(insertedStories.map((story) => [story.slug, story.id]));

    const feedSeedValues = boardStorySeeds.flatMap((story) =>
      story.sources.map((source, index) => ({
        sourceId: sourceIdByKey.get(buildSourceKey(source.name, source.kind))!,
        externalId: buildFeedExternalId(story, source.name, index),
        title: source.title,
        url: source.url,
        author: source.author ?? null,
        publishedAt: source.publishedAt,
        summary: source.summary,
        contentHash: buildFeedExternalId(story, source.name, index),
        metadataJson: {
          seededStorySlug: story.slug,
          sourceType: source.sourceType,
        },
        ingestedAt: now,
      }))
    );

    await tx.insert(boardFeedItems).values(feedSeedValues).onConflictDoNothing();

    const insertedFeedItems = await tx
      .select({
        id: boardFeedItems.id,
        externalId: boardFeedItems.externalId,
      })
      .from(boardFeedItems)
      .where(inArray(boardFeedItems.externalId, feedSeedValues.map((item) => item.externalId)));

    const feedItemIdByExternalId = new Map(
      insertedFeedItems.map((item) => [item.externalId, item.id])
    );

    await tx
      .insert(boardStorySources)
      .values(
        boardStorySeeds.flatMap((story) =>
          story.sources.map((source, index) => ({
            storyId: storyIdBySlug.get(story.slug)!,
            feedItemId: feedItemIdByExternalId.get(
              buildFeedExternalId(story, source.name, index)
            )!,
            sourceWeight: source.sourceWeight,
            isPrimary: source.isPrimary ?? false,
            evidenceJson: {
              sourceType: source.sourceType,
              summary: source.summary,
            },
          }))
        )
      )
      .onConflictDoNothing();

    await tx
      .insert(boardStoryAiOutputs)
      .values(
        boardStorySeeds.flatMap((story) =>
          story.aiOutputs.map((output) => ({
            storyId: storyIdBySlug.get(story.slug)!,
            kind: output.kind,
            promptVersion: "v1",
            model: "gpt-4.1-mini",
            content: output.content,
            metadataJson: output.metadataJson ?? null,
            updatedAt: now,
          }))
        )
      )
      .onConflictDoNothing();

    await tx
      .insert(boardQueueItems)
      .values(
        boardQueueSeeds.map((item) => ({
          storyId: storyIdBySlug.get(item.storySlug)!,
          position: item.position,
          status: item.status,
          format: item.format,
          targetPublishAt: item.targetPublishAt,
          assignedTo: item.assignedTo,
          notes: item.notes,
          updatedAt: now,
        }))
      )
      .onConflictDoNothing();

    const [existingTickerRow] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(boardTickerEvents);

    if ((existingTickerRow?.count ?? 0) === 0) {
      await tx.insert(boardTickerEvents).values(
        boardTickerSeeds.map((item) => ({
          storyId: item.storySlug ? storyIdBySlug.get(item.storySlug)! : null,
          label: item.label,
          text: item.text,
          priority: item.priority,
          startsAt: item.startsAt,
          expiresAt: item.expiresAt,
          updatedAt: now,
        }))
      );
    }

    const competitorChannelSeedValues = boardCompetitorChannelSeeds.map((channel) => ({
      name: channel.name,
      platform: channel.platform,
      tier: channel.tier,
      handle: channel.handle,
      channelUrl: channel.channelUrl,
      subscribersLabel: channel.subscribersLabel,
      pollIntervalMinutes: 15,
      enabled: true,
      metadataJson: channel.metadataJson ?? null,
      updatedAt: now,
    }));

    await tx
      .insert(boardCompetitorChannels)
      .values(competitorChannelSeedValues)
      .onConflictDoNothing();

    const insertedChannels = await tx
      .select({
        id: boardCompetitorChannels.id,
        name: boardCompetitorChannels.name,
      })
      .from(boardCompetitorChannels)
      .where(
        inArray(
          boardCompetitorChannels.name,
          boardCompetitorChannelSeeds.map((channel) => channel.name)
        )
      );

    const channelIdByName = new Map(
      insertedChannels.map((channel) => [channel.name, channel.id])
    );

    await tx
      .insert(boardCompetitorPosts)
      .values(
        boardCompetitorChannelSeeds.map((channel) => ({
          channelId: channelIdByName.get(channel.name)!,
          externalId: `${slugify(channel.name)}:latest`,
          title: channel.latestTitle,
          url: channel.channelUrl,
          publishedAt: channel.latestPublishedAt,
          viewsLabel: channel.viewsLabel ?? null,
          engagementJson: {
            subscribersLabel: channel.subscribersLabel,
          },
          topicMatchScore: channel.topicMatchScore,
          alertLevel: channel.alertLevel,
          metadataJson: {
            latestTimeLabel:
              typeof channel.metadataJson?.latestTimeLabel === "string"
                ? channel.metadataJson.latestTimeLabel
                : null,
          },
          updatedAt: now,
        }))
      )
      .onConflictDoNothing();
  });
}

async function syncBoardSourceConfigs() {
  const db = getDb();
  const now = new Date();
  const sources = await db.select().from(boardSources);

  await Promise.all(
    sources
      .filter(
        (source) =>
          source.kind === "rss" ||
          source.kind === "youtube_channel" ||
          source.kind === "x_account" ||
          source.kind === "tiktok_query" ||
          source.kind === "tiktok_fyp_profile"
      )
      .map((source) => {
      const configuredSource = getBoardSourceSeedConfig(source.name, source.kind);

      // Only update sources that have a known seed config.
      // Leave manually-added sources completely alone.
      if (!configuredSource) {
        return Promise.resolve();
      }

      return db
        .update(boardSources)
        .set({
          provider: configuredSource.provider ?? source.provider,
          pollIntervalMinutes:
            configuredSource.pollIntervalMinutes ?? getPollIntervalMinutes(source.kind),
          configJson:
            source.kind === "youtube_channel" &&
            configuredSource.configJson.mode === "youtube_channel"
              ? mergeBoardYouTubeSourceConfig(
                  configuredSource.configJson,
                  parseBoardYouTubeSourceConfig(source.configJson)
                )
              : configuredSource.configJson ?? source.configJson,
          updatedAt: now,
        })
        .where(eq(boardSources.id, source.id));
      })
  );
}

async function createBoardStoryFromFeedItem(
  item: BoardSourceFeedItem,
  source: typeof boardSources.$inferSelect,
  config: BoardSourceConfig
) {
  const db = getDb();
  const publishedAt = item.publishedAt ?? new Date();
  const canonicalTitle = deriveBoardCanonicalTitle(item, source.kind);
  const storyType = inferBoardStoryType(canonicalTitle, item.summary);
  const recencyScore = computeBoardRecencyScore(publishedAt);
  const authorityScore = config.authorityScore ?? 70;
  const itemSignals = computeBoardFeedItemSignals({
    title: canonicalTitle,
    summary: item.summary,
    metadataJson: coerceObject(item.metadataJson) ?? null,
  });
  const controversyScore = itemSignals.controversyScore;
  const surgeScore = clampBoardScore(recencyScore * 0.6 + authorityScore * 0.4);
  const slug = buildBoardStorySlug(canonicalTitle, `${source.id}:${item.externalId}`);
  const formats = buildBoardStoryFormats(surgeScore, controversyScore);

  const [created] = await db
    .insert(boardStoryCandidates)
    .values({
      slug,
      canonicalTitle,
      vertical: config.vertical ?? null,
      status: "developing",
      storyType,
      surgeScore,
      controversyScore,
      sentimentScore:
        itemSignals.sentimentScore !== 0
          ? itemSignals.sentimentScore
          : computeBoardSentimentScore(storyType, controversyScore),
      itemsCount: 1,
      sourcesCount: 1,
      correction: storyType === "correction",
      formatsJson: formats,
      firstSeenAt: publishedAt,
      lastSeenAt: publishedAt,
      scoreJson: {
        provisionalOverall: surgeScore,
        provisionalRecency: recencyScore,
        provisionalControversy: controversyScore,
        provisionalSourceAuthority: authorityScore,
        provisionalCrossSourceAgreement: 0,
        provisionalComputedAt: new Date().toISOString(),
      },
      metadataJson: {
        ageLabel: formatAgeLabel(publishedAt),
        discoveredFrom: source.name,
        ingestKind: config.mode,
        sourceTags: config.tags,
        entityKeys: itemSignals.entityKeys,
      },
      updatedAt: new Date(),
    })
    .onConflictDoNothing()
    .returning({
      id: boardStoryCandidates.id,
      slug: boardStoryCandidates.slug,
      canonicalTitle: boardStoryCandidates.canonicalTitle,
      vertical: boardStoryCandidates.vertical,
      storyType: boardStoryCandidates.storyType,
      firstSeenAt: boardStoryCandidates.firstSeenAt,
      lastSeenAt: boardStoryCandidates.lastSeenAt,
      itemsCount: boardStoryCandidates.itemsCount,
      sourcesCount: boardStoryCandidates.sourcesCount,
      metadataJson: boardStoryCandidates.metadataJson,
    });

  if (created) {
    return buildBoardStoryMatchRecord(created);
  }

  const [existing] = await db
    .select({
      id: boardStoryCandidates.id,
      slug: boardStoryCandidates.slug,
      canonicalTitle: boardStoryCandidates.canonicalTitle,
      vertical: boardStoryCandidates.vertical,
      storyType: boardStoryCandidates.storyType,
      firstSeenAt: boardStoryCandidates.firstSeenAt,
      lastSeenAt: boardStoryCandidates.lastSeenAt,
      itemsCount: boardStoryCandidates.itemsCount,
      sourcesCount: boardStoryCandidates.sourcesCount,
      metadataJson: boardStoryCandidates.metadataJson,
    })
    .from(boardStoryCandidates)
    .where(eq(boardStoryCandidates.slug, slug))
    .limit(1);

  return existing ? buildBoardStoryMatchRecord(existing) : null;
}

function mapRssItemToBoardFeedItem(item: BoardRssFeedItem): BoardSourceFeedItem {
  return {
    externalId: item.externalId,
    title: item.title,
    url: item.url,
    author: item.author ?? null,
    publishedAt: item.publishedAt ?? null,
    summary: item.summary ?? null,
    contentHash: item.contentHash,
    metadataJson: coerceObject(item.metadataJson) ?? null,
  };
}

function extractYouTubeVideoId(url: string) {
  const match =
    url.match(/[?&]v=([A-Za-z0-9_-]{11})/i) ??
    url.match(/youtu\.be\/([A-Za-z0-9_-]{11})/i) ??
    url.match(/\/shorts\/([A-Za-z0-9_-]{11})/i);

  return match?.[1] ?? null;
}

function mapYouTubeRssItemToBoardFeedItem(
  item: BoardRssFeedItem,
  config: BoardYouTubeSourceConfig,
  sourceName: string
): BoardSourceFeedItem {
  const videoId = extractYouTubeVideoId(item.url);
  const feedUrl =
    config.feedUrl ??
    (config.channelId ? buildYouTubeChannelFeedUrl(config.channelId) : null);
  const normalizedDescription = normalizeYouTubeDescriptionSummary(item.summary);

  return {
    externalId: videoId ?? item.externalId,
    title: item.title,
    url: item.url,
    author: item.author ?? config.channelName ?? sourceName,
    publishedAt: item.publishedAt ?? null,
    summary: normalizedDescription,
    contentHash: item.contentHash,
    metadataJson: {
      ...(coerceObject(item.metadataJson) ?? {}),
      youtubeRss: true,
      rawDescription: item.summary ?? null,
      normalizedDescription,
      thumbnailUrl: videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : null,
      viewCount: null,
      durationMs: null,
      channelId: config.channelId ?? null,
      channelTitle: item.author ?? config.channelName ?? sourceName,
      channelHandle: config.channelHandle ?? null,
      channelUrl: config.channelUrl ?? null,
      feedUrl,
    },
  };
}

async function ensureBoardYouTubeSourcePollingConfig(args: {
  source: typeof boardSources.$inferSelect;
  config: BoardYouTubeSourceConfig;
}) {
  const feedUrl =
    args.config.feedUrl ??
    (args.config.channelId ? buildYouTubeChannelFeedUrl(args.config.channelId) : null);

  if (feedUrl) {
    if (args.config.feedUrl) {
      return args.config;
    }

    const nextConfig = {
      ...args.config,
      feedUrl,
    };

    await getDb()
      .update(boardSources)
      .set({
        configJson: nextConfig,
        updatedAt: new Date(),
      })
      .where(eq(boardSources.id, args.source.id));

    return nextConfig;
  }

  const resolved = await resolveYouTubeChannelFeed({
    channelId: args.config.channelId,
    channelHandle: args.config.channelHandle,
    channelUrl: args.config.channelUrl,
    channelName: args.config.channelName ?? args.source.name,
  });

  if (!resolved) {
    return args.config;
  }

  const nextConfig: BoardYouTubeSourceConfig = {
    ...args.config,
    channelId: resolved.channelId,
    feedUrl: resolved.feedUrl,
    channelHandle: args.config.channelHandle ?? resolved.channelHandle ?? undefined,
    channelUrl: args.config.channelUrl ?? resolved.channelUrl ?? undefined,
    channelName: args.config.channelName ?? resolved.title ?? args.source.name,
  };

  await getDb()
    .update(boardSources)
    .set({
      configJson: nextConfig,
      updatedAt: new Date(),
    })
    .where(eq(boardSources.id, args.source.id));

  return nextConfig;
}

function mapTwitterItemToBoardFeedItem(
  item: Awaited<ReturnType<typeof searchTwitterAccountPosts>>["results"][number],
  config: BoardXSourceConfig
): BoardSourceFeedItem {
  const publishedAt = item.postedAt ? new Date(item.postedAt) : null;
  const title = item.text.length > 140 ? `${item.text.slice(0, 137).trim()}...` : item.text;
  const tweetId = item.tweetId ?? extractTweetIdFromUrl(item.postUrl);
  const videoDescription =
    typeof item.videoDescription === "string" && item.videoDescription.trim().length > 0
      ? item.videoDescription.trim()
      : null;

  return {
    externalId: item.postUrl || `${config.handle}:${publishedAt?.toISOString() ?? "latest"}`,
    title: title || `Recent post from @${config.handle}`,
    url: item.postUrl,
    author: item.displayName || `@${config.handle}`,
    publishedAt,
    summary: item.text || null,
    contentHash: createHash("sha1")
      .update(`${config.handle}:${item.postUrl}:${item.text}:${item.postedAt ?? ""}`)
      .digest("hex"),
    metadataJson: {
      handle: config.handle,
      username: item.username,
      displayName: item.displayName,
      likeCount: item.likeCount,
      retweetCount: item.retweetCount,
      viewCount: item.viewCount,
      hasVideo: item.hasVideo === true,
      videoDescription,
      tweetId,
      embedUrl: buildTwitterEmbedUrl(tweetId),
      thumbnailUrl: item.thumbnailUrl ?? null,
    },
  };
}

function mapTikTokItemToBoardFeedItem(
  item: Awaited<ReturnType<typeof searchTikTokVideos>>["results"][number],
  config: BoardTikTokQuerySourceConfig | BoardTikTokFypProfileSourceConfig
): BoardSourceFeedItem {
  const publishedAt = item.publishedAt ? new Date(item.publishedAt) : null;
  const creatorHandle = item.creatorHandle?.replace(/^@+/, "") ?? null;
  const description = item.description?.trim() || null;
  const title = item.title?.trim() || description || "Recent TikTok video";

  return {
    externalId:
      item.externalId || item.pageUrl || `${config.mode}:${creatorHandle ?? "creator"}:${publishedAt?.toISOString() ?? "latest"}`,
    title,
    url: item.pageUrl,
    author:
      item.channelOrContributor ??
      (creatorHandle ? `@${creatorHandle}` : "TikTok creator"),
    publishedAt,
    summary: description ?? title,
    contentHash: createHash("sha1")
      .update(
        `${config.mode}:${item.pageUrl}:${item.externalId}:${item.viewCount ?? 0}:${item.likeCount ?? 0}:${item.shareCount ?? 0}`
      )
      .digest("hex"),
    metadataJson: {
      creatorHandle,
      channelOrContributor: item.channelOrContributor,
      viewCount: item.viewCount,
      likeCount: item.likeCount,
      shareCount: item.shareCount,
      retweetCount: item.shareCount,
      commentCount: item.commentCount,
      hasVideo: true,
      videoDescription: description ?? title,
      thumbnailUrl: item.previewUrl ?? null,
      embedUrl: item.pageUrl,
      tiktokVideoId: item.videoId,
      discoveryMethod: item.discoveryMethod,
      discoveryQuery: item.discoveryQuery,
      fypProfileKey: item.profileKey,
      publishedAt: item.publishedAt,
    },
  };
}

function getBoardSourceType(config: BoardSourceConfig, source: typeof boardSources.$inferSelect) {
  if (config.sourceType) {
    return config.sourceType;
  }

  if (source.kind === "youtube_channel") {
    return "yt";
  }

  if (source.kind === "tiktok_query" || source.kind === "tiktok_fyp_profile") {
    return "tiktok";
  }

  return "news";
}

async function ingestBoardItemsForSource(args: {
  source: typeof boardSources.$inferSelect;
  config: BoardSourceConfig;
  items: BoardSourceFeedItem[];
  storyMatches: BoardStoryMatchRecord[];
}) {
  const db = getDb();
  let feedItemsIngested = 0;
  let relationsCreated = 0;
  let storiesCreated = 0;
  let versionCaptures = 0;
  let correctionEvents = 0;
  const sourceType = getBoardSourceType(args.config, args.source);
  const affectedStoryIds = new Set<string>();
  const xEngagementBaseline =
    args.config.mode === "x_account"
      ? await getBoardXSourceEngagementBaseline(args.source.id)
      : null;
  const tiktokBaselineCache = new Map<
    string,
    Promise<BoardTikTokEngagementBaseline | null>
  >();

  for (const item of args.items) {
    const nextMetadataBase: Record<string, unknown> = {
      ...(coerceObject(item.metadataJson) ?? {}),
      ingestKind: args.config.mode,
      sourceType,
      signalVersion: BOARD_FEED_SIGNAL_VERSION,
    };
    const tiktokCreatorHandle =
      args.config.mode === "tiktok_query" || args.config.mode === "tiktok_fyp_profile"
        ? (typeof nextMetadataBase.creatorHandle === "string"
            ? nextMetadataBase.creatorHandle.trim().replace(/^@+/, "")
            : "")
        : "";
    const tiktokBaselinePromise =
      tiktokCreatorHandle.length > 0
        ? (tiktokBaselineCache.get(tiktokCreatorHandle) ??
          getBoardTikTokCreatorEngagementBaseline(tiktokCreatorHandle))
        : null;
    if (tiktokCreatorHandle.length > 0 && tiktokBaselinePromise) {
      tiktokBaselineCache.set(tiktokCreatorHandle, tiktokBaselinePromise);
    }
    const nextMetadataJson = {
      ...nextMetadataBase,
      ...(args.config.mode === "x_account"
        ? computeBoardXEngagementOutlierMetadata({
            metadataJson: nextMetadataBase,
            baseline: xEngagementBaseline,
          }) ?? {}
        : args.config.mode === "tiktok_query" || args.config.mode === "tiktok_fyp_profile"
          ? computeBoardTikTokEngagementOutlierMetadata({
              metadataJson: nextMetadataBase,
              baseline: tiktokBaselinePromise ? await tiktokBaselinePromise : null,
            }) ?? {}
        : {}),
    };
    const itemSignals = computeBoardFeedItemSignals({
      title: item.title,
      summary: item.summary,
      metadataJson: nextMetadataJson,
    });
    const nextContent = buildBoardFeedItemContent({
      title: item.title,
      summary: item.summary,
      url: item.url,
    });
    const [existingFeedItem] = await db
      .select()
      .from(boardFeedItems)
      .where(
        and(
          eq(boardFeedItems.sourceId, args.source.id),
          eq(boardFeedItems.externalId, item.externalId)
        )
      )
      .limit(1);

    let feedItem =
      existingFeedItem &&
      ({
        id: existingFeedItem.id,
      } as {
        id: string;
      } | null);

    if (!existingFeedItem) {
      const [insertedFeedItem] = await db
        .insert(boardFeedItems)
        .values({
          sourceId: args.source.id,
          externalId: item.externalId,
          title: item.title,
          url: item.url,
          author: item.author,
          publishedAt: item.publishedAt,
          summary: item.summary,
          contentHash: item.contentHash,
          sentimentScore: itemSignals.sentimentScore,
          controversyScore: itemSignals.controversyScore,
          entityKeysJson: itemSignals.entityKeys,
          metadataJson: nextMetadataJson,
          ingestedAt: new Date(),
        })
        .returning({
          id: boardFeedItems.id,
        });

      if (insertedFeedItem) {
        feedItemsIngested += 1;
        feedItem = insertedFeedItem;
        const isCorrection = inferBoardCorrectionSignal({
          title: item.title,
          summary: item.summary,
          diffSummary: null,
        });

        await db
          .insert(boardFeedItemVersions)
          .values({
            feedItemId: insertedFeedItem.id,
            contentHash: item.contentHash,
            title: item.title,
            content: nextContent,
            diffSummary: "initial capture",
            isCorrection,
            versionNumber: 1,
            capturedAt: item.publishedAt ?? new Date(),
          })
          .onConflictDoNothing({
            target: [
              boardFeedItemVersions.feedItemId,
              boardFeedItemVersions.versionNumber,
            ],
          });
        versionCaptures += 1;
        if (isCorrection) {
          correctionEvents += 1;
        }
      }
    } else {
      const diffSummary = buildBoardFeedItemDiffSummary({
        previous: {
          title: existingFeedItem.title,
          summary: existingFeedItem.summary,
          url: existingFeedItem.url,
          contentHash: existingFeedItem.contentHash,
        },
        next: {
          title: item.title,
          summary: item.summary,
          url: item.url,
          contentHash: item.contentHash,
        },
      });
      const shouldCaptureVersion = Boolean(diffSummary);

      await db
        .update(boardFeedItems)
        .set({
          title: item.title,
          url: item.url,
          author: item.author,
          publishedAt: item.publishedAt,
          summary: item.summary,
          contentHash: item.contentHash,
          sentimentScore: itemSignals.sentimentScore,
          controversyScore: itemSignals.controversyScore,
          entityKeysJson: itemSignals.entityKeys,
          metadataJson: nextMetadataJson,
          ingestedAt: new Date(),
        })
        .where(eq(boardFeedItems.id, existingFeedItem.id));

      if (shouldCaptureVersion) {
        const [latestVersionRow] = await db
          .select({
            versionNumber: boardFeedItemVersions.versionNumber,
          })
          .from(boardFeedItemVersions)
          .where(eq(boardFeedItemVersions.feedItemId, existingFeedItem.id))
          .orderBy(desc(boardFeedItemVersions.versionNumber))
          .limit(1);
        const isCorrection = inferBoardCorrectionSignal({
          title: item.title,
          summary: item.summary,
          diffSummary,
        });

        await db
          .insert(boardFeedItemVersions)
          .values({
            feedItemId: existingFeedItem.id,
            contentHash: item.contentHash,
            title: item.title,
            content: nextContent,
            diffSummary,
            isCorrection,
            versionNumber: (latestVersionRow?.versionNumber ?? 0) + 1,
            capturedAt: new Date(),
          })
          .onConflictDoNothing({
            target: [
              boardFeedItemVersions.feedItemId,
              boardFeedItemVersions.versionNumber,
            ],
          });
        versionCaptures += 1;
        if (isCorrection) {
          correctionEvents += 1;
        }
      }
    }

    if (!feedItem) {
      continue;
    }

    let matchedStory = await findExistingStoryForFeedItem(feedItem.id);
    if (
      matchedStory &&
      !args.storyMatches.some((story) => story.id === matchedStory?.id)
    ) {
      args.storyMatches.push(matchedStory);
    }

    if (!matchedStory) {
      matchedStory = await findMatchingBoardStory(args.storyMatches, item, args.config);
    }
    if (!matchedStory) {
      if (
        sourceConfigIsSignalOnly(
          args.source.configJson,
          args.source.kind,
          args.source.name
        )
      ) {
        continue;
      }

      matchedStory = await createBoardStoryFromFeedItem(item, args.source, args.config);
      if (matchedStory) {
        args.storyMatches.push(matchedStory);
        storiesCreated += 1;
      }
    }

    if (!matchedStory) {
      continue;
    }

    const [relation] = await db
      .insert(boardStorySources)
      .values({
        storyId: matchedStory.id,
        feedItemId: feedItem.id,
        sourceWeight: args.config.authorityScore ?? 70,
        isPrimary: false,
        evidenceJson: {
          sourceType,
          summary: item.summary,
          tags: args.config.tags,
        },
      })
      .onConflictDoNothing()
      .returning({ id: boardStorySources.id });

    if (relation) {
      relationsCreated += 1;
    }

    affectedStoryIds.add(matchedStory.id);
  }

  if (affectedStoryIds.size > 0) {
    await syncBoardStoryCorrectionFlags(Array.from(affectedStoryIds));
  }

  return {
    feedItemsIngested,
    relationsCreated,
    storiesCreated,
    versionCaptures,
    correctionEvents,
    affectedStoryIds: Array.from(affectedStoryIds),
  };
}

async function pollBoardConfiguredSource(args: {
  source: typeof boardSources.$inferSelect;
  storyMatches: BoardStoryMatchRecord[];
  maxResultsOverride?: number;
  ignoreLookback?: boolean;
  lookbackHoursOverride?: number;
}) {
  const db = getDb();
  const config = parseBoardSourceConfig(args.source);

  if (!config || !isBoardSourcePollable(args.source)) {
    return {
      feedItemsIngested: 0,
      relationsCreated: 0,
      storiesCreated: 0,
      versionCaptures: 0,
      correctionEvents: 0,
      failed: false,
      affectedStoryIds: [] as string[],
    };
  }

  try {
    let items: BoardSourceFeedItem[] = [];
    const rssLookbackWindowMs =
      (args.lookbackHoursOverride ?? BOARD_RSS_ITEM_LOOKBACK_DAYS * 24) * 60 * 60 * 1000;
    const youtubeLookbackWindowMs =
      (args.lookbackHoursOverride ?? BOARD_YOUTUBE_ITEM_LOOKBACK_DAYS * 24) * 60 * 60 * 1000;
    const tiktokLookbackWindowMs =
      (args.lookbackHoursOverride ?? BOARD_TIKTOK_ITEM_LOOKBACK_HOURS) *
      60 *
      60 *
      1000;

    if (config.mode === "rss_feed") {
      items = (await fetchBoardRssItems(config.feedUrl))
        .filter((item) => {
          if (args.ignoreLookback) {
            return true;
          }

          if (!item.publishedAt) {
            return true;
          }

          return Date.now() - item.publishedAt.getTime() <= rssLookbackWindowMs;
        })
        .sort((left, right) => {
          const leftTime = left.publishedAt?.getTime() ?? 0;
          const rightTime = right.publishedAt?.getTime() ?? 0;
          return rightTime - leftTime;
        })
        .slice(0, 20)
        .map((item) => mapRssItemToBoardFeedItem(item));
    } else if (config.mode === "youtube_channel") {
      const pollingConfig = await ensureBoardYouTubeSourcePollingConfig({
        source: args.source,
        config,
      });
      const youtubeFeedUrl =
        pollingConfig.feedUrl ??
        (pollingConfig.channelId
          ? buildYouTubeChannelFeedUrl(pollingConfig.channelId)
          : null);

      if (!youtubeFeedUrl) {
        throw new Error(`Missing YouTube feed URL for ${args.source.name}`);
      }

      items = (await fetchBoardRssItems(youtubeFeedUrl))
        .map((item) =>
          mapYouTubeRssItemToBoardFeedItem(item, pollingConfig, args.source.name)
        )
        .filter((item) => {
          if (args.ignoreLookback) {
            return true;
          }

          if (!item.publishedAt) {
            return true;
          }

          return Date.now() - item.publishedAt.getTime() <= youtubeLookbackWindowMs;
        })
        .sort((left, right) => {
          const leftTime = left.publishedAt?.getTime() ?? 0;
          const rightTime = right.publishedAt?.getTime() ?? 0;
          return rightTime - leftTime;
        })
        .slice(0, args.maxResultsOverride ?? pollingConfig.maxResults ?? 8);
    } else if (config.mode === "x_account") {
      const { results } = await searchTwitterAccountPosts({
        accountHandle: config.handle,
        queryTerms: config.queryTerms,
        temporalContext: new Date().getFullYear().toString(),
        maxResults: args.maxResultsOverride ?? config.maxResults ?? 6,
      });

      items = results
        .map((item) => mapTwitterItemToBoardFeedItem(item, config))
        .filter((item) => {
          if (args.ignoreLookback) {
            return true;
          }

          if (!item.publishedAt) {
            return true;
          }

          return Date.now() - item.publishedAt.getTime() <= rssLookbackWindowMs;
        });
    } else if (config.mode === "tiktok_query") {
      const { results } = await searchTikTokVideos({
        query: config.query,
        queries: config.queries,
        hashtags: config.hashtags,
        maxResults: args.maxResultsOverride ?? config.maxResults ?? 6,
      });

      items = results
        .map((item) => mapTikTokItemToBoardFeedItem(item, config))
        .filter((item) => {
          if (args.ignoreLookback) {
            return true;
          }

          if (!item.publishedAt) {
            return true;
          }

          return Date.now() - item.publishedAt.getTime() <= tiktokLookbackWindowMs;
        });
    } else if (config.mode === "tiktok_fyp_profile") {
      const { results } = await loadTikTokFypVideos({
        profileKey: config.profileKey,
        maxResults: args.maxResultsOverride ?? config.maxResults ?? 8,
      });

      items = results
        .map((item) => mapTikTokItemToBoardFeedItem(item, config))
        .filter((item) => {
          if (args.ignoreLookback) {
            return true;
          }

          if (!item.publishedAt) {
            return true;
          }

          return Date.now() - item.publishedAt.getTime() <= tiktokLookbackWindowMs;
        });
    }

    const ingestion = await ingestBoardItemsForSource({
      source: args.source,
      config,
      items,
      storyMatches: args.storyMatches,
    });

    await db
      .update(boardSources)
      .set({
        lastPolledAt: new Date(),
        lastSuccessAt: new Date(),
        lastError: null,
        updatedAt: new Date(),
      })
      .where(eq(boardSources.id, args.source.id));

    return {
      sourceId: args.source.id,
      sourceName: args.source.name,
      sourceKind: args.source.kind,
      failed: false,
      ...ingestion,
    };
  } catch (error) {
    await db
      .update(boardSources)
      .set({
        lastPolledAt: new Date(),
        lastError: error instanceof Error ? error.message.slice(0, 500) : "Unknown poll error",
        updatedAt: new Date(),
      })
      .where(eq(boardSources.id, args.source.id));

    return {
      sourceId: args.source.id,
      sourceName: args.source.name,
      sourceKind: args.source.kind,
      failed: true,
      error: error instanceof Error ? error.message : "Unknown poll error",
      feedItemsIngested: 0,
      relationsCreated: 0,
      storiesCreated: 0,
      versionCaptures: 0,
      correctionEvents: 0,
      affectedStoryIds: [],
    };
  }
}

async function getBoardStoryMatches() {
  const db = getDb();
  const storyRows = await db
    .select({
      id: boardStoryCandidates.id,
      slug: boardStoryCandidates.slug,
      canonicalTitle: boardStoryCandidates.canonicalTitle,
      vertical: boardStoryCandidates.vertical,
      storyType: boardStoryCandidates.storyType,
      firstSeenAt: boardStoryCandidates.firstSeenAt,
      lastSeenAt: boardStoryCandidates.lastSeenAt,
      itemsCount: boardStoryCandidates.itemsCount,
      sourcesCount: boardStoryCandidates.sourcesCount,
      metadataJson: boardStoryCandidates.metadataJson,
    })
    .from(boardStoryCandidates)
    .where(
      gte(
        boardStoryCandidates.updatedAt,
        new Date(Date.now() - BOARD_STORY_MATCH_LOOKBACK_DAYS * 24 * 60 * 60 * 1000)
      )
    );

  return storyRows.map((row) => buildBoardStoryMatchRecord(row));
}

function createEmptyBoardIngestionSummary() {
  return {
    sourcesPolled: 0,
    feedItemsIngested: 0,
    relationsCreated: 0,
    storiesCreated: 0,
    versionCaptures: 0,
    correctionEvents: 0,
    failedSources: 0,
    affectedStoryIds: [] as string[],
  };
}

function isBoardSourceDueForPolling(
  source: Pick<typeof boardSources.$inferSelect, "lastPolledAt" | "pollIntervalMinutes">
) {
  const lastPolledAt = coerceDate(source.lastPolledAt);
  if (!lastPolledAt) {
    return true;
  }

  const intervalMinutes =
    typeof source.pollIntervalMinutes === "number" && source.pollIntervalMinutes > 0
      ? source.pollIntervalMinutes
      : 15;

  return Date.now() - lastPolledAt.getTime() >= intervalMinutes * 60 * 1000;
}

async function ingestBoardSourcesByKind(
  kind: "rss" | "youtube_channel" | "x_account" | "tiktok_query" | "tiktok_fyp_profile",
  maxSources: number
) {
  await syncBoardSourceConfigs();

  if (kind === "x_account" && !getEnv().ENABLE_X_SEARCH) {
    return createEmptyBoardIngestionSummary();
  }

  const db = getDb();
  const sources = await db
    .select()
    .from(boardSources)
    .where(and(eq(boardSources.enabled, true), eq(boardSources.kind, kind)))
    .orderBy(asc(boardSources.lastPolledAt), asc(boardSources.name));
  const dueSources = sources
    .filter((source) => isBoardSourcePollable(source) && isBoardSourceDueForPolling(source))
    .slice(0, Math.max(1, maxSources));

  if (dueSources.length === 0) {
    return createEmptyBoardIngestionSummary();
  }

  const storyMatches = await getBoardStoryMatches();
  let sourcesPolled = 0;
  let feedItemsIngested = 0;
  let relationsCreated = 0;
  let storiesCreated = 0;
  let versionCaptures = 0;
  let correctionEvents = 0;
  let failedSources = 0;
  const affectedStoryIds = new Set<string>();

  for (const source of dueSources) {
    sourcesPolled += 1;
    const result = await pollBoardConfiguredSource({ source, storyMatches });
    feedItemsIngested += result.feedItemsIngested;
    relationsCreated += result.relationsCreated;
    storiesCreated += result.storiesCreated;
    versionCaptures += result.versionCaptures;
    correctionEvents += result.correctionEvents;
    result.affectedStoryIds.forEach((storyId) => affectedStoryIds.add(storyId));
    if (result.failed) {
      failedSources += 1;
    }
  }

  return {
    sourcesPolled,
    feedItemsIngested,
    relationsCreated,
    storiesCreated,
    versionCaptures,
    correctionEvents,
    failedSources,
    affectedStoryIds: Array.from(affectedStoryIds),
  };
}

export async function ingestBoardRssSources() {
  return ingestBoardSourcesByKind("rss", getEnv().BOARD_POLL_RSS_SOURCES_PER_RUN);
}

async function ingestBoardYouTubeSources() {
  return ingestBoardSourcesByKind("youtube_channel", 4);
}

export async function ingestBoardXSources() {
  return ingestBoardSourcesByKind("x_account", getEnv().BOARD_POLL_X_SOURCES_PER_RUN);
}

export async function ingestBoardTikTokSources() {
  const totalSources = Math.max(1, getEnv().BOARD_POLL_TIKTOK_SOURCES_PER_RUN);
  const maxQuerySources = totalSources > 1 ? 1 : 0;
  const maxFypSources = Math.max(1, totalSources - maxQuerySources);
  const fypIngestion = await ingestBoardSourcesByKind(
    "tiktok_fyp_profile",
    maxFypSources
  );
  const queryIngestion =
    maxQuerySources > 0
      ? await ingestBoardSourcesByKind("tiktok_query", maxQuerySources)
      : createEmptyBoardIngestionSummary();

  return {
    sourcesPolled: queryIngestion.sourcesPolled + fypIngestion.sourcesPolled,
    feedItemsIngested:
      queryIngestion.feedItemsIngested + fypIngestion.feedItemsIngested,
    relationsCreated:
      queryIngestion.relationsCreated + fypIngestion.relationsCreated,
    storiesCreated: queryIngestion.storiesCreated + fypIngestion.storiesCreated,
    versionCaptures:
      queryIngestion.versionCaptures + fypIngestion.versionCaptures,
    correctionEvents:
      queryIngestion.correctionEvents + fypIngestion.correctionEvents,
    failedSources: queryIngestion.failedSources + fypIngestion.failedSources,
    affectedStoryIds: Array.from(
      new Set([
        ...queryIngestion.affectedStoryIds,
        ...fypIngestion.affectedStoryIds,
      ])
    ),
  };
}

export async function ensureBoardSeedData() {
  if (boardSeedInitialized) {
    scheduleBoardReadMaintenance();
    return;
  }

  if (!boardSeedInitPromise) {
    boardSeedInitPromise = (async () => {
      const db = getDb();
      const [existing] = await db
        .select({ id: boardStoryCandidates.id })
        .from(boardStoryCandidates)
        .limit(1);

      if (!existing) {
        await insertBoardSeedData();
      }

      const sourceRows = await db.select().from(boardSources);
      await disableUnsupportedBoardSources(sourceRows);
      if (sourceRows.some((source) => needsBoardSourceConfigSync(source))) {
        await syncBoardSourceConfigs();
      }

      await ensureConfiguredSourcesExist(sourceRows);

      const [existingChannels] = await db
        .select({ id: boardCompetitorChannels.id })
        .from(boardCompetitorChannels)
        .limit(1);

      if (!existingChannels) {
        await insertBoardSeedData();
      }

      boardSeedInitialized = true;
    })()
      .finally(() => {
        boardSeedInitPromise = null;
        if (boardSeedInitialized) {
          scheduleBoardReadMaintenance();
        }
      });
  }

  await boardSeedInitPromise;
}

async function ensureConfiguredSourcesExist(
  existingSources: (typeof boardSources.$inferSelect)[]
) {
  const existingByKey = new Map(
    existingSources.map((s) => [buildSourceKey(s.name, s.kind), s])
  );

  const db = getDb();
  const now = new Date();

  const toInsert: typeof boardSourceConfigSeeds = [];
  const toUpdate: { id: string; seed: (typeof boardSourceConfigSeeds)[number] }[] = [];

  for (const seed of boardSourceConfigSeeds) {
    if (!DB_COMPATIBLE_BOARD_SOURCE_KINDS.has(seed.kind)) {
      continue;
    }

    const key = buildSourceKey(seed.name, seed.kind);
    const existing = existingByKey.get(key);

    if (!existing) {
      toInsert.push(seed);
    } else if (
      !existing.enabled ||
      !existing.configJson ||
      (existing.configJson as Record<string, unknown>).mode === "seed_reference"
    ) {
      // Existing source is disabled or has placeholder config — update it
      toUpdate.push({ id: existing.id, seed });
    }
  }

  if (toInsert.length > 0) {
    await db.insert(boardSources).values(
      toInsert.map((seed) => ({
        name: seed.name,
        kind: seed.kind as (typeof boardSources.$inferInsert)["kind"],
        provider: (seed.provider ?? "internal") as (typeof boardSources.$inferInsert)["provider"],
        pollIntervalMinutes: seed.pollIntervalMinutes ?? getPollIntervalMinutes(seed.kind),
        enabled: true,
        configJson: seed.configJson as Record<string, unknown>,
        lastPolledAt: null,
        lastSuccessAt: null,
        updatedAt: now,
      }))
    ).onConflictDoNothing();
  }

  for (const { id, seed } of toUpdate) {
    await db.update(boardSources).set({
      enabled: true,
      provider: (seed.provider ?? "internal") as (typeof boardSources.$inferInsert)["provider"],
      pollIntervalMinutes: seed.pollIntervalMinutes ?? getPollIntervalMinutes(seed.kind),
      configJson: seed.configJson as Record<string, unknown>,
      updatedAt: now,
    }).where(eq(boardSources.id, id));
  }
}

async function disableUnsupportedBoardSources(
  sourceRows: (typeof boardSources.$inferSelect)[]
) {
  const unsupportedSourceIds = sourceRows
    .filter((source) => !isSupportedBoardSourceKind(source.kind))
    .map((source) => source.id);

  if (unsupportedSourceIds.length === 0) {
    return;
  }

  const db = getDb();
  await db
    .update(boardSources)
    .set({
      enabled: false,
      lastError: "Unsupported legacy board source kind disabled from live board.",
      updatedAt: new Date(),
    })
    .where(inArray(boardSources.id, unsupportedSourceIds));
}

async function backfillBoardFeedItemSignals() {
  if (boardFeedSignalsBackfilled) {
    return { updatedFeedItems: 0 };
  }

  if (boardFeedSignalBackfillPromise) {
    return boardFeedSignalBackfillPromise;
  }

  boardFeedSignalBackfillPromise = (async () => {
    const db = getDb();
    let updatedFeedItems = 0;

    while (true) {
      const feedItems = await db
        .select({
          id: boardFeedItems.id,
          title: boardFeedItems.title,
          summary: boardFeedItems.summary,
          entityKeysJson: boardFeedItems.entityKeysJson,
          metadataJson: boardFeedItems.metadataJson,
        })
        .from(boardFeedItems)
        .where(
          sql`coalesce(${boardFeedItems.metadataJson} ->> 'signalVersion', '') <> ${BOARD_FEED_SIGNAL_VERSION}`
        )
        .limit(BOARD_FEED_SIGNAL_BACKFILL_BATCH_SIZE);

      if (feedItems.length === 0) {
        boardFeedSignalsBackfilled = true;
        return { updatedFeedItems };
      }

      for (const feedItem of feedItems) {
        const metadataJson = coerceObject(feedItem.metadataJson);
        const signals = computeBoardFeedItemSignals({
          title: feedItem.title,
          summary: feedItem.summary,
          metadataJson,
        });

        await db
          .update(boardFeedItems)
          .set({
            sentimentScore: signals.sentimentScore,
            controversyScore: signals.controversyScore,
            entityKeysJson: signals.entityKeys,
            metadataJson: {
              ...(metadataJson ?? {}),
              signalVersion: BOARD_FEED_SIGNAL_VERSION,
            },
          })
          .where(eq(boardFeedItems.id, feedItem.id));
      }

      updatedFeedItems += feedItems.length;
      logBoardPollDebug("signals:backfill-progress", {
        updatedFeedItems,
      });
    }
  })().finally(() => {
    boardFeedSignalBackfillPromise = null;
  });

  return boardFeedSignalBackfillPromise;
}

export async function recomputeBoardStoryMetrics(storyIds?: string[]) {
  await ensureBoardSeedData();
  await backfillBoardFeedItemSignals();

  const db = getDb();
  const normalizedStoryIds = storyIds
    ? Array.from(new Set(storyIds.map((storyId) => storyId.trim()).filter(Boolean)))
    : [];
  logBoardPollDebug("metrics:start", {
    scope: normalizedStoryIds.length > 0 ? "partial" : "full",
    requestedStoryCount: normalizedStoryIds.length,
  });
  const [stories, relationships] = await Promise.all([
    normalizedStoryIds.length > 0
      ? db
          .select({
            id: boardStoryCandidates.id,
            canonicalTitle: boardStoryCandidates.canonicalTitle,
            storyType: boardStoryCandidates.storyType,
            scoreJson: boardStoryCandidates.scoreJson,
            firstSeenAt: boardStoryCandidates.firstSeenAt,
            lastSeenAt: boardStoryCandidates.lastSeenAt,
          })
          .from(boardStoryCandidates)
          .where(inArray(boardStoryCandidates.id, normalizedStoryIds))
      : db
          .select({
            id: boardStoryCandidates.id,
            canonicalTitle: boardStoryCandidates.canonicalTitle,
            storyType: boardStoryCandidates.storyType,
            scoreJson: boardStoryCandidates.scoreJson,
            firstSeenAt: boardStoryCandidates.firstSeenAt,
            lastSeenAt: boardStoryCandidates.lastSeenAt,
          })
          .from(boardStoryCandidates),
    normalizedStoryIds.length > 0
      ? db
          .select({
            storyId: boardStorySources.storyId,
            sourceId: boardFeedItems.sourceId,
            title: boardFeedItems.title,
            summary: boardFeedItems.summary,
            publishedAt: boardFeedItems.publishedAt,
            sourceKind: boardSources.kind,
            sourceConfigJson: boardSources.configJson,
            sentimentScore: boardFeedItems.sentimentScore,
            controversyScore: boardFeedItems.controversyScore,
            entityKeysJson: boardFeedItems.entityKeysJson,
            metadataJson: boardFeedItems.metadataJson,
          })
          .from(boardStorySources)
          .innerJoin(boardFeedItems, eq(boardFeedItems.id, boardStorySources.feedItemId))
          .innerJoin(boardSources, eq(boardSources.id, boardFeedItems.sourceId))
          .where(inArray(boardStorySources.storyId, normalizedStoryIds))
      : db
          .select({
            storyId: boardStorySources.storyId,
            sourceId: boardFeedItems.sourceId,
            title: boardFeedItems.title,
            summary: boardFeedItems.summary,
            publishedAt: boardFeedItems.publishedAt,
            sourceKind: boardSources.kind,
            sourceConfigJson: boardSources.configJson,
            sentimentScore: boardFeedItems.sentimentScore,
            controversyScore: boardFeedItems.controversyScore,
            entityKeysJson: boardFeedItems.entityKeysJson,
            metadataJson: boardFeedItems.metadataJson,
          })
          .from(boardStorySources)
          .innerJoin(boardFeedItems, eq(boardFeedItems.id, boardStorySources.feedItemId))
          .innerJoin(boardSources, eq(boardSources.id, boardFeedItems.sourceId)),
  ]);
  logBoardPollDebug("metrics:loaded", {
    storyCount: stories.length,
    relationshipCount: relationships.length,
  });

  const aggregates = new Map<
    string,
    {
      itemCount: number;
      sourceIds: Set<string>;
      earliestPublishedAt: Date | null;
      latestPublishedAt: Date | null;
      latestNonSignalPublishedAt: Date | null;
      sentimentTotal: number;
      controversyTotal: number;
      maxControversy: number;
      entityCounts: Map<string, number>;
      titleCandidates: Array<{
        title: string;
        sourceKind: string;
        publishedAt: Date | null;
      }>;
    }
  >();

  for (const relation of relationships) {
    const publishedAt = coerceDate(relation.publishedAt);
    const aggregate =
      aggregates.get(relation.storyId) ?? {
        itemCount: 0,
        sourceIds: new Set<string>(),
        earliestPublishedAt: null,
        latestPublishedAt: null,
        latestNonSignalPublishedAt: null,
        sentimentTotal: 0,
        controversyTotal: 0,
        maxControversy: 0,
        entityCounts: new Map<string, number>(),
        titleCandidates: [],
      };

    aggregate.itemCount += 1;
    aggregate.sourceIds.add(relation.sourceId);
    aggregate.sentimentTotal += relation.sentimentScore ?? 0;
    aggregate.controversyTotal += relation.controversyScore ?? 0;
    aggregate.maxControversy = Math.max(
      aggregate.maxControversy,
      relation.controversyScore ?? 0
    );

    for (const entityKey of coerceStringArray(relation.entityKeysJson)) {
      aggregate.entityCounts.set(
        entityKey,
        (aggregate.entityCounts.get(entityKey) ?? 0) + 1
      );
    }

    const candidateTitle = deriveBoardCanonicalTitle(
      {
        externalId: "",
        title: relation.title,
        url: "",
        author: null,
        publishedAt,
        summary: relation.summary,
        contentHash: "",
        metadataJson: coerceObject(relation.metadataJson) ?? null,
      },
      relation.sourceKind
    );
    if (candidateTitle.length > 0) {
      aggregate.titleCandidates.push({
        title: candidateTitle,
        sourceKind: relation.sourceKind,
        publishedAt,
      });
    }

    if (
      publishedAt &&
      (!aggregate.earliestPublishedAt || publishedAt < aggregate.earliestPublishedAt)
    ) {
      aggregate.earliestPublishedAt = publishedAt;
    }

    if (
      publishedAt &&
      (!aggregate.latestPublishedAt || publishedAt > aggregate.latestPublishedAt)
    ) {
      aggregate.latestPublishedAt = publishedAt;
    }

    if (
      publishedAt &&
      !sourceConfigIsSignalOnly(
        relation.sourceConfigJson,
        relation.sourceKind
      ) &&
      !isSignalOnlySourceKind(relation.sourceKind) &&
      (!aggregate.latestNonSignalPublishedAt ||
        publishedAt > aggregate.latestNonSignalPublishedAt)
    ) {
      aggregate.latestNonSignalPublishedAt = publishedAt;
    }

    aggregates.set(relation.storyId, aggregate);
  }

  for (const [index, story] of stories.entries()) {
    const aggregate = aggregates.get(story.id);
    const preferredCanonicalTitle = choosePreferredCanonicalTitle({
      existingTitle: story.canonicalTitle,
      candidates: aggregate?.titleCandidates ?? [],
    });
    const inferredStoryType =
      story.storyType === "competitor" || story.storyType === "correction"
        ? story.storyType
        : inferBoardStoryType(preferredCanonicalTitle);
    const itemCount = aggregate?.itemCount ?? 0;
    const avgSentiment =
      itemCount > 0
        ? Number(
            Math.max(
              -1,
              Math.min(1, (aggregate?.sentimentTotal ?? 0) / itemCount)
            ).toFixed(2)
          )
        : 0;
    const avgControversy =
      itemCount > 0
        ? clampBoardScore(
            Math.round(
              ((aggregate?.controversyTotal ?? 0) / itemCount) * 0.7 +
                (aggregate?.maxControversy ?? 0) * 0.3 +
                Math.min((aggregate?.sourceIds.size ?? 0) * 2, 8)
            )
          )
        : 0;
    const entityKeys = aggregate
      ? Array.from(aggregate.entityCounts.entries())
          .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
          .slice(0, 8)
          .map(([entityKey]) => entityKey)
      : [];
    const updatedScoreJson = {
      ...(coerceObject(story.scoreJson) ?? {}),
      lastComputedAt: new Date().toISOString(),
      entityKeys,
    };

    await db
      .update(boardStoryCandidates)
      .set({
        canonicalTitle: preferredCanonicalTitle,
        storyType: inferredStoryType,
        itemsCount: itemCount,
        sourcesCount: aggregate?.sourceIds.size ?? 0,
        sentimentScore: avgSentiment,
        controversyScore: avgControversy,
        firstSeenAt: aggregate?.earliestPublishedAt ?? story.firstSeenAt,
        lastSeenAt:
          aggregate?.latestNonSignalPublishedAt ??
          aggregate?.latestPublishedAt ??
          story.lastSeenAt,
        scoreJson: updatedScoreJson,
        updatedAt: new Date(),
      })
      .where(eq(boardStoryCandidates.id, story.id));

    if ((index + 1) % 50 === 0 || index === stories.length - 1) {
      logBoardPollDebug("metrics:progress", {
        processedStories: index + 1,
        totalStories: stories.length,
      });
    }
  }

  logBoardPollDebug("metrics:done", {
    storyCount: stories.length,
    relationshipCount: relationships.length,
  });

  return {
    storyCount: stories.length,
    feedItemCount: relationships.length,
  };
}

export async function rescoreBoardStories(
  storyIds?: string[],
  options?: { maxStories?: number }
) {
  await ensureBoardSeedData();

  const db = getDb();
  const normalizedStoryIds = storyIds
    ? Array.from(new Set(storyIds.map((storyId) => storyId.trim()).filter(Boolean)))
    : [];
  const rescoringPriority = sql<number>`
    case
      when ${boardStoryCandidates.scoreJson} is null
        or ${boardStoryCandidates.scoreJson} ->> 'lastScoredAt' is null
      then 1
      else 0
    end
  `;
  const rows =
    normalizedStoryIds.length > 0
      ? await db
          .select({ id: boardStoryCandidates.id })
          .from(boardStoryCandidates)
          .where(inArray(boardStoryCandidates.id, normalizedStoryIds))
          .orderBy(
            desc(rescoringPriority),
            desc(boardStoryCandidates.lastSeenAt),
            desc(boardStoryCandidates.controversyScore),
            desc(boardStoryCandidates.sourcesCount)
          )
          .limit(options?.maxStories ?? normalizedStoryIds.length)
      : await db
          .select({ id: boardStoryCandidates.id })
          .from(boardStoryCandidates)
          .where(
            gte(
              boardStoryCandidates.lastSeenAt,
              new Date(
                Date.now() - BOARD_RESCORING_LOOKBACK_DAYS * 24 * 60 * 60 * 1000
              )
            )
          )
          .orderBy(
            desc(rescoringPriority),
            desc(boardStoryCandidates.lastSeenAt),
            desc(boardStoryCandidates.controversyScore),
            desc(boardStoryCandidates.sourcesCount)
          )
          .limit(BOARD_RESCORING_STORY_LIMIT);

  logBoardPollDebug("scoring:start", {
    scope: normalizedStoryIds.length > 0 ? "partial" : "full",
    requestedStoryCount: normalizedStoryIds.length,
    rowCount: rows.length,
    maxStories: options?.maxStories ?? null,
  });

  for (const [index, row] of rows.entries()) {
    await scoreStory(row.id);

    const gc = (globalThis as typeof globalThis & { gc?: () => void }).gc;
    if (typeof gc === "function") {
      gc();
    }

    if ((index + 1) % 5 === 0 || index === rows.length - 1) {
      logBoardPollDebug("scoring:progress", {
        processedStories: index + 1,
        totalStories: rows.length,
      });
    }
  }

  logBoardPollDebug("scoring:done", {
    rowCount: rows.length,
  });

  return {
    rescoredStories: rows.length,
  };
}

export async function enrichBoardStoryCommentReaction(storyIds?: string[]) {
  await ensureBoardSeedData();

  const db = getDb();
  const normalizedStoryIds = storyIds
    ? Array.from(new Set(storyIds.map((storyId) => storyId.trim()).filter(Boolean)))
    : [];
  const stories =
    normalizedStoryIds.length > 0
      ? await db
          .select({
            id: boardStoryCandidates.id,
            canonicalTitle: boardStoryCandidates.canonicalTitle,
            metadataJson: boardStoryCandidates.metadataJson,
            lastSeenAt: boardStoryCandidates.lastSeenAt,
            surgeScore: boardStoryCandidates.surgeScore,
          })
          .from(boardStoryCandidates)
          .where(inArray(boardStoryCandidates.id, normalizedStoryIds))
          .orderBy(
            desc(boardStoryCandidates.surgeScore),
            desc(boardStoryCandidates.lastSeenAt),
          )
          .limit(BOARD_COMMENT_REACTION_STORY_LIMIT)
      : await db
          .select({
            id: boardStoryCandidates.id,
            canonicalTitle: boardStoryCandidates.canonicalTitle,
            metadataJson: boardStoryCandidates.metadataJson,
            lastSeenAt: boardStoryCandidates.lastSeenAt,
            surgeScore: boardStoryCandidates.surgeScore,
          })
          .from(boardStoryCandidates)
          .orderBy(
            desc(boardStoryCandidates.surgeScore),
            desc(boardStoryCandidates.lastSeenAt),
          )
          .limit(BOARD_COMMENT_REACTION_STORY_LIMIT);

  let updatedStories = 0;

  for (const story of stories) {
    const storyMetadata = coerceObject(story.metadataJson) ?? {};
    const existingReaction = coerceObject(storyMetadata.commentReaction);
    const generatedAt = coerceDate(existingReaction?.generatedAt);

    const sourceRows = await db
      .select({
        feedItemId: boardFeedItems.id,
        url: boardFeedItems.url,
        title: boardFeedItems.title,
        summary: boardFeedItems.summary,
        metadataJson: boardFeedItems.metadataJson,
        sourceName: boardSources.name,
        sourceKind: boardSources.kind,
        sourceWeight: boardStorySources.sourceWeight,
      })
      .from(boardStorySources)
      .innerJoin(boardFeedItems, eq(boardStorySources.feedItemId, boardFeedItems.id))
      .innerJoin(boardSources, eq(boardFeedItems.sourceId, boardSources.id))
      .where(eq(boardStorySources.storyId, story.id))
      .orderBy(desc(boardStorySources.sourceWeight), desc(boardFeedItems.publishedAt));

    const youtubeSources = sourceRows
      .filter((row) => row.sourceKind === "youtube_channel" && Boolean(row.url))
      .map((row) => {
        const metadata = coerceObject(row.metadataJson);
        const videoId =
          (typeof metadata?.videoId === "string" ? metadata.videoId : null) ??
          (typeof metadata?.externalId === "string" ? metadata.externalId : null) ??
          extractYouTubeVideoId(row.url ?? "");

        return {
          ...row,
          videoId,
        };
      })
      .filter((row): row is typeof row & { videoId: string } => Boolean(row.videoId))
      .slice(0, BOARD_COMMENT_REACTION_SOURCE_LIMIT);

    const sourceSignature = createHash("sha1")
      .update(
        JSON.stringify(
          youtubeSources.map((source) => ({
            feedItemId: source.feedItemId,
            videoId: source.videoId,
            title: source.title,
          })),
        ),
      )
      .digest("hex");

    if (
      existingReaction &&
      typeof existingReaction.sourceSignature === "string" &&
      existingReaction.sourceSignature === sourceSignature &&
      generatedAt &&
      Date.now() - generatedAt.getTime() <= BOARD_COMMENT_REACTION_CACHE_TTL_MS
    ) {
      continue;
    }

    if (youtubeSources.length === 0) {
      if (existingReaction?.status === "no_supported_sources") {
        continue;
      }

      await db
        .update(boardStoryCandidates)
        .set({
          metadataJson: {
            ...storyMetadata,
            commentReaction: {
              status: "no_supported_sources",
              generatedAt: new Date().toISOString(),
              sourceSignature,
              provider: "youtube_comments",
            },
          },
          updatedAt: new Date(),
        })
        .where(eq(boardStoryCandidates.id, story.id));
      updatedStories += 1;
      continue;
    }

    const gatheredComments = [];
    for (const source of youtubeSources) {
      const comments = await fetchYouTubeComments({
        videoId: source.videoId,
        maxResults: BOARD_COMMENT_REACTION_COMMENT_LIMIT,
      }).catch(() => []);

      for (const comment of comments) {
        const text = comment.textDisplay.replace(/\s+/g, " ").trim();
        if (!text) {
          continue;
        }

        gatheredComments.push({
          sourceTitle: source.title,
          sourceUrl: comment.url,
          parentUrl: source.url ?? comment.url,
          author: comment.authorDisplayName,
          text,
          likeCount: comment.likeCount,
        });
      }
    }

    const topComments = gatheredComments
      .sort((left, right) => {
        if (right.likeCount !== left.likeCount) {
          return right.likeCount - left.likeCount;
        }
        return right.text.length - left.text.length;
      })
      .slice(0, 12);

    if (topComments.length === 0) {
      await db
        .update(boardStoryCandidates)
        .set({
          metadataJson: {
            ...storyMetadata,
            commentReaction: {
              status: "no_comments",
              generatedAt: new Date().toISOString(),
              sourceSignature,
              provider: "youtube_comments",
              analyzedSourceCount: youtubeSources.length,
            },
          },
          updatedAt: new Date(),
        })
        .where(eq(boardStoryCandidates.id, story.id));
      updatedStories += 1;
      continue;
    }

    const analysis = await analyzeBoardStoryComments({
      storyTitle: story.canonicalTitle,
      comments: topComments.map((comment) => ({
        sourceTitle: comment.sourceTitle,
        sourceUrl: comment.sourceUrl,
        author: comment.author,
        text: comment.text,
        likeCount: comment.likeCount,
      })),
    }).catch(() => null);

    if (!analysis) {
      continue;
    }

    const standoutComments = Array.from(
      new Set(analysis.reaction.standoutCommentIndexes),
    )
      .map((index) => topComments[index])
      .filter(Boolean)
      .slice(0, 4)
      .map((comment) => ({
        sourceTitle: comment.sourceTitle,
        sourceUrl: comment.sourceUrl,
        parentUrl: comment.parentUrl,
        author: comment.author,
        text: comment.text,
        likeCount: comment.likeCount,
      }));

    await db
      .update(boardStoryCandidates)
      .set({
        metadataJson: {
          ...storyMetadata,
          commentReaction: {
            status: "ready",
            generatedAt: new Date().toISOString(),
            sourceSignature,
            provider: "youtube_comments",
            model: analysis.model,
            analyzedSourceCount: youtubeSources.length,
            analyzedCommentCount: topComments.length,
            overallTone: analysis.reaction.overallTone,
            intensity: analysis.reaction.intensity,
            summary: analysis.reaction.summary,
            keyThemes: analysis.reaction.keyThemes,
            standoutComments,
          },
        },
        updatedAt: new Date(),
      })
      .where(eq(boardStoryCandidates.id, story.id));
    updatedStories += 1;
  }

  return {
    updatedStories,
  };
}

export async function refreshBoardSourceHeartbeat() {
  await ensureBoardSeedData();

  const db = getDb();
  const now = new Date();
  const sources = await db
    .select({ id: boardSources.id, kind: boardSources.kind, enabled: boardSources.enabled })
    .from(boardSources)
    .where(eq(boardSources.enabled, true));

  await Promise.all(
    sources
      .filter(
        (source) =>
          source.kind !== "rss" &&
          source.kind !== "youtube_channel" &&
          source.kind !== "x_account" &&
          source.kind !== "tiktok_query" &&
          source.kind !== "tiktok_fyp_profile"
      )
      .map((source) =>
        db
          .update(boardSources)
          .set({
            lastPolledAt: now,
            lastSuccessAt: now,
            lastError: null,
            updatedAt: now,
          })
          .where(eq(boardSources.id, source.id))
      )
  );
}

export async function listBoardStories(
  input: ListBoardStoriesInput = {}
): Promise<ListBoardStoriesResult> {
  await ensureBoardSeedData();

  const db = getDb();
  const view = input.view === "controversy" ? "controversy" : "board";
  const timeWindow = input.timeWindow ?? "today";
  const status = input.status ?? null;
  const storyType = input.storyType ?? null;
  const platform = input.platform === "tiktok" ? "tiktok" : "";
  const search = normalizeSearch(input.search);
  const moonFitBand = input.moonFitBand?.trim().toLowerCase() ?? "";
  const moonCluster = input.moonCluster?.trim().toLowerCase() ?? "";
  const coverageMode = input.coverageMode?.trim().toLowerCase() ?? "";
  const vertical = input.vertical?.trim().toLowerCase() ?? "";
  const hasAnalogs = typeof input.hasAnalogs === "boolean" ? input.hasAnalogs : null;
  const minMoonFitScore = typeof input.minMoonFitScore === "number" ? Math.max(0, input.minMoonFitScore) : null;
  const sort =
    input.sort ??
    (view === "controversy"
      ? "controversy"
      : timeWindow === "today"
        ? "live"
        : "storyScore");
  const page = normalizePage(input.page);
  const limit = normalizeLimit(input.limit);

  const filters = [];

  if (status) {
    filters.push(eq(boardStoryCandidates.status, status));
  }

  if (storyType) {
    filters.push(eq(boardStoryCandidates.storyType, storyType));
  }

  if (search.length > 0) {
    const pattern = `%${search}%`;
    const sourceMatch = sql<boolean>`exists (
      select 1
      from ${boardStorySources}
      inner join ${boardFeedItems}
        on ${boardFeedItems.id} = ${boardStorySources.feedItemId}
      where ${boardStorySources.storyId} = ${boardStoryCandidates.id}
        and (
          ${boardFeedItems.title} ilike ${pattern}
          or coalesce(${boardFeedItems.summary}, '') ilike ${pattern}
          or ${boardFeedItems.url} ilike ${pattern}
          or coalesce(${boardFeedItems.author}, '') ilike ${pattern}
        )
    )`;
    filters.push(
      or(
        ilike(boardStoryCandidates.canonicalTitle, pattern),
        ilike(boardStoryCandidates.vertical, pattern),
        sourceMatch
      )
    );
  }

  if (vertical.length > 0) {
    filters.push(ilike(boardStoryCandidates.vertical, `%${vertical}%`));
  }

  if (platform === "tiktok") {
    filters.push(sql<boolean>`exists (
      select 1
      from ${boardStorySources}
      inner join ${boardFeedItems}
        on ${boardFeedItems.id} = ${boardStorySources.feedItemId}
      inner join ${boardSources}
        on ${boardSources.id} = ${boardFeedItems.sourceId}
      where ${boardStorySources.storyId} = ${boardStoryCandidates.id}
        and ${boardSources.kind} in ('tiktok_query', 'tiktok_fyp_profile')
    )`);
  }

  const timeWindowStart = timeWindow !== "all" ? getBoardTimeWindowStart(timeWindow) : null;

  if (timeWindowStart) {
    filters.push(gte(boardStoryCandidates.firstSeenAt, timeWindowStart));
  }

  const where = filters.length > 0 ? and(...filters) : sql`true`;

  // Cap the DB fetch to keep memory under control on a constrained server.
  const dbLimit =
    sort === "live" && timeWindow === "today"
      ? 300
      : timeWindow === "today"
        ? 150
        : timeWindow === "week"
          ? 300
          : 400;

  const persistedBoardVisibilityScore = sql<number>`
    coalesce(nullif(${boardStoryCandidates.scoreJson} ->> 'boardVisibilityScore', '')::int, 0)
  `;
  const persistedMoonFitScore = sql<number>`
    coalesce(nullif(${boardStoryCandidates.scoreJson} ->> 'moonFitScore', '')::int, 0)
  `;

  const orderColumns =
    sort === "controversy"
      ? [
          desc(boardStoryCandidates.controversyScore),
          desc(persistedBoardVisibilityScore),
          desc(boardStoryCandidates.lastSeenAt),
        ]
      : sort === "live"
        ? [
            desc(boardStoryCandidates.lastSeenAt),
            desc(persistedBoardVisibilityScore),
            desc(persistedMoonFitScore),
          ]
      : sort === "recency"
        ? [desc(boardStoryCandidates.lastSeenAt), desc(persistedBoardVisibilityScore)]
        : sort === "moonFit"
          ? [
              desc(persistedMoonFitScore),
              desc(persistedBoardVisibilityScore),
              desc(boardStoryCandidates.lastSeenAt),
            ]
          : [
              desc(persistedBoardVisibilityScore),
              desc(persistedMoonFitScore),
              desc(boardStoryCandidates.lastSeenAt),
            ];

  const rows = await db
    .select()
    .from(boardStoryCandidates)
    .where(where)
    .orderBy(...orderColumns)
    .limit(dbLimit);

  const storyIds = rows.map((row) => row.id);
  const [moonScoreMap, previewsByStory] = await Promise.all([
    getMoonStoryScoresByStoryIds(storyIds),
    getSourcePreviewsForStories(storyIds, { skipVersions: true }),
  ]);
  const rowById = new Map(rows.map((row) => [row.id, row]));
  const summaries = rows
    .map((row) => mapStorySummary(row, previewsByStory.get(row.id) ?? [], moonScoreMap.get(row.id) ?? null))
    .filter((story) => {
      if (
        search.length === 0 &&
        !passesCoreLiveBoardStoryFilters({
          story,
          sourceRow: rowById.get(story.id) ?? null,
          minFreshnessDate: timeWindowStart,
          sort,
        })
      ) {
        return false;
      }

      if (moonFitBand && story.moonFitBand.toLowerCase() !== moonFitBand) {
        return false;
      }

      if (moonCluster && !(story.moonCluster ?? "").toLowerCase().includes(moonCluster)) {
        return false;
      }

      if (coverageMode && !(story.coverageMode ?? "").toLowerCase().includes(coverageMode)) {
        return false;
      }

      if (hasAnalogs !== null) {
        const hasAnyAnalogs = story.analogTitles.length > 0;
        if (hasAnalogs !== hasAnyAnalogs) {
          return false;
        }
      }

      if (minMoonFitScore !== null && story.moonFitScore < minMoonFitScore) {
        return false;
      }

      return true;
    });

  summaries.sort((left, right) => {
    const leftBoardVisibility =
      typeof coerceObject(left.scoreJson)?.boardVisibilityScore === "number"
        ? (coerceObject(left.scoreJson)?.boardVisibilityScore as number)
        : 0;
    const rightBoardVisibility =
      typeof coerceObject(right.scoreJson)?.boardVisibilityScore === "number"
        ? (coerceObject(right.scoreJson)?.boardVisibilityScore as number)
        : 0;

    switch (sort) {
      case "controversy":
        return (
          right.controversyScore - left.controversyScore ||
          rightBoardVisibility - leftBoardVisibility ||
          right.moonFitScore - left.moonFitScore ||
          (Date.parse(right.lastSeenAt ?? "") || 0) - (Date.parse(left.lastSeenAt ?? "") || 0)
        );
      case "recency":
        return (Date.parse(right.lastSeenAt ?? "") || 0) - (Date.parse(left.lastSeenAt ?? "") || 0);
      case "live":
        return compareBoardLiveFeedStories(left, right);
      case "views":
        return (right.analogMedianViews ?? 0) - (left.analogMedianViews ?? 0) || right.moonFitScore - left.moonFitScore;
      case "analogs":
        return right.analogTitles.length - left.analogTitles.length || right.moonFitScore - left.moonFitScore;
      case "storyScore":
        return (
          rightBoardVisibility - leftBoardVisibility ||
          right.moonFitScore - left.moonFitScore ||
          right.controversyScore - left.controversyScore ||
          (Date.parse(right.lastSeenAt ?? "") || 0) - (Date.parse(left.lastSeenAt ?? "") || 0)
        );
      case "moonFit":
      default:
        return (
          right.moonFitScore - left.moonFitScore ||
          rightBoardVisibility - leftBoardVisibility ||
          right.controversyScore - left.controversyScore ||
          (Date.parse(right.lastSeenAt ?? "") || 0) - (Date.parse(left.lastSeenAt ?? "") || 0)
        );
    }
  });

  const dedupedSummaries = dedupeHeuristicBoardStories(
    dedupeExactBoardStoryTitles(summaries)
  );
  const totalCount = dedupedSummaries.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / limit));
  const offset = (page - 1) * limit;
  const stories = dedupedSummaries.slice(offset, offset + limit);
  const unscoredVisibleStoryIds = stories
    .filter((story) => {
      const scoreJson = coerceObject(story.scoreJson);
      return !(typeof scoreJson?.lastScoredAt === "string" && scoreJson.lastScoredAt.length > 0);
    })
    .map((story) => story.id);

  if (
    process.env.ENABLE_BOARD_READ_RESCORING === "true" &&
    unscoredVisibleStoryIds.length > 0
  ) {
    scheduleBoardDeferredRescore(unscoredVisibleStoryIds);
  }

  return {
    stories,
    pageInfo: {
      page,
      limit,
      totalCount,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
    },
    query: {
      view,
      timeWindow,
      status,
      storyType,
      platform,
      search,
      moonFitBand,
      moonCluster,
      coverageMode,
      vertical,
      hasAnalogs,
      minMoonFitScore,
      sort,
    },
  };
}

export async function getBoardStoryDetail(storyIdOrSlug: string): Promise<BoardStoryDetail | null> {
  await ensureBoardSeedData();

  const db = getDb();
  const story = await resolveStoryRecord(storyIdOrSlug);

  if (!story) {
    return null;
  }

  const [previewsByStory, aiOutputRows, queueRows, moonAnalysis] = await Promise.all([
    getSourcePreviewsForStories([story.id]),
    db
      .select()
      .from(boardStoryAiOutputs)
      .where(eq(boardStoryAiOutputs.storyId, story.id))
      .orderBy(desc(boardStoryAiOutputs.updatedAt)),
    db
      .select()
      .from(boardQueueItems)
      .where(eq(boardQueueItems.storyId, story.id))
      .limit(1),
    scoreBoardStoryWithMoonCorpus(story.id),
  ]);

  const sources = previewsByStory.get(story.id) ?? [];
  const feedItemIds = Array.from(new Set(sources.map((source) => source.feedItemId)));
  const aiOutputs = Object.fromEntries(
    BOARD_AI_KINDS.map((kind) => [kind, null])
  ) as BoardStoryDetail["aiOutputs"];
  const versionHistoryRows =
    feedItemIds.length > 0
      ? await db
          .select({
            id: boardFeedItemVersions.id,
            feedItemId: boardFeedItemVersions.feedItemId,
            sourceName: boardSources.name,
            title: boardFeedItemVersions.title,
            diffSummary: boardFeedItemVersions.diffSummary,
            isCorrection: boardFeedItemVersions.isCorrection,
            versionNumber: boardFeedItemVersions.versionNumber,
            capturedAt: boardFeedItemVersions.capturedAt,
          })
          .from(boardFeedItemVersions)
          .innerJoin(boardFeedItems, eq(boardFeedItems.id, boardFeedItemVersions.feedItemId))
          .innerJoin(boardSources, eq(boardSources.id, boardFeedItems.sourceId))
          .where(inArray(boardFeedItemVersions.feedItemId, feedItemIds))
          .orderBy(
            desc(boardFeedItemVersions.capturedAt),
            desc(boardFeedItemVersions.versionNumber)
          )
      : [];

  for (const row of aiOutputRows) {
    if (aiOutputs[row.kind]) {
      continue;
    }

    const metadata = coerceObject(row.metadataJson);
    const items =
      Array.isArray(metadata?.items) && metadata.items.every((item) => typeof item === "string")
        ? (metadata.items as string[])
        : row.content
            .split("\n")
            .map((item) => item.trim())
            .filter(Boolean);

    aiOutputs[row.kind] = {
      kind: row.kind,
      content: row.content,
      items,
      model: row.model,
      promptVersion: row.promptVersion,
      updatedAt: toIsoString(row.updatedAt) ?? new Date().toISOString(),
    };
  }

  const queueItem = queueRows[0]
    ? {
        id: queueRows[0].id,
        position: queueRows[0].position,
        status: queueRows[0].status,
        format: queueRows[0].format,
        targetPublishAt: toIsoString(queueRows[0].targetPublishAt),
        assignedTo: queueRows[0].assignedTo,
        notes: queueRows[0].notes,
        linkedProjectId: queueRows[0].linkedProjectId,
      }
    : null;
  const moonScore = (await getMoonStoryScoresByStoryIds([story.id])).get(story.id) ?? null;
  const storySummary = mapStorySummary(story, sources, moonScore);

  return {
    story: storySummary,
    sources,
    versionHistory: versionHistoryRows.map((row) => ({
      id: row.id,
      feedItemId: row.feedItemId,
      sourceName: row.sourceName,
      title: row.title,
      diffSummary: row.diffSummary,
      isCorrection: row.isCorrection,
      versionNumber: row.versionNumber,
      capturedAt: toIsoString(row.capturedAt) ?? new Date().toISOString(),
    })),
    moonAnalysis: moonAnalysis
      ? {
          moonFitScore: moonAnalysis.moonFitScore,
          moonFitBand: moonAnalysis.moonFitBand,
          clusterKey: moonAnalysis.clusterKey,
          clusterLabel: moonAnalysis.clusterLabel,
          coverageMode: moonAnalysis.coverageMode,
          analogs: moonAnalysis.analogs.map((analog) => ({
            clipId: analog.clipId,
            title: analog.title,
            sourceUrl: analog.sourceUrl,
            previewUrl: analog.previewUrl,
            uploadDate: analog.uploadDate,
            durationMs: analog.durationMs,
            viewCount: analog.viewCount,
            similarityScore: analog.similarityScore,
          })),
          analogMedianViews: moonAnalysis.analogMedianViews,
          analogMedianDurationMinutes: moonAnalysis.analogMedianDurationMinutes,
          reasonCodes: moonAnalysis.reasonCodes,
          disqualifierCodes: moonAnalysis.disqualifierCodes,
        }
      : null,
    aiOutputs,
    formatRecommendation: storySummary.formatRecommendation,
    queueItem,
  };
}

export async function getBoardStoryAiOutput(
  storyIdOrSlug: string,
  kind: BoardAiOutputKind
) {
  const detail = await getBoardStoryDetail(storyIdOrSlug);
  return detail?.aiOutputs[kind] ?? null;
}

export async function setBoardStoryEditorialFeedback(
  storyIdOrSlug: string,
  input: {
    irrelevant: boolean;
  }
): Promise<BoardStorySummary | null> {
  await ensureBoardSeedData();

  const db = getDb();
  const story = await resolveStoryRecord(storyIdOrSlug);

  if (!story) {
    return null;
  }

  const now = new Date();
  const nowIso = now.toISOString();
  const metadata = coerceObject(story.metadataJson) ?? {};
  const editorialFeedback = coerceObject(metadata.editorialFeedback) ?? {};

  await db
    .update(boardStoryCandidates)
    .set({
      metadataJson: {
        ...metadata,
        editorialFeedback: {
          ...editorialFeedback,
          irrelevant: input.irrelevant,
          relevanceLabel: input.irrelevant ? "irrelevant" : "candidate",
          markedAt: input.irrelevant ? nowIso : null,
          updatedAt: nowIso,
          source: "board_ui",
        },
      },
      updatedAt: now,
    })
    .where(eq(boardStoryCandidates.id, story.id));

  await scoreBoardStoriesWithMoonCorpus([story.id]);

  const [updatedStory, previewsByStory, moonScoreMap] = await Promise.all([
    resolveStoryRecord(story.id),
    getSourcePreviewsForStories([story.id]),
    getMoonStoryScoresByStoryIds([story.id]),
  ]);

  if (!updatedStory) {
    return null;
  }

  return mapStorySummary(
    updatedStory,
    previewsByStory.get(updatedStory.id) ?? [],
    moonScoreMap.get(updatedStory.id) ?? null
  );
}

export async function ensureBoardStoryAiOutput(
  storyIdOrSlug: string,
  kind: BoardAiOutputKind
) {
  await ensureBoardSeedData();

  const db = getDb();
  const story = await resolveStoryRecord(storyIdOrSlug);

  if (!story) {
    return null;
  }

  const [existing] = await db
    .select()
    .from(boardStoryAiOutputs)
    .where(
      and(
        eq(boardStoryAiOutputs.storyId, story.id),
        eq(boardStoryAiOutputs.kind, kind)
      )
    )
    .orderBy(desc(boardStoryAiOutputs.updatedAt))
    .limit(1);

  const existingMetadata = coerceObject(existing?.metadataJson);
  const currentPromptVersion = getBoardAiPromptVersion(kind);
  const expiresAt =
    typeof existingMetadata?.expiresAt === "string"
      ? Date.parse(existingMetadata.expiresAt)
      : Number.NaN;
  const storyLastSeenAt = coerceDate(story.lastSeenAt)?.getTime() ?? 0;
  const outputUpdatedAt = coerceDate(existing?.updatedAt)?.getTime() ?? 0;
  const isFresh =
    Boolean(existing) &&
    existing.promptVersion === currentPromptVersion &&
    (Number.isNaN(expiresAt) ? outputUpdatedAt >= storyLastSeenAt : expiresAt > Date.now()) &&
    outputUpdatedAt >= storyLastSeenAt;

  if (existing && isFresh) {
    return {
      kind: existing.kind,
      content: existing.content,
      items:
        Array.isArray(existingMetadata?.items) &&
        existingMetadata.items.every((item) => typeof item === "string")
          ? (existingMetadata.items as string[])
          : existing.content
              .split("\n")
              .map((item) => item.trim())
              .filter(Boolean),
      model: existing.model,
      promptVersion: existing.promptVersion,
      updatedAt: toIsoString(existing.updatedAt) ?? new Date().toISOString(),
    };
  }

  const detail = await getBoardStoryDetail(story.id);
  if (!detail) {
    return null;
  }

  const moonStyleGuide = await getMoonEditorialStyleGuide({
    analogClipIds: detail.moonAnalysis?.analogs.map((analog) => analog.clipId) ?? [],
    coverageMode: detail.moonAnalysis?.coverageMode ?? null,
  });

  const generated = await generateBoardAiOutput({
    kind,
    story: {
      canonicalTitle: detail.story.canonicalTitle,
      vertical: detail.story.vertical,
      storyType: detail.story.storyType,
      controversyScore: detail.story.controversyScore,
      sentimentScore: detail.story.sentimentScore,
      surgeScore: detail.story.surgeScore,
      itemsCount: detail.story.itemsCount,
      sourcesCount: detail.story.sourcesCount,
      correction: detail.story.correction,
      metadataJson: detail.story.metadataJson,
    },
    sources: detail.sources.map((source) => ({
      name: source.name,
      title: source.title,
      url: source.url,
      publishedAt: source.publishedAt,
      sourceWeight: source.sourceWeight,
      sourceType: source.sourceType,
      summary: null,
    })),
    recommendation: detail.formatRecommendation,
    moonContext: {
      moonFitScore: detail.story.moonFitScore,
      moonFitBand: detail.story.moonFitBand,
      clusterLabel: detail.story.moonCluster,
      coverageMode: detail.story.coverageMode,
      analogTitles:
        detail.moonAnalysis?.analogs.map((analog) => analog.title) ?? detail.story.analogTitles,
      dominantCoverageModes: moonStyleGuide.dominantCoverageModes,
      exemplarTitles: moonStyleGuide.exemplarTitles,
      storySpecificNotes: moonStyleGuide.storySpecificNotes,
    },
  });

  await db
    .insert(boardStoryAiOutputs)
    .values({
      storyId: story.id,
      kind,
      promptVersion: generated.promptVersion,
      model: generated.model,
      content: generated.content,
      metadataJson: generated.metadataJson,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [
        boardStoryAiOutputs.storyId,
        boardStoryAiOutputs.kind,
        boardStoryAiOutputs.promptVersion,
      ],
      set: {
        content: generated.content,
        metadataJson: generated.metadataJson,
        model: generated.model,
        updatedAt: new Date(),
      },
    });

  return {
    kind: generated.kind,
    content: generated.content,
    items: generated.items,
    model: generated.model,
    promptVersion: generated.promptVersion,
    updatedAt: new Date().toISOString(),
  };
}

export async function addBoardStoryToQueue(storyIdOrSlug: string) {
  await ensureBoardSeedData();

  const db = getDb();
  const story = await resolveStoryRecord(storyIdOrSlug);

  if (!story) {
    return null;
  }

  const [existing] = await db
    .select()
    .from(boardQueueItems)
    .where(eq(boardQueueItems.storyId, story.id))
    .limit(1);

  if (existing) {
    return existing;
  }

  const [positionRow] = await db
    .select({
      maxPosition: sql<number>`coalesce(max(${boardQueueItems.position}), 0)::int`,
    })
    .from(boardQueueItems);

  const formatRecommendation = buildBoardFormatRecommendation({
    story: {
      storyType: story.storyType,
      surgeScore: story.surgeScore,
      controversyScore: story.controversyScore,
      itemsCount: story.itemsCount,
      sourcesCount: story.sourcesCount,
      correction: story.correction,
      lastSeenAt: toIsoString(story.lastSeenAt),
      vertical: story.vertical,
    },
    sources: [],
    fallbackFormats: coerceStringArray(story.formatsJson),
  });
  const [queueItem] = await db
    .insert(boardQueueItems)
    .values({
      storyId: story.id,
      position: (positionRow?.maxPosition ?? 0) + 1,
      status: "watching",
      format: formatRecommendation.packageLabel || null,
      targetPublishAt: null,
      assignedTo: null,
      notes: "Added from board story detail.",
      updatedAt: new Date(),
    })
    .returning();

  return queueItem;
}

export async function updateBoardQueueItem(
  queueItemId: string,
  input: {
    position?: number;
    status?: typeof boardQueueItems.$inferInsert.status;
    format?: string | null;
    assignedTo?: string | null;
    notes?: string | null;
    targetPublishAt?: Date | null;
  }
) {
  await ensureBoardSeedData();

  const db = getDb();
  const [existing] = await db
    .select()
    .from(boardQueueItems)
    .where(eq(boardQueueItems.id, queueItemId))
    .limit(1);

  if (!existing) {
    return null;
  }

  const [updated] = await db
    .update(boardQueueItems)
    .set({
      position: input.position ?? existing.position,
      status: input.status ?? existing.status,
      format: input.format === undefined ? existing.format : input.format,
      assignedTo:
        input.assignedTo === undefined ? existing.assignedTo : input.assignedTo,
      notes: input.notes === undefined ? existing.notes : input.notes,
      targetPublishAt:
        input.targetPublishAt === undefined
          ? existing.targetPublishAt
          : input.targetPublishAt,
      updatedAt: new Date(),
    })
    .where(eq(boardQueueItems.id, queueItemId))
    .returning();

  return updated;
}

function buildProjectLinesFromScript(storyTitle: string, scriptText: string) {
  const cleaned = scriptText.trim();
  const paragraphs = cleaned
    ? cleaned.split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean)
    : [storyTitle];

  return paragraphs.map((paragraph, index) => ({
    lineKey: `board-${slugify(storyTitle)}-${index + 1}`,
    lineIndex: index,
    timestampStartMs: index * 8000,
    durationMs: 8000,
    text: paragraph,
    lineType: "narration" as const,
    researchStatus: (index === 0 ? "complete" : "pending") as
      | "pending"
      | "complete",
    footageStatus: "pending" as const,
    imageStatus: "pending" as const,
    videoStatus: "pending" as const,
  }));
}

export async function createProjectFromBoardStory(storyIdOrSlug: string) {
  const detail = await getBoardStoryDetail(storyIdOrSlug);

  if (!detail) {
    return null;
  }

  if (detail.queueItem?.linkedProjectId) {
    return {
      projectId: detail.queueItem.linkedProjectId,
      created: false,
    };
  }

  const story = detail.story;
  const scriptStarter = detail.aiOutputs.script_starter?.content ?? story.canonicalTitle;
  const created = await createProject({
    title: story.canonicalTitle,
    rawScript: scriptStarter,
    lines: buildProjectLinesFromScript(story.canonicalTitle, scriptStarter),
  });

  const queueItem =
    (await addBoardStoryToQueue(story.id)) ??
    (await getBoardStoryDetail(story.id))?.queueItem;

  if (queueItem?.id) {
    const db = getDb();
    await db
      .update(boardQueueItems)
      .set({
        linkedProjectId: created.project.id,
        updatedAt: new Date(),
      })
      .where(eq(boardQueueItems.id, queueItem.id));
  }

  return {
    projectId: created.project.id,
    created: true,
  };
}

export async function mergeBoardStories(input: {
  targetStoryIdOrSlug: string;
  sourceStoryIdsOrSlugs: string[];
}): Promise<MergeBoardStoriesResult> {
  await ensureBoardSeedData();

  const targetStory = await resolveStoryRecord(input.targetStoryIdOrSlug);
  if (!targetStory) {
    throw buildBoardStoryOperationError(404, "Target story not found");
  }

  const uniqueSourceIdsOrSlugs = Array.from(
    new Set(input.sourceStoryIdsOrSlugs.map((value) => value.trim()).filter(Boolean))
  );

  if (uniqueSourceIdsOrSlugs.length === 0) {
    throw buildBoardStoryOperationError(400, "At least one source story is required");
  }

  const sourceStories = (
    await Promise.all(uniqueSourceIdsOrSlugs.map((value) => resolveStoryRecord(value)))
  ).filter((story): story is NonNullable<typeof targetStory> => Boolean(story));

  if (sourceStories.length !== uniqueSourceIdsOrSlugs.length) {
    throw buildBoardStoryOperationError(404, "One or more source stories were not found");
  }

  const filteredSourceStories = sourceStories.filter((story) => story.id !== targetStory.id);
  if (filteredSourceStories.length === 0) {
    throw buildBoardStoryOperationError(
      400,
      "Source stories must be different from the target story"
    );
  }

  const db = getDb();
  const sourceStoryIds = filteredSourceStories.map((story) => story.id);
  const sourceStorySlugs = filteredSourceStories.map((story) => story.slug);
  let movedFeedItemCount = 0;
  let dedupedFeedItemCount = 0;

  await db.transaction(async (tx) => {
    const [targetRelations, sourceRelations] = await Promise.all([
      tx
        .select({
          id: boardStorySources.id,
          feedItemId: boardStorySources.feedItemId,
        })
        .from(boardStorySources)
        .where(eq(boardStorySources.storyId, targetStory.id)),
      tx
        .select({
          id: boardStorySources.id,
          storyId: boardStorySources.storyId,
          feedItemId: boardStorySources.feedItemId,
        })
        .from(boardStorySources)
        .where(inArray(boardStorySources.storyId, sourceStoryIds)),
    ]);

    const targetFeedItemIds = new Set(targetRelations.map((row) => row.feedItemId));
    const relationIdsToMove: string[] = [];
    const relationIdsToDelete: string[] = [];

    for (const relation of sourceRelations) {
      if (targetFeedItemIds.has(relation.feedItemId)) {
        relationIdsToDelete.push(relation.id);
        dedupedFeedItemCount += 1;
        continue;
      }

      targetFeedItemIds.add(relation.feedItemId);
      relationIdsToMove.push(relation.id);
      movedFeedItemCount += 1;
    }

    if (relationIdsToDelete.length > 0) {
      await tx
        .delete(boardStorySources)
        .where(inArray(boardStorySources.id, relationIdsToDelete));
    }

    if (relationIdsToMove.length > 0) {
      await tx
        .update(boardStorySources)
        .set({ storyId: targetStory.id })
        .where(inArray(boardStorySources.id, relationIdsToMove));
    }

    const [targetOutputs, sourceOutputs] = await Promise.all([
      tx
        .select({
          id: boardStoryAiOutputs.id,
          kind: boardStoryAiOutputs.kind,
          promptVersion: boardStoryAiOutputs.promptVersion,
        })
        .from(boardStoryAiOutputs)
        .where(eq(boardStoryAiOutputs.storyId, targetStory.id)),
      tx
        .select({
          id: boardStoryAiOutputs.id,
          kind: boardStoryAiOutputs.kind,
          promptVersion: boardStoryAiOutputs.promptVersion,
          updatedAt: boardStoryAiOutputs.updatedAt,
        })
        .from(boardStoryAiOutputs)
        .where(inArray(boardStoryAiOutputs.storyId, sourceStoryIds))
        .orderBy(desc(boardStoryAiOutputs.updatedAt)),
    ]);

    const outputKeys = new Set(
      targetOutputs.map((row) => `${row.kind}:${row.promptVersion}`)
    );
    const outputIdsToDelete: string[] = [];
    const outputIdsToMove: string[] = [];

    for (const output of sourceOutputs) {
      const key = `${output.kind}:${output.promptVersion}`;
      if (outputKeys.has(key)) {
        outputIdsToDelete.push(output.id);
        continue;
      }

      outputKeys.add(key);
      outputIdsToMove.push(output.id);
    }

    if (outputIdsToDelete.length > 0) {
      await tx
        .delete(boardStoryAiOutputs)
        .where(inArray(boardStoryAiOutputs.id, outputIdsToDelete));
    }

    if (outputIdsToMove.length > 0) {
      await tx
        .update(boardStoryAiOutputs)
        .set({ storyId: targetStory.id, updatedAt: new Date() })
        .where(inArray(boardStoryAiOutputs.id, outputIdsToMove));
    }

    const [targetQueueRows, sourceQueueRows] = await Promise.all([
      tx
        .select()
        .from(boardQueueItems)
        .where(eq(boardQueueItems.storyId, targetStory.id))
        .orderBy(desc(boardQueueItems.updatedAt))
        .limit(1),
      tx
        .select()
        .from(boardQueueItems)
        .where(inArray(boardQueueItems.storyId, sourceStoryIds))
        .orderBy(desc(boardQueueItems.updatedAt)),
    ]);

    const targetQueue = targetQueueRows[0] ?? null;
    if (!targetQueue && sourceQueueRows.length > 0) {
      const [firstSourceQueue, ...remainingSourceQueueRows] = sourceQueueRows;
      const mergedNotes = mergeUniqueStrings([
        firstSourceQueue.notes,
        ...remainingSourceQueueRows.map((row) => row.notes),
      ]).join("\n\n");
      const mergedFormats = mergeUniqueStrings([
        firstSourceQueue.format,
        ...remainingSourceQueueRows.map((row) => row.format),
      ]).join(" + ");
      const preferredStatus =
        chooseMergedQueueStatus([
          firstSourceQueue.status,
          ...remainingSourceQueueRows.map((row) => row.status),
        ]) ?? firstSourceQueue.status;
      const earliestTargetPublishAt = [
        firstSourceQueue.targetPublishAt,
        ...remainingSourceQueueRows.map((row) => row.targetPublishAt),
      ]
        .map((value) => coerceDate(value))
        .filter((value): value is Date => Boolean(value))
        .sort((left, right) => left.getTime() - right.getTime())[0] ?? null;
      const assignedTo =
        firstSourceQueue.assignedTo ??
        remainingSourceQueueRows.find((row) => row.assignedTo)?.assignedTo ??
        null;
      const linkedProjectId =
        firstSourceQueue.linkedProjectId ??
        remainingSourceQueueRows.find((row) => row.linkedProjectId)?.linkedProjectId ??
        null;

      await tx
        .update(boardQueueItems)
        .set({
          storyId: targetStory.id,
          status: preferredStatus as typeof boardQueueItems.$inferInsert.status,
          format: mergedFormats || null,
          assignedTo,
          linkedProjectId,
          notes: mergedNotes || null,
          targetPublishAt: earliestTargetPublishAt,
          updatedAt: new Date(),
        })
        .where(eq(boardQueueItems.id, firstSourceQueue.id));

      if (remainingSourceQueueRows.length > 0) {
        await tx
          .delete(boardQueueItems)
          .where(inArray(boardQueueItems.id, remainingSourceQueueRows.map((row) => row.id)));
      }
    } else if (targetQueue && sourceQueueRows.length > 0) {
      const mergedNotes = mergeUniqueStrings([
        targetQueue.notes,
        ...sourceQueueRows.map((row) => row.notes),
      ]).join("\n\n");
      const mergedFormats = mergeUniqueStrings([
        targetQueue.format,
        ...sourceQueueRows.map((row) => row.format),
      ]).join(" + ");
      const preferredStatus =
        chooseMergedQueueStatus([targetQueue.status, ...sourceQueueRows.map((row) => row.status)]) ??
        targetQueue.status;
      const earliestTargetPublishAt = [targetQueue.targetPublishAt, ...sourceQueueRows.map((row) => row.targetPublishAt)]
        .map((value) => coerceDate(value))
        .filter((value): value is Date => Boolean(value))
        .sort((left, right) => left.getTime() - right.getTime())[0] ?? null;
      const assignedTo =
        targetQueue.assignedTo ??
        sourceQueueRows.find((row) => row.assignedTo)?.assignedTo ??
        null;
      const linkedProjectId =
        targetQueue.linkedProjectId ??
        sourceQueueRows.find((row) => row.linkedProjectId)?.linkedProjectId ??
        null;

      await tx
        .update(boardQueueItems)
        .set({
          status: preferredStatus as typeof boardQueueItems.$inferInsert.status,
          format: mergedFormats || null,
          assignedTo,
          linkedProjectId,
          notes: mergedNotes || null,
          targetPublishAt: earliestTargetPublishAt,
          updatedAt: new Date(),
        })
        .where(eq(boardQueueItems.id, targetQueue.id));

      await tx
        .delete(boardQueueItems)
        .where(inArray(boardQueueItems.id, sourceQueueRows.map((row) => row.id)));
    }

    const [targetAlerts, sourceAlerts] = await Promise.all([
      tx
        .select({
          id: boardSurgeAlerts.id,
          alertType: boardSurgeAlerts.alertType,
        })
        .from(boardSurgeAlerts)
        .where(
          and(
            eq(boardSurgeAlerts.storyId, targetStory.id),
            isNull(boardSurgeAlerts.dismissedAt)
          )
        ),
      tx
        .select({
          id: boardSurgeAlerts.id,
          alertType: boardSurgeAlerts.alertType,
          dismissedAt: boardSurgeAlerts.dismissedAt,
        })
        .from(boardSurgeAlerts)
        .where(inArray(boardSurgeAlerts.storyId, sourceStoryIds)),
    ]);

    const activeTargetAlertTypes = new Set(targetAlerts.map((row) => row.alertType));
    const sourceAlertIdsToDelete: string[] = [];
    const sourceAlertIdsToMove: string[] = [];

    for (const alert of sourceAlerts) {
      if (!alert.dismissedAt && activeTargetAlertTypes.has(alert.alertType)) {
        sourceAlertIdsToDelete.push(alert.id);
        continue;
      }

      if (!alert.dismissedAt) {
        activeTargetAlertTypes.add(alert.alertType);
      }
      sourceAlertIdsToMove.push(alert.id);
    }

    if (sourceAlertIdsToDelete.length > 0) {
      await tx
        .delete(boardSurgeAlerts)
        .where(inArray(boardSurgeAlerts.id, sourceAlertIdsToDelete));
    }

    if (sourceAlertIdsToMove.length > 0) {
      await tx
        .update(boardSurgeAlerts)
        .set({ storyId: targetStory.id, updatedAt: new Date() })
        .where(inArray(boardSurgeAlerts.id, sourceAlertIdsToMove));
    }

    await tx
      .update(boardTickerEvents)
      .set({ storyId: targetStory.id })
      .where(inArray(boardTickerEvents.storyId, sourceStoryIds));

    const mergedDiscordBoardNotifications = Object.assign(
      {},
      ...filteredSourceStories.map(
        (story) =>
          coerceObject(
            coerceObject(story.metadataJson)?.[BOARD_DISCORD_NOTIFICATION_METADATA_KEY]
          ) ?? {}
      ),
      coerceObject(
        coerceObject(targetStory.metadataJson)?.[BOARD_DISCORD_NOTIFICATION_METADATA_KEY]
      ) ?? {}
    );
    const targetMetadata = {
      ...(coerceObject(targetStory.metadataJson) ?? {}),
      mergedStoryIds: mergeUniqueStrings([
        ...(coerceStringArray(coerceObject(targetStory.metadataJson)?.mergedStoryIds) ?? []),
        ...sourceStoryIds,
      ]),
      mergedStorySlugs: mergeUniqueStrings([
        ...(coerceStringArray(coerceObject(targetStory.metadataJson)?.mergedStorySlugs) ?? []),
        ...sourceStorySlugs,
      ]),
      lastMergedAt: new Date().toISOString(),
      ...(Object.keys(mergedDiscordBoardNotifications).length > 0
        ? {
            [BOARD_DISCORD_NOTIFICATION_METADATA_KEY]:
              mergedDiscordBoardNotifications,
          }
        : {}),
    };

    await tx
      .update(boardStoryCandidates)
      .set({
        metadataJson: targetMetadata,
        updatedAt: new Date(),
      })
      .where(eq(boardStoryCandidates.id, targetStory.id));

    await tx
      .delete(boardStoryCandidates)
      .where(inArray(boardStoryCandidates.id, sourceStoryIds));
  });

  await recomputeBoardStoryMetrics([targetStory.id]);
  await detectBoardStoryAlerts();

  const updatedTargetStory = await getBoardStoryDetail(targetStory.id);
  if (!updatedTargetStory) {
    throw buildBoardStoryOperationError(500, "Merged story could not be loaded");
  }

  return {
    targetStory: updatedTargetStory,
    mergedStoryIds: sourceStoryIds,
    mergedStorySlugs: sourceStorySlugs,
    dedupedFeedItemCount,
    movedFeedItemCount,
  };
}

export async function splitBoardStory(input: {
  storyIdOrSlug: string;
  feedItemIds: string[];
  canonicalTitle?: string;
}): Promise<SplitBoardStoryResult> {
  await ensureBoardSeedData();

  const sourceStory = await resolveStoryRecord(input.storyIdOrSlug);
  if (!sourceStory) {
    throw buildBoardStoryOperationError(404, "Story not found");
  }

  const uniqueFeedItemIds = Array.from(
    new Set(input.feedItemIds.map((value) => value.trim()).filter(Boolean))
  );

  if (uniqueFeedItemIds.length === 0) {
    throw buildBoardStoryOperationError(400, "At least one feed item is required");
  }

  const db = getDb();
  const [allRelations, selectedRelations] = await Promise.all([
    db
      .select({
        relationId: boardStorySources.id,
        feedItemId: boardStorySources.feedItemId,
      })
      .from(boardStorySources)
      .where(eq(boardStorySources.storyId, sourceStory.id)),
    db
      .select({
        relationId: boardStorySources.id,
        feedItemId: boardStorySources.feedItemId,
        title: boardFeedItems.title,
        url: boardFeedItems.url,
        author: boardFeedItems.author,
        publishedAt: boardFeedItems.publishedAt,
        sourceId: boardFeedItems.sourceId,
        summary: boardFeedItems.summary,
      })
      .from(boardStorySources)
      .innerJoin(boardFeedItems, eq(boardFeedItems.id, boardStorySources.feedItemId))
      .where(
        and(
          eq(boardStorySources.storyId, sourceStory.id),
          inArray(boardStorySources.feedItemId, uniqueFeedItemIds)
        )
      )
      .orderBy(desc(boardFeedItems.publishedAt)),
  ]);

  if (selectedRelations.length === 0) {
    throw buildBoardStoryOperationError(
      404,
      "None of the selected feed items belong to this story"
    );
  }

  if (selectedRelations.length === allRelations.length) {
    throw buildBoardStoryOperationError(
      400,
      "Split requires leaving at least one feed item on the original story"
    );
  }

  const selectedDates = selectedRelations
    .map((relation) => coerceDate(relation.publishedAt))
    .filter((value): value is Date => Boolean(value));
  const canonicalTitle =
    input.canonicalTitle?.trim() || selectedRelations[0]?.title || sourceStory.canonicalTitle;
  const splitStoryType = inferBoardStoryType(canonicalTitle);
  const splitSlug = buildBoardStorySlug(
    canonicalTitle,
    `split:${sourceStory.id}:${selectedRelations[0]?.feedItemId ?? Date.now()}`
  );
  const sourceMetadata = coerceObject(sourceStory.metadataJson) ?? {};

  const [createdStory] = await db
    .insert(boardStoryCandidates)
    .values({
      slug: splitSlug,
      canonicalTitle,
      vertical: sourceStory.vertical,
      status: sourceStory.status === "archived" ? "developing" : sourceStory.status,
      storyType: splitStoryType,
      surgeScore: sourceStory.surgeScore,
      controversyScore: sourceStory.controversyScore,
      sentimentScore: sourceStory.sentimentScore,
      itemsCount: 0,
      sourcesCount: 0,
      correction: splitStoryType === "correction" || sourceStory.correction,
      formatsJson: sourceStory.formatsJson,
      firstSeenAt:
        selectedDates.sort((left, right) => left.getTime() - right.getTime())[0] ??
        sourceStory.firstSeenAt,
      lastSeenAt:
        selectedDates.sort((left, right) => right.getTime() - left.getTime())[0] ??
        sourceStory.lastSeenAt,
      scoreJson: {
        ...(coerceObject(sourceStory.scoreJson) ?? {}),
        splitFromStoryId: sourceStory.id,
        splitFromStorySlug: sourceStory.slug,
      },
      metadataJson: {
        ...sourceMetadata,
        splitFromStoryId: sourceStory.id,
        splitFromStorySlug: sourceStory.slug,
        splitFeedItemIds: selectedRelations.map((relation) => relation.feedItemId),
        lastSplitAt: new Date().toISOString(),
      },
      updatedAt: new Date(),
    })
    .returning({ id: boardStoryCandidates.id, slug: boardStoryCandidates.slug });

  await db
    .update(boardStorySources)
    .set({ storyId: createdStory.id })
    .where(inArray(boardStorySources.id, selectedRelations.map((relation) => relation.relationId)));

  await db
    .update(boardStoryCandidates)
    .set({
      metadataJson: {
        ...sourceMetadata,
        splitChildStoryIds: mergeUniqueStrings([
          ...(coerceStringArray(sourceMetadata.splitChildStoryIds) ?? []),
          createdStory.id,
        ]),
        splitChildStorySlugs: mergeUniqueStrings([
          ...(coerceStringArray(sourceMetadata.splitChildStorySlugs) ?? []),
          createdStory.slug,
        ]),
        lastSplitAt: new Date().toISOString(),
      },
      updatedAt: new Date(),
    })
    .where(eq(boardStoryCandidates.id, sourceStory.id));

  await recomputeBoardStoryMetrics([sourceStory.id, createdStory.id]);
  await detectBoardStoryAlerts();

  const newStory = await getBoardStoryDetail(createdStory.id);
  if (!newStory) {
    throw buildBoardStoryOperationError(500, "Split story could not be loaded");
  }

  return {
    sourceStoryId: sourceStory.id,
    sourceStorySlug: sourceStory.slug,
    newStory,
    movedFeedItemCount: selectedRelations.length,
  };
}

export async function listBoardQueue() {
  await ensureBoardSeedData();

  const db = getDb();
  const rows = await db
    .select({
      queue: boardQueueItems,
      storyId: boardStoryCandidates.id,
      storySlug: boardStoryCandidates.slug,
      storyTitle: boardStoryCandidates.canonicalTitle,
      storyScoreJson: boardStoryCandidates.scoreJson,
    })
    .from(boardQueueItems)
    .innerJoin(boardStoryCandidates, eq(boardStoryCandidates.id, boardQueueItems.storyId))
    .orderBy(asc(boardQueueItems.position), desc(boardQueueItems.updatedAt));

  return rows.map((row) => ({
    id: row.queue.id,
    storyId: row.storyId,
    storySlug: row.storySlug,
    storyTitle: row.storyTitle,
    position: row.queue.position,
    status: row.queue.status,
    format: row.queue.format,
    targetPublishAt: toIsoString(row.queue.targetPublishAt),
    assignedTo: row.queue.assignedTo,
    notes: row.queue.notes,
    linkedProjectId: row.queue.linkedProjectId,
    score:
      typeof coerceObject(row.storyScoreJson)?.boardVisibilityScore === "number"
        ? (coerceObject(row.storyScoreJson)?.boardVisibilityScore as number)
        : null,
    updatedAt: toIsoString(row.queue.updatedAt) ?? new Date().toISOString(),
  }));
}

async function refreshBoardCompetitorChannel(
  channel: typeof boardCompetitorChannels.$inferSelect,
  stories: Array<{
    canonicalTitle: string;
    controversyScore: number;
    surgeScore: number;
    storyType: BoardStoryType;
  }>
) {
  const config = getBoardCompetitorYouTubeConfig(channel);
  if (!config) {
    return {
      channelId: channel.id,
      channelName: channel.name,
      refreshed: false,
      skipped: true,
      reason: "missing_youtube_config",
    };
  }

  const db = getDb();

  try {
    const { channel: youtubeChannel, items } = await fetchYouTubeChannelUploads({
      channelId: config.channelId,
      uploadsPlaylistId: config.uploadsPlaylistId,
      channelHandle: config.channelHandle,
      channelUrl: config.channelUrl,
      channelName: channel.name,
      maxResults: config.maxResults ?? 4,
    });
    const latestItem = items[0];

    if (!latestItem) {
      return {
        channelId: channel.id,
        channelName: channel.name,
        refreshed: false,
        skipped: true,
        reason: "no_uploads",
      };
    }

    const publishedAt = coerceDate(latestItem.publishedAt);
    const topicMatchScore = computeBoardCompetitorTopicMatchScore(
      latestItem.title,
      stories
    );
    const alertLevel = computeBoardCompetitorAlertLevel({
      topicMatchScore,
      publishedAt,
    });
    const viewsLabel = formatCompactCount(latestItem.viewCount);

    await db.transaction(async (tx) => {
      await tx
        .update(boardCompetitorChannels)
        .set({
          handle: config.channelHandle ?? channel.handle,
          channelUrl:
            config.channelUrl ??
            youtubeChannel?.customUrl ??
            youtubeChannel?.channelUrl ??
            channel.channelUrl,
          subscribersLabel:
            formatCompactCount(youtubeChannel?.subscriberCount ?? null, "subs") ??
            channel.subscribersLabel,
          metadataJson: {
            ...(coerceObject(channel.metadataJson) ?? {}),
            channelId: config.channelId,
            uploadsPlaylistId: config.uploadsPlaylistId,
            channelHandle: config.channelHandle ?? channel.handle,
            channelUrl:
              config.channelUrl ??
              youtubeChannel?.customUrl ??
              youtubeChannel?.channelUrl ??
              channel.channelUrl,
            latestTimeLabel: publishedAt ? formatAgeLabel(publishedAt) : "n/a",
            latestVideoId: latestItem.videoId,
            latestThumbnailUrl: latestItem.thumbnailUrl,
          },
          updatedAt: new Date(),
        })
        .where(eq(boardCompetitorChannels.id, channel.id));

      await tx
        .delete(boardCompetitorPosts)
        .where(eq(boardCompetitorPosts.channelId, channel.id));

      await tx.insert(boardCompetitorPosts).values({
        channelId: channel.id,
        externalId: latestItem.videoId,
        title: latestItem.title,
        url: latestItem.url,
        publishedAt,
        viewsLabel,
        engagementJson: {
          viewCount: latestItem.viewCount,
          durationMs: latestItem.durationMs,
          thumbnailUrl: latestItem.thumbnailUrl,
          subscriberCount: youtubeChannel?.subscriberCount ?? null,
        },
        topicMatchScore,
        alertLevel,
        metadataJson: {
          latestTimeLabel: publishedAt ? formatAgeLabel(publishedAt) : "n/a",
          latestVideoId: latestItem.videoId,
          latestThumbnailUrl: latestItem.thumbnailUrl,
        },
        updatedAt: new Date(),
      });
    });

    return {
      channelId: channel.id,
      channelName: channel.name,
      refreshed: true,
      skipped: false,
      topicMatchScore,
      alertLevel,
      latestVideoId: latestItem.videoId,
    };
  } catch (error) {
    return {
      channelId: channel.id,
      channelName: channel.name,
      refreshed: false,
      skipped: false,
      reason: error instanceof Error ? error.message : "unknown_competitor_refresh_error",
    };
  }
}

export async function refreshBoardCompetitors() {
  await ensureBoardSeedData();

  const db = getDb();
  const [channels, stories] = await Promise.all([
    db
      .select()
      .from(boardCompetitorChannels)
      .where(eq(boardCompetitorChannels.enabled, true))
      .orderBy(asc(boardCompetitorChannels.tier), asc(boardCompetitorChannels.name)),
    db
      .select({
        canonicalTitle: boardStoryCandidates.canonicalTitle,
        controversyScore: boardStoryCandidates.controversyScore,
        surgeScore: boardStoryCandidates.surgeScore,
        storyType: boardStoryCandidates.storyType,
      })
      .from(boardStoryCandidates)
      .where(
        gte(
          boardStoryCandidates.updatedAt,
          new Date(Date.now() - 21 * 24 * 60 * 60 * 1000)
        )
      ),
  ]);

  const results = [];
  for (const channel of channels) {
    results.push(await refreshBoardCompetitorChannel(channel, stories));
  }

  const summary = {
    totalChannels: channels.length,
    refreshedChannels: results.filter((result) => result.refreshed).length,
    skippedChannels: results.filter((result) => result.skipped).length,
    failedChannels: results.filter(
      (result) => !result.refreshed && !result.skipped
    ).length,
  };

  return {
    summary,
    results,
  };
}

export async function listBoardCompetitors() {
  await ensureBoardSeedData();

  const db = getDb();
  const rows = await db
    .select({
      channel: boardCompetitorChannels,
      post: boardCompetitorPosts,
    })
    .from(boardCompetitorChannels)
    .leftJoin(
      boardCompetitorPosts,
      eq(boardCompetitorPosts.channelId, boardCompetitorChannels.id)
    )
    .orderBy(
      asc(boardCompetitorChannels.tier),
      desc(boardCompetitorPosts.alertLevel),
      desc(boardCompetitorPosts.topicMatchScore),
      asc(boardCompetitorChannels.name)
    );

  const channels: BoardCompetitorChannelSummary[] = rows.map((row) => {
    const postPublishedAt = coerceDate(row.post?.publishedAt);

    return {
      id: row.channel.id,
      name: row.channel.name,
      platform: row.channel.platform,
      tier: row.channel.tier,
      handle: row.channel.handle,
      channelUrl: row.channel.channelUrl,
      subscribersLabel: row.channel.subscribersLabel,
      latestTitle: row.post?.title ?? null,
      latestPublishedAt: toIsoString(postPublishedAt),
      latestTimeLabel:
        typeof coerceObject(row.post?.metadataJson)?.latestTimeLabel === "string"
          ? (coerceObject(row.post?.metadataJson)?.latestTimeLabel as string)
          : postPublishedAt
            ? formatAgeLabel(postPublishedAt)
            : "n/a",
      viewsLabel: row.post?.viewsLabel ?? null,
      topicMatchScore: row.post?.topicMatchScore ?? 0,
      alertLevel: row.post?.alertLevel ?? "none",
    };
  });

  return {
    tiers: {
      tier1: channels.filter((channel) => channel.tier === "tier1"),
      tier2: channels.filter((channel) => channel.tier === "tier2"),
    },
    stats: {
      totalChannels: channels.length,
      alertCount: channels.filter((channel) => channel.alertLevel !== "none").length,
      hotCount: channels.filter((channel) => channel.alertLevel === "hot").length,
    },
  };
}

export async function listBoardSources() {
  await ensureBoardSeedData();

  const db = getDb();
  const [sources, feedCounts, storyCounts] = await Promise.all([
    db.select().from(boardSources).orderBy(desc(boardSources.lastSuccessAt), asc(boardSources.name)),
    db
      .select({
        sourceId: boardFeedItems.sourceId,
        feedItemCount: sql<number>`count(*)::int`,
      })
      .from(boardFeedItems)
      .groupBy(boardFeedItems.sourceId),
    db
      .select({
        sourceId: boardFeedItems.sourceId,
        storyCount: sql<number>`count(distinct ${boardStorySources.storyId})::int`,
      })
      .from(boardStorySources)
      .innerJoin(boardFeedItems, eq(boardFeedItems.id, boardStorySources.feedItemId))
      .groupBy(boardFeedItems.sourceId),
  ]);

  const feedCountBySource = new Map(feedCounts.map((row) => [row.sourceId, row.feedItemCount]));
  const storyCountBySource = new Map(
    storyCounts.map((row) => [row.sourceId, row.storyCount])
  );

  return {
    sources: sources
      .filter((source) => isLiveBoardSourceKind(source.kind))
      .map((source) => ({
        id: source.id,
        name: source.name,
        kind: source.kind,
        provider: source.provider,
        pollIntervalMinutes: source.pollIntervalMinutes,
        enabled: source.enabled,
        pollable: isBoardSourcePollable(source),
        lastPolledAt: toIsoString(source.lastPolledAt),
        lastSuccessAt: toIsoString(source.lastSuccessAt),
        lastError: source.lastError,
        feedItemCount: feedCountBySource.get(source.id) ?? 0,
        storyCount: storyCountBySource.get(source.id) ?? 0,
      })),
    categories: boardSourceCategorySeeds,
  };
}

export async function pollBoardSource(sourceIdOrName: string) {
  await ensureBoardSeedData();

  const db = getDb();
  const source = looksLikeUuid(sourceIdOrName)
    ? (
        await db
          .select()
          .from(boardSources)
          .where(eq(boardSources.id, sourceIdOrName))
          .limit(1)
      )[0]
    : (
        await db
          .select()
          .from(boardSources)
          .where(eq(boardSources.name, sourceIdOrName))
          .limit(1)
      )[0];

  if (!source) {
    throw buildBoardStoryOperationError(404, "Source not found");
  }

  if (!isBoardSourcePollable(source)) {
    throw buildBoardStoryOperationError(400, "Source is not pollable");
  }

  const storyMatches = await getBoardStoryMatches();
  const result = await pollBoardConfiguredSource({ source, storyMatches });
  const metrics = await recomputeBoardStoryMetrics(result.affectedStoryIds);
  await rescoreBoardStories(result.affectedStoryIds);
  const alerts = await detectBoardStoryAlerts();
  const [health, sources] = await Promise.all([getBoardHealth(), listBoardSources()]);
  const updatedSource =
    sources.sources.find((entry) => entry.id === source.id) ?? null;

  return {
    source: updatedSource,
    result,
    metrics,
    alerts,
    health,
  };
}

export async function backfillBoardYouTubeSource(
  sourceIdOrName: string,
  maxResults: number = 15
) {
  await ensureBoardSeedData();

  const db = getDb();
  const source = looksLikeUuid(sourceIdOrName)
    ? (
        await db
          .select()
          .from(boardSources)
          .where(eq(boardSources.id, sourceIdOrName))
          .limit(1)
      )[0]
    : (
        await db
          .select()
          .from(boardSources)
          .where(eq(boardSources.name, sourceIdOrName))
          .limit(1)
      )[0];

  if (!source) {
    throw buildBoardStoryOperationError(404, "Source not found");
  }

  if (source.kind !== "youtube_channel") {
    throw buildBoardStoryOperationError(400, "Source is not a YouTube channel");
  }

  if (!isBoardSourcePollable(source)) {
    throw buildBoardStoryOperationError(400, "Source is not pollable");
  }

  const storyMatches = await getBoardStoryMatches();
  const result = await pollBoardConfiguredSource({
    source,
    storyMatches,
    maxResultsOverride: Math.max(1, Math.min(maxResults, 20)),
    ignoreLookback: true,
  });
  const metrics = await recomputeBoardStoryMetrics(result.affectedStoryIds);
  await rescoreBoardStories(result.affectedStoryIds);
  const alerts = await detectBoardStoryAlerts();
  const [health, sources] = await Promise.all([getBoardHealth(), listBoardSources()]);
  const updatedSource =
    sources.sources.find((entry) => entry.id === source.id) ?? null;

  return {
    source: updatedSource,
    result,
    metrics,
    alerts,
    health,
  };
}

export async function backfillBoardYouTubeSources(
  sourceNames: string[],
  maxResults: number = 15
) {
  await ensureBoardSeedData();

  const normalizedNames = Array.from(
    new Set(sourceNames.map((name) => name.trim()).filter((name) => name.length > 0))
  );

  if (normalizedNames.length === 0) {
    return {
      results: [],
      metrics: await recomputeBoardStoryMetrics(),
      alerts: await detectBoardStoryAlerts(),
      health: await getBoardHealth(),
    };
  }

  const db = getDb();
  const sources = await db
    .select()
    .from(boardSources)
    .where(inArray(boardSources.name, normalizedNames));

  const sourcesByName = new Map(sources.map((source) => [source.name, source]));
  const storyMatches = await getBoardStoryMatches();
  const results = [];
  const affectedStoryIds = new Set<string>();

  for (const sourceName of normalizedNames) {
    const source = sourcesByName.get(sourceName);

    if (!source) {
      results.push({
        sourceName,
        failed: true,
        error: "Source not found",
        feedItemsIngested: 0,
        relationsCreated: 0,
        storiesCreated: 0,
        versionCaptures: 0,
        correctionEvents: 0,
        affectedStoryIds: [] as string[],
      });
      continue;
    }

    if (source.kind !== "youtube_channel") {
      results.push({
        sourceName,
        failed: true,
        error: "Source is not a YouTube channel",
        feedItemsIngested: 0,
        relationsCreated: 0,
        storiesCreated: 0,
        versionCaptures: 0,
        correctionEvents: 0,
        affectedStoryIds: [] as string[],
      });
      continue;
    }

    const result = await pollBoardConfiguredSource({
      source,
      storyMatches,
      maxResultsOverride: Math.max(1, Math.min(maxResults, 20)),
      ignoreLookback: true,
    });

    result.affectedStoryIds.forEach((storyId) => affectedStoryIds.add(storyId));
    results.push(result);
  }

  const metrics = await recomputeBoardStoryMetrics(Array.from(affectedStoryIds));
  await rescoreBoardStories(Array.from(affectedStoryIds));
  const alerts = await detectBoardStoryAlerts();
  const health = await getBoardHealth();

  return {
    results,
    metrics,
    alerts,
    health,
  };
}

export async function backfillBoardSource(
  sourceIdOrName: string,
  maxResults: number = 20,
  lookbackHours: number = 24,
  includeAlertsAndHealth: boolean = true
) {
  await ensureBoardSeedData();

  const db = getDb();
  const source = looksLikeUuid(sourceIdOrName)
    ? (
        await db
          .select()
          .from(boardSources)
          .where(eq(boardSources.id, sourceIdOrName))
          .limit(1)
      )[0]
    : (
        await db
          .select()
          .from(boardSources)
          .where(eq(boardSources.name, sourceIdOrName))
          .limit(1)
      )[0];

  if (!source) {
    throw buildBoardStoryOperationError(404, "Source not found");
  }

  if (!isBoardSourcePollable(source)) {
    throw buildBoardStoryOperationError(400, "Source is not pollable");
  }

  const storyMatches = await getBoardStoryMatches();
  const result = await pollBoardConfiguredSource({
    source,
    storyMatches,
    maxResultsOverride: Math.max(1, Math.min(maxResults, 40)),
    lookbackHoursOverride: Math.max(1, Math.min(lookbackHours, 72)),
  });
  const metrics = await recomputeBoardStoryMetrics(result.affectedStoryIds);
  await rescoreBoardStories(result.affectedStoryIds);
  const [alerts, health, updatedSource] = await Promise.all([
    includeAlertsAndHealth ? detectBoardStoryAlerts() : Promise.resolve(null),
    includeAlertsAndHealth ? getBoardHealth() : Promise.resolve(null),
    db
      .select()
      .from(boardSources)
      .where(eq(boardSources.id, source.id))
      .limit(1)
      .then((rows) => rows[0] ?? null),
  ]);

  return {
    source: updatedSource,
    result,
    metrics,
    alerts,
    health,
  };
}

export async function backfillBoardXSource(
  sourceIdOrName: string,
  maxResults: number = 20,
  lookbackHours: number = 24,
  includeAlertsAndHealth: boolean = true
) {
  await ensureBoardSeedData();

  const db = getDb();
  const source = looksLikeUuid(sourceIdOrName)
    ? (
        await db
          .select()
          .from(boardSources)
          .where(eq(boardSources.id, sourceIdOrName))
          .limit(1)
      )[0]
    : (
        await db
          .select()
          .from(boardSources)
          .where(eq(boardSources.name, sourceIdOrName))
          .limit(1)
      )[0];

  if (!source) {
    throw buildBoardStoryOperationError(404, "Source not found");
  }

  if (source.kind !== "x_account") {
    throw buildBoardStoryOperationError(400, "Source is not an X account");
  }

  return backfillBoardSource(
    sourceIdOrName,
    maxResults,
    lookbackHours,
    includeAlertsAndHealth
  );
}

export async function backfillBoardXSources(
  sourceNames: string[],
  maxResults: number = 20,
  lookbackHours: number = 24
) {
  await ensureBoardSeedData();

  const normalizedNames = Array.from(
    new Set(sourceNames.map((name) => name.trim()).filter((name) => name.length > 0))
  );

  if (normalizedNames.length === 0) {
    return {
      results: [],
      metrics: await recomputeBoardStoryMetrics(),
      alerts: await detectBoardStoryAlerts(),
      health: await getBoardHealth(),
    };
  }

  const db = getDb();
  const sources = await db
    .select()
    .from(boardSources)
    .where(inArray(boardSources.name, normalizedNames));

  const sourcesByName = new Map(sources.map((source) => [source.name, source]));
  const storyMatches = await getBoardStoryMatches();
  const results = [];
  const affectedStoryIds = new Set<string>();

  for (const sourceName of normalizedNames) {
    const source = sourcesByName.get(sourceName);

    if (!source) {
      results.push({
        sourceName,
        failed: true,
        error: "Source not found",
        feedItemsIngested: 0,
        relationsCreated: 0,
        storiesCreated: 0,
        versionCaptures: 0,
        correctionEvents: 0,
        affectedStoryIds: [] as string[],
      });
      continue;
    }

    if (source.kind !== "x_account") {
      results.push({
        sourceName,
        failed: true,
        error: "Source is not an X account",
        feedItemsIngested: 0,
        relationsCreated: 0,
        storiesCreated: 0,
        versionCaptures: 0,
        correctionEvents: 0,
        affectedStoryIds: [] as string[],
      });
      continue;
    }

    const result = await pollBoardConfiguredSource({
      source,
      storyMatches,
      maxResultsOverride: Math.max(1, Math.min(maxResults, 40)),
      lookbackHoursOverride: Math.max(1, Math.min(lookbackHours, 72)),
    });

    result.affectedStoryIds.forEach((storyId) => affectedStoryIds.add(storyId));
    results.push(result);
  }

  const metrics = await recomputeBoardStoryMetrics(Array.from(affectedStoryIds));
  await rescoreBoardStories(Array.from(affectedStoryIds));
  const alerts = await detectBoardStoryAlerts();
  const health = await getBoardHealth();

  return {
    results,
    metrics,
    alerts,
    health,
  };
}

export async function backfillPendingBoardXSources(args?: {
  limit?: number;
  maxResults?: number;
  lookbackHours?: number;
  onlyNeverSucceeded?: boolean;
  includeAlertsAndHealth?: boolean;
}) {
  await ensureBoardSeedData();

  const limit = Math.max(1, Math.min(args?.limit ?? 10, 25));
  const maxResults = Math.max(1, Math.min(args?.maxResults ?? 20, 40));
  const lookbackHours = Math.max(1, Math.min(args?.lookbackHours ?? 24, 72));
  const onlyNeverSucceeded = args?.onlyNeverSucceeded ?? true;
  const includeAlertsAndHealth = args?.includeAlertsAndHealth ?? true;
  const db = getDb();

  const baseConditions = [
    eq(boardSources.kind, "x_account"),
    eq(boardSources.enabled, true),
  ];
  const whereClause = onlyNeverSucceeded
    ? and(...baseConditions, isNull(boardSources.lastSuccessAt))
    : and(...baseConditions);

  const selectedSources = await db
    .select()
    .from(boardSources)
    .where(whereClause)
    .orderBy(asc(boardSources.name))
    .limit(limit);

  const storyMatches = await getBoardStoryMatches();
  const results = [];
  const affectedStoryIds = new Set<string>();
  let skippedSourceCount = 0;

  for (const source of selectedSources) {
    const config = parseBoardSourceConfig(source);

    if (!config || config.mode !== "x_account" || !isBoardSourcePollable(source)) {
      skippedSourceCount += 1;
      results.push({
        sourceId: source.id,
        sourceName: source.name,
        sourceKind: source.kind,
        failed: true,
        error: "Source is not pollable",
        feedItemsIngested: 0,
        relationsCreated: 0,
        storiesCreated: 0,
        versionCaptures: 0,
        correctionEvents: 0,
        affectedStoryIds: [] as string[],
      });
      continue;
    }

    const result = await pollBoardConfiguredSource({
      source,
      storyMatches,
      maxResultsOverride: maxResults,
      lookbackHoursOverride: lookbackHours,
    });

    result.affectedStoryIds.forEach((storyId) => affectedStoryIds.add(storyId));
    results.push(result);
  }

  const affectedIds = Array.from(affectedStoryIds);
  const metrics =
    affectedIds.length > 0 ? await recomputeBoardStoryMetrics(affectedIds) : [];

  if (affectedIds.length > 0) {
    await rescoreBoardStories(affectedIds);
  }

  const remainingRow = await db
    .select({
      count: sql<number>`count(*)`,
    })
    .from(boardSources)
    .where(whereClause)
    .limit(1)
    .then((rows) => rows[0] ?? { count: 0 });

  const [alerts, health] = includeAlertsAndHealth
    ? await Promise.all([detectBoardStoryAlerts(), getBoardHealth()])
    : [null, null];

  return {
    sourceCount: selectedSources.length,
    processedSourceCount: selectedSources.length - skippedSourceCount,
    skippedSourceCount,
    remainingSourceCount: Number(remainingRow.count ?? 0),
    results,
    metrics,
    alerts,
    health,
  };
}

export async function backfillBoardTikTokSource(
  sourceIdOrName: string,
  maxResults: number = 12,
  lookbackHours: number = 24,
  includeAlertsAndHealth: boolean = true
) {
  await ensureBoardSeedData();

  const db = getDb();
  const source = looksLikeUuid(sourceIdOrName)
    ? (
        await db
          .select()
          .from(boardSources)
          .where(eq(boardSources.id, sourceIdOrName))
          .limit(1)
      )[0]
    : (
        await db
          .select()
          .from(boardSources)
          .where(eq(boardSources.name, sourceIdOrName))
          .limit(1)
      )[0];

  if (!source) {
    throw buildBoardStoryOperationError(404, "Source not found");
  }

  if (
    source.kind !== "tiktok_query" &&
    source.kind !== "tiktok_fyp_profile"
  ) {
    throw buildBoardStoryOperationError(400, "Source is not a TikTok source");
  }

  if (!isBoardSourcePollable(source)) {
    throw buildBoardStoryOperationError(400, "Source is not pollable");
  }

  const storyMatches = await getBoardStoryMatches();
  const result = await pollBoardConfiguredSource({
    source,
    storyMatches,
    maxResultsOverride: Math.max(1, Math.min(maxResults, 20)),
    lookbackHoursOverride: Math.max(1, Math.min(lookbackHours, 72)),
  });
  const metrics = await recomputeBoardStoryMetrics(result.affectedStoryIds);
  await rescoreBoardStories(result.affectedStoryIds);
  const [alerts, health, updatedSource] = await Promise.all([
    includeAlertsAndHealth ? detectBoardStoryAlerts() : Promise.resolve(null),
    includeAlertsAndHealth ? getBoardHealth() : Promise.resolve(null),
    db
      .select()
      .from(boardSources)
      .where(eq(boardSources.id, source.id))
      .limit(1)
      .then((rows) => rows[0] ?? null),
  ]);

  return {
    source: updatedSource,
    result,
    metrics,
    alerts,
    health,
  };
}

export async function backfillPendingBoardTikTokSources(args?: {
  limit?: number;
  maxResults?: number;
  lookbackHours?: number;
  onlyNeverSucceeded?: boolean;
  includeAlertsAndHealth?: boolean;
}) {
  await ensureBoardSeedData();

  const limit = Math.max(1, Math.min(args?.limit ?? 10, 25));
  const maxResults = Math.max(1, Math.min(args?.maxResults ?? 12, 20));
  const lookbackHours = Math.max(1, Math.min(args?.lookbackHours ?? 24, 72));
  const onlyNeverSucceeded = args?.onlyNeverSucceeded ?? true;
  const includeAlertsAndHealth = args?.includeAlertsAndHealth ?? true;
  const db = getDb();

  const baseConditions = [
    inArray(boardSources.kind, ["tiktok_query", "tiktok_fyp_profile"]),
    eq(boardSources.enabled, true),
  ];
  const whereClause = onlyNeverSucceeded
    ? and(...baseConditions, isNull(boardSources.lastSuccessAt))
    : and(...baseConditions);

  const selectedSources = await db
    .select()
    .from(boardSources)
    .where(whereClause)
    .orderBy(asc(boardSources.name))
    .limit(limit);

  const storyMatches = await getBoardStoryMatches();
  const results = [];
  const affectedStoryIds = new Set<string>();
  let skippedSourceCount = 0;

  for (const source of selectedSources) {
    const config = parseBoardSourceConfig(source);

    if (
      !config ||
      (config.mode !== "tiktok_query" &&
        config.mode !== "tiktok_fyp_profile") ||
      !isBoardSourcePollable(source)
    ) {
      skippedSourceCount += 1;
      results.push({
        sourceId: source.id,
        sourceName: source.name,
        sourceKind: source.kind,
        failed: true,
        error: "Source is not pollable",
        feedItemsIngested: 0,
        relationsCreated: 0,
        storiesCreated: 0,
        versionCaptures: 0,
        correctionEvents: 0,
        affectedStoryIds: [] as string[],
      });
      continue;
    }

    const result = await pollBoardConfiguredSource({
      source,
      storyMatches,
      maxResultsOverride: maxResults,
      lookbackHoursOverride: lookbackHours,
    });

    result.affectedStoryIds.forEach((storyId) => affectedStoryIds.add(storyId));
    results.push(result);
  }

  const affectedIds = Array.from(affectedStoryIds);
  const metrics =
    affectedIds.length > 0 ? await recomputeBoardStoryMetrics(affectedIds) : [];

  if (affectedIds.length > 0) {
    await rescoreBoardStories(affectedIds);
  }

  const remainingRow = await db
    .select({
      count: sql<number>`count(*)`,
    })
    .from(boardSources)
    .where(whereClause)
    .limit(1)
    .then((rows) => rows[0] ?? { count: 0 });

  const [alerts, health] = includeAlertsAndHealth
    ? await Promise.all([detectBoardStoryAlerts(), getBoardHealth()])
    : [null, null];

  return {
    sourceCount: selectedSources.length,
    processedSourceCount: selectedSources.length - skippedSourceCount,
    skippedSourceCount,
    remainingSourceCount: Number(remainingRow.count ?? 0),
    results,
    metrics,
    alerts,
    health,
  };
}

export async function getBoardHealth() {
  await ensureBoardSeedData();

  const db = getDb();
  const [sources, storyStatsRows, queueRows, latestFeedRows, competitorAlertRows, activeAlertRows, feedItemRows, agentReach] =
    await Promise.all([
    db.select().from(boardSources),
    db
      .select({
        storyCount: sql<number>`count(*)::int`,
        controversyCount: sql<number>`
          coalesce(sum(case when ${boardStoryCandidates.controversyScore} >= 75 then 1 else 0 end), 0)::int
        `,
        correctionCount: sql<number>`
          coalesce(sum(case when ${boardStoryCandidates.correction} then 1 else 0 end), 0)::int
        `,
      })
      .from(boardStoryCandidates),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(boardQueueItems),
    db
      .select({
        latestPublishedAt: sql<Date | null>`max(${boardFeedItems.publishedAt})`,
        latestIngestedAt: sql<Date | null>`max(${boardFeedItems.ingestedAt})`,
      })
      .from(boardFeedItems),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(boardCompetitorPosts)
      .where(sql`${boardCompetitorPosts.alertLevel} <> 'none'`),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(boardSurgeAlerts)
      .where(isNull(boardSurgeAlerts.dismissedAt)),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(boardFeedItems),
    getAgentReachHealth(),
  ]);
  const storyStats = storyStatsRows[0] ?? {
    storyCount: 0,
    controversyCount: 0,
    correctionCount: 0,
  };

  const now = Date.now();
  const liveBoardSources = sources.filter((source) => isLiveBoardSourceKind(source.kind));
  let healthySources = 0;
  let staleSources = 0;
  let pollableSources = 0;

  for (const source of liveBoardSources) {
    if (!isBoardSourcePollable(source)) {
      continue;
    }

    pollableSources += 1;

    const lastSuccessAt = coerceDate(source.lastSuccessAt);

    if (!lastSuccessAt) {
      staleSources += 1;
      continue;
    }

    const staleThresholdMs = source.pollIntervalMinutes * 2 * 60 * 1000;
    if (now - lastSuccessAt.getTime() <= staleThresholdMs) {
      healthySources += 1;
    } else {
      staleSources += 1;
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    sourceCount: liveBoardSources.length,
    enabledSources: liveBoardSources.filter((source) => source.enabled).length,
    pollableSources,
    healthySources,
    staleSources,
    storyCount: storyStats.storyCount,
    feedItemCount: feedItemRows[0]?.count ?? 0,
    controversyCount: storyStats.controversyCount,
    correctionCount: storyStats.correctionCount,
    queueCount: queueRows[0]?.count ?? 0,
    alertCount: activeAlertRows[0]?.count ?? 0,
    competitorAlerts: competitorAlertRows[0]?.count ?? 0,
    latestPublishedAt: toIsoString(latestFeedRows[0]?.latestPublishedAt),
    latestIngestedAt: toIsoString(latestFeedRows[0]?.latestIngestedAt),
    agentReach: {
      available: agentReach.available,
      generatedAt: agentReach.generatedAt,
      okCount: agentReach.okCount,
      totalCount: agentReach.totalCount,
      pythonBin: agentReach.pythonBin,
      error: agentReach.error,
      keyChannels: agentReach.keyChannels,
    },
  };
}

function buildBoardAlertKey(storyId: string, alertType: BoardAlertType) {
  return `${storyId}:${alertType}`;
}

async function upsertBoardAlert(args: {
  storyId: string;
  alertType: BoardAlertType;
  headline: string;
  text: string;
  surgeScore: number;
  baselineAvg: number;
  currentCount: number;
  windowMinutes: number;
  metadataJson: Record<string, unknown> | null;
}) {
  const db = getDb();
  const now = new Date();
  const [existing] = await db
    .select({ id: boardSurgeAlerts.id })
    .from(boardSurgeAlerts)
    .where(
      and(
        eq(boardSurgeAlerts.storyId, args.storyId),
        eq(boardSurgeAlerts.alertType, args.alertType),
        isNull(boardSurgeAlerts.dismissedAt)
      )
    )
    .orderBy(desc(boardSurgeAlerts.createdAt))
    .limit(1);

  if (existing) {
    await db
      .update(boardSurgeAlerts)
      .set({
        headline: args.headline,
        text: args.text,
        surgeScore: args.surgeScore,
        baselineAvg: args.baselineAvg,
        currentCount: args.currentCount,
        windowMinutes: args.windowMinutes,
        metadataJson: args.metadataJson,
        updatedAt: now,
      })
      .where(eq(boardSurgeAlerts.id, existing.id));

    return { created: false, updated: true };
  }

  await db.insert(boardSurgeAlerts).values({
    storyId: args.storyId,
    alertType: args.alertType,
    headline: args.headline,
    text: args.text,
    surgeScore: args.surgeScore,
    baselineAvg: args.baselineAvg,
    currentCount: args.currentCount,
    windowMinutes: args.windowMinutes,
    metadataJson: args.metadataJson,
    updatedAt: now,
  });

  return { created: true, updated: false };
}

async function clearInactiveBoardAlerts(activeKeys: Set<string>) {
  const db = getDb();
  const activeAlerts = await db
    .select({
      id: boardSurgeAlerts.id,
      storyId: boardSurgeAlerts.storyId,
      alertType: boardSurgeAlerts.alertType,
      metadataJson: boardSurgeAlerts.metadataJson,
    })
    .from(boardSurgeAlerts)
    .where(isNull(boardSurgeAlerts.dismissedAt));

  let cleared = 0;

  for (const alert of activeAlerts) {
    const key = buildBoardAlertKey(alert.storyId, alert.alertType);
    if (activeKeys.has(key)) {
      continue;
    }

    const metadataJson = {
      ...(coerceObject(alert.metadataJson) ?? {}),
      dismissReason: "condition_cleared",
      dismissedBy: "system",
    };

    await db
      .update(boardSurgeAlerts)
      .set({
        dismissedAt: new Date(),
        metadataJson,
        updatedAt: new Date(),
      })
      .where(eq(boardSurgeAlerts.id, alert.id));

    cleared += 1;
  }

  return cleared;
}

export async function detectBoardStoryAlerts() {
  await ensureBoardSeedData();

  const db = getDb();
  const now = new Date();
  const baselineStart = new Date(
    now.getTime() - BOARD_ALERT_BASELINE_DAYS * 24 * 60 * 60 * 1000
  );
  const currentWindowStart = new Date(
    now.getTime() - BOARD_ALERT_WINDOW_MINUTES * 60 * 1000
  );
  const controversyRecentStart = new Date(
    now.getTime() - BOARD_ALERT_RECENT_CONTROVERSY_HOURS * 60 * 60 * 1000
  );
  const baselineBucketCount = Math.max(
    1,
    Math.floor((BOARD_ALERT_BASELINE_DAYS * 24 * 60) / BOARD_ALERT_WINDOW_MINUTES)
  );

  const [stories, countRows] = await Promise.all([
    db
      .select({
        id: boardStoryCandidates.id,
        slug: boardStoryCandidates.slug,
        canonicalTitle: boardStoryCandidates.canonicalTitle,
        controversyScore: boardStoryCandidates.controversyScore,
        surgeScore: boardStoryCandidates.surgeScore,
        correction: boardStoryCandidates.correction,
        lastSeenAt: boardStoryCandidates.lastSeenAt,
      })
      .from(boardStoryCandidates),
    db
      .select({
        storyId: boardStorySources.storyId,
        currentCount: sql<number>`
          coalesce(sum(case when ${boardFeedItems.publishedAt} >= ${currentWindowStart} then 1 else 0 end), 0)::int
        `,
        baselineCount: sql<number>`
          coalesce(sum(case when ${boardFeedItems.publishedAt} < ${currentWindowStart} then 1 else 0 end), 0)::int
        `,
      })
      .from(boardStorySources)
      .innerJoin(boardFeedItems, eq(boardFeedItems.id, boardStorySources.feedItemId))
      .where(gte(boardFeedItems.publishedAt, baselineStart))
      .groupBy(boardStorySources.storyId),
  ]);

  const countsByStory = new Map(
    countRows.map((row) => [
      row.storyId,
      {
        currentCount: Number(row.currentCount ?? 0),
        baselineCount: Number(row.baselineCount ?? 0),
      },
    ])
  );

  const activeKeys = new Set<string>();
  let createdCount = 0;
  let updatedCount = 0;

  for (const story of stories) {
    const lastSeenAt = coerceDate(story.lastSeenAt);
    const counts = countsByStory.get(story.id) ?? {
      currentCount: 0,
      baselineCount: 0,
    };
    const baselineAvg = counts.baselineCount / baselineBucketCount;
    const surgeScore = counts.currentCount / Math.max(0.25, baselineAvg || 0);

    const shouldAlertSurge =
      counts.currentCount >= 2 &&
      (surgeScore >= 3 || (counts.currentCount >= 3 && story.surgeScore >= 80));

    if (shouldAlertSurge) {
      activeKeys.add(buildBoardAlertKey(story.id, "surge"));
      const result = await upsertBoardAlert({
        storyId: story.id,
        alertType: "surge",
        headline: "Surge Alert",
        text: buildBoardAlertText({
          alertType: "surge",
          title: story.canonicalTitle,
          currentCount: counts.currentCount,
          baselineAvg,
          surgeScore,
          controversyScore: story.controversyScore,
        }),
        surgeScore,
        baselineAvg,
        currentCount: counts.currentCount,
        windowMinutes: BOARD_ALERT_WINDOW_MINUTES,
        metadataJson: {
          storySlug: story.slug,
          controversyScore: story.controversyScore,
        },
      });
      if (result.created) {
        createdCount += 1;
      } else if (result.updated) {
        updatedCount += 1;
      }
    }

    const shouldAlertControversy =
      story.controversyScore >= 85 &&
      Boolean(lastSeenAt && lastSeenAt >= controversyRecentStart);

    if (shouldAlertControversy) {
      activeKeys.add(buildBoardAlertKey(story.id, "controversy"));
      const result = await upsertBoardAlert({
        storyId: story.id,
        alertType: "controversy",
        headline: "Controversy Alert",
        text: buildBoardAlertText({
          alertType: "controversy",
          title: story.canonicalTitle,
          currentCount: counts.currentCount,
          baselineAvg,
          surgeScore,
          controversyScore: story.controversyScore,
        }),
        surgeScore,
        baselineAvg,
        currentCount: counts.currentCount,
        windowMinutes: BOARD_ALERT_WINDOW_MINUTES,
        metadataJson: {
          storySlug: story.slug,
          controversyScore: story.controversyScore,
        },
      });
      if (result.created) {
        createdCount += 1;
      } else if (result.updated) {
        updatedCount += 1;
      }
    }

    const shouldAlertCorrection =
      story.correction && Boolean(lastSeenAt && lastSeenAt >= controversyRecentStart);

    if (shouldAlertCorrection) {
      activeKeys.add(buildBoardAlertKey(story.id, "correction"));
      const result = await upsertBoardAlert({
        storyId: story.id,
        alertType: "correction",
        headline: "Correction Watch",
        text: buildBoardAlertText({
          alertType: "correction",
          title: story.canonicalTitle,
          currentCount: counts.currentCount,
          baselineAvg,
          surgeScore,
          controversyScore: story.controversyScore,
        }),
        surgeScore,
        baselineAvg,
        currentCount: counts.currentCount,
        windowMinutes: BOARD_ALERT_WINDOW_MINUTES,
        metadataJson: {
          storySlug: story.slug,
          correction: true,
        },
      });
      if (result.created) {
        createdCount += 1;
      } else if (result.updated) {
        updatedCount += 1;
      }
    }
  }

  const clearedCount = await clearInactiveBoardAlerts(activeKeys);

  return {
    activeAlerts: activeKeys.size,
    createdAlerts: createdCount,
    updatedAlerts: updatedCount,
    clearedAlerts: clearedCount,
  };
}

export async function listBoardAlerts() {
  await ensureBoardSeedData();

  const db = getDb();
  const rows = await db
    .select({
      alert: boardSurgeAlerts,
      storySlug: boardStoryCandidates.slug,
    })
    .from(boardSurgeAlerts)
    .innerJoin(boardStoryCandidates, eq(boardStoryCandidates.id, boardSurgeAlerts.storyId))
    .where(isNull(boardSurgeAlerts.dismissedAt))
    .orderBy(
      desc(boardSurgeAlerts.surgeScore),
      desc(boardSurgeAlerts.createdAt),
      desc(boardStoryCandidates.controversyScore)
    );

  return rows.map((row): BoardAlertSummary => ({
    id: row.alert.id,
    storyId: row.alert.storyId,
    storySlug: row.storySlug,
    alertType: row.alert.alertType,
    headline: row.alert.headline,
    text: row.alert.text,
    surgeScore: row.alert.surgeScore,
    baselineAvg: row.alert.baselineAvg,
    currentCount: row.alert.currentCount,
    windowMinutes: row.alert.windowMinutes,
    createdAt: toIsoString(row.alert.createdAt) ?? new Date().toISOString(),
    updatedAt: toIsoString(row.alert.updatedAt) ?? new Date().toISOString(),
    dismissedAt: toIsoString(row.alert.dismissedAt),
    metadataJson: coerceObject(row.alert.metadataJson),
  }));
}

export async function dismissBoardAlert(alertId: string) {
  const db = getDb();
  const [existing] = await db
    .select({
      id: boardSurgeAlerts.id,
      metadataJson: boardSurgeAlerts.metadataJson,
      dismissedAt: boardSurgeAlerts.dismissedAt,
    })
    .from(boardSurgeAlerts)
    .where(eq(boardSurgeAlerts.id, alertId))
    .limit(1);

  if (!existing) {
    return null;
  }

  if (!existing.dismissedAt) {
    await db
      .update(boardSurgeAlerts)
      .set({
        dismissedAt: new Date(),
        metadataJson: {
          ...(coerceObject(existing.metadataJson) ?? {}),
          dismissedBy: "user",
        },
        updatedAt: new Date(),
      })
      .where(eq(boardSurgeAlerts.id, alertId));
  }

  const [updated] = await db
    .select({
      alert: boardSurgeAlerts,
      storySlug: boardStoryCandidates.slug,
    })
    .from(boardSurgeAlerts)
    .innerJoin(boardStoryCandidates, eq(boardStoryCandidates.id, boardSurgeAlerts.storyId))
    .where(eq(boardSurgeAlerts.id, alertId))
    .limit(1);

  if (!updated) {
    return null;
  }

  return {
    id: updated.alert.id,
    storyId: updated.alert.storyId,
    storySlug: updated.storySlug,
    alertType: updated.alert.alertType,
    headline: updated.alert.headline,
    text: updated.alert.text,
    surgeScore: updated.alert.surgeScore,
    baselineAvg: updated.alert.baselineAvg,
    currentCount: updated.alert.currentCount,
    windowMinutes: updated.alert.windowMinutes,
    createdAt: toIsoString(updated.alert.createdAt) ?? new Date().toISOString(),
    updatedAt: toIsoString(updated.alert.updatedAt) ?? new Date().toISOString(),
    dismissedAt: toIsoString(updated.alert.dismissedAt),
    metadataJson: coerceObject(updated.alert.metadataJson),
  } satisfies BoardAlertSummary;
}

export async function dispatchDiscordBoardIdeaNotifications() {
  const env = getEnv();

  if (
    !env.ENABLE_DISCORD_BOARD_NOTIFICATIONS ||
    !env.DISCORD_BOT_TOKEN ||
    !env.DISCORD_BOARD_CHANNEL_ID
  ) {
    return {
      enabled: false,
      candidateCount: 0,
      sentCount: 0,
      failedCount: 0,
    };
  }

  const cutoff = Date.now() - env.DISCORD_BOARD_LOOKBACK_HOURS * 60 * 60 * 1000;
  const cutoffDate = new Date(cutoff);
  const db = getDb();
  const candidateFetchLimit = Math.max(12, env.DISCORD_BOARD_MAX_MESSAGES_PER_POLL * 8);
  const persistedBoardVisibilityScore = sql<number>`
    coalesce(nullif(${boardStoryCandidates.scoreJson} ->> 'boardVisibilityScore', '')::int, 0)
  `;
  const rows = await db
    .select()
    .from(boardStoryCandidates)
    .where(
      and(
        gte(boardStoryCandidates.lastSeenAt, cutoffDate),
        sql`${boardStoryCandidates.scoreJson} ->> 'lastScoredAt' is not null`,
        gte(persistedBoardVisibilityScore, env.DISCORD_BOARD_MIN_VISIBILITY)
      )
    )
    .orderBy(
      desc(persistedBoardVisibilityScore),
      desc(boardStoryCandidates.lastSeenAt)
    )
    .limit(candidateFetchLimit);

  const storyIds = rows.map((row) => row.id);
  const [moonScoreMap, previewsByStory] = await Promise.all([
    getMoonStoryScoresByStoryIds(storyIds),
    getSourcePreviewsForStories(storyIds),
  ]);
  const rowById = new Map(rows.map((row) => [row.id, row]));
  const filteredCandidates = rows
    .map((row) =>
      mapStorySummary(
        row,
        previewsByStory.get(row.id) ?? [],
        moonScoreMap.get(row.id) ?? null
      )
    )
    .filter((story) => {
      if (
        !passesCoreLiveBoardStoryFilters({
          story,
          sourceRow: rowById.get(story.id) ?? null,
          minFreshnessDate: cutoffDate,
        })
      ) {
        return false;
      }

      return !hasBoardStoryDiscordNotification(
        story,
        env.DISCORD_BOARD_CHANNEL_ID as string
      );
    })
  const candidates = (
    await dedupeDiscordBoardCandidates(filteredCandidates)
  ).slice(0, env.DISCORD_BOARD_MAX_MESSAGES_PER_POLL);

  let sentCount = 0;
  let failedCount = 0;

  for (const story of candidates) {
    try {
      await sendDiscordChannelMessage({
        channelId: env.DISCORD_BOARD_CHANNEL_ID,
        content: `New top board idea\n${env.APP_URL ? `${env.APP_URL}/board` : ""}`.trim(),
        embeds: [buildBoardDiscordEmbed(story)],
      });

      await markBoardStoryDiscordNotificationSent(
        story.id,
        env.DISCORD_BOARD_CHANNEL_ID,
        story
      );
      sentCount += 1;
    } catch (error) {
      failedCount += 1;
      console.error(
        "[board] discord idea notification failed",
        story.id,
        error instanceof Error ? error.message : error
      );
    }
  }

  return {
    enabled: true,
    candidateCount: candidates.length,
    sentCount,
    failedCount,
  };
}

export async function listBoardTicker() {
  await ensureBoardSeedData();

  const db = getDb();
  const now = new Date();
  const rows = await db
    .select({
      ticker: boardTickerEvents,
      storySlug: boardStoryCandidates.slug,
    })
    .from(boardTickerEvents)
    .leftJoin(boardStoryCandidates, eq(boardStoryCandidates.id, boardTickerEvents.storyId))
    .orderBy(desc(boardTickerEvents.priority), desc(boardTickerEvents.startsAt));

  return rows
    .filter((row) => {
      const startsAt = coerceDate(row.ticker.startsAt);
      const expiresAt = coerceDate(row.ticker.expiresAt);

      if (startsAt && startsAt > now) {
        return false;
      }

      if (expiresAt && expiresAt <= now) {
        return false;
      }

      return true;
    })
    .map((row) => ({
      id: row.ticker.id,
      storySlug: row.storySlug,
      label: row.ticker.label,
      text: row.ticker.text,
      priority: row.ticker.priority,
      startsAt: toIsoString(row.ticker.startsAt),
      expiresAt: toIsoString(row.ticker.expiresAt),
    }));
}

export async function getBoardBootstrapPayload(): Promise<BoardBootstrapPayload> {
  const [stories, queue, sources, health, ticker, alerts] = await Promise.all([
    listBoardStories({ sort: "live", timeWindow: "today", limit: 100 }),
    listBoardQueue(),
    listBoardSources(),
    getBoardHealth(),
    listBoardTicker(),
    listBoardAlerts(),
  ]);

  return {
    stories,
    queue,
    competitors: {
      tiers: {
        tier1: [],
        tier2: [],
      },
      stats: {
        totalChannels: 0,
        alertCount: 0,
        hotCount: 0,
      },
    },
    sources,
    health,
    ticker,
    alerts,
  };
}

type BoardPollCycleOptions = {
  includeRss?: boolean;
  includeX?: boolean;
  includeTikTok?: boolean;
  includeAlerts?: boolean;
  includeDiscord?: boolean;
  includeHealth?: boolean;
};

export async function runBoardSourcePollCycle(options: BoardPollCycleOptions = {}) {
  logBoardPollDebug("poll:start");
  const rssIngestion =
    options.includeRss === false
      ? createEmptyBoardIngestionSummary()
      : await ingestBoardRssSources();
  logBoardPollDebug("poll:after-rss", {
    sourcesPolled: rssIngestion.sourcesPolled,
    feedItemsIngested: rssIngestion.feedItemsIngested,
    storiesCreated: rssIngestion.storiesCreated,
    affectedStoryCount: rssIngestion.affectedStoryIds.length,
  });
  const xIngestion =
    options.includeX === false
      ? createEmptyBoardIngestionSummary()
      : await ingestBoardXSources();
  logBoardPollDebug("poll:after-x", {
    sourcesPolled: xIngestion.sourcesPolled,
    feedItemsIngested: xIngestion.feedItemsIngested,
    storiesCreated: xIngestion.storiesCreated,
    affectedStoryCount: xIngestion.affectedStoryIds.length,
  });
  const tiktokIngestion =
    options.includeTikTok === false
      ? createEmptyBoardIngestionSummary()
      : await ingestBoardTikTokSources();
  logBoardPollDebug("poll:after-tiktok", {
    sourcesPolled: tiktokIngestion.sourcesPolled,
    feedItemsIngested: tiktokIngestion.feedItemsIngested,
    storiesCreated: tiktokIngestion.storiesCreated,
    affectedStoryCount: tiktokIngestion.affectedStoryIds.length,
  });
  const affectedStoryIds = Array.from(
    new Set([
      ...rssIngestion.affectedStoryIds,
      ...xIngestion.affectedStoryIds,
      ...tiktokIngestion.affectedStoryIds,
    ])
  );

  await refreshBoardSourceHeartbeat();
  logBoardPollDebug("poll:after-heartbeat", {
    affectedStoryCount: affectedStoryIds.length,
  });
  const metrics = { storyCount: 0, feedItemCount: 0 };
  let scoring = { rescoredStories: 0 };
  let commentReaction = { updatedStories: 0 };

  if (affectedStoryIds.length > 0) {
    const batches = chunkBoardItems(
      affectedStoryIds,
      getEnv().BOARD_POLL_PROCESSING_BATCH_SIZE
    );

    for (const [index, batch] of batches.entries()) {
      logBoardPollDebug("poll:batch:start", {
        batchIndex: index + 1,
        batchCount: batches.length,
        batchSize: batch.length,
      });

      const batchMetrics = await recomputeBoardStoryMetrics(batch);
      metrics.storyCount += batchMetrics.storyCount;
      metrics.feedItemCount += batchMetrics.feedItemCount;
      logBoardPollDebug("poll:batch:after-metrics", {
        batchIndex: index + 1,
        batchCount: batches.length,
        batchSize: batch.length,
        ...batchMetrics,
      });

      const gc = (globalThis as typeof globalThis & { gc?: () => void }).gc;
      if (typeof gc === "function") {
        gc();
        logBoardPollDebug("poll:batch:after-gc", {
          batchIndex: index + 1,
          batchCount: batches.length,
        });
      }
    }

    scoring = await rescoreBoardStories(affectedStoryIds, {
      maxStories: getEnv().BOARD_POLL_IMMEDIATE_RESCORING_LIMIT,
    });
    commentReaction = await enrichBoardStoryCommentReaction(affectedStoryIds);
  }

  logBoardPollDebug("poll:after-metrics", metrics);
  logBoardPollDebug("poll:after-scoring", scoring);
  logBoardPollDebug("poll:after-comment-reaction", commentReaction);
  const alerts =
    options.includeAlerts === false || !getEnv().ENABLE_BOARD_POLL_ALERTS
      ? {
          activeAlerts: 0,
          createdAlerts: 0,
          updatedAlerts: 0,
          clearedAlerts: 0,
        }
      : await (async () => {
          logBoardPollDebug("poll:before-alerts");
          const result = await detectBoardStoryAlerts();
          logBoardPollDebug("poll:after-alerts", result);
          return result;
        })();
  const discordNotifications =
    options.includeDiscord === false
      ? {
          candidateCount: 0,
          sentCount: 0,
          failedCount: 0,
        }
      : await (async () => {
          logBoardPollDebug("poll:before-discord");
          const result = await dispatchDiscordBoardIdeaNotifications();
          logBoardPollDebug("poll:after-discord", result);
          return result;
        })();
  const health =
    options.includeHealth === false
      ? {
          healthySources: 0,
          storyCount: 0,
        }
      : await (async () => {
          logBoardPollDebug("poll:before-health");
          const result = await getBoardHealth();
          logBoardPollDebug("poll:after-health", {
            healthySources: result.healthySources,
            storyCount: result.storyCount,
          });
          return result;
        })();

  return {
    rssSourcesPolled: rssIngestion.sourcesPolled,
    youtubeSourcesPolled: 0,
    xSourcesPolled: xIngestion.sourcesPolled,
    tiktokSourcesPolled: tiktokIngestion.sourcesPolled,
    feedItemsIngested:
      rssIngestion.feedItemsIngested +
      xIngestion.feedItemsIngested +
      tiktokIngestion.feedItemsIngested,
    relationsCreated:
      rssIngestion.relationsCreated +
      xIngestion.relationsCreated +
      tiktokIngestion.relationsCreated,
    storiesCreated:
      rssIngestion.storiesCreated +
      xIngestion.storiesCreated +
      tiktokIngestion.storiesCreated,
    versionCaptures:
      rssIngestion.versionCaptures +
      xIngestion.versionCaptures +
      tiktokIngestion.versionCaptures,
    correctionEvents:
      rssIngestion.correctionEvents +
      xIngestion.correctionEvents +
      tiktokIngestion.correctionEvents,
    failedSources:
      rssIngestion.failedSources +
      xIngestion.failedSources +
      tiktokIngestion.failedSources,
    ...scoring,
    commentReactionStoriesUpdated: commentReaction.updatedStories,
    ...metrics,
    ...alerts,
    discordIdeaNotificationCandidates: discordNotifications.candidateCount,
    discordIdeaNotificationsSent: discordNotifications.sentCount,
    discordIdeaNotificationFailures: discordNotifications.failedCount,
    healthySources: health.healthySources,
  };
}

export async function runBoardClusteringCycle() {
  const metrics = await recomputeBoardStoryMetrics();
  const scoring = await rescoreBoardStories();
  const alerts = await detectBoardStoryAlerts();

  return {
    ...scoring,
    ...metrics,
    ...alerts,
  };
}

export async function runBoardTickerRefreshCycle() {
  await ensureBoardSeedData();
  const items = await listBoardTicker();

  return {
    activeTickerItems: items.length,
  };
}

export async function runBoardCompetitorRefreshCycle() {
  const refresh = await refreshBoardCompetitors();
  const competitors = await listBoardCompetitors();

  return {
    ...competitors.stats,
    ...refresh.summary,
  };
}

export async function runBoardAnomalyDetectionCycle() {
  return detectBoardStoryAlerts();
}

export async function runBoardScoringCycle() {
  await recomputeBoardStoryMetrics();
  const scoring = await rescoreBoardStories();
  const health = await getBoardHealth();

  return {
    ...scoring,
    storyCount: health.storyCount,
  };
}
