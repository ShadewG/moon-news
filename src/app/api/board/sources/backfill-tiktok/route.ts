import { NextRequest, NextResponse } from "next/server";

import { getEnv } from "@/server/config/env";
import { backfillPendingBoardTikTokSources } from "@/server/services/board";

function parseBoolean(value: string | null, fallback: boolean) {
  if (value === null) {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();

  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  return fallback;
}

export async function POST(request: NextRequest) {
  if (!getEnv().ENABLE_BOARD_HEAVY_WEB_ROUTES) {
    return NextResponse.json(
      {
        status: "disabled",
        reason: "ENABLE_BOARD_HEAVY_WEB_ROUTES is false",
      },
      { status: 503 }
    );
  }

  const limit = Number(request.nextUrl.searchParams.get("limit") ?? "8");
  const maxResults = Number(request.nextUrl.searchParams.get("maxResults") ?? "10");
  const lookbackHours = Number(request.nextUrl.searchParams.get("lookbackHours") ?? "24");
  const onlyNeverSucceeded = parseBoolean(
    request.nextUrl.searchParams.get("onlyNeverSucceeded"),
    true
  );
  const includeAlertsAndHealth = parseBoolean(
    request.nextUrl.searchParams.get("includeAlertsAndHealth"),
    false
  );

  try {
    const result = await backfillPendingBoardTikTokSources({
      limit,
      maxResults,
      lookbackHours,
      onlyNeverSucceeded,
      includeAlertsAndHealth,
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
        error:
          error instanceof Error
            ? error.message
            : "Failed to backfill pending TikTok sources",
      },
      { status }
    );
  }
}
