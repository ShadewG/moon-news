import { NextResponse } from "next/server";

import { and, eq } from "drizzle-orm";

import { getDb } from "@/server/db/client";
import { boardStoryAiOutputs, researchProgress } from "@/server/db/schema";

type RouteContext = {
  params: Promise<{ progressId: string }>;
};

/** GET: poll deep research progress and get result when done */
export async function GET(_: Request, context: RouteContext) {
  const { progressId } = await context.params;

  try {
    const db = getDb();

    const rows = await db
      .select()
      .from(researchProgress)
      .where(eq(researchProgress.id, progressId))
      .limit(1);

    if (rows.length === 0) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const p = rows[0];

    // If complete, also fetch the research result from board_story_ai_outputs
    let result = null;
    if (p.step === "complete" && p.storyId) {
      const outputs = await db
        .select({ content: boardStoryAiOutputs.content })
        .from(boardStoryAiOutputs)
        .where(
          and(
            eq(boardStoryAiOutputs.storyId, p.storyId),
            eq(boardStoryAiOutputs.kind, "brief")
          )
        )
        .limit(1);

      if (outputs.length > 0 && outputs[0].content) {
        try {
          result = JSON.parse(outputs[0].content);
        } catch {
          // Keep result null if JSON parse fails
        }
      }
    }

    return NextResponse.json({
      id: p.id,
      storyId: p.storyId,
      taskType: p.taskType,
      step: p.step,
      progress: p.progress,
      message: p.message,
      metadata: p.metadataJson,
      startedAt: p.startedAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
      result,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to get progress";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
