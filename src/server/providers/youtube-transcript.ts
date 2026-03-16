import "server-only";

import { execFile } from "node:child_process";
import { readFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";

const execFileAsync = promisify(execFile);

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
  const jsonPath = `${tmpFile}.en.json3`;

  try {
    // execFile passes args as array — no shell injection possible
    await execFileAsync("yt-dlp", [
      "--write-auto-sub",
      "--sub-lang", "en",
      "--sub-format", "json3",
      "--skip-download",
      "--no-warnings",
      "--quiet",
      "-o", tmpFile,
      `https://www.youtube.com/watch?v=${videoId}`,
    ], { timeout: 30000 });

    const content = await readFile(jsonPath, "utf8");
    await unlink(jsonPath).catch(() => {});

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
  } catch (error) {
    await unlink(jsonPath).catch(() => {});
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(`Transcript extraction failed: ${msg}`);
  }
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
