import { NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";

import { getDb } from "@/server/db/client";
import { scriptLines } from "@/server/db/schema";

type RouteContext = {
  params: Promise<{
    projectId: string;
  }>;
};

export async function GET(_: Request, context: RouteContext) {
  const { projectId } = await context.params;

  try {
    const db = getDb();

    const rows = await db
      .select({
        totalLines: sql<number>`count(*)::int`,
        researchComplete: sql<number>`count(*) filter (where ${scriptLines.researchStatus} = 'complete')::int`,
        researchRunning: sql<number>`count(*) filter (where ${scriptLines.researchStatus} = 'running')::int`,
        footageComplete: sql<number>`count(*) filter (where ${scriptLines.footageStatus} = 'complete')::int`,
        imagesGenerated: sql<number>`count(*) filter (where ${scriptLines.imageStatus} = 'complete')::int`,
        videosGenerated: sql<number>`count(*) filter (where ${scriptLines.videoStatus} = 'complete')::int`,
        totalDurationMs: sql<number>`coalesce(sum(${scriptLines.durationMs}), 0)::int`,
      })
      .from(scriptLines)
      .where(eq(scriptLines.projectId, projectId));

    const row = rows[0] ?? {
      totalLines: 0,
      researchComplete: 0,
      researchRunning: 0,
      footageComplete: 0,
      imagesGenerated: 0,
      videosGenerated: 0,
      totalDurationMs: 0,
    };

    return NextResponse.json({
      totalLines: row.totalLines,
      researchComplete: row.researchComplete,
      researchRunning: row.researchRunning,
      footageComplete: row.footageComplete,
      imagesGenerated: row.imagesGenerated,
      videosGenerated: row.videosGenerated,
      transcriptsComplete: 0,
      musicSelected: 0,
      totalDurationMs: row.totalDurationMs,
      estimatedCost: "$0",
    });
  } catch {
    // Tables may not exist yet — return zeros
    return NextResponse.json({
      totalLines: 0,
      researchComplete: 0,
      researchRunning: 0,
      footageComplete: 0,
      imagesGenerated: 0,
      videosGenerated: 0,
      transcriptsComplete: 0,
      musicSelected: 0,
      totalDurationMs: 0,
      estimatedCost: "$0",
    });
  }
}
