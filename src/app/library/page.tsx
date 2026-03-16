import { desc, sql } from "drizzle-orm";

import { getDb } from "@/server/db/client";
import { clipLibrary, clipSearchQuotes } from "@/server/db/schema";
import LibraryClient from "./library-client";

export const metadata = { title: "Clip Library — Moon News Studio" };

export default async function LibraryPage() {
  const db = getDb();

  const clips = await db
    .select({
      clip: clipLibrary,
      quoteCount: sql<number>`(SELECT count(*)::int FROM clip_search_quotes WHERE clip_id = ${clipLibrary.id})`,
    })
    .from(clipLibrary)
    .orderBy(desc(clipLibrary.createdAt));

  const data = clips.map((c) => ({
    id: c.clip.id,
    provider: c.clip.provider,
    externalId: c.clip.externalId,
    title: c.clip.title,
    sourceUrl: c.clip.sourceUrl,
    previewUrl: c.clip.previewUrl,
    channelOrContributor: c.clip.channelOrContributor,
    durationMs: c.clip.durationMs,
    viewCount: c.clip.viewCount,
    uploadDate: c.clip.uploadDate,
    hasTranscript: c.clip.hasTranscript,
    quoteCount: c.quoteCount,
    createdAt: c.clip.createdAt.toISOString(),
  }));

  return <LibraryClient clips={data} />;
}
