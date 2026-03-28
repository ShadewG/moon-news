import "server-only";

import { sql } from "drizzle-orm";

import { getDb } from "@/server/db/client";
import { clipLibrary } from "@/server/db/schema";

const MOON_VIDEO_INDEX_TTL_MS = 10 * 60 * 1000;

type MoonVideoCandidate = {
  provider?: string | null;
  externalId?: string | null;
  sourceUrl?: string | null;
  channelOrContributor?: string | null;
  metadataJson?: unknown;
};

type MoonVideoIndex = {
  loadedAtMs: number;
  youtubeVideoIds: Set<string>;
  normalizedUrls: Set<string>;
};

let cachedMoonVideoIndex: MoonVideoIndex | null = null;

function asObjectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isMoonChannelName(channelOrContributor: string | null | undefined) {
  return (channelOrContributor ?? "").trim().toLowerCase() === "moon";
}

function metadataMarksMoonVideo(metadataJson: unknown) {
  return asObjectRecord(metadataJson)?.isMoonVideo === true;
}

function extractYouTubeVideoId(url: string) {
  const match = url.match(
    /(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/(?:watch\?(?:[^#\s]*&)?v=|embed\/|shorts\/|live\/))([A-Za-z0-9_-]{11})/i
  );
  return match?.[1] ?? null;
}

export function normalizeComparableSourceUrl(rawUrl: string | null | undefined) {
  if (!rawUrl) {
    return "";
  }

  try {
    const url = new URL(rawUrl.trim());
    url.hostname = url.hostname.replace(/^www\./i, "").toLowerCase();
    url.hash = "";

    if (
      url.hostname === "youtu.be" ||
      url.hostname.endsWith("youtube.com") ||
      url.hostname.endsWith("youtube-nocookie.com")
    ) {
      const videoId = extractYouTubeVideoId(url.toString());
      if (!videoId) {
        return "";
      }
      return `https://www.youtube.com/watch?v=${videoId}`;
    }

    for (const key of [...url.searchParams.keys()]) {
      if (
        key.startsWith("utm_") ||
        key === "fbclid" ||
        key === "gclid" ||
        key === "ref" ||
        key === "mc_cid" ||
        key === "mc_eid"
      ) {
        url.searchParams.delete(key);
      }
    }

    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    return url.toString();
  } catch {
    return rawUrl.trim();
  }
}

function isExplicitMoonVideoCandidate(candidate: MoonVideoCandidate) {
  return (
    isMoonChannelName(candidate.channelOrContributor) ||
    metadataMarksMoonVideo(candidate.metadataJson)
  );
}

async function loadMoonVideoIndex() {
  if (
    cachedMoonVideoIndex &&
    Date.now() - cachedMoonVideoIndex.loadedAtMs < MOON_VIDEO_INDEX_TTL_MS
  ) {
    return cachedMoonVideoIndex;
  }

  const rows = await getDb()
    .select({
      provider: clipLibrary.provider,
      externalId: clipLibrary.externalId,
      sourceUrl: clipLibrary.sourceUrl,
    })
    .from(clipLibrary)
    .where(
      sql`${clipLibrary.channelOrContributor} = 'Moon' OR COALESCE(${clipLibrary.metadataJson}->>'isMoonVideo', 'false') = 'true'`
    );

  const youtubeVideoIds = new Set<string>();
  const normalizedUrls = new Set<string>();

  for (const row of rows) {
    if (row.provider === "youtube" && row.externalId?.trim()) {
      youtubeVideoIds.add(row.externalId.trim());
    }

    const normalizedUrl = normalizeComparableSourceUrl(row.sourceUrl);
    if (normalizedUrl) {
      normalizedUrls.add(normalizedUrl);
      const videoId = extractYouTubeVideoId(normalizedUrl);
      if (videoId) {
        youtubeVideoIds.add(videoId);
      }
    }
  }

  cachedMoonVideoIndex = {
    loadedAtMs: Date.now(),
    youtubeVideoIds,
    normalizedUrls,
  };

  return cachedMoonVideoIndex;
}

export async function isMoonVideoCandidate(candidate: MoonVideoCandidate) {
  if (isExplicitMoonVideoCandidate(candidate)) {
    return true;
  }

  const index = await loadMoonVideoIndex();
  const normalizedUrl = normalizeComparableSourceUrl(candidate.sourceUrl);
  if (normalizedUrl && index.normalizedUrls.has(normalizedUrl)) {
    return true;
  }

  const externalId =
    candidate.provider === "youtube"
      ? (candidate.externalId?.trim() || extractYouTubeVideoId(normalizedUrl))
      : candidate.externalId?.trim() || null;

  if (externalId && index.youtubeVideoIds.has(externalId)) {
    return true;
  }

  return false;
}

export async function filterOutMoonVideoCandidates<T>(
  items: T[],
  getCandidate: (item: T) => MoonVideoCandidate
) {
  const index = await loadMoonVideoIndex();

  return items.filter((item) => {
    const candidate = getCandidate(item);
    if (isExplicitMoonVideoCandidate(candidate)) {
      return false;
    }

    const normalizedUrl = normalizeComparableSourceUrl(candidate.sourceUrl);
    if (normalizedUrl && index.normalizedUrls.has(normalizedUrl)) {
      return false;
    }

    const externalId =
      candidate.provider === "youtube"
        ? candidate.externalId?.trim() || extractYouTubeVideoId(normalizedUrl)
        : candidate.externalId?.trim() || null;

    if (externalId && index.youtubeVideoIds.has(externalId)) {
      return false;
    }

    return true;
  });
}

export function resetMoonVideoIndexCacheForTests() {
  cachedMoonVideoIndex = null;
}
