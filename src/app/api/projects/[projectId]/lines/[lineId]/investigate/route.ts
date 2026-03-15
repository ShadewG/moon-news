import { NextResponse } from "next/server";

import { getScriptLine } from "@/server/services/projects";
import { enqueueInvestigation } from "@/server/services/investigation";

type RouteContext = {
  params: Promise<{
    projectId: string;
    lineId: string;
  }>;
};

export async function POST(_: Request, context: RouteContext) {
  const { projectId, lineId } = await context.params;

  const line = await getScriptLine(projectId, lineId);
  if (!line) {
    return NextResponse.json(
      { error: "Script line not found" },
      { status: 404 }
    );
  }

  const execution = await enqueueInvestigation({
    projectId,
    scriptLineId: lineId,
  });

  return NextResponse.json(
    { lineId, execution },
    { status: 202 }
  );
}
