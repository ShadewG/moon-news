import "server-only";

import { and, desc, eq } from "drizzle-orm";
import { tasks } from "@trigger.dev/sdk/v3";

import { isTriggerConfigured } from "@/server/config/env";
import { getDb } from "@/server/db/client";
import {
  footageAssets,
  footageSearchRuns,
  projects,
  scriptLines,
  visualRecommendations,
} from "@/server/db/schema";
import { classifyLine, type LineClassification } from "@/server/providers/openai";
import { runVisualSearchTask } from "./visual-search";
import { createResearchRun, enqueueResearchRun } from "./research";

export const INVESTIGATE_LINE_TASK_ID = "investigate-line";

// ─── Classification ───

export async function runClassifyLineTask(input: {
  scriptLineId: string;
  projectId: string;
}): Promise<LineClassification> {
  const db = getDb();

  const [record] = await db
    .select({ line: scriptLines, project: projects })
    .from(scriptLines)
    .innerJoin(projects, eq(projects.id, scriptLines.projectId))
    .where(
      and(
        eq(scriptLines.id, input.scriptLineId),
        eq(scriptLines.projectId, input.projectId)
      )
    )
    .limit(1);

  if (!record) {
    throw new Error(`Script line not found: ${input.scriptLineId}`);
  }

  const classification = await classifyLine({
    lineText: record.line.text,
    lineType: record.line.lineType,
    projectTitle: record.project.title,
  });

  await db
    .update(scriptLines)
    .set({
      lineContentCategory: classification.category,
      classificationJson: classification,
      updatedAt: new Date(),
    })
    .where(eq(scriptLines.id, input.scriptLineId));

  // Write AI generation recommendation if applicable
  if (classification.ai_generation_recommended) {
    await db.insert(visualRecommendations).values({
      projectId: input.projectId,
      scriptLineId: input.scriptLineId,
      recommendationType: "ai_video",
      reason:
        classification.ai_generation_reason ??
        `Category "${classification.category}" typically benefits from AI-generated visuals`,
      suggestedPrompt: `Generate visual for: "${record.line.text.slice(0, 200)}"`,
      suggestedStyle:
        classification.category === "sample_story"
          ? "cinematic_realistic"
          : "documentary_broll",
      confidence: classification.category === "sample_story" ? 0.95 : 0.7,
    });
  }

  return classification;
}

// ─── Full Investigation Orchestrator ───

export async function runInvestigateLineTask(input: {
  projectId: string;
  scriptLineId: string;
}): Promise<void> {
  const db = getDb();

  // Step 1: Classify the line
  const classification = await runClassifyLineTask({
    scriptLineId: input.scriptLineId,
    projectId: input.projectId,
  });

  // Step 2: Skip search for transitions
  if (classification.category === "transition") {
    await db
      .update(scriptLines)
      .set({
        footageStatus: "complete",
        updatedAt: new Date(),
      })
      .where(eq(scriptLines.id, input.scriptLineId));
    return;
  }

  // Step 3: Conditional text research (for quote_claim, or low-confidence categories)
  const needsTextResearch =
    classification.category === "quote_claim" ||
    (classification.category === "concrete_event" &&
      classification.search_keywords.length < 2);

  if (needsTextResearch) {
    try {
      const run = await createResearchRun({
        projectId: input.projectId,
        scriptLineId: input.scriptLineId,
      });
      // Run inline since we're already in a task
      const { runResearchLineTask } = await import("./research");
      await runResearchLineTask({ researchRunId: run.id });
    } catch {
      // Text research failure shouldn't block visual search
    }
  }

  // Step 4: Visual search with tiered fallback
  await db
    .update(scriptLines)
    .set({
      footageStatus: "running",
      updatedAt: new Date(),
    })
    .where(eq(scriptLines.id, input.scriptLineId));

  const visualResult = await runVisualSearchTask({
    projectId: input.projectId,
    scriptLineId: input.scriptLineId,
    category: classification.category,
    searchKeywords: classification.search_keywords,
    temporalContext: classification.temporal_context,
  });

  // Step 5: If no good visuals found and not already recommended, suggest AI generation
  if (
    visualResult.totalAssets === 0 &&
    !classification.ai_generation_recommended
  ) {
    await db.insert(visualRecommendations).values({
      projectId: input.projectId,
      scriptLineId: input.scriptLineId,
      recommendationType: "ai_video",
      reason: "No footage found after searching all available providers",
      suggestedPrompt: `Generate visual for: "${classification.search_keywords.join(", ")}"`,
      suggestedStyle: "documentary_broll",
      confidence: 0.6,
    });
  }
}

// ─── Enqueue Investigation ───

export async function enqueueInvestigation(input: {
  projectId: string;
  scriptLineId: string;
}): Promise<{
  mode: "trigger" | "inline";
  triggerRunId: string | null;
}> {
  const db = getDb();

  await db
    .update(scriptLines)
    .set({
      footageStatus: "queued",
      updatedAt: new Date(),
    })
    .where(eq(scriptLines.id, input.scriptLineId));

  if (isTriggerConfigured()) {
    const handle = await tasks.trigger(INVESTIGATE_LINE_TASK_ID, {
      projectId: input.projectId,
      scriptLineId: input.scriptLineId,
    });

    return { mode: "trigger", triggerRunId: handle.id };
  }

  await runInvestigateLineTask(input);
  return { mode: "inline", triggerRunId: null };
}

// ─── Query Helpers ───

export async function getVisualsForLine(
  projectId: string,
  lineId: string
): Promise<{
  assets: Array<typeof footageAssets.$inferSelect>;
  recommendations: Array<typeof visualRecommendations.$inferSelect>;
}> {
  const db = getDb();

  const assets = await db
    .select()
    .from(footageAssets)
    .where(eq(footageAssets.scriptLineId, lineId))
    .orderBy(desc(footageAssets.matchScore));

  const recommendations = await db
    .select()
    .from(visualRecommendations)
    .where(
      and(
        eq(visualRecommendations.projectId, projectId),
        eq(visualRecommendations.scriptLineId, lineId),
        eq(visualRecommendations.dismissed, false)
      )
    )
    .orderBy(desc(visualRecommendations.confidence));

  return { assets, recommendations };
}

export async function dismissRecommendation(recommendationId: string) {
  const db = getDb();

  const [updated] = await db
    .update(visualRecommendations)
    .set({ dismissed: true })
    .where(eq(visualRecommendations.id, recommendationId))
    .returning();

  return updated ?? null;
}
