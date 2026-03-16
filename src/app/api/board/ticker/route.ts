import { NextResponse } from "next/server";

import { listBoardTicker } from "@/server/services/board";

export async function GET() {
  const ticker = await listBoardTicker();

  return NextResponse.json({ ticker });
}
