import "server-only";

import { searchYouTube } from "@/server/providers/youtube";
import { searchInternetArchive } from "@/server/providers/internet-archive";
import { searchTwitterVideos } from "@/server/providers/twitter";
import { scoreResultRelevance, findRelevantQuotes } from "@/server/providers/openai";
import { passesQualityGate } from "./scoring";

export interface TopicResult {
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
  query: string;
  clips: TopicResult[];
  quotes: TopicQuote[];
  totalFound: number;
  totalFiltered: number;
}

export async function searchTopic(query: string): Promise<TopicSearchResult> {
  const keywords = query.split(/\s+/).slice(0, 6);

  // Search all providers in parallel
  const [ytResult, iaResult, xResult] = await Promise.allSettled([
    searchYouTube({ keywords, temporalContext: null, maxResults: 15 }),
    searchInternetArchive({ keywords, temporalContext: null, maxResults: 10 }),
    searchTwitterVideos({ keywords, temporalContext: null, maxResults: 10 }),
  ]);

  // Collect all raw results
  const rawResults: Array<{
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
  }> = [];

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

  // Build scored results
  const scored: TopicResult[] = passed
    .map((r, i) => ({
      provider: r.provider,
      mediaType: r.mediaType,
      title: r.title,
      sourceUrl: r.sourceUrl,
      previewUrl: r.previewUrl,
      channelOrContributor: r.channelOrContributor,
      viewCount: r.viewCount,
      durationMs: r.durationMs,
      uploadDate: r.uploadDate,
      relevanceScore: relevanceScores[i] ?? 20,
      externalId: r.externalId,
    }))
    .filter((r) => r.relevanceScore >= 10)
    .sort((a, b) => b.relevanceScore - a.relevanceScore);

  // Extract quotes from top 3 YouTube videos
  const topYT = scored
    .filter((r) => r.provider === "youtube")
    .slice(0, 3);

  const allQuotes: TopicQuote[] = [];

  for (const video of topYT) {
    try {
      const { extractYouTubeTranscript, mergeTranscriptSegments } =
        await import("@/server/providers/youtube-transcript");

      const segments = await extractYouTubeTranscript(video.externalId);
      if (segments.length === 0) continue;

      const merged = mergeTranscriptSegments(segments);
      const quotes = await findRelevantQuotes({
        lineText: query,
        transcript: merged,
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
      // Transcript extraction is best-effort
    }
  }

  allQuotes.sort((a, b) => b.relevanceScore - a.relevanceScore);

  return {
    query,
    clips: scored,
    quotes: allQuotes,
    totalFound: rawResults.length,
    totalFiltered,
  };
}
