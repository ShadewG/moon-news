import { NextRequest, NextResponse } from "next/server";

import { getStoryContext } from "@/server/services/board-stories";
import {
  createScriptAgentRun,
  enqueueScriptAgentRun,
} from "@/server/services/script-agent";

type RouteContext = { params: Promise<{ storyId: string }> };

// POST /api/board/stories/[storyId]/generate-script
export async function POST(request: NextRequest, context: RouteContext) {
  const { storyId } = await context.params;

  try {
    const ctx = await getStoryContext(storyId);

    // Build research text from feed items
    const researchText = ctx.items
      .map(
        (item, i) =>
          `${i + 1}. [${item.source}] "${item.title}"\n${item.summary ?? "No summary available."}\nURL: ${item.url}`
      )
      .join("\n\n");

    if (researchText.length < 200) {
      return NextResponse.json(
        { error: "Not enough source material to generate a script. Need at least 200 chars of research." },
        { status: 400 }
      );
    }

    const run = await createScriptAgentRun({
      storyTitle: ctx.title,
      researchText,
      notes: `Auto-generated from board story: ${storyId}`,
      targetRuntimeMinutes: 12,
      objective: "",
      preferredAngle: "",
      researchDepth: "deep",
    });

    const enqueueResult = await enqueueScriptAgentRun(run.id);

    return NextResponse.json({
      runId: run.id,
      redirectUrl: `/script-agent/${run.id}`,
      status: enqueueResult.status,
      mode: enqueueResult.mode,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to generate script";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
