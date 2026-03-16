import { NextResponse } from "next/server";

import {
  listBoardCompetitors,
  refreshBoardCompetitors,
} from "@/server/services/board";

export async function GET() {
  const competitors = await listBoardCompetitors();

  return NextResponse.json(competitors);
}

export async function POST() {
  const result = await refreshBoardCompetitors();
  const competitors = await listBoardCompetitors();

  return NextResponse.json({
    refresh: result,
    competitors,
  });
}
