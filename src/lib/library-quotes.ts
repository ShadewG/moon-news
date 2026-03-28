const YOUTUBE_VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function extractYouTubeVideoIdFromUrl(
  rawUrl: string | null | undefined
): string | null {
  if (!rawUrl) {
    return null;
  }

  try {
    const url = new URL(rawUrl);
    const hostname = url.hostname.replace(/^www\./i, "").toLowerCase();

    if (hostname === "youtu.be") {
      const candidate = url.pathname.split("/").filter(Boolean)[0] ?? "";
      return YOUTUBE_VIDEO_ID_PATTERN.test(candidate) ? candidate : null;
    }

    if (
      hostname === "youtube.com" ||
      hostname === "m.youtube.com" ||
      hostname === "music.youtube.com" ||
      hostname === "youtube-nocookie.com"
    ) {
      const directId = url.searchParams.get("v");
      if (directId && YOUTUBE_VIDEO_ID_PATTERN.test(directId)) {
        return directId;
      }

      const parts = url.pathname.split("/").filter(Boolean);
      const candidate =
        parts[0] === "embed" || parts[0] === "shorts" || parts[0] === "live"
          ? parts[1] ?? null
          : null;

      if (candidate && YOUTUBE_VIDEO_ID_PATTERN.test(candidate)) {
        return candidate;
      }
    }
  } catch {
    // Fall back to regex parsing below.
  }

  const fallbackMatch = rawUrl.match(
    /(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/(?:watch\?(?:[^#\s]*&)?v=|embed\/|shorts\/|live\/))([A-Za-z0-9_-]{11})/i
  );
  return fallbackMatch?.[1] ?? null;
}

type BuildLibraryQuotesHrefInput = {
  clipId?: string | null;
  provider?: string | null;
  externalId?: string | null;
  sourceUrl?: string | null;
  title?: string | null;
  channelOrContributor?: string | null;
  durationMs?: number | null;
  viewCount?: number | null;
  uploadDate?: string | null;
};

export function buildLibraryQuotesHref(
  input: BuildLibraryQuotesHrefInput
): string | null {
  if (input.clipId) {
    return `/library/open?clipId=${encodeURIComponent(input.clipId)}`;
  }

  const explicitExternalId =
    input.externalId && YOUTUBE_VIDEO_ID_PATTERN.test(input.externalId)
      ? input.externalId
      : null;
  const resolvedExternalId =
    explicitExternalId ?? extractYouTubeVideoIdFromUrl(input.sourceUrl);
  const provider = input.provider?.trim().toLowerCase() ?? null;

  if (provider && provider !== "youtube" && !resolvedExternalId) {
    return null;
  }

  if (!resolvedExternalId && provider !== "youtube") {
    return null;
  }

  if (!resolvedExternalId && !input.sourceUrl && !input.title) {
    return null;
  }

  const params = new URLSearchParams();

  if (resolvedExternalId) {
    params.set("externalId", resolvedExternalId);
  }
  if (input.sourceUrl) {
    params.set("sourceUrl", input.sourceUrl);
  }
  if (input.title) {
    params.set("title", input.title);
  }
  if (input.channelOrContributor) {
    params.set("channel", input.channelOrContributor);
  }
  if (typeof input.durationMs === "number" && Number.isFinite(input.durationMs)) {
    params.set("durationMs", String(Math.max(0, Math.floor(input.durationMs))));
  }
  if (typeof input.viewCount === "number" && Number.isFinite(input.viewCount)) {
    params.set("viewCount", String(Math.max(0, Math.floor(input.viewCount))));
  }
  if (input.uploadDate) {
    params.set("uploadDate", input.uploadDate);
  }

  const query = params.toString();
  return query ? `/library/open?${query}` : "/library";
}

export function buildDirectLibraryOpenHref(
  rawValue: string | null | undefined
): string | null {
  const value = rawValue?.trim();
  if (!value) {
    return null;
  }

  if (UUID_PATTERN.test(value)) {
    return `/library/open?clipId=${encodeURIComponent(value)}`;
  }

  const directVideoId = YOUTUBE_VIDEO_ID_PATTERN.test(value) ? value : null;
  if (directVideoId) {
    return `/library/open?externalId=${encodeURIComponent(directVideoId)}`;
  }

  try {
    const url = new URL(value);
    const clipMatch = url.pathname.match(/\/clips\/([0-9a-f-]{36})/i);
    if (clipMatch?.[1]) {
      return `/library/open?clipId=${encodeURIComponent(clipMatch[1])}`;
    }

    const videoId = extractYouTubeVideoIdFromUrl(url.toString());
    if (videoId) {
      return `/library/open?externalId=${encodeURIComponent(videoId)}&sourceUrl=${encodeURIComponent(url.toString())}`;
    }
  } catch {
    // Ignore invalid URL parsing and fall through.
  }

  return null;
}
