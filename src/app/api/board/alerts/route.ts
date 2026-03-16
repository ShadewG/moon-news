import { NextResponse } from "next/server";

import { listBoardAlerts } from "@/server/services/board";

export async function GET() {
  const alerts = await listBoardAlerts();

  return NextResponse.json({ alerts });
}
