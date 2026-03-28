import { config as loadEnv } from "dotenv";
import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import OpenAI from "openai";
import { desc, eq, inArray } from "drizzle-orm";

import { assessBoardStory } from "../src/server/providers/openai";
import { getDb } from "../src/server/db/client";
import {
  clipLibrary,
  transcriptCache,
} from "../src/server/db/schema";
import { scoreTextAgainstMoonCorpus } from "../src/server/services/moon-corpus";
import { searchNewsStory } from "../src/server/services/board/news-search";

loadEnv({ path: path.resolve(process.cwd(), ".env") });
loadEnv({ path: path.resolve(process.cwd(), ".env.local"), override: true });

const execFileAsync = promisify(execFile);
const MOON_UPLOADS_PLAYLIST = "UUmFeOdJI3IXgTBDzqBLD8qg";
const YTDLP_BIN = path.resolve(process.cwd(), ".venv-ytdlp", "bin", "yt-dlp");
const MODEL = process.env.OPENAI_RESEARCH_MODEL ?? "gpt-4.1-mini";
const client = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

type MoonUpload = {
  videoId: string;
  title: string;
  durationSeconds: number;
  viewCount: number;
  playlistIndex: number;
};

type TriggerCandidate = {
  title: string;
  url: string;
  source: string;
  snippet: string;
  publishedAt: string | null;
};

type TriggerMatch = {
  videoTitle: string;
  viewCount: number;
  playlistIndex: number;
  searchQuery: string;
  secondaryQuery: string | null;
  referenceHeadline: string;
  triggerSummary: string;
  selectedTitle: string | null;
  selectedUrl: string | null;
  selectedSource: string | null;
  selectedPublishedAt: string | null;
  selectedSnippet: string | null;
  selectionConfidence: number;
  boardVisibilityScore: number | null;
  moonFitScore: number | null;
  controversyScore: number | null;
  analogMedianViews: number | null;
  analogTitles: string[];
  explanation: string | null;
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

function formatViews(value: number | null | undefined) {
  if (!value || value <= 0) return "n/a";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 100_000 ? 0 : 1)}K`;
  return String(value);
}

function escapeMarkdown(value: string) {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ");
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

  const idsNeedingViews = selectedRows
    .filter((row) => row.viewCount <= 0)
    .map((row) => row.videoId);

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

  const viewCounts = new Map(
    libraryRows.map((row) => [row.externalId, row.viewCount ?? 0])
  );

  return selectedRows.map((row) => ({
    ...row,
    viewCount: row.viewCount > 0 ? row.viewCount : viewCounts.get(row.videoId) ?? 0,
  }));
}

async function loadTranscriptExcerpt(videoId: string) {
  const db = getDb();
  const row = await db
    .select({
      title: clipLibrary.title,
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

  return JSON.parse(response.output_text) as {
    searchQuery: string;
    secondaryQuery: string | null;
    referenceHeadline: string;
    triggerSummary: string;
  };
}

async function chooseBestCandidate(input: {
  title: string;
  transcriptExcerpt: string;
  referenceHeadline: string;
  triggerSummary: string;
  candidates: TriggerCandidate[];
}): Promise<{
  selectedIndex: number | null;
  confidence: number;
  reason: string;
}> {
  if (!client || input.candidates.length === 0) {
    return { selectedIndex: null, confidence: 0, reason: "No candidates or model unavailable." };
  }

  const response = await client.responses.create({
    model: MODEL,
    input: [
      {
        role: "system",
        content: `You pick the article headline that most plausibly triggered a Moon video.

Return JSON with:
- selectedIndex: zero-based index of the best candidate, or null if none are a good match
- confidence: 0-100
- reason: one short sentence

Rules:
- Prefer a concrete reported event, reveal, backlash, controversy, lawsuit, interview blowup, or business failure over generic commentary.
- Reject explainers, timelines, "what has X said" roundups, reviews, shopping, quizzes, opinion essays, and broad adjacent topic coverage if they do not look like the actual hook.
- If multiple candidates fit, choose the one most likely to spark the Moon video's angle.
- For thesis-style videos, choose the headline that best represents the real-world trigger, not the video's final rhetorical framing.
- The candidate should feel close to the reference headline and trigger summary, not just loosely about the same person or topic.
- If the candidate set is junk, return null.`,
      },
      {
        role: "user",
        content: [
          `Moon video title: ${input.title}`,
          `Reference article headline: ${input.referenceHeadline}`,
          `Likely trigger summary: ${input.triggerSummary}`,
          input.transcriptExcerpt
            ? `Transcript excerpt: ${input.transcriptExcerpt}`
            : "Transcript excerpt: unavailable",
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

async function findTriggerHeadline(upload: MoonUpload): Promise<TriggerMatch> {
  const transcriptExcerpt = await loadTranscriptExcerpt(upload.videoId);
  const queryPlan = await deriveSearchQueries({
    title: upload.title,
    transcriptExcerpt,
  });

  const [primaryResults, secondaryResults, referenceResults] = await Promise.all([
    searchNewsStory(queryPlan.searchQuery, "full"),
    queryPlan.secondaryQuery ? searchNewsStory(queryPlan.secondaryQuery, "full") : Promise.resolve([]),
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
    title: upload.title,
    transcriptExcerpt,
    referenceHeadline: queryPlan.referenceHeadline,
    triggerSummary: queryPlan.triggerSummary,
    candidates: mergedCandidates,
  });

  const selected =
    pick.selectedIndex !== null && pick.selectedIndex >= 0 && pick.selectedIndex < mergedCandidates.length
      ? mergedCandidates[pick.selectedIndex]
      : null;

  if (!selected) {
    return {
      videoTitle: upload.title,
      viewCount: upload.viewCount,
      playlistIndex: upload.playlistIndex,
      searchQuery: queryPlan.searchQuery,
      secondaryQuery: queryPlan.secondaryQuery,
      referenceHeadline: queryPlan.referenceHeadline,
      triggerSummary: queryPlan.triggerSummary,
      selectedTitle: null,
      selectedUrl: null,
      selectedSource: null,
      selectedPublishedAt: null,
      selectedSnippet: null,
      selectionConfidence: pick.confidence,
      boardVisibilityScore: null,
      moonFitScore: null,
      controversyScore: null,
      analogMedianViews: null,
      analogTitles: [],
      explanation: pick.reason,
    };
  }

  const moon = await scoreTextAgainstMoonCorpus({
    title: selected.title,
    text: selected.snippet,
  });

  const assessment = await assessBoardStory({
    canonicalTitle: selected.title,
    vertical: moon.clusterLabel,
    currentStoryType: "normal",
    lastSeenAt: selected.publishedAt,
    itemsCount: 1,
    sourcesCount: 1,
    observedControversyScore: null,
    attentionSignals: {
      hasXDiscourse: false,
      hasYouTubePickup: false,
      hasRedditPickup: selected.source === "reddit",
      hasMultipleSources: false,
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
        sourceName: selected.source,
        sourceKind: "rss",
        title: selected.title,
        summary: selected.snippet,
        publishedAt: selected.publishedAt,
      },
    ],
  });

  return {
    videoTitle: upload.title,
    viewCount: upload.viewCount,
    playlistIndex: upload.playlistIndex,
    searchQuery: queryPlan.searchQuery,
    secondaryQuery: queryPlan.secondaryQuery,
    referenceHeadline: queryPlan.referenceHeadline,
    triggerSummary: queryPlan.triggerSummary,
    selectedTitle: selected.title,
    selectedUrl: selected.url,
    selectedSource: selected.source,
    selectedPublishedAt: selected.publishedAt,
    selectedSnippet: selected.snippet,
    selectionConfidence: pick.confidence,
    boardVisibilityScore: assessment.boardVisibilityScore,
    moonFitScore: assessment.moonFitScore,
    controversyScore: assessment.controversyScore,
    analogMedianViews: moon.analogMedianViews,
    analogTitles: moon.analogs.slice(0, 3).map((analog) => analog.title),
    explanation: assessment.explanation,
  };
}

function renderTable(rows: TriggerMatch[]) {
  return [
    "| Moon video | Trigger headline | Vis | Fit | Controv | Views | Source | Analog median |",
    "| --- | --- | ---: | ---: | ---: | ---: | --- | ---: |",
    ...rows.map((row) =>
      `| ${escapeMarkdown(row.videoTitle)} | ${escapeMarkdown(row.selectedTitle ?? "n/a")} | ${row.boardVisibilityScore ?? "n/a"} | ${row.moonFitScore ?? "n/a"} | ${row.controversyScore ?? "n/a"} | ${formatViews(row.viewCount)} | ${escapeMarkdown(row.selectedSource ?? "n/a")} | ${formatViews(row.analogMedianViews)} |`
    ),
  ].join("\n");
}

async function main() {
  const args = parseArgs();
  const generatedAt = new Date().toISOString();

  const uploads = await fetchRecentMoonUploads(args.moonCount, args.includeShorts);
  const rows = await mapLimit(uploads, args.concurrency, async (upload, index) => {
    console.log(`[${index + 1}/${uploads.length}] ${upload.title}`);
    return findTriggerHeadline(upload);
  });

  const matched = rows.filter((row) => row.selectedTitle && row.boardVisibilityScore !== null);
  const missed = rows.filter((row) => !row.selectedTitle);
  const vis60 = matched.filter((row) => (row.boardVisibilityScore ?? 0) >= 60);
  const vis45 = matched.filter((row) => (row.boardVisibilityScore ?? 0) >= 45);
  const vis30 = matched.filter((row) => (row.boardVisibilityScore ?? 0) < 30);
  const highPerfThreshold = percentile(rows.map((row) => row.viewCount), 0.75) ?? 0;
  const highPerf = matched.filter((row) => row.viewCount >= highPerfThreshold);
  const highPerf60 = highPerf.filter((row) => (row.boardVisibilityScore ?? 0) >= 60);

  const falseNegatives = [...matched]
    .filter((row) => (row.boardVisibilityScore ?? 0) < 45)
    .sort((a, b) => b.viewCount - a.viewCount || (a.boardVisibilityScore ?? 0) - (b.boardVisibilityScore ?? 0))
    .slice(0, 20);

  const report = [
    "# Trigger Headline Evaluation",
    "",
    `- Generated at: \`${generatedAt}\``,
    `- Moon upload sample: \`${rows.length}\` most recent uploads by playlist order${args.includeShorts ? " (shorts included)" : " (long-form only, 180s+)"}`,
    `- Trigger article matched: \`${matched.length}/${rows.length}\``,
    `- Model env: \`${MODEL}\``,
    "",
    "## Summary",
    "",
    `- Trigger headlines accepted at 60+: \`${vis60.length}/${matched.length}\` (${Math.round((vis60.length / Math.max(1, matched.length)) * 100)}%)`,
    `- Trigger headlines accepted at 45+: \`${vis45.length}/${matched.length}\` (${Math.round((vis45.length / Math.max(1, matched.length)) * 100)}%)`,
    `- Trigger headlines rejected below 30: \`${vis30.length}/${matched.length}\` (${Math.round((vis30.length / Math.max(1, matched.length)) * 100)}%)`,
    `- High-performing Moon videos accepted at 60+ using trigger headlines: \`${highPerf60.length}/${highPerf.length}\` (${Math.round((highPerf60.length / Math.max(1, highPerf.length)) * 100)}%)`,
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
    ...missed.map((row) =>
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
  process.exit(1);
});
