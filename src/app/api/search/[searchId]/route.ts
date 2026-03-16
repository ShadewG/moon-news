import { NextResponse } from "next/server";
import { eq, desc } from "drizzle-orm";

import { getDb } from "@/server/db/client";
import { clipLibrary, clipSearches, clipSearchResults, transcriptCache } from "@/server/db/schema";

type RouteContext = { params: Promise<{ searchId: string }> };

export async function GET(_: Request, context: RouteContext) {
  const { searchId } = await context.params;
  const db = getDb();

  const [search] = await db
    .select()
    .from(clipSearches)
    .where(eq(clipSearches.id, searchId))
    .limit(1);

  if (!search) {
    return NextResponse.json({ error: "Search not found" }, { status: 404 });
  }

  const results = await db
    .select({
      relevanceScore: clipSearchResults.relevanceScore,
      clip: clipLibrary,
    })
    .from(clipSearchResults)
    .innerJoin(clipLibrary, eq(clipLibrary.id, clipSearchResults.clipId))
    .where(eq(clipSearchResults.searchId, searchId))
    .orderBy(desc(clipSearchResults.relevanceScore));

  return NextResponse.json({
    search,
    clips: results.map((r) => ({
      ...r.clip,
      relevanceScore: r.relevanceScore,
    })),
  });
}
