import { NextResponse } from "next/server";

import { getBoardHealth } from "@/server/services/board";

export async function GET() {
  const health = await getBoardHealth();

  return NextResponse.json(health);
}
