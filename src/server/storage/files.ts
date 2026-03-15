import "server-only";

import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";

import { getMediaRoot } from "@/server/config/env";

function sanitizePathSegment(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export function getProjectDirectory(projectId: string): string {
  return path.join(getMediaRoot(), "projects", projectId);
}

export async function writeProjectFile(input: {
  projectId: string;
  category: string;
  fileName: string;
  content: string;
}): Promise<string> {
  const safeCategory = sanitizePathSegment(input.category);
  const safeFileName = sanitizePathSegment(input.fileName) || "document";
  const directory = path.join(getProjectDirectory(input.projectId), safeCategory);

  await mkdir(directory, { recursive: true });

  const absolutePath = path.join(directory, `${safeFileName}.md`);
  await writeFile(absolutePath, input.content, "utf8");

  return absolutePath;
}
