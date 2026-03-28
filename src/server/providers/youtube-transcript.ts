import "server-only";

import { execFile } from "node:child_process";
import { readdir, readFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";

import { getEnv } from "@/server/config/env";

const execFileAsync = promisify(execFile);

interface YtDlpInvocation {
  bin: string;
  prefixArgs: string[];
  label: string;
}

export interface TranscriptSegment {
  text: string;
  startMs: number;
  durationMs: number;
}

/**
 * Extracts auto-generated transcript from a YouTube video using yt-dlp.
 * Uses execFile (not exec) to prevent shell injection — videoId is passed
 * as an array argument, never interpolated into a shell string.
 */
export async function extractYouTubeTranscript(
  videoId: string
): Promise<TranscriptSegment[]> {
  // Validate videoId format to be safe
  if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
    throw new Error(`Invalid YouTube video ID: ${videoId}`);
  }

  const tmpFile = join(tmpdir(), `yt-transcript-${randomUUID()}`);
  const tmpDir = dirname(tmpFile);
  const tmpBase = basename(tmpFile);

  const env = getEnv();
  const invocations: YtDlpInvocation[] = [
    {
      bin: env.MOON_YTDLP_BIN,
      prefixArgs: [],
      label: "moon-wrapper",
    },
  ];

  if (env.MOON_YTDLP_BIN !== "yt-dlp") {
    invocations.push({
      bin: "yt-dlp",
      prefixArgs: ["--js-runtimes", "node"],
      label: "agent-reach-compatible-path-yt-dlp",
    });
  }

  const errors: string[] = [];

  try {
    for (const invocation of invocations) {
      try {
        await runYtDlpTranscriptExtraction(invocation, videoId, tmpFile);
        return await loadTranscriptSegmentsFromTmpDir(tmpDir, tmpBase);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        errors.push(`${invocation.label}: ${msg}`);
        await cleanupTmpSubtitleFiles(tmpDir, tmpBase);
      }
    }

    throw new Error(errors.join(" | "));
  } catch (error) {
    await cleanupTmpSubtitleFiles(tmpDir, tmpBase);
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(`Transcript extraction failed: ${msg}`);
  }
}

async function runYtDlpTranscriptExtraction(
  invocation: YtDlpInvocation,
  videoId: string,
  outputPath: string,
) {
  await execFileAsync(
    invocation.bin,
    [
      ...invocation.prefixArgs,
      "--write-sub",
      "--write-auto-sub",
      "--sub-lang", "en",
      "--sub-format", "json3",
      "--skip-download",
      "--no-warnings",
      "--quiet",
      "-o", outputPath,
      `https://www.youtube.com/watch?v=${videoId}`,
    ],
    { timeout: 30000 },
  );
}

async function cleanupTmpSubtitleFiles(tmpDir: string, tmpBase: string) {
  const leftoverFiles = await readdir(tmpDir).catch(() => []);
  await Promise.all(
    leftoverFiles
      .filter((name) => name.startsWith(`${tmpBase}.`) && name.endsWith(".json3"))
      .map((name) => unlink(join(tmpDir, name)).catch(() => {}))
  );
}

async function loadTranscriptSegmentsFromTmpDir(tmpDir: string, tmpBase: string) {
  const subtitleFiles = (await readdir(tmpDir))
    .filter((name) => name.startsWith(`${tmpBase}.`) && name.endsWith(".json3"))
    .sort();

  if (subtitleFiles.length === 0) {
    throw new Error("yt-dlp did not produce a json3 subtitle file");
  }

  const jsonPath = join(tmpDir, subtitleFiles[0]);
  const content = await readFile(jsonPath, "utf8");
  await cleanupTmpSubtitleFiles(tmpDir, tmpBase);

  const data = JSON.parse(content) as {
    events?: Array<{
      tStartMs?: number;
      dDurationMs?: number;
      segs?: Array<{ utf8?: string }>;
    }>;
  };

  const segments: TranscriptSegment[] = [];
  for (const event of data.events ?? []) {
    if (!event.segs || event.tStartMs === undefined) continue;

    const text = event.segs
      .map((s) => s.utf8 ?? "")
      .join("")
      .replace(/\n/g, " ")
      .trim();

    if (!text) continue;

    segments.push({
      text,
      startMs: event.tStartMs,
      durationMs: event.dDurationMs ?? 0,
    });
  }

  return segments;
}

/**
 * Merges short transcript segments into sentence-level chunks.
 */
export function mergeTranscriptSegments(
  segments: TranscriptSegment[],
  maxChunkMs: number = 15000
): TranscriptSegment[] {
  if (segments.length === 0) return [];

  const merged: TranscriptSegment[] = [];
  let current = { ...segments[0] };

  for (let i = 1; i < segments.length; i++) {
    const seg = segments[i];
    const elapsed = seg.startMs - current.startMs;

    if (elapsed < maxChunkMs && !current.text.endsWith(".")) {
      current.text += " " + seg.text;
      current.durationMs = seg.startMs + seg.durationMs - current.startMs;
    } else {
      merged.push(current);
      current = { ...seg };
    }
  }

  merged.push(current);
  return merged;
}
