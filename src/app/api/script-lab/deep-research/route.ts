import { NextResponse } from "next/server";

import { getDb } from "@/server/db/client";
import { boardStoryCandidates, researchProgress } from "@/server/db/schema";
import { deepResearchStory } from "@/server/services/board/story-research";

/** POST: start standalone deep research on any topic */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      topic: string;
      context?: string;
      mode?: "quick" | "full";
    };

    if (!body.topic?.trim() || body.topic.trim().length < 3) {
      return NextResponse.json(
        { error: "Topic is required (3+ characters)" },
        { status: 400 }
      );
    }

    const topic = body.topic.trim();
    const mode = body.mode === "full" ? "full" : "quick";
    const slug =
      "research-" +
      topic
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 80) +
      "-" +
      Date.now();

    const db = getDb();

    // Create a board story candidate so deep research has a record to work with
    const [story] = await db
      .insert(boardStoryCandidates)
      .values({
        slug,
        canonicalTitle: topic,
        vertical: null,
        status: "developing",
        storyType: "normal",
        metadataJson: {
          source: "script-lab",
          context: body.context?.trim() || null,
        },
      })
      .returning({ id: boardStoryCandidates.id });

    // Create progress record
    const [progress] = await db
      .insert(researchProgress)
      .values({
        storyId: story.id,
        taskType: "deep_research",
        step: "pending",
        progress: 0,
        message: "Research queued...",
      })
      .returning({ id: researchProgress.id });

    // Fire and forget — the progress polling endpoint tracks status
    deepResearchStory(story.id, mode, progress.id).catch((err) => {
      console.error(
        `[deep-research] Research failed for topic "${topic}":`,
        err
      );
    });

    return NextResponse.json({
      progressId: progress.id,
      storyId: story.id,
      mode,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to start research";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
