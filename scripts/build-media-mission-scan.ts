import "server-only";

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { and, desc, eq } from "drizzle-orm";
import { config as loadDotenv } from "dotenv";
import { z } from "zod";

import { askAboutTranscript } from "@/server/providers/openai";
import { getDb } from "@/server/db/client";
import { clipAiQueries, clipLibrary, transcriptCache } from "@/server/db/schema";
import {
  ensureYouTubeTranscript,
  getCachedTranscriptSegments,
  upsertClipInLibrary,
  type ClipTranscriptSegment,
} from "@/server/services/clip-library";
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
  };
  sections: Array<{
    id: string;
    order: number;
    heading: string;
    purpose: string;
    beatGoal: string;
    whyItMattersNow?: string;
    evidenceSlots?: string[];
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
    transcriptRecovered?: boolean;
    transcriptSegments?: number;
  }>;
};

const missionSpecSchema = z.object({
  missionTitle: z.string().trim().min(1),
  missionObjective: z.string().trim().min(1),
  missionInstructions: z.array(z.string().trim().min(1)).min(4).max(12),
  keywordHints: z.array(z.string().trim().min(1)).min(4).max(20),
  sectionMissions: z.array(
    z.object({
      sectionHeading: z.string().trim().min(1),
      mission: z.string().trim().min(1),
      lookFor: z.array(z.string().trim().min(1)).min(1).max(8),
      scanQuestion: z.string().trim().min(1),
    })
  ),
});

type MissionSpec = z.infer<typeof missionSpecSchema>;

type MissionScanPoint = {
  label: string;
  quoteText: string;
  speaker: string | null;
  startMs: number;
  endMs: number;
  relevanceScore: number;
  whyRelevant: string;
  matchedSectionHeadings: string[];
  topics: string[];
  sourceTitle: string;
  sourceUrl: string;
  channelOrContributor: string | null;
  clipId: string | null;
};

type MissionScanReport = {
  version: string;
  meta: {
    slug: string;
    title: string;
    generatedAt: string;
  };
  mission: MissionSpec & {
    model: string;
    cacheKey: string;
  };
  summary: {
    totalClips: number;
    eligibleClips: number;
    transcriptedClips: number;
    clipsScanned: number;
    clipsWithTalkingPoints: number;
    totalTalkingPoints: number;
  };
  sections: Array<{
    heading: string;
    mission: string;
    lookFor: string[];
    talkingPoints: MissionScanPoint[];
    clips: Array<{
      title: string;
      sourceUrl: string;
      channelOrContributor: string | null;
      talkingPointCount: number;
    }>;
  }>;
  clips: Array<{
    title: string;
    provider: string;
    sourceUrl: string;
    channelOrContributor: string | null;
    clipId: string | null;
    transcriptStatus: "complete" | "missing" | "skipped";
    scanStatus: "complete" | "cached" | "missing_transcript" | "skipped";
    scanModel: string | null;
    missionSummary: string | null;
    talkingPoints: MissionScanPoint[];
  }>;
};

function extractQuotedPhrases(text: string) {
  return Array.from(text.matchAll(/["'“](.{3,80}?)["'”]/g)).map((match) => match[1].trim());
}

function buildKeywordHintsFromPacket(packet: Packet) {
  const raw = [
    packet.meta.title,
    packet.summary.thesis,
    ...packet.sections.flatMap((section) => [
      section.heading,
      section.purpose,
      section.beatGoal,
      ...(section.evidenceSlots ?? []),
      ...extractQuotedPhrases(section.purpose),
      ...((section.evidenceSlots ?? []).flatMap((slot) => extractQuotedPhrases(slot))),
    ]),
  ];

  const phraseCandidates = raw.flatMap((value) =>
    value
      .split(/[|,;()[\]]/)
      .map((part) => part.trim())
      .filter((part) => part.length >= 4 && part.length <= 70)
  );

  const keywordCandidates = phraseCandidates.flatMap((value) => {
    const lowered = value.toLowerCase();
    const short = lowered
      .replace(/\[[^\]]*\]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    const colonParts = short.split(":").map((part) => part.trim());
    return colonParts.length > 1 ? colonParts.slice(1) : [short];
  });

  return dedupeBy(
    keywordCandidates
      .filter((value) => value.length >= 4 && value.length <= 40)
      .filter((value) => !/^viewer /i.test(value))
      .filter((value) => !/^use as /i.test(value))
      .filter((value) => !/^primary clip target/i.test(value))
      .slice(0, 20),
    (value) => value.toLowerCase()
  );
}

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

function buildSearchTerms(text: string) {
  const normalized = text.toLowerCase().replace(/\s+/g, " ").trim();
  const terms: string[] = [];
  for (const len of [50, 30, 18]) {
    const slice = normalized.slice(0, len).trim();
    if (slice.length >= 10) {
      terms.push(slice);
    }
  }
  const words = normalized.split(/\s+/).filter(Boolean);
  for (let index = 0; index < words.length - 2; index += Math.max(1, Math.floor(words.length / 4))) {
    const phrase = words.slice(index, index + 5).join(" ").trim();
    if (phrase.length >= 12) {
      terms.push(phrase);
    }
  }
  return [...new Set(terms)];
}

function verifyTranscriptMoment(
  momentText: string,
  transcript: ClipTranscriptSegment[]
): { quoteText: string; startMs: number; endMs: number } | null {
  if (!momentText.trim()) {
    return null;
  }

  const windows: Array<{ text: string; startIndex: number }> = [];
  const windowSize = 30;
  for (let index = 0; index < transcript.length; index += 1) {
    const slice = transcript.slice(index, index + windowSize);
    windows.push({
      text: slice.map((segment) => segment.text).join(" ").toLowerCase(),
      startIndex: index,
    });
  }

  for (const term of buildSearchTerms(momentText)) {
    const matchedWindow = windows.find((window) => window.text.includes(term));
    if (!matchedWindow) {
      continue;
    }

    let endIndex = matchedWindow.startIndex;
    let collected = "";
    const targetWords = momentText.split(/\s+/).filter(Boolean).length;

    while (
      endIndex < transcript.length
      && collected.split(/\s+/).filter(Boolean).length < targetWords + 30
      && transcript[endIndex].startMs - transcript[matchedWindow.startIndex].startMs < 45_000
    ) {
      collected += `${collected ? " " : ""}${transcript[endIndex].text}`;
      endIndex += 1;
    }

    const lastSegment = transcript[Math.max(matchedWindow.startIndex, endIndex - 1)];
    return {
      quoteText: collected.trim(),
      startMs: transcript[matchedWindow.startIndex].startMs,
      endMs: lastSegment
        ? lastSegment.startMs + lastSegment.durationMs
        : transcript[matchedWindow.startIndex].startMs + 15_000,
    };
  }

  return null;
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

function parseYouTubeVideoId(url: string): string | null {
  try {
    const normalizedUrl = normalizeExternalUrl(url) ?? url;
    const parsed = new URL(normalizedUrl);
    if (parsed.hostname.includes("youtu.be")) {
      const id = parsed.pathname.replace(/^\/+/, "").split("/")[0];
      return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
    }
    const v = parsed.searchParams.get("v");
    if (v && /^[A-Za-z0-9_-]{11}$/.test(v)) {
      return v;
    }
    const liveMatch = parsed.pathname.match(/\/live\/([A-Za-z0-9_-]{11})/);
    if (liveMatch?.[1]) {
      return liveMatch[1];
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

async function generateMissionSpec(packet: Packet): Promise<{ model: string; spec: MissionSpec }> {
  const fallback: MissionSpec = {
    missionTitle: `${packet.meta.title} transcript mission`,
    missionObjective: packet.summary.thesis,
    missionInstructions: [
      "Extract any direct statement, explanation, warning, or prediction that sharpens the core story thesis.",
      "Prefer interview clips, official remarks, and expert analysis over commentary wrappers.",
      "Keep anything that would give a writer or editor a reusable talking point, exact quote, or section proof point.",
      "Assign relevant moments to the closest documentary section heading when possible.",
    ],
    keywordHints: buildKeywordHintsFromPacket(packet),
    sectionMissions: packet.sections.map((section) => ({
      sectionHeading: section.heading,
      mission: section.purpose,
      lookFor: dedupeBy(
        [section.beatGoal, ...(section.evidenceSlots ?? [])].filter(Boolean),
        (value) => value.toLowerCase()
      ).slice(0, 6),
      scanQuestion: [
        `What direct remarks in this transcript help with the documentary section "${section.heading}"?`,
        `Look for: ${dedupeBy(
          [section.beatGoal, ...(section.evidenceSlots ?? [])].filter(Boolean),
          (value) => value.toLowerCase()
        )
          .slice(0, 4)
          .join(" | ")}`,
        "Return the strongest exact moments, not vague summaries.",
      ].join(" "),
    })),
  };

  try {
    const spec = await createAnthropicJson({
      schema: missionSpecSchema,
      model: getAnthropicPlanningModel(),
      temperature: 0.2,
      maxTokens: 1800,
      system:
        "You turn a finished documentary research packet into a transcript-scanning mission. The output should help a cheaper model scan lots of interview and source transcripts for anything actually useful to the story.",
      user: [
        `Title: ${packet.meta.title}`,
        "",
        "Brief:",
        packet.brief.text,
        "",
        `Thesis: ${packet.summary.thesis}`,
        "",
        `Why it matters now: ${packet.summary.whyItMattersNow}`,
        "",
        "Sections:",
        ...packet.sections.map((section) =>
          [
            `Heading: ${section.heading}`,
            `Purpose: ${section.purpose}`,
            `Beat goal: ${section.beatGoal}`,
            section.evidenceSlots?.length ? `Evidence slots: ${section.evidenceSlots.join(" | ")}` : null,
          ]
            .filter(Boolean)
            .join("\n")
        ),
        "",
        "Return JSON with:",
        "- missionTitle: short, specific mission name",
        "- missionObjective: one paragraph stating what every transcript scan should hunt for",
        "- missionInstructions: 4-12 precise rules for the cheap scanner",
        "- keywordHints: 4-20 short phrases or entities that indicate a transcript chunk is worth scanning",
        "- sectionMissions: one per section, with sectionHeading, mission, lookFor, and scanQuestion",
      ].join("\n")
    });

    return {
      model: getAnthropicPlanningModel(),
      spec: {
        ...spec,
        keywordHints: spec.keywordHints.length > 0 ? spec.keywordHints : fallback.keywordHints,
        sectionMissions: packet.sections.map((section) => {
          const matched = spec.sectionMissions.find((item) => item.sectionHeading === section.heading);
          return matched ?? {
            sectionHeading: section.heading,
            mission: section.purpose,
            lookFor: dedupeBy(
              [section.beatGoal, ...(section.evidenceSlots ?? [])].filter(Boolean),
              (value) => value.toLowerCase()
            ).slice(0, 6),
            scanQuestion: [
              `What direct remarks in this transcript help with the documentary section "${section.heading}"?`,
              `Look for: ${dedupeBy(
                [section.beatGoal, ...(section.evidenceSlots ?? [])].filter(Boolean),
                (value) => value.toLowerCase()
              )
                .slice(0, 4)
                .join(" | ")}`,
              "Return the strongest exact moments, not vague summaries.",
            ].join(" "),
          };
        }),
      },
    };
  } catch {
    return {
      model: "fallback",
      spec: fallback,
    };
  }
}

async function resolveClipTranscript(clip: MediaCollector["clips"][number]) {
  const db = getDb();

  if (clip.provider === "youtube") {
    const videoId = parseYouTubeVideoId(clip.sourceUrl);
    if (!videoId) {
      return { clipId: null, segments: null as ClipTranscriptSegment[] | null };
    }

    const clipId = await upsertClipInLibrary({
      provider: "youtube",
      externalId: videoId,
      title: clip.title,
      sourceUrl: clip.sourceUrl,
      channelOrContributor: clip.channelOrContributor ?? null,
    });

    const segments = await withTimeout(
      ensureYouTubeTranscript(clipId, videoId),
      35_000,
      () => null
    );

    return { clipId, segments };
  }

  const [existing] = await db
    .select({ id: clipLibrary.id })
    .from(clipLibrary)
    .where(eq(clipLibrary.sourceUrl, clip.sourceUrl))
    .limit(1);

  if (!existing) {
    return { clipId: null, segments: null as ClipTranscriptSegment[] | null };
  }

  const segments = await getCachedTranscriptSegments(existing.id);
  return { clipId: existing.id, segments };
}

function isResolvableYouTubeClip(url: string) {
  return parseYouTubeVideoId(url) !== null;
}

function buildMissionQuestion(slug: string, mission: MissionSpec) {
  const serialized = JSON.stringify(mission);
  const digest = createHash("sha1").update(serialized).digest("hex").slice(0, 12);
  return {
    cacheKey: digest,
    question: `mission_scan:v2:${slug}:${digest}:${mission.missionTitle}`,
  };
}

async function main() {
  const [slugArg] = process.argv.slice(2);
  if (!slugArg) {
    throw new Error("Usage: tsx scripts/build-media-mission-scan.ts <slug>");
  }

  const packet = await loadPacket(slugArg);
  const collector = await loadCollector(slugArg);
  const { model: missionModel, spec: mission } = await generateMissionSpec(packet);
  const { cacheKey, question } = buildMissionQuestion(slugArg, mission);
  const db = getDb();

  const clips = collector.clips
    .slice()
    .sort((left, right) => right.relevanceScore - left.relevanceScore);

  const resolved = await mapWithConcurrency(clips, 4, async (clip) => {
    const { clipId, segments } = await resolveClipTranscript(clip);
    if (!clipId || !segments?.length) {
      return {
        clip,
        clipId,
        segments: null as ClipTranscriptSegment[] | null,
        cached: null as { answer: string; momentsJson: unknown; model: string } | null,
      };
    }

    const [cached] = await db
      .select({
        answer: clipAiQueries.answer,
        momentsJson: clipAiQueries.momentsJson,
        model: clipAiQueries.model,
      })
      .from(clipAiQueries)
      .where(and(eq(clipAiQueries.clipId, clipId), eq(clipAiQueries.question, question)))
      .orderBy(desc(clipAiQueries.createdAt))
      .limit(1);

    return {
      clip,
      clipId,
      segments,
      cached: cached ?? null,
    };
  });

  let completedScanCount = 0;
  const scanned = await mapWithConcurrency(resolved, 4, async (item) => {
    if (!item.segments?.length || !item.clipId) {
      completedScanCount += 1;
      if (completedScanCount % 5 === 0 || completedScanCount === resolved.length) {
        console.log(`[mission-scan] processed ${completedScanCount}/${resolved.length}`);
      }
      const missingYoutubeTranscript =
        item.clip.provider === "youtube" && isResolvableYouTubeClip(item.clip.sourceUrl);
      return {
        ...item,
        scanStatus: missingYoutubeTranscript ? "missing_transcript" : "skipped" as const,
        scanModel: null as string | null,
        missionSummary: null as string | null,
        talkingPoints: [] as MissionScanPoint[],
      };
    }

    if (item.cached) {
      const talkingPoints = Array.isArray(item.cached.momentsJson)
        ? (item.cached.momentsJson as MissionScanPoint[])
        : [];

      completedScanCount += 1;
      if (completedScanCount % 5 === 0 || completedScanCount === resolved.length) {
        console.log(`[mission-scan] processed ${completedScanCount}/${resolved.length}`);
      }
      return {
        ...item,
        scanStatus: "cached" as const,
        scanModel: item.cached.model,
        missionSummary: item.cached.answer,
        talkingPoints,
      };
    }

    const matchedSectionSet = new Set(item.clip.matchedSections);
    const targetSections = mission.sectionMissions.filter(
      (section) => matchedSectionSet.size === 0 || matchedSectionSet.has(section.sectionHeading)
    );
    const sectionsToAsk = targetSections.length > 0 ? targetSections : mission.sectionMissions.slice(0, 2);

    const talkingPoints: MissionScanPoint[] = [];
    const sectionAnswers: string[] = [];

    for (const section of sectionsToAsk) {
      const qa = await withTimeout(
        askAboutTranscript({
          question: section.scanQuestion,
          transcript: item.segments,
          videoTitle: item.clip.title,
        }),
        30_000,
        () => ({
          answer: "Question timed out.",
          moments: [] as Array<{ text: string; startMs: number; timestamp: string }>,
        })
      );

      if (!qa.moments.length) {
        continue;
      }

      sectionAnswers.push(`${section.sectionHeading}: ${qa.answer}`);
      for (const moment of qa.moments) {
        const verifiedMoment = verifyTranscriptMoment(moment.text, item.segments);
        if (!verifiedMoment) {
          continue;
        }
        const clipSourceUrl = normalizeExternalUrl(item.clip.sourceUrl) ?? item.clip.sourceUrl;
        talkingPoints.push({
          label: section.sectionHeading,
          quoteText: verifiedMoment.quoteText,
          speaker: null,
          startMs: verifiedMoment.startMs,
          endMs: verifiedMoment.endMs,
          relevanceScore: 85,
          whyRelevant: qa.answer,
          matchedSectionHeadings: [section.sectionHeading],
          topics: section.lookFor,
          sourceTitle: item.clip.title,
          sourceUrl: `${clipSourceUrl}${clipSourceUrl.includes("?") ? "&" : "?"}t=${Math.floor(
            verifiedMoment.startMs / 1000
          )}`,
          channelOrContributor: item.clip.channelOrContributor,
          clipId: item.clipId,
        });
      }
    }

    const dedupedTalkingPoints = dedupeBy(
      talkingPoints.sort((left, right) => right.relevanceScore - left.relevanceScore),
      (point) => `${point.startMs}|${point.label}|${point.quoteText.toLowerCase().slice(0, 120)}`
    );
    const missionSummary =
      sectionAnswers.length > 0
        ? sectionAnswers.join(" ")
        : `No mission-relevant talking points found in ${item.clip.title}.`;

    await db.insert(clipAiQueries).values({
      clipId: item.clipId,
      question,
      answer: missionSummary,
      momentsJson: dedupedTalkingPoints,
      model: "gpt-4.1-mini",
    });

    completedScanCount += 1;
    if (completedScanCount % 5 === 0 || completedScanCount === resolved.length) {
      console.log(`[mission-scan] processed ${completedScanCount}/${resolved.length}`);
    }
    return {
      ...item,
      scanStatus: "complete" as const,
      scanModel: "gpt-4.1-mini",
      missionSummary,
      talkingPoints: dedupedTalkingPoints,
    };
  });

  const report: MissionScanReport = {
    version: "1",
    meta: {
      slug: packet.meta.slug,
      title: packet.meta.title,
      generatedAt: new Date().toISOString(),
    },
    mission: {
      ...mission,
      model: missionModel,
      cacheKey,
    },
    summary: {
      totalClips: clips.length,
      eligibleClips: resolved.filter((item) => item.clip.provider === "youtube" || item.clipId).length,
      transcriptedClips: resolved.filter((item) => Array.isArray(item.segments) && item.segments.length > 0).length,
      clipsScanned: scanned.filter((item) => item.scanStatus === "complete" || item.scanStatus === "cached").length,
      clipsWithTalkingPoints: scanned.filter((item) => item.talkingPoints.length > 0).length,
      totalTalkingPoints: scanned.reduce((sum, item) => sum + item.talkingPoints.length, 0),
    },
    sections: mission.sectionMissions.map((sectionMission) => {
      const talkingPoints = scanned
        .flatMap((item) => item.talkingPoints)
        .filter((point) => point.matchedSectionHeadings.includes(sectionMission.sectionHeading))
        .map((point) => ({
          ...point,
          sourceUrl: normalizeExternalUrl(point.sourceUrl) ?? point.sourceUrl,
        }))
        .sort((left, right) => right.relevanceScore - left.relevanceScore);

      const clipsForSection = dedupeBy(
        talkingPoints.map((point) => ({
          title: point.sourceTitle,
          sourceUrl: normalizeExternalUrl(point.sourceUrl) ?? point.sourceUrl,
          channelOrContributor: point.channelOrContributor,
          talkingPointCount: talkingPoints.filter((candidate) => candidate.sourceUrl === point.sourceUrl).length,
        })),
        (item) => item.sourceUrl
      );

      return {
        heading: sectionMission.sectionHeading,
        mission: sectionMission.mission,
        lookFor: sectionMission.lookFor,
        talkingPoints,
        clips: clipsForSection,
      };
    }),
    clips: scanned.map((item) => ({
      title: item.clip.title,
      provider: item.clip.provider,
      sourceUrl: normalizeExternalUrl(item.clip.sourceUrl) ?? item.clip.sourceUrl,
      channelOrContributor: item.clip.channelOrContributor,
      clipId: item.clipId,
      transcriptStatus: item.segments?.length
        ? "complete"
        : item.clip.provider === "youtube" && isResolvableYouTubeClip(item.clip.sourceUrl)
          ? "missing"
          : "skipped",
      scanStatus: item.scanStatus,
      scanModel: item.scanModel,
      missionSummary: item.missionSummary,
      talkingPoints: item.talkingPoints.map((point) => ({
        ...point,
        sourceUrl: normalizeExternalUrl(point.sourceUrl) ?? point.sourceUrl,
      })),
    })),
  };

  const outputPath = path.resolve(process.cwd(), "research", `media-mission-scan-${slugArg}.json`);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.log(
    JSON.stringify(
      {
        outputPath,
        missionTitle: report.mission.missionTitle,
        totalClips: report.summary.totalClips,
        transcriptedClips: report.summary.transcriptedClips,
        clipsScanned: report.summary.clipsScanned,
        clipsWithTalkingPoints: report.summary.clipsWithTalkingPoints,
        totalTalkingPoints: report.summary.totalTalkingPoints,
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
