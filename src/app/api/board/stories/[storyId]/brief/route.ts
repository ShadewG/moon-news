import { NextResponse } from "next/server";

import { ensureBoardStoryAiOutput } from "@/server/services/board";

type RouteContext = {
  params: Promise<{
    storyId: string;
  }>;
};

export async function POST(_: Request, context: RouteContext) {
  const { storyId } = await context.params;
  const output = await ensureBoardStoryAiOutput(storyId, "brief");

  if (!output) {
    return NextResponse.json({ error: "Brief not found" }, { status: 404 });
  }

  return NextResponse.json({ output });
}
