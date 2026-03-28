import { NextResponse } from "next/server";

import { setBoardStoryEditorialFeedback } from "@/server/services/board";

type RouteContext = {
  params: Promise<{
    storyId: string;
  }>;
};

export async function POST(request: Request, context: RouteContext) {
  const { storyId } = await context.params;
  const body = (await request.json().catch(() => null)) as
    | { irrelevant?: boolean }
    | null;

  if (typeof body?.irrelevant !== "boolean") {
    return NextResponse.json(
      { error: "Expected boolean `irrelevant` in request body" },
      { status: 400 }
    );
  }

  const story = await setBoardStoryEditorialFeedback(storyId, {
    irrelevant: body.irrelevant,
  });

  if (!story) {
    return NextResponse.json({ error: "Story not found" }, { status: 404 });
  }

  return NextResponse.json({ story }, { status: 200 });
}
