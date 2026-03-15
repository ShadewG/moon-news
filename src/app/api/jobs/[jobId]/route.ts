import { NextResponse } from "next/server";

import { getJobStatus } from "@/server/services/research";

type RouteContext = {
  params: Promise<{
    jobId: string;
  }>;
};

export async function GET(_: Request, context: RouteContext) {
  const { jobId } = await context.params;
  const job = await getJobStatus(jobId);

  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  return NextResponse.json({ job });
}
