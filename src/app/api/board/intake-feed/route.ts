import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/server/db/client";
import { boardFeedItems, boardSources } from "@/server/db/schema";
import { desc, eq, gte, sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const limit = Math.min(Number(searchParams.get("limit") || "200"), 500);
  const hours = Math.min(Number(searchParams.get("hours") || "12"), 48);
  const kind = searchParams.get("kind") || null;

  try {
    const db = getDb();
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);

    // Stats (always unfiltered for the overview bar)
    const statsRows = await db
      .select({
        kind: boardSources.kind,
        count: sql<number>`count(*)`,
        latest: sql<string>`max(${boardFeedItems.ingestedAt})`,
      })
      .from(boardFeedItems)
      .innerJoin(boardSources, eq(boardSources.id, boardFeedItems.sourceId))
      .where(gte(boardFeedItems.ingestedAt, since))
      .groupBy(boardSources.kind);

    // If filtering by kind, simple query
    if (kind) {
      const rows = await db
        .select({
          id: boardFeedItems.id,
          title: boardFeedItems.title,
          url: boardFeedItems.url,
          author: boardFeedItems.author,
          publishedAt: boardFeedItems.publishedAt,
          ingestedAt: boardFeedItems.ingestedAt,
          sentimentScore: boardFeedItems.sentimentScore,
          controversyScore: boardFeedItems.controversyScore,
          sourceName: boardSources.name,
          sourceKind: boardSources.kind,
        })
        .from(boardFeedItems)
        .innerJoin(boardSources, eq(boardSources.id, boardFeedItems.sourceId))
        .where(sql`${boardSources.kind} = ${kind} AND ${boardFeedItems.ingestedAt} >= ${since}`)
        .orderBy(desc(boardFeedItems.ingestedAt))
        .limit(limit);

      return NextResponse.json({ items: rows, stats: statsRows, since: since.toISOString(), count: rows.length });
    }

    // No filter: fetch per-kind so each source type gets fair representation
    const allKinds = statsRows.map((s) => s.kind);
    const perKindLimit = Math.max(Math.ceil(limit / Math.max(allKinds.length, 1)), 20);

    const kindResults = await Promise.all(
      allKinds.map((k) =>
        db
          .select({
            id: boardFeedItems.id,
            title: boardFeedItems.title,
            url: boardFeedItems.url,
            author: boardFeedItems.author,
            publishedAt: boardFeedItems.publishedAt,
            ingestedAt: boardFeedItems.ingestedAt,
            sentimentScore: boardFeedItems.sentimentScore,
            controversyScore: boardFeedItems.controversyScore,
            sourceName: boardSources.name,
            sourceKind: boardSources.kind,
          })
          .from(boardFeedItems)
          .innerJoin(boardSources, eq(boardSources.id, boardFeedItems.sourceId))
          .where(sql`${boardSources.kind} = ${k} AND ${boardFeedItems.ingestedAt} >= ${since}`)
          .orderBy(desc(boardFeedItems.ingestedAt))
          .limit(perKindLimit)
      )
    );

    // Merge and sort by ingestedAt
    const merged = kindResults
      .flat()
      .sort((a, b) => new Date(b.ingestedAt).getTime() - new Date(a.ingestedAt).getTime())
      .slice(0, limit);

    return NextResponse.json({
      items: merged,
      stats: statsRows,
      since: since.toISOString(),
      count: merged.length,
    });
  } catch (err) {
    console.error("[intake-feed]", err);
    return NextResponse.json({ error: "Failed to fetch intake feed" }, { status: 500 });
  }
}
