import { NextResponse } from "next/server";

import { moonAnalysisRequestSchema } from "@/lib/moon-analysis";
import {
  createMoonAnalysisRun,
  enqueueMoonAnalysisRun,
  listRecentMoonAnalysisRuns,
} from "@/server/services/moon-analysis";

export async function GET() {
  try {
    const runs = await listRecentMoonAnalysisRuns(20);
    return NextResponse.json({ runs });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const input = moonAnalysisRequestSchema.parse(body);
    const run = await createMoonAnalysisRun(input);
    const enqueue = await enqueueMoonAnalysisRun(run.id);

    return NextResponse.json({
      runId: run.id,
      mode: enqueue.mode,
      status: enqueue.status,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const status = message.includes("Missing required environment variable") ? 503 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
