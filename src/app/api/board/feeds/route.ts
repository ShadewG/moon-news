import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";

import { getDb } from "@/server/db/client";
import { boardSources, boardFeedItems } from "@/server/db/schema";

export async function GET() {
  const db = getDb();

  const sources = await db
    .select()
    .from(boardSources)
    .orderBy(desc(boardSources.createdAt));

  const recentItems = await db
    .select()
    .from(boardFeedItems)
    .orderBy(desc(boardFeedItems.publishedAt))
    .limit(50);

  return NextResponse.json({ sources, items: recentItems });
}
