import "server-only";

import { and, asc, desc, eq } from "drizzle-orm";

import {
  sampleProject,
  sampleResearch,
  sampleScript,
} from "@/lib/sample-data";
import { getDb } from "@/server/db/client";
import {
  projects,
  researchRuns,
  researchSources,
  researchSummaries,
  scriptLines,
  scriptVersions,
} from "@/server/db/schema";

export interface CreateProjectInput {
  title: string;
  rawScript?: string;
  lines?: Array<{
    lineKey: string;
    lineIndex: number;
    timestampStartMs?: number;
    durationMs?: number;
    text: string;
    lineType: "narration" | "quote" | "transition" | "headline";
    researchStatus?: "pending" | "queued" | "running" | "complete" | "failed" | "needs_review";
    footageStatus?: "pending" | "queued" | "running" | "complete" | "failed" | "needs_review";
    imageStatus?: "pending" | "queued" | "running" | "complete" | "failed" | "needs_review";
    videoStatus?: "pending" | "queued" | "running" | "complete" | "failed" | "needs_review";
  }>;
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export async function listProjects() {
  const db = getDb();

  return db.select().from(projects).orderBy(desc(projects.updatedAt));
}

export async function getProjectById(projectId: string) {
  const db = getDb();

  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);

  if (!project) {
    return null;
  }

  const lines = await db
    .select()
    .from(scriptLines)
    .where(eq(scriptLines.projectId, projectId))
    .orderBy(asc(scriptLines.lineIndex));

  return {
    project,
    lines,
  };
}

export async function createProject(input: CreateProjectInput) {
  const db = getDb();
  const slugBase = slugify(input.title) || "project";
  const slug = `${slugBase}-${Date.now().toString(36)}`;

  return db.transaction(async (tx) => {
    const [project] = await tx
      .insert(projects)
      .values({
        title: input.title,
        slug,
        status: "active",
      })
      .returning();

    const [version] = await tx
      .insert(scriptVersions)
      .values({
        projectId: project.id,
        versionNumber: 1,
        rawScript: input.rawScript ?? "",
      })
      .returning();

    const lines = input.lines?.length
      ? await tx
          .insert(scriptLines)
          .values(
        input.lines.map((line) => ({
          projectId: project.id,
          scriptVersionId: version.id,
          lineKey: line.lineKey,
          lineIndex: line.lineIndex,
          timestampStartMs: line.timestampStartMs ?? 0,
          durationMs: line.durationMs ?? 0,
          text: line.text,
          lineType: line.lineType,
              researchStatus: line.researchStatus ?? "pending",
              footageStatus: line.footageStatus ?? "pending",
              imageStatus: line.imageStatus ?? "pending",
              videoStatus: line.videoStatus ?? "pending",
            }))
          )
          .returning()
      : [];

    return {
      project,
      version,
      lines,
    };
  });
}

export async function getScriptLine(projectId: string, lineId: string) {
  const db = getDb();

  const [line] = await db
    .select()
    .from(scriptLines)
    .where(and(eq(scriptLines.projectId, projectId), eq(scriptLines.id, lineId)))
    .limit(1);

  return line ?? null;
}

export async function bootstrapDemoProject() {
  const existingProjects = await listProjects();

  if (existingProjects.length > 0) {
    return getProjectById(existingProjects[0].id);
  }

  const db = getDb();
  const rawScript = sampleScript.map((line) => line.text).join("\n\n");

  const created = await createProject({
    title: sampleProject.title,
    rawScript,
    lines: sampleScript.map((line) => ({
      lineKey: line.line_key,
      lineIndex: line.line_index,
      timestampStartMs: line.timestamp_start_ms,
      durationMs: line.duration_ms,
      text: line.text,
      lineType: line.line_type,
      researchStatus: line.research_status,
      footageStatus: line.footage_status,
      imageStatus: line.image_status,
      videoStatus: line.video_status,
    })),
  });

  const lineIdByKey = new Map(
    created.lines.map((line) => [line.lineKey, line.id])
  );

  for (const line of sampleScript) {
    const scriptLineId = lineIdByKey.get(line.line_key);

    if (!scriptLineId) {
      continue;
    }

    const seededResearch = sampleResearch[line.line_key];

    if (seededResearch) {
      const [run] = await db
        .insert(researchRuns)
        .values({
          projectId: created.project.id,
          scriptLineId,
          provider: seededResearch.run.provider,
          status: seededResearch.run.status,
          query: seededResearch.run.query,
          parallelSearchId: seededResearch.run.parallel_job_id,
          startedAt: seededResearch.run.started_at
            ? new Date(seededResearch.run.started_at)
            : null,
          completedAt: seededResearch.run.completed_at
            ? new Date(seededResearch.run.completed_at)
            : null,
          errorMessage: seededResearch.run.error_message,
        })
        .returning();

      if (seededResearch.sources.length > 0) {
        await db.insert(researchSources).values(
          seededResearch.sources.map((source) => ({
            researchRunId: run.id,
            scriptLineId,
            title: source.title,
            sourceName: source.source_name,
            sourceUrl: source.source_url,
            publishedAt: source.published_at,
            snippet: source.snippet,
            extractedTextPath: source.extracted_text_path,
            relevanceScore: source.relevance_score,
            sourceType: source.source_type,
            citationJson: source.citation_json,
          }))
        );
      }

      if (seededResearch.summary) {
        await db.insert(researchSummaries).values({
          researchRunId: run.id,
          scriptLineId,
          summary: seededResearch.summary.summary,
          confidenceScore: seededResearch.summary.confidence_score,
          model: seededResearch.summary.model,
        });
      }

      continue;
    }

    if (
      line.research_status === "queued" ||
      line.research_status === "running"
    ) {
      await db.insert(researchRuns).values({
        projectId: created.project.id,
        scriptLineId,
        provider: "parallel",
        status: line.research_status,
        query: line.text,
        startedAt:
          line.research_status === "running"
            ? new Date(sampleProject.updated_at)
            : null,
      });
    }
  }

  return getProjectById(created.project.id);
}
