import { NextResponse } from "next/server";

import { listBoardCompetitors } from "@/server/services/board";

export async function GET() {
  const competitors = await listBoardCompetitors();

  return NextResponse.json(competitors);
}
