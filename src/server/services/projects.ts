import "server-only";

import { and, asc, desc, eq } from "drizzle-orm";

import { getDb } from "@/server/db/client";
import { projects, scriptLines, scriptVersions } from "@/server/db/schema";

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
        status: "draft",
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

    if (input.lines?.length) {
      await tx.insert(scriptLines).values(
        input.lines.map((line) => ({
          projectId: project.id,
          scriptVersionId: version.id,
          lineKey: line.lineKey,
          lineIndex: line.lineIndex,
          timestampStartMs: line.timestampStartMs ?? 0,
          durationMs: line.durationMs ?? 0,
          text: line.text,
          lineType: line.lineType,
        }))
      );
    }

    return {
      project,
      version,
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
