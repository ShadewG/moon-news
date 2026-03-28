import { NextResponse } from "next/server";

import { getBoardHealth } from "@/server/services/board";

export const dynamic = "force-dynamic";

export async function GET() {
  const health = await getBoardHealth();

  return NextResponse.json(health);
}
