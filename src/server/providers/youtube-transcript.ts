import "server-only";

export interface TranscriptSegment {
  text: string;
  startMs: number;
  durationMs: number;
}

/**
 * Extracts auto-generated transcript from a YouTube video.
 * Pure fetch-based — no npm dependencies that break ESM builds.
 */
export async function extractYouTubeTranscript(
  videoId: string
): Promise<TranscriptSegment[]> {
  const pageResponse = await fetch(
    `https://www.youtube.com/watch?v=${videoId}`,
    {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        "Accept-Language": "en-US,en;q=0.9",
      },
    }
  );

  if (!pageResponse.ok) {
    throw new Error(`Failed to fetch YouTube page: ${pageResponse.status}`);
  }

  const html = await pageResponse.text();

  // Find captionTracks in the page's embedded player data
  const captionIdx = html.indexOf('"captionTracks"');
  if (captionIdx === -1) {
    throw new Error("No captions available for this video");
  }

  // Extract the JSON array
  const arrayStart = html.indexOf("[", captionIdx);
  if (arrayStart === -1) throw new Error("Malformed caption data");

  let depth = 0;
  let arrayEnd = arrayStart;
  for (let i = arrayStart; i < html.length && i < arrayStart + 5000; i++) {
    if (html[i] === "[") depth++;
    if (html[i] === "]") {
      depth--;
      if (depth === 0) {
        arrayEnd = i + 1;
        break;
      }
    }
  }

  const captionTracks: Array<{
    baseUrl: string;
    languageCode: string;
    kind?: string;
  }> = JSON.parse(html.slice(arrayStart, arrayEnd));

  if (captionTracks.length === 0) {
    throw new Error("No caption tracks found");
  }

  // Prefer manual English, then auto English, then any
  const track =
    captionTracks.find((t) => t.languageCode === "en" && t.kind !== "asr") ??
    captionTracks.find((t) => t.languageCode === "en") ??
    captionTracks[0];

  // Fetch the transcript as JSON3
  const transcriptUrl = `${track.baseUrl}&fmt=json3`;

  // Pass cookies from the page response to avoid auth issues
  const cookies = pageResponse.headers.getSetCookie?.() ?? [];
  const cookieStr = cookies.map((c) => c.split(";")[0]).join("; ");

  const transcriptResponse = await fetch(transcriptUrl, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      ...(cookieStr ? { Cookie: cookieStr } : {}),
    },
  });

  if (!transcriptResponse.ok) {
    throw new Error(`Failed to fetch transcript: ${transcriptResponse.status}`);
  }

  const text = await transcriptResponse.text();
  if (!text || text.length < 10) {
    throw new Error("Empty transcript response");
  }

  const transcriptData = JSON.parse(text) as {
    events?: Array<{
      tStartMs?: number;
      dDurationMs?: number;
      segs?: Array<{ utf8?: string }>;
    }>;
  };

  const events = transcriptData.events ?? [];
  const segments: TranscriptSegment[] = [];

  for (const event of events) {
    if (!event.segs || event.tStartMs === undefined) continue;

    const segText = event.segs
      .map((s) => s.utf8 ?? "")
      .join("")
      .replace(/\n/g, " ")
      .trim();

    if (!segText) continue;

    segments.push({
      text: segText,
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
