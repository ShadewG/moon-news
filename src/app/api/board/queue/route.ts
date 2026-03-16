import { NextResponse } from "next/server";

import { listBoardQueue } from "@/server/services/board";

export async function GET() {
  const queue = await listBoardQueue();

  return NextResponse.json({ queue });
}
