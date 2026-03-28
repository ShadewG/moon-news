import "server-only";

import { and, desc, eq, ilike, inArray, isNotNull, or, sql } from "drizzle-orm";

import { getDb } from "@/server/db/client";
import {
  clipLibrary,
  clipSearchQuotes,
  providerEnum,
  scriptAgentQuotes,
  scriptAgentSources,
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
  quoteOnly?: boolean;
  moonOnly?: boolean;
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
  quoteMatch: string | null;
  topQuoteText: string | null;
  transcriptWordCount: number | null;
  isMoonVideo: boolean;
  createdAt: string;
}

export interface LibraryQueryState {
  q: string;
  provider: LibraryProviderFilter;
  sort: LibrarySort;
  transcriptOnly: boolean;
  quoteOnly: boolean;
  moonOnly: boolean;
  page: number;
  limit: number;
}

export interface LibraryStats {
  totalClips: number;
  totalTranscripts: number;
  totalQuotes: number;
  totalQuotedClips: number;
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

function normalizeBoolean(value?: boolean): boolean {
  return Boolean(value);
}

function buildLibraryWhere(input: {
  q: string;
  provider?: LibraryProviderFilter;
  transcriptOnly: boolean;
  quoteOnly: boolean;
  moonOnly: boolean;
  totalQuoteCountSql: ReturnType<typeof sql<number>>;
  quoteSearchFilters?: Array<ReturnType<typeof inArray>>;
}) {
  const filters = [];

  if (input.provider && input.provider !== "all") {
    filters.push(eq(clipLibrary.provider, input.provider));
  }

  if (input.transcriptOnly) {
    filters.push(eq(clipLibrary.hasTranscript, true));
  }

  if (input.quoteOnly) {
    filters.push(sql`${input.totalQuoteCountSql} > 0`);
  }

  if (input.moonOnly) {
    filters.push(
      or(
        eq(clipLibrary.channelOrContributor, "Moon"),
        sql`coalesce(${clipLibrary.metadataJson}->>'isMoonVideo', 'false') = 'true'`
      )
    );
  }

  if (input.q.length >= MIN_QUERY_LENGTH) {
    // For short queries (≤4 chars), use word-boundary regex to avoid false positives
    // e.g. "cia" should match "CIA" but not "magician" or "association"
    const isShort = input.q.length <= 4;
    if (isShort) {
      // PostgreSQL word-boundary regex: \m = start of word, \M = end of word
      const wordPattern = `\\m${input.q}\\M`;
      filters.push(
        or(
          sql`${clipLibrary.title} ~* ${wordPattern}`,
          sql`${clipLibrary.channelOrContributor} ~* ${wordPattern}`,
          sql`${transcriptCache.fullText} ~* ${wordPattern}`,
          ...(input.quoteSearchFilters ?? [])
        )
      );
    } else {
      const pattern = `%${input.q}%`;
      filters.push(
        or(
          ilike(clipLibrary.title, pattern),
          ilike(clipLibrary.channelOrContributor, pattern),
          ilike(transcriptCache.fullText, pattern),
          ...(input.quoteSearchFilters ?? [])
        )
      );
    }
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

export async function cacheTranscriptSegments(
  clipId: string,
  segments: ClipTranscriptSegment[]
): Promise<ClipTranscriptSegment[]> {
  const db = getDb();
  const fullText = segments.map((segment) => segment.text).join(" ");

  await db
    .insert(transcriptCache)
    .values({
      clipId,
      language: "en",
      fullText,
      segmentsJson: segments,
      wordCount: fullText.split(/\s+/).filter(Boolean).length,
    })
    .onConflictDoUpdate({
      target: [transcriptCache.clipId, transcriptCache.language],
      set: {
        fullText,
        segmentsJson: segments,
        wordCount: fullText.split(/\s+/).filter(Boolean).length,
      },
    });

  await db
    .update(clipLibrary)
    .set({ hasTranscript: true, updatedAt: new Date() })
    .where(eq(clipLibrary.id, clipId));

  return segments;
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

    return await cacheTranscriptSegments(clipId, segments);
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
    transcriptOnly: normalizeBoolean(input.transcriptOnly),
    quoteOnly: normalizeBoolean(input.quoteOnly),
    moonOnly: normalizeBoolean(input.moonOnly),
    page: normalizePage(input.page),
    limit: normalizeLimit(input.limit),
  };

  const offset = (query.page - 1) * query.limit;
  const quotePattern = `%${query.q}%`;

  const topicQuoteCounts = db
    .select({
      clipId: clipSearchQuotes.clipId,
      quoteCount: sql<number>`count(*)::int`.as("topic_quote_count"),
    })
    .from(clipSearchQuotes)
    .groupBy(clipSearchQuotes.clipId)
    .as("topic_quote_counts");

  const scriptQuoteCounts = db
    .select({
      clipId: scriptAgentSources.clipId,
      quoteCount: sql<number>`count(*)::int`.as("script_quote_count"),
    })
    .from(scriptAgentSources)
    .innerJoin(scriptAgentQuotes, eq(scriptAgentQuotes.sourceId, scriptAgentSources.id))
    .where(isNotNull(scriptAgentSources.clipId))
    .groupBy(scriptAgentSources.clipId)
    .as("script_quote_counts");

  const totalQuoteCountSql = sql<number>`
    (
      coalesce(${topicQuoteCounts.quoteCount}, 0) +
      coalesce(${scriptQuoteCounts.quoteCount}, 0)
    )::int
  `;

  const topicQuoteMatchClipIds =
    query.q.length >= MIN_QUERY_LENGTH
      ? db
          .select({ clipId: clipSearchQuotes.clipId })
          .from(clipSearchQuotes)
          .where(ilike(clipSearchQuotes.quoteText, quotePattern))
      : null;

  const scriptQuoteMatchClipIds =
    query.q.length >= MIN_QUERY_LENGTH
      ? db
          .select({ clipId: scriptAgentSources.clipId })
          .from(scriptAgentSources)
          .innerJoin(scriptAgentQuotes, eq(scriptAgentQuotes.sourceId, scriptAgentSources.id))
          .where(
            and(
              isNotNull(scriptAgentSources.clipId),
              ilike(scriptAgentQuotes.quoteText, quotePattern)
            )
          )
      : null;

  const listingWhere = buildLibraryWhere({
    q: query.q,
    provider: query.provider,
    transcriptOnly: query.transcriptOnly,
    quoteOnly: query.quoteOnly,
    moonOnly: query.moonOnly,
    totalQuoteCountSql,
    quoteSearchFilters: [
      ...(topicQuoteMatchClipIds ? [inArray(clipLibrary.id, topicQuoteMatchClipIds)] : []),
      ...(scriptQuoteMatchClipIds ? [inArray(clipLibrary.id, scriptQuoteMatchClipIds)] : []),
    ],
  });
  const summaryWhere = buildLibraryWhere({
    q: query.q,
    provider: query.provider,
    transcriptOnly: query.transcriptOnly,
    quoteOnly: query.quoteOnly,
    moonOnly: query.moonOnly,
    totalQuoteCountSql,
    quoteSearchFilters: [
      ...(topicQuoteMatchClipIds ? [inArray(clipLibrary.id, topicQuoteMatchClipIds)] : []),
      ...(scriptQuoteMatchClipIds ? [inArray(clipLibrary.id, scriptQuoteMatchClipIds)] : []),
    ],
  });

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

  const quoteMatchSql =
    query.q.length >= MIN_QUERY_LENGTH
      ? sql<string | null>`
          coalesce(
            (
              select ${scriptAgentQuotes.quoteText}
              from ${scriptAgentQuotes}
              inner join ${scriptAgentSources}
                on ${scriptAgentSources.id} = ${scriptAgentQuotes.sourceId}
              where ${scriptAgentSources.clipId} = ${clipLibrary.id}
                and ${scriptAgentQuotes.quoteText} ilike ${quotePattern}
              order by ${scriptAgentQuotes.relevanceScore} desc, ${scriptAgentQuotes.createdAt} desc
              limit 1
            ),
            (
              select ${clipSearchQuotes.quoteText}
              from ${clipSearchQuotes}
              where ${clipSearchQuotes.clipId} = ${clipLibrary.id}
                and ${clipSearchQuotes.quoteText} ilike ${quotePattern}
              order by ${clipSearchQuotes.relevanceScore} desc, ${clipSearchQuotes.createdAt} desc
              limit 1
            )
          )
        `
      : sql<string | null>`null`;

  const topQuoteTextSql = sql<string | null>`
    coalesce(
      (
        select ${scriptAgentQuotes.quoteText}
        from ${scriptAgentQuotes}
        inner join ${scriptAgentSources}
          on ${scriptAgentSources.id} = ${scriptAgentQuotes.sourceId}
        where ${scriptAgentSources.clipId} = ${clipLibrary.id}
        order by ${scriptAgentQuotes.relevanceScore} desc, ${scriptAgentQuotes.createdAt} desc
        limit 1
      ),
      (
        select ${clipSearchQuotes.quoteText}
        from ${clipSearchQuotes}
        where ${clipSearchQuotes.clipId} = ${clipLibrary.id}
        order by ${clipSearchQuotes.relevanceScore} desc, ${clipSearchQuotes.createdAt} desc
        limit 1
      )
    )
  `;

  const isMoonVideoSql = sql<boolean>`
    (
      ${clipLibrary.channelOrContributor} = 'Moon' or
      coalesce(${clipLibrary.metadataJson}->>'isMoonVideo', 'false') = 'true'
    )
  `;

  // When searching, prepend a relevance score so title/channel matches rank above transcript-only matches
  const relevancePrefix =
    query.q.length >= MIN_QUERY_LENGTH
      ? [
          desc(
            sql<number>`(
              case
                when ${clipLibrary.title} ilike ${`%${query.q}%`} then 3
                when ${clipLibrary.channelOrContributor} ilike ${`%${query.q}%`} then 2
                else 1
              end
            )`
          ),
        ]
      : [];

  const orderBy = [
    ...relevancePrefix,
    ...(query.sort === "views"
      ? [
          desc(sql<number>`coalesce(${clipLibrary.viewCount}, 0)`),
          desc(totalQuoteCountSql),
          desc(clipLibrary.createdAt),
        ]
      : query.sort === "quotes"
        ? [
            desc(totalQuoteCountSql),
            desc(sql<number>`coalesce(${clipLibrary.viewCount}, 0)`),
            desc(clipLibrary.createdAt),
          ]
        : query.sort === "duration"
          ? [
              desc(sql<number>`coalesce(${clipLibrary.durationMs}, 0)`),
              desc(totalQuoteCountSql),
              desc(clipLibrary.createdAt),
            ]
          : [
              sql`${clipLibrary.uploadDate} desc nulls last`,
              desc(clipLibrary.createdAt),
            ]),
  ];

  const [rows, summaryRows, providerRows, pageSummary] = await Promise.all([
    db
      .select({
        clip: clipLibrary,
        quoteCount: totalQuoteCountSql,
        transcriptMatch: transcriptMatchSql,
        quoteMatch: quoteMatchSql,
        topQuoteText: topQuoteTextSql,
        transcriptWordCount: transcriptCache.wordCount,
        isMoonVideo: isMoonVideoSql,
      })
      .from(clipLibrary)
      .leftJoin(
        transcriptCache,
        and(
          eq(transcriptCache.clipId, clipLibrary.id),
          eq(transcriptCache.language, "en")
        )
      )
      .leftJoin(topicQuoteCounts, eq(topicQuoteCounts.clipId, clipLibrary.id))
      .leftJoin(scriptQuoteCounts, eq(scriptQuoteCounts.clipId, clipLibrary.id))
      .where(listingWhere)
      .orderBy(...orderBy)
      .limit(query.limit)
      .offset(offset),
    db
      .select({
        totalClips: sql<number>`count(*)::int`,
        totalTranscripts: sql<number>`coalesce(sum(case when ${clipLibrary.hasTranscript} then 1 else 0 end), 0)::int`,
        totalQuotes: sql<number>`coalesce(sum(${totalQuoteCountSql}), 0)::int`,
        totalQuotedClips: sql<number>`coalesce(sum(case when ${totalQuoteCountSql} > 0 then 1 else 0 end), 0)::int`,
      })
      .from(clipLibrary)
      .leftJoin(
        transcriptCache,
        and(
          eq(transcriptCache.clipId, clipLibrary.id),
          eq(transcriptCache.language, "en")
        )
      )
      .leftJoin(topicQuoteCounts, eq(topicQuoteCounts.clipId, clipLibrary.id))
      .leftJoin(scriptQuoteCounts, eq(scriptQuoteCounts.clipId, clipLibrary.id))
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
      .leftJoin(topicQuoteCounts, eq(topicQuoteCounts.clipId, clipLibrary.id))
      .leftJoin(scriptQuoteCounts, eq(scriptQuoteCounts.clipId, clipLibrary.id))
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
      .leftJoin(topicQuoteCounts, eq(topicQuoteCounts.clipId, clipLibrary.id))
      .leftJoin(scriptQuoteCounts, eq(scriptQuoteCounts.clipId, clipLibrary.id))
      .where(listingWhere),
  ]);

  const summary = summaryRows[0] ?? {
    totalClips: 0,
    totalTranscripts: 0,
    totalQuotes: 0,
    totalQuotedClips: 0,
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
  const stats: LibraryStats = {
    totalClips: summary.totalClips,
    totalTranscripts: summary.totalTranscripts,
    totalQuotes: summary.totalQuotes,
    totalQuotedClips: summary.totalQuotedClips,
    providerCounts,
  };

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
      quoteMatch: row.quoteMatch,
      topQuoteText: row.topQuoteText,
      transcriptWordCount: row.transcriptWordCount,
      isMoonVideo: row.isMoonVideo,
      createdAt: row.clip.createdAt.toISOString(),
    })),
    stats,
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
