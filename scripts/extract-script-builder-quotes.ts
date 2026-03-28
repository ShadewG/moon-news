import "server-only";

import { findRelevantQuotes } from "@/server/providers/openai";
import { ingestLocalMediaArtifacts } from "@/server/providers/local-media";
import { ensureYouTubeTranscript, upsertClipInLibrary } from "@/server/services/clip-library";

type InputPayload = {
  lineText: string;
  scriptContext: string;
  sourceUrl: string;
  videoTitle?: string;
  maxQuotes?: number;
};

type QuoteResult = {
  quoteText: string;
  speaker: string | null;
  startMs: number;
  relevanceScore: number;
  context: string;
  videoTitle: string;
  sourceUrl: string;
};

const QUOTE_STOPWORDS = new Set([
  "the", "and", "that", "with", "from", "they", "them", "this", "were", "what", "when", "would",
  "there", "their", "into", "about", "have", "been", "just", "even", "very", "much", "more",
  "than", "then", "onto", "show", "live", "line", "said", "asked", "went", "kept", "still",
  "like", "your", "before", "after", "years", "time", "public", "world", "hosts",
]);

function normalizeForSearch(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9'\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractLineAnchors(lineText: string) {
  const quotedFragments = Array.from(
    lineText.matchAll(/[“"']([^“"'”]{3,90})[”"']/g),
    (match) => normalizeForSearch(match[1] ?? ""),
  ).filter(Boolean);

  const titleCasePhrases = Array.from(
    lineText.matchAll(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})\b/g),
    (match) => normalizeForSearch(match[1] ?? ""),
  ).filter(Boolean);

  const keywordTokens = normalizeForSearch(lineText)
    .split(" ")
    .filter((token) => token.length >= 4 && !QUOTE_STOPWORDS.has(token));

  return Array.from(new Set([...quotedFragments, ...titleCasePhrases, ...keywordTokens]));
}

function transcriptAnchorCoverage(
  transcript: Array<{ text: string; startMs: number; durationMs: number }>,
  lineText: string,
) {
  const anchors = extractLineAnchors(lineText);
  if (anchors.length === 0) return 0;
  const transcriptText = normalizeForSearch(transcript.map((segment) => segment.text).join(" "));
  let hits = 0;
  for (const anchor of anchors) {
    if (!anchor) continue;
    if (transcriptText.includes(anchor)) hits += 1;
  }
  return hits;
}

function extractYouTubeVideoId(url: string) {
  try {
    const decoded = decodeURIComponent(url);
    const parsed = new URL(decoded);
    const hostname = parsed.hostname.replace(/^www\./i, "").toLowerCase();
    if (hostname === "youtu.be") {
      return parsed.pathname.replace(/^\/+/, "").slice(0, 11) || null;
    }
    if (hostname.endsWith("youtube.com")) {
      const v = parsed.searchParams.get("v");
      return v ? v.slice(0, 11) : null;
    }
  } catch {
    // Fall through.
  }

  const match = decodeURIComponent(url).match(/[?&]v=([A-Za-z0-9_-]{11})/);
  return match?.[1] ?? null;
}

async function readStdin() {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function main() {
  const rawInput = await readStdin();
  const payload = JSON.parse(rawInput) as InputPayload;
  const videoId = extractYouTubeVideoId(payload.sourceUrl);

  if (!videoId) {
    process.stdout.write(
      `${JSON.stringify({ provider: "moon-news-quote-extractor", quotes: [] }, null, 2)}\n`,
    );
    return;
  }

  const clipId = await upsertClipInLibrary({
    provider: "youtube",
    externalId: videoId,
    title: payload.sourceUrl,
    sourceUrl: payload.sourceUrl,
    previewUrl: null,
    channelOrContributor: null,
    durationMs: null,
    uploadDate: null,
  });
  let transcript = await ensureYouTubeTranscript(clipId, videoId);
  const initialCoverage = transcript?.length ? transcriptAnchorCoverage(transcript, payload.lineText) : 0;

  if (!transcript?.length || initialCoverage === 0) {
    const localMedia = await ingestLocalMediaArtifacts({
      sourceUrl: payload.sourceUrl,
      providerName: "youtube",
      title: payload.videoTitle ?? payload.sourceUrl,
    }).catch(() => null);
    const localTranscript = localMedia?.transcript ?? [];
    const localCoverage = localTranscript.length ? transcriptAnchorCoverage(localTranscript, payload.lineText) : 0;
    if (
      localTranscript.length > 0
      && (
        !transcript?.length
        || localCoverage > initialCoverage
      )
    ) {
      transcript = localTranscript;
    }
  }

  if (!transcript?.length) {
    process.stdout.write(
      `${JSON.stringify({ provider: "moon-news-quote-extractor", quotes: [] }, null, 2)}\n`,
    );
    return;
  }

  const quotes = await findRelevantQuotes({
    lineText: payload.lineText,
    scriptContext: payload.scriptContext,
    transcript,
    videoTitle: payload.videoTitle ?? payload.sourceUrl,
    maxQuotes: payload.maxQuotes ?? 3,
  });

  const results: QuoteResult[] = quotes.map((quote) => ({
    quoteText: quote.quoteText,
    speaker: quote.speaker,
    startMs: quote.startMs,
    relevanceScore: quote.relevanceScore,
    context: quote.context,
    videoTitle: payload.videoTitle ?? payload.sourceUrl,
    sourceUrl: payload.sourceUrl,
  }));

  process.stdout.write(
    `${JSON.stringify({ provider: "moon-news-quote-extractor", quotes: results }, null, 2)}\n`,
  );
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : "Unknown quote extraction error";
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
