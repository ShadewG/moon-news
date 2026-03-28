import { config as loadEnv } from "dotenv";
import Module from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import OpenAI from "openai";

loadEnv({ path: path.resolve(process.cwd(), ".env") });
loadEnv({ path: path.resolve(process.cwd(), ".env.local"), override: true });

type ModuleLoader = typeof Module & {
  _load: (request: string, parent: NodeModule | null, isMain: boolean) => unknown;
};

const moduleLoader = Module as ModuleLoader;
const originalLoad = moduleLoader._load;
moduleLoader._load = function patchedLoad(
  request: string,
  parent: NodeModule | null,
  isMain: boolean
) {
  if (request === "server-only") {
    return {};
  }

  return originalLoad.call(this, request, parent, isMain);
};

const DEFAULT_PROFILE = "online_culture";
const BASELINE_PROFILE = "default";
const MODEL = process.env.OPENAI_RESEARCH_MODEL ?? "gpt-4.1-mini";
const client = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

type CreatorChannel = {
  name: string;
  channelId: string;
  channelUrl: string;
};

type CreatorVideo = {
  channel: string;
  videoId: string;
  url: string;
  title: string;
  description: string;
  publishedAt: string | null;
  concreteEnough: boolean;
};

type TriggerCandidate = {
  title: string;
  url: string;
  source: string;
  snippet: string;
  publishedAt: string | null;
};

type CreatorTriggerHeadline = {
  channel: string;
  videoId: string;
  url: string;
  title: string;
  description: string;
  publishedAt: string | null;
  concreteEnough: boolean;
  searchQuery: string;
  secondaryQuery: string | null;
  referenceHeadline: string;
  triggerSummary: string;
  scoredHeadline: string;
  matchedHeadline: string | null;
  matchedSource: string | null;
  matchedSnippet: string | null;
  matchedPublishedAt: string | null;
  matchedUrl: string | null;
  selectionConfidence: number;
};

type NegativeStory = {
  kind: "marked_irrelevant" | "recent_board";
  id: string;
  canonicalTitle: string;
  vertical: string | null;
  storyType: string;
  lastSeenAt: string | null;
  itemsCount: number;
  sourcesCount: number;
  controversyScore: number | null;
  sources: Array<{
    sourceName: string;
    sourceKind: string;
    title: string;
    summary: string | null;
    publishedAt: string | null;
  }>;
};

type AssessmentResult = {
  title: string;
  sourceTitle?: string;
  origin: string;
  concreteEnough?: boolean;
  boardVisibilityScore: number;
  moonFitScore: number;
  controversyScore: number;
  confidence: number;
  suggestedStoryType: string;
  explanation: string;
};

type ComparisonRow = {
  title: string;
  scoredTitle?: string;
  origin: string;
  concreteEnough?: boolean;
  baseline: AssessmentResult;
  candidate: AssessmentResult;
};

const CREATOR_CHANNELS: CreatorChannel[] = [
  {
    name: "AsmonTV",
    channelId: "UCQeRaTukNYft1_6AZPACnog",
    channelUrl: "https://www.youtube.com/@AsmonTV/videos",
  },
  {
    name: "penguinz0",
    channelId: "UCq6VFHwMzcMXbuKyG7SQYIg",
    channelUrl: "https://www.youtube.com/@penguinz0/videos",
  },
];

const LOW_SIGNAL_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "been",
  "being",
  "beyond",
  "but",
  "by",
  "can",
  "cant",
  "can't",
  "completely",
  "could",
  "crazy",
  "did",
  "do",
  "does",
  "done",
  "ever",
  "everyone",
  "fucking",
  "got",
  "gotta",
  "happened",
  "happening",
  "how",
  "i",
  "if",
  "insane",
  "into",
  "is",
  "it",
  "just",
  "keep",
  "keeps",
  "live",
  "lives",
  "look",
  "made",
  "most",
  "nobody",
  "not",
  "of",
  "on",
  "out",
  "please",
  "real",
  "really",
  "safe",
  "so",
  "something",
  "stop",
  "stopped",
  "saying",
  "that",
  "the",
  "their",
  "them",
  "these",
  "they",
  "this",
  "those",
  "throw",
  "to",
  "too",
  "up",
  "was",
  "were",
  "what",
  "where",
  "who",
  "wild",
  "with",
]);

function getArg(name: string, fallback: string) {
  const prefix = `--${name}=`;
  const value = process.argv.find((entry) => entry.startsWith(prefix));
  return value ? value.slice(prefix.length) : fallback;
}

function percentile(values: number[], q: number) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.round((sorted.length - 1) * q))
  );
  return sorted[index] ?? null;
}

function escapeMarkdown(value: string) {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function normalizeTitle(title: string) {
  return title
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\u2026/g, "...")
    .replace(/[“”]/g, "\"")
    .replace(/[‘’]/g, "'");
}

function cleanReportedHeadline(value: string) {
  return value
    .replace(/\s+[|:-]\s+[^|:-]{2,80}$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isWeakTriggerHeadline(value: string) {
  return [
    /\btimeline\b/i,
    /\breview\b/i,
    /\bexplainer\b/i,
    /\bexplained\b/i,
    /\bguide\b/i,
    /\bups and downs\b/i,
    /\bthrough the years\b/i,
    /^what has .+/i,
  ].some((pattern) => pattern.test(value));
}

function isConcreteEnoughTitle(title: string) {
  const tokens = normalizeTitle(title)
    .split(/\s+/)
    .map((token) => token.replace(/^[^a-z0-9$]+|[^a-z0-9$]+$/gi, ""))
    .filter(Boolean);

  if (tokens.length === 0) return false;

  const contentTokens = tokens.filter((token) => {
    const lower = token.toLowerCase();
    return !LOW_SIGNAL_WORDS.has(lower) && /[a-z0-9$]/i.test(token);
  });

  if (contentTokens.length >= 2) return true;
  if (tokens.some((token) => /\d/.test(token) || /\$/.test(token))) return true;
  if (tokens.some((token) => /[A-Z]/.test(token.slice(1)))) return true;

  return false;
}

async function mapLimit<T, R>(
  values: T[],
  limit: number,
  mapper: (value: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(values.length);
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      if (currentIndex >= values.length) {
        return;
      }

      results[currentIndex] = await mapper(values[currentIndex], currentIndex);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, values.length) }, () => worker())
  );
  return results;
}

async function fetchCreatorTitles(
  channel: CreatorChannel,
  limit: number
): Promise<CreatorVideo[]> {
  const res = await fetch(
    `https://www.youtube.com/feeds/videos.xml?channel_id=${channel.channelId}`,
    {
      headers: { "User-Agent": "Mozilla/5.0" },
      cache: "no-store",
    }
  );

  if (!res.ok) {
    throw new Error(`Failed to fetch YouTube RSS for ${channel.name}: ${res.status}`);
  }

  const xml = await res.text();
  const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)]
    .map((match) => match[1] ?? "")
    .slice(0, limit);

  return entries.map((entryXml) => {
    const videoId =
      entryXml.match(/<yt:videoId>([\s\S]*?)<\/yt:videoId>/)?.[1]?.trim() ?? "";
    const title = normalizeTitle(
      entryXml.match(/<title>([\s\S]*?)<\/title>/)?.[1]?.trim() ?? ""
    );
    const description = normalizeTitle(
      entryXml
        .match(/<media:description>([\s\S]*?)<\/media:description>/)?.[1]
        ?.replace(/<[^>]*>/g, "")
        .trim() ?? ""
    );
    const publishedAt =
      entryXml.match(/<published>([\s\S]*?)<\/published>/)?.[1]?.trim() ?? null;

    return {
      channel: channel.name,
      videoId,
      url: videoId ? `https://www.youtube.com/watch?v=${videoId}` : channel.channelUrl,
      title,
      description,
      publishedAt,
      concreteEnough: isConcreteEnoughTitle(title),
    };
  });
}

async function deriveSearchQueries(input: {
  title: string;
  description: string;
}): Promise<{
  searchQuery: string;
  secondaryQuery: string | null;
  referenceHeadline: string;
  triggerSummary: string;
}> {
  if (!client) {
    return {
      searchQuery: input.title,
      secondaryQuery: null,
      referenceHeadline: input.title,
      triggerSummary: input.title,
    };
  }

  const response = await client.responses.create({
    model: MODEL,
    input: [
      {
        role: "system",
        content: `You convert a creator YouTube upload title into the straight news/article headline or query that would have triggered it.

Return JSON with:
- searchQuery: a short search query in plain news language
- secondaryQuery: an optional alternate query
- referenceHeadline: a plausible straight-news headline for the triggering story
- triggerSummary: one short plain-English description of the underlying event/story

Rules:
- Strip out creator-style phrasing, clickbait, and wrappers.
- Focus on the real-world event, scandal, backlash, business failure, social trend, public controversy, or weird incident underneath.
- Prefer people, companies, platforms, products, lawsuits, leaks, bans, bodycam events, and public reactions that a normal article would name.
- Keep searchQuery under 12 words.
- Make referenceHeadline read like an actual reported article headline, not a YouTube title.
- Do not output creator-style phrasing.`,
      },
      {
        role: "user",
        content: [
          `Creator upload title: ${input.title}`,
          input.description
            ? `Video description excerpt: ${input.description.slice(0, 1500)}`
            : "Video description excerpt: unavailable",
        ].join("\n\n"),
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "trigger_query",
        strict: true,
        schema: {
          type: "object",
          properties: {
            searchQuery: { type: "string" },
            secondaryQuery: { type: ["string", "null"] },
            referenceHeadline: { type: "string" },
            triggerSummary: { type: "string" },
          },
          required: ["searchQuery", "secondaryQuery", "referenceHeadline", "triggerSummary"],
          additionalProperties: false,
        },
      },
    },
  });

  return JSON.parse(response.output_text) as {
    searchQuery: string;
    secondaryQuery: string | null;
    referenceHeadline: string;
    triggerSummary: string;
  };
}

async function chooseBestCandidate(input: {
  title: string;
  description: string;
  referenceHeadline: string;
  triggerSummary: string;
  candidates: TriggerCandidate[];
}): Promise<{
  selectedIndex: number | null;
  confidence: number;
  reason: string;
}> {
  if (!client || input.candidates.length === 0) {
    return {
      selectedIndex: null,
      confidence: 0,
      reason: "No candidates or model unavailable.",
    };
  }

  const response = await client.responses.create({
    model: MODEL,
    input: [
      {
        role: "system",
        content: `You pick the article headline that most plausibly matches the underlying event behind a creator upload title.

Return JSON with:
- selectedIndex: zero-based index of the best candidate, or null if none are a good match
- confidence: 0-100
- reason: one short sentence

Rules:
- Prefer a concrete reported event, reveal, backlash, controversy, lawsuit, interview blowup, platform failure, gaming outrage, or business failure over generic commentary.
- Reject explainers, reviews, shopping, quizzes, opinion essays, timelines, or broad adjacent topic coverage if they do not look like the actual hook.
- If multiple candidates fit, choose the one most likely to spark the creator's video angle.
- The candidate should feel close to the reference headline and trigger summary, not just loosely about the same person or topic.
- If the candidate set is junk, return null.`,
      },
      {
        role: "user",
        content: [
          `Creator upload title: ${input.title}`,
          input.description
            ? `Video description excerpt: ${input.description.slice(0, 1500)}`
            : "Video description excerpt: unavailable",
          `Reference article headline: ${input.referenceHeadline}`,
          `Likely trigger summary: ${input.triggerSummary}`,
          "",
          "Candidates:",
          ...input.candidates.map((candidate, index) =>
            [
              `${index}. ${candidate.title}`,
              `source: ${candidate.source}`,
              candidate.publishedAt ? `publishedAt: ${candidate.publishedAt}` : null,
              candidate.snippet ? `snippet: ${candidate.snippet}` : null,
              `url: ${candidate.url}`,
            ]
              .filter(Boolean)
              .join("\n")
          ),
        ].join("\n\n"),
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "trigger_pick",
        strict: true,
        schema: {
          type: "object",
          properties: {
            selectedIndex: { type: ["integer", "null"] },
            confidence: { type: "integer", minimum: 0, maximum: 100 },
            reason: { type: "string" },
          },
          required: ["selectedIndex", "confidence", "reason"],
          additionalProperties: false,
        },
      },
    },
  });

  return JSON.parse(response.output_text) as {
    selectedIndex: number | null;
    confidence: number;
    reason: string;
  };
}

async function resolveCreatorTriggerHeadline(
  row: CreatorVideo
): Promise<CreatorTriggerHeadline> {
  const { searchNewsStory } = await import("../src/server/services/board/news-search");
  const queryPlan = await deriveSearchQueries({
    title: row.title,
    description: row.description,
  });

  const [primaryResults, secondaryResults, referenceResults] = await Promise.all([
    searchNewsStory(queryPlan.searchQuery, "full"),
    queryPlan.secondaryQuery
      ? searchNewsStory(queryPlan.secondaryQuery, "full")
      : Promise.resolve([]),
    searchNewsStory(queryPlan.referenceHeadline, "full"),
  ]);

  const mergedCandidates = [...primaryResults, ...secondaryResults, ...referenceResults]
    .filter((candidate) => candidate.title && candidate.url)
    .map((candidate) => ({
      ...candidate,
      title: cleanReportedHeadline(candidate.title),
    }))
    .filter((candidate) => !isWeakTriggerHeadline(candidate.title))
    .slice(0, 10);

  const pick = await chooseBestCandidate({
    title: row.title,
    description: row.description,
    referenceHeadline: queryPlan.referenceHeadline,
    triggerSummary: queryPlan.triggerSummary,
    candidates: mergedCandidates,
  });

  const selected =
    pick.selectedIndex !== null &&
    pick.selectedIndex >= 0 &&
    pick.selectedIndex < mergedCandidates.length
      ? mergedCandidates[pick.selectedIndex]
      : null;

  return {
    channel: row.channel,
    videoId: row.videoId,
    url: row.url,
    title: row.title,
    description: row.description,
    publishedAt: row.publishedAt,
    concreteEnough: row.concreteEnough,
    searchQuery: queryPlan.searchQuery,
    secondaryQuery: queryPlan.secondaryQuery,
    referenceHeadline: queryPlan.referenceHeadline,
    triggerSummary: queryPlan.triggerSummary,
    scoredHeadline: selected?.title ?? queryPlan.referenceHeadline,
    matchedHeadline: selected?.title ?? null,
    matchedSource: selected?.source ?? null,
    matchedSnippet: selected?.snippet ?? null,
    matchedPublishedAt: selected?.publishedAt ?? null,
    matchedUrl: selected?.url ?? null,
    selectionConfidence: pick.confidence,
  };
}

async function fetchNegativeStories(limit: number, hours: number): Promise<NegativeStory[]> {
  const { Client } = await import("pg");
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
  });

  await client.connect();

  try {
    const irrelevantRows = await client.query<{
      id: string;
      canonical_title: string;
      vertical: string | null;
      story_type: string;
      last_seen_at: string | null;
      items_count: number;
      sources_count: number;
      controversy_score: number | null;
    }>(`
      select
        id,
        canonical_title,
        vertical,
        story_type,
        last_seen_at::text,
        items_count,
        sources_count,
        controversy_score
      from board_story_candidates
      where coalesce((metadata_json->'editorialFeedback'->>'irrelevant')::boolean, false) = true
      order by last_seen_at desc
      limit 40
    `);

    const recentRows = await client.query<{
      id: string;
      canonical_title: string;
      vertical: string | null;
      story_type: string;
      last_seen_at: string | null;
      items_count: number;
      sources_count: number;
      controversy_score: number | null;
    }>(
      `
        with story_source_flags as (
          select
            bs.story_id,
            bool_and(coalesce((s.config_json->>'signalOnly')::boolean, false)) as all_signal_only
          from board_story_sources bs
          inner join board_feed_items fi on fi.id = bs.feed_item_id
          inner join board_sources s on s.id = fi.source_id
          group by bs.story_id
        )
        select
          c.id,
          c.canonical_title,
          c.vertical,
          c.story_type,
          c.last_seen_at::text,
          c.items_count,
          c.sources_count,
          c.controversy_score
        from board_story_candidates c
        inner join story_source_flags f on f.story_id = c.id
        where
          c.last_seen_at >= now() - ($1::text || ' hours')::interval
          and not f.all_signal_only
          and coalesce((c.metadata_json->'editorialFeedback'->>'irrelevant')::boolean, false) = false
        order by md5(c.id::text)
        limit $2
      `,
      [String(hours), String(limit)]
    );

    const storyRows = [
      ...irrelevantRows.rows.map((row) => ({
        ...row,
        kind: "marked_irrelevant" as const,
      })),
      ...recentRows.rows.map((row) => ({
        ...row,
        kind: "recent_board" as const,
      })),
    ];

    const results: NegativeStory[] = [];
    for (const story of storyRows) {
      const sources = await client.query<{
        source_name: string;
        source_kind: string;
        title: string;
        summary: string | null;
        published_at: string | null;
      }>(
        `
          select
            s.name as source_name,
            s.kind as source_kind,
            fi.title,
            fi.summary,
            fi.published_at::text
          from board_story_sources bs
          inner join board_feed_items fi on fi.id = bs.feed_item_id
          inner join board_sources s on s.id = fi.source_id
          where bs.story_id = $1
          order by fi.published_at desc nulls last
          limit 6
        `,
        [story.id]
      );

      results.push({
        kind: story.kind,
        id: story.id,
        canonicalTitle: story.canonical_title,
        vertical: story.vertical,
        storyType: story.story_type,
        lastSeenAt: story.last_seen_at,
        itemsCount: story.items_count,
        sourcesCount: story.sources_count,
        controversyScore: story.controversy_score,
        sources: sources.rows.map((row) => ({
          sourceName: row.source_name,
          sourceKind: row.source_kind,
          title: row.title,
          summary: row.summary,
          publishedAt: row.published_at,
        })),
      });
    }

    return results;
  } finally {
    await client.end();
  }
}

function isNewswireOrInstitutionalXSourceName(sourceName: string) {
  const lower = sourceName.trim().toLowerCase();
  return [
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
  ].some((name) => lower === name || lower.includes(name));
}

async function scoreCreatorTitle(
  profile: string,
  row: CreatorTriggerHeadline
): Promise<AssessmentResult> {
  const [{ assessBoardStory }, { scoreTextAgainstMoonCorpus }] = await Promise.all([
    import("../src/server/providers/openai"),
    import("../src/server/services/moon-corpus"),
  ]);

  const moon = await scoreTextAgainstMoonCorpus({
    title: row.scoredHeadline,
    text: row.matchedSnippet ?? row.triggerSummary,
  });
  const assessment = await assessBoardStory({
    canonicalTitle: row.scoredHeadline,
    vertical: moon.clusterLabel,
    currentStoryType: "normal",
    lastSeenAt: row.matchedPublishedAt ?? row.publishedAt ?? new Date().toISOString(),
    itemsCount: 1,
    sourcesCount: row.matchedHeadline ? 2 : 1,
    observedControversyScore: 0,
    attentionSignals: {
      hasXDiscourse: false,
      hasYouTubePickup: true,
      hasRedditPickup: row.matchedSource === "reddit",
      hasMultipleSources: Boolean(row.matchedHeadline),
      competitorOverlap: 0,
      visualEvidence: 0,
    },
    moonContext: {
      clusterLabel: moon.clusterLabel,
      coverageMode: moon.coverageMode,
      analogMedianViews: moon.analogMedianViews,
      analogs: moon.analogs.slice(0, 3).map((analog) => ({
        title: analog.title,
        viewCount: analog.viewCount,
        similarityScore: analog.similarityScore,
      })),
    },
    sources: [
      {
        sourceName: row.channel,
        sourceKind: "youtube_channel",
        title: row.title,
        summary: row.description || row.triggerSummary,
        publishedAt: row.publishedAt ?? new Date().toISOString(),
      },
      ...(row.matchedHeadline
        ? [
            {
              sourceName: row.matchedSource ?? "trigger_headline_proxy",
              sourceKind: "rss" as const,
              title: row.scoredHeadline,
              summary: row.matchedSnippet ?? row.description ?? row.triggerSummary,
              publishedAt:
                row.matchedPublishedAt ?? row.publishedAt ?? new Date().toISOString(),
            },
          ]
        : []),
    ],
    promptProfile: profile as never,
  });

  return {
    title: row.scoredHeadline,
    sourceTitle: row.title,
    origin: row.channel,
    concreteEnough: row.concreteEnough,
    ...assessment,
  };
}

async function scoreNegativeStory(
  profile: string,
  story: NegativeStory
): Promise<AssessmentResult> {
  const [{ assessBoardStory }, { scoreTextAgainstMoonCorpus }] = await Promise.all([
    import("../src/server/providers/openai"),
    import("../src/server/services/moon-corpus"),
  ]);

  const moon = await scoreTextAgainstMoonCorpus({
    title: story.canonicalTitle,
    text: story.sources
      .map((source) => source.summary?.trim())
      .filter((value): value is string => Boolean(value))
      .join(" "),
  });
  const assessment = await assessBoardStory({
    canonicalTitle: story.canonicalTitle,
    vertical: story.vertical ?? moon.clusterLabel,
    currentStoryType: story.storyType,
    lastSeenAt: story.lastSeenAt,
    itemsCount: story.itemsCount,
    sourcesCount: story.sourcesCount,
    observedControversyScore: story.controversyScore,
    attentionSignals: {
      hasXDiscourse: story.sources.some(
        (source) =>
          source.sourceKind === "x_account" &&
          !isNewswireOrInstitutionalXSourceName(source.sourceName)
      ),
      hasYouTubePickup: story.sources.some(
        (source) => source.sourceKind === "youtube_channel"
      ),
      hasRedditPickup: story.sources.some(
        (source) =>
          source.sourceKind === "reddit_subreddit" ||
          source.sourceName.toLowerCase().includes("reddit")
      ),
      hasMultipleSources: story.sourcesCount >= 2,
      competitorOverlap: 0,
      visualEvidence: 0,
    },
    moonContext: {
      clusterLabel: moon.clusterLabel,
      coverageMode: moon.coverageMode,
      analogMedianViews: moon.analogMedianViews,
      analogs: moon.analogs.slice(0, 3).map((analog) => ({
        title: analog.title,
        viewCount: analog.viewCount,
        similarityScore: analog.similarityScore,
      })),
    },
    sources: story.sources,
    promptProfile: profile as never,
  });

  return {
    title: story.canonicalTitle,
    origin: story.kind,
    ...assessment,
  };
}

function summarizeScores(values: number[]) {
  return {
    median: percentile(values, 0.5),
    p75: percentile(values, 0.75),
    p90: percentile(values, 0.9),
    max: percentile(values, 1),
  };
}

function formatScoreSummary(label: string, values: number[]) {
  const summary = summarizeScores(values);
  return `- ${label}: median ${summary.median ?? "n/a"}, p75 ${summary.p75 ?? "n/a"}, p90 ${summary.p90 ?? "n/a"}, max ${summary.max ?? "n/a"}`;
}

async function main() {
  const perChannel = Math.max(20, Math.min(80, Number(getArg("per-channel", "35")) || 35));
  const negativeCount = Math.max(10, Math.min(80, Number(getArg("negative-count", "24")) || 24));
  const hours = Math.max(24, Math.min(336, Number(getArg("hours", "168")) || 168));
  const concurrency = Math.max(1, Math.min(8, Number(getArg("concurrency", "4")) || 4));
  const candidateProfile = getArg("candidate-profile", DEFAULT_PROFILE);
  const baselineProfile = getArg("baseline-profile", BASELINE_PROFILE);

  const creatorTitleLists = await Promise.all(
    CREATOR_CHANNELS.map((channel) => fetchCreatorTitles(channel, perChannel))
  );
  const creatorTitles = creatorTitleLists.flat();
  const creatorTriggerHeadlines = await mapLimit(
    creatorTitles,
    concurrency,
    async (row, index) => {
      console.log(`[trigger ${index + 1}/${creatorTitles.length}] ${row.channel} :: ${row.title}`);
      return resolveCreatorTriggerHeadline(row);
    }
  );
  const negativeStories = await fetchNegativeStories(negativeCount, hours);

  const creatorComparisons = await mapLimit(creatorTriggerHeadlines, concurrency, async (row, index) => {
    console.log(`[creator ${index + 1}/${creatorTriggerHeadlines.length}] ${row.channel} :: ${row.scoredHeadline}`);
    const [baseline, candidate] = await Promise.all([
      scoreCreatorTitle(baselineProfile, row),
      scoreCreatorTitle(candidateProfile, row),
    ]);

    return {
      title: row.title,
      scoredTitle: row.scoredHeadline,
      origin: row.channel,
      concreteEnough: row.concreteEnough,
      baseline,
      candidate,
    } satisfies ComparisonRow;
  });

  const negativeComparisons = await mapLimit(
    negativeStories,
    concurrency,
    async (story, index) => {
      console.log(`[negative ${index + 1}/${negativeStories.length}] ${story.kind} :: ${story.canonicalTitle}`);
      const [baseline, candidate] = await Promise.all([
        scoreNegativeStory(baselineProfile, story),
        scoreNegativeStory(candidateProfile, story),
      ]);

      return {
        title: story.canonicalTitle,
        origin: story.kind,
        baseline,
        candidate,
      } satisfies ComparisonRow;
    }
  );

  const creatorCandidateScores = creatorComparisons.map(
    (row) => row.candidate.boardVisibilityScore
  );
  const creatorBaselineScores = creatorComparisons.map(
    (row) => row.baseline.boardVisibilityScore
  );
  const creatorConcreteCandidateScores = creatorComparisons
    .filter((row) => row.concreteEnough)
    .map((row) => row.candidate.boardVisibilityScore);
  const creatorConcreteBaselineScores = creatorComparisons
    .filter((row) => row.concreteEnough)
    .map((row) => row.baseline.boardVisibilityScore);
  const negativeCandidateScores = negativeComparisons.map(
    (row) => row.candidate.boardVisibilityScore
  );
  const negativeBaselineScores = negativeComparisons.map(
    (row) => row.baseline.boardVisibilityScore
  );

  const creator45 = creatorComparisons.filter(
    (row) => row.candidate.boardVisibilityScore >= 45
  ).length;
  const creator60 = creatorComparisons.filter(
    (row) => row.candidate.boardVisibilityScore >= 60
  ).length;
  const creatorConcrete45 = creatorComparisons.filter(
    (row) => row.concreteEnough && row.candidate.boardVisibilityScore >= 45
  ).length;
  const creatorConcrete60 = creatorComparisons.filter(
    (row) => row.concreteEnough && row.candidate.boardVisibilityScore >= 60
  ).length;
  const negativesLow = negativeComparisons.filter(
    (row) => row.candidate.boardVisibilityScore <= 25
  ).length;
  const negativesHigh = negativeComparisons.filter(
    (row) => row.candidate.boardVisibilityScore >= 45
  ).length;
  const creatorMatchedHeadlineCount = creatorTriggerHeadlines.filter(
    (row) => row.matchedHeadline
  ).length;

  const biggestPositiveLifts = [...creatorComparisons]
    .sort(
      (a, b) =>
        b.candidate.boardVisibilityScore -
          b.baseline.boardVisibilityScore -
        (a.candidate.boardVisibilityScore - a.baseline.boardVisibilityScore)
    )
    .slice(0, 15);
  const biggestPositiveMisses = [...creatorComparisons]
    .sort((a, b) => a.candidate.boardVisibilityScore - b.candidate.boardVisibilityScore)
    .slice(0, 15);
  const highestNegativeFalsePositives = [...negativeComparisons]
    .sort((a, b) => b.candidate.boardVisibilityScore - a.candidate.boardVisibilityScore)
    .slice(0, 15);

  const today = new Date().toISOString().slice(0, 10);
  const reportPath = path.resolve(
    process.cwd(),
    "research",
    `online-culture-prompt-eval-${today}.md`
  );
  await mkdir(path.dirname(reportPath), { recursive: true });

  const report = `# Online Culture Prompt Eval (${today})

Candidate profile: \`${candidateProfile}\`

Baseline profile: \`${baselineProfile}\`

Sample:
- Creator titles: ${creatorTitles.length} (${CREATOR_CHANNELS.map((channel, index) => `${channel.name} ${creatorTitleLists[index]?.length ?? 0}`).join(", ")})
- Creator titles with matched article headlines: ${creatorMatchedHeadlineCount}/${creatorTriggerHeadlines.length}
- Concrete-enough creator titles: ${creatorComparisons.filter((row) => row.concreteEnough).length}
- Negative stories: ${negativeStories.length} (${negativeStories.filter((story) => story.kind === "marked_irrelevant").length} marked irrelevant, ${negativeStories.filter((story) => story.kind === "recent_board").length} random recent board)

## Candidate Topline

- Creator titles scoring 45+: ${creator45}/${creatorComparisons.length}
- Creator titles scoring 60+: ${creator60}/${creatorComparisons.length}
- Concrete-enough creator titles scoring 45+: ${creatorConcrete45}/${creatorComparisons.filter((row) => row.concreteEnough).length}
- Concrete-enough creator titles scoring 60+: ${creatorConcrete60}/${creatorComparisons.filter((row) => row.concreteEnough).length}
- Negative stories scoring 25 or below: ${negativesLow}/${negativeComparisons.length}
- Negative stories scoring 45+: ${negativesHigh}/${negativeComparisons.length}

## Score Distributions

${formatScoreSummary("Creator baseline visibility", creatorBaselineScores)}
${formatScoreSummary("Creator candidate visibility", creatorCandidateScores)}
${formatScoreSummary("Concrete creator baseline visibility", creatorConcreteBaselineScores)}
${formatScoreSummary("Concrete creator candidate visibility", creatorConcreteCandidateScores)}
${formatScoreSummary("Negative baseline visibility", negativeBaselineScores)}
${formatScoreSummary("Negative candidate visibility", negativeCandidateScores)}

## Biggest Positive Lifts

| Creator Title | Trigger Headline | Origin | Concrete | Baseline | Candidate | Delta |
| --- | --- | --- | --- | ---: | ---: | ---: |
${biggestPositiveLifts
  .map(
    (row) =>
      `| ${escapeMarkdown(row.title)} | ${escapeMarkdown(row.scoredTitle ?? row.candidate.title)} | ${row.origin} | ${row.concreteEnough ? "yes" : "no"} | ${row.baseline.boardVisibilityScore} | ${row.candidate.boardVisibilityScore} | ${row.candidate.boardVisibilityScore - row.baseline.boardVisibilityScore} |`
  )
  .join("\n")}

## Lowest Candidate Creator Scores

| Creator Title | Trigger Headline | Origin | Concrete | Baseline | Candidate | Candidate Fit | Explanation |
| --- | --- | --- | --- | ---: | ---: | ---: | --- |
${biggestPositiveMisses
  .map(
    (row) =>
      `| ${escapeMarkdown(row.title)} | ${escapeMarkdown(row.scoredTitle ?? row.candidate.title)} | ${row.origin} | ${row.concreteEnough ? "yes" : "no"} | ${row.baseline.boardVisibilityScore} | ${row.candidate.boardVisibilityScore} | ${row.candidate.moonFitScore} | ${escapeMarkdown(row.candidate.explanation)} |`
  )
  .join("\n")}

## Highest Candidate Negative Scores

| Title | Origin | Baseline | Candidate | Candidate Fit | Explanation |
| --- | --- | ---: | ---: | ---: | --- |
${highestNegativeFalsePositives
  .map(
    (row) =>
      `| ${escapeMarkdown(row.title)} | ${row.origin} | ${row.baseline.boardVisibilityScore} | ${row.candidate.boardVisibilityScore} | ${row.candidate.moonFitScore} | ${escapeMarkdown(row.candidate.explanation)} |`
  )
  .join("\n")}
`;

  await writeFile(reportPath, report, "utf8");

  console.log(
    JSON.stringify(
      {
        reportPath,
        creatorTitles: creatorTitles.length,
        creatorMatchedHeadlineCount,
        concreteCreatorTitles: creatorComparisons.filter((row) => row.concreteEnough).length,
        negativeStories: negativeStories.length,
        creator45,
        creator60,
        creatorConcrete45,
        creatorConcrete60,
        negativesLow,
        negativesHigh,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
