import { NextResponse } from "next/server";

import { getProjectFootage } from "@/server/services/investigation";

type RouteContext = {
  params: Promise<{
    projectId: string;
  }>;
};

export async function GET(_: Request, context: RouteContext) {
  const { projectId } = await context.params;
  const result = await getProjectFootage(projectId);

  return NextResponse.json(result);
}
