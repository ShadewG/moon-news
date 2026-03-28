import { NextResponse } from "next/server";
import { z } from "zod";

import { getEnv } from "@/server/config/env";
import { mergeBoardStories } from "@/server/services/board";

const mergeStoriesSchema = z.object({
  targetStoryId: z.string().trim().min(1).max(200),
  sourceStoryIds: z.array(z.string().trim().min(1).max(200)).min(1).max(20),
});

export async function POST(request: Request) {
  if (!getEnv().ENABLE_BOARD_HEAVY_WEB_ROUTES) {
    return NextResponse.json(
      {
        status: "disabled",
        reason: "ENABLE_BOARD_HEAVY_WEB_ROUTES is false",
      },
      { status: 503 }
    );
  }

  const parsed = mergeStoriesSchema.safeParse(await request.json());

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Invalid merge payload",
        issues: parsed.error.flatten(),
      },
      { status: 400 }
    );
  }

  try {
    const result = await mergeBoardStories({
      targetStoryIdOrSlug: parsed.data.targetStoryId,
      sourceStoryIdsOrSlugs: parsed.data.sourceStoryIds,
    });

    return NextResponse.json(result);
  } catch (error) {
    const status =
      typeof error === "object" &&
      error !== null &&
      "status" in error &&
      typeof (error as { status?: unknown }).status === "number"
        ? ((error as { status: number }).status as number)
        : 500;

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to merge stories",
      },
      { status }
    );
  }
}
