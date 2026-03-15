import { NextResponse } from "next/server";
import { z } from "zod";

import { getScriptLine } from "@/server/services/projects";
import {
  createResearchRun,
  enqueueResearchRun,
  getLatestResearchForLine,
} from "@/server/services/research";

const createResearchSchema = z.object({
  force: z.boolean().optional(),
});

type RouteContext = {
  params: Promise<{
    projectId: string;
    lineId: string;
  }>;
};

export async function GET(_: Request, context: RouteContext) {
  const { projectId, lineId } = await context.params;
  const result = await getLatestResearchForLine(projectId, lineId);

  if (!result) {
    return NextResponse.json({ research: null }, { status: 200 });
  }

  return NextResponse.json(result);
}

export async function POST(request: Request, context: RouteContext) {
  const { projectId, lineId } = await context.params;
  createResearchSchema.parse(await request.json().catch(() => ({})));

  const line = await getScriptLine(projectId, lineId);

  if (!line) {
    return NextResponse.json({ error: "Script line not found" }, { status: 404 });
  }

  const run = await createResearchRun({
    projectId,
    scriptLineId: lineId,
  });

  const execution = await enqueueResearchRun(run.id);

  return NextResponse.json(
    {
      runId: run.id,
      execution,
    },
    { status: 202 }
  );
}
