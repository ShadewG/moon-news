import { config as loadEnv } from "dotenv";
import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { desc, eq, gte, sql } from "drizzle-orm";

import { assessBoardStory } from "../src/server/providers/openai";
import { getDb } from "../src/server/db/client";
import {
  boardFeedItems,
  boardSources,
  boardStoryCandidates,
  boardStorySources,
} from "../src/server/db/schema";
import { scoreTextAgainstMoonCorpus } from "../src/server/services/moon-corpus";

loadEnv({ path: path.resolve(process.cwd(), ".env") });
loadEnv({ path: path.resolve(process.cwd(), ".env.local"), override: true });

const execFileAsync = promisify(execFile);
const MOON_UPLOADS_PLAYLIST = "UUmFeOdJI3IXgTBDzqBLD8qg";
const YTDLP_BIN = path.resolve(process.cwd(), ".venv-ytdlp", "bin", "yt-dlp");

type MoonUpload = {
  videoId: string;
  title: string;
  durationSeconds: number;
  viewCount: number;
  playlistIndex: number;
};

type PromptAssessmentRow = {
  kind: "moon_upload" | "board_story";
  title: string;
  boardVisibilityScore: number;
  moonFitScore: number;
  controversyScore: number;
  confidence: number;
  suggestedStoryType: string;
  explanation: string;
  analogMedianViews: number | null;
  analogTitles: string[];
  viewCount?: number;
  playlistIndex?: number;
  storyId?: string;
  sourcesCount?: number;
  itemsCount?: number;
};

function parseArgs() {
  const arg = (name: string, fallback: string) =>
    process.argv.find((entry) => entry.startsWith(`${name}=`))?.slice(name.length + 1) ?? fallback;

  return {
    moonCount: Math.max(10, Math.min(160, Number(arg("--moon-count", "90")) || 90)),
    boardCount: Math.max(20, Math.min(240, Number(arg("--board-count", "120")) || 120)),
    hours: Math.max(24, Math.min(240, Number(arg("--hours", "72")) || 72)),
    concurrency: Math.max(1, Math.min(8, Number(arg("--concurrency", "4")) || 4)),
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
      if (currentIndex >= values.length) {
        return;
      }

      results[currentIndex] = await mapper(values[currentIndex], currentIndex);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, () => worker()));
  return results;
}

async function fetchRecentMoonUploads(count: number, includeShorts: boolean): Promise<MoonUpload[]> {
  const { stdout } = await execFileAsync(
    YTDLP_BIN,
    [
      "--flat-playlist",
      "--playlist-end",
      String(Math.max(count * 2, count + 20)),
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

  const rawRows = stdout
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

  const filtered = includeShorts
    ? rawRows
    : rawRows.filter((row) => row.durationSeconds >= 180);

  return filtered.slice(0, count);
}

async function fetchRandomBoardStories(count: number, hours: number) {
  const db = getDb();
  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);

  const stories = await db
    .select({
      id: boardStoryCandidates.id,
      canonicalTitle: boardStoryCandidates.canonicalTitle,
      vertical: boardStoryCandidates.vertical,
      storyType: boardStoryCandidates.storyType,
      lastSeenAt: boardStoryCandidates.lastSeenAt,
      itemsCount: boardStoryCandidates.itemsCount,
      sourcesCount: boardStoryCandidates.sourcesCount,
    })
    .from(boardStoryCandidates)
    .where(gte(boardStoryCandidates.lastSeenAt, cutoff))
    .orderBy(sql`md5(${boardStoryCandidates.id}::text)`)
    .limit(count);

  return Promise.all(
    stories.map(async (story) => {
      const feedItems = await db
        .select({
          sourceName: boardSources.name,
          sourceKind: boardSources.kind,
          title: boardFeedItems.title,
          summary: boardFeedItems.summary,
          publishedAt: boardFeedItems.publishedAt,
        })
        .from(boardStorySources)
        .innerJoin(boardFeedItems, eq(boardStorySources.feedItemId, boardFeedItems.id))
        .innerJoin(boardSources, eq(boardFeedItems.sourceId, boardSources.id))
        .where(eq(boardStorySources.storyId, story.id))
        .orderBy(desc(boardFeedItems.publishedAt))
        .limit(6);

      return {
        ...story,
        feedItems,
      };
    })
  );
}

async function evaluateMoonUploads(
  uploads: MoonUpload[],
  concurrency: number
): Promise<PromptAssessmentRow[]> {
  return mapLimit(uploads, concurrency, async (upload, index) => {
    console.log(`[moon ${index + 1}/${uploads.length}] ${upload.title}`);
    const moon = await scoreTextAgainstMoonCorpus({ title: upload.title });
    const assessment = await assessBoardStory({
      canonicalTitle: upload.title,
      vertical: moon.clusterLabel,
      currentStoryType: "normal",
      lastSeenAt: null,
      itemsCount: 1,
      sourcesCount: 1,
      observedControversyScore: 0,
      attentionSignals: {
        hasXDiscourse: false,
        hasYouTubePickup: true,
        hasRedditPickup: false,
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
          sourceName: "Moon YouTube",
          sourceKind: "youtube_channel",
          title: upload.title,
          summary: null,
          publishedAt: null,
        },
      ],
    });

    return {
      kind: "moon_upload",
      title: upload.title,
      boardVisibilityScore: assessment.boardVisibilityScore,
      moonFitScore: assessment.moonFitScore,
      controversyScore: assessment.controversyScore,
      confidence: assessment.confidence,
      suggestedStoryType: assessment.suggestedStoryType,
      explanation: assessment.explanation,
      analogMedianViews: moon.analogMedianViews,
      analogTitles: moon.analogs.slice(0, 3).map((analog) => analog.title),
      viewCount: upload.viewCount,
      playlistIndex: upload.playlistIndex,
    };
  });
}

async function evaluateBoardStories(
  stories: Awaited<ReturnType<typeof fetchRandomBoardStories>>,
  concurrency: number
): Promise<PromptAssessmentRow[]> {
  return mapLimit(stories, concurrency, async (story, index) => {
    console.log(`[board ${index + 1}/${stories.length}] ${story.canonicalTitle}`);
    const moon = await scoreTextAgainstMoonCorpus({
      title: story.canonicalTitle,
      text: story.feedItems
        .flatMap((item) => [item.title, item.summary ?? ""])
        .filter(Boolean)
        .join("\n\n"),
    });
    const assessment = await assessBoardStory({
      canonicalTitle: story.canonicalTitle,
      vertical: story.vertical,
      currentStoryType: story.storyType,
      lastSeenAt: story.lastSeenAt?.toISOString() ?? null,
      itemsCount: story.itemsCount,
      sourcesCount: story.sourcesCount,
      observedControversyScore: null,
      attentionSignals: {
        hasXDiscourse: story.feedItems.some((item) => item.sourceKind === "x_account"),
        hasYouTubePickup: story.feedItems.some((item) => item.sourceKind === "youtube_channel"),
        hasRedditPickup: story.feedItems.some((item) =>
          item.sourceName.toLowerCase().includes("reddit")
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
      sources: story.feedItems.map((item) => ({
        sourceName: item.sourceName,
        sourceKind: item.sourceKind,
        title: item.title,
        summary: item.summary,
        publishedAt: item.publishedAt?.toISOString() ?? null,
      })),
    });

    return {
      kind: "board_story",
      title: story.canonicalTitle,
      boardVisibilityScore: assessment.boardVisibilityScore,
      moonFitScore: assessment.moonFitScore,
      controversyScore: assessment.controversyScore,
      confidence: assessment.confidence,
      suggestedStoryType: assessment.suggestedStoryType,
      explanation: assessment.explanation,
      analogMedianViews: moon.analogMedianViews,
      analogTitles: moon.analogs.slice(0, 3).map((analog) => analog.title),
      storyId: story.id,
      sourcesCount: story.sourcesCount,
      itemsCount: story.itemsCount,
    };
  });
}

function buildSummary(rows: PromptAssessmentRow[]) {
  const vis = rows.map((row) => row.boardVisibilityScore);
  const fit = rows.map((row) => row.moonFitScore);
  return {
    count: rows.length,
    avgVisibility: Math.round(vis.reduce((sum, value) => sum + value, 0) / Math.max(1, vis.length)),
    avgMoonFit: Math.round(fit.reduce((sum, value) => sum + value, 0) / Math.max(1, fit.length)),
    accepted60: rows.filter((row) => row.boardVisibilityScore >= 60).length,
    accepted45: rows.filter((row) => row.boardVisibilityScore >= 45).length,
    rejected30: rows.filter((row) => row.boardVisibilityScore < 30).length,
    rejected45: rows.filter((row) => row.boardVisibilityScore < 45).length,
    p25: percentile(vis, 0.25),
    p50: percentile(vis, 0.5),
    p75: percentile(vis, 0.75),
  };
}

function renderTable(rows: PromptAssessmentRow[], extraColumn?: "views" | "sources") {
  const header =
    extraColumn === "views"
      ? "| Title | Vis | Fit | Controv | Views | Analog median | Top analogs |"
      : extraColumn === "sources"
        ? "| Title | Vis | Fit | Controv | Sources/Items | Analog median | Top analogs |"
        : "| Title | Vis | Fit | Controv | Analog median | Top analogs |";

  const separator =
    extraColumn === "views"
      ? "| --- | ---: | ---: | ---: | ---: | ---: | --- |"
      : extraColumn === "sources"
        ? "| --- | ---: | ---: | ---: | --- | ---: | --- |"
        : "| --- | ---: | ---: | ---: | ---: | --- |";

  const body = rows.map((row) => {
    const base = [
      escapeMarkdown(row.title),
      row.boardVisibilityScore,
      row.moonFitScore,
      row.controversyScore,
    ];

    if (extraColumn === "views") {
      base.push(formatViews(row.viewCount));
    } else if (extraColumn === "sources") {
      base.push(`${row.sourcesCount ?? 0}/${row.itemsCount ?? 0}`);
    }

    base.push(formatViews(row.analogMedianViews));
    base.push(escapeMarkdown(row.analogTitles.join(" | ") || "n/a"));
    return `| ${base.join(" | ")} |`;
  });

  return [header, separator, ...body].join("\n");
}

async function main() {
  const args = parseArgs();
  const timestamp = new Date().toISOString();

  const [moonUploads, boardStories] = await Promise.all([
    fetchRecentMoonUploads(args.moonCount, args.includeShorts),
    fetchRandomBoardStories(args.boardCount, args.hours),
  ]);

  const [moonRows, boardRows] = await Promise.all([
    evaluateMoonUploads(moonUploads, args.concurrency),
    evaluateBoardStories(boardStories, args.concurrency),
  ]);

  const moonSummary = buildSummary(moonRows);
  const boardSummary = buildSummary(boardRows);

  const bestMoonRows = [...moonRows].sort((a, b) => (b.viewCount ?? 0) - (a.viewCount ?? 0));
  const highPerformingMoon = bestMoonRows.filter(
    (row) => (row.viewCount ?? 0) >= (percentile(bestMoonRows.map((entry) => entry.viewCount ?? 0), 0.75) ?? 0)
  );
  const highPerformingAccepted = highPerformingMoon.filter((row) => row.boardVisibilityScore >= 60).length;

  const moonFalseNegatives = [...moonRows]
    .sort((a, b) => (b.viewCount ?? 0) - (a.viewCount ?? 0) || a.boardVisibilityScore - b.boardVisibilityScore)
    .filter((row) => row.boardVisibilityScore < 45)
    .slice(0, 20);

  const boardFalsePositives = [...boardRows]
    .sort((a, b) => b.boardVisibilityScore - a.boardVisibilityScore || b.moonFitScore - a.moonFitScore)
    .filter((row) => row.boardVisibilityScore >= 60)
    .slice(0, 25);

  const boardCleanRejects = [...boardRows]
    .sort((a, b) => a.boardVisibilityScore - b.boardVisibilityScore)
    .slice(0, 20);

  const report = [
    "# Board Prompt Evaluation",
    "",
    `- Generated at: \`${timestamp}\``,
    `- Moon upload sample: \`${moonRows.length}\` most recent uploads by playlist order${args.includeShorts ? " (shorts included)" : " (long-form only, 180s+)"} ` +
      "`via Moon uploads playlist`",
    `- Board story sample: \`${boardRows.length}\` random stories from the last \`${args.hours}\` hours`,
    `- Model env: \`${process.env.OPENAI_RESEARCH_MODEL ?? "gpt-4.1-mini"}\``,
    "",
    "## Summary",
    "",
    `- Moon uploads accepted at 60+: \`${moonSummary.accepted60}/${moonSummary.count}\` (${Math.round((moonSummary.accepted60 / Math.max(1, moonSummary.count)) * 100)}%)`,
    `- Moon uploads accepted at 45+: \`${moonSummary.accepted45}/${moonSummary.count}\` (${Math.round((moonSummary.accepted45 / Math.max(1, moonSummary.count)) * 100)}%)`,
    `- Moon uploads rejected below 30: \`${moonSummary.rejected30}/${moonSummary.count}\` (${Math.round((moonSummary.rejected30 / Math.max(1, moonSummary.count)) * 100)}%)`,
    `- High-performing Moon uploads accepted at 60+: \`${highPerformingAccepted}/${highPerformingMoon.length}\` (${Math.round((highPerformingAccepted / Math.max(1, highPerformingMoon.length)) * 100)}%)`,
    `- Random board stories rejected below 30: \`${boardSummary.rejected30}/${boardSummary.count}\` (${Math.round((boardSummary.rejected30 / Math.max(1, boardSummary.count)) * 100)}%)`,
    `- Random board stories rejected below 45: \`${boardSummary.rejected45}/${boardSummary.count}\` (${Math.round((boardSummary.rejected45 / Math.max(1, boardSummary.count)) * 100)}%)`,
    `- Random board stories accepted at 60+: \`${boardSummary.accepted60}/${boardSummary.count}\` (${Math.round((boardSummary.accepted60 / Math.max(1, boardSummary.count)) * 100)}%)`,
    `- Moon visibility quartiles: \`${moonSummary.p25 ?? "n/a"} / ${moonSummary.p50 ?? "n/a"} / ${moonSummary.p75 ?? "n/a"}\``,
    `- Board visibility quartiles: \`${boardSummary.p25 ?? "n/a"} / ${boardSummary.p50 ?? "n/a"} / ${boardSummary.p75 ?? "n/a"}\``,
    "",
    "## High-Performing Moon Uploads",
    "",
    renderTable(bestMoonRows.slice(0, 25), "views"),
    "",
    "## Moon False Negatives",
    "",
    renderTable(moonFalseNegatives, "views"),
    "",
    "## Board False Positives",
    "",
    renderTable(boardFalsePositives, "sources"),
    "",
    "## Clean Board Rejects",
    "",
    renderTable(boardCleanRejects, "sources"),
    "",
  ].join("\n");

  const outputPath = path.resolve(
    process.cwd(),
    "research",
    `board-prompt-eval-${timestamp.slice(0, 10)}.md`
  );

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, report, "utf8");
  console.log(`\nWrote ${outputPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
