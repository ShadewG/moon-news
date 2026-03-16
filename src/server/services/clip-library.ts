import "server-only";

import { and, desc, eq, ilike, or, sql } from "drizzle-orm";

import { getDb } from "@/server/db/client";
import {
  clipLibrary,
  clipSearchQuotes,
  providerEnum,
  transcriptCache,
} from "@/server/db/schema";

export type ClipProvider = (typeof providerEnum.enumValues)[number];
export type LibraryProviderFilter = "all" | "youtube" | "twitter" | "internet_archive";
export type LibrarySort = "recent" | "views" | "quotes" | "duration";

export interface ClipTranscriptSegment {
  text: string;
  startMs: number;
  durationMs: number;
}

export interface ClipLibraryUpsertInput {
  provider: ClipProvider;
  externalId: string;
  title: string;
  sourceUrl: string;
  previewUrl?: string | null;
  channelOrContributor?: string | null;
  durationMs?: number | null;
  viewCount?: number | null;
  uploadDate?: string | null;
  metadataJson?: Record<string, unknown> | null;
}

export interface ListLibraryClipsInput {
  q?: string;
  provider?: LibraryProviderFilter;
  sort?: LibrarySort;
  transcriptOnly?: boolean;
  page?: number;
  limit?: number;
}

export interface LibraryClipRecord {
  id: string;
  provider: string;
  externalId: string;
  title: string;
  sourceUrl: string;
  previewUrl: string | null;
  channelOrContributor: string | null;
  durationMs: number | null;
  viewCount: number | null;
  uploadDate: string | null;
  hasTranscript: boolean;
  quoteCount: number;
  transcriptMatch: string | null;
  createdAt: string;
}

export interface LibraryQueryState {
  q: string;
  provider: LibraryProviderFilter;
  sort: LibrarySort;
  transcriptOnly: boolean;
  page: number;
  limit: number;
}

export interface LibraryStats {
  totalClips: number;
  totalTranscripts: number;
  totalQuotes: number;
  providerCounts: Record<string, number>;
}

export interface LibraryPageInfo {
  page: number;
  limit: number;
  totalCount: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

export interface LibraryListingResult {
  clips: LibraryClipRecord[];
  stats: LibraryStats;
  pageInfo: LibraryPageInfo;
  query: LibraryQueryState;
}

const DEFAULT_LIMIT = 48;
const MAX_LIMIT = 96;
const MIN_QUERY_LENGTH = 2;

function normalizeQuery(value?: string): string {
  return value?.trim().slice(0, 200) ?? "";
}

function normalizeProvider(value?: string): LibraryProviderFilter {
  if (value === "youtube" || value === "twitter" || value === "internet_archive") {
    return value;
  }

  return "all";
}

function normalizeSort(value?: string): LibrarySort {
  if (value === "views" || value === "quotes" || value === "duration") {
    return value;
  }

  return "recent";
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

function buildLibraryWhere(input: {
  q: string;
  provider?: LibraryProviderFilter;
  transcriptOnly: boolean;
}) {
  const filters = [];

  if (input.provider && input.provider !== "all") {
    filters.push(eq(clipLibrary.provider, input.provider));
  }

  if (input.transcriptOnly) {
    filters.push(eq(clipLibrary.hasTranscript, true));
  }

  if (input.q.length >= MIN_QUERY_LENGTH) {
    const pattern = `%${input.q}%`;
    filters.push(
      or(
        ilike(clipLibrary.title, pattern),
        ilike(clipLibrary.channelOrContributor, pattern),
        ilike(transcriptCache.fullText, pattern)
      )
    );
  }

  return filters.length > 0 ? and(...filters) : sql`true`;
}

export async function upsertClipInLibrary(
  input: ClipLibraryUpsertInput
): Promise<string> {
  const db = getDb();

  const [existing] = await db
    .select({ id: clipLibrary.id })
    .from(clipLibrary)
    .where(
      and(
        eq(clipLibrary.provider, input.provider),
        eq(clipLibrary.externalId, input.externalId)
      )
    )
    .limit(1);

  if (existing) {
    if (input.viewCount != null && input.viewCount > 0) {
      await db
        .update(clipLibrary)
        .set({
          viewCount: sql`GREATEST(COALESCE(${clipLibrary.viewCount}, 0), ${input.viewCount})`,
          updatedAt: new Date(),
        })
        .where(eq(clipLibrary.id, existing.id));
    }

    return existing.id;
  }

  const [clip] = await db
    .insert(clipLibrary)
    .values({
      provider: input.provider,
      externalId: input.externalId,
      title: input.title,
      sourceUrl: input.sourceUrl,
      previewUrl: input.previewUrl ?? null,
      channelOrContributor: input.channelOrContributor ?? null,
      durationMs: input.durationMs ?? null,
      viewCount: input.viewCount ?? null,
      uploadDate: input.uploadDate ?? null,
      metadataJson: input.metadataJson ?? null,
    })
    .returning({ id: clipLibrary.id });

  return clip.id;
}

export async function getCachedTranscriptSegments(
  clipId: string
): Promise<ClipTranscriptSegment[] | null> {
  const db = getDb();

  const [cached] = await db
    .select({ segmentsJson: transcriptCache.segmentsJson })
    .from(transcriptCache)
    .where(
      and(
        eq(transcriptCache.clipId, clipId),
        eq(transcriptCache.language, "en")
      )
    )
    .limit(1);

  return (cached?.segmentsJson as ClipTranscriptSegment[] | undefined) ?? null;
}

export async function ensureYouTubeTranscript(
  clipId: string,
  videoId: string
): Promise<ClipTranscriptSegment[] | null> {
  const cached = await getCachedTranscriptSegments(clipId);
  if (cached) {
    return cached;
  }

  try {
    const { extractYouTubeTranscript } = await import(
      "@/server/providers/youtube-transcript"
    );

    const segments = await extractYouTubeTranscript(videoId);
    if (segments.length === 0) {
      return null;
    }

    const db = getDb();
    const fullText = segments.map((segment) => segment.text).join(" ");

    await db
      .insert(transcriptCache)
      .values({
        clipId,
        language: "en",
        fullText,
        segmentsJson: segments,
        wordCount: fullText.split(/\s+/).length,
      })
      .onConflictDoNothing();

    await db
      .update(clipLibrary)
      .set({ hasTranscript: true, updatedAt: new Date() })
      .where(eq(clipLibrary.id, clipId));

    return segments;
  } catch {
    return null;
  }
}

export async function listLibraryClips(
  input: ListLibraryClipsInput = {}
): Promise<LibraryListingResult> {
  const db = getDb();

  const query: LibraryQueryState = {
    q: normalizeQuery(input.q),
    provider: normalizeProvider(input.provider),
    sort: normalizeSort(input.sort),
    transcriptOnly: Boolean(input.transcriptOnly),
    page: normalizePage(input.page),
    limit: normalizeLimit(input.limit),
  };

  const offset = (query.page - 1) * query.limit;
  const listingWhere = buildLibraryWhere({
    q: query.q,
    provider: query.provider,
    transcriptOnly: query.transcriptOnly,
  });
  const summaryWhere = buildLibraryWhere({
    q: query.q,
    transcriptOnly: query.transcriptOnly,
  });
  const quotePattern = `%${query.q}%`;

  const quoteCounts = db
    .select({
      clipId: clipSearchQuotes.clipId,
      quoteCount: sql<number>`count(*)::int`.as("quote_count"),
    })
    .from(clipSearchQuotes)
    .groupBy(clipSearchQuotes.clipId)
    .as("quote_counts");

  const transcriptMatchSql =
    query.q.length >= MIN_QUERY_LENGTH
      ? sql<string | null>`
          case
            when ${transcriptCache.fullText} ilike ${quotePattern} then
              trim(
                both ' ' from substring(
                  ${transcriptCache.fullText}
                  from greatest(position(lower(${query.q}) in lower(${transcriptCache.fullText})) - 80, 1)
                  for 240
                )
              )
            else null
          end
        `
      : sql<string | null>`null`;

  const orderBy =
    query.sort === "views"
      ? [
          desc(sql<number>`coalesce(${clipLibrary.viewCount}, 0)`),
          desc(sql<number>`coalesce(${quoteCounts.quoteCount}, 0)`),
          desc(clipLibrary.createdAt),
        ]
      : query.sort === "quotes"
        ? [
            desc(sql<number>`coalesce(${quoteCounts.quoteCount}, 0)`),
            desc(sql<number>`coalesce(${clipLibrary.viewCount}, 0)`),
            desc(clipLibrary.createdAt),
          ]
        : query.sort === "duration"
          ? [
              desc(sql<number>`coalesce(${clipLibrary.durationMs}, 0)`),
              desc(sql<number>`coalesce(${quoteCounts.quoteCount}, 0)`),
              desc(clipLibrary.createdAt),
            ]
          : [
              sql`${clipLibrary.uploadDate} desc nulls last`,
              desc(clipLibrary.createdAt),
            ];

  const [rows, summaryRows, providerRows, pageSummary] = await Promise.all([
    db
      .select({
        clip: clipLibrary,
        quoteCount: sql<number>`coalesce(${quoteCounts.quoteCount}, 0)::int`,
        transcriptMatch: transcriptMatchSql,
      })
      .from(clipLibrary)
      .leftJoin(
        transcriptCache,
        and(
          eq(transcriptCache.clipId, clipLibrary.id),
          eq(transcriptCache.language, "en")
        )
      )
      .leftJoin(quoteCounts, eq(quoteCounts.clipId, clipLibrary.id))
      .where(listingWhere)
      .orderBy(...orderBy)
      .limit(query.limit)
      .offset(offset),
    db
      .select({
        totalClips: sql<number>`count(*)::int`,
        totalTranscripts: sql<number>`coalesce(sum(case when ${clipLibrary.hasTranscript} then 1 else 0 end), 0)::int`,
        totalQuotes: sql<number>`coalesce(sum(coalesce(${quoteCounts.quoteCount}, 0)), 0)::int`,
      })
      .from(clipLibrary)
      .leftJoin(
        transcriptCache,
        and(
          eq(transcriptCache.clipId, clipLibrary.id),
          eq(transcriptCache.language, "en")
        )
      )
      .leftJoin(quoteCounts, eq(quoteCounts.clipId, clipLibrary.id))
      .where(summaryWhere),
    db
      .select({
        provider: clipLibrary.provider,
        count: sql<number>`count(*)::int`,
      })
      .from(clipLibrary)
      .leftJoin(
        transcriptCache,
        and(
          eq(transcriptCache.clipId, clipLibrary.id),
          eq(transcriptCache.language, "en")
        )
      )
      .where(summaryWhere)
      .groupBy(clipLibrary.provider),
    db
      .select({
        totalCount: sql<number>`count(*)::int`,
      })
      .from(clipLibrary)
      .leftJoin(
        transcriptCache,
        and(
          eq(transcriptCache.clipId, clipLibrary.id),
          eq(transcriptCache.language, "en")
        )
      )
      .where(listingWhere),
  ]);

  const summary = summaryRows[0] ?? {
    totalClips: 0,
    totalTranscripts: 0,
    totalQuotes: 0,
  };
  const totalCount = pageSummary[0]?.totalCount ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / query.limit));
  const providerCounts = providerRows.reduce<Record<string, number>>(
    (counts, row) => {
      counts[row.provider] = row.count;
      return counts;
    },
    { all: summary.totalClips }
  );

  return {
    clips: rows.map((row) => ({
      id: row.clip.id,
      provider: row.clip.provider,
      externalId: row.clip.externalId,
      title: row.clip.title,
      sourceUrl: row.clip.sourceUrl,
      previewUrl: row.clip.previewUrl,
      channelOrContributor: row.clip.channelOrContributor,
      durationMs: row.clip.durationMs,
      viewCount: row.clip.viewCount,
      uploadDate: row.clip.uploadDate,
      hasTranscript: row.clip.hasTranscript,
      quoteCount: row.quoteCount,
      transcriptMatch: row.transcriptMatch,
      createdAt: row.clip.createdAt.toISOString(),
    })),
    stats: {
      totalClips: summary.totalClips,
      totalTranscripts: summary.totalTranscripts,
      totalQuotes: summary.totalQuotes,
      providerCounts,
    },
    pageInfo: {
      page: query.page,
      limit: query.limit,
      totalCount,
      totalPages,
      hasNextPage: query.page < totalPages,
      hasPreviousPage: query.page > 1,
    },
    query,
  };
}
