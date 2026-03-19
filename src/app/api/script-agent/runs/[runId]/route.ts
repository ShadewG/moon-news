import { NextResponse } from "next/server";

import { getScriptAgentRun } from "@/server/services/script-agent";

type RouteContext = {
  params: Promise<{
    runId: string;
  }>;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { runId } = await context.params;
    const run = await getScriptAgentRun(runId);

    if (!run) {
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }

    return NextResponse.json(run);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
