import "server-only";

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { findRelevantQuotes } from "@/server/providers/openai";
import {
  ensureYouTubeTranscript,
  upsertClipInLibrary,
  type ClipTranscriptSegment,
} from "@/server/services/clip-library";

type Packet = {
  meta: {
    slug: string;
    title: string;
  };
  sections: Array<{
    id: string;
    order: number;
    heading: string;
    purpose: string;
    beatGoal: string;
    evidenceSlots: string[];
  }>;
};

type MediaCollector = {
  clips: Array<{
    title: string;
    provider: string;
    sourceUrl: string;
    channelOrContributor: string | null;
    relevanceScore: number;
    matchedSections: string[];
    transcriptRecovered: boolean;
    transcriptSegments: number;
  }>;
};

type SectionQuoteReport = {
  version: string;
  meta: {
    slug: string;
    title: string;
    generatedAt: string;
  };
  summary: {
    totalSections: number;
    totalTranscriptedClips: number;
    totalSectionQuotes: number;
  };
  sections: Array<{
    id: string;
    order: number;
    heading: string;
    candidateClipCount: number;
    transcriptedClipCount: number;
    quotes: Array<{
      sourceTitle: string;
      sourceUrl: string;
      channelOrContributor: string | null;
      quoteText: string;
      speaker: string | null;
      context: string;
      startMs: number;
      endMs: number;
      relevanceScore: number;
    }>;
  }>;
};

function dedupeBy<T>(items: T[], keyFn: (item: T) => string) {
  const seen = new Set<string>();
  const deduped: T[] = [];
  for (const item of items) {
    const key = keyFn(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }
  return deduped;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
) {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const runWorker = async () => {
    while (nextIndex < items.length) {
      const current = nextIndex;
      nextIndex += 1;
      results[current] = await worker(items[current], current);
    }
  };
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, () => runWorker())
  );
  return results;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: () => T): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback()), timeoutMs);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch(() => {
        clearTimeout(timer);
        resolve(fallback());
      });
  });
}

function parseYouTubeVideoId(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes("youtu.be")) {
      const id = parsed.pathname.replace(/^\/+/, "").split("/")[0];
      return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
    }
    const v = parsed.searchParams.get("v");
    if (v && /^[A-Za-z0-9_-]{11}$/.test(v)) {
      return v;
    }
    const pathMatch = parsed.pathname.match(/\/shorts\/([A-Za-z0-9_-]{11})/);
    return pathMatch?.[1] ?? null;
  } catch {
    return null;
  }
}

async function loadPacket(slug: string) {
  const filePath = path.resolve(process.cwd(), "research", `research-packet-${slug}.json`);
  return JSON.parse(await readFile(filePath, "utf8")) as Packet;
}

async function loadCollector(slug: string) {
  const filePath = path.resolve(process.cwd(), "research", `media-collector-${slug}.json`);
  return JSON.parse(await readFile(filePath, "utf8")) as MediaCollector;
}

async function hydrateTranscriptForClip(clip: MediaCollector["clips"][number]) {
  if (clip.provider !== "youtube") {
    return null;
  }

  const videoId = parseYouTubeVideoId(clip.sourceUrl);
  if (!videoId) {
    return null;
  }

  const clipId = await upsertClipInLibrary({
    provider: "youtube",
    externalId: videoId,
    title: clip.title,
    sourceUrl: clip.sourceUrl,
    channelOrContributor: clip.channelOrContributor ?? null,
  });

  return withTimeout(
    ensureYouTubeTranscript(clipId, videoId),
    30_000,
    () => null
  );
}

async function main() {
  const [slugArg] = process.argv.slice(2);
  if (!slugArg) {
    throw new Error("Usage: tsx scripts/build-media-section-quotes.ts <slug>");
  }

  const packet = await loadPacket(slugArg);
  const collector = await loadCollector(slugArg);

  const transcriptCache = new Map<string, ClipTranscriptSegment[] | null>();
  const transcriptTargets = collector.clips.filter((clip) => clip.provider === "youtube").slice(0, 80);

  await mapWithConcurrency(transcriptTargets, 4, async (clip) => {
    const segments = await hydrateTranscriptForClip(clip);
    transcriptCache.set(clip.sourceUrl, segments);
    return null;
  });

  const sections = [];

  for (const section of packet.sections) {
    const sectionContext = [
      `Section heading: ${section.heading}`,
      `Purpose: ${section.purpose}`,
      `Beat goal: ${section.beatGoal}`,
      `Evidence slots: ${section.evidenceSlots.join(" | ")}`,
    ].join("\n");

    const candidateClips = collector.clips
      .filter((clip) => clip.matchedSections.includes(section.heading))
      .sort((left, right) => right.relevanceScore - left.relevanceScore)
      .slice(0, 10);

    const transcripted = candidateClips
      .map((clip) => ({
        clip,
        segments: transcriptCache.get(clip.sourceUrl) ?? null,
      }))
      .filter(
        (item): item is { clip: MediaCollector["clips"][number]; segments: ClipTranscriptSegment[] } =>
          Array.isArray(item.segments) && item.segments.length > 0
      );

    const quoteResults = await mapWithConcurrency(transcripted.slice(0, 6), 2, async ({ clip, segments }) => {
      const quotes = await withTimeout(
        findRelevantQuotes({
          lineText: section.heading,
          scriptContext: sectionContext,
          transcript: segments,
          videoTitle: clip.title,
          maxQuotes: 2,
        }),
        35_000,
        () => []
      );

      return quotes.map((quote) => ({
        sourceTitle: clip.title,
        sourceUrl: `${clip.sourceUrl}${clip.sourceUrl.includes("?") ? "&" : "?"}t=${Math.floor(
          quote.startMs / 1000
        )}`,
        channelOrContributor: clip.channelOrContributor,
        quoteText: quote.quoteText,
        speaker: quote.speaker,
        context: quote.context,
        startMs: quote.startMs,
        endMs: quote.endMs,
        relevanceScore: quote.relevanceScore,
      }));
    });

    sections.push({
      id: section.id,
      order: section.order,
      heading: section.heading,
      candidateClipCount: candidateClips.length,
      transcriptedClipCount: transcripted.length,
      quotes: dedupeBy(
        quoteResults.flat().filter((quote) => quote.relevanceScore >= 70),
        (quote) => `${quote.sourceUrl}|${quote.quoteText}`
      ).sort((left, right) => right.relevanceScore - left.relevanceScore),
    });
  }

  const report: SectionQuoteReport = {
    version: "1",
    meta: {
      slug: packet.meta.slug,
      title: packet.meta.title,
      generatedAt: new Date().toISOString(),
    },
    summary: {
      totalSections: sections.length,
      totalTranscriptedClips: Array.from(transcriptCache.values()).filter(
        (segments) => Array.isArray(segments) && segments.length > 0
      ).length,
      totalSectionQuotes: sections.reduce((sum, section) => sum + section.quotes.length, 0),
    },
    sections,
  };

  const outputPath = path.resolve(process.cwd(), "research", `media-section-quotes-${slugArg}.json`);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.log(
    JSON.stringify(
      {
        outputPath,
        totalSections: report.summary.totalSections,
        totalTranscriptedClips: report.summary.totalTranscriptedClips,
        totalSectionQuotes: report.summary.totalSectionQuotes,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
