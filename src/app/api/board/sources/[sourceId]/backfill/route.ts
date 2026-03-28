import { NextRequest, NextResponse } from "next/server";

import { getEnv } from "@/server/config/env";
import { backfillBoardSource } from "@/server/services/board";

type RouteContext = {
  params: Promise<{
    sourceId: string;
  }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
  if (!getEnv().ENABLE_BOARD_HEAVY_WEB_ROUTES) {
    return NextResponse.json(
      {
        status: "disabled",
        reason: "ENABLE_BOARD_HEAVY_WEB_ROUTES is false",
      },
      { status: 503 }
    );
  }

  const { sourceId } = await context.params;
  const maxResults = Number(request.nextUrl.searchParams.get("maxResults") ?? "20");
  const lookbackHours = Number(request.nextUrl.searchParams.get("lookbackHours") ?? "24");
  const includeAlertsAndHealth =
    request.nextUrl.searchParams.get("includeAlertsAndHealth") === "1" ||
    request.nextUrl.searchParams.get("includeAlertsAndHealth") === "true";

  try {
    const result = await backfillBoardSource(
      sourceId,
      maxResults,
      lookbackHours,
      includeAlertsAndHealth
    );
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
        error:
          error instanceof Error ? error.message : "Failed to backfill source",
      },
      { status }
    );
  }
}
