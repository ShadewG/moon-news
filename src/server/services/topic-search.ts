import "server-only";

import { eq, sql } from "drizzle-orm";

import { getDb } from "@/server/db/client";
import {
  clipLibrary,
  clipSearches,
  clipSearchQuotes,
  clipSearchResults,
  transcriptCache,
} from "@/server/db/schema";
import { searchYouTube } from "@/server/providers/youtube";
import { searchInternetArchive } from "@/server/providers/internet-archive";
import { searchTwitterVideos } from "@/server/providers/twitter";
import { scoreResultRelevance, findRelevantQuotes } from "@/server/providers/openai";
import {
  type ClipProvider,
  ensureYouTubeTranscript,
  upsertClipInLibrary,
} from "./clip-library";
import { passesQualityGate } from "./scoring";

export interface TopicResult {
  clipId: string;
  provider: string;
  mediaType: string;
  title: string;
  sourceUrl: string;
  previewUrl: string | null;
  channelOrContributor: string | null;
  viewCount: number;
  durationMs: number | null;
  uploadDate: string | null;
  relevanceScore: number;
  externalId: string;
}

export interface TopicQuote {
  quoteText: string;
  speaker: string | null;
  startMs: number;
  relevanceScore: number;
  context: string;
  videoTitle: string;
  videoId: string;
  sourceUrl: string;
}

export interface TopicSearchResult {
  searchId: string;
  query: string;
  clips: TopicResult[];
  quotes: TopicQuote[];
  totalFound: number;
  totalFiltered: number;
}

interface RawResult {
  provider: string;
  mediaType: string;
  title: string;
  description: string;
  sourceUrl: string;
  previewUrl: string | null;
  channelOrContributor: string | null;
  viewCount: number;
  durationMs: number | null;
  uploadDate: string | null;
  externalId: string;
  metadataJson: Record<string, unknown> | null;
}

export async function searchTopic(query: string): Promise<TopicSearchResult> {
  const db = getDb();
  const keywords = query.split(/\s+/).slice(0, 6);

  // Search all providers in parallel
  const [ytResult, iaResult, xResult] = await Promise.allSettled([
    searchYouTube({ keywords, temporalContext: null, maxResults: 15 }),
    searchInternetArchive({ keywords, temporalContext: null, maxResults: 10 }),
    searchTwitterVideos({ keywords, temporalContext: null, maxResults: 10 }),
  ]);

  // Collect raw results
  const rawResults: RawResult[] = [];

  if (ytResult.status === "fulfilled") {
    for (const r of ytResult.value.results) {
      rawResults.push({
        provider: "youtube",
        mediaType: "video",
        title: r.title,
        description: r.description,
        sourceUrl: `https://www.youtube.com/watch?v=${r.videoId}`,
        previewUrl: r.thumbnailUrl,
        channelOrContributor: r.channelTitle,
        viewCount: r.viewCount,
        durationMs: r.durationMs,
        uploadDate: r.publishedAt,
        externalId: r.videoId,
        metadataJson: { viewCount: r.viewCount, description: r.description },
      });
    }
  }

  if (iaResult.status === "fulfilled") {
    for (const r of iaResult.value.results) {
      rawResults.push({
        provider: "internet_archive",
        mediaType: r.mediaType === "movies" ? "video" : "image",
        title: r.title,
        description: r.description,
        sourceUrl: r.sourceUrl,
        previewUrl: r.thumbnailUrl,
        channelOrContributor: r.creator,
        viewCount: 0,
        durationMs: r.durationMs,
        uploadDate: r.year,
        externalId: r.identifier,
        metadataJson: { collection: r.collection },
      });
    }
  }

  if (xResult.status === "fulfilled") {
    for (const r of xResult.value.results) {
      rawResults.push({
        provider: "twitter",
        mediaType: "video",
        title: r.text.slice(0, 200),
        description: r.videoDescription || r.text,
        sourceUrl: r.postUrl,
        previewUrl: null,
        channelOrContributor: `@${r.username}`,
        viewCount: r.viewCount,
        durationMs: null,
        uploadDate: r.postedAt,
        externalId: r.postUrl,
        metadataJson: {
          displayName: r.displayName,
          likeCount: r.likeCount,
          viewCount: r.viewCount,
          videoDescription: r.videoDescription,
        },
      });
    }
  }

  // Quality gate
  let totalFiltered = 0;
  const passed = rawResults.filter((r) => {
    const gate = passesQualityGate({
      provider: r.provider,
      title: r.title,
      durationMs: r.durationMs,
      channelOrContributor: r.channelOrContributor,
      viewCount: r.viewCount,
    });
    if (!gate.passes) totalFiltered++;
    return gate.passes;
  });

  // AI relevance scoring
  let relevanceScores: number[];
  try {
    relevanceScores = await scoreResultRelevance({
      lineText: query,
      results: passed.map((r) => ({
        title: r.title,
        description: r.description,
        provider: r.provider,
      })),
    });
  } catch {
    relevanceScores = passed.map((_, i) =>
      Math.max(20, 45 - Math.floor((i / passed.length) * 25))
    );
  }

  // Save all passing clips to library and build scored results
  const scored: TopicResult[] = [];

  for (let i = 0; i < passed.length; i++) {
    const r = passed[i];
    const relevance = relevanceScores[i] ?? 20;
    if (relevance < 10) continue;

    const clipId = await upsertClipInLibrary({
      provider: r.provider as ClipProvider,
      externalId: r.externalId,
      title: r.title,
      sourceUrl: r.sourceUrl,
      previewUrl: r.previewUrl,
      channelOrContributor: r.channelOrContributor,
      durationMs: r.durationMs,
      viewCount: r.viewCount,
      uploadDate: r.uploadDate,
      metadataJson: r.metadataJson,
    });

    scored.push({
      clipId,
      provider: r.provider,
      mediaType: r.mediaType,
      title: r.title,
      sourceUrl: r.sourceUrl,
      previewUrl: r.previewUrl,
      channelOrContributor: r.channelOrContributor,
      viewCount: r.viewCount,
      durationMs: r.durationMs,
      uploadDate: r.uploadDate,
      relevanceScore: relevance,
      externalId: r.externalId,
    });
  }

  scored.sort((a, b) => b.relevanceScore - a.relevanceScore);

  // Save search record
  const [search] = await db
    .insert(clipSearches)
    .values({
      query,
      resultsCount: scored.length,
    })
    .returning({ id: clipSearches.id });

  // Save search→clip links
  if (scored.length > 0) {
    await db.insert(clipSearchResults).values(
      scored.map((s) => ({
        searchId: search.id,
        clipId: s.clipId,
        relevanceScore: s.relevanceScore,
      }))
    );
  }

  // Extract quotes from top 3 YouTube videos (using transcript cache)
  const topYT = scored
    .filter((r) => r.provider === "youtube")
    .slice(0, 3);

  const allQuotes: TopicQuote[] = [];

  for (const video of topYT) {
    const segments = await ensureYouTubeTranscript(video.clipId, video.externalId);
    if (!segments) continue;

    try {
      const quotes = await findRelevantQuotes({
        lineText: query,
        transcript: segments,
        videoTitle: video.title,
        maxQuotes: 3,
      });

      for (const q of quotes) {
        const secs = Math.floor(q.startMs / 1000);
        allQuotes.push({
          quoteText: q.quoteText,
          speaker: q.speaker,
          startMs: q.startMs,
          relevanceScore: q.relevanceScore,
          context: q.context,
          videoTitle: video.title,
          videoId: video.externalId,
          sourceUrl: `https://www.youtube.com/watch?v=${video.externalId}&t=${secs}`,
        });
      }
    } catch {
      // Quote extraction best-effort
    }
  }

  allQuotes.sort((a, b) => b.relevanceScore - a.relevanceScore);

  // Save quotes to DB
  if (allQuotes.length > 0) {
    await db.insert(clipSearchQuotes).values(
      allQuotes.map((q) => {
        // Find the clipId for this quote's video
        const clip = scored.find((s) => s.externalId === q.videoId);
        return {
          searchId: search.id,
          clipId: clip?.clipId ?? scored[0]?.clipId ?? "",
          quoteText: q.quoteText,
          speaker: q.speaker,
          startMs: q.startMs,
          endMs: q.startMs + 10000,
          relevanceScore: q.relevanceScore,
          context: q.context,
        };
      }).filter((q) => q.clipId)
    );
  }

  // Update search with quote count
  await db
    .update(clipSearches)
    .set({ quotesCount: allQuotes.length })
    .where(eq(clipSearches.id, search.id));

  return {
    searchId: search.id,
    query,
    clips: scored,
    quotes: allQuotes,
    totalFound: rawResults.length,
    totalFiltered,
  };
}

/**
 * Search the local clip library by text — uses cached transcripts.
 */
export async function searchLibrary(query: string): Promise<{
  clips: Array<{
    id: string;
    provider: string;
    externalId: string;
    title: string;
    sourceUrl: string;
    channelOrContributor: string | null;
    viewCount: number | null;
    hasTranscript: boolean;
    transcriptMatch: string | null;
  }>;
}> {
  const db = getDb();

  // Search clip titles
  const titleMatches = await db
    .select()
    .from(clipLibrary)
    .where(sql`${clipLibrary.title} ILIKE ${"%" + query + "%"}`)
    .limit(20);

  // Search transcripts
  const transcriptMatches = await db
    .select({
      clip: clipLibrary,
      matchSnippet: sql<string>`substring(${transcriptCache.fullText} from position(lower(${query}) in lower(${transcriptCache.fullText})) for 200)`,
    })
    .from(transcriptCache)
    .innerJoin(clipLibrary, eq(clipLibrary.id, transcriptCache.clipId))
    .where(sql`${transcriptCache.fullText} ILIKE ${"%" + query + "%"}`)
    .limit(20);

  // Merge and dedupe
  const seen = new Set<string>();
  const results: Array<{
    id: string;
    provider: string;
    externalId: string;
    title: string;
    sourceUrl: string;
    channelOrContributor: string | null;
    viewCount: number | null;
    hasTranscript: boolean;
    transcriptMatch: string | null;
  }> = [];

  for (const t of transcriptMatches) {
    if (seen.has(t.clip.id)) continue;
    seen.add(t.clip.id);
    results.push({
      id: t.clip.id,
      provider: t.clip.provider,
      externalId: t.clip.externalId,
      title: t.clip.title,
      sourceUrl: t.clip.sourceUrl,
      channelOrContributor: t.clip.channelOrContributor,
      viewCount: t.clip.viewCount,
      hasTranscript: true,
      transcriptMatch: t.matchSnippet,
    });
  }

  for (const c of titleMatches) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    results.push({
      id: c.id,
      provider: c.provider,
      externalId: c.externalId,
      title: c.title,
      sourceUrl: c.sourceUrl,
      channelOrContributor: c.channelOrContributor,
      viewCount: c.viewCount,
      hasTranscript: c.hasTranscript,
      transcriptMatch: null,
    });
  }

  return { clips: results };
}
