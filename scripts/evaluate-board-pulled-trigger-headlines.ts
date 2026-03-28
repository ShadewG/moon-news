import { config as loadEnv } from "dotenv";
import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import OpenAI from "openai";
import { desc, eq, inArray } from "drizzle-orm";

import {
  assessBoardStory,
  type BoardStoryAssessment,
} from "../src/server/providers/openai";
import { getDb } from "../src/server/db/client";
import {
  boardFeedItems,
  boardSources,
  boardStoryCandidates,
  boardStorySources,
  clipLibrary,
  transcriptCache,
} from "../src/server/db/schema";
import { scoreBoardStoryWithMoonCorpus } from "../src/server/services/moon-corpus";
import { scoreStory } from "../src/server/services/board/story-scorer";

loadEnv({ path: path.resolve(process.cwd(), ".env") });
loadEnv({ path: path.resolve(process.cwd(), ".env.local"), override: true });

const execFileAsync = promisify(execFile);
const MOON_UPLOADS_PLAYLIST = "UUmFeOdJI3IXgTBDzqBLD8qg";
const YTDLP_BIN = path.resolve(process.cwd(), ".venv-ytdlp", "bin", "yt-dlp");
const MODEL = process.env.OPENAI_RESEARCH_MODEL ?? "gpt-4.1-mini";
const client = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

const STOPWORDS = new Set([
  "about", "after", "again", "against", "almost", "also", "among", "and", "are", "because",
  "been", "being", "between", "both", "but", "came", "come", "could", "does", "down",
  "during", "each", "ever", "from", "have", "here", "into", "just", "like", "made", "make",
  "many", "more", "most", "much", "must", "never", "nobody", "only", "other", "over", "really",
  "same", "should", "some", "still", "such", "than", "that", "their", "them", "then", "there",
  "these", "they", "this", "those", "through", "today", "under", "very", "want", "were", "what",
  "when", "where", "which", "while", "with", "without", "would", "your", "the", "to", "of",
  "in", "on", "for", "is", "its", "why", "how", "you", "our", "all", "now", "out", "has",
  "had", "did", "too", "can", "his", "her", "him", "she", "who", "not",
]);

type MoonUpload = {
  videoId: string;
  title: string;
  durationSeconds: number;
  viewCount: number;
  playlistIndex: number;
};

type BoardStoryRecord = {
  storyId: string;
  canonicalTitle: string;
  lastSeenAt: string | null;
  storyType: string;
  controversyScore: number;
  sourcesCount: number;
  itemsCount: number;
  sourceTitles: string[];
  sourceSummaries: string[];
  sourceNames: string[];
  feedItems: Array<{
    sourceName: string;
    sourceKind: string;
    title: string;
    summary: string | null;
    publishedAt: string | null;
  }>;
  textBlob: string;
  titleTokens: Set<string>;
  bodyTokens: Set<string>;
};

type QueryPlan = {
  searchQuery: string;
  secondaryQuery: string | null;
  referenceHeadline: string;
  triggerSummary: string;
};

type MatchCandidate = {
  storyId: string;
  canonicalTitle: string;
  matchedHeadline: string;
  matchedSource: string;
  lexicalScore: number;
  lastSeenAt: string | null;
};

type MatchRow = {
  videoTitle: string;
  viewCount: number;
  playlistIndex: number;
  searchQuery: string;
  secondaryQuery: string | null;
  referenceHeadline: string;
  triggerSummary: string;
  matchedStoryTitle: string | null;
  matchedHeadline: string | null;
  matchedSource: string | null;
  selectionConfidence: number;
  finalScore: number | null;
  boardVisibilityScore: number | null;
  moonFitScore: number | null;
  controversyScore: number | null;
  explanation: string | null;
};

type EvaluatedStoryState = {
  finalScore: number | null;
  boardVisibilityScore: number | null;
  moonFitScore: number | null;
  controversyScore: number | null;
};

function parseArgs() {
  const getArg = (name: string, fallback: string) =>
    process.argv.find((entry) => entry.startsWith(`${name}=`))?.slice(name.length + 1) ?? fallback;

  return {
    moonCount: Math.max(10, Math.min(140, Number(getArg("--moon-count", "40")) || 40)),
    concurrency: Math.max(1, Math.min(6, Number(getArg("--concurrency", "3")) || 3)),
    includeShorts: process.argv.includes("--include-shorts"),
  };
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function normalizeText(value: string) {
  return decodeHtmlEntities(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(value: string) {
  return normalizeText(value)
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !STOPWORDS.has(token));
}

function unique<T>(values: T[]) {
  return [...new Set(values)];
}

function formatViews(value: number | null | undefined) {
  if (!value || value <= 0) return "n/a";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 100_000 ? 0 : 1)}K`;
  return String(value);
}

function escapeMarkdown(value: string) {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function percentile(values: number[], q: number) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * q)));
  return sorted[index] ?? null;
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
      if (currentIndex >= values.length) return;
      results[currentIndex] = await mapper(values[currentIndex], currentIndex);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, () => worker()));
  return results;
}

async function fetchRecentMoonUploads(count: number, includeShorts: boolean): Promise<MoonUpload[]> {
  const playlistFetchCount = includeShorts
    ? Math.max(count * 2, count + 20)
    : Math.max(count * 14, count + 80);

  const { stdout } = await execFileAsync(
    YTDLP_BIN,
    [
      "--flat-playlist",
      "--playlist-end",
      String(playlistFetchCount),
      "--print",
      "%(id)s|||%(title)s|||%(duration)s|||%(view_count)s",
      `https://www.youtube.com/playlist?list=${MOON_UPLOADS_PLAYLIST}`,
    ],
    {
      cwd: process.cwd(),
      maxBuffer: 20 * 1024 * 1024,
      timeout: 120000,
    }
  );

  const rows = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const [videoId, title, duration, viewCount] = line.split("|||");
      return {
        videoId,
        title,
        durationSeconds: Number(duration) || 0,
        viewCount: Number(viewCount) || 0,
        playlistIndex: index + 1,
      } satisfies MoonUpload;
    });

  const selectedRows = (includeShorts ? rows : rows.filter((row) => row.durationSeconds >= 180)).slice(0, count);
  const idsNeedingViews = selectedRows.filter((row) => row.viewCount <= 0).map((row) => row.videoId);

  if (idsNeedingViews.length === 0) {
    return selectedRows;
  }

  const db = getDb();
  const libraryRows = await db
    .select({
      externalId: clipLibrary.externalId,
      viewCount: clipLibrary.viewCount,
    })
    .from(clipLibrary)
    .where(inArray(clipLibrary.externalId, idsNeedingViews));

  const viewCounts = new Map(libraryRows.map((row) => [row.externalId, row.viewCount ?? 0]));
  return selectedRows.map((row) => ({
    ...row,
    viewCount: row.viewCount > 0 ? row.viewCount : viewCounts.get(row.videoId) ?? 0,
  }));
}

async function loadTranscriptExcerpt(videoId: string) {
  const db = getDb();
  const row = await db
    .select({
      transcript: transcriptCache.fullText,
    })
    .from(clipLibrary)
    .leftJoin(transcriptCache, eq(transcriptCache.clipId, clipLibrary.id))
    .where(eq(clipLibrary.externalId, videoId))
    .orderBy(desc(clipLibrary.createdAt))
    .limit(1)
    .then((rows) => rows[0]);

  const transcript = row?.transcript?.replace(/\s+/g, " ").trim() ?? "";
  return transcript.slice(0, 3500);
}

async function deriveSearchQueries(input: {
  title: string;
  transcriptExcerpt: string;
}): Promise<QueryPlan> {
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
        content: `You convert a Moon YouTube essay title into the straight news/article headline or query that would have triggered it.

Return JSON with:
- searchQuery: a short search query in plain news language
- secondaryQuery: an optional alternate query
- referenceHeadline: a plausible straight-news headline for the triggering story
- triggerSummary: one short plain-English description of the underlying event/story

Rules:
- Strip out Moon rhetoric like "everything wrong with society", "tried to warn you", "is worse than you thought", "destroying society", "the dark side of".
- Focus on the real-world event, scandal, backlash, business failure, social trend, or public controversy underneath.
- Prefer people, companies, platforms, products, scandals, lawsuits, leaks, interviews, and public reactions that a normal article would name.
- If the video is thesis-style, infer the likely triggering story or headline cluster that would send someone down that topic.
- Keep searchQuery under 12 words.
- Make referenceHeadline read like an actual reported article headline, not a Moon title.
- Do not output Moon-style phrasing.`,
      },
      {
        role: "user",
        content: [
          `Moon video title: ${input.title}`,
          input.transcriptExcerpt
            ? `Transcript excerpt: ${input.transcriptExcerpt}`
            : "Transcript excerpt: unavailable",
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

  return JSON.parse(response.output_text) as QueryPlan;
}

async function loadBoardStories(): Promise<BoardStoryRecord[]> {
  const db = getDb();
  const rows = await db
    .select({
      storyId: boardStoryCandidates.id,
      canonicalTitle: boardStoryCandidates.canonicalTitle,
      lastSeenAt: boardStoryCandidates.lastSeenAt,
      storyType: boardStoryCandidates.storyType,
      controversyScore: boardStoryCandidates.controversyScore,
      sourcesCount: boardStoryCandidates.sourcesCount,
      itemsCount: boardStoryCandidates.itemsCount,
      sourceTitle: boardFeedItems.title,
      sourceSummary: boardFeedItems.summary,
      sourceName: boardSources.name,
      sourceKind: boardSources.kind,
      publishedAt: boardFeedItems.publishedAt,
      isPrimary: boardStorySources.isPrimary,
    })
    .from(boardStoryCandidates)
    .leftJoin(boardStorySources, eq(boardStorySources.storyId, boardStoryCandidates.id))
    .leftJoin(boardFeedItems, eq(boardFeedItems.id, boardStorySources.feedItemId))
    .leftJoin(boardSources, eq(boardSources.id, boardFeedItems.sourceId))
    .orderBy(desc(boardStoryCandidates.lastSeenAt));

  const storyMap = new Map<string, BoardStoryRecord>();

  for (const row of rows) {
    const existing =
      storyMap.get(row.storyId) ??
      {
        storyId: row.storyId,
        canonicalTitle: decodeHtmlEntities(row.canonicalTitle),
        lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
        storyType: row.storyType,
        controversyScore: row.controversyScore,
        sourcesCount: row.sourcesCount,
        itemsCount: row.itemsCount,
        sourceTitles: [],
        sourceSummaries: [],
        sourceNames: [],
        feedItems: [],
        textBlob: "",
        titleTokens: new Set<string>(),
        bodyTokens: new Set<string>(),
      } satisfies BoardStoryRecord;

    if (row.sourceTitle) {
      const decodedTitle = decodeHtmlEntities(row.sourceTitle);
      if (row.isPrimary) {
        existing.sourceTitles.unshift(decodedTitle);
      } else {
        existing.sourceTitles.push(decodedTitle);
      }
    }

    if (row.sourceSummary) {
      existing.sourceSummaries.push(decodeHtmlEntities(row.sourceSummary));
    }

    if (row.sourceName) {
      existing.sourceNames.push(row.sourceName);
    }

    if (row.sourceTitle && row.sourceName && row.sourceKind) {
      const feedItem = {
        sourceName: row.sourceName,
        sourceKind: row.sourceKind,
        title: decodeHtmlEntities(row.sourceTitle),
        summary: row.sourceSummary ? decodeHtmlEntities(row.sourceSummary) : null,
        publishedAt: row.publishedAt?.toISOString() ?? null,
      };

      if (row.isPrimary) {
        existing.feedItems.unshift(feedItem);
      } else {
        existing.feedItems.push(feedItem);
      }
    }

    storyMap.set(row.storyId, existing);
  }

  for (const story of storyMap.values()) {
    const textBlob = [
      story.canonicalTitle,
      ...story.sourceTitles.slice(0, 4),
      ...story.sourceSummaries.slice(0, 3),
    ]
      .filter(Boolean)
      .join(" ");

    story.textBlob = textBlob;
    story.titleTokens = new Set(tokenize([story.canonicalTitle, ...story.sourceTitles.slice(0, 3)].join(" ")));
    story.bodyTokens = new Set(tokenize(textBlob));
    story.sourceTitles = unique(story.sourceTitles).slice(0, 4);
    story.sourceSummaries = unique(story.sourceSummaries).slice(0, 3);
    story.sourceNames = unique(story.sourceNames).slice(0, 4);
    story.feedItems = story.feedItems
      .filter(
        (item, index, allItems) =>
          allItems.findIndex(
            (candidate) =>
              candidate.sourceName === item.sourceName &&
              candidate.title === item.title &&
              candidate.publishedAt === item.publishedAt
          ) === index
      )
      .slice(0, 6);
  }

  return [...storyMap.values()];
}

function scoreCandidateLexically(story: BoardStoryRecord, plan: QueryPlan) {
  const normalizedTitle = normalizeText(`${story.canonicalTitle} ${story.sourceTitles.join(" ")}`);
  const normalizedBody = normalizeText(story.textBlob);
  const weightedPhrases = [
    { value: plan.referenceHeadline, weight: 22 },
    { value: plan.searchQuery, weight: 16 },
    { value: plan.secondaryQuery ?? "", weight: 10 },
  ].filter((entry) => entry.value.trim().length >= 4);

  let score = 0;
  for (const phrase of weightedPhrases) {
    const normalizedPhrase = normalizeText(phrase.value);
    if (!normalizedPhrase) continue;
    if (normalizedTitle.includes(normalizedPhrase)) {
      score += phrase.weight;
    } else if (normalizedBody.includes(normalizedPhrase)) {
      score += Math.round(phrase.weight * 0.7);
    }
  }

  const weightedTokenLists = [
    { tokens: tokenize(plan.referenceHeadline), titleWeight: 6, bodyWeight: 3 },
    { tokens: tokenize(plan.searchQuery), titleWeight: 5, bodyWeight: 2 },
    { tokens: tokenize(plan.secondaryQuery ?? ""), titleWeight: 4, bodyWeight: 2 },
    { tokens: tokenize(plan.triggerSummary), titleWeight: 3, bodyWeight: 2 },
  ];

  for (const list of weightedTokenLists) {
    for (const token of list.tokens) {
      if (story.titleTokens.has(token)) {
        score += list.titleWeight;
      } else if (story.bodyTokens.has(token)) {
        score += list.bodyWeight;
      }
    }
  }

  const referenceTokens = tokenize(plan.referenceHeadline);
  for (let index = 0; index < referenceTokens.length - 1; index += 1) {
    const bigram = `${referenceTokens[index]} ${referenceTokens[index + 1]}`;
    if (normalizedTitle.includes(bigram)) {
      score += 8;
    } else if (normalizedBody.includes(bigram)) {
      score += 4;
    }
  }

  return score;
}

function shortlistCandidates(stories: BoardStoryRecord[], plan: QueryPlan): MatchCandidate[] {
  return stories
    .map((story) => ({
      storyId: story.storyId,
      canonicalTitle: story.canonicalTitle,
      matchedHeadline: story.sourceTitles[0] ?? story.canonicalTitle,
      matchedSource: story.sourceNames[0] ?? "unknown",
      lexicalScore: scoreCandidateLexically(story, plan),
      lastSeenAt: story.lastSeenAt,
    }))
    .filter((story) => story.lexicalScore > 0)
    .sort((left, right) => {
      if (right.lexicalScore !== left.lexicalScore) {
        return right.lexicalScore - left.lexicalScore;
      }

      return (right.lastSeenAt ?? "").localeCompare(left.lastSeenAt ?? "");
    })
    .slice(0, 12);
}

async function chooseBestBoardStory(input: {
  title: string;
  transcriptExcerpt: string;
  plan: QueryPlan;
  candidates: MatchCandidate[];
}): Promise<{
  selectedIndex: number | null;
  confidence: number;
  reason: string;
}> {
  if (!client || input.candidates.length === 0) {
    return {
      selectedIndex: input.candidates.length > 0 ? 0 : null,
      confidence: input.candidates.length > 0 ? 40 : 0,
      reason: input.candidates.length > 0 ? "Fallback to top lexical candidate." : "No candidates available.",
    };
  }

  const response = await client.responses.create({
    model: MODEL,
    input: [
      {
        role: "system",
        content: `You pick which real pulled board story best matches the triggering case behind a Moon video.

Return JSON with:
- selectedIndex: zero-based index of the best candidate, or null if none are a good match
- confidence: 0-100
- reason: one short sentence

Rules:
- Candidates are real stories already ingested into Moon's board.
- Prefer a concrete story match, not just a vaguely related topic.
- The best candidate should feel like the actual case, controversy, event, scandal, backlash, or social proof-case that could plausibly trigger the Moon video.
- Reject adjacent theme matches if they miss the specific people, platform, controversy, or core event.
- If the candidate set is weak, return null.`,
      },
      {
        role: "user",
        content: [
          `Moon video title: ${input.title}`,
          `Reference article headline: ${input.plan.referenceHeadline}`,
          `Likely trigger summary: ${input.plan.triggerSummary}`,
          input.transcriptExcerpt
            ? `Transcript excerpt: ${input.transcriptExcerpt}`
            : "Transcript excerpt: unavailable",
          "",
          "Pulled board candidates:",
          ...input.candidates.map((candidate, index) =>
            [
              `${index}. ${candidate.canonicalTitle}`,
              `headline: ${candidate.matchedHeadline}`,
              `source: ${candidate.matchedSource}`,
              candidate.lastSeenAt ? `lastSeenAt: ${candidate.lastSeenAt}` : null,
              `lexicalScore: ${candidate.lexicalScore}`,
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
        name: "board_story_pick",
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

async function loadScoredStoryState(storyId: string) {
  const db = getDb();
  const row = await db
    .select({
      canonicalTitle: boardStoryCandidates.canonicalTitle,
      scoreJson: boardStoryCandidates.scoreJson,
      controversyScore: boardStoryCandidates.controversyScore,
    })
    .from(boardStoryCandidates)
    .where(eq(boardStoryCandidates.id, storyId))
    .limit(1)
    .then((rows) => rows[0]);

  const scoreJson = row?.scoreJson && typeof row.scoreJson === "object" ? row.scoreJson as Record<string, unknown> : {};
  const aiBoardAssessment =
    scoreJson.aiBoardAssessment && typeof scoreJson.aiBoardAssessment === "object"
      ? scoreJson.aiBoardAssessment as Record<string, unknown>
      : null;

  return {
    canonicalTitle: row?.canonicalTitle ?? "",
    finalScore: typeof scoreJson.overall === "number" ? scoreJson.overall : Number(scoreJson.overall ?? 0),
    boardVisibilityScore:
      typeof scoreJson.boardVisibilityScore === "number"
        ? scoreJson.boardVisibilityScore
        : Number(aiBoardAssessment?.boardVisibilityScore ?? 0),
    moonFitScore:
      aiBoardAssessment && typeof aiBoardAssessment.moonFitScore === "number"
        ? aiBoardAssessment.moonFitScore
        : typeof scoreJson.moonFitScore === "number"
          ? scoreJson.moonFitScore
          : Number(scoreJson.moonFitScore ?? 0),
    controversyScore:
      aiBoardAssessment && typeof aiBoardAssessment.controversyScore === "number"
        ? aiBoardAssessment.controversyScore
        : row?.controversyScore ?? 0,
  };
}

async function evaluateStoryVisibility(story: BoardStoryRecord): Promise<EvaluatedStoryState> {
  await scoreStory(story.storyId);
  const scoredState = await loadScoredStoryState(story.storyId);

  try {
    const moonContext = await scoreBoardStoryWithMoonCorpus(story.storyId);
    const aiAssessment: BoardStoryAssessment = await assessBoardStory({
      canonicalTitle: story.canonicalTitle,
      vertical: moonContext?.clusterLabel ?? null,
      currentStoryType: story.storyType,
      lastSeenAt: story.lastSeenAt,
      itemsCount: story.itemsCount,
      sourcesCount: story.sourcesCount,
      observedControversyScore: story.controversyScore,
      attentionSignals: {
        hasXDiscourse: story.feedItems.some((item) => item.sourceKind === "x_account"),
        hasYouTubePickup: story.feedItems.some((item) => item.sourceKind === "youtube_channel"),
        hasRedditPickup: story.feedItems.some(
          (item) => item.sourceKind === "reddit" || item.sourceName.toLowerCase().includes("reddit")
        ),
        hasMultipleSources: story.sourcesCount >= 2,
        competitorOverlap: 0,
        visualEvidence: 0,
      },
      moonContext: moonContext
        ? {
            clusterLabel: moonContext.clusterLabel,
            coverageMode: moonContext.coverageMode,
            analogMedianViews: moonContext.analogMedianViews,
            analogs: moonContext.analogs.slice(0, 3).map((analog) => ({
              title: analog.title,
              viewCount: analog.viewCount,
              similarityScore: analog.similarityScore,
            })),
          }
        : null,
      sources: story.feedItems.slice(0, 6),
    });

    return {
      finalScore: scoredState.finalScore,
      boardVisibilityScore: aiAssessment.boardVisibilityScore,
      moonFitScore: aiAssessment.moonFitScore,
      controversyScore: aiAssessment.controversyScore,
    };
  } catch {
    return scoredState;
  }
}

async function matchMoonVideoToPulledStory(
  upload: MoonUpload,
  stories: BoardStoryRecord[],
  scoreCache: Map<string, EvaluatedStoryState>
): Promise<MatchRow> {
  const transcriptExcerpt = await loadTranscriptExcerpt(upload.videoId);
  const plan = await deriveSearchQueries({
    title: upload.title,
    transcriptExcerpt,
  });

  const candidates = shortlistCandidates(stories, plan);
  const storyMap = new Map(stories.map((story) => [story.storyId, story]));
  const pick = await chooseBestBoardStory({
    title: upload.title,
    transcriptExcerpt,
    plan,
    candidates,
  });

  const selected =
    pick.selectedIndex !== null && pick.selectedIndex >= 0 && pick.selectedIndex < candidates.length
      ? candidates[pick.selectedIndex]
      : null;

  if (!selected) {
    return {
      videoTitle: upload.title,
      viewCount: upload.viewCount,
      playlistIndex: upload.playlistIndex,
      searchQuery: plan.searchQuery,
      secondaryQuery: plan.secondaryQuery,
      referenceHeadline: plan.referenceHeadline,
      triggerSummary: plan.triggerSummary,
      matchedStoryTitle: null,
      matchedHeadline: null,
      matchedSource: null,
      selectionConfidence: pick.confidence,
      finalScore: null,
      boardVisibilityScore: null,
      moonFitScore: null,
      controversyScore: null,
      explanation: pick.reason,
    };
  }

  if (!scoreCache.has(selected.storyId)) {
    const selectedStory = storyMap.get(selected.storyId);
    if (selectedStory) {
      scoreCache.set(selected.storyId, await evaluateStoryVisibility(selectedStory));
    }
  }

  const scored = scoreCache.get(selected.storyId);
  return {
    videoTitle: upload.title,
    viewCount: upload.viewCount,
    playlistIndex: upload.playlistIndex,
    searchQuery: plan.searchQuery,
    secondaryQuery: plan.secondaryQuery,
    referenceHeadline: plan.referenceHeadline,
    triggerSummary: plan.triggerSummary,
    matchedStoryTitle: selected.canonicalTitle,
    matchedHeadline: selected.matchedHeadline,
    matchedSource: selected.matchedSource,
    selectionConfidence: pick.confidence,
    finalScore: scored && Number.isFinite(scored.finalScore) ? scored.finalScore : null,
    boardVisibilityScore:
      scored && Number.isFinite(scored.boardVisibilityScore) ? scored.boardVisibilityScore : null,
    moonFitScore: scored && Number.isFinite(scored.moonFitScore) ? scored.moonFitScore : null,
    controversyScore:
      scored && Number.isFinite(scored.controversyScore) ? scored.controversyScore : null,
    explanation: pick.reason,
  };
}

function renderTable(rows: MatchRow[]) {
  return [
    "| Moon video | Pulled story | Matched headline | Final | Vis | Fit | Controv | Views |",
    "| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |",
    ...rows.map((row) =>
      `| ${escapeMarkdown(row.videoTitle)} | ${escapeMarkdown(row.matchedStoryTitle ?? "n/a")} | ${escapeMarkdown(row.matchedHeadline ?? "n/a")} | ${row.finalScore ?? "n/a"} | ${row.boardVisibilityScore ?? "n/a"} | ${row.moonFitScore ?? "n/a"} | ${row.controversyScore ?? "n/a"} | ${formatViews(row.viewCount)} |`
    ),
  ].join("\n");
}

async function main() {
  const args = parseArgs();
  const generatedAt = new Date().toISOString();

  const [uploads, stories] = await Promise.all([
    fetchRecentMoonUploads(args.moonCount, args.includeShorts),
    loadBoardStories(),
  ]);

  const scoreCache = new Map<string, EvaluatedStoryState>();
  const rows = await mapLimit(uploads, args.concurrency, async (upload, index) => {
    console.log(`[${index + 1}/${uploads.length}] ${upload.title}`);
    return matchMoonVideoToPulledStory(upload, stories, scoreCache);
  });

  const matched = rows.filter((row) => row.matchedStoryTitle && row.finalScore !== null);
  const unmatched = rows.filter((row) => !row.matchedStoryTitle);
  const vis60 = matched.filter((row) => (row.boardVisibilityScore ?? 0) >= 60);
  const vis45 = matched.filter((row) => (row.boardVisibilityScore ?? 0) >= 45);
  const below30 = matched.filter((row) => (row.boardVisibilityScore ?? 0) < 30);
  const highPerfThreshold = percentile(rows.map((row) => row.viewCount), 0.75) ?? 0;
  const highPerf = matched.filter((row) => row.viewCount >= highPerfThreshold);
  const highPerf60 = highPerf.filter((row) => (row.boardVisibilityScore ?? 0) >= 60);

  const falseNegatives = [...matched]
    .filter((row) => (row.boardVisibilityScore ?? 0) < 45)
    .sort(
      (a, b) =>
        b.viewCount - a.viewCount || (a.boardVisibilityScore ?? 0) - (b.boardVisibilityScore ?? 0)
    )
    .slice(0, 20);

  const report = [
    "# Trigger Headline Evaluation",
    "",
    `- Generated at: \`${generatedAt}\``,
    "- Eval mode: `matched only against real pulled board stories`",
    `- Moon upload sample: \`${rows.length}\` most recent uploads by playlist order${args.includeShorts ? " (shorts included)" : " (long-form only, 180s+)"}`,
    `- Board story pool: \`${stories.length}\` pulled stories`,
    `- Story matched: \`${matched.length}/${rows.length}\``,
    `- Model env: \`${MODEL}\``,
    "",
    "## Summary",
    "",
    `- Pulled stories with board visibility 60+: \`${vis60.length}/${matched.length}\` (${Math.round((vis60.length / Math.max(1, matched.length)) * 100)}%)`,
    `- Pulled stories with board visibility 45+: \`${vis45.length}/${matched.length}\` (${Math.round((vis45.length / Math.max(1, matched.length)) * 100)}%)`,
    `- Pulled stories with board visibility below 30: \`${below30.length}/${matched.length}\` (${Math.round((below30.length / Math.max(1, matched.length)) * 100)}%)`,
    `- High-performing Moon videos with board visibility 60+: \`${highPerf60.length}/${highPerf.length}\` (${Math.round((highPerf60.length / Math.max(1, highPerf.length)) * 100)}%)`,
    "",
    "## Top Matches",
    "",
    renderTable(
      [...matched]
        .sort((a, b) => b.viewCount - a.viewCount)
        .slice(0, 25)
    ),
    "",
    "## False Negatives",
    "",
    renderTable(falseNegatives),
    "",
    "## Unmatched Videos",
    "",
    ...unmatched.map((row) =>
      `- ${row.videoTitle}\n  query: \`${row.searchQuery}\`${row.secondaryQuery ? ` | alt: \`${row.secondaryQuery}\`` : ""}\n  reference headline: ${row.referenceHeadline}\n  summary: ${row.triggerSummary}\n  reason: ${row.explanation ?? "n/a"}`
    ),
    "",
  ].join("\n");

  const outputPath = path.resolve(
    process.cwd(),
    "research",
    `trigger-headline-eval-${generatedAt.slice(0, 10)}.md`
  );
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, report, "utf8");
  console.log(`\nWrote ${outputPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
