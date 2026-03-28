import "server-only";

import { extractResearchSource, searchResearchSources } from "@/server/providers/parallel";
import { extractArticleFactsFromMarkdown, findRelevantQuotes } from "@/server/providers/openai";
import { getEnv } from "@/server/config/env";
import { ensureYouTubeTranscript, upsertClipInLibrary } from "@/server/services/clip-library";

type ResolverTask = {
  segmentIndex: number;
  timeLabel: string;
  lineText: string;
  scriptContext: string;
  visualPriority: string;
  people: string[];
  orgs: string[];
  properties: string[];
  videoQueries: string[];
  receiptQueries: string[];
  targetClipCount?: number;
  maxQueriesPerRound?: number;
};

type ResolverInput = {
  tasks: ResolverTask[];
  concurrency?: number;
  includeQuotes?: boolean;
  includeReactions?: boolean;
};

type SearchAttempt = {
  query: string;
  phase: "primary" | "fallback";
  status: "complete" | "failed";
  clipCount: number;
  quoteCount: number;
  error: string | null;
};

type ResolvedClip = {
  title: string;
  sourceUrl: string;
  previewUrl: string | null;
  provider: string;
  channelOrContributor: string | null;
  relevanceScore: number;
  durationMs: number | null;
  uploadDate: string | null;
  externalId: string;
  query: string;
};

type ResolvedQuote = {
  quoteText: string;
  speaker: string | null;
  startMs: number;
  relevanceScore: number;
  context: string;
  videoTitle: string;
  videoId: string;
  sourceUrl: string;
  query: string;
};

type ReceiptSource = {
  title: string;
  url: string;
  snippet: string;
  publishedAt: string | null;
  relevanceScore: number;
  query: string;
};

type ReactionPost = {
  postUrl: string;
  username: string;
  displayName: string;
  text: string;
  postedAt: string | null;
  likeCount: number;
  retweetCount: number;
  viewCount: number;
  query: string;
};

type ResolverTaskResult = {
  segmentIndex: number;
  status: "resolved" | "partial" | "images_only" | "failed";
  attempts: SearchAttempt[];
  clips: ResolvedClip[];
  quotes: ResolvedQuote[];
  receipts: ReceiptSource[];
  reactions: ReactionPost[];
};

const DEFAULT_CONCURRENCY = 2;
const DEFAULT_TARGET_CLIP_COUNT = 6;
const QUERY_LIMIT_PER_SEARCH = 10;
const MAX_MEDIA_SEARCH_VARIANTS = 10;
const QUOTE_CLIP_CANDIDATE_LIMIT = 8;
const FINAL_QUOTE_LIMIT = 8;
const SEARCH_TIMEOUT_MS = 35_000;
const RECEIPT_TIMEOUT_MS = 20_000;
const REACTION_TIMEOUT_MS = 12_000;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string) {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

function normalizeQuery(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function lineRequestsQuote(task: ResolverTask) {
  const lowered = task.lineText.toLowerCase();
  return (
    lowered.includes("quote") ||
    lowered.includes("said") ||
    lowered.includes("called") ||
    lowered.includes("admitted") ||
    lowered.includes("threatened") ||
    lowered.includes("warned") ||
    lowered.includes("told") ||
    lowered.includes("live television") ||
    lowered.includes("kept going") ||
    lowered.includes("wouldn't let it go") ||
    lowered.includes("wouldnt let it go") ||
    lowered.includes("move on") ||
    lowered.includes("steering it right back") ||
    lowered.includes("steered it right back") ||
    lowered.includes("brought up") ||
    lowered.includes("fake phone call")
  );
}

function normalizeMediaUrl(url: string) {
  const value = url.trim();
  if (!value) {
    return value;
  }
  try {
    const decoded = decodeURIComponent(value);
    return decoded.trim();
  } catch {
    return value;
  }
}

function dedupeBy<T>(items: T[], keyFn: (item: T) => string) {
  const seen = new Set<string>();
  const output: T[] = [];
  for (const item of items) {
    const key = keyFn(item);
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push(item);
  }
  return output;
}

function isLikelyMediaUrl(url: string) {
  const lowered = normalizeMediaUrl(url).toLowerCase();
  return (
    lowered.includes("youtube.com/watch") ||
    lowered.includes("youtu.be/") ||
    lowered.includes("x.com/") ||
    lowered.includes("twitter.com/")
  );
}

function inferProviderFromUrl(url: string) {
  const lowered = normalizeMediaUrl(url).toLowerCase();
  if (lowered.includes("youtube.com") || lowered.includes("youtu.be")) {
    return "youtube";
  }
  if (lowered.includes("x.com") || lowered.includes("twitter.com")) {
    return "twitter";
  }
  return "web";
}

function isLikelyReceiptUrl(url: string) {
  const lowered = normalizeMediaUrl(url).toLowerCase();
  return !(
    lowered.includes("youtube.com") ||
    lowered.includes("youtu.be/") ||
    lowered.includes("x.com/") ||
    lowered.includes("twitter.com/")
  );
}

function extractYouTubeVideoId(url: string) {
  try {
    const decoded = decodeURIComponent(url);
    const parsed = new URL(decoded);
    const hostname = parsed.hostname.replace(/^www\./i, "").toLowerCase();
    if (hostname === "youtu.be") {
      return parsed.pathname.replace(/^\/+/, "").slice(0, 11) || null;
    }
    if (hostname.endsWith("youtube.com")) {
      const v = parsed.searchParams.get("v");
      return v ? v.slice(0, 11) : null;
    }
  } catch {
    // Fall through.
  }

  const match = decodeURIComponent(url).match(/[?&]v=([A-Za-z0-9_-]{11})/);
  return match?.[1] ?? null;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
) {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function runWorker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await worker(items[currentIndex], currentIndex);
    }
  }

  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, () => runWorker()),
  );
  return results;
}

function buildFallbackQueries(task: ResolverTask) {
  const queries: string[] = [];
  const lowered = task.lineText.toLowerCase();

  for (const person of task.people.slice(0, 5)) {
    if (
      lowered.includes("interview") ||
      lowered.includes("said") ||
      lowered.includes("admitted") ||
      lowered.includes("backlash") ||
      lowered.includes("death threats")
    ) {
      queries.push(`${person} interview`);
      queries.push(`${person} reaction`);
      queries.push(`${person} full appearance`);
    } else {
      queries.push(`${person} interview`);
      queries.push(`${person} clip`);
    }
  }

  for (const org of task.orgs.slice(0, 4)) {
    if (
      lowered.includes("budget") ||
      lowered.includes("debt") ||
      lowered.includes("takeover") ||
      lowered.includes("shareholder")
    ) {
      queries.push(`${org} earnings interview`);
      queries.push(`${org} earnings call`);
      queries.push(`${org} headquarters`);
    } else {
      queries.push(`${org} b roll`);
    }
  }

  for (const property of task.properties.slice(0, 4)) {
    if (
      lowered.includes("trailer") ||
      lowered.includes("first look") ||
      lowered.includes("scene") ||
      lowered.includes("train")
    ) {
      queries.push(`${property} official trailer`);
      queries.push(`${property} official teaser`);
      queries.push(`${property} scene clip`);
    } else {
      queries.push(`${property} official clip`);
      queries.push(`${property} official trailer`);
    }
  }

  if (task.visualPriority === "interview_first" && task.videoQueries.length > 0) {
    queries.push(`${task.videoQueries[0]} interview`);
  }

  return dedupeBy(
    queries.map(normalizeQuery).filter(Boolean),
    (query) => query.toLowerCase(),
  );
}

function needsReactionPosts(task: ResolverTask) {
  const lowered = task.lineText.toLowerCase();
  return (
    lowered.includes("reaction") ||
    lowered.includes("backlash") ||
    lowered.includes("death threats") ||
    lowered.includes("dislikes") ||
    lowered.includes("tweets") ||
    lowered.includes("security")
  );
}

function parseJsonArrayBlock(text: string) {
  const arrayMatch = text.match(/\[[\s\S]*\]/);
  if (!arrayMatch) {
    return [];
  }
  try {
    const parsed = JSON.parse(arrayMatch[0]);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function searchAudiencePosts(query: string): Promise<ReactionPost[]> {
  const env = getEnv();
  if (!env.XAI_API_KEY) {
    return [];
  }

  const response = await withTimeout(
    fetch("https://api.x.ai/v1/responses", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${env.XAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: env.XAI_SEARCH_MODEL,
        tools: [{ type: "x_search" }],
        input: [
          {
            role: "system",
            content:
              "Search X/Twitter for audience reactions. Return ONLY a JSON array. Each item must include postUrl, username, displayName, text, postedAt, likeCount, retweetCount, viewCount.",
          },
          {
            role: "user",
            content: `Find strong audience reaction posts about: "${query}". Prefer backlash, debate, outrage, and notable reactions. Return at most 4 posts.`,
          },
        ],
      }),
    }),
    REACTION_TIMEOUT_MS,
    `Timed out searching reactions for ${query}`,
  );

  if (!response.ok) {
    throw new Error(`xAI returned ${response.status}`);
  }

  const data = (await response.json()) as {
    output_text?: string;
    output?: Array<{
      type?: string;
      content?: Array<{ type?: string; text?: string }>;
    }>;
  };

  let outputText = data.output_text ?? "";
  if (!outputText) {
    for (const item of data.output ?? []) {
      if (item.type !== "message" || !Array.isArray(item.content)) {
        continue;
      }
      for (const content of item.content) {
        if (content.type === "output_text" && content.text) {
          outputText = content.text;
        }
      }
    }
  }

  return parseJsonArrayBlock(outputText)
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }
      const record = item as Record<string, unknown>;
      return {
        postUrl: String(record.postUrl ?? record.post_url ?? ""),
        username: String(record.username ?? ""),
        displayName: String(record.displayName ?? record.display_name ?? record.username ?? ""),
        text: String(record.text ?? "").slice(0, 500),
        postedAt: String(record.postedAt ?? record.posted_at ?? "") || null,
        likeCount: Number(record.likeCount ?? record.like_count ?? 0),
        retweetCount: Number(record.retweetCount ?? record.retweet_count ?? 0),
        viewCount: Number(record.viewCount ?? record.view_count ?? 0),
        query,
      };
    })
    .filter((item): item is ReactionPost => Boolean(item?.postUrl))
    .slice(0, 4);
}

async function searchMediaPagesViaParallel(
  task: ResolverTask,
  query: string,
): Promise<ResolvedClip[]> {
  const loweredLine = task.lineText.toLowerCase();
  const searchQueries = dedupeBy(
    [
      query,
      `${query} youtube`,
      `${query} clip`,
      `${query} full video`,
      lineRequestsQuote(task) ? `${query} full clip` : "",
      lineRequestsQuote(task) || task.visualPriority === "interview_first" ? `${query} interview` : "",
      lineRequestsQuote(task) ? `${query} full appearance` : "",
      lineRequestsQuote(task) ? `${query} talk show` : "",
      loweredLine.includes("trailer") || loweredLine.includes("first look") || loweredLine.includes("teaser")
        ? `${query} official trailer`
        : "",
      loweredLine.includes("trailer") || loweredLine.includes("first look") || loweredLine.includes("teaser")
        ? `${query} official teaser`
        : "",
      loweredLine.includes("first look") ? `${query} first look` : "",
      loweredLine.includes("costume") || loweredLine.includes("comparison") ? `${query} comparison` : "",
      loweredLine.includes("costume") || loweredLine.includes("scene") ? `${query} scene` : "",
      loweredLine.includes("debt") || loweredLine.includes("budget") || loweredLine.includes("billion") || loweredLine.includes("million")
        ? `${query} earnings`
        : "",
      loweredLine.includes("debt") || loweredLine.includes("takeover") ? `${query} press conference` : "",
      loweredLine.includes("archive") || loweredLine.includes("years before") ? `${query} archive` : "",
    ]
      .map(normalizeQuery)
      .filter(Boolean),
    (item) => item.toLowerCase(),
  ).slice(0, MAX_MEDIA_SEARCH_VARIANTS);
  const results = await withTimeout(
    searchResearchSources({
      query,
      searchQueries,
      limit: 10,
      mode: "fast",
      objective: [
        `Find direct media pages for: ${query}.`,
        "Prioritize YouTube videos, interview pages, official trailers, first-look footage, archival media pages, and direct video sources over articles.",
      ].join(" "),
    }),
    RECEIPT_TIMEOUT_MS,
    `Timed out searching media pages for ${query}`,
  );

  return dedupeBy(
    results
      .filter((item) => isLikelyMediaUrl(item.url))
      .map((item) => ({
        title: item.title,
        sourceUrl: normalizeMediaUrl(item.url),
        previewUrl: null,
        provider: inferProviderFromUrl(item.url),
        channelOrContributor: null,
        relevanceScore: buildResultScore(task, item.title, null, item.relevanceScore),
        durationMs: null,
        uploadDate: item.publishedAt,
        externalId: normalizeMediaUrl(item.url),
        query,
      })),
    (item) => item.sourceUrl,
  ).slice(0, QUERY_LIMIT_PER_SEARCH);
}

async function findQuotesForFallbackClips(
  task: ResolverTask,
  query: string,
  clips: ResolvedClip[],
): Promise<ResolvedQuote[]> {
  const youtubeClips = clips
    .filter((clip) => clip.provider === "youtube")
    .sort((left, right) => scoreQuoteCandidate(task, right) - scoreQuoteCandidate(task, left))
    .slice(0, QUOTE_CLIP_CANDIDATE_LIMIT)
    .filter((clip, index) => index === 0 || scoreQuoteCandidate(task, clip) >= 18);
  const collected: ResolvedQuote[] = [];

  for (const clip of youtubeClips) {
    const videoId = extractYouTubeVideoId(clip.sourceUrl);
    if (!videoId) {
      continue;
    }
    try {
      const clipId = await upsertClipInLibrary({
        provider: "youtube",
        externalId: videoId,
        title: clip.title,
        sourceUrl: clip.sourceUrl,
        previewUrl: clip.previewUrl,
        channelOrContributor: clip.channelOrContributor,
        durationMs: clip.durationMs,
        uploadDate: clip.uploadDate,
      });
      const transcript = await ensureYouTubeTranscript(clipId, videoId);
      if (!transcript?.length) {
        continue;
      }
      const quotes = await findRelevantQuotes({
        lineText: task.lineText,
        scriptContext: task.scriptContext,
        transcript,
        videoTitle: clip.title,
        maxQuotes: 5,
      });
      for (const quote of quotes) {
        collected.push({
          quoteText: quote.quoteText,
          speaker: quote.speaker,
          startMs: quote.startMs,
          relevanceScore: quote.relevanceScore,
          context: quote.context,
          videoTitle: clip.title,
          videoId,
          sourceUrl: clip.sourceUrl,
          query,
        });
      }
    } catch {
      // Best-effort transcript recovery.
    }
  }

  return dedupeBy(
    collected,
    (quote) => `${quote.videoId}::${quote.startMs}::${quote.quoteText.toLowerCase()}`,
  )
    .sort((left, right) => right.relevanceScore - left.relevanceScore)
    .slice(0, FINAL_QUOTE_LIMIT);
}

function buildResultScore(task: ResolverTask, title: string, channel: string | null, baseScore: number) {
  let score = baseScore;
  const loweredTitle = title.toLowerCase();
  const loweredChannel = (channel ?? "").toLowerCase();
  const loweredLine = task.lineText.toLowerCase();
  const combined = `${loweredTitle} ${loweredChannel}`;

  for (const person of task.people) {
    const lowered = person.toLowerCase();
    if (loweredTitle.includes(lowered) || loweredChannel.includes(lowered)) {
      score += 8;
    }
  }

  for (const org of task.orgs) {
    const lowered = org.toLowerCase();
    if (loweredTitle.includes(lowered) || loweredChannel.includes(lowered)) {
      score += 6;
    }
  }

  for (const property of task.properties) {
    const lowered = property.toLowerCase();
    if (loweredTitle.includes(lowered) || loweredChannel.includes(lowered)) {
      score += 6;
    }
  }

  if (
    task.visualPriority === "interview_first" &&
    (loweredTitle.includes("interview") ||
      loweredTitle.includes("criticizes") ||
      loweredTitle.includes("reacts") ||
      loweredTitle.includes("talks") ||
      loweredTitle.includes("full appearance") ||
      loweredTitle.includes("full clip") ||
      loweredTitle.includes("talk show"))
  ) {
    score += 8;
  }

  if (loweredLine.includes("what's the point") || loweredLine.includes("said") || loweredLine.includes("admitted")) {
    if (
      combined.includes("interview") ||
      combined.includes("criticizes") ||
      combined.includes("reacts") ||
      combined.includes("podcast") ||
      combined.includes("full clip") ||
      combined.includes("full appearance") ||
      combined.includes("talk show")
    ) {
      score += 14;
    }
    if (combined.includes("trailer") || combined.includes("teaser")) {
      score -= 8;
    }
  }

  if (loweredLine.includes("trailer") || loweredLine.includes("first look")) {
    if (combined.includes("trailer") || combined.includes("teaser") || combined.includes("first look") || combined.includes("official")) {
      score += 16;
    }
  }

  if (loweredLine.includes("costume")) {
    if (
      (combined.includes("nick frost") && combined.includes("hagrid")) ||
      (combined.includes("robbie coltrane") && combined.includes("hagrid"))
    ) {
      score += 16;
    }
  }

  if (
    loweredLine.includes("debt") ||
    loweredLine.includes("takeover") ||
    loweredLine.includes("budget") ||
    loweredLine.includes("million") ||
    loweredLine.includes("billion")
  ) {
    if (
      combined.includes("warner") ||
      combined.includes("paramount") ||
      combined.includes("wbd") ||
      combined.includes("earnings") ||
      combined.includes("debt")
    ) {
      score += 18;
    }
    if (combined.includes("harry potter") && (combined.includes("trailer") || combined.includes("teaser"))) {
      score -= 8;
    }
  }

  return score;
}

function scoreQuoteCandidate(task: ResolverTask, clip: ResolvedClip) {
  let score = clip.relevanceScore;
  const loweredTitle = clip.title.toLowerCase();
  const loweredLine = task.lineText.toLowerCase();
  const query = clip.query.toLowerCase();
  const combined = `${loweredTitle} ${query}`;

  if (
    loweredLine.includes("said") ||
    loweredLine.includes("admitted") ||
    loweredLine.includes("what's the point") ||
    loweredLine.includes("interview")
  ) {
    if (
      combined.includes("interview") ||
      combined.includes("criticizes") ||
      combined.includes("reacts") ||
      combined.includes("talks") ||
      combined.includes("podcast") ||
      combined.includes("full clip") ||
      combined.includes("full appearance") ||
      combined.includes("talk show")
    ) {
      score += 18;
    }
  }

  if (combined.includes("trailer") || combined.includes("teaser") || combined.includes("first look")) {
    score -= 12;
  }

  return score;
}

async function resolveQuery(
  task: ResolverTask,
  query: string,
  includeQuotes: boolean,
  phase: "primary" | "fallback",
): Promise<{
  attempt: SearchAttempt;
  clips: ResolvedClip[];
  quotes: ResolvedQuote[];
  reactions: ReactionPost[];
}> {
  try {
    const clips = await withTimeout(
      searchMediaPagesViaParallel(task, query),
      SEARCH_TIMEOUT_MS,
      `Timed out searching media pages for ${query}`,
    );
    const quotes = includeQuotes
      ? await findQuotesForFallbackClips(task, query, clips)
      : [];
    const reactions =
      needsReactionPosts(task) && phase === "primary"
        ? await searchAudiencePosts(query).catch(() => [])
        : [];
    return {
      attempt: {
        query,
        phase,
        status: "complete",
        clipCount: clips.length,
        quoteCount: quotes.length,
        error: null,
      },
      clips,
      quotes,
      reactions,
    };
  } catch (error) {
    return {
      attempt: {
        query,
        phase,
        status: "failed",
        clipCount: 0,
        quoteCount: 0,
        error: error instanceof Error ? error.message : "Unknown search error",
      },
      clips: [],
      quotes: [],
      reactions: [],
    };
  }
}

async function resolveReceipts(task: ResolverTask): Promise<ReceiptSource[]> {
  const queries = dedupeBy(
    task.receiptQueries.map(normalizeQuery).filter(Boolean),
    (query) => query.toLowerCase(),
  );

  if (!queries.length) {
    return [];
  }

  const settled = await Promise.allSettled(
    queries.map(async (query) => {
      const results = await withTimeout(
        searchResearchSources({
          query,
          searchQueries: [query],
          limit: 4,
          mode: "fast",
        }),
        RECEIPT_TIMEOUT_MS,
        `Timed out searching receipts for ${query}`,
      );
      return results
        .filter((item) => isLikelyReceiptUrl(item.url))
        .slice(0, 3)
        .map((item) => ({
          title: item.title,
          url: normalizeMediaUrl(item.url),
          snippet: item.snippet,
          publishedAt: item.publishedAt,
          relevanceScore: item.relevanceScore,
          query,
        }));
    }),
  );

  const receipts = settled.flatMap((result) => (result.status === "fulfilled" ? result.value : []));
  const deduped = dedupeBy(receipts, (item) => item.url).slice(0, 8);
  const enriched = await Promise.all(
    deduped.slice(0, 2).map(async (item) => {
      try {
        const extracted = await withTimeout(
          extractResearchSource(item.url),
          RECEIPT_TIMEOUT_MS,
          `Timed out extracting ${item.url}`,
        );
        const facts = await extractArticleFactsFromMarkdown({
          sourceUrl: item.url,
          title: extracted.title,
          siteName: extracted.sourceName,
          markdown: extracted.markdown,
        });
        const summary = facts.facts.keyFacts.slice(0, 2).join(" ");
        return {
          ...item,
          snippet: summary || item.snippet,
        };
      } catch {
        return item;
      }
    }),
  );
  const enrichmentMap = new Map(enriched.map((item) => [item.url, item]));
  return deduped
    .map((item) => enrichmentMap.get(item.url) ?? item)
    .slice(0, 4);
}

async function resolveTask(
  task: ResolverTask,
  includeQuotes: boolean,
  includeReactions: boolean,
): Promise<ResolverTaskResult> {
  const attempts: SearchAttempt[] = [];
  const primaryQueries = dedupeBy(
    task.videoQueries.map(normalizeQuery).filter(Boolean),
    (query) => query.toLowerCase(),
  );
  const fallbackQueries = buildFallbackQueries(task)
    .filter((query) => !primaryQueries.some((item) => item.toLowerCase() === query.toLowerCase()));

  let clips: ResolvedClip[] = [];
  let quotes: ResolvedQuote[] = [];
  let reactions: ReactionPost[] = [];

  for (const [phase, queries] of [
    ["primary", primaryQueries] as const,
    ["fallback", fallbackQueries] as const,
  ]) {
    if (!queries.length) {
      continue;
    }

    const settled = await Promise.all(
      queries.map((query) => resolveQuery(task, query, includeQuotes, phase)),
    );
    attempts.push(...settled.map((entry) => entry.attempt));
    clips.push(...settled.flatMap((entry) => entry.clips));
    quotes.push(...settled.flatMap((entry) => entry.quotes));
    if (includeReactions) {
      reactions.push(...settled.flatMap((entry) => entry.reactions));
    }

    const dedupedClips = dedupeBy(clips, (clip) => clip.sourceUrl).sort(
      (left, right) => right.relevanceScore - left.relevanceScore,
    );
    const dedupedQuotes = dedupeBy(
      quotes,
      (quote) => `${quote.videoId}::${quote.startMs}::${quote.quoteText.toLowerCase()}`,
    ).sort((left, right) => right.relevanceScore - left.relevanceScore);

    clips = dedupedClips;
    quotes = dedupedQuotes;

    if (
      dedupedClips.length >= (task.targetClipCount ?? DEFAULT_TARGET_CLIP_COUNT) &&
      (dedupedQuotes.length > 0 || !includeQuotes)
    ) {
      break;
    }
  }

  const receipts = await resolveReceipts(task);
  reactions = dedupeBy(reactions, (item) => item.postUrl).slice(0, 4);
  const finalClipLimit = Math.max(task.targetClipCount ?? DEFAULT_TARGET_CLIP_COUNT, 8);
  clips = dedupeBy(clips, (clip) => clip.sourceUrl)
    .sort((left, right) => right.relevanceScore - left.relevanceScore)
    .slice(0, finalClipLimit);
  quotes = dedupeBy(
    quotes,
    (quote) => `${quote.videoId}::${quote.startMs}::${quote.quoteText.toLowerCase()}`,
  )
    .sort((left, right) => right.relevanceScore - left.relevanceScore)
    .slice(0, FINAL_QUOTE_LIMIT);

  const status: ResolverTaskResult["status"] = !task.videoQueries.length
    ? "images_only"
    : clips.length > 0 || quotes.length > 0 || receipts.length > 0 || reactions.length > 0
      ? clips.length >= (task.targetClipCount ?? DEFAULT_TARGET_CLIP_COUNT) || quotes.length > 0
        ? "resolved"
        : "partial"
      : "failed";

  return {
    segmentIndex: task.segmentIndex,
    status,
    attempts,
    clips,
    quotes,
    receipts,
    reactions,
  };
}

async function readStdin() {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function main() {
  const rawInput = await readStdin();
  const parsed = JSON.parse(rawInput) as ResolverInput;
  const tasks = parsed.tasks ?? [];
  const includeQuotes = parsed.includeQuotes !== false;
  const includeReactions = parsed.includeReactions !== false;

  const results = await mapWithConcurrency(
    tasks,
    parsed.concurrency ?? DEFAULT_CONCURRENCY,
    async (task) => resolveTask(task, includeQuotes, includeReactions),
  );

  process.stdout.write(
    `${JSON.stringify(
      {
        provider: "moon-news-search-stack",
        modelName: "searchTopic+parallel+quotes",
        taskCount: tasks.length,
        results,
      },
      null,
      2,
    )}\n`,
  );
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : "Unknown resolver failure";
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
