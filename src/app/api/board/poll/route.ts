import { NextResponse } from "next/server";

import { getEnv } from "@/server/config/env";
import { runBoardSourcePollCycle } from "@/server/services/board";

export async function POST() {
  if (!getEnv().ENABLE_BOARD_HEAVY_WEB_ROUTES) {
    return NextResponse.json(
      {
        status: "disabled",
        reason: "ENABLE_BOARD_HEAVY_WEB_ROUTES is false",
      },
      { status: 503 }
    );
  }

  try {
    const result = await runBoardSourcePollCycle();
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[board/poll] Poll cycle error:", message);
    return NextResponse.json(
      { error: message, partial: true },
      { status: 200 }
    );
  }
}
