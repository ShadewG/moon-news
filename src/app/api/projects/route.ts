import { NextResponse } from "next/server";
import { z } from "zod";

import { createProject, listProjects } from "@/server/services/projects";

const createProjectSchema = z.object({
  title: z.string().min(1),
  rawScript: z.string().optional(),
  lines: z
    .array(
      z.object({
        lineKey: z.string().min(1),
        lineIndex: z.number().int().nonnegative(),
        timestampStartMs: z.number().int().nonnegative().optional(),
        durationMs: z.number().int().nonnegative().optional(),
        text: z.string().min(1),
        lineType: z.enum(["narration", "quote", "transition", "headline"]),
      })
    )
    .optional(),
});

export async function GET() {
  const projects = await listProjects();

  return NextResponse.json({ projects });
}

export async function POST(request: Request) {
  const json = await request.json();
  const payload = createProjectSchema.parse(json);
  const result = await createProject(payload);

  return NextResponse.json(result, { status: 201 });
}
