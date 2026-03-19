import { NextResponse } from "next/server";

import { scriptAgentRequestSchema } from "@/lib/script-agent";
import {
  createScriptAgentRun,
  enqueueScriptAgentRun,
  listRecentScriptAgentRuns,
} from "@/server/services/script-agent";

export async function GET() {
  try {
    const runs = await listRecentScriptAgentRuns(10);
    return NextResponse.json({ runs });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const input = scriptAgentRequestSchema.parse(body);
    const run = await createScriptAgentRun(input);
    const enqueue = await enqueueScriptAgentRun(run.id);

    return NextResponse.json({
      runId: run.id,
      triggerRunId: enqueue.triggerRunId,
      mode: enqueue.mode,
      status: enqueue.status,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const status = message.includes("Missing required environment variable") ? 503 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
