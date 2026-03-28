import { NextResponse } from "next/server";

import {
  enrichBoardStoryCommentReaction,
  getBoardStoryDetail,
} from "@/server/services/board";

type RouteContext = {
  params: Promise<{
    storyId: string;
  }>;
};

export async function POST(_: Request, context: RouteContext) {
  const { storyId } = await context.params;

  await enrichBoardStoryCommentReaction([storyId]);
  const detail = await getBoardStoryDetail(storyId);

  if (!detail) {
    return NextResponse.json({ error: "Story not found" }, { status: 404 });
  }

  return NextResponse.json({
    story: detail.story,
  });
}
