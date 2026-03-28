import "server-only";

import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { desc, eq, sql } from "drizzle-orm";

import { getEnv } from "@/server/config/env";
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
import { searchResearchSources } from "@/server/providers/parallel";
import {
  classifyMediaSourceCandidates,
  findRelevantQuotes,
  scoreResultRelevance,
} from "@/server/providers/openai";
import { ingestLocalMediaArtifacts } from "@/server/providers/local-media";
import {
  cacheTranscriptSegments,
  type ClipProvider,
  ensureYouTubeTranscript,
  upsertClipInLibrary,
} from "./clip-library";
import { assessMediaSourceCandidate, shouldExcludeCommentaryCandidate } from "./media-source-classification";
import { filterOutMoonVideoCandidates } from "./moon-video-exclusion";
import { passesQualityGate } from "./scoring";

const TOPIC_RESULT_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const EMPTY_TOPIC_RESULT_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_TOPIC_KEYWORDS = 10;
const TOPIC_SEARCH_STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "been",
  "being",
  "breakdown",
  "by",
  "commentary",
  "did",
  "do",
  "does",
  "for",
  "from",
  "had",
  "has",
  "have",
  "how",
  "in",
  "into",
  "is",
  "it",
  "its",
  "led",
  "of",
  "on",
  "or",
  "podcast",
  "reaction",
  "s",
  "serious",
  "story",
  "that",
  "the",
  "their",
  "this",
  "to",
  "was",
  "were",
  "what",
  "when",
  "where",
  "which",
  "who",
  "with",
]);
const execFileAsync = promisify(execFile);

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

interface TopicSearchOptions {
  includeLocalTranscriptFallback?: boolean;
  includeAiQuotes?: boolean;
  allowCommentary?: boolean;
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

type MediaSourceAiDecision = {
  shouldInclude: boolean;
  isLikelySourceClip: boolean;
  confidence: number;
  reason: string;
};

const mediaSourceDecisionCache = new Map<string, MediaSourceAiDecision>();

function normalizeTopicQuery(query: string) {
  return query.trim().replace(/\s+/g, " ").toLowerCase();
}

function buildMediaSourceDecisionCacheKey(candidate: {
  provider?: string | null;
  title?: string | null;
  channelOrContributor?: string | null;
  sourceUrl?: string | null;
}) {
  return [
    candidate.provider ?? "",
    normalizeTopicQuery(candidate.title ?? ""),
    normalizeTopicQuery(candidate.channelOrContributor ?? ""),
    candidate.sourceUrl ?? "",
  ].join("::");
}

function buildTopicSearchKeywords(query: string): string[] {
  const rawTokens = query.match(/[A-Za-z0-9][A-Za-z0-9'_-]*/g) ?? [];
  const deduped: string[] = [];
  const seen = new Set<string>();

  for (const token of rawTokens) {
    const normalized = token.toLowerCase();
    if (
      TOPIC_SEARCH_STOPWORDS.has(normalized) ||
      (normalized.length < 3 && !/\d/.test(normalized))
    ) {
      continue;
    }

    if (seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    deduped.push(token);

    if (deduped.length >= MAX_TOPIC_KEYWORDS) {
      break;
    }
  }

  if (deduped.length > 0) {
    return deduped;
  }

  return rawTokens.slice(0, MAX_TOPIC_KEYWORDS);
}

function isLikelyTitleParrotClip(query: string, title: string) {
  const normalizeToken = (token: string) => token.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const queryKeywords = buildTopicSearchKeywords(query)
    .map(normalizeToken)
    .filter(Boolean);
  const titleKeywords = buildTopicSearchKeywords(title)
    .map(normalizeToken)
    .filter(Boolean);

  if (queryKeywords.length < 3 || titleKeywords.length === 0) {
    return false;
  }

  const titleKeywordSet = new Set(titleKeywords);
  const overlapCount = queryKeywords.filter((token) => titleKeywordSet.has(token)).length;
  const overlapRatio = overlapCount / Math.max(1, queryKeywords.length);
  const normalizedQuery = normalizeTopicQuery(query).replace(/[^a-z0-9\s]+/g, "");
  const normalizedTitle = normalizeTopicQuery(title).replace(/[^a-z0-9\s]+/g, "");

  return (
    overlapRatio >= 0.7 ||
    overlapCount >= Math.max(3, Math.min(queryKeywords.length, titleKeywords.length) - 1) ||
    normalizedTitle === normalizedQuery ||
    normalizedTitle.startsWith(normalizedQuery) ||
    normalizedQuery.startsWith(normalizedTitle) ||
    normalizedTitle.includes(normalizedQuery) ||
    normalizedQuery.includes(normalizedTitle)
  );
}

function buildParallelMediaSearchQueries(query: string) {
  const normalized = query.trim().replace(/\s+/g, " ");
  const keywordAnchor = buildTopicSearchKeywords(query).slice(0, 4).join(" ");

  return [...new Set(
    [
      normalized,
      `${normalized} youtube`,
      `${normalized} interview`,
      `${normalized} full interview`,
      `${normalized} podcast`,
      `${normalized} feature`,
      `${normalized} documentary`,
      `${normalized} appearance`,
      `${normalized} livestream`,
      `${normalized} clip`,
      keywordAnchor ? `${keywordAnchor} interview` : "",
      keywordAnchor ? `${keywordAnchor} podcast` : "",
      keywordAnchor ? `${keywordAnchor} youtube` : "",
    ]
      .map((item) => item.trim())
      .filter(Boolean)
  )];
}

function isYouTubeUrl(url: string) {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return (
      hostname === "youtu.be" ||
      hostname.endsWith("youtube.com") ||
      hostname.endsWith("youtube-nocookie.com")
    );
  } catch {
    return false;
  }
}

function getNormalizedHostname(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return "";
  }
}

async function getMediaSourceDecisionMap(
  query: string,
  candidates: Array<{
    provider: string;
    title: string;
    channelOrContributor: string | null;
    sourceUrl: string;
  }>
) {
  const decisionMap = new Map<string, MediaSourceAiDecision>();
  const uncached: typeof candidates = [];

  for (const candidate of candidates) {
    const cacheKey = buildMediaSourceDecisionCacheKey(candidate);
    const cached = mediaSourceDecisionCache.get(cacheKey);
    if (cached) {
      decisionMap.set(candidate.sourceUrl, cached);
      continue;
    }
    uncached.push(candidate);
  }

  if (uncached.length === 0) {
    return decisionMap;
  }

  try {
    const decisions = await classifyMediaSourceCandidates({
      query,
      candidates: uncached,
    });

    for (let index = 0; index < uncached.length; index++) {
      const candidate = uncached[index];
      const decision = decisions[index] ?? {
        shouldInclude: true,
        isLikelySourceClip: false,
        confidence: 0,
        reason: "No AI decision returned.",
      };
      const normalizedDecision: MediaSourceAiDecision = {
        shouldInclude: decision.shouldInclude,
        isLikelySourceClip: decision.isLikelySourceClip,
        confidence: decision.confidence,
        reason: decision.reason,
      };
      mediaSourceDecisionCache.set(
        buildMediaSourceDecisionCacheKey(candidate),
        normalizedDecision
      );
      decisionMap.set(candidate.sourceUrl, normalizedDecision);
    }
  } catch (error) {
    console.error("[topic-search] AI media-source classification failed:", error);
  }

  return decisionMap;
}

function inferParallelMediaProvider(url: string): ClipProvider {
  const hostname = getNormalizedHostname(url);

  if (
    hostname === "youtu.be" ||
    hostname.endsWith("youtube.com") ||
    hostname.endsWith("youtube-nocookie.com")
  ) {
    return "youtube";
  }

  if (hostname === "x.com" || hostname.endsWith(".x.com") || hostname.endsWith("twitter.com")) {
    return "twitter";
  }

  if (hostname.includes("archive.org")) {
    return "internet_archive";
  }

  return "internal";
}

function isLikelyMediaPageUrl(url: string) {
  const hostname = getNormalizedHostname(url);
  if (!hostname) {
    return false;
  }

  return (
    hostname === "youtu.be" ||
    hostname.endsWith("youtube.com") ||
    hostname.endsWith("youtube-nocookie.com") ||
    hostname === "x.com" ||
    hostname.endsWith(".x.com") ||
    hostname.endsWith("twitter.com") ||
    hostname.includes("archive.org") ||
    hostname.includes("vimeo.com") ||
    hostname.includes("soundcloud.com") ||
    hostname.includes("spotify.com") ||
    hostname.includes("podcasts.apple.com") ||
    hostname.includes("omny.fm") ||
    hostname.includes("megaphone.fm") ||
    hostname.includes("simplecast.com") ||
    hostname.includes("buzzsprout.com") ||
    hostname.includes("podbean.com") ||
    hostname.includes("tiktok.com") ||
    hostname.includes("instagram.com") ||
    hostname.includes("facebook.com") ||
    hostname.includes("threads.net") ||
    hostname.includes("linkedin.com")
  );
}

function extractYouTubeVideoId(url: string): string | null {
  const match = url.match(
    /(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/(?:watch\?(?:[^#\s]*&)?v=|embed\/|shorts\/|live\/))([A-Za-z0-9_-]{11})/i
  );
  return match?.[1] ?? null;
}

function deduplicateRawResults(results: RawResult[]) {
  const deduped: RawResult[] = [];
  const seen = new Set<string>();

  for (const result of results) {
    const key = `${result.provider}:${result.externalId || result.sourceUrl}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(result);
  }

  return deduped;
}

async function loadCachedTopicSearch(query: string): Promise<TopicSearchResult | null> {
  const db = getDb();
  const normalizedQuery = normalizeTopicQuery(query);

  const [cachedSearch] = await db
    .select({
      id: clipSearches.id,
      query: clipSearches.query,
      resultsCount: clipSearches.resultsCount,
      quotesCount: clipSearches.quotesCount,
      createdAt: clipSearches.createdAt,
    })
    .from(clipSearches)
    .where(
      sql`lower(trim(regexp_replace(${clipSearches.query}, '\\s+', ' ', 'g'))) = ${normalizedQuery}`
    )
    .orderBy(desc(clipSearches.createdAt))
    .limit(1);

  if (!cachedSearch) {
    return null;
  }

  const cacheAgeMs = Date.now() - cachedSearch.createdAt.getTime();
  const maxAgeMs =
    cachedSearch.resultsCount > 0 || cachedSearch.quotesCount > 0
      ? TOPIC_RESULT_CACHE_TTL_MS
      : EMPTY_TOPIC_RESULT_CACHE_TTL_MS;

  if (cacheAgeMs > maxAgeMs) {
    return null;
  }

  const clipRows = await db
    .select({
      clipId: clipLibrary.id,
      provider: clipLibrary.provider,
      title: clipLibrary.title,
      sourceUrl: clipLibrary.sourceUrl,
      previewUrl: clipLibrary.previewUrl,
      channelOrContributor: clipLibrary.channelOrContributor,
      viewCount: clipLibrary.viewCount,
      durationMs: clipLibrary.durationMs,
      uploadDate: clipLibrary.uploadDate,
      externalId: clipLibrary.externalId,
      metadataJson: clipLibrary.metadataJson,
      relevanceScore: clipSearchResults.relevanceScore,
    })
    .from(clipSearchResults)
    .innerJoin(clipLibrary, eq(clipSearchResults.clipId, clipLibrary.id))
    .where(eq(clipSearchResults.searchId, cachedSearch.id))
    .orderBy(desc(clipSearchResults.relevanceScore), desc(clipLibrary.viewCount));

  const quoteRows = await db
    .select({
      provider: clipLibrary.provider,
      quoteText: clipSearchQuotes.quoteText,
      speaker: clipSearchQuotes.speaker,
      startMs: clipSearchQuotes.startMs,
      relevanceScore: clipSearchQuotes.relevanceScore,
      context: clipSearchQuotes.context,
      videoTitle: clipLibrary.title,
      videoId: clipLibrary.externalId,
      sourceUrl: clipLibrary.sourceUrl,
      channelOrContributor: clipLibrary.channelOrContributor,
      metadataJson: clipLibrary.metadataJson,
    })
    .from(clipSearchQuotes)
    .innerJoin(clipLibrary, eq(clipSearchQuotes.clipId, clipLibrary.id))
    .where(eq(clipSearchQuotes.searchId, cachedSearch.id))
    .orderBy(desc(clipSearchQuotes.relevanceScore), clipSearchQuotes.startMs);

  const filteredClipRows = await filterOutMoonVideoCandidates(clipRows, (row) => ({
    provider: row.provider,
    externalId: row.externalId,
    sourceUrl: row.sourceUrl,
    channelOrContributor: row.channelOrContributor,
    metadataJson: row.metadataJson,
  }));
  const allowedVideoIds = new Set(filteredClipRows.map((row) => row.externalId));
  const filteredQuoteRows = await filterOutMoonVideoCandidates(
    quoteRows.filter((row) => allowedVideoIds.has(row.videoId)),
    (row) => ({
      provider: row.provider,
      externalId: row.videoId,
      sourceUrl: row.sourceUrl,
      channelOrContributor: row.channelOrContributor,
      metadataJson: row.metadataJson,
    })
  );

  return {
    searchId: cachedSearch.id,
    query,
    clips: filteredClipRows.map((row) => ({
      clipId: row.clipId,
      provider: row.provider,
      mediaType: "video",
      title: row.title,
      sourceUrl: row.sourceUrl,
      previewUrl: row.previewUrl,
      channelOrContributor: row.channelOrContributor,
      viewCount: row.viewCount ?? 0,
      durationMs: row.durationMs,
      uploadDate: row.uploadDate,
      relevanceScore: row.relevanceScore,
      externalId: row.externalId,
    })),
    quotes: filteredQuoteRows.map((row) => ({
      quoteText: row.quoteText,
      speaker: row.speaker,
      startMs: row.startMs,
      relevanceScore: row.relevanceScore,
      context: row.context ?? "",
      videoTitle: row.videoTitle,
      videoId: row.videoId,
      sourceUrl: row.sourceUrl,
    })),
    totalFound: filteredClipRows.length,
    totalFiltered: 0,
  };
}

async function discoverYouTubeUrlsViaYtDlpSearch(query: string): Promise<RawResult[]> {
  const ytDlpBin = getEnv().MOON_YTDLP_BIN;
  const { stdout } = await execFileAsync(
    ytDlpBin,
    ["--flat-playlist", "--dump-single-json", `ytsearch5:${query}`],
    {
      maxBuffer: 10 * 1024 * 1024,
      env: {
        ...process.env,
        MOON_YTDLP_PROXY: "",
        ALL_PROXY: "",
        HTTPS_PROXY: "",
        HTTP_PROXY: "",
      },
    }
  );

  const parsed = JSON.parse(stdout) as {
    entries?: Array<{
      id?: string;
      url?: string;
      title?: string;
      description?: string;
      duration?: number;
      channel?: string;
      uploader?: string;
      channel_url?: string;
      uploader_url?: string;
      view_count?: number;
      timestamp?: number | null;
      thumbnails?: Array<{ url?: string }>;
    }>;
  };

  const discovered: RawResult[] = [];
  for (const entry of parsed.entries ?? []) {
    const sourceUrl =
      entry.url && isYouTubeUrl(entry.url)
        ? entry.url
        : entry.id
          ? `https://www.youtube.com/watch?v=${entry.id}`
          : null;
    const videoId = sourceUrl ? extractYouTubeVideoId(sourceUrl) : null;
    if (!sourceUrl || !videoId) {
      continue;
    }

    discovered.push({
      provider: "youtube",
      mediaType: "video",
      title: entry.title ?? sourceUrl,
      description: entry.description ?? "",
      sourceUrl,
      previewUrl: entry.thumbnails?.[0]?.url ?? null,
      channelOrContributor:
        entry.channel ?? entry.uploader ?? entry.channel_url ?? entry.uploader_url ?? null,
      viewCount: entry.view_count ?? 0,
      durationMs: entry.duration ? Math.round(entry.duration * 1000) : null,
      uploadDate: entry.timestamp
        ? new Date(entry.timestamp * 1000).toISOString()
        : null,
      externalId: videoId,
      metadataJson: {
        discoveredVia: "yt_dlp_search",
      },
    });
  }

  return discovered;
}

async function discoverYouTubeUrlsViaWebSearch(query: string): Promise<RawResult[]> {
  const apiKey = getEnv().SERPER_API_KEY;

  if (!apiKey) {
    return [];
  }

  const response = await fetch("https://google.serper.dev/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-KEY": apiKey,
    },
    body: JSON.stringify({
      q: `site:youtube.com/watch OR site:youtu.be ${query}`,
      num: 10,
    }),
  });

  if (!response.ok) {
    throw new Error(`Serper returned ${response.status} while finding YouTube URLs`);
  }

  const data = (await response.json()) as {
    organic?: Array<{
      title?: string;
      link?: string;
      snippet?: string;
      date?: string;
    }>;
  };

  const discovered: RawResult[] = [];

  for (const item of data.organic ?? []) {
    const sourceUrl = item.link?.trim() ?? "";
    const videoId = extractYouTubeVideoId(sourceUrl);

    if (!sourceUrl || !videoId) {
      continue;
    }

    discovered.push({
      provider: "youtube",
      mediaType: "video",
      title: item.title?.trim() || sourceUrl,
      description: item.snippet?.trim() ?? "",
      sourceUrl,
      previewUrl: null,
      channelOrContributor: null,
      viewCount: 0,
      durationMs: null,
      uploadDate: item.date?.trim() ?? null,
      externalId: videoId,
      metadataJson: {
        discoveredVia: "serper_web_search",
      },
    });
  }

  return discovered;
}

async function discoverMediaUrlsViaParallelSearch(query: string): Promise<RawResult[]> {
  const searchQueries = buildParallelMediaSearchQueries(query);
  const results = await searchResearchSources({
    query,
    searchQueries,
    limit: 36,
    mode: "fast",
    objective: [
      `Find relevant media pages for: ${query}.`,
      "Prioritize YouTube videos, podcast episode pages, interviews, features, direct appearances, press conferences, social video posts, and archival media pages.",
      "Search broadly enough to capture the major available YouTube/video surface for the topic, not just one or two obvious clips.",
      "Return direct media-page URLs when possible, not generic article coverage.",
    ].join(" "),
    maxCharsPerResult: 700,
    maxCharsTotal: 3500,
  });

  const discovered: RawResult[] = [];

  for (const item of results) {
    const sourceUrl = item.url.trim();
    if (!sourceUrl || !isLikelyMediaPageUrl(sourceUrl)) {
      continue;
    }

    const provider = inferParallelMediaProvider(sourceUrl);
    const externalId =
      provider === "youtube"
        ? extractYouTubeVideoId(sourceUrl) ?? sourceUrl
        : sourceUrl;

    discovered.push({
      provider,
      mediaType: "video",
      title: item.title || sourceUrl,
      description: item.snippet,
      sourceUrl,
      previewUrl: null,
      channelOrContributor: null,
      viewCount: 0,
      durationMs: null,
      uploadDate: item.publishedAt,
      externalId,
      metadataJson: {
        discoveredVia: "parallel_search",
        publishedAt: item.publishedAt,
      },
    });
  }

  return discovered;
}

export async function searchTopic(
  query: string,
  options: TopicSearchOptions = {}
): Promise<TopicSearchResult> {
  const db = getDb();
  const cachedSearch = await loadCachedTopicSearch(query);
  const shouldIncludeAiQuotes = options.includeAiQuotes === true;
  const allowCommentary = options.allowCommentary === true;
  const cachedAiDecisionMap = allowCommentary
    ? new Map<string, MediaSourceAiDecision>()
    : await getMediaSourceDecisionMap(
        query,
        (cachedSearch?.clips ?? []).map((clip) => ({
          provider: clip.provider,
          title: clip.title,
          channelOrContributor: clip.channelOrContributor,
          sourceUrl: clip.sourceUrl,
        }))
      );
  if (
    cachedSearch &&
    (!shouldIncludeAiQuotes ||
      cachedSearch.quotes.length > 0 ||
      cachedSearch.clips.some((clip) => clip.provider === "internal"))
  ) {
    const filteredClips = allowCommentary
      ? cachedSearch.clips
      : cachedSearch.clips.filter((clip) => {
          const sourceAssessment = assessMediaSourceCandidate({
            provider: clip.provider,
            title: clip.title,
            sourceUrl: clip.sourceUrl,
            channelOrContributor: clip.channelOrContributor,
          });
          if (
            shouldExcludeCommentaryCandidate({
              provider: clip.provider,
              title: clip.title,
              sourceUrl: clip.sourceUrl,
              channelOrContributor: clip.channelOrContributor,
            })
          ) {
            return false;
          }
          if (
            clip.provider === "youtube" &&
            !sourceAssessment.isLikelyPrimary &&
            isLikelyTitleParrotClip(query, clip.title)
          ) {
            return false;
          }
          const aiDecision = cachedAiDecisionMap.get(clip.sourceUrl);
          if (aiDecision && !aiDecision.shouldInclude) {
            return false;
          }
          return true;
        });
    const allowedExternalIds = new Set(filteredClips.map((clip) => clip.externalId));
    return {
      ...cachedSearch,
      clips: filteredClips,
      quotes: cachedSearch.quotes.filter((quote) => allowedExternalIds.has(quote.videoId)),
      totalFiltered:
        cachedSearch.totalFiltered + Math.max(0, cachedSearch.clips.length - filteredClips.length),
    };
  }

  const keywords = buildTopicSearchKeywords(query);
  const localYouTubeResults = await discoverYouTubeUrlsViaYtDlpSearch(query).catch((error) => {
    console.error("[topic-search] Local yt-dlp YouTube search failed:", error);
    return [] as RawResult[];
  });
  const webYouTubeResults =
    localYouTubeResults.length >= 3
      ? []
      : await discoverYouTubeUrlsViaWebSearch(query).catch((error) => {
          console.error("[topic-search] Web search YouTube discovery failed:", error);
          return [] as RawResult[];
        });
  const parallelMediaResults = await discoverMediaUrlsViaParallelSearch(query).catch((error) => {
    console.error("[topic-search] Parallel media search failed:", error);
    return [] as RawResult[];
  });
  const shouldSpendYouTubeQuota =
    localYouTubeResults.length +
      webYouTubeResults.length +
      parallelMediaResults.filter((result) => result.provider === "youtube").length ===
    0;

  // Search all providers in parallel
  const [ytResult, iaResult, xResult] = await Promise.allSettled([
    shouldSpendYouTubeQuota
      ? searchYouTube({ keywords, temporalContext: null, maxResults: 15 })
      : Promise.resolve({ results: [], quotaUsed: 0, quotaRemaining: 0 }),
    searchInternetArchive({ keywords, temporalContext: null, maxResults: 10 }),
    searchTwitterVideos({ keywords, temporalContext: null, maxResults: 10 }),
  ]);

  // Collect raw results
  const rawResults: RawResult[] = [
    ...localYouTubeResults,
    ...webYouTubeResults,
    ...parallelMediaResults,
  ];

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
  } else {
    console.error("[topic-search] YouTube search failed:", ytResult.reason);
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
  } else {
    console.error("[topic-search] Internet Archive search failed:", iaResult.reason);
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
  } else {
    console.error("[topic-search] Twitter video search failed:", xResult.reason);
  }

  const dedupedRawResults = await filterOutMoonVideoCandidates(
    deduplicateRawResults(rawResults),
    (result) => ({
      provider: result.provider,
      externalId: result.externalId,
      sourceUrl: result.sourceUrl,
      channelOrContributor: result.channelOrContributor,
      metadataJson: result.metadataJson,
    })
  );

  // Quality gate
  let totalFiltered = 0;
  const passed = dedupedRawResults.filter((r) => {
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

  const sourceFiltered = passed.filter((result) => {
    if (allowCommentary) {
      return true;
    }
    const sourceAssessment = assessMediaSourceCandidate({
      provider: result.provider,
      title: result.title,
      sourceUrl: result.sourceUrl,
      channelOrContributor: result.channelOrContributor,
    });
    const shouldExclude = shouldExcludeCommentaryCandidate({
      provider: result.provider,
      title: result.title,
      sourceUrl: result.sourceUrl,
      channelOrContributor: result.channelOrContributor,
    });
    const isTitleParrot =
      result.provider === "youtube" &&
      !sourceAssessment.isLikelyPrimary &&
      isLikelyTitleParrotClip(query, result.title);
    if (shouldExclude || isTitleParrot) {
      totalFiltered++;
      return false;
    }
    return true;
  });

  const aiDecisionMap = allowCommentary
    ? new Map<string, MediaSourceAiDecision>()
    : await getMediaSourceDecisionMap(
        query,
        sourceFiltered.map((result) => ({
          provider: result.provider,
          title: result.title,
          channelOrContributor: result.channelOrContributor,
          sourceUrl: result.sourceUrl,
        }))
      );

  const aiFiltered = sourceFiltered.filter((result) => {
    if (allowCommentary) {
      return true;
    }
    const decision = aiDecisionMap.get(result.sourceUrl);
    if (decision && !decision.shouldInclude) {
      totalFiltered++;
      return false;
    }
    return true;
  });

  // AI relevance scoring
  let relevanceScores: number[];
  try {
    relevanceScores = await scoreResultRelevance({
      lineText: query,
      results: aiFiltered.map((r) => ({
        title: r.title,
        description: r.description,
        provider: r.provider,
      })),
    });
  } catch {
    relevanceScores = aiFiltered.map((_, i) =>
      Math.max(20, 45 - Math.floor((i / Math.max(1, aiFiltered.length)) * 25))
    );
  }

  // Save all passing clips to library and build scored results
  const scored: TopicResult[] = [];

  for (let i = 0; i < aiFiltered.length; i++) {
    const r = aiFiltered[i];
    const sourceAssessment = assessMediaSourceCandidate({
      provider: r.provider,
      title: r.title,
      sourceUrl: r.sourceUrl,
      channelOrContributor: r.channelOrContributor,
    });
    const aiDecision = aiDecisionMap.get(r.sourceUrl);
    const relevance = Math.max(
      0,
      Math.min(
        100,
        (relevanceScores[i] ?? 20) +
          sourceAssessment.scoreAdjustment +
          (aiDecision?.isLikelySourceClip ? 10 : 0)
      )
    );
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
        metadataJson: {
          ...(r.metadataJson ?? {}),
          sourceAssessment: {
            isLikelyPrimary: sourceAssessment.isLikelyPrimary,
            isLikelyProcedural: sourceAssessment.isLikelyProcedural,
            isLikelyCommentary: sourceAssessment.isLikelyCommentary,
            isLikelyPersonalBrand: sourceAssessment.isLikelyPersonalBrand,
            aiShouldInclude: aiDecision?.shouldInclude ?? null,
            aiIsLikelySourceClip: aiDecision?.isLikelySourceClip ?? null,
            aiConfidence: aiDecision?.confidence ?? null,
            aiReason: aiDecision?.reason ?? null,
          },
        },
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

  const allQuotes: TopicQuote[] = [];
  if (shouldIncludeAiQuotes) {
    // Extract quotes from top 3 YouTube videos (using transcript cache)
    const topYT = scored
      .filter((r) => r.provider === "youtube")
      .slice(0, 3);

    for (const video of topYT) {
      let segments = await ensureYouTubeTranscript(video.clipId, video.externalId);
      if (!segments && options.includeLocalTranscriptFallback) {
        try {
          const localMedia = await ingestLocalMediaArtifacts({
            sourceUrl: video.sourceUrl,
            providerName: "youtube",
            title: video.title,
          });
          if (localMedia?.transcript?.length) {
            segments = await cacheTranscriptSegments(video.clipId, localMedia.transcript);
          }
        } catch (error) {
          console.error("[topic-search] Local transcript fallback failed:", error);
        }
      }
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
    totalFound: dedupedRawResults.length,
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
