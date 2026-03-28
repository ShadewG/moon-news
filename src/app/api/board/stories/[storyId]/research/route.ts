import { NextResponse } from "next/server";

import { eq, desc } from "drizzle-orm";

import { getDb } from "@/server/db/client";
import { researchProgress } from "@/server/db/schema";
import { deepResearchStory } from "@/server/services/board/story-research";
import { runFullTopicAgentForBoardStory } from "@/server/services/board/full-topic-agent";

type RouteContext = {
  params: Promise<{
    storyId: string;
  }>;
};

/** POST: trigger deep research for a story */
export async function POST(request: Request, context: RouteContext) {
  const { storyId } = await context.params;

  let mode: "quick" | "full" = "quick";
  try {
    const body = (await request.json()) as { mode?: string };
    if (body.mode === "full") mode = "full";
  } catch {
    // Default to quick mode if no body
  }

  try {
    const db = getDb();

    // Create a progress record first so we can return its ID immediately
    const rows = await db
      .insert(researchProgress)
      .values({
        storyId,
        taskType: mode === "full" ? "full_topic_agent" : "deep_research",
        step: "pending",
        progress: 0,
        message: "Research queued...",
      })
      .returning({ id: researchProgress.id });

    const progressId = rows[0].id;

    if (mode === "full") {
      runFullTopicAgentForBoardStory({ storyId, progressId }).catch((err) => {
        console.error(`[research-api] Full topic agent failed for ${storyId}:`, err);
      });
    } else {
      deepResearchStory(storyId, mode, progressId).catch((err) => {
        console.error(`[research-api] Research failed for ${storyId}:`, err);
      });
    }

    return NextResponse.json({ progressId, storyId, mode });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to start research";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** GET: get research progress for a story */
export async function GET(_: Request, context: RouteContext) {
  const { storyId } = await context.params;

  try {
    const db = getDb();

    const rows = await db
      .select()
      .from(researchProgress)
      .where(eq(researchProgress.storyId, storyId))
      .orderBy(desc(researchProgress.startedAt))
      .limit(1);

    if (rows.length === 0) {
      return NextResponse.json(
        { error: "No research progress found" },
        { status: 404 }
      );
    }

    const progress = rows[0];
    return NextResponse.json({
      id: progress.id,
      storyId: progress.storyId,
      taskType: progress.taskType,
      step: progress.step,
      progress: progress.progress,
      message: progress.message,
      metadata: progress.metadataJson,
      startedAt: progress.startedAt.toISOString(),
      updatedAt: progress.updatedAt.toISOString(),
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to get progress";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
