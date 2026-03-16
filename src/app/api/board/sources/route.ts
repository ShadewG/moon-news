import { NextResponse } from "next/server";

import { listBoardSources } from "@/server/services/board";

export async function GET() {
  const result = await listBoardSources();

  return NextResponse.json(result);
}
