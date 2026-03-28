import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { constants as fsConstants } from "node:fs";

type Packet = {
  meta: {
    slug: string;
    title: string;
  };
  summary: {
    researchSummary: string;
    thesis: string;
    keyClaims: string[];
    riskyClaims?: string[];
    whyItMattersNow: string;
    modernDayRelevance?: string[];
    tweetWatchlist?: string[];
  };
  sourcePools: {
    articles?: Array<{
      title: string;
      url: string;
      source: string;
      role: string;
      snippet: string;
      publishedAt?: string | null;
      keyPoints?: string[];
    }>;
    socials?: Array<{
      title: string;
      url: string;
      snippet: string;
      publishedAt?: string | null;
      relevanceScore: number;
    }>;
  };
  sections: Array<{
    id: string;
    order: number;
    heading: string;
    purpose: string;
    beatGoal: string;
    whyItMattersNow: string;
    openingMove: string;
    closingMove: string;
    evidenceSlots: string[];
    linkedEvidenceSlots?: Array<{
      label: string;
      sourceType: string;
      sourceTitle: string | null;
      sourceUrl?: string | null;
      quoteText?: string | null;
      context?: string | null;
      startMs?: number | null;
      endMs?: number | null;
      note?: string | null;
    }>;
    quotes: Array<{
      id: string;
      sourceType: string;
      sourceTitle: string;
      sourceUrl?: string | null;
      quoteText: string;
      speaker?: string | null;
      context?: string | null;
      relevanceScore?: number | null;
      usageRole?: string | null;
      startMs?: number | null;
      endMs?: number | null;
    }>;
    transcriptQuotes: Array<{
      sourceLabel: string;
      sourceUrl: string;
      quoteText: string;
      speaker?: string | null;
      context?: string | null;
      relevanceScore: number;
      startMs?: number | null;
      endMs?: number | null;
    }>;
    clips: Array<{
      title: string;
      provider: string;
      sourceUrl: string;
      channelOrContributor?: string | null;
      relevanceScore: number;
    }>;
    articles: Array<{
      title: string;
      url: string;
      source: string;
      role: string;
      snippet: string;
      publishedAt?: string | null;
      keyPoints?: string[];
    }>;
    socials: Array<{
      title: string;
      url: string;
      snippet: string;
      publishedAt?: string | null;
      relevanceScore: number;
    }>;
  }>;
};

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
  meta: {
    slug: string;
    title: string;
  };
  summary: {
    totalClips: number;
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

type TikTokCollectorReport = {
  summary: {
    discoveredUrls: number;
    ingestedClips: number;
    transcriptedClips: number;
    clipsWithTalkingPoints: number;
    totalTalkingPoints: number;
  };
  clips: Array<{
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
    discoveryMethod: string;
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
  }>;
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

type WriterPack = {
  version: string;
  meta: {
    slug: string;
    title: string;
    generatedAt: string;
  };
  summary: {
    researchSummary: string;
    thesis: string;
    storyPoints: string[];
    whyItMattersNow: string;
    totalSections: number;
    clipsWithTranscript: number;
    clipsWithTalkingPoints: number;
    totalTalkingPoints: number;
    missingTranscriptCount: number;
    unsupportedSourceCount: number;
  };
  topSummary: {
    shortSummary: string;
    storyPoints: string[];
  };
  insaneClips: Array<{
    title: string;
    sourceUrl: string;
    provider: string;
    channelOrContributor: string | null;
    transcriptStatus: string;
    scanStatus: string;
    talkingPointCount: number;
    whyUse: string | null;
    visualUrl?: string | null;
    visualKind?: string | null;
  }>;
  importantQuotes: Array<{
    sourceTitle: string;
    sourceUrl: string | null;
    speaker: string | null;
    quoteText: string;
    context: string | null;
    startMs: number | null;
    endMs: number | null;
    provenance: string;
    sectionHeading: string | null;
    visualUrl?: string | null;
    visualKind?: string | null;
  }>;
  tiktokClips?: Array<{
    title: string;
    sourceUrl: string;
    provider: string;
    channelOrContributor: string | null;
    transcriptSegments: number;
    talkingPointCount: number;
    whyUse: string | null;
    primaryQuote: string | null;
    discoveryQuery: string;
    visualUrl?: string | null;
    visualKind?: string | null;
  }>;
  audienceReaction: Array<{
    title: string;
    url: string;
    snippet: string;
    publishedAt?: string | null;
    relevanceScore: number;
    visualUrl?: string | null;
    visualKind?: string | null;
  }>;
  articleReceipts: Array<{
    title: string;
    url: string;
    source: string;
    role: string;
    snippet: string;
    publishedAt?: string | null;
    keyPoints?: string[];
  }>;
  pipeline: {
    packetPath: string;
    missionScanPath: string;
  };
  queues: {
    missingTranscriptQueue: Array<{
      title: string;
      provider: string;
      sourceUrl: string;
      channelOrContributor: string | null;
      reason: string;
    }>;
    unsupportedSourceQueue: Array<{
      title: string;
      provider: string;
      sourceUrl: string;
      channelOrContributor: string | null;
      reason: string;
    }>;
    transcriptedNoTalkingPoints: Array<{
      title: string;
      provider: string;
      sourceUrl: string;
      channelOrContributor: string | null;
    }>;
  };
  sections: Array<{
    id: string;
    order: number;
    heading: string;
    purpose: string;
    beatGoal: string;
    whyItMattersNow: string;
    openingMove: string;
    closingMove: string;
    evidenceSlots: Array<{
      label: string;
      sourceType: string;
      sourceTitle: string | null;
      sourceUrl: string | null;
      note: string | null;
    }>;
    bestQuotes: Array<{
      provenance: "mission_scan" | "packet_transcript" | "packet_quote";
      sourceTitle: string;
      sourceUrl: string | null;
      speaker: string | null;
      quoteText: string;
      context: string | null;
      relevanceScore: number | null;
      startMs: number | null;
      endMs: number | null;
      visualUrl?: string | null;
      visualKind?: string | null;
    }>;
    bestClips: Array<{
      title: string;
      sourceUrl: string;
      provider: string | null;
      channelOrContributor: string | null;
      transcriptStatus: string;
      talkingPointCount: number;
      relevanceScore: number | null;
      visualUrl?: string | null;
      visualKind?: string | null;
    }>;
    articles: Packet["sections"][number]["articles"];
    socials: Packet["sections"][number]["socials"];
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

const SLOT_STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "in",
  "into",
  "is",
  "it",
  "its",
  "of",
  "on",
  "or",
  "that",
  "the",
  "this",
  "to",
  "use",
  "with",
]);

function tokenizeKeywords(text: string, max = 24) {
  const tokens = text.match(/[A-Za-z0-9][A-Za-z0-9'_-]*/g) ?? [];
  const seen = new Set<string>();
  const collected: string[] = [];
  for (const token of tokens) {
    const normalized = token.toLowerCase().replace(/^'+|'+$/g, "");
    if (!normalized || normalized.length < 3 || SLOT_STOPWORDS.has(normalized) || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    collected.push(normalized);
    if (collected.length >= max) {
      break;
    }
  }
  return collected;
}

function countKeywordHits(text: string, keywords: string[]) {
  const normalized = text.toLowerCase();
  let hits = 0;
  for (const keyword of keywords) {
    if (normalized.includes(keyword)) {
      hits += 1;
    }
  }
  return hits;
}

function extractQuotedPhrases(text: string) {
  return Array.from(text.matchAll(/["'“](.{3,140}?)["'”]/g)).map((match) => match[1].trim());
}

function extractUrlHints(text: string) {
  const rawMatches = text.match(/(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/watch\?v=[^\s\],]+|youtu\.be\/[^\s\],]+|x\.com\/[^\s\],]+|twitter\.com\/[^\s\],]+|reuters\.com\/[^\s\],]+)/gi) ?? [];
  return rawMatches.map((match) => {
    const normalized = /^https?:\/\//i.test(match) ? match : `https://${match}`;
    return normalized.replace(/[)\].,]+$/, "");
  });
}

function getHostname(url: string | null | undefined) {
  if (!url) return "";
  try {
    return new URL(decodeURIComponent(url)).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return "";
  }
}

function normalizeQuoteKey(text: string) {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function getSocialSelectionMeta(url: string) {
  const normalized = normalizeExternalUrl(url) ?? url;
  try {
    const parsed = new URL(normalized);
    const host = parsed.hostname.replace(/^www\./i, "").toLowerCase();
    const parts = parsed.pathname.split("/").filter(Boolean).map((part) => part.toLowerCase());

    if (host === "x.com" || host.endsWith(".x.com") || host === "twitter.com" || host.endsWith(".twitter.com")) {
      const isCanonicalStatus = parts[1] === "status" && parts[2];
      const isIStatus = parts[0] === "i" && parts[1] === "status" && parts[2];
      const handle = isIStatus ? `status:${parts[2]}` : (parts[0] ?? "unknown");
      return {
        hostKey: "x",
        identityKey: isCanonicalStatus || isIStatus ? `x:${handle}` : `x:${handle}`,
        identityLimit: 1,
        hostLimit: 6,
      };
    }

    if (host === "reddit.com" || host.endsWith(".reddit.com")) {
      if (parts[0] === "r" && parts[1]) {
        return {
          hostKey: "reddit",
          identityKey: `reddit:r:${parts[1]}`,
          identityLimit: 1,
          hostLimit: 3,
        };
      }
      if (parts[0] === "user" && parts[1]) {
        return {
          hostKey: "reddit",
          identityKey: `reddit:user:${parts[1]}`,
          identityLimit: 1,
          hostLimit: 3,
        };
      }
      return {
        hostKey: "reddit",
        identityKey: "reddit:misc",
        identityLimit: 2,
        hostLimit: 3,
      };
    }

    return {
      hostKey: host || "unknown",
      identityKey: host || normalized.toLowerCase(),
      identityLimit: 1,
      hostLimit: 2,
    };
  } catch {
    return {
      hostKey: "unknown",
      identityKey: normalized.toLowerCase(),
      identityLimit: 1,
      hostLimit: 2,
    };
  }
}

function selectDiverseSocialEntries<T extends { url: string }>(items: T[], maxResults: number) {
  const candidates = dedupeBy(items, (item) => normalizeExternalUrl(item.url) ?? item.url);
  const selected: T[] = [];
  const identityCounts = new Map<string, number>();
  const hostCounts = new Map<string, number>();

  for (const pass of [0, 1]) {
    for (const item of candidates) {
      if (selected.includes(item)) {
        continue;
      }

      const meta = getSocialSelectionMeta(item.url);
      const identityLimit = meta.identityLimit + (pass === 1 && meta.hostKey === "x" ? 1 : 0);
      const hostLimit = meta.hostLimit + (pass === 1 ? 1 : 0);
      const identityCount = identityCounts.get(meta.identityKey) ?? 0;
      const hostCount = hostCounts.get(meta.hostKey) ?? 0;

      if (identityCount >= identityLimit || hostCount >= hostLimit) {
        continue;
      }

      selected.push(item);
      identityCounts.set(meta.identityKey, identityCount + 1);
      hostCounts.set(meta.hostKey, hostCount + 1);

      if (selected.length >= maxResults) {
        return selected;
      }
    }
  }

  return selected;
}

function clampScore(value: number | null | undefined) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return 50;
  }
  return Math.max(0, Math.min(100, value));
}

function looksLowSignalQuote(text: string) {
  const normalized = text.toLowerCase().trim();
  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length < 8) {
    return true;
  }
  const noiseHits = (normalized.match(/\[(music|applause|laughter)\]/g) ?? []).length;
  if (noiseHits > 0) {
    return true;
  }
  if (/^\W*(melania trump|figure 3|thank you)\W*$/i.test(text.trim())) {
    return true;
  }
  return false;
}

function inferPreferredSourceType(label: string) {
  const lower = label.toLowerCase();
  if (/\bx post\b|\btweet\b|\bx\.com\b|\btwitter\b|@\w+/.test(lower)) {
    return "social";
  }
  if (/\breuters\b|\barticle\b|\bap\b|\bnews\b/.test(lower)) {
    return "article";
  }
  if (/\btranscript\b|\bon camera\b|\bspeech\b|\bclip\b|\byoutube\b/.test(lower)) {
    return "clip_transcript";
  }
  return null;
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

function stripTimeParam(url: string | null | undefined) {
  const normalizedUrl = normalizeExternalUrl(url);
  if (!normalizedUrl) return "";
  try {
    const parsed = new URL(normalizedUrl);
    parsed.searchParams.delete("t");
    return parsed.toString();
  } catch {
    return normalizedUrl.replace(/([?&])t=\d+(&?)/g, (_match, prefix: string, suffix: string) =>
      prefix === "?" && suffix ? "?" : suffix ? prefix : ""
    );
  }
}

function parseYouTubeVideoId(url: string) {
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
    const shortsMatch = parsed.pathname.match(/\/shorts\/([A-Za-z0-9_-]{11})/);
    return shortsMatch?.[1] ?? null;
  } catch {
    return null;
  }
}

function isXStatusUrl(url: string | null | undefined) {
  const host = getHostname(url);
  return host === "x.com" || host === "twitter.com" || host.endsWith(".x.com") || host.endsWith(".twitter.com");
}

async function fileExists(filePath: string) {
  try {
    await access(filePath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function buildAssetBasename(normalizedUrl: string, extension: string) {
  return `${createHash("sha1").update(normalizedUrl).digest("hex").slice(0, 16)}.${extension}`;
}

async function ensureDirectory(dirPath: string) {
  await mkdir(dirPath, { recursive: true });
}

async function ensureYouTubeThumbnailAsset(args: {
  slug: string;
  normalizedUrl: string;
}) {
  const videoId = parseYouTubeVideoId(args.normalizedUrl);
  if (!videoId) {
    return null;
  }

  const assetDir = path.resolve(process.cwd(), "public", "writer-pack-assets", args.slug);
  await ensureDirectory(assetDir);
  const fileName = `${videoId}.jpg`;
  const filePath = path.join(assetDir, fileName);
  const publicUrl = `/writer-pack-assets/${args.slug}/${fileName}`;

  if (await fileExists(filePath)) {
    return {
      visualUrl: publicUrl,
      visualKind: "video_thumbnail",
    };
  }

  const candidates = [
    `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`,
    `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
  ];

  for (const candidate of candidates) {
    try {
      const response = await fetch(candidate);
      if (!response.ok) {
        continue;
      }
      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.startsWith("image/")) {
        continue;
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      await writeFile(filePath, buffer);
      return {
        visualUrl: publicUrl,
        visualKind: "video_thumbnail",
      };
    } catch {
      continue;
    }
  }

  return {
    visualUrl: candidates[candidates.length - 1],
    visualKind: "video_thumbnail",
  };
}

async function ensureTweetScreenshotAsset(args: {
  slug: string;
  normalizedUrl: string;
}) {
  const assetDir = path.resolve(process.cwd(), "public", "writer-pack-assets", args.slug);
  await ensureDirectory(assetDir);
  const fileName = buildAssetBasename(args.normalizedUrl, "png");
  const filePath = path.join(assetDir, fileName);
  const publicUrl = `/writer-pack-assets/${args.slug}/${fileName}`;

  if (await fileExists(filePath)) {
    return {
      visualUrl: publicUrl,
      visualKind: "tweet_screenshot",
    };
  }

  try {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 1400, height: 1800 },
        deviceScaleFactor: 1,
      });
      await page.goto(args.normalizedUrl, {
        waitUntil: "domcontentloaded",
        timeout: 120_000,
      });
      await page.waitForTimeout(5_000);
      const article = page.locator("article").first();
      if ((await article.count()) > 0) {
        await article.screenshot({ path: filePath });
      } else {
        await page.screenshot({ path: filePath, fullPage: true });
      }
    } finally {
      await browser.close();
    }

    return {
      visualUrl: publicUrl,
      visualKind: "tweet_screenshot",
    };
  } catch {
    return null;
  }
}

async function buildVisualAssetMap(slug: string, urls: Array<string | null | undefined>) {
  const normalizedUrls = dedupeBy(
    urls
      .map((url) => normalizeExternalUrl(url))
      .filter((url): url is string => Boolean(url)),
    (url) => stripTimeParam(url)
  );

  const map = new Map<string, { visualUrl: string | null; visualKind: string | null }>();
  for (const normalizedUrl of normalizedUrls) {
    const key = stripTimeParam(normalizedUrl);
    if (!key) {
      continue;
    }

    let visual: { visualUrl: string | null; visualKind: string | null } | null = null;
    if (parseYouTubeVideoId(normalizedUrl)) {
      visual = await ensureYouTubeThumbnailAsset({ slug, normalizedUrl });
    } else if (isXStatusUrl(normalizedUrl)) {
      visual = await ensureTweetScreenshotAsset({ slug, normalizedUrl });
    }

    if (visual) {
      map.set(key, visual);
    }
  }

  return map;
}

async function loadPacket(slug: string) {
  const filePath = path.resolve(process.cwd(), "research", `research-packet-${slug}.json`);
  return {
    filePath,
    data: JSON.parse(await readFile(filePath, "utf8")) as Packet,
  };
}

async function loadMissionScan(slug: string) {
  const filePath = path.resolve(process.cwd(), "research", `media-mission-scan-${slug}.json`);
  return {
    filePath,
    data: JSON.parse(await readFile(filePath, "utf8")) as MissionScanReport,
  };
}

async function loadTikTokCollector(slug: string) {
  const filePath = path.resolve(process.cwd(), "research", `tiktok-collector-${slug}.json`);
  if (!(await fileExists(filePath))) {
    return null;
  }

  return {
    filePath,
    data: JSON.parse(await readFile(filePath, "utf8")) as TikTokCollectorReport,
  };
}

type EvidenceCandidate = {
  sourceType: string;
  sourceTitle: string | null;
  sourceUrl: string | null;
  quoteText: string | null;
  context: string | null;
  note: string | null;
};

function buildEvidenceSlotsForSection(args: {
  section: Packet["sections"][number];
  missionSection: MissionScanReport["sections"][number] | undefined;
}) {
  const rawCandidates: EvidenceCandidate[] = [
    ...(args.missionSection?.talkingPoints ?? []).map((point) => ({
      sourceType: "clip_transcript",
      sourceTitle: point.sourceTitle,
      sourceUrl: point.sourceUrl,
      quoteText: point.quoteText,
      context: point.whyRelevant,
      note: "Matched to verified mission-scan quote",
    })),
    ...args.section.transcriptQuotes.map((quote) => ({
      sourceType: "clip_transcript",
      sourceTitle: quote.sourceLabel,
      sourceUrl: quote.sourceUrl,
      quoteText: quote.quoteText,
      context: quote.context ?? null,
      note: "Matched to transcript passage",
    })),
    ...args.section.articles.map((article) => ({
      sourceType: "article",
      sourceTitle: article.title,
      sourceUrl: article.url,
      quoteText: null,
      context: [...(article.keyPoints ?? []), article.snippet].filter(Boolean).join(" "),
      note: "Matched to article source",
    })),
    ...args.section.socials.map((social) => ({
      sourceType: "social",
      sourceTitle: social.title,
      sourceUrl: social.url,
      quoteText: null,
      context: social.snippet,
      note: "Matched to social source",
    })),
    ...args.section.clips.map((clip) => ({
      sourceType: "clip",
      sourceTitle: clip.title,
      sourceUrl: clip.sourceUrl,
      quoteText: null,
      context: clip.channelOrContributor ?? null,
      note: "Matched to key clip",
    })),
  ];

  const candidates = dedupeBy(
    rawCandidates,
    (candidate) =>
      `${candidate.sourceType}|${stripTimeParam(candidate.sourceUrl)}|${normalizeQuoteKey(candidate.quoteText ?? candidate.context ?? candidate.sourceTitle ?? "").slice(0, 120)}`
  );

  const used = new Set<string>();
  return args.section.evidenceSlots.map((label) => {
    const preferredType = inferPreferredSourceType(label);
    const urlHints = extractUrlHints(label).map((url) => stripTimeParam(url));
    const hostHints = urlHints.map((url) => getHostname(url));
    const quotedPhrases = extractQuotedPhrases(label);
    const slotKeywords = tokenizeKeywords([label, args.section.heading, args.section.beatGoal].join(" "), 20);

    const scored = candidates.map((candidate) => {
      const candidateText = [
        candidate.sourceTitle ?? "",
        candidate.quoteText ?? "",
        candidate.context ?? "",
        candidate.sourceUrl ?? "",
      ].join(" ").toLowerCase();

      let score = 0;
      if (preferredType && candidate.sourceType === preferredType) {
        score += 120;
      } else if (preferredType && candidate.sourceType !== preferredType) {
        score -= 60;
      }
      if (preferredType === "clip_transcript" && candidate.sourceType === "clip") {
        score += 20;
      }
      if (urlHints.length > 0 && candidate.sourceUrl) {
        const normalizedCandidateUrl = stripTimeParam(candidate.sourceUrl);
        if (urlHints.includes(normalizedCandidateUrl)) {
          score += 180;
        }
      }
      if (hostHints.length > 0 && candidate.sourceUrl && hostHints.includes(getHostname(candidate.sourceUrl))) {
        score += 45;
      }
      for (const phrase of quotedPhrases) {
        const normalizedPhrase = phrase.toLowerCase();
        if (normalizedPhrase.length >= 8 && candidateText.includes(normalizedPhrase)) {
          score += 80;
        }
      }
      score += countKeywordHits(candidateText, slotKeywords) * 12;

      const candidateKey = `${candidate.sourceType}|${stripTimeParam(candidate.sourceUrl)}|${candidate.sourceTitle ?? ""}`;
      if (used.has(candidateKey) && score < 150) {
        score -= 80;
      }

      return { candidate, candidateKey, score };
    });

    const best = scored.sort((left, right) => right.score - left.score)[0];
    if (best && best.score >= 40) {
      used.add(best.candidateKey);
      return {
        label,
        sourceType: best.candidate.sourceType,
        sourceTitle: best.candidate.sourceTitle,
        sourceUrl: best.candidate.sourceUrl,
        note: best.candidate.note,
      };
    }

    return {
      label,
      sourceType: "unlinked",
      sourceTitle: null,
      sourceUrl: null,
      note: "No strong source match yet",
    };
  });
}

async function main() {
  const [slugArg] = process.argv.slice(2);
  if (!slugArg) {
    throw new Error("Usage: tsx scripts/build-writer-pack.ts <slug>");
  }

  const { filePath: packetPath, data: packet } = await loadPacket(slugArg);
  const { filePath: missionPath, data: mission } = await loadMissionScan(slugArg);
  const tiktokCollector = await loadTikTokCollector(slugArg);

  const missionClipMap = new Map(
    mission.clips.map((clip) => [stripTimeParam(clip.sourceUrl), clip])
  );

  const sections = packet.sections.map((section) => {
    const missionSection = mission.sections.find((item) => item.heading === section.heading);
    const sectionKeywords = tokenizeKeywords(
      [section.heading, section.purpose, section.beatGoal, section.whyItMattersNow, ...section.evidenceSlots].join(" "),
      30
    );
    const evidenceSlots = buildEvidenceSlotsForSection({
      section,
      missionSection,
    });
    const linkedSourceUrls = evidenceSlots
      .map((slot) => stripTimeParam(slot.sourceUrl))
      .filter(Boolean);
    const quotedPhrases = section.evidenceSlots.flatMap(extractQuotedPhrases);

    const bestQuotes = dedupeBy(
      [
        ...(missionSection?.talkingPoints ?? []).map((quote) => {
          const combined = [quote.sourceTitle, quote.quoteText].join(" ").toLowerCase();
          const exactSourceMatch = linkedSourceUrls.includes(stripTimeParam(quote.sourceUrl));
          const phraseBonus = quotedPhrases.some((phrase) => combined.includes(phrase.toLowerCase())) ? 80 : 0;
          return {
            provenance: "mission_scan" as const,
            sourceTitle: quote.sourceTitle,
            sourceUrl: normalizeExternalUrl(quote.sourceUrl),
            speaker: quote.speaker,
            quoteText: quote.quoteText,
            context: quote.whyRelevant,
            relevanceScore: clampScore(quote.relevanceScore),
            startMs: quote.startMs,
            endMs: quote.endMs,
            weight: clampScore(quote.relevanceScore) + 16 + countKeywordHits(combined, sectionKeywords) * 8 + phraseBonus + (exactSourceMatch ? 160 : 0),
            exactSourceMatch,
            phraseBonus,
          };
        }),
        ...section.transcriptQuotes.map((quote) => {
          const combined = [quote.sourceLabel, quote.quoteText].join(" ").toLowerCase();
          const exactSourceMatch = linkedSourceUrls.includes(stripTimeParam(quote.sourceUrl));
          const phraseBonus = quotedPhrases.some((phrase) => combined.includes(phrase.toLowerCase())) ? 80 : 0;
          return {
            provenance: "packet_transcript" as const,
            sourceTitle: quote.sourceLabel,
            sourceUrl: normalizeExternalUrl(quote.sourceUrl),
            speaker: quote.speaker ?? null,
            quoteText: quote.quoteText,
            context: quote.context ?? null,
            relevanceScore: clampScore(quote.relevanceScore),
            startMs: quote.startMs ?? null,
            endMs: quote.endMs ?? null,
            weight: clampScore(quote.relevanceScore) + 10 + countKeywordHits(combined, sectionKeywords) * 8 + phraseBonus + (exactSourceMatch ? 180 : 0),
            exactSourceMatch,
            phraseBonus,
          };
        }),
      ],
      (quote) => normalizeQuoteKey(quote.quoteText).slice(0, 120)
    )
      .sort((left, right) => right.weight - left.weight);

    const limitedBestQuotes = (() => {
      const perClipCounts = new Map<string, number>();
      const selected: Array<(typeof bestQuotes)[number]> = [];
      for (const quote of bestQuotes) {
        if (looksLowSignalQuote(quote.quoteText)) {
          continue;
        }
        const hasStrongAnchor = quote.exactSourceMatch || quote.phraseBonus > 0;
        if (linkedSourceUrls.length > 0 && !hasStrongAnchor) {
          continue;
        }
        const clipKey = stripTimeParam(quote.sourceUrl) || `${quote.sourceTitle}:${quote.startMs ?? "na"}`;
        const used = perClipCounts.get(clipKey) ?? 0;
        if (used >= 1) {
          continue;
        }
        perClipCounts.set(clipKey, used + 1);
        selected.push(quote);
        if (selected.length >= 8) {
          break;
        }
      }
      return selected.map(({ weight: _weight, exactSourceMatch: _exactSourceMatch, phraseBonus: _phraseBonus, ...quote }) => quote);
    })();

    const bestClips = dedupeBy(
      [
        ...section.clips.map((clip) => {
          const missionClip = missionClipMap.get(stripTimeParam(clip.sourceUrl));
          return {
            title: clip.title,
            sourceUrl: normalizeExternalUrl(clip.sourceUrl) ?? clip.sourceUrl,
            provider: clip.provider,
            channelOrContributor: clip.channelOrContributor ?? missionClip?.channelOrContributor ?? null,
            transcriptStatus: missionClip?.transcriptStatus ?? "unknown",
            talkingPointCount: missionClip?.talkingPoints.length ?? 0,
            relevanceScore: clip.relevanceScore,
          };
        }),
        ...(missionSection?.clips ?? []).map((clip) => {
          const missionClip = missionClipMap.get(stripTimeParam(clip.sourceUrl));
          return {
            title: clip.title,
            sourceUrl: normalizeExternalUrl(clip.sourceUrl) ?? clip.sourceUrl,
            provider: missionClip?.provider ?? null,
            channelOrContributor: clip.channelOrContributor ?? missionClip?.channelOrContributor ?? null,
            transcriptStatus: missionClip?.transcriptStatus ?? "unknown",
            talkingPointCount: clip.talkingPointCount,
            relevanceScore: missionClip?.talkingPoints[0]?.relevanceScore ?? null,
          };
        }),
      ],
      (clip) => stripTimeParam(clip.sourceUrl)
    )
      .sort((left, right) => {
        const leftTranscript = left.transcriptStatus === "complete" ? 1 : 0;
        const rightTranscript = right.transcriptStatus === "complete" ? 1 : 0;
        if (rightTranscript !== leftTranscript) return rightTranscript - leftTranscript;
        if (right.talkingPointCount !== left.talkingPointCount) return right.talkingPointCount - left.talkingPointCount;
        return (right.relevanceScore ?? 0) - (left.relevanceScore ?? 0);
      })
      .slice(0, 8);

    return {
      id: section.id,
      order: section.order,
      heading: section.heading,
      purpose: section.purpose,
      beatGoal: section.beatGoal,
      whyItMattersNow: section.whyItMattersNow,
      openingMove: section.openingMove,
      closingMove: section.closingMove,
      evidenceSlots,
      bestQuotes: limitedBestQuotes,
      bestClips,
      articles: section.articles.slice(0, 6),
      socials: section.socials.slice(0, 6),
    };
  });

  const tiktokClips = (tiktokCollector?.data.clips ?? [])
    .filter((clip) => clip.talkingPoints.length > 0)
    .sort((left, right) => {
      if (right.maxTalkingPointScore !== left.maxTalkingPointScore) {
        return right.maxTalkingPointScore - left.maxTalkingPointScore;
      }
      return (right.viewCount ?? 0) - (left.viewCount ?? 0);
    })
    .slice(0, 10)
    .map((clip) => ({
      title: clip.title,
      sourceUrl: normalizeExternalUrl(clip.sourceUrl) ?? clip.sourceUrl,
      provider: clip.provider,
      channelOrContributor: clip.channelOrContributor,
      transcriptSegments: clip.transcriptSegments,
      talkingPointCount: clip.talkingPoints.length,
      whyUse: clip.missionSummary,
      primaryQuote: clip.talkingPoints[0]?.quoteText ?? null,
      discoveryQuery: clip.discoveryQuery,
      visualUrl: clip.previewUrl,
      visualKind: clip.previewUrl ? "video_thumbnail" : null,
    }));

  const report: WriterPack = {
    version: "1",
    meta: {
      slug: packet.meta.slug,
      title: packet.meta.title,
      generatedAt: new Date().toISOString(),
    },
    summary: {
      researchSummary: packet.summary.researchSummary,
      thesis: packet.summary.thesis,
      storyPoints: [
        ...packet.summary.keyClaims,
        ...(packet.summary.modernDayRelevance ?? []),
      ].slice(0, 12),
      whyItMattersNow: packet.summary.whyItMattersNow,
      totalSections: sections.length,
      clipsWithTranscript: mission.summary.transcriptedClips,
      clipsWithTalkingPoints: mission.summary.clipsWithTalkingPoints,
      totalTalkingPoints: mission.summary.totalTalkingPoints,
      missingTranscriptCount: mission.clips.filter((clip) => clip.scanStatus === "missing_transcript").length,
      unsupportedSourceCount: mission.clips.filter((clip) => clip.scanStatus === "skipped").length,
    },
    topSummary: {
      shortSummary: packet.summary.researchSummary,
      storyPoints: [
        ...packet.summary.keyClaims,
        ...(packet.summary.modernDayRelevance ?? []),
      ].slice(0, 10),
    },
    insaneClips: dedupeBy(
      [
        ...mission.clips.map((clip) => ({
          title: clip.title,
          sourceUrl: normalizeExternalUrl(clip.sourceUrl) ?? clip.sourceUrl,
          provider: clip.provider,
          channelOrContributor: clip.channelOrContributor,
          transcriptStatus: clip.transcriptStatus,
          scanStatus: clip.scanStatus,
          talkingPointCount: clip.talkingPoints.length,
          whyUse: clip.missionSummary,
          score: (clip.talkingPoints.length * 20)
            + (clip.transcriptStatus === "complete" ? 20 : 0)
            + (clip.scanStatus === "missing_transcript" ? 5 : 0),
        })),
      ],
      (clip) => stripTimeParam(clip.sourceUrl)
    )
      .sort((left, right) => right.score - left.score)
      .slice(0, 24)
      .map(({ score: _score, ...clip }) => clip),
    importantQuotes: dedupeBy(
      [
        ...sections.flatMap((section) =>
          section.bestQuotes.map((quote) => ({
            sourceTitle: quote.sourceTitle,
            sourceUrl: normalizeExternalUrl(quote.sourceUrl),
            speaker: quote.speaker,
            quoteText: quote.quoteText,
            context: quote.context,
            startMs: quote.startMs,
            endMs: quote.endMs,
            provenance: quote.provenance,
            sectionHeading: section.heading,
          }))
        ),
        ...(tiktokCollector?.data.topQuotes ?? []).map((quote) => ({
          sourceTitle: quote.sourceTitle,
          sourceUrl: normalizeExternalUrl(quote.sourceUrl),
          speaker: quote.speaker,
          quoteText: quote.quoteText,
          context: quote.whyRelevant,
          startMs: quote.startMs,
          endMs: quote.endMs,
          provenance: "tiktok_scan",
          sectionHeading: "TikTok lane",
          visualUrl: quote.previewUrl,
          visualKind: quote.previewUrl ? "video_thumbnail" : null,
        })),
      ],
      (quote) => normalizeQuoteKey(quote.quoteText).slice(0, 120)
    ).slice(0, 24),
    tiktokClips,
    audienceReaction: selectDiverseSocialEntries(
      dedupeBy(
        [
          ...(packet.sourcePools.socials ?? []),
          ...sections.flatMap((section) => section.socials),
        ],
        (item) => item.url
      ).sort((left, right) => right.relevanceScore - left.relevanceScore),
      20
    ),
    articleReceipts: dedupeBy(
      [
        ...(packet.sourcePools.articles ?? []),
        ...sections.flatMap((section) => section.articles),
      ],
      (item) => item.url
    ).slice(0, 20),
    pipeline: {
      packetPath,
      missionScanPath: missionPath,
    },
    queues: {
      missingTranscriptQueue: mission.clips
        .filter((clip) => clip.scanStatus === "missing_transcript")
        .map((clip) => ({
          title: clip.title,
          provider: clip.provider,
          sourceUrl: normalizeExternalUrl(clip.sourceUrl) ?? clip.sourceUrl,
          channelOrContributor: clip.channelOrContributor,
          reason: "Valid YouTube video, but transcript recovery did not succeed yet.",
        })),
      unsupportedSourceQueue: mission.clips
        .filter((clip) => clip.scanStatus === "skipped")
        .map((clip) => ({
          title: clip.title,
          provider: clip.provider,
          sourceUrl: normalizeExternalUrl(clip.sourceUrl) ?? clip.sourceUrl,
          channelOrContributor: clip.channelOrContributor,
          reason:
            clip.provider === "youtube" && !parseYouTubeVideoId(clip.sourceUrl)
              ? "Not a direct YouTube video URL."
              : clip.provider === "parallel"
                ? "Discovered via Parallel/inventory source with no transcript adapter in this pass."
                : "Included in inventory, but not transcript-scanned in this pass.",
        })),
      transcriptedNoTalkingPoints: mission.clips
        .filter(
          (clip) =>
            clip.transcriptStatus === "complete"
            && clip.scanStatus !== "skipped"
            && clip.talkingPoints.length === 0
        )
        .map((clip) => ({
          title: clip.title,
          provider: clip.provider,
          sourceUrl: normalizeExternalUrl(clip.sourceUrl) ?? clip.sourceUrl,
          channelOrContributor: clip.channelOrContributor,
        })),
    },
    sections,
  };

  const visualAssetMap = await buildVisualAssetMap(slugArg, [
    ...report.insaneClips.map((clip) => clip.sourceUrl),
    ...report.importantQuotes.map((quote) => quote.sourceUrl),
    ...report.audienceReaction.map((item) => item.url),
  ]);

  report.insaneClips = report.insaneClips.map((clip) => ({
    ...clip,
    ...(visualAssetMap.get(stripTimeParam(clip.sourceUrl)) ?? {}),
  }));
  report.importantQuotes = report.importantQuotes.map((quote) => ({
    ...quote,
    ...(quote.sourceUrl ? visualAssetMap.get(stripTimeParam(quote.sourceUrl)) ?? {} : {}),
  }));
  report.audienceReaction = report.audienceReaction.map((item) => ({
    ...item,
    ...(visualAssetMap.get(stripTimeParam(item.url)) ?? {}),
  }));
  report.sections = report.sections.map((section) => ({
    ...section,
    bestQuotes: section.bestQuotes.map((quote) => ({
      ...quote,
      ...(quote.sourceUrl ? visualAssetMap.get(stripTimeParam(quote.sourceUrl)) ?? {} : {}),
    })),
    bestClips: section.bestClips.map((clip) => ({
      ...clip,
      ...(visualAssetMap.get(stripTimeParam(clip.sourceUrl)) ?? {}),
    })),
  }));

  const outputPath = path.resolve(process.cwd(), "research", `writer-pack-${slugArg}.json`);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.log(
    JSON.stringify(
      {
        outputPath,
        totalSections: report.summary.totalSections,
        clipsWithTranscript: report.summary.clipsWithTranscript,
        clipsWithTalkingPoints: report.summary.clipsWithTalkingPoints,
        missingTranscriptCount: report.summary.missingTranscriptCount,
        unsupportedSourceCount: report.summary.unsupportedSourceCount,
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
