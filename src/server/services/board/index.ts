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
  boardQueueItems,
  boardSources,
  boardStoryAiOutputs,
  boardStoryCandidates,
  boardStorySources,
  boardSurgeAlerts,
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
import { fetchBoardRssItems, type BoardRssFeedItem } from "./rss";

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
}

export interface BoardStoryDetail {
  story: BoardStorySummary;
  sources: BoardStorySourcePreview[];
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

export interface ListBoardStoriesInput {
  view?: BoardView;
  status?: BoardStoryStatus;
  storyType?: BoardStoryType;
  search?: string;
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

const DEFAULT_LIMIT = 24;
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
  channelId: string;
  uploadsPlaylistId: string;
  channelHandle?: string;
  channelUrl?: string;
  sourceType?: string;
  vertical?: string;
  authorityScore?: number;
  tags: string[];
  maxResults?: number;
}

type BoardSourceConfig = BoardRssSourceConfig | BoardYouTubeSourceConfig;

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
    config.mode !== "youtube_channel" ||
    typeof config.channelId !== "string" ||
    typeof config.uploadsPlaylistId !== "string"
  ) {
    return null;
  }

  return {
    mode: "youtube_channel",
    channelId: config.channelId,
    uploadsPlaylistId: config.uploadsPlaylistId,
    channelHandle:
      typeof config.channelHandle === "string" ? config.channelHandle : undefined,
    channelUrl: typeof config.channelUrl === "string" ? config.channelUrl : undefined,
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

  return null;
}

function isBoardSourcePollable(source: typeof boardSources.$inferSelect): boolean {
  if (!source.enabled) {
    return false;
  }

  if (source.kind !== "rss" && source.kind !== "youtube_channel") {
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
        config.uploadsPlaylistId !== configuredSource.configJson.uploadsPlaylistId
      );
    }
  }

  return (source.kind === "rss" || source.kind === "youtube_channel") && source.enabled;
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

  const previews = new Map<string, BoardStorySourcePreview[]>();

  for (const row of rows) {
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
    };

    const existing = previews.get(row.storyId) ?? [];
    existing.push(preview);
    previews.set(row.storyId, existing);
  }

  return previews;
}

function mapStorySummary(
  story: typeof boardStoryCandidates.$inferSelect,
  previews: BoardStorySourcePreview[]
): BoardStorySummary {
  const metadataJson = coerceObject(story.metadataJson);
  const scoreJson = coerceObject(story.scoreJson);
  const score =
    typeof scoreJson?.overall === "number" ? (scoreJson.overall as number) : story.surgeScore;

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
        source.kind !== "rss" && source.kind !== "youtube_channel"
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
            pollable: source.kind !== "rss" && source.kind !== "youtube_channel",
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
      .filter((source) => source.kind === "rss" || source.kind === "youtube_channel")
      .map((source) => {
      const configuredSource = getBoardSourceSeedConfig(source.name, source.kind);
      const isConfiguredPollable =
        source.kind !== "rss" && source.kind !== "youtube_channel"
          ? true
          : Boolean(configuredSource);

      return db
        .update(boardSources)
        .set({
          provider: configuredSource?.provider ?? source.provider,
          pollIntervalMinutes:
            configuredSource?.pollIntervalMinutes ?? getPollIntervalMinutes(source.kind),
          enabled:
            source.kind === "rss" || source.kind === "youtube_channel"
              ? isConfiguredPollable
              : source.enabled,
          configJson:
            configuredSource?.configJson ??
            ({
              mode: "seed_reference",
              discovery: "html-board-spec",
              pollable: source.kind !== "rss" && source.kind !== "youtube_channel",
            } as Record<string, unknown>),
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
  const controversyScore = computeBoardControversyScore(item.title, item.summary);
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
      sentimentScore: computeBoardSentimentScore(storyType, controversyScore),
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
        ingestKind: "rss",
        sourceTags: config.tags,
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
  const sourceType = getBoardSourceType(args.config, args.source);

  for (const item of args.items) {
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
        metadataJson: {
          ...(coerceObject(item.metadataJson) ?? {}),
          ingestKind: args.config.mode,
          sourceType,
        },
        ingestedAt: new Date(),
      })
      .onConflictDoNothing()
      .returning({
        id: boardFeedItems.id,
      });

    const feedItem =
      insertedFeedItem ??
      (
        await db
          .select({ id: boardFeedItems.id })
          .from(boardFeedItems)
          .where(
            and(
              eq(boardFeedItems.sourceId, args.source.id),
              eq(boardFeedItems.externalId, item.externalId)
            )
          )
          .limit(1)
      )[0];

    if (!feedItem) {
      continue;
    }

    if (insertedFeedItem) {
      feedItemsIngested += 1;
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
  }

  return {
    feedItemsIngested,
    relationsCreated,
    storiesCreated,
  };
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
  let failedSources = 0;

  for (const source of sources) {
    const config = parseBoardRssSourceConfig(source.configJson);
    if (source.kind !== "rss" || !config) {
      continue;
    }

    sourcesPolled += 1;

    try {
      const items = (await fetchBoardRssItems(config.feedUrl))
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

      const ingestion = await ingestBoardItemsForSource({
        source,
        config,
        items,
        storyMatches,
      });
      feedItemsIngested += ingestion.feedItemsIngested;
      relationsCreated += ingestion.relationsCreated;
      storiesCreated += ingestion.storiesCreated;

      await db
        .update(boardSources)
        .set({
          lastPolledAt: new Date(),
          lastSuccessAt: new Date(),
          lastError: null,
          updatedAt: new Date(),
        })
        .where(eq(boardSources.id, source.id));
    } catch (error) {
      failedSources += 1;
      await db
        .update(boardSources)
        .set({
          lastPolledAt: new Date(),
          lastError: error instanceof Error ? error.message.slice(0, 500) : "Unknown feed error",
          updatedAt: new Date(),
        })
        .where(eq(boardSources.id, source.id));
    }
  }

  return {
    sourcesPolled,
    feedItemsIngested,
    relationsCreated,
    storiesCreated,
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
  let failedSources = 0;

  for (const source of sources) {
    const config = parseBoardYouTubeSourceConfig(source.configJson);
    if (source.kind !== "youtube_channel" || !config) {
      continue;
    }

    sourcesPolled += 1;

    try {
      const { channel, items: uploads } = await fetchYouTubeChannelUploads({
        channelId: config.channelId,
        uploadsPlaylistId: config.uploadsPlaylistId,
        maxResults: config.maxResults ?? 8,
      });

      const items = uploads
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

      const ingestion = await ingestBoardItemsForSource({
        source,
        config,
        items,
        storyMatches,
      });
      feedItemsIngested += ingestion.feedItemsIngested;
      relationsCreated += ingestion.relationsCreated;
      storiesCreated += ingestion.storiesCreated;

      await db
        .update(boardSources)
        .set({
          lastPolledAt: new Date(),
          lastSuccessAt: new Date(),
          lastError: null,
          updatedAt: new Date(),
        })
        .where(eq(boardSources.id, source.id));
    } catch (error) {
      failedSources += 1;
      await db
        .update(boardSources)
        .set({
          lastPolledAt: new Date(),
          lastError:
            error instanceof Error ? error.message.slice(0, 500) : "Unknown YouTube error",
          updatedAt: new Date(),
        })
        .where(eq(boardSources.id, source.id));
    }
  }

  return {
    sourcesPolled,
    feedItemsIngested,
    relationsCreated,
    storiesCreated,
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

  const [existingChannels] = await db
    .select({ id: boardCompetitorChannels.id })
    .from(boardCompetitorChannels)
    .limit(1);

  if (!existingChannels) {
    await insertBoardSeedData();
  }
}

export async function recomputeBoardStoryMetrics() {
  await ensureBoardSeedData();

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
      };

    aggregate.itemCount += 1;
    aggregate.sourceIds.add(relation.sourceId);

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
      const updatedScoreJson = {
        ...(coerceObject(story.scoreJson) ?? {}),
        lastComputedAt: new Date().toISOString(),
      };

      return db
        .update(boardStoryCandidates)
        .set({
          itemsCount: aggregate?.itemCount ?? 0,
          sourcesCount: aggregate?.sourceIds.size ?? 0,
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
      .filter((source) => source.kind !== "rss" && source.kind !== "youtube_channel")
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
  const page = normalizePage(input.page);
  const limit = normalizeLimit(input.limit);
  const offset = (page - 1) * limit;

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

  const where = filters.length > 0 ? and(...filters) : sql`true`;
  const orderBy =
    view === "controversy"
      ? [
          desc(boardStoryCandidates.controversyScore),
          desc(boardStoryCandidates.surgeScore),
          desc(boardStoryCandidates.lastSeenAt),
        ]
      : [
          desc(boardStoryCandidates.surgeScore),
          desc(boardStoryCandidates.controversyScore),
          desc(boardStoryCandidates.lastSeenAt),
        ];

  const [rows, countRows] = await Promise.all([
    db
      .select()
      .from(boardStoryCandidates)
      .where(where)
      .orderBy(...orderBy)
      .limit(limit)
      .offset(offset),
    db
      .select({
        totalCount: sql<number>`count(*)::int`,
      })
      .from(boardStoryCandidates)
      .where(where),
  ]);

  const previewsByStory = await getSourcePreviewsForStories(rows.map((row) => row.id));
  const totalCount = countRows[0]?.totalCount ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / limit));

  return {
    stories: rows.map((row) => mapStorySummary(row, previewsByStory.get(row.id) ?? [])),
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

  const [previewsByStory, aiOutputRows, queueRows] = await Promise.all([
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
  ]);

  const sources = previewsByStory.get(story.id) ?? [];
  const aiOutputs = Object.fromEntries(
    BOARD_AI_KINDS.map((kind) => [kind, null])
  ) as BoardStoryDetail["aiOutputs"];

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

  return {
    story: mapStorySummary(story, sources),
    sources,
    aiOutputs,
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

  const formats = coerceStringArray(story.formatsJson);
  const [queueItem] = await db
    .insert(boardQueueItems)
    .values({
      storyId: story.id,
      position: (positionRow?.maxPosition ?? 0) + 1,
      status: "watching",
      format: formats.join(" + ") || null,
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

export async function getBoardHealth() {
  await ensureBoardSeedData();

  const db = getDb();
  const [sources, stories, queueItems, latestFeedRows, competitorPosts, activeAlertRows] =
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
  await refreshBoardSourceHeartbeat();
  const metrics = await recomputeBoardStoryMetrics();
  const alerts = await detectBoardStoryAlerts();
  const health = await getBoardHealth();

  return {
    rssSourcesPolled: rssIngestion.sourcesPolled,
    youtubeSourcesPolled: youtubeIngestion.sourcesPolled,
    feedItemsIngested: rssIngestion.feedItemsIngested + youtubeIngestion.feedItemsIngested,
    relationsCreated: rssIngestion.relationsCreated + youtubeIngestion.relationsCreated,
    storiesCreated: rssIngestion.storiesCreated + youtubeIngestion.storiesCreated,
    failedSources: rssIngestion.failedSources + youtubeIngestion.failedSources,
    ...metrics,
    ...alerts,
    healthySources: health.healthySources,
  };
}

export async function runBoardClusteringCycle() {
  const metrics = await recomputeBoardStoryMetrics();
  const alerts = await detectBoardStoryAlerts();

  return {
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
  await ensureBoardSeedData();
  const competitors = await listBoardCompetitors();

  return competitors.stats;
}

export async function runBoardAnomalyDetectionCycle() {
  return detectBoardStoryAlerts();
}
