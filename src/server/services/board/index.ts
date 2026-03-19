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

import { getDb } from "@/server/db/client";
import {
  boardAlertTypeEnum,
  boardAiOutputKindEnum,
  boardCompetitorChannels,
  boardCompetitorPosts,
  boardFeedItems,
  boardFeedItemVersions,
  boardQueueItems,
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
import { fetchYouTubeChannelUploads } from "@/server/providers/youtube";
import { searchTwitterAccountPosts } from "@/server/providers/twitter";
import { fetchBoardRssItems, type BoardRssFeedItem } from "./rss";
import {
  buildBoardFormatRecommendation,
  type BoardFormatRecommendation,
} from "./format-recommendation";
import { generateBoardAiOutput } from "./ai-outputs";
import { scoreStory } from "./story-scorer";
import {
  getMoonStoryScoresByStoryIds,
  scoreBoardStoriesWithMoonCorpus,
  scoreBoardStoryWithMoonCorpus,
} from "@/server/services/moon-corpus";

export type BoardStoryStatus = (typeof boardStoryStatusEnum.enumValues)[number];
export type BoardStoryType = (typeof boardStoryTypeEnum.enumValues)[number];
export type BoardAiOutputKind = (typeof boardAiOutputKindEnum.enumValues)[number];
export type BoardAlertType = (typeof boardAlertTypeEnum.enumValues)[number];
export type BoardView = "board" | "controversy";

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
  status?: BoardStoryStatus;
  storyType?: BoardStoryType;
  search?: string;
  moonFitBand?: string;
  moonCluster?: string;
  coverageMode?: string;
  vertical?: string;
  hasAnalogs?: boolean;
  minMoonFitScore?: number;
  sort?: "moonFit" | "storyScore" | "controversy" | "recency" | "analogs" | "views";
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
    status: BoardStoryStatus | null;
    storyType: BoardStoryType | null;
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
const MAX_LIMIT = 60;
const BOARD_AI_KINDS: BoardAiOutputKind[] = ["brief", "script_starter", "titles"];
const BOARD_STORY_MATCH_LOOKBACK_DAYS = 45;
const BOARD_RSS_ITEM_LOOKBACK_DAYS = 21;
const BOARD_YOUTUBE_ITEM_LOOKBACK_DAYS = 45;
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

interface BoardRssSourceConfig {
  mode: "rss_feed";
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

type BoardSourceConfig =
  | BoardRssSourceConfig
  | BoardYouTubeSourceConfig
  | BoardXSourceConfig;

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
  tokens: string[];
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

function toIsoString(value: unknown): string | null {
  const date = coerceDate(value);
  return date ? date.toISOString() : null;
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
  const uploadsPlaylistId =
    typeof config.uploadsPlaylistId === "string" ? config.uploadsPlaylistId : undefined;
  const channelHandle =
    typeof config.channelHandle === "string" ? config.channelHandle : undefined;
  const channelUrl = typeof config.channelUrl === "string" ? config.channelUrl : undefined;
  const channelName = typeof config.channelName === "string" ? config.channelName : undefined;

  if (!channelId && !channelHandle && !channelUrl && !channelName) {
    return null;
  }

  return {
    mode: "youtube_channel",
    channelId,
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

  if (
    source.kind !== "rss" &&
    source.kind !== "youtube_channel" &&
    source.kind !== "x_account"
  ) {
    return true;
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
      return (
        !config ||
        config.channelId !== configuredSource.configJson.channelId ||
        config.uploadsPlaylistId !== configuredSource.configJson.uploadsPlaylistId ||
        config.channelHandle !== configuredSource.configJson.channelHandle
      );
    }

    if (source.kind === "x_account" && configuredSource.configJson.mode === "x_account") {
      const config = parseBoardXSourceConfig(source.configJson);
      return (
        !config ||
        config.handle !== configuredSource.configJson.handle
      );
    }
  }

  return (
    (source.kind === "rss" ||
      source.kind === "youtube_channel" ||
      source.kind === "x_account") &&
    source.enabled
  );
}

function tokenizeBoardTitle(title: string): string[] {
  const uniqueTokens = new Set(
    title
      .toLowerCase()
      .replace(/['’]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .split(/\s+/)
      .filter(
        (token) =>
          token.length >= 3 &&
          !BOARD_TITLE_STOPWORDS.has(token) &&
          !/^\d+$/.test(token)
      )
  );

  return Array.from(uniqueTokens);
}

function computeTokenOverlap(left: string[], right: string[]): number {
  if (left.length === 0 || right.length === 0) {
    return 0;
  }

  const rightSet = new Set(right);
  const overlapCount = left.filter((token) => rightSet.has(token)).length;

  return overlapCount / Math.max(left.length, right.length);
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

function inferBoardStoryType(title: string): BoardStoryType {
  const normalized = title.toLowerCase();

  if (/\b(correction|clarif(?:y|ies|ied)|update[d]?|walks back|retraction)\b/.test(normalized)) {
    return "correction";
  }

  if (
    /\b(lawsuit|sues|sued|probe|backlash|controversy|exposed|scam|fraud|killed|kills|ban|rollback)\b/.test(
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

const BOARD_FEED_SIGNAL_VERSION = 1;

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

function tokenizeBoardScoringText(value: string) {
  return value.toLowerCase().match(/[a-z0-9][a-z0-9'-]{2,}/g) ?? [];
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
    "id" | "slug" | "canonicalTitle" | "vertical" | "storyType" | "firstSeenAt" | "lastSeenAt"
  >
): BoardStoryMatchRecord {
  return {
    id: row.id,
    slug: row.slug,
    canonicalTitle: row.canonicalTitle,
    vertical: row.vertical,
    storyType: row.storyType,
    firstSeenAt: coerceDate(row.firstSeenAt),
    lastSeenAt: coerceDate(row.lastSeenAt),
    tokens: tokenizeBoardTitle(row.canonicalTitle),
  };
}

function findMatchingBoardStory(
  stories: BoardStoryMatchRecord[],
  item: BoardSourceFeedItem,
  config: Pick<BoardSourceConfig, "vertical">
): BoardStoryMatchRecord | null {
  const itemTokens = tokenizeBoardTitle(item.title);
  if (itemTokens.length === 0) {
    return null;
  }

  let bestMatch: BoardStoryMatchRecord | null = null;
  let bestScore = 0;
  const itemPublishedAt = item.publishedAt;

  for (const story of stories) {
    if (
      itemPublishedAt &&
      story.lastSeenAt &&
      Math.abs(itemPublishedAt.getTime() - story.lastSeenAt.getTime()) >
        BOARD_STORY_MATCH_LOOKBACK_DAYS * 24 * 60 * 60 * 1000
    ) {
      continue;
    }

    let score = computeTokenOverlap(itemTokens, story.tokens);
    if (
      story.canonicalTitle.toLowerCase().includes(item.title.toLowerCase()) ||
      item.title.toLowerCase().includes(story.canonicalTitle.toLowerCase())
    ) {
      score = Math.max(score, 0.82);
    }

    if (config.vertical && story.vertical === config.vertical) {
      score += 0.08;
    }

    if (score > bestScore) {
      bestScore = score;
      bestMatch = story;
    }
  }

  return bestScore >= 0.58 ? bestMatch : null;
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
  const feedItems = await db.select().from(boardFeedItems);

  if (feedItems.length === 0) {
    return { inserted: 0 };
  }

  const versionRows = await db
    .select({
      feedItemId: boardFeedItemVersions.feedItemId,
    })
    .from(boardFeedItemVersions);
  const feedItemIdsWithVersions = new Set(versionRows.map((row) => row.feedItemId));

  const missingFeedItems = feedItems.filter((item) => !feedItemIdsWithVersions.has(item.id));
  if (missingFeedItems.length === 0) {
    return { inserted: 0 };
  }

  await db.insert(boardFeedItemVersions).values(
    missingFeedItems.map((item) => ({
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
  );

  return { inserted: missingFeedItems.length };
}

async function syncBoardStoryCorrectionFlags(storyIds?: string[]) {
  const db = getDb();
  const storyWhere = storyIds?.length
    ? inArray(boardStoryCandidates.id, Array.from(new Set(storyIds)))
    : sql`true`;

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

  await Promise.all(
    storyRows.map((story) => {
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

  return { updated: storyRows.length };
}

async function getSourcePreviewsForStories(storyIds: string[]) {
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
      title: boardFeedItems.title,
      url: boardFeedItems.url,
      summary: boardFeedItems.summary,
      publishedAt: boardFeedItems.publishedAt,
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
  const versionRows =
    feedItemIds.length > 0
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
    const preview: BoardStorySourcePreview = {
      id: row.sourceId,
      feedItemId: row.feedItemId,
      name: row.sourceName,
      kind: row.sourceKind,
      provider: row.sourceProvider,
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
      summary: row.summary ?? null,
    };

    const existing = previews.get(row.storyId) ?? [];
    existing.push(preview);
    previews.set(row.storyId, existing);
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
  const score =
    typeof scoreJson?.overall === "number" ? (scoreJson.overall as number) : story.surgeScore;
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
    formats: coerceStringArray(story.formatsJson),
    ageLabel:
      typeof metadataJson?.ageLabel === "string"
        ? (metadataJson.ageLabel as string)
        : formatAgeLabel(story.lastSeenAt),
    firstSeenAt: toIsoString(story.firstSeenAt),
    lastSeenAt: toIsoString(story.lastSeenAt),
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
    sourcePreviews: previews.slice(0, 4),
  };
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
      const isConfiguredPollable =
        source.kind !== "rss" &&
        source.kind !== "youtube_channel" &&
        source.kind !== "x_account"
          ? true
          : Boolean(configuredSource);

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
            pollable:
              source.kind !== "rss" &&
              source.kind !== "youtube_channel" &&
              source.kind !== "x_account",
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
          source.kind === "x_account"
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
          configJson: configuredSource.configJson ?? source.configJson,
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
  const storyType = inferBoardStoryType(item.title);
  const recencyScore = computeBoardRecencyScore(publishedAt);
  const authorityScore = config.authorityScore ?? 70;
  const itemSignals = computeBoardFeedItemSignals({
    title: item.title,
    summary: item.summary,
    metadataJson: coerceObject(item.metadataJson) ?? null,
  });
  const controversyScore = itemSignals.controversyScore;
  const surgeScore = clampBoardScore(recencyScore * 0.6 + authorityScore * 0.4);
  const slug = buildBoardStorySlug(item.title, `${source.id}:${item.externalId}`);
  const formats = buildBoardStoryFormats(surgeScore, controversyScore);

  const [created] = await db
    .insert(boardStoryCandidates)
    .values({
      slug,
      canonicalTitle: item.title,
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
        overall: surgeScore,
        recency: recencyScore,
        controversy: controversyScore,
        sourceAuthority: authorityScore,
        crossSourceAgreement: 0,
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

function mapYouTubeItemToBoardFeedItem(
  item: Awaited<ReturnType<typeof fetchYouTubeChannelUploads>>["items"][number],
  config: BoardYouTubeSourceConfig,
  channel: Awaited<ReturnType<typeof fetchYouTubeChannelUploads>>["channel"]
): BoardSourceFeedItem {
  const publishedAt = item.publishedAt ? new Date(item.publishedAt) : null;

  return {
    externalId: item.videoId,
    title: item.title,
    url: item.url,
    author: item.channelTitle || channel?.title || null,
    publishedAt,
    summary: item.description ? item.description.slice(0, 1200) : null,
    contentHash: createHash("sha1")
      .update(`${item.videoId}:${item.title}:${item.publishedAt}`)
      .digest("hex"),
    metadataJson: {
      thumbnailUrl: item.thumbnailUrl,
      durationMs: item.durationMs,
      viewCount: item.viewCount,
      channelId: item.channelId,
      channelTitle: item.channelTitle,
      channelHandle: config.channelHandle ?? null,
      channelUrl: config.channelUrl ?? channel?.channelUrl ?? null,
      subscriberCount: channel?.subscriberCount ?? null,
    },
  };
}

function mapTwitterItemToBoardFeedItem(
  item: Awaited<ReturnType<typeof searchTwitterAccountPosts>>["results"][number],
  config: BoardXSourceConfig
): BoardSourceFeedItem {
  const publishedAt = item.postedAt ? new Date(item.postedAt) : null;
  const title = item.text.length > 140 ? `${item.text.slice(0, 137).trim()}...` : item.text;

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

  for (const item of args.items) {
    const itemSignals = computeBoardFeedItemSignals({
      title: item.title,
      summary: item.summary,
      metadataJson: coerceObject(item.metadataJson) ?? null,
    });
    const nextMetadataJson = {
      ...(coerceObject(item.metadataJson) ?? {}),
      ingestKind: args.config.mode,
      sourceType,
      signalVersion: BOARD_FEED_SIGNAL_VERSION,
    };
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

        await db.insert(boardFeedItemVersions).values({
          feedItemId: insertedFeedItem.id,
          contentHash: item.contentHash,
          title: item.title,
          content: nextContent,
          diffSummary: "initial capture",
          isCorrection,
          versionNumber: 1,
          capturedAt: item.publishedAt ?? new Date(),
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

        await db.insert(boardFeedItemVersions).values({
          feedItemId: existingFeedItem.id,
          contentHash: item.contentHash,
          title: item.title,
          content: nextContent,
          diffSummary,
          isCorrection,
          versionNumber: (latestVersionRow?.versionNumber ?? 0) + 1,
          capturedAt: new Date(),
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

    let matchedStory = findMatchingBoardStory(args.storyMatches, item, args.config);
    if (!matchedStory) {
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
}) {
  const db = getDb();
  const config = parseBoardSourceConfig(args.source);

  if (!config || !isBoardSourcePollable(args.source)) {
    throw buildBoardStoryOperationError(400, "Source is not pollable");
  }

  try {
    let items: BoardSourceFeedItem[] = [];

    if (config.mode === "rss_feed") {
      items = (await fetchBoardRssItems(config.feedUrl))
        .filter((item) => {
          if (!item.publishedAt) {
            return true;
          }

          return (
            Date.now() - item.publishedAt.getTime() <=
            BOARD_RSS_ITEM_LOOKBACK_DAYS * 24 * 60 * 60 * 1000
          );
        })
        .sort((left, right) => {
          const leftTime = left.publishedAt?.getTime() ?? 0;
          const rightTime = right.publishedAt?.getTime() ?? 0;
          return rightTime - leftTime;
        })
        .slice(0, 20)
        .map((item) => mapRssItemToBoardFeedItem(item));
    } else if (config.mode === "youtube_channel") {
      const { channel, items: uploads } = await fetchYouTubeChannelUploads({
        channelId: config.channelId,
        uploadsPlaylistId: config.uploadsPlaylistId,
        channelHandle: config.channelHandle,
        channelUrl: config.channelUrl,
        channelName: args.source.name,
        maxResults: config.maxResults ?? 8,
      });

      items = uploads
        .map((item) => mapYouTubeItemToBoardFeedItem(item, config, channel))
        .filter((item) => {
          if (!item.publishedAt) {
            return true;
          }

          return (
            Date.now() - item.publishedAt.getTime() <=
            BOARD_YOUTUBE_ITEM_LOOKBACK_DAYS * 24 * 60 * 60 * 1000
          );
        });
    } else if (config.mode === "x_account") {
      const { results } = await searchTwitterAccountPosts({
        accountHandle: config.handle,
        queryTerms: config.queryTerms,
        temporalContext: new Date().getFullYear().toString(),
        maxResults: config.maxResults ?? 6,
      });

      items = results
        .map((item) => mapTwitterItemToBoardFeedItem(item, config))
        .filter((item) => {
          if (!item.publishedAt) {
            return true;
          }

          return (
            Date.now() - item.publishedAt.getTime() <=
            BOARD_RSS_ITEM_LOOKBACK_DAYS * 24 * 60 * 60 * 1000
          );
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

async function ingestBoardRssSources() {
  await syncBoardSourceConfigs();

  const db = getDb();
  const sources = await db
    .select()
    .from(boardSources)
    .where(eq(boardSources.enabled, true))
    .orderBy(asc(boardSources.name));
  const storyMatches = await getBoardStoryMatches();
  let sourcesPolled = 0;
  let feedItemsIngested = 0;
  let relationsCreated = 0;
  let storiesCreated = 0;
  let versionCaptures = 0;
  let correctionEvents = 0;
  let failedSources = 0;

  for (const source of sources) {
    if (source.kind !== "rss") {
      continue;
    }

    sourcesPolled += 1;
    const result = await pollBoardConfiguredSource({ source, storyMatches });
    feedItemsIngested += result.feedItemsIngested;
    relationsCreated += result.relationsCreated;
    storiesCreated += result.storiesCreated;
    versionCaptures += result.versionCaptures;
    correctionEvents += result.correctionEvents;
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
  };
}

async function ingestBoardYouTubeSources() {
  await syncBoardSourceConfigs();

  const db = getDb();
  const sources = await db
    .select()
    .from(boardSources)
    .where(eq(boardSources.enabled, true))
    .orderBy(asc(boardSources.name));
  const storyMatches = await getBoardStoryMatches();
  let sourcesPolled = 0;
  let feedItemsIngested = 0;
  let relationsCreated = 0;
  let storiesCreated = 0;
  let versionCaptures = 0;
  let correctionEvents = 0;
  let failedSources = 0;

  for (const source of sources) {
    if (source.kind !== "youtube_channel") {
      continue;
    }

    sourcesPolled += 1;
    const result = await pollBoardConfiguredSource({ source, storyMatches });
    feedItemsIngested += result.feedItemsIngested;
    relationsCreated += result.relationsCreated;
    storiesCreated += result.storiesCreated;
    versionCaptures += result.versionCaptures;
    correctionEvents += result.correctionEvents;
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
  };
}

async function ingestBoardXSources() {
  await syncBoardSourceConfigs();

  const db = getDb();
  const sources = await db
    .select()
    .from(boardSources)
    .where(eq(boardSources.enabled, true))
    .orderBy(asc(boardSources.name));
  const storyMatches = await getBoardStoryMatches();
  let sourcesPolled = 0;
  let feedItemsIngested = 0;
  let relationsCreated = 0;
  let storiesCreated = 0;
  let versionCaptures = 0;
  let correctionEvents = 0;
  let failedSources = 0;

  for (const source of sources) {
    if (source.kind !== "x_account") {
      continue;
    }

    sourcesPolled += 1;
    const result = await pollBoardConfiguredSource({ source, storyMatches });
    feedItemsIngested += result.feedItemsIngested;
    relationsCreated += result.relationsCreated;
    storiesCreated += result.storiesCreated;
    versionCaptures += result.versionCaptures;
    correctionEvents += result.correctionEvents;
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
  };
}

export async function ensureBoardSeedData() {
  const db = getDb();
  const [existing] = await db.select({ id: boardStoryCandidates.id }).from(boardStoryCandidates).limit(1);

  if (!existing) {
    await insertBoardSeedData();
  }

  const sourceRows = await db.select().from(boardSources);
  if (sourceRows.some((source) => needsBoardSourceConfigSync(source))) {
    await syncBoardSourceConfigs();
  }

  // Insert any new sources from boardSourceConfigSeeds that don't exist yet
  await ensureConfiguredSourcesExist(sourceRows);

  const [existingChannels] = await db
    .select({ id: boardCompetitorChannels.id })
    .from(boardCompetitorChannels)
    .limit(1);

  if (!existingChannels) {
    await insertBoardSeedData();
  }

  await ensureBoardFeedItemVersionsBackfill();
  await syncBoardStoryCorrectionFlags();
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

async function backfillBoardFeedItemSignals() {
  const db = getDb();
  const feedItems = await db
    .select({
      id: boardFeedItems.id,
      title: boardFeedItems.title,
      summary: boardFeedItems.summary,
      sentimentScore: boardFeedItems.sentimentScore,
      controversyScore: boardFeedItems.controversyScore,
      entityKeysJson: boardFeedItems.entityKeysJson,
      metadataJson: boardFeedItems.metadataJson,
    })
    .from(boardFeedItems);

  for (const feedItem of feedItems) {
    const metadataJson = coerceObject(feedItem.metadataJson);
    const entityKeys = coerceStringArray(feedItem.entityKeysJson);
    if (
      metadataJson?.signalVersion === BOARD_FEED_SIGNAL_VERSION &&
      entityKeys.length > 0
    ) {
      continue;
    }

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

  return { updatedFeedItems: feedItems.length };
}

export async function recomputeBoardStoryMetrics() {
  await ensureBoardSeedData();
  await backfillBoardFeedItemSignals();

  const db = getDb();
  const [stories, relationships] = await Promise.all([
    db
      .select({
        id: boardStoryCandidates.id,
        scoreJson: boardStoryCandidates.scoreJson,
        firstSeenAt: boardStoryCandidates.firstSeenAt,
        lastSeenAt: boardStoryCandidates.lastSeenAt,
      })
      .from(boardStoryCandidates),
    db
      .select({
        storyId: boardStorySources.storyId,
        sourceId: boardFeedItems.sourceId,
        publishedAt: boardFeedItems.publishedAt,
        sentimentScore: boardFeedItems.sentimentScore,
        controversyScore: boardFeedItems.controversyScore,
        entityKeysJson: boardFeedItems.entityKeysJson,
      })
      .from(boardStorySources)
      .innerJoin(boardFeedItems, eq(boardFeedItems.id, boardStorySources.feedItemId)),
  ]);

  const aggregates = new Map<
    string,
    {
      itemCount: number;
      sourceIds: Set<string>;
      earliestPublishedAt: Date | null;
      latestPublishedAt: Date | null;
      sentimentTotal: number;
      controversyTotal: number;
      maxControversy: number;
      entityCounts: Map<string, number>;
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
        sentimentTotal: 0,
        controversyTotal: 0,
        maxControversy: 0,
        entityCounts: new Map<string, number>(),
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

    aggregates.set(relation.storyId, aggregate);
  }

  await Promise.all(
    stories.map((story) => {
      const aggregate = aggregates.get(story.id);
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

      return db
        .update(boardStoryCandidates)
        .set({
          itemsCount: itemCount,
          sourcesCount: aggregate?.sourceIds.size ?? 0,
          sentimentScore: avgSentiment,
          controversyScore: avgControversy,
          firstSeenAt: aggregate?.earliestPublishedAt ?? story.firstSeenAt,
          lastSeenAt: aggregate?.latestPublishedAt ?? story.lastSeenAt,
          scoreJson: updatedScoreJson,
          updatedAt: new Date(),
        })
        .where(eq(boardStoryCandidates.id, story.id));
    })
  );

  return {
    storyCount: stories.length,
    feedItemCount: relationships.length,
  };
}

export async function rescoreBoardStories(storyIds?: string[]) {
  await ensureBoardSeedData();

  const db = getDb();
  const rows = await db
    .select({ id: boardStoryCandidates.id })
    .from(boardStoryCandidates)
    .where(
      storyIds && storyIds.length > 0
        ? inArray(boardStoryCandidates.id, Array.from(new Set(storyIds)))
        : sql`true`
    );

  for (const row of rows) {
    await scoreStory(row.id);
  }

  return {
    rescoredStories: rows.length,
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
          source.kind !== "x_account"
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
  const status = input.status ?? null;
  const storyType = input.storyType ?? null;
  const search = normalizeSearch(input.search);
  const moonFitBand = input.moonFitBand?.trim().toLowerCase() ?? "";
  const moonCluster = input.moonCluster?.trim().toLowerCase() ?? "";
  const coverageMode = input.coverageMode?.trim().toLowerCase() ?? "";
  const vertical = input.vertical?.trim().toLowerCase() ?? "";
  const hasAnalogs = typeof input.hasAnalogs === "boolean" ? input.hasAnalogs : null;
  const minMoonFitScore = typeof input.minMoonFitScore === "number" ? Math.max(0, input.minMoonFitScore) : null;
  const sort = input.sort ?? (view === "controversy" ? "controversy" : "moonFit");
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
    filters.push(
      or(
        ilike(boardStoryCandidates.canonicalTitle, pattern),
        ilike(boardStoryCandidates.vertical, pattern)
      )
    );
  }

  if (vertical.length > 0) {
    filters.push(ilike(boardStoryCandidates.vertical, `%${vertical}%`));
  }

  const where = filters.length > 0 ? and(...filters) : sql`true`;
  const rows = await db
    .select()
    .from(boardStoryCandidates)
    .where(where);

  let moonScoreMap = await getMoonStoryScoresByStoryIds(rows.map((row) => row.id));
  const missingStoryIds = rows
    .map((row) => row.id)
    .filter((storyId) => !moonScoreMap.has(storyId));

  if (missingStoryIds.length > 0) {
    await scoreBoardStoriesWithMoonCorpus(missingStoryIds);
    moonScoreMap = await getMoonStoryScoresByStoryIds(rows.map((row) => row.id));
  }

  const previewsByStory = await getSourcePreviewsForStories(rows.map((row) => row.id));
  const summaries = rows
    .map((row) => mapStorySummary(row, previewsByStory.get(row.id) ?? [], moonScoreMap.get(row.id) ?? null))
    .filter((story) => {
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
    switch (sort) {
      case "controversy":
        return right.controversyScore - left.controversyScore || right.score - left.score;
      case "recency":
        return (Date.parse(right.lastSeenAt ?? "") || 0) - (Date.parse(left.lastSeenAt ?? "") || 0);
      case "views":
        return (right.analogMedianViews ?? 0) - (left.analogMedianViews ?? 0) || right.moonFitScore - left.moonFitScore;
      case "analogs":
        return right.analogTitles.length - left.analogTitles.length || right.moonFitScore - left.moonFitScore;
      case "storyScore":
        return right.score - left.score || right.moonFitScore - left.moonFitScore;
      case "moonFit":
      default:
        return right.moonFitScore - left.moonFitScore || right.score - left.score || right.controversyScore - left.controversyScore;
    }
  });

  const totalCount = summaries.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / limit));
  const offset = (page - 1) * limit;
  const stories = summaries.slice(offset, offset + limit);

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
      status,
      storyType,
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
  const expiresAt =
    typeof existingMetadata?.expiresAt === "string"
      ? Date.parse(existingMetadata.expiresAt)
      : Number.NaN;
  const storyLastSeenAt = coerceDate(story.lastSeenAt)?.getTime() ?? 0;
  const outputUpdatedAt = coerceDate(existing?.updatedAt)?.getTime() ?? 0;
  const isFresh =
    Boolean(existing) &&
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

  await recomputeBoardStoryMetrics();
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

  await recomputeBoardStoryMetrics();
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
      typeof coerceObject(row.storyScoreJson)?.overall === "number"
        ? (coerceObject(row.storyScoreJson)?.overall as number)
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
    sources: sources.map((source) => ({
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
  const metrics = await recomputeBoardStoryMetrics();
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

export async function getBoardHealth() {
  await ensureBoardSeedData();

  const db = getDb();
  const [sources, stories, queueItems, latestFeedRows, competitorPosts, activeAlertRows, feedItemRows] =
    await Promise.all([
    db.select().from(boardSources),
    db.select().from(boardStoryCandidates),
    db.select().from(boardQueueItems),
    db
      .select({
        latestPublishedAt: sql<Date | null>`max(${boardFeedItems.publishedAt})`,
        latestIngestedAt: sql<Date | null>`max(${boardFeedItems.ingestedAt})`,
      })
      .from(boardFeedItems),
    db.select().from(boardCompetitorPosts),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(boardSurgeAlerts)
      .where(isNull(boardSurgeAlerts.dismissedAt)),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(boardFeedItems),
  ]);

  const now = Date.now();
  let healthySources = 0;
  let staleSources = 0;
  let pollableSources = 0;

  for (const source of sources) {
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
    sourceCount: sources.length,
    enabledSources: sources.filter((source) => source.enabled).length,
    pollableSources,
    healthySources,
    staleSources,
    storyCount: stories.length,
    feedItemCount: feedItemRows[0]?.count ?? 0,
    controversyCount: stories.filter((story) => story.controversyScore >= 75).length,
    correctionCount: stories.filter((story) => story.correction).length,
    queueCount: queueItems.length,
    alertCount: activeAlertRows[0]?.count ?? 0,
    competitorAlerts: competitorPosts.filter((post) => post.alertLevel !== "none").length,
    latestPublishedAt: toIsoString(latestFeedRows[0]?.latestPublishedAt),
    latestIngestedAt: toIsoString(latestFeedRows[0]?.latestIngestedAt),
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

  const [stories, rows] = await Promise.all([
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
        publishedAt: boardFeedItems.publishedAt,
      })
      .from(boardStorySources)
      .innerJoin(boardFeedItems, eq(boardFeedItems.id, boardStorySources.feedItemId))
      .where(gte(boardFeedItems.publishedAt, baselineStart)),
  ]);

  const countsByStory = new Map<
    string,
    {
      currentCount: number;
      baselineCount: number;
    }
  >();

  for (const row of rows) {
    const publishedAt = coerceDate(row.publishedAt);
    if (!publishedAt) {
      continue;
    }

    const counts = countsByStory.get(row.storyId) ?? {
      currentCount: 0,
      baselineCount: 0,
    };

    if (publishedAt >= currentWindowStart) {
      counts.currentCount += 1;
    } else {
      counts.baselineCount += 1;
    }

    countsByStory.set(row.storyId, counts);
  }

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
  const [stories, queue, competitors, sources, health, ticker, alerts] = await Promise.all([
    listBoardStories(),
    listBoardQueue(),
    listBoardCompetitors(),
    listBoardSources(),
    getBoardHealth(),
    listBoardTicker(),
    listBoardAlerts(),
  ]);

  return {
    stories,
    queue,
    competitors,
    sources,
    health,
    ticker,
    alerts,
  };
}

export async function runBoardSourcePollCycle() {
  const rssIngestion = await ingestBoardRssSources();
  const youtubeIngestion = await ingestBoardYouTubeSources();
  const xIngestion = await ingestBoardXSources();
  await refreshBoardSourceHeartbeat();
  const metrics = await recomputeBoardStoryMetrics();
  const scoring = await rescoreBoardStories();
  const alerts = await detectBoardStoryAlerts();
  const health = await getBoardHealth();

  return {
    rssSourcesPolled: rssIngestion.sourcesPolled,
    youtubeSourcesPolled: youtubeIngestion.sourcesPolled,
    xSourcesPolled: xIngestion.sourcesPolled,
    feedItemsIngested:
      rssIngestion.feedItemsIngested +
      youtubeIngestion.feedItemsIngested +
      xIngestion.feedItemsIngested,
    relationsCreated:
      rssIngestion.relationsCreated +
      youtubeIngestion.relationsCreated +
      xIngestion.relationsCreated,
    storiesCreated:
      rssIngestion.storiesCreated +
      youtubeIngestion.storiesCreated +
      xIngestion.storiesCreated,
    versionCaptures:
      rssIngestion.versionCaptures +
      youtubeIngestion.versionCaptures +
      xIngestion.versionCaptures,
    correctionEvents:
      rssIngestion.correctionEvents +
      youtubeIngestion.correctionEvents +
      xIngestion.correctionEvents,
    failedSources:
      rssIngestion.failedSources +
      youtubeIngestion.failedSources +
      xIngestion.failedSources,
    ...scoring,
    ...metrics,
    ...alerts,
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
