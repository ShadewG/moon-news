import { NextResponse } from "next/server";
import { z } from "zod";

import { boardStoryStatusEnum, boardStoryTypeEnum } from "@/server/db/schema";
import { listBoardStories } from "@/server/services/board";

const boardStoriesQuerySchema = z.object({
  view: z.enum(["board", "controversy"]).optional().default("board"),
  status: z.enum(boardStoryStatusEnum.enumValues).optional(),
  storyType: z.enum(boardStoryTypeEnum.enumValues).optional(),
  search: z.string().trim().max(200).optional().default(""),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(60).optional().default(24),
});

export async function GET(request: Request) {
  const url = new URL(request.url);
  const query = boardStoriesQuerySchema.parse({
    view: url.searchParams.get("view") ?? undefined,
    status: url.searchParams.get("status") ?? undefined,
    storyType: url.searchParams.get("storyType") ?? undefined,
    search: url.searchParams.get("search") ?? undefined,
    page: url.searchParams.get("page") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
  });

  const result = await listBoardStories(query);

  return NextResponse.json(result);
}
