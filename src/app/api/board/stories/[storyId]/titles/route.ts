import { NextResponse } from "next/server";

import { getBoardStoryAiOutput } from "@/server/services/board";

type RouteContext = {
  params: Promise<{
    storyId: string;
  }>;
};

export async function POST(_: Request, context: RouteContext) {
  const { storyId } = await context.params;
  const output = await getBoardStoryAiOutput(storyId, "titles");

  if (!output) {
    return NextResponse.json({ error: "Titles not found" }, { status: 404 });
  }

  return NextResponse.json({ output });
}
