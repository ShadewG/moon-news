import "server-only";

import { getEnv } from "@/server/config/env";
import { ingestLocalMediaArtifacts } from "@/server/providers/local-media";
import {
  ensureYouTubeTranscript,
  type ClipTranscriptSegment,
  upsertClipInLibrary,
} from "@/server/services/clip-library";
import { scoreTextAgainstMoonCorpus } from "@/server/services/moon-corpus";

interface IdeationLocalVideoRecord {
  youtube_video_id: string;
  title: string;
  published_at: string | null;
  duration_seconds: number | null;
  views: number | null;
  estimated_watch_hours: number | null;
  estimated_minutes_watched: number | null;
  average_view_duration_seconds: number | null;
  average_view_percentage: number | null;
  source_url: string | null;
  thumbnail_url: string | null;
  imported_at: string | null;
}

interface IdeationLocalVideosResponse {
  videos: IdeationLocalVideoRecord[];
}

interface IdeationRetentionPoint {
  elapsed_ratio: number;
  audience_watch_ratio: number;
  relative_retention_performance: number;
}

interface IdeationRetentionResponse {
  checkpoints: IdeationRetentionPoint[];
}

interface RetentionCheckpointSummary {
  label: string;
  audienceWatchRatio: number;
  relativeRetentionPerformance: number;
}

interface RetentionRangeSummary {
  label: string;
  averageWatchRatio: number;
  averageRelativeRetention: number;
}

interface VideoRetentionSummary {
  checkpoints: RetentionCheckpointSummary[];
  zoneAverages: RetentionRangeSummary[];
}

interface TranscriptWindowSummary {
  label: string;
  excerpt: string;
  wordCount: number;
}

interface TranscriptSummary {
  source: "youtube_captions" | "whisper_fallback" | "missing";
  wordCount: number;
  introExcerpt: string;
  windows: TranscriptWindowSummary[];
}

interface RetentionGuideRow {
  youtubeVideoId: string;
  title: string;
  coverageMode: string | null;
  clusterLabel: string | null;
  averageViewPercentage: number;
  retention25: number;
  retention50: number;
  finishRelative: number;
  compositeScore: number;
  transcript: TranscriptSummary;
}

export interface MoonRetentionPatternGuide {
  generatedAt: string;
  preferredCoverageMode: string | null;
  sampleSize: number;
  topCoverageModes: string[];
  hookLeaders: RetentionGuideRow[];
  middleLeaders: RetentionGuideRow[];
  finishLeaders: RetentionGuideRow[];
  hookRisks: RetentionGuideRow[];
  middleRisks: RetentionGuideRow[];
  directives: string[];
}

const GUIDE_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const RECENT_LOOKBACK_DAYS = 120;
const RECENT_VIDEO_LIMIT = 20;
const MAX_FOCUS_VIDEOS = 10;
const TERM_STOPWORDS = new Set([
  "about",
  "after",
  "again",
  "against",
  "also",
  "because",
  "being",
  "between",
  "could",
  "every",
  "from",
  "have",
  "into",
  "just",
  "like",
  "make",
  "more",
  "most",
  "never",
  "really",
  "said",
  "some",
  "still",
  "than",
  "that",
  "their",
  "them",
  "then",
  "there",
  "these",
  "they",
  "this",
  "through",
  "video",
  "watch",
  "with",
  "would",
  "youtube",
  "your",
  "the",
  "and",
  "for",
  "are",
  "was",
  "were",
  "you",
  "not",
  "but",
  "has",
  "had",
  "its",
  "his",
  "her",
  "she",
  "him",
  "our",
  "out",
  "what",
  "when",
  "where",
  "who",
  "why",
  "how",
  "can",
  "did",
  "does",
  "dont",
  "cant",
  "wont",
  "too",
  "now",
  "one",
  "two",
  "three",
]);

let cachedRows:
  | {
      expiresAt: number;
      generatedAt: string;
      rows: RetentionGuideRow[];
    }
  | null = null;
let inflightRowsPromise: Promise<{
  generatedAt: string;
  rows: RetentionGuideRow[];
}> | null = null;

function todayUtcDate() {
  return new Date().toISOString().slice(0, 10);
}

function parseUtcDate(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

function addDays(value: string, days: number) {
  const date = parseUtcDate(value);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function round(value: number, digits = 3) {
  return Number(value.toFixed(digits));
}

function average(values: number[]) {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((total, value) => total + value, 0) / values.length;
}

function truncateText(value: string, maxChars: number) {
  if (value.length <= maxChars) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`;
}

function cleanTranscriptText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function titleCase(value: string) {
  return value
    .replace(/[_-]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function formatCoverageMode(value: string | null) {
  return value ? titleCase(value) : null;
}

async function fetchIdeationJson<T>(
  pathname: string,
  searchParams: Record<string, string | number | boolean | undefined> = {}
) {
  const url = new URL(pathname, getEnv().IDEATION_BACKEND_URL);
  for (const [key, rawValue] of Object.entries(searchParams)) {
    if (rawValue === undefined) {
      continue;
    }
    url.searchParams.set(key, String(rawValue));
  }

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Accept: "application/json",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Ideation backend request failed (${response.status}) for ${url.pathname}: ${text.slice(0, 240)}`
    );
  }

  return (await response.json()) as T;
}

async function fetchLocalVideos(args: {
  startDate: string;
  endDate: string;
  limit?: number;
}) {
  const response = await fetchIdeationJson<IdeationLocalVideosResponse>(
    "/youtube-analytics/local-videos",
    {
      start_date: args.startDate,
      end_date: args.endDate,
      include_shorts: false,
      sort: "published_desc",
      limit: args.limit ?? RECENT_VIDEO_LIMIT,
    }
  );

  return response.videos ?? [];
}

async function fetchVideoRetention(youtubeVideoId: string) {
  try {
    const response = await fetchIdeationJson<IdeationRetentionResponse>(
      `/youtube-analytics/video-retention/${youtubeVideoId}`
    );
    return response.checkpoints ?? [];
  } catch (error) {
    console.error("[moon-retention-guide] retention fetch failed", youtubeVideoId, error);
    return [];
  }
}

function extractTranscriptText(
  segments: ClipTranscriptSegment[],
  startMs: number,
  endMs: number
) {
  const text = segments
    .filter((segment) => {
      const segmentEndMs = segment.startMs + Math.max(segment.durationMs, 1000);
      return segment.startMs < endMs && segmentEndMs > startMs;
    })
    .map((segment) => segment.text)
    .join(" ");

  return cleanTranscriptText(text);
}

function buildTranscriptSummary(
  segments: ClipTranscriptSegment[],
  durationSeconds: number,
  source: TranscriptSummary["source"]
): TranscriptSummary {
  const fullText = cleanTranscriptText(segments.map((segment) => segment.text).join(" "));
  const durationMs =
    durationSeconds > 0
      ? durationSeconds * 1000
      : Math.max(
          segments.reduce(
            (maxValue, segment) =>
              Math.max(maxValue, segment.startMs + Math.max(segment.durationMs, 1000)),
            0
          ),
          1
        );

  const windows = [
    { label: "Hook 0-10%", startRatio: 0, endRatio: 0.1 },
    { label: "Build 25-50%", startRatio: 0.25, endRatio: 0.5 },
    { label: "Middle 50-75%", startRatio: 0.5, endRatio: 0.75 },
    { label: "Payoff 75-100%", startRatio: 0.75, endRatio: 1 },
  ].map((window) => {
    const startMs = Math.floor(durationMs * window.startRatio);
    const endMs = Math.floor(durationMs * window.endRatio);
    const text = extractTranscriptText(segments, startMs, endMs);
    return {
      label: window.label,
      excerpt: truncateText(text, 320),
      wordCount: text.split(/\s+/).filter(Boolean).length,
    };
  });

  const introText = extractTranscriptText(segments, 0, Math.min(durationMs, 90_000));
  return {
    source,
    wordCount: fullText.split(/\s+/).filter(Boolean).length,
    introExcerpt: truncateText(introText, 420),
    windows,
  };
}

function closestRetentionPoint(points: IdeationRetentionPoint[], targetRatio: number) {
  if (points.length === 0) {
    return null;
  }

  return points.reduce((best, point) => {
    if (!best) {
      return point;
    }

    const currentDistance = Math.abs(point.elapsed_ratio - targetRatio);
    const bestDistance = Math.abs(best.elapsed_ratio - targetRatio);
    return currentDistance < bestDistance ? point : best;
  }, null as IdeationRetentionPoint | null);
}

function averageRetentionRange(
  points: IdeationRetentionPoint[],
  startRatio: number,
  endRatio: number
) {
  const windowPoints = points.filter(
    (point) => point.elapsed_ratio >= startRatio && point.elapsed_ratio <= endRatio
  );

  if (windowPoints.length === 0) {
    return {
      averageWatchRatio: 0,
      averageRelativeRetention: 0,
    };
  }

  return {
    averageWatchRatio: round(
      average(windowPoints.map((point) => point.audience_watch_ratio)),
      4
    ),
    averageRelativeRetention: round(
      average(windowPoints.map((point) => point.relative_retention_performance)),
      4
    ),
  };
}

function buildRetentionSummary(points: IdeationRetentionPoint[]): VideoRetentionSummary | null {
  if (points.length === 0) {
    return null;
  }

  const checkpoints = [
    { label: "25%", ratio: 0.25 },
    { label: "50%", ratio: 0.5 },
    { label: "100%", ratio: 1 },
  ]
    .map((checkpoint) => {
      const point = closestRetentionPoint(points, checkpoint.ratio);
      if (!point) {
        return null;
      }

      return {
        label: checkpoint.label,
        audienceWatchRatio: round(point.audience_watch_ratio, 4),
        relativeRetentionPerformance: round(point.relative_retention_performance, 4),
      };
    })
    .filter(
      (
        checkpoint
      ): checkpoint is RetentionCheckpointSummary => Boolean(checkpoint)
    );

  const zoneAverages = [
    { label: "Hook 0-10%", startRatio: 0, endRatio: 0.1 },
    { label: "Body 25-50%", startRatio: 0.25, endRatio: 0.5 },
    { label: "Second Half 50-75%", startRatio: 0.5, endRatio: 0.75 },
    { label: "Finish 75-100%", startRatio: 0.75, endRatio: 1 },
  ].map((window) => {
    const averages = averageRetentionRange(points, window.startRatio, window.endRatio);
    return {
      label: window.label,
      averageWatchRatio: averages.averageWatchRatio,
      averageRelativeRetention: averages.averageRelativeRetention,
    };
  });

  return {
    checkpoints,
    zoneAverages,
  };
}

function getAverageViewPercentage(video: IdeationLocalVideoRecord) {
  if (
    typeof video.average_view_percentage === "number" &&
    Number.isFinite(video.average_view_percentage)
  ) {
    return video.average_view_percentage;
  }

  if (
    typeof video.average_view_duration_seconds === "number" &&
    typeof video.duration_seconds === "number" &&
    video.duration_seconds > 0
  ) {
    return (video.average_view_duration_seconds / video.duration_seconds) * 100;
  }

  return 0;
}

async function loadTranscriptSummary(video: IdeationLocalVideoRecord): Promise<TranscriptSummary> {
  const sourceUrl =
    video.source_url ?? `https://www.youtube.com/watch?v=${video.youtube_video_id}`;
  const clipId = await upsertClipInLibrary({
    provider: "youtube",
    externalId: video.youtube_video_id,
    title: video.title,
    sourceUrl,
    previewUrl: video.thumbnail_url,
    channelOrContributor: "Moon",
    durationMs:
      typeof video.duration_seconds === "number" && video.duration_seconds > 0
        ? video.duration_seconds * 1000
        : null,
    viewCount: video.views,
    uploadDate: video.published_at?.slice(0, 10) ?? null,
    metadataJson: {
      thumbnailUrl: video.thumbnail_url,
      importedAt: video.imported_at,
    },
  });

  let transcript = await ensureYouTubeTranscript(clipId, video.youtube_video_id);
  let source: TranscriptSummary["source"] = transcript?.length ? "youtube_captions" : "missing";

  if ((!transcript || transcript.length === 0) && sourceUrl) {
    const localMedia = await ingestLocalMediaArtifacts({
      sourceUrl,
      providerName: "youtube",
      title: video.title,
    });

    if (localMedia?.transcript?.length) {
      transcript = localMedia.transcript;
      source = "whisper_fallback";
    }
  }

  return buildTranscriptSummary(
    transcript ?? [],
    Math.max(0, video.duration_seconds ?? 0),
    source
  );
}

function pickFocusVideos(
  stubs: Array<{
    video: IdeationLocalVideoRecord;
    retention: VideoRetentionSummary;
    averageViewPercentage: number;
    retention25: number;
    retention50: number;
    finishRelative: number;
    compositeScore: number;
  }>
) {
  const ids = new Set<string>();
  const focus: IdeationLocalVideoRecord[] = [];

  const include = (
    items: Array<{
      video: IdeationLocalVideoRecord;
    }>
  ) => {
    for (const item of items) {
      if (focus.length >= MAX_FOCUS_VIDEOS || ids.has(item.video.youtube_video_id)) {
        continue;
      }

      ids.add(item.video.youtube_video_id);
      focus.push(item.video);
    }
  };

  include([...stubs].sort((left, right) => right.compositeScore - left.compositeScore).slice(0, 6));
  include([...stubs].sort((left, right) => right.retention25 - left.retention25).slice(0, 3));
  include([...stubs].sort((left, right) => right.retention50 - left.retention50).slice(0, 3));
  include([...stubs].sort((left, right) => left.retention25 - right.retention25).slice(0, 2));
  include([...stubs].sort((left, right) => left.retention50 - right.retention50).slice(0, 2));

  return focus;
}

function topTerms(text: string, limit = 3) {
  const counts = new Map<string, number>();
  for (const rawToken of text.toLowerCase().match(/[a-z0-9][a-z0-9'_-]{2,}/g) ?? []) {
    const token = rawToken.replace(/^'+|'+$/g, "");
    if (!token || TERM_STOPWORDS.has(token) || /^\d+$/.test(token)) {
      continue;
    }
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([term]) => term);
}

function formatGuideExample(
  row: RetentionGuideRow,
  metricLabel: string,
  metricValue: number,
  excerpt: string
) {
  const lane = row.coverageMode ?? row.clusterLabel ?? "General";
  const terms = topTerms(excerpt, 3);
  return `${row.title} [${lane}] | ${metricLabel} ${round(metricValue * 100, 1)}%${terms.length > 0 ? ` | terms ${terms.join(", ")}` : ""} | ${excerpt || "Transcript unavailable."}`;
}

async function buildGuideRows() {
  const endDate = todayUtcDate();
  const startDate = addDays(endDate, -(RECENT_LOOKBACK_DAYS - 1));
  const videos = await fetchLocalVideos({
    startDate,
    endDate,
    limit: RECENT_VIDEO_LIMIT,
  });

  const stubs = (
    await Promise.all(
      videos.map(async (video) => {
        const retentionPoints = await fetchVideoRetention(video.youtube_video_id);
        const retention = buildRetentionSummary(retentionPoints);
        if (!retention) {
          return null;
        }

        const retention25 =
          retention.checkpoints.find((checkpoint) => checkpoint.label === "25%")
            ?.audienceWatchRatio ?? 0;
        const retention50 =
          retention.checkpoints.find((checkpoint) => checkpoint.label === "50%")
            ?.audienceWatchRatio ?? 0;
        const finishRelative =
          retention.zoneAverages.find((zone) => zone.label === "Finish 75-100%")
            ?.averageRelativeRetention ?? 0;
        const averageViewPercentage = getAverageViewPercentage(video);
        const compositeScore =
          retention25 * 0.42 +
          retention50 * 0.42 +
          Math.max(0, averageViewPercentage / 100) * 0.16;

        return {
          video,
          retention,
          averageViewPercentage,
          retention25,
          retention50,
          finishRelative,
          compositeScore,
        };
      })
    )
  ).filter(
    (
      item
    ): item is {
      video: IdeationLocalVideoRecord;
      retention: VideoRetentionSummary;
      averageViewPercentage: number;
      retention25: number;
      retention50: number;
      finishRelative: number;
      compositeScore: number;
    } => Boolean(item)
  );

  const focusVideos = pickFocusVideos(stubs);
  const rows = (
    await Promise.all(
      focusVideos.map(async (video) => {
        const stub = stubs.find((entry) => entry.video.youtube_video_id === video.youtube_video_id);
        if (!stub) {
          return null;
        }

        const transcript = await loadTranscriptSummary(video);
        if (transcript.wordCount < 120) {
          return null;
        }

        const moonFit = await scoreTextAgainstMoonCorpus({
          title: video.title,
          text: [
            transcript.introExcerpt,
            ...transcript.windows.map((window) => window.excerpt),
          ]
            .filter(Boolean)
            .join(" "),
          maxAnalogs: 4,
        });

        return {
          youtubeVideoId: video.youtube_video_id,
          title: video.title,
          coverageMode: formatCoverageMode(moonFit.coverageMode),
          clusterLabel: moonFit.clusterLabel,
          averageViewPercentage: stub.averageViewPercentage,
          retention25: stub.retention25,
          retention50: stub.retention50,
          finishRelative: stub.finishRelative,
          compositeScore: stub.compositeScore,
          transcript,
        } satisfies RetentionGuideRow;
      })
    )
  ).filter((row): row is RetentionGuideRow => Boolean(row));

  return {
    generatedAt: new Date().toISOString(),
    rows,
  };
}

async function loadCachedGuideRows() {
  const now = Date.now();
  if (cachedRows && cachedRows.expiresAt > now) {
    return cachedRows;
  }

  if (!inflightRowsPromise) {
    inflightRowsPromise = buildGuideRows()
      .then((result) => {
        cachedRows = {
          expiresAt: Date.now() + GUIDE_CACHE_TTL_MS,
          generatedAt: result.generatedAt,
          rows: result.rows,
        };
        return result;
      })
      .finally(() => {
        inflightRowsPromise = null;
      });
  }

  const result = await inflightRowsPromise;
  return {
    expiresAt: Date.now() + GUIDE_CACHE_TTL_MS,
    generatedAt: result.generatedAt,
    rows: result.rows,
  };
}

function chooseRowsForGuide(
  rows: RetentionGuideRow[],
  preferredCoverageMode: string | null
) {
  if (!preferredCoverageMode) {
    return rows;
  }

  const sameModeRows = rows.filter((row) => row.coverageMode === formatCoverageMode(preferredCoverageMode));
  return sameModeRows.length >= 4 ? sameModeRows : rows;
}

export async function getMoonRetentionPatternGuide(args?: {
  preferredCoverageMode?: string | null;
}): Promise<MoonRetentionPatternGuide> {
  const cached = await loadCachedGuideRows();
  const preferredCoverageMode = formatCoverageMode(args?.preferredCoverageMode ?? null);
  const rows = chooseRowsForGuide(cached.rows, args?.preferredCoverageMode ?? null);
  const rankedRows = [...rows].sort((left, right) => right.compositeScore - left.compositeScore);
  const topCoverageModes = Array.from(
    rankedRows
      .slice(0, 8)
      .reduce((counts, row) => {
        const key = row.coverageMode ?? row.clusterLabel ?? "General";
        counts.set(key, (counts.get(key) ?? 0) + 1);
        return counts;
      }, new Map<string, number>())
      .entries()
  )
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 4)
    .map(([label]) => label);

  const hookLeaders = [...rows]
    .sort((left, right) => right.retention25 - left.retention25)
    .slice(0, 3);
  const middleLeaders = [...rows]
    .sort((left, right) => right.retention50 - left.retention50)
    .slice(0, 3);
  const finishLeaders = [...rows]
    .sort((left, right) => right.finishRelative - left.finishRelative)
    .slice(0, 3);
  const hookRisks = [...rows]
    .sort((left, right) => left.retention25 - right.retention25)
    .slice(0, 2);
  const middleRisks = [...rows]
    .sort((left, right) => left.retention50 - right.retention50)
    .slice(0, 2);

  const directives =
    rows.length === 0
      ? [
          "Front-load the anomaly and the system claim early.",
          "Do not spend the opener on generic biography or context dump.",
          "By the midpoint, introduce a fresh reveal that changes the stakes.",
        ]
      : [
          topCoverageModes.length > 0
            ? `Bias framing toward the Moon lanes currently holding best: ${topCoverageModes.join(" | ")}.`
            : "Bias framing toward the Moon lanes currently holding best.",
          hookLeaders.length > 0
            ? `Opening leaders win by getting to the anomaly fast and tying it to a named system, person, or mechanism inside the first 10%. Model your opener after that pressure curve, not after slow scene-setting.`
            : "Get to the anomaly fast in the opener.",
          middleLeaders.length > 0
            ? `Middle-retention leaders keep moving by adding a fresh system turn or hidden mechanism before the midpoint. Do not let the second quarter become biography recap or thesis repetition.`
            : "Add a fresh mechanism or escalation before the midpoint.",
          hookRisks.length > 0
            ? `Avoid the weak-opener pattern visible in recent Moon misses: slow moral framing, abstract setup, or payoff material arriving before the curiosity gap is locked.`
            : "Avoid slow moral framing in the opener.",
          finishLeaders.length > 0
            ? `Seed the late payoff earlier. The strongest finishes on Moon feel earned because the script hints at the reveal before the last quarter instead of dropping it cold at the end.`
            : "Seed the late payoff earlier.",
        ];

  return {
    generatedAt: cached.generatedAt,
    preferredCoverageMode,
    sampleSize: rows.length,
    topCoverageModes,
    hookLeaders,
    middleLeaders,
    finishLeaders,
    hookRisks,
    middleRisks,
    directives,
  };
}

export function formatMoonRetentionPatternGuide(guide: MoonRetentionPatternGuide) {
  const lines: string[] = [];

  lines.push("Moon retention packet (binding for hook and pacing):");
  lines.push(
    `- Recent sample: ${guide.sampleSize} Moon uploads with transcript windows and retention checkpoints cross-referenced.`
  );
  if (guide.preferredCoverageMode) {
    lines.push(`- Coverage focus: ${guide.preferredCoverageMode}`);
  }
  if (guide.topCoverageModes.length > 0) {
    lines.push(`- Best recent Moon lanes by hold: ${guide.topCoverageModes.join(" | ")}`);
  }

  if (guide.hookLeaders.length > 0) {
    lines.push("- Recent opening leaders:");
    for (const row of guide.hookLeaders) {
      lines.push(
        `  - ${formatGuideExample(
          row,
          "25% hold",
          row.retention25,
          row.transcript.windows.find((window) => window.label === "Hook 0-10%")?.excerpt ??
            row.transcript.introExcerpt
        )}`
      );
    }
  }

  if (guide.middleLeaders.length > 0) {
    lines.push("- Recent middle leaders:");
    for (const row of guide.middleLeaders) {
      lines.push(
        `  - ${formatGuideExample(
          row,
          "50% hold",
          row.retention50,
          row.transcript.windows.find((window) => window.label === "Build 25-50%")?.excerpt ??
            row.transcript.windows.find((window) => window.label === "Middle 50-75%")?.excerpt ??
            row.transcript.introExcerpt
        )}`
      );
    }
  }

  if (guide.finishLeaders.length > 0) {
    lines.push("- Recent finish leaders:");
    for (const row of guide.finishLeaders) {
      lines.push(
        `  - ${formatGuideExample(
          row,
          "finish relative",
          row.finishRelative,
          row.transcript.windows.find((window) => window.label === "Payoff 75-100%")?.excerpt ??
            row.transcript.introExcerpt
        )}`
      );
    }
  }

  if (guide.hookRisks.length > 0) {
    lines.push("- Weak recent openings to avoid:");
    for (const row of guide.hookRisks) {
      lines.push(
        `  - ${formatGuideExample(
          row,
          "25% hold",
          row.retention25,
          row.transcript.windows.find((window) => window.label === "Hook 0-10%")?.excerpt ??
            row.transcript.introExcerpt
        )}`
      );
    }
  }

  if (guide.middleRisks.length > 0) {
    lines.push("- Weak recent middles to avoid:");
    for (const row of guide.middleRisks) {
      lines.push(
        `  - ${formatGuideExample(
          row,
          "50% hold",
          row.retention50,
          row.transcript.windows.find((window) => window.label === "Middle 50-75%")?.excerpt ??
            row.transcript.windows.find((window) => window.label === "Build 25-50%")?.excerpt ??
            row.transcript.introExcerpt
        )}`
      );
    }
  }

  lines.push("- Retention-backed writing directives:");
  for (const directive of guide.directives) {
    lines.push(`  - ${directive}`);
  }

  return lines.join("\n");
}
