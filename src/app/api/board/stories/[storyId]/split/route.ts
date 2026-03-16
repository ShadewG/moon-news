import { NextResponse } from "next/server";
import { z } from "zod";

import { splitBoardStory } from "@/server/services/board";

const splitStorySchema = z.object({
  feedItemIds: z.array(z.string().uuid()).min(1).max(50),
  canonicalTitle: z.string().trim().min(1).max(240).optional(),
});

type RouteContext = {
  params: Promise<{
    storyId: string;
  }>;
};

export async function POST(request: Request, context: RouteContext) {
  const { storyId } = await context.params;
  const parsed = splitStorySchema.safeParse(await request.json());

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Invalid split payload",
        issues: parsed.error.flatten(),
      },
      { status: 400 }
    );
  }

  try {
    const result = await splitBoardStory({
      storyIdOrSlug: storyId,
      feedItemIds: parsed.data.feedItemIds,
      canonicalTitle: parsed.data.canonicalTitle,
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
        error: error instanceof Error ? error.message : "Failed to split story",
      },
      { status }
    );
  }
}
