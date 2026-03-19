import { NextResponse } from "next/server";
import { z } from "zod";

import { boardStoryStatusEnum, boardStoryTypeEnum } from "@/server/db/schema";
import { listBoardStories } from "@/server/services/board";

const boardStoriesQuerySchema = z.object({
  view: z.enum(["board", "controversy"]).optional().default("board"),
  status: z.enum(boardStoryStatusEnum.enumValues).optional(),
  storyType: z.enum(boardStoryTypeEnum.enumValues).optional(),
  search: z.string().trim().max(200).optional().default(""),
  moonFitBand: z.enum(["high", "medium", "low"]).optional(),
  moonCluster: z.string().trim().max(120).optional(),
  coverageMode: z.string().trim().max(120).optional(),
  vertical: z.string().trim().max(120).optional(),
  hasAnalogs: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
  minMoonFitScore: z.coerce.number().int().min(0).max(100).optional(),
  sort: z.enum(["moonFit", "storyScore", "controversy", "recency", "analogs", "views"]).optional(),
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
    moonFitBand: url.searchParams.get("moonFitBand") ?? undefined,
    moonCluster: url.searchParams.get("moonCluster") ?? undefined,
    coverageMode: url.searchParams.get("coverageMode") ?? undefined,
    vertical: url.searchParams.get("vertical") ?? undefined,
    hasAnalogs: url.searchParams.get("hasAnalogs") ?? undefined,
    minMoonFitScore: url.searchParams.get("minMoonFitScore") ?? undefined,
    sort: url.searchParams.get("sort") ?? undefined,
    page: url.searchParams.get("page") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
  });

  const result = await listBoardStories(query);

  return NextResponse.json(result);
}
