import { NextResponse } from "next/server";

import { getVisualsForLine } from "@/server/services/investigation";

type RouteContext = {
  params: Promise<{
    projectId: string;
    lineId: string;
  }>;
};

export async function GET(_: Request, context: RouteContext) {
  const { projectId, lineId } = await context.params;
  const result = await getVisualsForLine(projectId, lineId);

  return NextResponse.json(result);
}
