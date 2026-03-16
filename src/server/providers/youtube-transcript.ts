import "server-only";

import { YoutubeTranscript } from "youtube-transcript";

export interface TranscriptSegment {
  text: string;
  startMs: number;
  durationMs: number;
}

/**
 * Extracts auto-generated transcript from a YouTube video.
 */
export async function extractYouTubeTranscript(
  videoId: string
): Promise<TranscriptSegment[]> {
  const raw = await YoutubeTranscript.fetchTranscript(videoId, {
    lang: "en",
  });

  return raw.map((item) => ({
    text: item.text.replace(/\n/g, " ").trim(),
    startMs: Math.round(item.offset),
    durationMs: Math.round(item.duration),
  }));
}

/**
 * Merges short transcript segments into sentence-level chunks
 * for better quote extraction.
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
