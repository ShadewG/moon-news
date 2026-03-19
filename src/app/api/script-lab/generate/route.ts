import { NextResponse } from "next/server";

import { scriptLabRequestSchema } from "@/lib/script-lab";
import { generateAndSaveScriptLabRun } from "@/server/services/script-lab";

export async function POST(request: Request) {
  try {
    const json = await request.json();
    const input = scriptLabRequestSchema.parse(json);
    const result = await generateAndSaveScriptLabRun(input);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const status =
      message.includes("Missing required environment variable")
        ? 503
        : message.includes("failed")
          ? 502
          : 400;

    return NextResponse.json({ error: message }, { status });
  }
}
