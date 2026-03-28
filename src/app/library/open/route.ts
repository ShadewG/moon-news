import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { extractYouTubeVideoIdFromUrl } from "@/lib/library-quotes";
import { getDb } from "@/server/db/client";
import { clipLibrary } from "@/server/db/schema";
import { upsertClipInLibrary } from "@/server/services/clip-library";

function parseOptionalInt(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function buildClipHref(clipId: string) {
  return `/clips/${encodeURIComponent(clipId)}?tab=quotes`;
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const clipId = requestUrl.searchParams.get("clipId")?.trim() ?? "";
  if (clipId) {
    return NextResponse.redirect(new URL(buildClipHref(clipId), request.url));
  }

  const title = requestUrl.searchParams.get("title")?.trim() ?? "";
  const sourceUrl = requestUrl.searchParams.get("sourceUrl")?.trim() ?? "";
  const explicitExternalId =
    requestUrl.searchParams.get("externalId")?.trim() ?? "";
  const externalId =
    explicitExternalId || extractYouTubeVideoIdFromUrl(sourceUrl) || "";
  const channel = requestUrl.searchParams.get("channel")?.trim() ?? null;
  const durationMs = parseOptionalInt(requestUrl.searchParams.get("durationMs"));
  const viewCount = parseOptionalInt(requestUrl.searchParams.get("viewCount"));
  const uploadDate = requestUrl.searchParams.get("uploadDate")?.trim() ?? null;

  if (!externalId) {
    const fallback = new URL("/library", request.url);
    if (title) {
      fallback.searchParams.set("q", title);
    }
    fallback.searchParams.set("provider", "youtube");
    fallback.searchParams.set("sort", "quotes");
    return NextResponse.redirect(fallback);
  }

  const db = getDb();
  const [existing] = await db
    .select({ id: clipLibrary.id })
    .from(clipLibrary)
    .where(
      and(
        eq(clipLibrary.provider, "youtube"),
        eq(clipLibrary.externalId, externalId)
      )
    )
    .limit(1);

  const resolvedClipId =
    existing?.id ??
    (await upsertClipInLibrary({
      provider: "youtube",
      externalId,
      title: title || `YouTube video ${externalId}`,
      sourceUrl: sourceUrl || `https://www.youtube.com/watch?v=${externalId}`,
      channelOrContributor: channel,
      durationMs,
      viewCount,
      uploadDate,
    }));

  return NextResponse.redirect(new URL(buildClipHref(resolvedClipId), request.url));
}
