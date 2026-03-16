import { NextResponse } from "next/server";

import { createProjectFromBoardStory } from "@/server/services/board";

type RouteContext = {
  params: Promise<{
    storyId: string;
  }>;
};

export async function POST(_: Request, context: RouteContext) {
  const { storyId } = await context.params;
  const result = await createProjectFromBoardStory(storyId);

  if (!result) {
    return NextResponse.json({ error: "Story not found" }, { status: 404 });
  }

  return NextResponse.json(result, { status: result.created ? 201 : 200 });
}
