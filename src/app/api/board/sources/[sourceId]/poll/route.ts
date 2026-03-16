import { NextResponse } from "next/server";

import { pollBoardSource } from "@/server/services/board";

type RouteContext = {
  params: Promise<{
    sourceId: string;
  }>;
};

export async function POST(_: Request, context: RouteContext) {
  const { sourceId } = await context.params;

  try {
    const result = await pollBoardSource(sourceId);

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
        error: error instanceof Error ? error.message : "Failed to poll source",
      },
      { status }
    );
  }
}
