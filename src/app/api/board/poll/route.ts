import { NextResponse } from "next/server";

import { runBoardSourcePollCycle } from "@/server/services/board";

export async function POST() {
  const result = await runBoardSourcePollCycle();

  return NextResponse.json(result);
}
