import "server-only";

import { mkdir } from "node:fs/promises";
import path from "node:path";

import { getEnv } from "@/server/config/env";
import {
  resolveLocalMediaMetadata,
  type ResolvedLocalMediaMetadata,
} from "@/server/providers/local-media";
import { searchResearchSources } from "@/server/providers/parallel";

const TIKTOK_VIDEO_URL_PATTERN =
  /^https?:\/\/(?:www\.)?tiktok\.com\/@([^/]+)\/video\/(\d+)/i;
const TIKTOK_ITEM_LIST_URL_PATTERN =
  /\/api\/(?:challenge\/item_list|recommend\/item_list|preload\/item_list|prefetch\/explore\/item_list|post\/item_list|user\/post\/item_list)\//i;
const TIKTOK_DISCOVERY_MAX_AGE_HOURS = 72;
const TIKTOK_DISCOVERY_OUTLIER_MAX_AGE_HOURS = 168;
const TIKTOK_QUERY_STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "app",
  "backlash",
  "bad",
  "clip",
  "clips",
  "drama",
  "for",
  "fyp",
  "hate",
  "is",
  "meme",
  "new",
  "reaction",
  "tiktok",
  "trend",
  "trending",
  "video",
  "viral",
]);

export interface TikTokVideoResult extends ResolvedLocalMediaMetadata {
  discoveryMethod: "search" | "fyp";
  discoveryQuery: string | null;
  profileKey: string | null;
  videoId: string | null;
}

type TikTokApiItem = {
  id?: unknown;
  desc?: unknown;
  createTime?: unknown;
  author?: {
    uniqueId?: unknown;
    nickname?: unknown;
  } | null;
  stats?: {
    playCount?: unknown;
    diggCount?: unknown;
    commentCount?: unknown;
    shareCount?: unknown;
  } | null;
  video?: {
    cover?: unknown;
    dynamicCover?: unknown;
    originCover?: unknown;
    downloadAddr?: unknown;
    duration?: unknown;
  } | null;
  isAd?: unknown;
};

function normalizeTikTokTag(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/^#+/, "")
    .replace(/[^a-z0-9]+/g, "");

  return normalized.length > 0 ? normalized : null;
}

function normalizeTikTokVideoUrl(url: string | null | undefined) {
  if (!url) {
    return null;
  }

  try {
    const parsed = new URL(url);
    parsed.hash = "";
    for (const key of Array.from(parsed.searchParams.keys())) {
      if (!["lang", "is_from_webapp"].includes(key)) {
        parsed.searchParams.delete(key);
      }
    }

    const normalized = parsed.toString();
    return TIKTOK_VIDEO_URL_PATTERN.test(normalized) ? normalized : null;
  } catch {
    return null;
  }
}

function extractTikTokHandle(url: string | null | undefined) {
  const normalized = normalizeTikTokVideoUrl(url);
  const match = normalized?.match(TIKTOK_VIDEO_URL_PATTERN);
  return match?.[1] ?? null;
}

function extractTikTokVideoId(url: string | null | undefined) {
  const normalized = normalizeTikTokVideoUrl(url);
  const match = normalized?.match(TIKTOK_VIDEO_URL_PATTERN);
  return match?.[2] ?? null;
}

function asTikTokString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function asTikTokNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function buildTikTokVideoPageUrl(handle: string | null, videoId: string | null) {
  if (!handle || !videoId) {
    return null;
  }

  return `https://www.tiktok.com/@${handle}/video/${videoId}`;
}

function buildTikTokSeedUrls(profileKey: string) {
  const normalized = sanitizeProfileKey(profileKey);
  const search = (query: string) =>
    `https://www.tiktok.com/search/video?q=${encodeURIComponent(query)}`;
  const tag = (value: string) =>
    `https://www.tiktok.com/tag/${encodeURIComponent(value.replace(/^#+/, ""))}`;

  if (normalized.includes("deepfake")) {
    return [
      tag("deepfake"),
      tag("aiclone"),
      tag("fakecelebrity"),
      search("deepfake tiktok"),
      search("ai clone scam"),
    ];
  }

  if (normalized.includes("aitools") || normalized.includes("ai-tools")) {
    return [
      tag("aitool"),
      tag("aifilter"),
      tag("chatgpt"),
      search("ai tool viral"),
      search("ai app everyone using"),
    ];
  }

  if (normalized.includes("aimusic") || normalized.includes("ai-music")) {
    return [
      tag("aimusic"),
      tag("suno"),
      tag("aimusicgenerator"),
      search("ai music viral"),
      search("suno song"),
    ];
  }

  if (normalized.includes("aicinema") || normalized.includes("ai-cinema")) {
    return [
      tag("aicinema"),
      tag("fruitloveislandai"),
      tag("brainrot"),
      search("fruit love island ai"),
      search("ai cinema"),
    ];
  }

  if (normalized.includes("kick")) {
    return [
      tag("kickstreaming"),
      tag("streamerclips"),
      tag("adinross"),
      search("kick drama"),
      search("clavicular"),
    ];
  }

  if (normalized.includes("streamer")) {
    return [
      tag("streamerclips"),
      tag("twitchclips"),
      tag("kickstreaming"),
      search("streamer drama"),
      search("streamer backlash"),
    ];
  }

  if (normalized.includes("youtube")) {
    return [
      tag("youtubedrama"),
      tag("creatorbacklash"),
      tag("commentary"),
      search("youtube drama"),
      search("creator exposed"),
    ];
  }

  if (normalized.includes("adin")) {
    return [
      tag("adinross"),
      tag("kickstreaming"),
      tag("streamerclips"),
      search("adin ross"),
      search("clavicular"),
    ];
  }

  if (normalized.includes("druski")) {
    return [
      tag("druski"),
      tag("adinross"),
      search("druski tiktok"),
      search("druski backlash"),
      search("adin druski"),
    ];
  }

  if (normalized.includes("harry")) {
    return [
      tag("harrypotter"),
      tag("snape"),
      tag("fandommeltdown"),
      search("harry potter trailer"),
      search("snape backlash"),
    ];
  }

  if (normalized.includes("disney")) {
    return [
      tag("liveaction"),
      tag("moana"),
      tag("disney"),
      search("disney live action backlash"),
      search("moana trailer reaction"),
    ];
  }

  if (normalized.includes("marvel")) {
    return [
      tag("marvel"),
      tag("mcu"),
      tag("dc"),
      search("marvel trailer reaction"),
      search("mcu casting backlash"),
    ];
  }

  if (normalized.includes("anime")) {
    return [
      tag("anime"),
      tag("onepieceliveaction"),
      tag("animetiktok"),
      search("anime fandom drama"),
      search("one piece live action"),
    ];
  }

  if (normalized.includes("platform")) {
    return [
      tag("instagram"),
      tag("youtube"),
      tag("tiktok"),
      search("tiktok app update backlash"),
      search("youtube captcha"),
    ];
  }

  if (normalized.includes("trailer")) {
    return [
      tag("trailerreaction"),
      tag("movietrailer"),
      tag("fandommeltdown"),
      search("trailer backlash"),
      search("bad cgi trailer"),
    ];
  }

  if (normalized.includes("brainrot")) {
    return [
      tag("brainrot"),
      tag("aicinema"),
      tag("viralmeme"),
      search("ai brainrot"),
      search("weird ai meme"),
    ];
  }

  if (normalized.includes("ai")) {
    return [
      tag("aivideo"),
      tag("deepfake"),
      tag("aitool"),
      search("ai slop"),
      search("veo 3"),
    ];
  }

  if (normalized.includes("creator")) {
    return [
      tag("streamerclips"),
      tag("creatorbacklash"),
      tag("adinross"),
      search("streamer drama"),
      search("kick drama"),
    ];
  }

  if (normalized.includes("fandom")) {
    return [
      tag("trailerreaction"),
      tag("fandommeltdown"),
      tag("liveaction"),
      search("trailer reaction"),
      search("casting backlash"),
    ];
  }

  if (normalized.includes("meme")) {
    return [
      tag("viralmeme"),
      tag("memereaction"),
      tag("internetdiscourse"),
      search("viral meme"),
      search("internet discourse"),
    ];
  }

  return [
    tag("internetdiscourse"),
    tag("aivideo"),
    tag("streamerclips"),
    search("internet culture"),
    search("creator backlash"),
  ];
}

function getTikTokProfileQueries(profileKey: string) {
  const normalized = sanitizeProfileKey(profileKey);

  if (normalized.includes("deepfake")) {
    return ["deepfake", "ai clone", "fake celebrity", "scam", "grok"];
  }

  if (normalized.includes("aitools") || normalized.includes("ai-tools")) {
    return ["ai tool", "chatgpt", "filter", "app", "viral", "openai", "grok"];
  }

  if (normalized.includes("aimusic") || normalized.includes("ai-music")) {
    return ["ai music", "suno", "song", "generated", "fake artist", "streaming fraud"];
  }

  if (normalized.includes("aicinema") || normalized.includes("ai-cinema")) {
    return ["ai cinema", "brainrot", "fruit", "love island", "slop", "meme"];
  }

  if (normalized.includes("kick")) {
    return ["kick", "streamer", "adin", "clavicular", "n3on", "ban", "arrest", "clip"];
  }

  if (normalized.includes("streamer")) {
    return ["streamer", "twitch", "kick", "clip", "ban", "arrest", "drama"];
  }

  if (normalized.includes("youtube")) {
    return ["youtube", "creator", "drama", "exposed", "backlash", "apology", "commentary"];
  }

  if (normalized.includes("adin")) {
    return ["adin", "ross", "clavicular", "druski", "kick", "n3on", "clip", "arrest"];
  }

  if (normalized.includes("druski")) {
    return ["druski", "skit", "backlash", "adin", "clip", "streamer"];
  }

  if (normalized.includes("harry")) {
    return ["harry potter", "snape", "trailer", "casting", "backlash", "fandom"];
  }

  if (normalized.includes("disney")) {
    return ["disney", "live action", "moana", "snow white", "backlash", "trailer", "cgi"];
  }

  if (normalized.includes("marvel")) {
    return ["marvel", "mcu", "dc", "trailer", "casting", "backlash", "fandom", "cgi"];
  }

  if (normalized.includes("anime")) {
    return ["anime", "one piece", "fandom", "backlash", "live action", "trailer"];
  }

  if (normalized.includes("platform")) {
    return ["instagram", "youtube", "tiktok", "update", "backlash", "captcha", "platform", "bug"];
  }

  if (normalized.includes("trailer")) {
    return ["trailer", "reaction", "backlash", "cgi", "casting", "remake", "live action"];
  }

  if (normalized.includes("brainrot")) {
    return ["brainrot", "ai", "meme", "fruit", "love island", "weird", "slop"];
  }

  if (normalized.includes("ai")) {
    return ["ai", "deepfake", "veo", "sora", "runway", "chatgpt", "grok"];
  }

  if (normalized.includes("creator")) {
    return [
      "creator",
      "streamer",
      "twitch",
      "kick",
      "youtube",
      "adin",
      "ross",
      "ban",
      "drama",
      "arrest",
    ];
  }

  if (normalized.includes("fandom")) {
    return [
      "trailer",
      "casting",
      "remake",
      "live action",
      "fandom",
      "marvel",
      "dc",
      "harry potter",
      "cgi",
    ];
  }

  if (normalized.includes("meme")) {
    return ["meme", "viral", "internet", "trend", "reaction", "discourse"];
  }

  return [
    "ai",
    "creator",
    "streamer",
    "trailer",
    "casting",
    "meme",
    "internet",
    "deepfake",
  ];
}

function getTikTokProfileRoot() {
  const root = getEnv().TIKTOK_PLAYWRIGHT_PROFILE_ROOT;
  return path.isAbsolute(root) ? root : path.resolve(process.cwd(), root);
}

function sanitizeProfileKey(value: string) {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "default"
  );
}

function buildProxyConfig() {
  const rawProxy = getEnv().MOON_YTDLP_PROXY ?? "";
  if (!rawProxy) {
    return undefined;
  }

  try {
    const parsed = new URL(rawProxy);
    return {
      server: `${parsed.protocol}//${parsed.hostname}${parsed.port ? `:${parsed.port}` : ""}`,
    };
  } catch {
    return undefined;
  }
}

function isClosedTargetError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }

  return /Target page, context or browser has been closed|Target closed/i.test(
    error.message
  );
}

async function collectTikTokVideoUrlsFromPage(
  page: {
    locator: (selector: string) => {
      evaluateAll: <T>(
        pageFunction: (
          elements: Element[]
        ) => T | Promise<T>
      ) => Promise<T>;
    };
    waitForTimeout: (timeout: number) => Promise<void>;
    mouse: { wheel: (deltaX: number, deltaY: number) => Promise<void> };
    evaluate: <T>(pageFunction: () => T | Promise<T>) => Promise<T>;
  },
  maxResults: number,
  passes: number
) {
  const urls = new Set<string>();

  for (let pass = 0; pass < passes; pass += 1) {
    let links: string[] = [];
    let serializedMatches: string[] = [];

    try {
      await page.waitForTimeout(2_500);
      serializedMatches = await page
        .locator('#__UNIVERSAL_DATA_FOR_REHYDRATION__')
        .evaluateAll((elements) => {
          const texts = elements
            .map((element) => element.textContent || "")
            .filter(Boolean);
          const matches: string[] = [];

          for (const text of texts) {
            const escapedMatches =
              text.match(
                /https?:\\\/\\\/(?:www\\\.)?tiktok\.com\\\/@[^"\\]+?\\\/video\\\/\d+/g
              ) ?? [];
            const directMatches =
              text.match(
                /https?:\/\/(?:www\.)?tiktok\.com\/@[^"\\]+?\/video\/\d+/g
              ) ?? [];

            for (const match of [...escapedMatches, ...directMatches]) {
              matches.push(match.replace(/\\\//g, "/"));
            }
          }

          return matches;
        });
      links = await page.locator("a").evaluateAll((elements) =>
        elements
          .map((element) =>
            element instanceof HTMLAnchorElement ? element.href : ""
          )
          .filter(Boolean)
      );
    } catch (error) {
      if (isClosedTargetError(error)) {
        break;
      }

      throw error;
    }

    for (const link of serializedMatches) {
      const normalized = normalizeTikTokVideoUrl(link);
      if (normalized) {
        urls.add(normalized);
      }
    }

    for (const link of links) {
      const normalized = normalizeTikTokVideoUrl(link);
      if (normalized) {
        urls.add(normalized);
      }
    }

    if (urls.size >= maxResults) {
      break;
    }

    try {
      await page.mouse.wheel(0, 2600);
      await page.evaluate(() => {
        window.scrollBy(0, window.innerHeight * 1.6);
      });
    } catch (error) {
      if (isClosedTargetError(error)) {
        break;
      }

      throw error;
    }
  }

  return Array.from(urls).slice(0, maxResults);
}

function getTikTokResultAgeHours(result: Pick<TikTokVideoResult, "publishedAt">) {
  const publishedAtMs = Date.parse(result.publishedAt ?? "");

  if (!Number.isFinite(publishedAtMs)) {
    return null;
  }

  return Math.max(0, (Date.now() - publishedAtMs) / (60 * 60 * 1000));
}

function hasStrongTikTokEngagement(
  result: Pick<
    TikTokVideoResult,
    "viewCount" | "likeCount" | "commentCount" | "shareCount"
  >
) {
  return (
    (result.viewCount ?? 0) >= 250_000 ||
    (result.likeCount ?? 0) >= 10_000 ||
    (result.commentCount ?? 0) >= 2_000 ||
    (result.shareCount ?? 0) >= 1_000
  );
}

function isTikTokDiscoveryResultFreshEnough(result: TikTokVideoResult) {
  const ageHours = getTikTokResultAgeHours(result);

  if (ageHours === null) {
    return true;
  }

  if (ageHours <= TIKTOK_DISCOVERY_MAX_AGE_HOURS) {
    return true;
  }

  return (
    ageHours <= TIKTOK_DISCOVERY_OUTLIER_MAX_AGE_HOURS &&
    hasStrongTikTokEngagement(result)
  );
}

function computeTikTokDiscoveryScore(result: TikTokVideoResult) {
  const ageHours = getTikTokResultAgeHours(result);
  const views = result.viewCount ?? 0;
  const likes = result.likeCount ?? 0;
  const comments = result.commentCount ?? 0;
  const shares = result.shareCount ?? 0;
  const engagementScore =
    Math.log10(views + 1) * 16 +
    Math.log10(likes + 1) * 10 +
    Math.log10(comments + 1) * 8 +
    Math.log10(shares + 1) * 10;

  if (ageHours === null) {
    return engagementScore;
  }

  const freshnessBonus =
    ageHours <= 6
      ? 60
      : ageHours <= 24
        ? 40
        : ageHours <= 48
          ? 25
          : ageHours <= TIKTOK_DISCOVERY_MAX_AGE_HOURS
            ? 12
            : ageHours <= TIKTOK_DISCOVERY_OUTLIER_MAX_AGE_HOURS
              ? -8
              : -60;

  return freshnessBonus + engagementScore;
}

function buildTikTokQueryKeywords(value: string | null | undefined) {
  if (!value) {
    return [];
  }

  return Array.from(
    new Set(
      value
        .toLowerCase()
        .split(/[^a-z0-9]+/g)
        .map((token) => token.trim())
        .filter(
          (token) =>
            token.length > 0 &&
            (token.length >= 4 || token === "ai" || token === "cgi" || token === "x") &&
            !TIKTOK_QUERY_STOPWORDS.has(token)
        )
    )
  );
}

function matchesTikTokQueryKeywords(
  result: Pick<TikTokVideoResult, "title" | "description" | "creatorHandle">,
  queries: string[]
) {
  const keywords = queries.flatMap((query) => buildTikTokQueryKeywords(query));
  if (keywords.length === 0) {
    return true;
  }

  const haystack = [
    result.title,
    result.description,
    result.creatorHandle,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return keywords.some((keyword) => haystack.includes(keyword));
}

function filterTikTokResultsForProfile(
  results: TikTokVideoResult[],
  profileKey: string
) {
  const filtered = results.filter((result) =>
    matchesTikTokQueryKeywords(result, getTikTokProfileQueries(profileKey))
  );

  return filtered.length >= Math.min(2, results.length) ? filtered : results;
}

async function resolveTikTokUrls(
  urls: string[],
  context: {
    discoveryMethod: "search" | "fyp";
    discoveryQuery: string | null;
    profileKey: string | null;
    maxResults: number;
  }
) {
  const results: TikTokVideoResult[] = [];

  for (const url of urls.slice(0, Math.max(context.maxResults * 2, context.maxResults))) {
    const metadata = await resolveLocalMediaMetadata({
      sourceUrl: url,
      providerName: "tiktok",
    });

    if (!metadata) {
      continue;
    }

    results.push({
      ...metadata,
      discoveryMethod: context.discoveryMethod,
      discoveryQuery: context.discoveryQuery,
      profileKey: context.profileKey,
      videoId: extractTikTokVideoId(metadata.pageUrl),
      creatorHandle:
        metadata.creatorHandle ?? extractTikTokHandle(metadata.pageUrl),
    });
  }

  return finalizeTikTokResults(results, context.maxResults);
}

function finalizeTikTokResults(results: TikTokVideoResult[], maxResults: number) {
  const deduped = new Map<string, TikTokVideoResult>();
  for (const result of results) {
    const key = result.externalId || result.pageUrl;
    if (!deduped.has(key)) {
      deduped.set(key, result);
    }
  }

  return Array.from(deduped.values())
    .filter((result) => isTikTokDiscoveryResultFreshEnough(result))
    .sort((left, right) => {
      const scoreDelta =
        computeTikTokDiscoveryScore(right) - computeTikTokDiscoveryScore(left);
      if (scoreDelta !== 0) {
        return scoreDelta;
      }

      return (Date.parse(right.publishedAt ?? "") || 0) - (Date.parse(left.publishedAt ?? "") || 0);
    })
    .slice(0, maxResults);
}

function mapTikTokApiItemToResult(args: {
  item: TikTokApiItem;
  discoveryMethod: "search" | "fyp";
  discoveryQuery: string | null;
  profileKey: string | null;
}): TikTokVideoResult | null {
  if (args.item.isAd === true) {
    return null;
  }

  const videoId = asTikTokString(args.item.id);
  const creatorHandle = asTikTokString(args.item.author?.uniqueId)?.replace(/^@+/, "") ?? null;
  const pageUrl = normalizeTikTokVideoUrl(
    buildTikTokVideoPageUrl(creatorHandle, videoId)
  );

  if (!videoId || !pageUrl) {
    return null;
  }

  const publishedAtSeconds = asTikTokNumber(args.item.createTime);
  const publishedAt =
    publishedAtSeconds !== null
      ? new Date(publishedAtSeconds * 1000).toISOString()
      : null;
  const title = asTikTokString(args.item.desc) ?? "Recent TikTok video";
  const previewUrl =
    asTikTokString(args.item.video?.cover) ??
    asTikTokString(args.item.video?.dynamicCover) ??
    asTikTokString(args.item.video?.originCover);
  const downloadAddr = asTikTokString(args.item.video?.downloadAddr);

  return {
    clipProvider: "internal",
    providerName: "tiktok",
    externalId: videoId,
    title,
    sourceUrl: pageUrl,
    pageUrl,
    previewUrl,
    channelOrContributor: asTikTokString(args.item.author?.nickname),
    creatorHandle,
    durationMs: asTikTokNumber(args.item.video?.duration),
    viewCount: asTikTokNumber(args.item.stats?.playCount),
    likeCount: asTikTokNumber(args.item.stats?.diggCount),
    commentCount: asTikTokNumber(args.item.stats?.commentCount),
    shareCount: asTikTokNumber(args.item.stats?.shareCount),
    uploadDate: publishedAt ? publishedAt.slice(0, 10).replace(/-/g, "") : null,
    publishedAt,
    description: title,
    cacheKey: downloadAddr ?? pageUrl,
    metadataJson: {
      creatorHandle,
      previewUrl,
      publishedAt,
      sourceUrl: pageUrl,
      pageUrl,
      downloadAddr,
    },
    discoveryMethod: args.discoveryMethod,
    discoveryQuery: args.discoveryQuery,
    profileKey: args.profileKey,
    videoId,
  };
}

function collectTikTokApiResults(
  page: {
    on: (
      event: "response",
      listener: (response: { url: () => string; json: () => Promise<unknown> }) => void
    ) => void;
  },
  context: {
    discoveryMethod: "search" | "fyp";
    discoveryQuery: string | null;
    profileKey: string | null;
    queryFilters?: string[];
    requireQueryMatch?: boolean;
  }
) {
  const results: TikTokVideoResult[] = [];
  const seen = new Set<string>();

  page.on("response", (response) => {
    const url = response.url();
    if (!TIKTOK_ITEM_LIST_URL_PATTERN.test(url)) {
      return;
    }

    void (async () => {
      try {
        const payload = (await response.json()) as {
          itemList?: TikTokApiItem[];
          item_list?: TikTokApiItem[];
        };
        const items = Array.isArray(payload.itemList)
          ? payload.itemList
          : Array.isArray(payload.item_list)
            ? payload.item_list
            : [];

        for (const item of items) {
          const result = mapTikTokApiItemToResult({
            item,
            discoveryMethod: context.discoveryMethod,
            discoveryQuery: context.discoveryQuery,
            profileKey: context.profileKey,
          });

          if (!result) {
            continue;
          }

          if (
            context.requireQueryMatch &&
            !matchesTikTokQueryKeywords(result, context.queryFilters ?? [])
          ) {
            continue;
          }

          const key = result.externalId || result.pageUrl;
          if (seen.has(key)) {
            continue;
          }

          seen.add(key);
          results.push(result);
        }
      } catch {
        return;
      }
    })();
  });

  return results;
}

async function discoverTikTokUrlsViaParallel(query: string, maxResults: number) {
  const results = await searchResearchSources({
    query,
    searchQueries: [
      `${query} site:tiktok.com/@`,
      `${query} site:tiktok.com`,
      `${query} tiktok`,
    ],
    objective:
      "Find direct TikTok video URLs relevant to this internet-culture query. Prefer real tiktok.com/@.../video/... pages over articles or discovery pages.",
    limit: Math.max(6, maxResults * 3),
    mode: "fast",
    maxCharsPerResult: 400,
    maxCharsTotal: 2400,
  });

  return results
    .map((result) => normalizeTikTokVideoUrl(result.url))
    .filter((url): url is string => Boolean(url))
    .slice(0, maxResults);
}

export async function searchTikTokVideos(input: {
  query: string;
  queries?: string[];
  hashtags?: string[];
  maxResults?: number;
}): Promise<{ results: TikTokVideoResult[] }> {
  const { chromium } = await import("playwright");
  const maxResults = Math.max(1, Math.min(input.maxResults ?? 6, 12));
  const searchQueries = Array.from(
    new Set(
      [input.query, ...(input.queries ?? [])]
        .map((query) => query.trim())
        .filter(Boolean)
    )
  ).slice(0, 4);
  const hashtags = Array.from(
    new Set(
      (input.hashtags ?? [])
        .map((tag) => normalizeTikTokTag(tag))
        .filter((tag): tag is string => Boolean(tag))
    )
  ).slice(0, 8);
  const userAgent =
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36";

  const collectUrls = async (query: string, useProxy: boolean, queryMaxResults: number) => {
    const browser = await chromium.launch({
      headless: true,
      proxy: useProxy ? buildProxyConfig() : undefined,
    });

    try {
      const page = await browser.newPage({
        viewport: { width: 1440, height: 2200 },
        userAgent,
      });

      await page.goto(
        `https://www.tiktok.com/search/video?q=${encodeURIComponent(query)}`,
        {
          waitUntil: "commit",
          timeout: 10_000,
        }
      );

      return collectTikTokVideoUrlsFromPage(page, queryMaxResults, 4);
    } finally {
      await browser.close();
    }
  };

  const collectResultsFromTag = async (tag: string, queryMaxResults: number) => {
    const browser = await chromium.launch({
      headless: true,
    });

    try {
      const page = await browser.newPage({
        viewport: { width: 1440, height: 2200 },
        userAgent,
      });

      await page.goto(`https://www.tiktok.com/tag/${encodeURIComponent(tag)}`, {
        waitUntil: "commit",
        timeout: 10_000,
      });

      const apiResults = collectTikTokApiResults(page, {
        discoveryMethod: "search",
        discoveryQuery: `#${tag}`,
        profileKey: null,
      });

      await page.waitForTimeout(4_000);
      await page.mouse.wheel(0, 2400);
      await page.waitForTimeout(2_000);
      await page.mouse.wheel(0, 2400);
      await page.waitForTimeout(2_000);

      if (apiResults.length > 0) {
        return finalizeTikTokResults(apiResults, queryMaxResults);
      }

      const urls = await collectTikTokVideoUrlsFromPage(page, queryMaxResults, 4);
      return resolveTikTokUrls(urls, {
        discoveryMethod: "search",
        discoveryQuery: `#${tag}`,
        profileKey: null,
        maxResults: queryMaxResults,
      });
    } finally {
      await browser.close();
    }
  };

  const allResults: TikTokVideoResult[] = [];
  const perQueryMaxResults = Math.max(
    2,
    Math.min(6, Math.ceil(maxResults / Math.max(searchQueries.length, 1)) + 1)
  );

  for (const hashtag of hashtags) {
    let results: TikTokVideoResult[] = [];

    try {
      results = await collectResultsFromTag(hashtag, perQueryMaxResults);
    } catch {
      results = [];
    }

    if (results.length === 0) {
      continue;
    }

    allResults.push(...results);
  }

  for (const query of searchQueries) {
    let urls: string[] = [];

    try {
      urls = await collectUrls(query, true, perQueryMaxResults);
    } catch {
      urls = [];
    }

    if (urls.length === 0) {
      try {
        urls = await collectUrls(query, false, perQueryMaxResults);
      } catch {
        urls = [];
      }
    }

    if (urls.length === 0) {
      try {
        urls = await discoverTikTokUrlsViaParallel(query, perQueryMaxResults);
      } catch {
        urls = [];
      }
    }

    if (urls.length === 0) {
      continue;
    }

    const results = await resolveTikTokUrls(urls, {
      discoveryMethod: "search",
      discoveryQuery: query,
      profileKey: null,
      maxResults: perQueryMaxResults,
    });

    allResults.push(
      ...results.filter((result) => matchesTikTokQueryKeywords(result, [query]))
    );
  }

  const deduped = new Map<string, TikTokVideoResult>();
  for (const result of allResults) {
    const key = result.externalId || result.pageUrl;
    if (!deduped.has(key)) {
      deduped.set(key, result);
    }
  }

  return {
    results: Array.from(deduped.values())
      .sort((left, right) => {
        if ((right.viewCount ?? 0) !== (left.viewCount ?? 0)) {
          return (right.viewCount ?? 0) - (left.viewCount ?? 0);
        }

        return (
          (Date.parse(right.publishedAt ?? "") || 0) -
          (Date.parse(left.publishedAt ?? "") || 0)
        );
      })
      .slice(0, maxResults),
  };
}

export async function loadTikTokFypVideos(input: {
  profileKey: string;
  maxResults?: number;
}): Promise<{ results: TikTokVideoResult[] }> {
  const { chromium } = await import("playwright");
  const maxResults = Math.max(1, Math.min(input.maxResults ?? 8, 16));
  const profileRoot = getTikTokProfileRoot();
  const profileDir = path.join(profileRoot, sanitizeProfileKey(input.profileKey));
  const userAgent =
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36";
  await mkdir(profileDir, { recursive: true });

  const collectResults = async () => {
    const context = await chromium.launchPersistentContext(profileDir, {
      headless: true,
      viewport: { width: 1440, height: 2200 },
      userAgent,
    });

    try {
      const page = context.pages()[0] ?? (await context.newPage());
      const apiResults = collectTikTokApiResults(page, {
        discoveryMethod: "fyp",
        discoveryQuery: null,
        profileKey: input.profileKey,
      });

      for (const seedUrl of buildTikTokSeedUrls(input.profileKey).slice(0, 3)) {
        try {
          await page.goto(seedUrl, {
            waitUntil: "commit",
            timeout: 10_000,
          });
          await page.waitForTimeout(2_000);
          await page.mouse.wheel(0, 1600);
          await page.waitForTimeout(1_000);
        } catch {
          continue;
        }
      }

      await page.goto("https://www.tiktok.com/foryou", {
        waitUntil: "commit",
        timeout: 10_000,
      });

      await page.waitForTimeout(5_000);
      await page.mouse.wheel(0, 2400);
      await page.waitForTimeout(2_000);
      await page.mouse.wheel(0, 2400);
      await page.waitForTimeout(2_000);

      if (apiResults.length > 0) {
        return finalizeTikTokResults(
          filterTikTokResultsForProfile(apiResults, input.profileKey),
          maxResults
        );
      }

      const urls = await collectTikTokVideoUrlsFromPage(page, maxResults, 4);
      return resolveTikTokUrls(urls, {
        discoveryMethod: "fyp",
        discoveryQuery: null,
        profileKey: input.profileKey,
        maxResults,
      });
    } finally {
      await context.close();
    }
  };

  let results: TikTokVideoResult[] = [];

  try {
    results = await collectResults();
  } catch {
    results = [];
  }

  return { results };
}
