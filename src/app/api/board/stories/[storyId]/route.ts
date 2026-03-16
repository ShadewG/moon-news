import { NextResponse } from "next/server";

import { getBoardStoryDetail } from "@/server/services/board";

type RouteContext = {
  params: Promise<{
    storyId: string;
  }>;
};

export async function GET(_: Request, context: RouteContext) {
  const { storyId } = await context.params;
  const story = await getBoardStoryDetail(storyId);

  if (!story) {
    return NextResponse.json({ error: "Story not found" }, { status: 404 });
  }

  return NextResponse.json(story);
}
