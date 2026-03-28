import "server-only";

import fsSync from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";

import { desc, eq } from "drizzle-orm";
import { z } from "zod";

import {
  moonAnalysisReportSchema,
  moonAnalysisRequestSchema,
  moonAnalysisRunSchema,
  type MoonAnalysisReport,
  type MoonAnalysisRequest,
  type MoonAnalysisRun,
} from "@/lib/moon-analysis";
import { getEnv, requireEnv } from "@/server/config/env";
import { getDb } from "@/server/db/client";
import { moonAnalysisRuns } from "@/server/db/schema";
import { ingestLocalMediaArtifacts } from "@/server/providers/local-media";
import {
  ensureYouTubeTranscript,
  type ClipTranscriptSegment,
  upsertClipInLibrary,
} from "@/server/services/clip-library";
import { scoreTextAgainstMoonCorpus } from "@/server/services/moon-corpus";
import { renderMoonAnalysisHtml } from "@/server/services/moon-analysis-render";

type MoonAnalysisRunRecord = typeof moonAnalysisRuns.$inferSelect;

interface IdeationLocalVideoRecord {
  youtube_video_id: string;
  title: string;
  published_at: string | null;
  duration_seconds: number | null;
  views: number | null;
  estimated_minutes_watched: number | null;
  estimated_watch_hours: number | null;
  average_view_duration_seconds: number | null;
  average_view_percentage: number | null;
  likes: number | null;
  dislikes: number | null;
  comments: number | null;
  shares: number | null;
  subscribers_gained: number | null;
  subscribers_lost: number | null;
  net_subscribers: number | null;
  thumbnail_url: string | null;
  source_url: string | null;
  imported_at: string | null;
}

interface IdeationLocalVideosResponse {
  start_date: string;
  end_date: string;
  include_shorts: boolean;
  sort: string;
  video_count: number;
  videos: IdeationLocalVideoRecord[];
}

interface IdeationRetentionPoint {
  elapsed_ratio: number;
  audience_watch_ratio: number;
  relative_retention_performance: number;
}

interface IdeationRetentionResponse {
  youtube_video_id: string;
  start_date: string;
  end_date: string;
  point_count: number;
  checkpoints: IdeationRetentionPoint[];
}

interface IdeationTrafficRow {
  source_type: string;
  views: number | null;
  estimated_minutes_watched: number | null;
  estimated_watch_hours: number | null;
  imported_at: string | null;
}

interface IdeationDemographicRow {
  age_group: string;
  gender: string;
  viewer_percentage: number | null;
  imported_at: string | null;
}

interface IdeationGeographyRow {
  country: string;
  views: number | null;
  estimated_minutes_watched: number | null;
  estimated_watch_hours: number | null;
  imported_at: string | null;
}

interface IdeationBreakdownsResponse {
  period: string;
  traffic: IdeationTrafficRow[];
  demographics: IdeationDemographicRow[];
  geography: IdeationGeographyRow[];
}

interface IdeationOutlierRecord {
  youtube_video_id: string;
  title: string;
  channel_title: string | null;
  channel_category_label: string | null;
  video_category_label: string | null;
  published_at: string | null;
  duration_seconds: number | null;
  latest_view_count: number | null;
  external_outlier_score: number | null;
  percentile_rank: number | null;
  segment_key: string | null;
  baseline_bucket_hours: number | null;
  requested_bucket_hours: number | null;
  bucket_fallback_used: boolean | null;
  views_ratio: number | null;
  window: string | null;
}

interface ScopeWindow {
  startDate: string;
  endDate: string;
  scopeLabel: string;
  windowLabel: string;
  label: string;
}

interface RetentionCheckpointSummary {
  label: string;
  elapsedRatio: number;
  audienceWatchRatio: number;
  relativeRetentionPerformance: number;
}

interface RetentionRangeSummary {
  label: string;
  startRatio: number;
  endRatio: number;
  averageWatchRatio: number;
  averageRelativeRetention: number;
}

interface RetentionShiftSummary {
  startRatio: number;
  endRatio: number;
  deltaWatchRatio: number;
}

interface VideoRetentionSummary {
  pointCount: number;
  checkpoints: RetentionCheckpointSummary[];
  zoneAverages: RetentionRangeSummary[];
  biggestDrops: RetentionShiftSummary[];
  biggestRebounds: RetentionShiftSummary[];
}

interface TranscriptWindowSummary {
  label: string;
  startRatio: number;
  endRatio: number;
  startSeconds: number;
  endSeconds: number;
  wordCount: number;
  excerpt: string;
}

interface TranscriptSummary {
  source: "youtube_captions" | "whisper_fallback" | "missing";
  segmentCount: number;
  wordCount: number;
  introExcerpt: string;
  topTerms: string[];
  hookTerms: string[];
  windows: TranscriptWindowSummary[];
}

interface ArtifactVideoRecord {
  youtubeVideoId: string;
  title: string;
  sourceUrl: string;
  thumbnailUrl: string | null;
  publishedAt: string | null;
  durationSeconds: number;
  views: number;
  estimatedWatchHours: number;
  averageViewDurationSeconds: number;
  averageViewPercentage: number;
  likes: number;
  dislikes: number;
  comments: number;
  shares: number;
  subscribersGained: number;
  subscribersLost: number;
  netSubscribers: number;
  cohortPercentiles: Record<string, number>;
  performanceScore: number;
  performanceTier: string;
  heuristics: string[];
  transcript: TranscriptSummary;
  retention: VideoRetentionSummary | null;
  transcriptPath: string;
  detailPath: string;
}

interface MoonFitSignal {
  youtubeVideoId: string;
  title: string;
  channelTitle: string | null;
  window: string | null;
  latestViewCount: number | null;
  externalOutlierScore: number | null;
  viewsRatio: number | null;
  moonFitScore: number;
  moonFitBand: string;
  coverageMode: string | null;
  analogTitles: string[];
  reasonCodes: string[];
}

interface MoonAnalysisDataset {
  scope: ScopeWindow & {
    scopeType: MoonAnalysisRequest["scopeType"];
    targetVideoId: string | null;
    targetVideoTitle: string | null;
    notes: string;
  };
  cohortSummary: {
    videoCount: number;
    medianViews: number;
    medianWatchHours: number;
    medianAverageViewPercentage: number;
    medianNetSubscribers: number;
    topViewVideoId: string | null;
    topAverageViewPctVideoId: string | null;
    topNetSubscribersVideoId: string | null;
  };
  cohortVideos: ArtifactVideoRecord[];
  channelContext: {
    period: string;
    topTrafficSources: Array<{
      sourceType: string;
      views: number;
      estimatedWatchHours: number;
      viewShare: number;
    }>;
    topDemographics: Array<{
      ageGroup: string;
      gender: string;
      viewerPercentage: number;
    }>;
    topGeographies: Array<{
      country: string;
      views: number;
      estimatedWatchHours: number;
    }>;
  };
  historicalSummary: {
    totalVideos: number;
    topByViews: IdeationLocalVideoRecord[];
    topByWatchHours: IdeationLocalVideoRecord[];
    topByAverageViewPercentage: IdeationLocalVideoRecord[];
    topByNetSubscribers: IdeationLocalVideoRecord[];
    recent90dTopPerformers: IdeationLocalVideoRecord[];
  };
  externalSignals: MoonFitSignal[];
}

const YOUTUBE_VIDEO_ID_PATTERN = /^[a-zA-Z0-9_-]{11}$/;
const CLAUDE_SYNTHESIS_TIMEOUT_MS = 6 * 60_000;
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

function serializeDate(value: Date | null | undefined) {
  return value ? value.toISOString() : null;
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}

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

function daysBetween(startDate: string, endDate: string) {
  const start = parseUtcDate(startDate).getTime();
  const end = parseUtcDate(endDate).getTime();
  return Math.round((end - start) / (24 * 60 * 60 * 1000));
}

function formatDateLong(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(parseUtcDate(value));
}

function formatWindowLabel(startDate: string, endDate: string) {
  return `${formatDateLong(startDate)} to ${formatDateLong(endDate)}`;
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function round(value: number, digits = 2) {
  return Number(value.toFixed(digits));
}

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
}

function average(values: number[]) {
  if (values.length === 0) {
    return 0;
  }

  return sum(values) / values.length;
}

function median(values: number[]) {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const midpoint = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[midpoint - 1] + sorted[midpoint]) / 2
    : sorted[midpoint];
}

function percentileForValue(values: number[], value: number) {
  if (values.length === 0) {
    return 0;
  }

  const lessThanOrEqual = values.filter((entry) => entry <= value).length;
  return round(lessThanOrEqual / values.length, 3);
}

function truncateText(value: string, maxChars: number) {
  if (value.length <= maxChars) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`;
}

function formatTimestamp(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function cleanTranscriptText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function extractTopTerms(text: string, limit = 12) {
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
    { label: "Setup 10-25%", startRatio: 0.1, endRatio: 0.25 },
    { label: "Build 25-50%", startRatio: 0.25, endRatio: 0.5 },
    { label: "Middle 50-75%", startRatio: 0.5, endRatio: 0.75 },
    { label: "Payoff 75-100%", startRatio: 0.75, endRatio: 1 },
  ].map((window) => {
    const startMs = Math.floor(durationMs * window.startRatio);
    const endMs = Math.floor(durationMs * window.endRatio);
    const text = extractTranscriptText(segments, startMs, endMs);
    return {
      label: window.label,
      startRatio: window.startRatio,
      endRatio: window.endRatio,
      startSeconds: Math.floor(startMs / 1000),
      endSeconds: Math.floor(endMs / 1000),
      wordCount: text.split(/\s+/).filter(Boolean).length,
      excerpt: truncateText(text, 420),
    };
  });

  const introText = extractTranscriptText(segments, 0, Math.min(durationMs, 90_000));
  return {
    source,
    segmentCount: segments.length,
    wordCount: fullText.split(/\s+/).filter(Boolean).length,
    introExcerpt: truncateText(introText, 520),
    topTerms: extractTopTerms(fullText, 12),
    hookTerms: extractTopTerms(introText, 10),
    windows,
  };
}

function closestRetentionPoint(
  points: IdeationRetentionPoint[],
  targetRatio: number
): IdeationRetentionPoint | null {
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

function buildRetentionSummary(
  points: IdeationRetentionPoint[]
): VideoRetentionSummary | null {
  if (points.length === 0) {
    return null;
  }

  const checkpoints = [
    { label: "5%", ratio: 0.05 },
    { label: "10%", ratio: 0.1 },
    { label: "25%", ratio: 0.25 },
    { label: "50%", ratio: 0.5 },
    { label: "75%", ratio: 0.75 },
    { label: "100%", ratio: 1 },
  ]
    .map((checkpoint) => {
      const point = closestRetentionPoint(points, checkpoint.ratio);
      if (!point) {
        return null;
      }

      return {
        label: checkpoint.label,
        elapsedRatio: point.elapsed_ratio,
        audienceWatchRatio: round(point.audience_watch_ratio, 4),
        relativeRetentionPerformance: round(
          point.relative_retention_performance,
          4
        ),
      };
    })
    .filter(
      (
        checkpoint
      ): checkpoint is RetentionCheckpointSummary => Boolean(checkpoint)
    );

  const zoneAverages = [
    { label: "Hook 0-10%", startRatio: 0, endRatio: 0.1 },
    { label: "Setup 10-25%", startRatio: 0.1, endRatio: 0.25 },
    { label: "Body 25-50%", startRatio: 0.25, endRatio: 0.5 },
    { label: "Second Half 50-75%", startRatio: 0.5, endRatio: 0.75 },
    { label: "Finish 75-100%", startRatio: 0.75, endRatio: 1 },
  ].map((window) => {
    const averages = averageRetentionRange(points, window.startRatio, window.endRatio);
    return {
      label: window.label,
      startRatio: window.startRatio,
      endRatio: window.endRatio,
      averageWatchRatio: averages.averageWatchRatio,
      averageRelativeRetention: averages.averageRelativeRetention,
    };
  });

  const retentionShifts = points
    .slice(1)
    .map((point, index) => ({
      startRatio: points[index]?.elapsed_ratio ?? 0,
      endRatio: point.elapsed_ratio,
      deltaWatchRatio: round(
        point.audience_watch_ratio - (points[index]?.audience_watch_ratio ?? 0),
        4
      ),
    }));

  return {
    pointCount: points.length,
    checkpoints,
    zoneAverages,
    biggestDrops: [...retentionShifts]
      .sort((left, right) => left.deltaWatchRatio - right.deltaWatchRatio)
      .slice(0, 5),
    biggestRebounds: [...retentionShifts]
      .sort((left, right) => right.deltaWatchRatio - left.deltaWatchRatio)
      .filter((shift) => shift.deltaWatchRatio > 0)
      .slice(0, 5),
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

function getEstimatedWatchHours(video: IdeationLocalVideoRecord) {
  if (
    typeof video.estimated_watch_hours === "number" &&
    Number.isFinite(video.estimated_watch_hours)
  ) {
    return video.estimated_watch_hours;
  }

  if (
    typeof video.estimated_minutes_watched === "number" &&
    Number.isFinite(video.estimated_minutes_watched)
  ) {
    return video.estimated_minutes_watched / 60;
  }

  return 0;
}

function getNetSubscribers(video: IdeationLocalVideoRecord) {
  if (
    typeof video.net_subscribers === "number" &&
    Number.isFinite(video.net_subscribers)
  ) {
    return video.net_subscribers;
  }

  const gained = typeof video.subscribers_gained === "number" ? video.subscribers_gained : 0;
  const lost = typeof video.subscribers_lost === "number" ? video.subscribers_lost : 0;
  return gained - lost;
}

function buildScopeWindow(
  request: MoonAnalysisRequest,
  targetVideo: IdeationLocalVideoRecord | null
): ScopeWindow {
  const fallbackEndDate = request.endDate ?? todayUtcDate();
  const targetPublishedDate = targetVideo?.published_at?.slice(0, 10) ?? null;
  const shouldShiftToTargetWindow =
    request.scopeType === "video" &&
    targetPublishedDate &&
    (daysBetween(targetPublishedDate, fallbackEndDate) > 29 ||
      daysBetween(targetPublishedDate, fallbackEndDate) < 0);
  const endDate = shouldShiftToTargetWindow ? targetPublishedDate : fallbackEndDate;
  const windowDays = request.scopeType === "weekly" ? 7 : 30;
  const startDate = addDays(endDate, -(windowDays - 1));
  const scopeLabel =
    request.scopeType === "monthly"
      ? "Monthly Analysis"
      : request.scopeType === "weekly"
        ? "Weekly Analysis"
        : "Video Deep Dive";

  return {
    startDate,
    endDate,
    scopeLabel,
    windowLabel: formatWindowLabel(startDate, endDate),
    label:
      request.scopeType === "video" && targetVideo
        ? `${targetVideo.title} Deep Dive`
        : `Moon ${scopeLabel}`,
  };
}

function serializeRunRecord(run: MoonAnalysisRunRecord): MoonAnalysisRun {
  return moonAnalysisRunSchema.parse({
    id: run.id,
    status: run.status,
    scopeType: run.scopeType,
    scopeStartDate: run.scopeStartDate,
    scopeEndDate: run.scopeEndDate,
    youtubeVideoId: run.youtubeVideoId,
    youtubeVideoTitle: run.youtubeVideoTitle,
    label: run.label,
    request: moonAnalysisRequestSchema.parse(run.requestJson),
    result: run.resultJson ? moonAnalysisReportSchema.parse(run.resultJson) : null,
    reportHtml: run.reportHtml,
    artifactDir: run.artifactDir,
    errorText: run.errorText,
    startedAt: serializeDate(run.startedAt),
    completedAt: serializeDate(run.completedAt),
    createdAt: run.createdAt.toISOString(),
    updatedAt: run.updatedAt.toISOString(),
  });
}

function ensureMoonAnalysisEnvironment() {
  requireEnv("IDEATION_BACKEND_URL");
}

function spawnLocalMoonAnalysisWorker(runId: string) {
  const cwd = process.cwd();
  const logsDir = path.resolve(cwd, "data", "moon-analysis-logs");
  fsSync.mkdirSync(logsDir, { recursive: true });
  const logPath = path.join(logsDir, `${runId}.log`);
  const logFd = fsSync.openSync(logPath, "a");
  const child = spawn(
    process.execPath,
    [
      "--conditions=react-server",
      `--env-file=${path.resolve(cwd, ".env")}`,
      "--import",
      "tsx",
      path.resolve(cwd, "scripts/run-moon-analysis-local.ts"),
      runId,
    ],
    {
      cwd,
      detached: true,
      stdio: ["ignore", logFd, logFd],
    }
  );

  if (!child.pid) {
    fsSync.closeSync(logFd);
    throw new Error(`Failed to spawn moon-analysis worker for run ${runId}`);
  }

  fsSync.closeSync(logFd);
  child.unref();
}

async function fetchIdeationJson<T>(
  pathname: string,
  searchParams: Record<string, string | number | boolean | undefined> = {}
): Promise<T> {
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

/**
 * Fetch a single video's metadata from the YouTube Data API.
 * Used as fallback when the video isn't in local analytics.
 */
async function fetchYouTubeVideoMetadata(
  videoId: string
): Promise<IdeationLocalVideoRecord> {
  const apiKey = getEnv().YOUTUBE_API_KEY;

  const stub: IdeationLocalVideoRecord = {
    youtube_video_id: videoId,
    title: `Video ${videoId}`,
    published_at: null,
    duration_seconds: null,
    views: null,
    estimated_minutes_watched: null,
    estimated_watch_hours: null,
    average_view_duration_seconds: null,
    average_view_percentage: null,
    likes: null,
    dislikes: null,
    comments: null,
    shares: null,
    subscribers_gained: null,
    subscribers_lost: null,
    net_subscribers: null,
    thumbnail_url: null,
    source_url: `https://www.youtube.com/watch?v=${videoId}`,
    imported_at: null,
  };

  if (!apiKey) {
    console.warn("[moon-analysis] No YOUTUBE_API_KEY — using stub for", videoId);
    return stub;
  }

  try {
    const params = new URLSearchParams({
      part: "snippet,contentDetails,statistics",
      id: videoId,
      key: apiKey,
    });
    const res = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?${params}`
    );
    if (!res.ok) {
      console.warn("[moon-analysis] YouTube API error:", res.status);
      return stub;
    }

    const data = await res.json();
    const item = data.items?.[0];
    if (!item) {
      console.warn("[moon-analysis] Video not found on YouTube:", videoId);
      return stub;
    }

    // Parse ISO 8601 duration (PT1H2M3S) to seconds
    const durationMatch = (item.contentDetails?.duration ?? "").match(
      /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/
    );
    const durationSeconds = durationMatch
      ? (Number(durationMatch[1] ?? 0) * 3600 +
         Number(durationMatch[2] ?? 0) * 60 +
         Number(durationMatch[3] ?? 0))
      : null;

    const stats = item.statistics ?? {};
    const views = stats.viewCount ? Number(stats.viewCount) : null;
    const thumbs = item.snippet?.thumbnails ?? {};
    const thumbnailUrl =
      thumbs.maxres?.url ?? thumbs.high?.url ?? thumbs.medium?.url ?? null;

    return {
      youtube_video_id: videoId,
      title: item.snippet?.title ?? stub.title,
      published_at: item.snippet?.publishedAt ?? null,
      duration_seconds: durationSeconds,
      views,
      estimated_minutes_watched: null,
      estimated_watch_hours: null,
      average_view_duration_seconds: null,
      average_view_percentage: null,
      likes: stats.likeCount ? Number(stats.likeCount) : null,
      dislikes: null,
      comments: stats.commentCount ? Number(stats.commentCount) : null,
      shares: null,
      subscribers_gained: null,
      subscribers_lost: null,
      net_subscribers: null,
      thumbnail_url: thumbnailUrl,
      source_url: `https://www.youtube.com/watch?v=${videoId}`,
      imported_at: null,
    };
  } catch (err) {
    console.error("[moon-analysis] Failed to fetch YouTube metadata:", err);
    return stub;
  }
}

async function fetchLocalVideos(args: {
  startDate: string;
  endDate: string;
  includeShorts?: boolean;
  sort?: string;
  limit?: number;
}) {
  const response = await fetchIdeationJson<IdeationLocalVideosResponse>(
    "/youtube-analytics/local-videos",
    {
      start_date: args.startDate,
      end_date: args.endDate,
      include_shorts: args.includeShorts ?? false,
      sort: args.sort ?? "published_desc",
      limit: args.limit ?? 100,
    }
  );

  return response.videos ?? [];
}

async function fetchChannelBreakdowns(period: string) {
  return await fetchIdeationJson<IdeationBreakdownsResponse>(
    "/youtube-analytics/local-breakdowns",
    { period }
  );
}

async function fetchVideoRetention(youtubeVideoId: string) {
  try {
    const response = await fetchIdeationJson<IdeationRetentionResponse>(
      `/youtube-analytics/video-retention/${youtubeVideoId}`
    );
    return response.checkpoints ?? [];
  } catch (error) {
    console.error("[moon-analysis] retention fetch failed", youtubeVideoId, error);
    return [];
  }
}

async function fetchOutliers(window: string, limit: number) {
  try {
    return await fetchIdeationJson<IdeationOutlierRecord[]>(
      "/outliers",
      { window, limit }
    );
  } catch (error) {
    console.error("[moon-analysis] outlier fetch failed", window, error);
    return [];
  }
}

async function loadTranscriptForVideo(video: IdeationLocalVideoRecord) {
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

  return {
    clipId,
    transcript: transcript ?? [],
    source,
  };
}

function buildTranscriptFileBody(segments: ClipTranscriptSegment[]) {
  if (segments.length === 0) {
    return "Transcript unavailable.\n";
  }

  return `${segments
    .map((segment) => `[${formatTimestamp(segment.startMs)}] ${cleanTranscriptText(segment.text)}`)
    .join("\n")}\n`;
}

function scorePerformanceTier(score: number) {
  if (score >= 0.8) {
    return "breakout";
  }
  if (score >= 0.62) {
    return "strong";
  }
  if (score >= 0.4) {
    return "middle";
  }
  return "soft";
}

function buildHeuristicNotes(args: {
  viewsPct: number;
  avpPct: number;
  netSubsPct: number;
  retention25Pct: number;
  retention50Pct: number;
  transcript: TranscriptSummary;
}) {
  const notes: string[] = [];

  if (args.viewsPct >= 0.75 && args.avpPct >= 0.7) {
    notes.push("Won on both scale and hold.");
  } else if (args.viewsPct >= 0.75 && args.avpPct < 0.45) {
    notes.push("Scaled well, but hold lagged once viewers got in.");
  } else if (args.viewsPct < 0.45 && args.avpPct >= 0.75) {
    notes.push("Retention proxy beat scale, suggesting packaging or premise pressure.");
  }

  if (args.netSubsPct >= 0.75) {
    notes.push("Converted unusually well into subscriber gain.");
  }

  if (args.retention25Pct >= 0.75 && args.retention50Pct >= 0.7) {
    notes.push("Held the opening and the middle better than most of the cohort.");
  } else if (args.retention25Pct < 0.35) {
    notes.push("Lost a lot of viewers before the 25% mark.");
  }

  if (args.transcript.hookTerms.length > 0) {
    notes.push(`Hook terms skewed toward ${args.transcript.hookTerms.slice(0, 3).join(", ")}.`);
  }

  return notes.slice(0, 5);
}

async function buildMoonFitSignals(
  outliers: IdeationOutlierRecord[]
): Promise<MoonFitSignal[]> {
  const deduped = new Map<string, IdeationOutlierRecord>();
  for (const outlier of outliers) {
    if (!outlier.youtube_video_id || deduped.has(outlier.youtube_video_id)) {
      continue;
    }
    deduped.set(outlier.youtube_video_id, outlier);
  }

  const candidates = [...deduped.values()].slice(0, 16);
  const scored = await Promise.all(
    candidates.map(async (candidate) => {
      const moonFit = await scoreTextAgainstMoonCorpus({
        title: candidate.title,
        text: [
          candidate.channel_category_label,
          candidate.video_category_label,
          candidate.channel_title,
        ]
          .filter(Boolean)
          .join(" "),
      });

      return {
        youtubeVideoId: candidate.youtube_video_id,
        title: candidate.title,
        channelTitle: candidate.channel_title,
        window: candidate.window,
        latestViewCount: candidate.latest_view_count,
        externalOutlierScore: candidate.external_outlier_score,
        viewsRatio: candidate.views_ratio,
        moonFitScore: moonFit.moonFitScore,
        moonFitBand: moonFit.moonFitBand,
        coverageMode: moonFit.coverageMode,
        analogTitles: moonFit.analogs.map((analog) => analog.title).slice(0, 3),
        reasonCodes: moonFit.reasonCodes,
      } satisfies MoonFitSignal;
    })
  );

  return scored
    .filter((signal) => signal.moonFitScore >= 45)
    .sort(
      (left, right) =>
        right.moonFitScore - left.moonFitScore ||
        (right.externalOutlierScore ?? 0) - (left.externalOutlierScore ?? 0)
    )
    .slice(0, 8);
}

async function assembleMoonAnalysisDataset(args: {
  request: MoonAnalysisRequest;
}): Promise<MoonAnalysisDataset> {
  const historicalVideos = await fetchLocalVideos({
    startDate: "2020-01-01",
    endDate: args.request.endDate ?? todayUtcDate(),
    includeShorts: false,
    sort: "published_desc",
    limit: 600,
  });

  const targetVideo =
    args.request.youtubeVideoId != null
      ? historicalVideos.find(
          (video) => video.youtube_video_id === args.request.youtubeVideoId
        ) ?? null
      : null;

  // If the target video isn't in local analytics, fetch its metadata
  // from the YouTube Data API so the analysis can still run with real
  // title, published date, duration, and view count.
  let resolvedTargetVideo = targetVideo;
  if (args.request.scopeType === "video" && !targetVideo && args.request.youtubeVideoId) {
    console.warn(
      `[moon-analysis] Target video ${args.request.youtubeVideoId} not in local analytics — fetching from YouTube API`
    );
    resolvedTargetVideo = await fetchYouTubeVideoMetadata(args.request.youtubeVideoId);
  }

  const scope = buildScopeWindow(args.request, resolvedTargetVideo);
  const cohortVideosRaw = await fetchLocalVideos({
    startDate: scope.startDate,
    endDate: scope.endDate,
    includeShorts: false,
    sort: "published_desc",
    limit: 40,
  });
  const cohortVideosWithTarget =
    resolvedTargetVideo &&
    !cohortVideosRaw.some((video) => video.youtube_video_id === resolvedTargetVideo.youtube_video_id)
      ? [resolvedTargetVideo, ...cohortVideosRaw]
      : cohortVideosRaw;

  if (cohortVideosWithTarget.length === 0) {
    throw new Error(`No Moon videos were found between ${scope.startDate} and ${scope.endDate}.`);
  }

  const [channelContextRaw, weeklyOutliers, monthlyOutliers] = await Promise.all([
    fetchChannelBreakdowns("last_30d"),
    fetchOutliers("7d", 20),
    fetchOutliers("30d", 20),
  ]);

  const transcripts = await Promise.all(
    cohortVideosWithTarget.map(async (video) => {
      const [transcriptResult, retentionPoints] = await Promise.all([
        loadTranscriptForVideo(video),
        fetchVideoRetention(video.youtube_video_id),
      ]);

      return {
        video,
        transcript: transcriptResult.transcript,
        transcriptSource: transcriptResult.source,
        retentionPoints,
      };
    })
  );

  const viewsList = cohortVideosWithTarget.map((video) => Math.max(0, video.views ?? 0));
  const watchHoursList = cohortVideosWithTarget.map((video) =>
    Math.max(0, getEstimatedWatchHours(video))
  );
  const avpList = cohortVideosWithTarget.map((video) =>
    Math.max(0, getAverageViewPercentage(video))
  );
  const netSubsList = cohortVideosWithTarget.map((video) =>
    Math.max(0, getNetSubscribers(video))
  );

  const retention25List = transcripts.map((entry) => {
    const summary = buildRetentionSummary(entry.retentionPoints);
    return summary?.checkpoints.find((checkpoint) => checkpoint.label === "25%")
      ?.audienceWatchRatio ?? 0;
  });
  const retention50List = transcripts.map((entry) => {
    const summary = buildRetentionSummary(entry.retentionPoints);
    return summary?.checkpoints.find((checkpoint) => checkpoint.label === "50%")
      ?.audienceWatchRatio ?? 0;
  });

  const cohortVideos = transcripts.map((entry, index) => {
    const averageViewPercentage = Math.max(0, getAverageViewPercentage(entry.video));
    const estimatedWatchHours = Math.max(0, getEstimatedWatchHours(entry.video));
    const netSubscribers = Math.max(0, getNetSubscribers(entry.video));
    const views = Math.max(0, entry.video.views ?? 0);
    const retention = buildRetentionSummary(entry.retentionPoints);
    const transcript = buildTranscriptSummary(
      entry.transcript,
      Math.max(0, entry.video.duration_seconds ?? 0),
      entry.transcriptSource
    );
    const retention25 =
      retention?.checkpoints.find((checkpoint) => checkpoint.label === "25%")
        ?.audienceWatchRatio ?? 0;
    const retention50 =
      retention?.checkpoints.find((checkpoint) => checkpoint.label === "50%")
        ?.audienceWatchRatio ?? 0;
    const cohortPercentiles = {
      views: percentileForValue(viewsList, views),
      watchHours: percentileForValue(watchHoursList, estimatedWatchHours),
      averageViewPercentage: percentileForValue(avpList, averageViewPercentage),
      netSubscribers: percentileForValue(netSubsList, netSubscribers),
      retention25: percentileForValue(retention25List, retention25),
      retention50: percentileForValue(retention50List, retention50),
    };
    const performanceScore = round(
      cohortPercentiles.views * 0.28 +
        cohortPercentiles.watchHours * 0.22 +
        cohortPercentiles.averageViewPercentage * 0.18 +
        cohortPercentiles.netSubscribers * 0.18 +
        cohortPercentiles.retention25 * 0.08 +
        cohortPercentiles.retention50 * 0.06,
      3
    );
    const transcriptFileName = `${String(index + 1).padStart(2, "0")}-${entry.video.youtube_video_id}-${slugify(entry.video.title)}.txt`;
    const detailFileName = `${String(index + 1).padStart(2, "0")}-${entry.video.youtube_video_id}-${slugify(entry.video.title)}.json`;

    return {
      youtubeVideoId: entry.video.youtube_video_id,
      title: entry.video.title,
      sourceUrl:
        entry.video.source_url ??
        `https://www.youtube.com/watch?v=${entry.video.youtube_video_id}`,
      thumbnailUrl: entry.video.thumbnail_url,
      publishedAt: entry.video.published_at,
      durationSeconds: Math.max(0, entry.video.duration_seconds ?? 0),
      views,
      estimatedWatchHours: round(estimatedWatchHours, 2),
      averageViewDurationSeconds: Math.max(
        0,
        entry.video.average_view_duration_seconds ?? 0
      ),
      averageViewPercentage: round(averageViewPercentage, 2),
      likes: Math.max(0, entry.video.likes ?? 0),
      dislikes: Math.max(0, entry.video.dislikes ?? 0),
      comments: Math.max(0, entry.video.comments ?? 0),
      shares: Math.max(0, entry.video.shares ?? 0),
      subscribersGained: Math.max(0, entry.video.subscribers_gained ?? 0),
      subscribersLost: Math.max(0, entry.video.subscribers_lost ?? 0),
      netSubscribers,
      cohortPercentiles,
      performanceScore,
      performanceTier: scorePerformanceTier(performanceScore),
      heuristics: buildHeuristicNotes({
        viewsPct: cohortPercentiles.views,
        avpPct: cohortPercentiles.averageViewPercentage,
        netSubsPct: cohortPercentiles.netSubscribers,
        retention25Pct: cohortPercentiles.retention25,
        retention50Pct: cohortPercentiles.retention50,
        transcript,
      }),
      transcript,
      retention,
      transcriptPath: `transcripts/${transcriptFileName}`,
      detailPath: `videos/${detailFileName}`,
    } satisfies ArtifactVideoRecord;
  });

  const externalSignals = await buildMoonFitSignals([
    ...weeklyOutliers,
    ...monthlyOutliers,
  ]);

  const channelTrafficTotal = sum(
    channelContextRaw.traffic.map((row) => Math.max(0, row.views ?? 0))
  );

  const historicalWithAvp = historicalVideos.map((video) => ({
    ...video,
    _avgViewPct: getAverageViewPercentage(video),
    _watchHours: getEstimatedWatchHours(video),
    _netSubscribers: getNetSubscribers(video),
  }));
  const recent90dFloor = addDays(scope.endDate, -89);

  return {
    scope: {
      ...scope,
      scopeType: args.request.scopeType,
      targetVideoId: resolvedTargetVideo?.youtube_video_id ?? null,
      targetVideoTitle: resolvedTargetVideo?.title ?? null,
      notes: args.request.notes?.trim() ?? "",
    },
    cohortSummary: {
      videoCount: cohortVideos.length,
      medianViews: round(median(viewsList), 0),
      medianWatchHours: round(median(watchHoursList), 1),
      medianAverageViewPercentage: round(median(avpList), 2),
      medianNetSubscribers: round(median(netSubsList), 0),
      topViewVideoId:
        [...cohortVideos].sort((left, right) => right.views - left.views)[0]?.youtubeVideoId ??
        null,
      topAverageViewPctVideoId:
        [...cohortVideos].sort(
          (left, right) => right.averageViewPercentage - left.averageViewPercentage
        )[0]?.youtubeVideoId ?? null,
      topNetSubscribersVideoId:
        [...cohortVideos].sort((left, right) => right.netSubscribers - left.netSubscribers)[0]
          ?.youtubeVideoId ?? null,
    },
    cohortVideos,
    channelContext: {
      period: channelContextRaw.period,
      topTrafficSources: channelContextRaw.traffic
        .slice()
        .sort((left, right) => (right.views ?? 0) - (left.views ?? 0))
        .slice(0, 8)
        .map((row) => ({
          sourceType: row.source_type,
          views: Math.max(0, row.views ?? 0),
          estimatedWatchHours: round(Math.max(0, row.estimated_watch_hours ?? 0), 2),
          viewShare:
            channelTrafficTotal > 0
              ? round(Math.max(0, row.views ?? 0) / channelTrafficTotal, 4)
              : 0,
        })),
      topDemographics: channelContextRaw.demographics
        .slice()
        .sort(
          (left, right) =>
            (right.viewer_percentage ?? 0) - (left.viewer_percentage ?? 0)
        )
        .slice(0, 10)
        .map((row) => ({
          ageGroup: row.age_group,
          gender: row.gender,
          viewerPercentage: round(Math.max(0, row.viewer_percentage ?? 0), 2),
        })),
      topGeographies: channelContextRaw.geography
        .slice()
        .sort((left, right) => (right.views ?? 0) - (left.views ?? 0))
        .slice(0, 12)
        .map((row) => ({
          country: row.country,
          views: Math.max(0, row.views ?? 0),
          estimatedWatchHours: round(Math.max(0, row.estimated_watch_hours ?? 0), 2),
        })),
    },
    historicalSummary: {
      totalVideos: historicalWithAvp.length,
      topByViews: historicalWithAvp
        .slice()
        .sort((left, right) => (right.views ?? 0) - (left.views ?? 0))
        .slice(0, 12),
      topByWatchHours: historicalWithAvp
        .slice()
        .sort((left, right) => right._watchHours - left._watchHours)
        .slice(0, 12),
      topByAverageViewPercentage: historicalWithAvp
        .filter((video) => (video.views ?? 0) >= 100_000)
        .slice()
        .sort((left, right) => right._avgViewPct - left._avgViewPct)
        .slice(0, 12),
      topByNetSubscribers: historicalWithAvp
        .slice()
        .sort((left, right) => right._netSubscribers - left._netSubscribers)
        .slice(0, 12),
      recent90dTopPerformers: historicalWithAvp
        .filter((video) => (video.published_at?.slice(0, 10) ?? "") >= recent90dFloor)
        .slice()
        .sort((left, right) => (right.views ?? 0) - (left.views ?? 0))
        .slice(0, 16),
    },
    externalSignals,
  };
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(Math.round(value));
}

function formatDecimal(value: number, digits = 2) {
  return round(value, digits).toFixed(digits);
}

function formatPercentValue(value: number, digits = 1) {
  return `${round(value, digits).toFixed(digits)}%`;
}

function formatRatioPercent(value: number, digits = 1) {
  return `${round(value * 100, digits).toFixed(digits)}%`;
}

function buildMoonAnalysisBriefing(dataset: MoonAnalysisDataset) {
  const lines: string[] = [];

  lines.push("# Moon Analysis Briefing");
  lines.push("");
  lines.push(`Scope: ${dataset.scope.scopeLabel}`);
  lines.push(`Window: ${dataset.scope.windowLabel}`);
  lines.push(`Scope type: ${dataset.scope.scopeType}`);
  lines.push(`Target video: ${dataset.scope.targetVideoTitle ?? "none"}`);
  lines.push(
    `Cohort size: ${dataset.cohortSummary.videoCount} long-form video${dataset.cohortSummary.videoCount === 1 ? "" : "s"}`
  );
  if (dataset.scope.notes.trim()) {
    lines.push(`Operator notes: ${dataset.scope.notes.trim()}`);
  }
  lines.push("");

  if (dataset.cohortSummary.videoCount === 1) {
    lines.push(
      "Important context: this scope contains only one long-form upload, so the report should compare that video against Moon historical winners, recent 90-day leaders, and channel context instead of forcing in-cohort winner/loser comparisons."
    );
    lines.push("");
  }

  lines.push("## Cohort Summary");
  lines.push(
    `Median views ${formatNumber(dataset.cohortSummary.medianViews)} | median watch hours ${formatDecimal(dataset.cohortSummary.medianWatchHours, 1)} | median avg view % ${formatPercentValue(dataset.cohortSummary.medianAverageViewPercentage, 2)} | median net subscribers ${formatNumber(dataset.cohortSummary.medianNetSubscribers)}`
  );
  lines.push("");

  lines.push("## Cohort Videos");
  lines.push("");
  for (const video of dataset.cohortVideos) {
    const checkpoints =
      video.retention?.checkpoints
        .map(
          (checkpoint) =>
            `${checkpoint.label} watch ${formatRatioPercent(
              checkpoint.audienceWatchRatio
            )} / relative ${formatRatioPercent(
              checkpoint.relativeRetentionPerformance
            )}`
        )
        .join(" | ") ?? "Retention unavailable";
    const zoneAverages =
      video.retention?.zoneAverages
        .map(
          (zone) =>
            `${zone.label}: watch ${formatRatioPercent(
              zone.averageWatchRatio
            )}, relative ${formatRatioPercent(zone.averageRelativeRetention)}`
        )
        .join(" | ") ?? "Retention unavailable";
    const biggestDrops =
      video.retention?.biggestDrops
        .slice(0, 3)
        .map(
          (drop) =>
            `${Math.round(drop.startRatio * 100)}%-${Math.round(
              drop.endRatio * 100
            )}% ${formatRatioPercent(drop.deltaWatchRatio)}`
        )
        .join(" | ") ?? "none";
    const biggestRebounds =
      video.retention?.biggestRebounds
        .slice(0, 3)
        .map(
          (rebound) =>
            `${Math.round(rebound.startRatio * 100)}%-${Math.round(
              rebound.endRatio * 100
            )}% +${formatRatioPercent(rebound.deltaWatchRatio)}`
        )
        .join(" | ") ?? "none";

    lines.push(`### ${video.title}`);
    lines.push(`Video id: ${video.youtubeVideoId}`);
    lines.push(
      `Published: ${video.publishedAt ?? "unknown"} | duration: ${video.durationSeconds}s | source: ${video.sourceUrl}`
    );
    lines.push(
      `Performance: ${formatNumber(video.views)} views | ${formatDecimal(
        video.estimatedWatchHours,
        1
      )} watch hours | ${formatPercentValue(
        video.averageViewPercentage,
        2
      )} avg view % | ${formatNumber(video.netSubscribers)} net subscribers | performance score ${formatDecimal(
        video.performanceScore,
        3
      )} (${video.performanceTier})`
    );
    lines.push(
      `Engagement: ${formatNumber(video.likes)} likes | ${formatNumber(
        video.comments
      )} comments | ${formatNumber(video.shares)} shares`
    );
    lines.push(
      `Percentiles within scope: views ${formatRatioPercent(
        video.cohortPercentiles.views
      )} | watch hours ${formatRatioPercent(
        video.cohortPercentiles.watchHours
      )} | avg view % ${formatRatioPercent(
        video.cohortPercentiles.averageViewPercentage
      )} | net subscribers ${formatRatioPercent(
        video.cohortPercentiles.netSubscribers
      )} | retention 25% ${formatRatioPercent(
        video.cohortPercentiles.retention25
      )} | retention 50% ${formatRatioPercent(video.cohortPercentiles.retention50)}`
    );
    lines.push(`Heuristics: ${video.heuristics.join(" | ") || "none"}`);
    lines.push(
      `Transcript: ${video.transcript.source} | ${formatNumber(
        video.transcript.wordCount
      )} words | ${formatNumber(video.transcript.segmentCount)} segments`
    );
    lines.push(`Transcript top terms: ${video.transcript.topTerms.join(", ") || "none"}`);
    lines.push(`Hook terms: ${video.transcript.hookTerms.join(", ") || "none"}`);
    lines.push(`Intro excerpt: ${video.transcript.introExcerpt || "none"}`);
    lines.push("Transcript windows:");
    for (const window of video.transcript.windows) {
      lines.push(
        `- ${window.label} (${window.startSeconds}s-${window.endSeconds}s, ${window.wordCount} words): ${window.excerpt || "none"}`
      );
    }
    lines.push(`Retention checkpoints: ${checkpoints}`);
    lines.push(`Retention zones: ${zoneAverages}`);
    lines.push(`Biggest drops: ${biggestDrops}`);
    lines.push(`Biggest rebounds: ${biggestRebounds}`);
    lines.push("");
  }

  lines.push("## Channel Context Last 30 Days");
  lines.push(
    `Top traffic sources: ${dataset.channelContext.topTrafficSources
      .map(
        (row) =>
          `${row.sourceType} ${formatNumber(row.views)} views (${formatRatioPercent(
            row.viewShare
          )})`
      )
      .join(" | ")}`
  );
  lines.push(
    `Top demographics: ${dataset.channelContext.topDemographics
      .slice(0, 6)
      .map((row) => `${row.ageGroup} ${row.gender} ${formatPercentValue(row.viewerPercentage)}`)
      .join(" | ")}`
  );
  lines.push(
    `Top geographies: ${dataset.channelContext.topGeographies
      .slice(0, 8)
      .map((row) => `${row.country} ${formatNumber(row.views)} views`)
      .join(" | ")}`
  );
  lines.push("");

  lines.push("## Moon Historical Winners");
  lines.push(
    `Top by views: ${dataset.historicalSummary.topByViews
      .slice(0, 8)
      .map((video) => `${video.title} (${formatNumber(video.views ?? 0)} views)`)
      .join(" | ")}`
  );
  lines.push(
    `Top by watch hours: ${dataset.historicalSummary.topByWatchHours
      .slice(0, 8)
      .map((video) => `${video.title} (${formatDecimal(getEstimatedWatchHours(video), 1)}h)`)
      .join(" | ")}`
  );
  lines.push(
    `Top by average view %: ${dataset.historicalSummary.topByAverageViewPercentage
      .slice(0, 8)
      .map((video) => `${video.title} (${formatPercentValue(getAverageViewPercentage(video), 2)})`)
      .join(" | ")}`
  );
  lines.push(
    `Top by net subscribers: ${dataset.historicalSummary.topByNetSubscribers
      .slice(0, 8)
      .map((video) => `${video.title} (${formatNumber(getNetSubscribers(video))} net subs)`)
      .join(" | ")}`
  );
  lines.push(
    `Recent 90-day leaders: ${dataset.historicalSummary.recent90dTopPerformers
      .slice(0, 10)
      .map((video) => `${video.title} (${formatNumber(video.views ?? 0)} views)`)
      .join(" | ")}`
  );
  lines.push("");

  lines.push("## Moon-Fit External Signals");
  if (dataset.externalSignals.length === 0) {
    lines.push("No external Moon-fit outlier signals were found.");
  } else {
    for (const signal of dataset.externalSignals) {
      lines.push(
        `- ${signal.title} | channel ${signal.channelTitle ?? "unknown"} | moon fit ${signal.moonFitScore} (${signal.moonFitBand}) | outlier ${formatDecimal(
          signal.externalOutlierScore ?? 0,
          2
        )} | views ratio ${formatDecimal(signal.viewsRatio ?? 0, 2)} | coverage ${signal.coverageMode ?? "unknown"} | analogs ${signal.analogTitles.join(", ") || "none"} | reasons ${signal.reasonCodes.join(", ") || "none"}`
      );
    }
  }
  lines.push("");

  lines.push("## Report Requirements");
  lines.push("- Use only the briefing above.");
  lines.push("- Be specific about what worked, what failed, and why.");
  lines.push("- Connect transcript patterns to retention patterns.");
  lines.push("- Avoid filler, automation talk, and CTR/thumbnail commentary.");
  lines.push("- Generate idea directions that clearly follow from the evidence.");
  lines.push("");

  return lines.join("\n");
}

async function writeMoonAnalysisArtifacts(args: {
  runId: string;
  dataset: MoonAnalysisDataset;
}) {
  const rootDir = path.resolve(process.cwd(), "data", "moon-analysis", args.runId);
  const videosDir = path.join(rootDir, "videos");
  const transcriptsDir = path.join(rootDir, "transcripts");

  await fs.rm(rootDir, { recursive: true, force: true });
  await fs.mkdir(videosDir, { recursive: true });
  await fs.mkdir(transcriptsDir, { recursive: true });

  const cohortIndex = args.dataset.cohortVideos.map((video) => ({
    youtubeVideoId: video.youtubeVideoId,
    title: video.title,
    publishedAt: video.publishedAt,
    views: video.views,
    averageViewPercentage: video.averageViewPercentage,
    netSubscribers: video.netSubscribers,
    performanceScore: video.performanceScore,
    performanceTier: video.performanceTier,
    transcriptPath: video.transcriptPath,
    detailPath: video.detailPath,
  }));

  const historicalCompact = args.dataset.historicalSummary;
  const briefing = buildMoonAnalysisBriefing(args.dataset);
  const readme = `# Moon Analysis Dataset

Run id: ${args.runId}
Scope: ${args.dataset.scope.scopeLabel}
Window: ${args.dataset.scope.windowLabel}
Target video: ${args.dataset.scope.targetVideoTitle ?? "none"}

Files:
- dataset.json: scope summary, cohort summaries, channel context, historical top lists, external signals.
- cohort-index.json: compact list of the in-scope videos and their per-file paths.
- historical-videos.json: compact Moon history table for broader comparisons.
- videos/*.json: detailed per-video metrics, transcript windows, and retention summaries.
- transcripts/*.txt: full transcript text with timestamps for each cohort video.

Instructions for the analysis agent:
1. Read dataset.json first.
2. Compare the strongest and weakest cohort videos.
3. Inspect videos/*.json for retention curve shape and transcript windows.
4. Read the transcript text files for the biggest winners, biggest misses, and the target video if there is one.
5. Ground every claim in the artifact files. Do not mention CTR, thumbnails, automation plans, or transcript-status housekeeping.
`;

  await Promise.all([
    fs.writeFile(path.join(rootDir, "README.md"), readme, "utf8"),
    fs.writeFile(path.join(rootDir, "briefing.md"), briefing, "utf8"),
    fs.writeFile(path.join(rootDir, "dataset.json"), JSON.stringify(args.dataset, null, 2), "utf8"),
    fs.writeFile(
      path.join(rootDir, "cohort-index.json"),
      JSON.stringify(cohortIndex, null, 2),
      "utf8"
    ),
    fs.writeFile(
      path.join(rootDir, "historical-videos.json"),
      JSON.stringify(
        args.dataset.historicalSummary.recent90dTopPerformers
          .concat(args.dataset.historicalSummary.topByViews)
          .concat(args.dataset.historicalSummary.topByNetSubscribers)
          .map((video) => ({
            youtubeVideoId: video.youtube_video_id,
            title: video.title,
            publishedAt: video.published_at,
            durationSeconds: video.duration_seconds,
            views: video.views,
            estimatedWatchHours: round(getEstimatedWatchHours(video), 2),
            averageViewPercentage: round(getAverageViewPercentage(video), 2),
            netSubscribers: getNetSubscribers(video),
          })),
        null,
        2
      ),
      "utf8"
    ),
    fs.writeFile(
      path.join(rootDir, "external-signals.json"),
      JSON.stringify(args.dataset.externalSignals, null, 2),
      "utf8"
    ),
  ]);

  await Promise.all(
    args.dataset.cohortVideos.map((video) =>
      fs.writeFile(
        path.join(rootDir, video.detailPath),
        JSON.stringify(video, null, 2),
        "utf8"
      )
    )
  );

  return rootDir;
}

async function writeTranscriptArtifacts(args: {
  rootDir: string;
  cohortVideos: ArtifactVideoRecord[];
  transcriptsByVideoId: Map<string, ClipTranscriptSegment[]>;
}) {
  await Promise.all(
    args.cohortVideos.map(async (video) => {
      const transcriptSegments = args.transcriptsByVideoId.get(video.youtubeVideoId) ?? [];
      await fs.writeFile(
        path.join(args.rootDir, video.transcriptPath),
        buildTranscriptFileBody(transcriptSegments),
        "utf8"
      );
    })
  );
}

/**
 * Call the Anthropic Messages API directly for structured JSON output.
 * Avoids the Agent SDK which enters plan mode and tries to use tools.
 */
async function runAnthropicJsonQuery(args: {
  systemPrompt: string;
  userPrompt: string;
  outputSchema: Record<string, unknown>;
}) {
  const apiKey = requireEnv("ANTHROPIC_API_KEY");
  const model = getEnv().ANTHROPIC_MODEL;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CLAUDE_SYNTHESIS_TIMEOUT_MS);

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        max_tokens: 16384,
        system: args.systemPrompt,
        messages: [
          {
            role: "user",
            content: `${args.userPrompt}\n\nReturn a single valid JSON object matching this schema. No markdown fences, no prose — only the JSON object.\n\nSchema:\n${JSON.stringify(args.outputSchema, null, 2)}`,
          },
        ],
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => `status ${res.status}`);
      throw new Error(`Anthropic API error (${res.status}): ${errText.slice(0, 400)}`);
    }

    const data = await res.json();
    const textBlock = data.content?.find(
      (b: { type: string }) => b.type === "text"
    );

    if (!textBlock?.text?.trim()) {
      throw new Error(
        `Anthropic API returned empty response (stop_reason=${data.stop_reason ?? "unknown"})`
      );
    }

    // Extract JSON — strip markdown fences if the model wrapped it
    let jsonText = textBlock.text.trim();
    const fenceMatch = jsonText.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
    if (fenceMatch) {
      jsonText = fenceMatch[1].trim();
    }

    try {
      return JSON.parse(jsonText);
    } catch {
      throw new Error(
        `Anthropic API returned non-JSON: ${truncateText(jsonText, 360)}`
      );
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error(
        `Anthropic API timed out after ${Math.round(CLAUDE_SYNTHESIS_TIMEOUT_MS / 1000)}s.`
      );
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

async function synthesizeMoonAnalysisReport(args: {
  artifactDir: string;
  dataset: MoonAnalysisDataset;
}) {
  const outputSchema = z.toJSONSchema(moonAnalysisReportSchema);
  const systemPrompt = `You are Moon's YouTube performance analysis agent. Work like a senior channel strategist, not a generic growth coach.

Use only the briefing provided in the user prompt. Prefer concrete pattern extraction over vague advice. Prioritize:
- why the strongest videos won
- where the weaker videos lost viewers or failed to convert
- transcript and retention interactions
- patterns that can generate new Moon-worthy ideas

Do not mention automation targets, transcript-status housekeeping, CTR, thumbnail refresh plans, or missing data sections unless the files explicitly require it.`;
  const briefing = buildMoonAnalysisBriefing(args.dataset);
  const userPrompt = `${briefing}

Return a structured report with these requirements:
- ` + "`summary`" + ` should explain what worked, what failed, and why in this scope.
- ` + "`numbersThatMatter`" + ` should use comparisons and deltas, not just raw totals.
- ` + "`cohortRows`" + ` must cover every cohort video.
- ` + "`transcriptFindings`" + ` should connect transcript content to performance, not just restate titles.
- ` + "`retentionFindings`" + ` should use the curve shape, not only one checkpoint.
- ` + "`targetDiagnosis`" + ` should be null only when no clear target diagnosis is useful.
- ` + "`winnerPatterns`" + ` should generalize repeatable editorial patterns.
- ` + "`historicalOutliers`" + ` should relate this scope to Moon's broader winners.
- ` + "`externalSignals`" + ` should only include genuinely Moon-fit external outliers.
 - ` + "`ideaDirections`" + ` must be actionable, evidence-backed video directions.
 - Keep every field concrete and specific to Moon.`;
  const payload = await runAnthropicJsonQuery({
    systemPrompt,
    userPrompt,
    outputSchema: outputSchema as Record<string, unknown>,
  });

  return moonAnalysisReportSchema.parse(payload);
}

export async function createMoonAnalysisRun(input: MoonAnalysisRequest) {
  const request = moonAnalysisRequestSchema.parse(input);
  const db = getDb();
  const provisionalEndDate = request.endDate ?? todayUtcDate();
  const provisionalWindowDays = request.scopeType === "weekly" ? 7 : 30;
  const provisionalStartDate = addDays(provisionalEndDate, -(provisionalWindowDays - 1));

  const [run] = await db
    .insert(moonAnalysisRuns)
    .values({
      status: "pending",
      scopeType: request.scopeType,
      scopeStartDate: provisionalStartDate,
      scopeEndDate: provisionalEndDate,
      youtubeVideoId: request.youtubeVideoId ?? null,
      label:
        request.scopeType === "video" && request.youtubeVideoId
          ? `Moon video ${request.youtubeVideoId}`
          : `Moon ${request.scopeType} analysis`,
      requestJson: request,
    })
    .returning();

  return serializeRunRecord(run);
}

export async function enqueueMoonAnalysisRun(runId: string) {
  ensureMoonAnalysisEnvironment();
  const db = getDb();

  spawnLocalMoonAnalysisWorker(runId);

  await db
    .update(moonAnalysisRuns)
    .set({
      status: "queued",
      updatedAt: new Date(),
      errorText: null,
    })
    .where(eq(moonAnalysisRuns.id, runId));

  return {
    mode: "inline" as const,
    status: "queued" as const,
  };
}

export async function runMoonAnalysisTask(input: { runId: string }) {
  ensureMoonAnalysisEnvironment();

  const db = getDb();
  const run = await db
    .select()
    .from(moonAnalysisRuns)
    .where(eq(moonAnalysisRuns.id, input.runId))
    .limit(1)
    .then((rows) => rows[0] ?? null);

  if (!run) {
    throw new Error(`Moon analysis run not found: ${input.runId}`);
  }

  const request = moonAnalysisRequestSchema.parse(run.requestJson);

  await db
    .update(moonAnalysisRuns)
    .set({
      status: "running",
      errorText: null,
      startedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(moonAnalysisRuns.id, input.runId));

  try {
    console.log(`[moon-analysis] run ${input.runId}: assembling dataset`);
    const dataset = await assembleMoonAnalysisDataset({ request });
    console.log(
      `[moon-analysis] run ${input.runId}: dataset ready (${dataset.cohortVideos.length} videos)`
    );
    const artifactDir = await writeMoonAnalysisArtifacts({
      runId: input.runId,
      dataset,
    });
    console.log(`[moon-analysis] run ${input.runId}: artifacts written to ${artifactDir}`);

    const transcriptsByVideoId = new Map<string, ClipTranscriptSegment[]>();
    console.log(`[moon-analysis] run ${input.runId}: collecting transcripts`);
    for (const video of dataset.cohortVideos) {
      const sourceUrl = video.sourceUrl;
      const clipId = await upsertClipInLibrary({
        provider: "youtube",
        externalId: video.youtubeVideoId,
        title: video.title,
        sourceUrl,
        previewUrl: video.thumbnailUrl,
        channelOrContributor: "Moon",
        durationMs: video.durationSeconds > 0 ? video.durationSeconds * 1000 : null,
        viewCount: video.views,
        uploadDate: video.publishedAt?.slice(0, 10) ?? null,
      });
      const transcript = await ensureYouTubeTranscript(clipId, video.youtubeVideoId);
      transcriptsByVideoId.set(video.youtubeVideoId, transcript ?? []);
    }
    await writeTranscriptArtifacts({
      rootDir: artifactDir,
      cohortVideos: dataset.cohortVideos,
      transcriptsByVideoId,
    });
    console.log(`[moon-analysis] run ${input.runId}: transcripts written`);

    await db
      .update(moonAnalysisRuns)
      .set({
        scopeStartDate: dataset.scope.startDate,
        scopeEndDate: dataset.scope.endDate,
        youtubeVideoId: dataset.scope.targetVideoId,
        youtubeVideoTitle: dataset.scope.targetVideoTitle,
        label: dataset.scope.label,
        artifactDir,
        updatedAt: new Date(),
      })
      .where(eq(moonAnalysisRuns.id, input.runId));

    const report = await synthesizeMoonAnalysisReport({
      artifactDir,
      dataset,
    });
    console.log(`[moon-analysis] run ${input.runId}: synthesis complete`);

    const reportHtml = renderMoonAnalysisHtml({
      run: {
        id: input.runId,
        scopeType: dataset.scope.scopeType,
        scopeStartDate: dataset.scope.startDate,
        scopeEndDate: dataset.scope.endDate,
      },
      report,
    });

    await db
      .update(moonAnalysisRuns)
      .set({
        status: "complete",
        scopeStartDate: dataset.scope.startDate,
        scopeEndDate: dataset.scope.endDate,
        youtubeVideoId: dataset.scope.targetVideoId,
        youtubeVideoTitle: dataset.scope.targetVideoTitle,
        label: dataset.scope.label,
        artifactDir,
        resultJson: report,
        reportHtml,
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(moonAnalysisRuns.id, input.runId));

    const completedRun = await db
      .select()
      .from(moonAnalysisRuns)
      .where(eq(moonAnalysisRuns.id, input.runId))
      .limit(1)
      .then((rows) => rows[0] ?? null);

    console.log(`[moon-analysis] run ${input.runId}: completed`);
    return completedRun ? serializeRunRecord(completedRun) : null;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown moon analysis failure";
    console.error(`[moon-analysis] run ${input.runId}: failed`, message);
    await db
      .update(moonAnalysisRuns)
      .set({
        status: "failed",
        errorText: message,
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(moonAnalysisRuns.id, input.runId));
    throw error;
  }
}

export async function getMoonAnalysisRun(runId: string): Promise<MoonAnalysisRun | null> {
  if (!isUuid(runId)) {
    return null;
  }

  const db = getDb();
  const run = await db
    .select()
    .from(moonAnalysisRuns)
    .where(eq(moonAnalysisRuns.id, runId))
    .limit(1)
    .then((rows) => rows[0] ?? null);

  return run ? serializeRunRecord(run) : null;
}

export async function listRecentMoonAnalysisRuns(limit = 10): Promise<MoonAnalysisRun[]> {
  const db = getDb();
  const runs = await db
    .select()
    .from(moonAnalysisRuns)
    .orderBy(desc(moonAnalysisRuns.createdAt))
    .limit(limit);

  return runs.map((run) => serializeRunRecord(run));
}
