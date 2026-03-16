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
  or,
  sql,
} from "drizzle-orm";

import { getDb } from "@/server/db/client";
import {
  boardAiOutputKindEnum,
  boardCompetitorChannels,
  boardCompetitorPosts,
  boardFeedItems,
  boardQueueItems,
  boardSources,
  boardStoryAiOutputs,
  boardStoryCandidates,
  boardStorySources,
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
import { fetchBoardRssItems, type BoardRssFeedItem } from "./rss";

export type BoardStoryStatus = (typeof boardStoryStatusEnum.enumValues)[number];
export type BoardStoryType = (typeof boardStoryTypeEnum.enumValues)[number];
export type BoardAiOutputKind = (typeof boardAiOutputKindEnum.enumValues)[number];
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
}

const DEFAULT_LIMIT = 24;
const MAX_LIMIT = 60;
const BOARD_AI_KINDS: BoardAiOutputKind[] = ["brief", "script_starter", "titles"];
const BOARD_STORY_MATCH_LOOKBACK_DAYS = 45;
const BOARD_RSS_ITEM_LOOKBACK_DAYS = 21;
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

function isBoardSourcePollable(source: typeof boardSources.$inferSelect): boolean {
  if (!source.enabled) {
    return false;
  }

  if (source.kind !== "rss") {
    return true;
  }

  return Boolean(parseBoardRssSourceConfig(source.configJson));
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
  item: BoardRssFeedItem,
  config: BoardRssSourceConfig
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
      const isPollableRss = source.kind !== "rss" || Boolean(configuredSource);

      return {
        name: source.name,
        kind: source.kind as (typeof boardSources.$inferInsert)["kind"],
        provider: (configuredSource?.provider ?? source.provider) as (typeof boardSources.$inferInsert)["provider"],
        pollIntervalMinutes:
          configuredSource?.pollIntervalMinutes ?? getPollIntervalMinutes(source.kind),
        enabled: isPollableRss,
        configJson:
          configuredSource?.configJson ??
          ({
            mode: "seed_reference",
            discovery: "html-board-spec",
            pollable: source.kind !== "rss",
          } as Record<string, unknown>),
        lastPolledAt: isPollableRss ? now : null,
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

export async function ensureBoardSeedData() {
  const db = getDb();
  const [existing] = await db.select({ id: boardStoryCandidates.id }).from(boardStoryCandidates).limit(1);

  if (!existing) {
    await insertBoardSeedData();
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
    { itemCount: number; sourceIds: Set<string>; latestPublishedAt: Date | null }
  >();

  for (const relation of relationships) {
    const publishedAt = coerceDate(relation.publishedAt);
    const aggregate =
      aggregates.get(relation.storyId) ?? {
        itemCount: 0,
        sourceIds: new Set<string>(),
        latestPublishedAt: null,
      };

    aggregate.itemCount += 1;
    aggregate.sourceIds.add(relation.sourceId);

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

  await db
    .update(boardSources)
    .set({
      lastPolledAt: now,
      lastSuccessAt: now,
      lastError: null,
      updatedAt: now,
    })
    .where(eq(boardSources.enabled, true));
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
  const [sources, stories, queueItems, latestFeedRows, competitorPosts] = await Promise.all([
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
  ]);

  const now = Date.now();
  let healthySources = 0;
  let staleSources = 0;

  for (const source of sources) {
    if (!source.enabled) {
      continue;
    }

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
    healthySources,
    staleSources,
    storyCount: stories.length,
    controversyCount: stories.filter((story) => story.controversyScore >= 75).length,
    correctionCount: stories.filter((story) => story.correction).length,
    queueCount: queueItems.length,
    competitorAlerts: competitorPosts.filter((post) => post.alertLevel !== "none").length,
    latestPublishedAt: toIsoString(latestFeedRows[0]?.latestPublishedAt),
    latestIngestedAt: toIsoString(latestFeedRows[0]?.latestIngestedAt),
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
  const [stories, queue, competitors, sources, health, ticker] = await Promise.all([
    listBoardStories(),
    listBoardQueue(),
    listBoardCompetitors(),
    listBoardSources(),
    getBoardHealth(),
    listBoardTicker(),
  ]);

  return {
    stories,
    queue,
    competitors,
    sources,
    health,
    ticker,
  };
}

export async function runBoardSourcePollCycle() {
  await refreshBoardSourceHeartbeat();
  const metrics = await recomputeBoardStoryMetrics();
  const health = await getBoardHealth();

  return {
    ...metrics,
    healthySources: health.healthySources,
  };
}

export async function runBoardClusteringCycle() {
  return recomputeBoardStoryMetrics();
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
