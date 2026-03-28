import "server-only";

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { and, desc, eq } from "drizzle-orm";
import { config as loadDotenv } from "dotenv";
import { z } from "zod";

import { askAboutTranscript } from "@/server/providers/openai";
import { searchResearchSources } from "@/server/providers/parallel";
import { ingestLocalMediaArtifacts } from "@/server/providers/local-media";
import { getDb } from "@/server/db/client";
import { clipAiQueries } from "@/server/db/schema";
import { createAnthropicJson, getAnthropicPlanningModel } from "@/server/services/script-lab";

loadDotenv({ path: path.resolve(process.cwd(), ".env") });
loadDotenv({ path: path.resolve(process.cwd(), ".env.local"), override: true });

type Packet = {
  meta: {
    slug: string;
    title: string;
  };
  brief: {
    text: string;
  };
  summary: {
    thesis: string;
    whyItMattersNow: string;
    keyClaims?: string[];
  };
  topSummary?: {
    storyPoints?: string[];
  };
  sections: Array<{
    heading: string;
    purpose: string;
    beatGoal: string;
  }>;
};

type DiscoveryAttempt = {
  query: string;
  method: "playwright_tiktok_proxy" | "playwright_tiktok_direct" | "parallel_search";
  resultCount: number;
  note?: string;
};

type CollectorClip = {
  title: string;
  sourceUrl: string;
  pageUrl: string;
  previewUrl: string | null;
  provider: string;
  channelOrContributor: string | null;
  durationMs: number | null;
  viewCount: number | null;
  uploadDate: string | null;
  discoveryQuery: string;
  discoveryMethod: DiscoveryAttempt["method"];
  transcriptSegments: number;
  missionSummary: string;
  maxTalkingPointScore: number;
  talkingPoints: Array<{
    label: string;
    quoteText: string;
    speaker: string | null;
    startMs: number;
    endMs: number;
    relevanceScore: number;
    whyRelevant: string;
    matchedSectionHeadings: string[];
    topics: string[];
    sourceUrl: string;
  }>;
};

type CollectorReport = {
  version: string;
  meta: {
    slug: string;
    title: string;
    generatedAt: string;
  };
  queryPlan: {
    model: string;
    queries: string[];
  };
  discovery: {
    attempts: DiscoveryAttempt[];
    totalUniqueUrls: number;
  };
  summary: {
    discoveredUrls: number;
    ingestedClips: number;
    transcriptedClips: number;
    clipsWithTalkingPoints: number;
    totalTalkingPoints: number;
  };
  clips: CollectorClip[];
  topQuotes: Array<{
    sourceTitle: string;
    sourceUrl: string;
    previewUrl: string | null;
    quoteText: string;
    speaker: string | null;
    startMs: number;
    endMs: number;
    relevanceScore: number;
    whyRelevant: string;
    channelOrContributor: string | null;
  }>;
};

const queryPlanSchema = z.object({
  queries: z.array(z.string().trim().min(1)).min(4).max(6),
});

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

function stripTimeParam(url: string) {
  try {
    const parsed = new URL(url);
    parsed.searchParams.delete("t");
    return parsed.toString();
  } catch {
    return url.replace(/([?&])t=\d+(&?)/g, (_match, prefix: string, suffix: string) =>
      prefix === "?" && suffix ? "?" : suffix ? prefix : ""
    );
  }
}

function normalizeExternalUrl(url: string | null | undefined) {
  if (!url) return null;
  let normalized = url.trim();
  if (!normalized) return null;

  for (let index = 0; index < 3; index += 1) {
    try {
      const decoded = decodeURIComponent(normalized);
      if (decoded === normalized) break;
      normalized = decoded;
    } catch {
      break;
    }
  }

  try {
    return new URL(normalized).toString();
  } catch {
    return normalized;
  }
}

function isTikTokVideoUrl(url: string | null | undefined) {
  if (!url) return false;
  const normalized = normalizeExternalUrl(url);
  if (!normalized) return false;
  return /^https?:\/\/(?:www\.)?tiktok\.com\/@[^/]+\/video\/\d+/i.test(normalized);
}

function fallbackQueries(packet: Packet) {
  const title = packet.meta.title.replace(/[^\w\s-]+/g, " ").replace(/\s+/g, " ").trim();
  const nouns = dedupeBy(
    [
      title,
      `${title} tiktok`,
      `${title} fake video`,
      `${title} ai video`,
      `${title} viral video`,
      `${title} misinformation`,
    ],
    (value) => value.toLowerCase()
  );
  return nouns.slice(0, 6);
}

async function buildQueryPlan(packet: Packet) {
  const fallback = fallbackQueries(packet);

  try {
    const plan = await Promise.race([
      createAnthropicJson({
        model: getAnthropicPlanningModel(),
        temperature: 0.2,
        schema: queryPlanSchema,
        system:
          "You generate search queries for finding direct TikTok videos relevant to a documentary topic. Queries must be broad enough to actually return results on TikTok or web search, but specific enough to keep the topic tight. Prefer 3-6 word natural-language search phrases.",
        user: [
          `Topic: ${packet.meta.title}`,
          `Brief:\n${packet.brief.text}`,
          `Thesis:\n${packet.summary.thesis}`,
          packet.topSummary?.storyPoints?.length
            ? `Story points:\n- ${packet.topSummary.storyPoints.join("\n- ")}`
            : null,
          "Return 4-6 TikTok-style search queries that would surface viral clips, debunks, reactions, and direct fake-video examples tied to this story.",
          "Avoid over-specific legal/institutional query fragments unless the topic actually depends on them.",
        ]
          .filter(Boolean)
          .join("\n\n"),
        maxTokens: 800,
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("TikTok query planning timed out")), 25_000)
      ),
    ]);

    const queries = dedupeBy(plan.queries, (value) => value.toLowerCase()).slice(0, 6);
    return {
      model: getAnthropicPlanningModel(),
      queries: queries.length > 0 ? queries : fallback,
    };
  } catch {
    return {
      model: "fallback",
      queries: fallback,
    };
  }
}

async function discoverViaTikTokPlaywright(query: string, useProxy: boolean) {
  const { chromium } = await import("playwright");
  const rawProxy = process.env.MOON_YTDLP_PROXY ?? "";
  let proxy: { server: string } | undefined;

  if (useProxy) {
    try {
      const parsed = new URL(rawProxy);
      proxy = {
        server: `${parsed.protocol}//${parsed.hostname}${parsed.port ? `:${parsed.port}` : ""}`,
      };
    } catch {
      proxy = undefined;
    }
  }

  const browser = await chromium.launch({
    headless: true,
    proxy,
  });

  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 2200 },
      userAgent:
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
    });

    await page.goto(`https://www.tiktok.com/search/video?q=${encodeURIComponent(query)}`, {
      waitUntil: "commit",
      timeout: 10_000,
    });

    const urls = new Set<string>();
    for (let pass = 0; pass < 2; pass += 1) {
      await page.waitForTimeout(2_500);
      const links = await page.locator("a").evaluateAll((nodes) =>
        nodes
          .map((node) => (node instanceof HTMLAnchorElement ? node.href : ""))
          .filter(Boolean)
      );

      for (const link of links) {
        if (typeof link === "string" && /^https?:\/\/(?:www\.)?tiktok\.com\/@[^/]+\/video\/\d+/i.test(link)) {
          urls.add(link);
        }
      }

      if (urls.size >= 20) {
        break;
      }

      await page.mouse.wheel(0, 2600);
    }

    return Array.from(urls);
  } finally {
    await browser.close();
  }
}

async function discoverViaParallel(query: string) {
  const searchQueries = dedupeBy(
    [
      `${query} site:tiktok.com/@`,
      `${query} site:tiktok.com`,
      `${query} tiktok`,
    ],
    (value) => value.toLowerCase()
  );

  const results = await searchResearchSources({
    query,
    searchQueries,
    objective:
      "Find direct TikTok video URLs relevant to this story. Prefer real tiktok.com/@.../video/... pages over articles or discovery pages.",
    limit: 12,
    mode: "fast",
    maxCharsPerResult: 500,
    maxCharsTotal: 4000,
  });

  return results
    .map((result) => normalizeExternalUrl(result.url))
    .filter((url): url is string => Boolean(url))
    .filter((url) => isTikTokVideoUrl(url));
}

async function discoverTikTokUrls(queries: string[]) {
  const attempts: DiscoveryAttempt[] = [];
  const discovered: Array<{
    sourceUrl: string;
    discoveryQuery: string;
    discoveryMethod: DiscoveryAttempt["method"];
  }> = [];
  let browserSmokeTestRemaining = true;

  for (const query of queries) {
    let proxyUrls: string[] = [];
    if (browserSmokeTestRemaining) {
      console.log(`[tiktok-collector] playwright proxy search: ${query}`);
      try {
        proxyUrls = await Promise.race([
          discoverViaTikTokPlaywright(query, true),
          new Promise<string[]>((resolve) => setTimeout(() => resolve([]), 15_000)),
        ]);
      } catch (error) {
        attempts.push({
          query,
          method: "playwright_tiktok_proxy",
          resultCount: 0,
          note: error instanceof Error ? error.message : String(error),
        });
      }
    }
    if (proxyUrls.length > 0) {
      attempts.push({
        query,
        method: "playwright_tiktok_proxy",
        resultCount: proxyUrls.length,
      });
      discovered.push(
        ...proxyUrls.map((sourceUrl) => ({
          sourceUrl,
          discoveryQuery: query,
          discoveryMethod: "playwright_tiktok_proxy" as const,
        }))
      );
      continue;
    }

    let directUrls: string[] = [];
    if (browserSmokeTestRemaining) {
      console.log(`[tiktok-collector] playwright direct search: ${query}`);
      try {
        directUrls = await Promise.race([
          discoverViaTikTokPlaywright(query, false),
          new Promise<string[]>((resolve) => setTimeout(() => resolve([]), 12_000)),
        ]);
      } catch (error) {
        attempts.push({
          query,
          method: "playwright_tiktok_direct",
          resultCount: 0,
          note: error instanceof Error ? error.message : String(error),
        });
      }
    }
    if (directUrls.length > 0) {
      attempts.push({
        query,
        method: "playwright_tiktok_direct",
        resultCount: directUrls.length,
      });
      discovered.push(
        ...directUrls.map((sourceUrl) => ({
          sourceUrl,
          discoveryQuery: query,
          discoveryMethod: "playwright_tiktok_direct" as const,
        }))
      );
      continue;
    }
    browserSmokeTestRemaining = false;

    console.log(`[tiktok-collector] parallel fallback: ${query}`);
    const fallbackUrls = await discoverViaParallel(query);
    attempts.push({
      query,
      method: "parallel_search",
      resultCount: fallbackUrls.length,
      note:
        fallbackUrls.length > 0
          ? "TikTok served a blank/blocked search shell, so discovery fell back to Parallel web search."
          : "No direct TikTok video URLs surfaced for this query.",
    });
    discovered.push(
      ...fallbackUrls.map((sourceUrl) => ({
        sourceUrl,
        discoveryQuery: query,
        discoveryMethod: "parallel_search" as const,
      }))
    );
  }

  const deduped = dedupeBy(discovered, (item) => stripTimeParam(item.sourceUrl)).slice(0, 20);
  return { attempts, discovered: deduped };
}

function buildMissionQuestion(slug: string, packet: Packet) {
  const missionText = JSON.stringify({
    title: packet.meta.title,
    thesis: packet.summary.thesis,
    whyItMattersNow: packet.summary.whyItMattersNow,
    sections: packet.sections.map((section) => ({
      heading: section.heading,
      purpose: section.purpose,
      beatGoal: section.beatGoal,
    })),
  });
  const digest = createHash("sha1").update(missionText).digest("hex").slice(0, 12);
  return `tiktok_mission_scan:v2:${slug}:${digest}`;
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

async function main() {
  const slugArg = process.argv[2];
  if (!slugArg) {
    throw new Error("Usage: tsx scripts/collect-tiktok-sources.ts <slug>");
  }

  const packetPath = path.resolve(process.cwd(), "research", `research-packet-${slugArg}.json`);
  const packet = JSON.parse(await readFile(packetPath, "utf8")) as Packet;
  const queryPlan = await buildQueryPlan(packet);
  const discovery = await discoverTikTokUrls(queryPlan.queries);
  const db = getDb();
  const cacheQuestion = buildMissionQuestion(slugArg, packet);

  console.log(
    `[tiktok-collector] discovered ${discovery.discovered.length} unique TikTok URLs across ${queryPlan.queries.length} queries`
  );

  const clips = await mapWithConcurrency(discovery.discovered, 3, async (item, index) => {
    console.log(`[tiktok-collector] ingesting ${index + 1}/${discovery.discovered.length}: ${item.sourceUrl}`);
    const ingested = await ingestLocalMediaArtifacts({
      sourceUrl: item.sourceUrl,
      providerName: "tiktok",
    });

    if (!ingested || ingested.transcript.length === 0) {
      return null;
    }

    const [cached] = await db
      .select({
        answer: clipAiQueries.answer,
        momentsJson: clipAiQueries.momentsJson,
        model: clipAiQueries.model,
      })
      .from(clipAiQueries)
      .where(and(eq(clipAiQueries.clipId, ingested.clipId), eq(clipAiQueries.question, cacheQuestion)))
      .orderBy(desc(clipAiQueries.createdAt))
      .limit(1);

    let missionSummary = "";
    let talkingPoints: CollectorClip["talkingPoints"] = [];

    if (cached) {
      missionSummary = cached.answer;
      talkingPoints = Array.isArray(cached.momentsJson)
        ? (cached.momentsJson as CollectorClip["talkingPoints"])
        : [];
    } else {
      const qa = await askAboutTranscript({
        question: [
          `For a documentary about "${packet.meta.title}", what does this TikTok say that is actually useful?`,
          "Pull the exact lines that matter most if the clip shows the fake / AI-generated videos themselves, explains why they spread, debunks them, or captures how people reacted or believed them.",
          "Ignore filler and generic AI talk.",
        ].join(" "),
        transcript: ingested.transcript,
        videoTitle: ingested.title,
      });

      missionSummary = qa.answer;
      talkingPoints = qa.moments.map((moment) => ({
        label: "TikTok moment",
        quoteText: moment.text,
        speaker: null,
        startMs: moment.startMs,
        endMs: moment.startMs + 15_000,
        relevanceScore: 85,
        whyRelevant: qa.answer,
        matchedSectionHeadings: [],
        topics: ["tiktok", "viral clip", "ai video"],
        sourceUrl: `${stripTimeParam(ingested.pageUrl)}?t=${Math.floor(moment.startMs / 1000)}`,
      }));

      await db.insert(clipAiQueries).values({
        clipId: ingested.clipId,
        question: cacheQuestion,
        answer: missionSummary,
        momentsJson: talkingPoints,
        model: "gpt-4.1-mini",
      });
    }

    const maxTalkingPointScore = talkingPoints.reduce(
      (max, point) => Math.max(max, point.relevanceScore),
      0
    );

    const clip: CollectorClip = {
      title: ingested.title,
      sourceUrl: ingested.pageUrl,
      pageUrl: ingested.pageUrl,
      previewUrl: ingested.previewUrl,
      provider: ingested.providerName,
      channelOrContributor: ingested.channelOrContributor,
      durationMs: ingested.durationMs,
      viewCount: ingested.viewCount,
      uploadDate: ingested.uploadDate,
      discoveryQuery: item.discoveryQuery,
      discoveryMethod: item.discoveryMethod,
      transcriptSegments: ingested.transcript.length,
      missionSummary,
      maxTalkingPointScore,
      talkingPoints: talkingPoints
        .sort((left, right) => right.relevanceScore - left.relevanceScore)
        .slice(0, 6),
    };

    return clip;
  });

  const completed = clips.filter((clip): clip is CollectorClip => Boolean(clip));
  const sorted = completed.sort((left, right) => {
    if (right.maxTalkingPointScore !== left.maxTalkingPointScore) {
      return right.maxTalkingPointScore - left.maxTalkingPointScore;
    }
    return (right.viewCount ?? 0) - (left.viewCount ?? 0);
  });

  const topQuotes = dedupeBy(
    sorted.flatMap((clip) =>
      clip.talkingPoints.map((point) => ({
        sourceTitle: clip.title,
        sourceUrl: point.sourceUrl,
        previewUrl: clip.previewUrl,
        quoteText: point.quoteText,
        speaker: point.speaker,
        startMs: point.startMs,
        endMs: point.endMs,
        relevanceScore: point.relevanceScore,
        whyRelevant: point.whyRelevant,
        channelOrContributor: clip.channelOrContributor,
      }))
    ),
    (quote) => `${stripTimeParam(quote.sourceUrl)}|${quote.quoteText.toLowerCase().slice(0, 140)}`
  )
    .sort((left, right) => right.relevanceScore - left.relevanceScore)
    .slice(0, 16);

  const report: CollectorReport = {
    version: "v1",
    meta: {
      slug: packet.meta.slug,
      title: packet.meta.title,
      generatedAt: new Date().toISOString(),
    },
    queryPlan,
    discovery: {
      attempts: discovery.attempts,
      totalUniqueUrls: discovery.discovered.length,
    },
    summary: {
      discoveredUrls: discovery.discovered.length,
      ingestedClips: completed.length,
      transcriptedClips: completed.filter((clip) => clip.transcriptSegments > 0).length,
      clipsWithTalkingPoints: completed.filter((clip) => clip.talkingPoints.length > 0).length,
      totalTalkingPoints: completed.reduce((sum, clip) => sum + clip.talkingPoints.length, 0),
    },
    clips: sorted,
    topQuotes,
  };

  const outputPath = path.resolve(process.cwd(), "research", `tiktok-collector-${slugArg}.json`);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.log(
    JSON.stringify(
      {
        outputPath,
        discoveredUrls: report.summary.discoveredUrls,
        ingestedClips: report.summary.ingestedClips,
        clipsWithTalkingPoints: report.summary.clipsWithTalkingPoints,
        totalTalkingPoints: report.summary.totalTalkingPoints,
      },
      null,
      2
    )
  );
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error("[tiktok-collector] fatal", error);
    process.exit(1);
  });
