import "server-only";

import { and, desc, eq } from "drizzle-orm";
import { tasks } from "@trigger.dev/sdk/v3";

import { isTriggerConfigured } from "@/server/config/env";
import { getDb } from "@/server/db/client";
import {
  projects,
  researchRuns,
  researchSources,
  researchSummaries,
  scriptLines,
} from "@/server/db/schema";
import { scrapeResearchSource } from "@/server/providers/firecrawl";
import { summarizeResearch } from "@/server/providers/openai";
import { searchLineResearch } from "@/server/providers/parallel";

export const RESEARCH_LINE_TASK_ID = "research-line";

export async function createResearchRun(input: {
  projectId: string;
  scriptLineId: string;
}) {
  const db = getDb();

  const [run] = await db
    .insert(researchRuns)
    .values({
      projectId: input.projectId,
      scriptLineId: input.scriptLineId,
      provider: "parallel",
      status: "pending",
    })
    .returning();

  await db
    .update(scriptLines)
    .set({
      researchStatus: "queued",
      updatedAt: new Date(),
    })
    .where(eq(scriptLines.id, input.scriptLineId));

  return run;
}

export async function enqueueResearchRun(runId: string) {
  const db = getDb();

  if (isTriggerConfigured()) {
    const handle = await tasks.trigger(RESEARCH_LINE_TASK_ID, {
      researchRunId: runId,
    });

    await db
      .update(researchRuns)
      .set({
        status: "queued",
        triggerRunId: handle.id,
        updatedAt: new Date(),
      })
      .where(eq(researchRuns.id, runId));

    return {
      mode: "trigger" as const,
      triggerRunId: handle.id,
    };
  }

  await runResearchLineTask({ researchRunId: runId });

  return {
    mode: "inline" as const,
    triggerRunId: null,
  };
}

export async function runResearchLineTask(input: { researchRunId: string }) {
  const db = getDb();

  const [runRecord] = await db
    .select({
      run: researchRuns,
      line: scriptLines,
      project: projects,
    })
    .from(researchRuns)
    .innerJoin(scriptLines, eq(scriptLines.id, researchRuns.scriptLineId))
    .innerJoin(projects, eq(projects.id, researchRuns.projectId))
    .where(eq(researchRuns.id, input.researchRunId))
    .limit(1);

  if (!runRecord) {
    throw new Error(`Research run not found: ${input.researchRunId}`);
  }

  try {
    await db
      .update(researchRuns)
      .set({
        status: "running",
        startedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(researchRuns.id, input.researchRunId));

    await db
      .update(scriptLines)
      .set({
        researchStatus: "running",
        updatedAt: new Date(),
      })
      .where(eq(scriptLines.id, runRecord.line.id));

    const searchResult = await searchLineResearch({
      projectTitle: runRecord.project.title,
      lineText: runRecord.line.text,
    });

    await db
      .update(researchRuns)
      .set({
        query: searchResult.query,
        parallelSearchId: searchResult.searchId,
        updatedAt: new Date(),
      })
      .where(eq(researchRuns.id, input.researchRunId));

    const sourcePayloads = await Promise.all(
      searchResult.results.map(async (result) => {
        let extractedMarkdown = "";
        let sourceName = new URL(result.url).hostname;

        try {
          const scrapeResult = await scrapeResearchSource(result.url);
          extractedMarkdown = scrapeResult.markdown;
          sourceName = scrapeResult.sourceName ?? sourceName;
        } catch {
          // Keep the search result even when full-page extraction fails.
        }

        return {
          title: result.title,
          sourceName,
          sourceUrl: result.url,
          publishedAt: result.publishedAt,
          snippet: result.snippet,
          extractedMarkdown,
          relevanceScore: result.relevanceScore,
        };
      })
    );

    if (sourcePayloads.length) {
      await db.insert(researchSources).values(
        sourcePayloads.map((source) => ({
          researchRunId: input.researchRunId,
          scriptLineId: runRecord.line.id,
          title: source.title,
          sourceName: source.sourceName,
          sourceUrl: source.sourceUrl,
          publishedAt: source.publishedAt,
          snippet: source.snippet,
          extractedTextPath: null,
          relevanceScore: source.relevanceScore,
          sourceType: "unknown" as const,
          citationJson: {
            url: source.sourceUrl,
            title: source.title,
            publishedAt: source.publishedAt,
          },
        }))
      );
    }

    const summary = await summarizeResearch({
      lineText: runRecord.line.text,
      sources: sourcePayloads.map((source) => ({
        title: source.title,
        url: source.sourceUrl,
        snippet: source.snippet,
        extractedMarkdown: source.extractedMarkdown,
      })),
    });

    await db.insert(researchSummaries).values({
      researchRunId: input.researchRunId,
      scriptLineId: runRecord.line.id,
      summary: summary.summary,
      confidenceScore: summary.confidenceScore,
      model: summary.model,
    });

    await db
      .update(researchRuns)
      .set({
        status: "complete",
        completedAt: new Date(),
        errorMessage: null,
        updatedAt: new Date(),
      })
      .where(eq(researchRuns.id, input.researchRunId));

    await db
      .update(scriptLines)
      .set({
        researchStatus: "complete",
        updatedAt: new Date(),
      })
      .where(eq(scriptLines.id, runRecord.line.id));
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown research failure";

    await db
      .update(researchRuns)
      .set({
        status: "failed",
        errorMessage: message,
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(researchRuns.id, input.researchRunId));

    await db
      .update(scriptLines)
      .set({
        researchStatus: "failed",
        updatedAt: new Date(),
      })
      .where(eq(scriptLines.id, runRecord.line.id));

    throw error;
  }
}

export async function getLatestResearchForLine(projectId: string, lineId: string) {
  const db = getDb();

  const [latestRun] = await db
    .select()
    .from(researchRuns)
    .where(
      and(eq(researchRuns.projectId, projectId), eq(researchRuns.scriptLineId, lineId))
    )
    .orderBy(desc(researchRuns.createdAt))
    .limit(1);

  if (!latestRun) {
    return null;
  }

  const sources = await db
    .select()
    .from(researchSources)
    .where(eq(researchSources.researchRunId, latestRun.id))
    .orderBy(desc(researchSources.relevanceScore));

  const [summary] = await db
    .select()
    .from(researchSummaries)
    .where(eq(researchSummaries.researchRunId, latestRun.id))
    .limit(1);

  return {
    run: latestRun,
    sources,
    summary: summary ?? null,
  };
}

export async function getJobStatus(jobId: string) {
  const db = getDb();

  const [run] = await db
    .select()
    .from(researchRuns)
    .where(eq(researchRuns.id, jobId))
    .limit(1);

  return run ?? null;
}
