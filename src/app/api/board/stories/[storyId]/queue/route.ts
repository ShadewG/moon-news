import { NextResponse } from "next/server";

import { addBoardStoryToQueue } from "@/server/services/board";

type RouteContext = {
  params: Promise<{
    storyId: string;
  }>;
};

export async function POST(_: Request, context: RouteContext) {
  const { storyId } = await context.params;
  const queueItem = await addBoardStoryToQueue(storyId);

  if (!queueItem) {
    return NextResponse.json({ error: "Story not found" }, { status: 404 });
  }

  return NextResponse.json({ queueItem }, { status: 200 });
}
