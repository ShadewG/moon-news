import "server-only";

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { searchTopic } from "@/server/services/topic-search";
import { shouldExcludeCommentaryCandidate } from "@/server/services/media-source-classification";

type Packet = {
  meta: {
    slug: string;
    title: string;
  };
  discovery: {
    mediaQueries?: string[];
  };
  sourcePools: {
    clips?: Array<{
      title: string;
      provider: string;
      sourceUrl: string;
      channelOrContributor?: string | null;
      relevanceScore: number;
    }>;
    transcriptSources?: Array<{
      sourceUrl: string;
      transcriptStatus: "complete" | "failed";
      transcriptSegments: number;
    }>;
  };
  sections: Array<{
    heading: string;
    clips?: Array<{
      title: string;
      provider: string;
      sourceUrl: string;
      channelOrContributor?: string | null;
      relevanceScore: number;
    }>;
    queryPlan?: {
      mediaQueries?: string[];
    };
  }>;
};

type MediaCollectorClip = {
  title: string;
  provider: string;
  sourceUrl: string;
  channelOrContributor: string | null;
  relevanceScore: number;
  matchedQueries: string[];
  matchedSections: string[];
  transcriptRecovered: boolean;
  transcriptSegments: number;
  fromPacket: boolean;
  fromSectionPacket: boolean;
  fromQuerySearch: boolean;
};

type MediaCollectorReport = {
  version: string;
  meta: {
    slug: string;
    title: string;
    generatedAt: string;
  };
  summary: {
    totalQueries: number;
    totalCollected: number;
    totalWithTranscript: number;
    providerCounts: Record<string, number>;
  };
  globalMediaQueries: string[];
  sectionMediaQueries: Array<{
    heading: string;
    mediaQueries: string[];
  }>;
  clips: MediaCollectorClip[];
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

async function loadPacket(slug: string) {
  const filePath = path.resolve(process.cwd(), "research", `research-packet-${slug}.json`);
  return JSON.parse(await readFile(filePath, "utf8")) as Packet;
}

function normalizeSourceUrl(url: string) {
  let normalized = url.trim();
  if (!normalized) {
    return normalized;
  }

  for (let index = 0; index < 3; index += 1) {
    try {
      const decoded = decodeURIComponent(normalized);
      if (decoded === normalized) break;
      normalized = decoded;
    } catch {
      break;
    }
  }

  normalized = normalized.replace(
    /(https?:\/\/(?:www\.)?youtube\.com\/watch\?v=[^&?]+)\?t=(\d+)/i,
    "$1&t=$2"
  );

  try {
    const parsed = new URL(normalized);
    if (/youtube\.com$/i.test(parsed.hostname) && parsed.pathname === "/watch") {
      const videoValue = parsed.searchParams.get("v");
      if (videoValue?.includes("?t=")) {
        const [videoId, tValue] = videoValue.split("?t=");
        parsed.searchParams.set("v", videoId);
        if (tValue && !parsed.searchParams.get("t")) {
          parsed.searchParams.set("t", tValue);
        }
      }
    }
    return parsed.toString();
  } catch {
    return normalized;
  }
}

function getHostname(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return "";
  }
}

function looksLikeVideoAsset(clip: {
  provider: string;
  sourceUrl: string;
  title: string;
}) {
  if (clip.provider === "youtube" || clip.provider === "internal") {
    return true;
  }

  if (clip.provider === "twitter") {
    return false;
  }

  const host = getHostname(clip.sourceUrl);
  const lowerUrl = clip.sourceUrl.toLowerCase();
  const lowerTitle = clip.title.toLowerCase();

  if (host.includes("reddit.com") || host.includes("linkedin.com")) {
    return false;
  }

  const titleSignals = [
    "video",
    "watch",
    "clip",
    "livestream",
    "live",
    "segment",
    "speech",
    "interview",
    "demo",
    "footage",
    "walks with robot",
    "robot joins",
    "steals spotlight",
  ];
  const pathSignals = ["/video", "/videos", "/watch", "/live", "/clip"];
  const hostAllowlist = [
    "facebook.com",
    "fb.watch",
    "c-span.org",
    "pbs.org",
    "abcnews.go.com",
    "youtube.com",
    "youtu.be",
  ];

  if (hostAllowlist.some((allowed) => host.includes(allowed))) {
    return true;
  }

  return (
    pathSignals.some((signal) => lowerUrl.includes(signal))
    || titleSignals.some((signal) => lowerTitle.includes(signal))
  );
}

async function main() {
  const [slugArg] = process.argv.slice(2);
  if (!slugArg) {
    throw new Error("Usage: tsx scripts/build-media-collector.ts <slug>");
  }

  const packet = await loadPacket(slugArg);
  const transcriptMap = new Map(
    (packet.sourcePools.transcriptSources ?? []).map((item) => [
      normalizeSourceUrl(item.sourceUrl),
      {
        recovered: item.transcriptStatus === "complete",
        segments: item.transcriptSegments,
      },
    ])
  );

  const sectionMediaQueries = packet.sections.map((section) => ({
    heading: section.heading,
    mediaQueries: dedupeBy(section.queryPlan?.mediaQueries ?? [], (item) => item).slice(0, 6),
  }));
  const globalMediaQueries = dedupeBy(packet.discovery.mediaQueries ?? [], (item) => item);
  const allMediaQueries = dedupeBy(
    [...globalMediaQueries, ...sectionMediaQueries.flatMap((section) => section.mediaQueries)],
    (item) => item
  );

  const querySectionMap = new Map<string, string[]>();
  for (const section of sectionMediaQueries) {
    for (const query of section.mediaQueries) {
      const current = querySectionMap.get(query) ?? [];
      if (!current.includes(section.heading)) {
        current.push(section.heading);
      }
      querySectionMap.set(query, current);
    }
  }

  const clipMap = new Map<string, MediaCollectorClip>();
  const upsertClip = (
    clip: {
      title: string;
      provider: string;
      sourceUrl: string;
      channelOrContributor?: string | null;
      relevanceScore: number;
    },
    context: {
      matchedQuery?: string;
      matchedSection?: string;
      fromPacket?: boolean;
      fromSectionPacket?: boolean;
      fromQuerySearch?: boolean;
    }
  ) => {
    const sourceUrl = normalizeSourceUrl(clip.sourceUrl);
    if (!sourceUrl) return;
    if (
      !looksLikeVideoAsset({
        provider: clip.provider,
        sourceUrl,
        title: clip.title,
      })
      || (
      shouldExcludeCommentaryCandidate({
        provider: clip.provider,
        title: clip.title,
        sourceUrl,
        channelOrContributor: clip.channelOrContributor,
      })
      )
    ) {
      return;
    }

    const transcript = transcriptMap.get(sourceUrl);
    const existing = clipMap.get(sourceUrl);
    if (!existing) {
      clipMap.set(sourceUrl, {
        title: clip.title,
        provider: clip.provider,
        sourceUrl,
        channelOrContributor: clip.channelOrContributor ?? null,
        relevanceScore: clip.relevanceScore,
        matchedQueries: context.matchedQuery ? [context.matchedQuery] : [],
        matchedSections: context.matchedSection ? [context.matchedSection] : [],
        transcriptRecovered: transcript?.recovered ?? false,
        transcriptSegments: transcript?.segments ?? 0,
        fromPacket: Boolean(context.fromPacket),
        fromSectionPacket: Boolean(context.fromSectionPacket),
        fromQuerySearch: Boolean(context.fromQuerySearch),
      });
      return;
    }

    existing.relevanceScore = Math.max(existing.relevanceScore, clip.relevanceScore);
    if (context.matchedQuery && !existing.matchedQueries.includes(context.matchedQuery)) {
      existing.matchedQueries.push(context.matchedQuery);
    }
    if (context.matchedSection && !existing.matchedSections.includes(context.matchedSection)) {
      existing.matchedSections.push(context.matchedSection);
    }
    existing.fromPacket ||= Boolean(context.fromPacket);
    existing.fromSectionPacket ||= Boolean(context.fromSectionPacket);
    existing.fromQuerySearch ||= Boolean(context.fromQuerySearch);
    existing.transcriptRecovered ||= transcript?.recovered ?? false;
    existing.transcriptSegments = Math.max(existing.transcriptSegments, transcript?.segments ?? 0);
  };

  for (const clip of packet.sourcePools.clips ?? []) {
    upsertClip(clip, { fromPacket: true });
  }

  for (const section of packet.sections) {
    for (const clip of section.clips ?? []) {
      upsertClip(clip, { fromSectionPacket: true, matchedSection: section.heading });
    }
  }

  const topicResults = await mapWithConcurrency(allMediaQueries, 4, async (query) =>
    withTimeout(
      searchTopic(query, {
        includeAiQuotes: false,
        includeLocalTranscriptFallback: false,
      }),
      45_000,
      () => ({
        query,
        searchId: "",
        clips: [],
        quotes: [],
        totalFound: 0,
        totalFiltered: 0,
      })
    )
  );

  for (const result of topicResults) {
    for (const clip of result.clips) {
      const matchedSections = querySectionMap.get(result.query) ?? [];
      upsertClip(clip, {
        matchedQuery: result.query,
        matchedSection: matchedSections[0],
        fromQuerySearch: true,
      });
      for (const heading of matchedSections.slice(1)) {
        upsertClip(clip, {
          matchedSection: heading,
          fromQuerySearch: true,
        });
      }
    }
  }

  const clips = Array.from(clipMap.values())
    .map((clip) => ({
      ...clip,
      relevanceScore:
        clip.relevanceScore +
        clip.matchedQueries.length * 3 +
        clip.matchedSections.length * 2 +
        (clip.transcriptRecovered ? 5 : 0),
    }))
    .sort((left, right) => right.relevanceScore - left.relevanceScore);

  const providerCounts = clips.reduce<Record<string, number>>((acc, clip) => {
    acc[clip.provider] = (acc[clip.provider] ?? 0) + 1;
    return acc;
  }, {});

  const report: MediaCollectorReport = {
    version: "1",
    meta: {
      slug: packet.meta.slug,
      title: packet.meta.title,
      generatedAt: new Date().toISOString(),
    },
    summary: {
      totalQueries: allMediaQueries.length,
      totalCollected: clips.length,
      totalWithTranscript: clips.filter((clip) => clip.transcriptRecovered).length,
      providerCounts,
    },
    globalMediaQueries,
    sectionMediaQueries,
    clips,
  };

  const researchDir = path.resolve(process.cwd(), "research");
  await mkdir(researchDir, { recursive: true });
  const outputPath = path.join(researchDir, `media-collector-${slugArg}.json`);
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.log(
    JSON.stringify(
      {
        outputPath,
        totalQueries: report.summary.totalQueries,
        totalCollected: report.summary.totalCollected,
        totalWithTranscript: report.summary.totalWithTranscript,
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
