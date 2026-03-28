import "server-only";

import { execFile } from "node:child_process";
import { access, mkdir, readFile, rm, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { promisify } from "node:util";

import { getEnv, getLocalMediaCacheRoot } from "@/server/config/env";
import {
  cacheTranscriptSegments,
  upsertClipInLibrary,
} from "@/server/services/clip-library";

const execFileAsync = promisify(execFile);

// ─── Concurrency control ───
// Limit concurrent heavy processes on the server (1 download + 1 transcription
// at a time). In-flight maps deduplicate concurrent requests for the same key.

class Semaphore {
  private queue: Array<() => void> = [];
  constructor(private slots: number) {}
  acquire(): Promise<() => void> {
    return new Promise((resolve) => {
      const tryAcquire = () => {
        if (this.slots > 0) {
          this.slots--;
          resolve(() => {
            this.slots++;
            const next = this.queue.shift();
            if (next) next();
          });
        } else {
          this.queue.push(tryAcquire);
        }
      };
      tryAcquire();
    });
  }
}

const downloadSemaphore = new Semaphore(1);
const transcribeSemaphore = new Semaphore(1);
const inFlightDownloads = new Map<string, Promise<string>>();
const inFlightTranscriptions = new Map<string, Promise<{ transcriptPath: string; transcript: LocalMediaTranscriptSegment[] }>>();
const TRANSCRIPTION_LOCK_POLL_MS = 1_000;
const TRANSCRIPTION_LOCK_STALE_MS = 45 * 60_000;
const TRANSCRIPTION_LOCK_TIMEOUT_MS = 35 * 60_000;

export interface LocalMediaTranscriptSegment {
  text: string;
  startMs: number;
  durationMs: number;
}

export interface LocalMediaArtifacts {
  clipId: string;
  clipProvider: "youtube" | "twitter" | "internet_archive" | "internal";
  providerName: string;
  externalId: string;
  title: string;
  sourceUrl: string;
  pageUrl: string;
  previewUrl: string | null;
  channelOrContributor: string | null;
  creatorHandle: string | null;
  durationMs: number | null;
  viewCount: number | null;
  likeCount: number | null;
  commentCount: number | null;
  shareCount: number | null;
  uploadDate: string | null;
  publishedAt: string | null;
  description: string | null;
  transcript: LocalMediaTranscriptSegment[];
  transcriptText: string;
  mediaPath: string;
  transcriptPath: string;
  metadataJson: Record<string, unknown>;
}

export interface ResolvedLocalMediaMetadata {
  clipProvider: "youtube" | "twitter" | "internet_archive" | "internal";
  providerName: string;
  externalId: string;
  title: string;
  sourceUrl: string;
  pageUrl: string;
  previewUrl: string | null;
  channelOrContributor: string | null;
  creatorHandle: string | null;
  durationMs: number | null;
  viewCount: number | null;
  likeCount: number | null;
  commentCount: number | null;
  shareCount: number | null;
  uploadDate: string | null;
  publishedAt: string | null;
  description: string | null;
  cacheKey: string;
  metadataJson: Record<string, unknown>;
}

type YtDlpMetadata = {
  id?: unknown;
  title?: unknown;
  description?: unknown;
  uploader?: unknown;
  uploader_id?: unknown;
  channel?: unknown;
  channel_id?: unknown;
  duration?: unknown;
  view_count?: unknown;
  like_count?: unknown;
  comment_count?: unknown;
  repost_count?: unknown;
  share_count?: unknown;
  timestamp?: unknown;
  upload_date?: unknown;
  thumbnail?: unknown;
  webpage_url?: unknown;
  extractor?: unknown;
  extractor_key?: unknown;
  original_url?: unknown;
};

function asNonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function parseUploadDateToIso(uploadDate: string | null) {
  if (!uploadDate || !/^\d{8}$/.test(uploadDate)) {
    return null;
  }

  const year = Number(uploadDate.slice(0, 4));
  const month = Number(uploadDate.slice(4, 6));
  const day = Number(uploadDate.slice(6, 8));
  const timestamp = Date.UTC(year, month - 1, day, 0, 0, 0, 0);

  if (!Number.isFinite(timestamp)) {
    return null;
  }

  return new Date(timestamp).toISOString();
}

function normalizeProviderName(value: string | null) {
  const normalized = value?.trim().toLowerCase() ?? "";

  if (!normalized) return "web";
  if (normalized === "generic") return "web";
  if (normalized === "x" || normalized === "twitter") return "twitter";
  if (normalized.includes("youtube")) return "youtube";
  if (normalized.includes("archive")) return "internet_archive";
  if (normalized.includes("github")) return "github";
  if (normalized.includes("reddit")) return "reddit";
  if (normalized.includes("tiktok")) return "tiktok";
  if (normalized.includes("instagram")) return "instagram";
  if (normalized.includes("threads")) return "threads";
  if (normalized.includes("linkedin")) return "linkedin";
  if (normalized.includes("spotify")) return "spotify";
  if (normalized.includes("apple")) return "apple_podcasts";
  if (normalized.includes("omny")) return "omny";
  if (normalized.includes("megaphone")) return "megaphone";
  if (normalized.includes("simplecast")) return "simplecast";
  if (normalized.includes("buzzsprout")) return "buzzsprout";
  if (normalized.includes("podbean")) return "podbean";

  return normalized.replace(/[^a-z0-9]+/g, "_");
}

function mapProviderToClipProvider(
  providerName: string
): "youtube" | "twitter" | "internet_archive" | "internal" {
  if (providerName === "youtube") return "youtube";
  if (providerName === "twitter") return "twitter";
  if (providerName === "internet_archive") return "internet_archive";
  return "internal";
}

function buildUrlHash(sourceUrl: string) {
  return createHash("sha1").update(sourceUrl).digest("hex").slice(0, 16);
}

function buildCacheKey(clipProvider: string, externalId: string, sourceUrl: string) {
  const safeExternalId = externalId
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return `${clipProvider}-${safeExternalId || buildUrlHash(sourceUrl)}`;
}

function joinCachePath(...parts: string[]) {
  return path.join(getLocalMediaCacheRoot(), ...parts);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ensureCacheDirs() {
  await Promise.all([
    mkdir(joinCachePath("downloads"), { recursive: true }),
    mkdir(joinCachePath("transcripts"), { recursive: true }),
    mkdir(joinCachePath("tmp"), { recursive: true }),
  ]);
}

async function fileExists(filePath: string) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function acquirePathLock(args: {
  lockPath: string;
  readyPath: string;
  timeoutMs: number;
  staleMs: number;
}) {
  const deadline = Date.now() + args.timeoutMs;

  while (true) {
    if (await fileExists(args.readyPath)) {
      return null;
    }

    try {
      await mkdir(args.lockPath);
      return async () => {
        await rm(args.lockPath, { recursive: true, force: true });
      };
    } catch (error) {
      const code =
        typeof error === "object" && error && "code" in error
          ? String((error as { code?: unknown }).code)
          : null;

      if (code !== "EEXIST") {
        throw error;
      }

      try {
        const lockStat = await stat(args.lockPath);
        if (Date.now() - lockStat.mtimeMs > args.staleMs) {
          await rm(args.lockPath, { recursive: true, force: true });
          continue;
        }
      } catch {
        continue;
      }

      if (Date.now() >= deadline) {
        throw new Error(`Timed out waiting for media lock ${args.lockPath}`);
      }

      await sleep(TRANSCRIPTION_LOCK_POLL_MS);
    }
  }
}

async function runYtDlp(args: string[], timeoutMs: number) {
  const env = getEnv();
  const { stdout } = await execFileAsync(env.MOON_YTDLP_BIN, args, {
    timeout: timeoutMs,
    maxBuffer: 16 * 1024 * 1024,
  });

  return stdout.trim();
}

export async function resolveLocalMediaMetadata(args: {
  sourceUrl: string;
  providerName?: string | null;
  title?: string | null;
}): Promise<ResolvedLocalMediaMetadata | null> {
  await ensureCacheDirs();

  let rawMetadata: YtDlpMetadata;
  try {
    const stdout = await runYtDlp(
      [
        "--no-playlist",
        "--no-warnings",
        "--quiet",
        "--dump-single-json",
        args.sourceUrl,
      ],
      90_000
    );
    rawMetadata = JSON.parse(stdout) as YtDlpMetadata;
  } catch {
    return null;
  }

  const extractorProvider = normalizeProviderName(
    asNonEmptyString(rawMetadata.extractor_key) ??
      asNonEmptyString(rawMetadata.extractor)
  );
  const inferredProvider =
    extractorProvider !== "web"
      ? extractorProvider
      : normalizeProviderName(args.providerName ?? null);
  const clipProvider = mapProviderToClipProvider(inferredProvider);
  const pageUrl =
    asNonEmptyString(rawMetadata.webpage_url) ??
    asNonEmptyString(rawMetadata.original_url) ??
    args.sourceUrl;
  const externalId =
    asNonEmptyString(rawMetadata.id) ?? buildUrlHash(pageUrl);
  const cacheKey = buildCacheKey(clipProvider, externalId, pageUrl);
  const title =
    asNonEmptyString(rawMetadata.title) ??
    args.title?.trim() ??
    pageUrl;
  const durationSeconds = asNumber(rawMetadata.duration);
  const viewCount = asNumber(rawMetadata.view_count);
  const likeCount = asNumber(rawMetadata.like_count);
  const commentCount = asNumber(rawMetadata.comment_count);
  const shareCount = asNumber(rawMetadata.repost_count) ?? asNumber(rawMetadata.share_count);
  const uploadDate = asNonEmptyString(rawMetadata.upload_date);
  const timestampSeconds = asNumber(rawMetadata.timestamp);
  const publishedAt =
    timestampSeconds && timestampSeconds > 0
      ? new Date(timestampSeconds * 1000).toISOString()
      : parseUploadDateToIso(uploadDate);
  const creatorHandle =
    asNonEmptyString(rawMetadata.uploader_id) ??
    asNonEmptyString(rawMetadata.channel_id);
  const metadataJson: Record<string, unknown> = {
    cacheKey,
    extractor: asNonEmptyString(rawMetadata.extractor),
    extractorKey: asNonEmptyString(rawMetadata.extractor_key),
    resolvedProviderName: inferredProvider,
    originalSourceUrl: args.sourceUrl,
    pageUrl,
  };

  const description = asNonEmptyString(rawMetadata.description);
  if (description) {
    metadataJson.description = description;
  }

  const thumbnail = asNonEmptyString(rawMetadata.thumbnail);
  if (thumbnail) {
    metadataJson.thumbnail = thumbnail;
  }

  if (creatorHandle) {
    metadataJson.creatorHandle = creatorHandle;
  }

  if (viewCount !== null && viewCount > 0) {
    metadataJson.viewCount = Math.round(viewCount);
  }

  if (likeCount !== null && likeCount > 0) {
    metadataJson.likeCount = Math.round(likeCount);
  }

  if (commentCount !== null && commentCount > 0) {
    metadataJson.commentCount = Math.round(commentCount);
  }

  if (shareCount !== null && shareCount > 0) {
    metadataJson.shareCount = Math.round(shareCount);
  }

  if (publishedAt) {
    metadataJson.publishedAt = publishedAt;
  }

  return {
    clipProvider,
    providerName: inferredProvider,
    externalId,
    title,
    sourceUrl: args.sourceUrl,
    pageUrl,
    previewUrl: thumbnail,
    channelOrContributor:
      asNonEmptyString(rawMetadata.uploader) ??
      asNonEmptyString(rawMetadata.channel),
    creatorHandle,
    durationMs: durationSeconds ? Math.round(durationSeconds * 1000) : null,
    viewCount: viewCount ? Math.round(viewCount) : null,
    likeCount: likeCount ? Math.round(likeCount) : null,
    commentCount: commentCount ? Math.round(commentCount) : null,
    shareCount: shareCount ? Math.round(shareCount) : null,
    uploadDate,
    publishedAt,
    description,
    cacheKey,
    metadataJson,
  };
}

async function ensureDownloadedAudio(args: {
  sourceUrl: string;
  cacheKey: string;
}) {
  const finalPath = joinCachePath("downloads", `${args.cacheKey}.mp3`);
  if (await fileExists(finalPath)) {
    return finalPath;
  }

  // Deduplicate concurrent requests for the same video
  const existing = inFlightDownloads.get(args.cacheKey);
  if (existing) return existing;

  const work = async () => {
    const release = await downloadSemaphore.acquire();
    try {
      // Re-check after acquiring the semaphore
      if (await fileExists(finalPath)) return finalPath;

      await ensureCacheDirs();

      const stdout = await runYtDlp(
        [
          "--no-playlist",
          "--no-warnings",
          "--quiet",
          "--extract-audio",
          "--audio-format",
          "mp3",
          "--audio-quality",
          "5",
          "--output",
          joinCachePath("downloads", `${args.cacheKey}.%(ext)s`),
          "--print",
          "after_move:filepath",
          args.sourceUrl,
        ],
        10 * 60_000
      );

      const downloadedPath = stdout
        .split("\n")
        .map((entry) => entry.trim())
        .filter(Boolean)
        .slice(-1)[0];

      if (!downloadedPath) {
        throw new Error(`yt-dlp did not report a media path for ${args.sourceUrl}`);
      }

      return downloadedPath;
    } finally {
      release();
      inFlightDownloads.delete(args.cacheKey);
    }
  };

  const promise = work();
  inFlightDownloads.set(args.cacheKey, promise);
  return promise;
}

async function readTranscriptFile(transcriptPath: string) {
  const raw = await readFile(transcriptPath, "utf8");
  const parsed = JSON.parse(raw) as {
    segments?: Array<{ text?: unknown; startMs?: unknown; durationMs?: unknown }>;
  };

  const segments = (parsed.segments ?? [])
    .map((segment) => {
      const text = asNonEmptyString(segment.text);
      const startMs = asNumber(segment.startMs);
      const durationMs = asNumber(segment.durationMs);
      if (!text || startMs === null || durationMs === null) {
        return null;
      }

      return {
        text,
        startMs: Math.max(0, Math.round(startMs)),
        durationMs: Math.max(0, Math.round(durationMs)),
      };
    })
    .filter(
      (
        segment
      ): segment is LocalMediaTranscriptSegment => Boolean(segment)
    );

  return segments;
}

async function ensureTranscriptForMediaFile(args: {
  mediaPath: string;
  cacheKey: string;
}) {
  const transcriptPath = joinCachePath("transcripts", `${args.cacheKey}.json`);
  if (await fileExists(transcriptPath)) {
    const transcript = await readTranscriptFile(transcriptPath);
    return { transcriptPath, transcript };
  }

  // Deduplicate concurrent requests for the same file
  const existing = inFlightTranscriptions.get(args.cacheKey);
  if (existing) return existing;

  const work = async () => {
    const env = getEnv();
    const lockPath = `${transcriptPath}.lock`;
    const releaseLock = await acquirePathLock({
      lockPath,
      readyPath: transcriptPath,
      timeoutMs: TRANSCRIPTION_LOCK_TIMEOUT_MS,
      staleMs: TRANSCRIPTION_LOCK_STALE_MS,
    });

    if (!releaseLock) {
      const transcript = await readTranscriptFile(transcriptPath);
      return { transcriptPath, transcript };
    }

    const release = await transcribeSemaphore.acquire();
    try {
      // Re-check after acquiring the semaphore
      if (await fileExists(transcriptPath)) {
        const transcript = await readTranscriptFile(transcriptPath);
        return { transcriptPath, transcript };
      }

      await ensureCacheDirs();

      const scriptPath = path.resolve(process.cwd(), "scripts/transcribe-local-media.py");
      await execFileAsync(
        env.LOCAL_TRANSCRIBE_PYTHON,
        [
          scriptPath,
          "--input",
          args.mediaPath,
          "--output",
          transcriptPath,
          "--model",
          env.LOCAL_WHISPER_MODEL,
        ],
        {
          timeout: 30 * 60_000,
          maxBuffer: 4 * 1024 * 1024,
        }
      );

      const transcript = await readTranscriptFile(transcriptPath);
      return { transcriptPath, transcript };
    } finally {
      release();
      await releaseLock();
      inFlightTranscriptions.delete(args.cacheKey);
    }
  };

  const promise = work();
  inFlightTranscriptions.set(args.cacheKey, promise);
  return promise;
}

export async function ingestLocalMediaArtifacts(args: {
  sourceUrl: string;
  providerName?: string | null;
  title?: string | null;
}): Promise<LocalMediaArtifacts | null> {
  const metadata = await resolveLocalMediaMetadata(args);
  if (!metadata) {
    return null;
  }

  const mediaPath = await ensureDownloadedAudio({
    sourceUrl: args.sourceUrl,
    cacheKey: metadata.cacheKey,
  });
  const { transcriptPath, transcript } = await ensureTranscriptForMediaFile({
    mediaPath,
    cacheKey: metadata.cacheKey,
  });
  const transcriptText = transcript.map((segment) => segment.text).join(" ").trim();
  const clipId = await upsertClipInLibrary({
    provider: metadata.clipProvider,
    externalId: metadata.externalId,
    title: metadata.title,
    sourceUrl: metadata.pageUrl,
    previewUrl: metadata.previewUrl,
    channelOrContributor: metadata.channelOrContributor,
    durationMs: metadata.durationMs,
    viewCount: metadata.viewCount,
    uploadDate: metadata.uploadDate,
    metadataJson: {
      ...metadata.metadataJson,
      description: metadata.description,
      mediaPath,
      transcriptPath,
      transcriptSegmentCount: transcript.length,
      locallyIngested: true,
    },
  });

  if (transcript.length > 0) {
    await cacheTranscriptSegments(clipId, transcript);
  }

  return {
    clipId,
    clipProvider: metadata.clipProvider,
    providerName: metadata.providerName,
    externalId: metadata.externalId,
    title: metadata.title,
    sourceUrl: metadata.sourceUrl,
    pageUrl: metadata.pageUrl,
    previewUrl: metadata.previewUrl,
    channelOrContributor: metadata.channelOrContributor,
    creatorHandle: metadata.creatorHandle,
    durationMs: metadata.durationMs,
    viewCount: metadata.viewCount,
    likeCount: metadata.likeCount,
    commentCount: metadata.commentCount,
    shareCount: metadata.shareCount,
    uploadDate: metadata.uploadDate,
    publishedAt: metadata.publishedAt,
    description: metadata.description,
    transcript,
    transcriptText,
    mediaPath,
    transcriptPath,
    metadataJson: {
      ...metadata.metadataJson,
      mediaPath,
      transcriptPath,
      transcriptSegmentCount: transcript.length,
    },
  };
}
